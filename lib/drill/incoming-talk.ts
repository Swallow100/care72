// 掛かってきた電話の往復（docs/tasks/T127.md の 1）の保存と API の中身。route（app/api/drill/[id]/call/talk）は同じ所からの POST かを見て、
// ここの応答を返すだけ。D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
//
// 外へ掛けた電話の往復（lib/drill/talk.ts、T93）と同じ仕組みを、着信（drill_events の call_in と、応答の call_answer）に当てる:
// - ケアマネの言葉は決まった問い（CALL_IN_ASKS など TALK_ASKS の中）か自由の 1 文（60 字まで）。自由の文は本人役の口（lib/drill/hooks.ts の
//   createTalkHook）の中で仮名化の門を通し、伏せきれなければ 400「伏字不可」（Claude にも保存にも何も渡さない）
// - 1 往復は本人役 Haiku × 1 回で、ケアマネの時計は 2 分進む（TALK_MINUTES。手の分〔T110〕の使用に入る）。1 つの着信に 3 往復まで（TALK_MAX）
// - AI の数え方: 1 日の上限（AI_DAILY_LIMIT）は askJson が ai_calls で数え、1 訓練の上限は counts.call（外へ掛けた電話の往復と同じ）。
//   上限・鍵なし・失敗は固定の言葉（AI の印なし）
// - 返事の頼み事は world.asks に積む。色・4 問・聞いた安否は変えない（着信の安否は元から表に入っている。往復から安否を足さない）
// - 話し手は掛けてきた人の連絡先（lib/drill/calls.ts の callerContact）。本人役には「相手から掛けてきた電話の続き」と渡す
//
// 保存: 応答の記録（drill_events の call_answer、id `<signal>-p`）の payload に talk・talkEnd・callee を足す（新しい kind を足さないので migration なし）。
// 時計・頼み事・counts は drills.world（読んだ JSON の要る欄だけ置き換える）。取消の写し（undo）は外す: 往復は手の外にあるので、
// 最後の手を取り消すと drills.world は往復の前に戻るのに、作り直し（lib/drill/db.ts の replayState）は往復を当て、食い違うため。
// 作り直しは応答の記録の位置で往復を当てるので、応答のあとに手を打った着信は続けられない（応答の記録の actions と手の数を比べる）。
// 門: 進行中・読んだ刻みと手の数が同じ・今の刻みの着信・拒否していない・切っていない・3 往復に届いていない・72 時間に着いていない（切るのはよい）。
// 応答の記録がまだ無ければ（応答の POST は結果を待たない）、ここで応答として残してから往復を足す。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { ContactKind, ContactRow, DrillEventRow } from "../db/types.ts";
import { callTargetText } from "../list/calls.ts";
import { PseudonymLeakError } from "../pseudonym/index.ts";
import { FREE_LABELS } from "./action-catalog.ts";
import { clockOver } from "./action-terms.ts";
import { clampClock } from "./actions.ts";
import { callerContact, callerLabel } from "./calls.ts";
import { capReached, ZERO_COUNTS } from "./clock.ts";
import { drillScope, loadDrillRow, stateOfRow, type DrillScope } from "./db.ts";
import {
  dialogueFields,
  isTalkAsk,
  pushAsks,
  TALK_ASK_WORDS,
  TALK_FIXED_SPEECH,
  TALK_MAX,
  TALK_MINUTES,
  TALK_TEXT_MAX,
  TALK_UI,
  type TalkAsk,
  type TalkHook,
  type TalkLine,
} from "./dialogue.ts";
import { drillEnded, isNight, type DrillTurn } from "./engine.ts";
import { drillError, isDrillId } from "./http.ts";
import { calleeOf, callResponseId, respondCall, type CallCallee } from "./responses.ts";
import { pushTold } from "./person-facts.ts";

/** 往復の要求。ask（決まった問い）・text（自由の 1 文）・end（切る）のどれか 1 つ */
export type CallTalkRequest = { signal: string } & ({ ask: TalkAsk } | { text: string } | { end: true });

export type CallTalkResult =
  | { ok: true; signal: string; rounds: number; minute: number; lines: TalkLine[]; ended: boolean }
  | { ok: false; error: "not_found" | "conflict" | "ended" | "closed" };

/** 着信の往復の数（ケアマネの行の数） */
export const callRounds = (lines: ReadonlyArray<TalkLine> | null | undefined): number => (lines ?? []).filter((l) => l.who === "cm").length;

/** 着信の往復の最後の時刻（発災からの分）。無ければ 0 */
export const callTalkEnd = (lines: ReadonlyArray<TalkLine> | null | undefined): number => Math.max(0, ...(lines ?? []).map((l) => l.minute));

type CallIn = Pick<DrillEventRow, "step" | "person_id" | "payload">;
type Answer = Pick<DrillEventRow, "kind" | "payload">;

const parse = (text: string): Record<string, unknown> => {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

async function readCall(db: D1Database, drillId: string, signal: string): Promise<{ call: CallIn | null; answer: Answer | null }> {
  const [call, answer] = await db.batch([
    db
      .prepare(`SELECT step, person_id, payload FROM drill_events WHERE drill_id = ?1 AND kind = 'call_in' AND json_extract(payload, '$.signal') = ?2 LIMIT 1`)
      .bind(drillId, signal),
    db.prepare(`SELECT kind, payload FROM drill_events WHERE id = ?1 AND drill_id = ?2`).bind(callResponseId(signal), drillId),
  ]);
  return { call: (call.results[0] as CallIn | undefined) ?? null, answer: (answer.results[0] as Answer | undefined) ?? null };
}

/** 掛けてきた人の連絡先（台帳の連絡先から callerContact で。連絡先の無い人は区分の言い方だけ） */
async function calleeFor(db: D1Database, person: string, source: DrillTurn["source"]): Promise<CallCallee> {
  const res = await db
    .prepare("SELECT id, kind, relation, phone, has_smartphone FROM contacts WHERE person_id = ?1 ORDER BY sort, id")
    .bind(person)
    .all<Pick<ContactRow, "id" | "kind" | "relation" | "phone" | "has_smartphone">>();
  const contacts = res.results.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: callTargetText(c),
    hasPhone: Boolean(c.phone?.trim()),
    ...(c.has_smartphone === 1 ? { smartphone: true } : {}),
  }));
  const hit = callerContact(source, contacts);
  if (hit) return { id: hit.id, kind: hit.kind, label: callerLabel(source, contacts) };
  const kind: ContactKind = source === "supporter" ? "supporter" : "family";
  return { id: null, kind, label: callerLabel(source, []) };
}

/**
 * 往復を 1 つ足す（か切る）。expected は画面で読んだ今の刻みと手の数（違えば競合）。
 * 自由の文を伏せきれなければ口が PseudonymLeakError を投げる（何も書かない）
 */
export async function callTalkDrill(
  db: D1Database,
  scope: Pick<DrillScope, "officeId">,
  id: string,
  expected: { step: number; actions: number },
  req: CallTalkRequest,
  opts: { hook?: TalkHook } = {},
): Promise<CallTalkResult> {
  let row = await loadDrillRow(db, scope.officeId, id);
  if (!row) return { ok: false, error: "not_found" };
  if (drillEnded(stateOfRow(row))) return { ok: false, error: "ended" };
  if (row.step !== expected.step || stateOfRow(row).actions.length !== expected.actions) return { ok: false, error: "conflict" };

  let { call, answer } = await readCall(db, id, req.signal);
  if (!call || !call.person_id) return { ok: false, error: "not_found" };
  // 今の刻みの着信だけ（前の刻みの着信は鳴り終わっている）
  if (call.step !== row.step) return { ok: false, error: "closed" };
  if (!answer) {
    // 応答の POST より先に往復が来た（応答は結果を待たずに送る）。ここで応答として残す
    const r = await respondCall(db, scope, id, req.signal, "answer");
    if (!r.ok) return { ok: false, error: "not_found" };
    ({ call, answer } = await readCall(db, id, req.signal));
    row = await loadDrillRow(db, scope.officeId, id);
    if (!call || !answer || !row) return { ok: false, error: "conflict" };
  }
  if (answer.kind !== "call_answer") return { ok: false, error: "closed" };
  const before = stateOfRow(row);
  const person = call.person_id!;
  const callIn = parse(call.payload);
  const p = parse(answer.payload);
  const dialogue = dialogueFields(p);
  const lines = dialogue.talk ?? [];
  // 応答のあとに手を打った着信は続けない（作り直しの順が食い違う。上の注）
  const answeredAt = typeof p.actions === "number" ? p.actions : before.actions.length;
  if (answeredAt !== before.actions.length) return { ok: false, error: "closed" };
  if (dialogue.talkEnd !== undefined) return { ok: false, error: "closed" };

  const source: DrillTurn["source"] = callIn.source === "supporter" ? "supporter" : "family";
  const callee = calleeOf(p.callee) ?? (await calleeFor(db, person, source));
  const stored = JSON.parse(row.world) as Record<string, unknown>;

  if ("end" in req) {
    const payload = { ...p, ...(lines.length > 0 ? { talk: lines } : {}), talkEnd: before.minute, callee };
    const r = await db
      .prepare(`UPDATE drill_events SET payload = ?1 WHERE id = ?2 AND drill_id = ?3 AND payload = ?4`)
      .bind(JSON.stringify(payload), callResponseId(req.signal), id, answer.payload)
      .run();
    if ((r.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
    return { ok: true, signal: req.signal, rounds: callRounds(lines), minute: before.minute, lines, ended: true };
  }

  if (callRounds(lines) >= TALK_MAX) return { ok: false, error: "closed" };
  // 連続の時計が 72 時間に着いた後は往復を足さない（T123。切るのはよい）
  if (clockOver(before)) return { ok: false, error: "closed" };

  let world = before.world;
  const at = before.minute;
  const replyAt = at + TALK_MINUTES;
  const ask = "ask" in req ? req.ask : undefined;
  const text = "text" in req ? req.text.trim() : undefined;
  const first = typeof callIn.saying === "string" && callIn.saying.trim() ? callIn.saying : null;
  // 1 訓練の上限（T90 の 150）に達したら Claude を呼ばない（固定の言葉）
  const reply =
    opts.hook && !capReached(world.counts)
      ? await opts.hook({
          person,
          callee: { kind: callee.kind, id: callee.id },
          minute: at,
          world,
          state: before.people[person] ?? null,
          tell: null,
          ...(isNight(before) ? { night: true } : {}),
          first,
          lines,
          incoming: true,
          ...(ask ? { ask } : { text: text ?? "" }),
        })
      : null;
  const said = reply?.said ?? (ask ? TALK_ASK_WORDS[ask] : (text ?? ""));
  const ai = reply?.speech != null && reply.ai;
  const cm: TalkLine = { who: "cm", text: said, ai: false, minute: at, ...(ask ? { ask } : {}) };
  const them: TalkLine = {
    who: "them",
    text: (ai ? reply?.speech : null) ?? TALK_FIXED_SPEECH,
    ai,
    minute: replyAt,
    ...(ai && reply!.asks.length > 0 ? { asks: [...reply!.asks] } : {}),
  };
  const next = [...lines, cm, them];
  world = pushAsks(world, person, them.asks ?? [], replyAt);
  // ケアマネに言われた事（T130 の帳面）。次の区切りの本人役が覚えて従う
  world = pushTold(world, person, [cm]);
  if (reply?.called) {
    const c = { ...ZERO_COUNTS, ...(world.counts ?? {}) };
    world = { ...world, counts: { ...c, call: c.call + 1 } };
  }
  // 連続の時計は 72 時間で止める（T123）
  const minute = clampClock(before, Math.max(before.minute, replyAt));

  // 読んだ JSON の欄の並びと、知らない欄（区切り・配役）はそのまま。取消の写しは外す（上の注）
  const { undo: _undo, ...rest } = stored;
  const nextWorld = JSON.stringify({ ...rest, world, minute });
  const payload = JSON.stringify({ ...p, talk: next, callee });
  const [updated] = await db.batch([
    db
      .prepare(`UPDATE drills SET world = ?3 WHERE id = ?1 AND office_id = ?2 AND step = ?4 AND status = 'running' AND world = ?5`)
      .bind(id, scope.officeId, nextWorld, row.step, row.world),
    // 応答の記録も同じ取引で（drills を書けたときだけ。画面・紙・採点は drill_events から読む）
    db
      .prepare(
        `UPDATE drill_events SET payload = ?1
          WHERE id = ?2 AND drill_id = ?3 AND payload = ?4 AND EXISTS (SELECT 1 FROM drills WHERE id = ?3 AND world = ?5)`,
      )
      .bind(payload, callResponseId(req.signal), id, answer.payload, nextWorld),
  ]);
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  return { ok: true, signal: req.signal, rounds: callRounds(next), minute, lines: next, ended: false };
}

// ---------- API ----------

const NO_STORE = { "Cache-Control": "no-store" };
const SIGNAL_ID = /^[A-Za-z0-9_-]{1,128}$/;
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isStep = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000;
const given = (v: unknown) => v !== undefined && v !== null;

/** 往復の要求の形を見る（signal と、ask・text・end のどれか 1 つ）。形が違えば null */
export function parseCallTalkRequest(b: Record<string, unknown>): CallTalkRequest | null {
  if (typeof b.signal !== "string" || !SIGNAL_ID.test(b.signal)) return null;
  const signal = b.signal;
  if ([given(b.ask), given(b.text), given(b.end)].filter(Boolean).length !== 1) return null;
  if (given(b.ask)) return isTalkAsk(b.ask) ? { signal, ask: b.ask } : null;
  if (given(b.end)) return b.end === true ? { signal, end: true } : null;
  if (typeof b.text !== "string") return null;
  const text = b.text.trim();
  if (text === "" || [...text].length > TALK_TEXT_MAX) return null;
  return { signal, text };
}

/**
 * 着信の往復の POST（JSON）。{ step: 読んだ今の刻み, actions: 読んだ手の数, signal: 着信の安否の id, ask?: 決まった問い, text?: 自由の 1 文（60 字まで）, end?: true }。
 * 返すのは往復の全部の行（画面が読み直さずに描ける）。自由の文を伏せきれなければ 400（label「伏字不可」）。
 * 続けられない（前の刻みの着信・拒否した・切った後・4 往復目・応答のあとに手を打った）は 409（label「終話」）
 */
export async function callTalkPost(db: D1Database, p: Principal | null, id: string, json: unknown, opts: { hook?: TalkHook } = {}): Promise<Response> {
  if (!p) return drillError("login_required");
  const scope = drillScope(p);
  if (!scope) return drillError("forbidden");
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step) || !isCount(b.actions)) return drillError("invalid");
  const req = parseCallTalkRequest(b);
  if (!req) return drillError("invalid");
  let r: CallTalkResult;
  try {
    r = await callTalkDrill(db, scope, id, { step: b.step, actions: b.actions }, req, opts);
  } catch (e) {
    if (e instanceof PseudonymLeakError) {
      return Response.json({ ok: false, error: "invalid", label: FREE_LABELS.refused }, { status: 400, headers: NO_STORE });
    }
    throw e;
  }
  if (!r.ok) {
    if (r.error === "closed") return Response.json({ ok: false, error: "conflict", label: TALK_UI.ended }, { status: 409, headers: NO_STORE });
    return drillError(r.error);
  }
  return Response.json({ ok: true, signal: r.signal, rounds: r.rounds, minute: r.minute, lines: r.lines, ended: r.ended }, { headers: NO_STORE });
}
