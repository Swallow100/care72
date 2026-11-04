// 通話の往復（docs/tasks/T93.md の 2）の保存と API の中身。route（app/api/drill/[id]/talk）は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
//
// - 電話の手（本人電話・連絡先電話・119勧奨・見守依頼）で相手が出て言葉があったら、最初の言葉のあと 3 往復まで。1 往復は本人役 Haiku × 1 回で、
//   ケアマネの時計は 2 分進む（刻みは進めない。次の刻みは「進める」か次の手で）
// - ケアマネの言葉は決まった問い（TALK_ASKS）か自由の 1 文（60 字まで）。自由の文は口の中で仮名化の門を通し、伏せきれなければ 400「伏字不可」
//   （Claude にも保存にも何も渡さない）。メモ（T59）は渡さない
// - 返事の頼み事は world.asks に積む（at は返事の分）。色・4 問・聞いた安否は変えない
// - 保存: 手の記録の result.talk（drills.world の actions と drill_events の result の payload）。新しい kind を足さないので migration なし。
//   読んだ刻み・手の数・world の写しで門（lib/drill/db.ts の actDrill と同じ）。drills.world は読んだ JSON の要る欄だけ置き換える
//   （取消の写し・区切り・配役はそのまま。取消で手ごと戻すと往復と頼み事も消える）
// - 上限: 往復は counts.call に数える（T90 の 1 訓練 150）。上限・鍵なし・失敗は固定の言葉（AI の印なし）
// 断り方は http.ts と同じ（401・403・400・404・409）。終わった訓練・最新でない手・返事の無い手・出なかった電話・4 往復目は 409

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { PseudonymLeakError } from "../pseudonym/index.ts";
import { FREE_LABELS } from "./action-catalog.ts";
import { capReached, ZERO_COUNTS } from "./clock.ts";
import { drillScope, loadDrillRow, stateOfRow, type DrillScope } from "./db.ts";
import {
  canTalk,
  isTalkAsk,
  pushAsks,
  TALK_ASK_WORDS,
  TALK_FIXED_SPEECH,
  TALK_MINUTES,
  TALK_TEXT_MAX,
  TALK_UI,
  talkRounds,
  type TalkAsk,
  type TalkHook,
  type TalkLine,
} from "./dialogue.ts";
import { drillEnded, isNight, type ActionResult } from "./engine.ts";
import { drillError, isDrillId } from "./http.ts";

/** 往復の要求。ask（決まった問い）・text（自由の 1 文）・end（切る）のどれか 1 つ */
export type TalkRequest = { action: string } & ({ ask: TalkAsk } | { text: string } | { end: true });

export type TalkDrillResult =
  | { ok: true; action: string; rounds: number; minute: number }
  | { ok: false; error: "not_found" | "conflict" | "ended" | "closed" };

/**
 * 往復を 1 つ足す（か切る）。expected は画面で読んだ今の刻みと手の数（違えば競合）。手は最新の手だけ。
 * 自由の文を伏せきれなければ口が PseudonymLeakError を投げる（何も書かない）
 */
export async function talkDrill(
  db: D1Database,
  scope: Pick<DrillScope, "officeId">,
  id: string,
  expected: { step: number; actions: number },
  req: TalkRequest,
  opts: { hook?: TalkHook } = {},
): Promise<TalkDrillResult> {
  const row = await loadDrillRow(db, scope.officeId, id);
  if (!row) return { ok: false, error: "not_found" };
  const before = stateOfRow(row);
  if (drillEnded(before)) return { ok: false, error: "ended" };
  if (row.step !== expected.step || before.actions.length !== expected.actions) return { ok: false, error: "conflict" };
  const rec = before.actions.at(-1);
  if (!rec || rec.id !== req.action) return { ok: false, error: "conflict" };
  const r = rec.result;
  if (!rec.person || !rec.callee || !r || !canTalk(r)) return { ok: false, error: "closed" };
  const person = rec.person;

  let result: ActionResult;
  let world = before.world;
  let minute = before.minute;
  if ("end" in req) {
    result = { ...r, talkEnd: before.minute };
  } else {
    const at = before.minute;
    const replyAt = at + TALK_MINUTES;
    const ask = "ask" in req ? req.ask : undefined;
    const text = "text" in req ? req.text.trim() : undefined;
    // 1 訓練の上限（T90 の 150）に達したら Claude を呼ばない（固定の言葉）
    const reply =
      opts.hook && !capReached(world.counts)
        ? await opts.hook({
            person,
            callee: { kind: rec.callee, id: rec.target },
            minute: at,
            world,
            state: before.people[person] ?? null,
            tell: r.heard ?? null,
            ...(isNight(before) ? { night: true } : {}),
            first: r.speech,
            lines: r.talk ?? [],
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
    result = { ...r, talk: [...(r.talk ?? []), cm, them] };
    world = pushAsks(world, person, them.asks ?? [], replyAt);
    if (reply?.called) {
      const c = { ...ZERO_COUNTS, ...(world.counts ?? {}) };
      world = { ...world, counts: { ...c, call: c.call + 1 } };
    }
    minute = Math.max(minute, replyAt);
  }

  const actions = [...before.actions.slice(0, -1), { ...rec, result }];
  // 読んだ JSON の欄の並びと、知らない欄（取消の写し・区切り・配役）はそのまま
  const stored = JSON.parse(row.world) as Record<string, unknown>;
  const next = JSON.stringify({ ...stored, world, actions, minute });
  const [updated] = await db.batch([
    db
      .prepare(`UPDATE drills SET world = ?3 WHERE id = ?1 AND office_id = ?2 AND step = ?4 AND status = 'running' AND world = ?5`)
      .bind(id, scope.officeId, next, row.step, row.world),
    // 返事の payload も同じ取引で（drills を書けたときだけ。画面と採点は drill_events から作り直す）
    db
      .prepare(
        `UPDATE drill_events SET payload = ?1
          WHERE id = ?2 AND drill_id = ?3 AND kind = 'result' AND EXISTS (SELECT 1 FROM drills WHERE id = ?3 AND world = ?4)`,
      )
      .bind(JSON.stringify({ id: rec.id, ...result }), `${id}-${rec.id}-r`, id, next),
  ]);
  if ((updated.meta.changes ?? 0) === 0) return { ok: false, error: "conflict" };
  return { ok: true, action: rec.id, rounds: talkRounds(result), minute };
}

// ---------- API ----------

const NO_STORE = { "Cache-Control": "no-store" };
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const isStep = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1000;
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000;
const given = (v: unknown) => v !== undefined && v !== null;

/** 往復の要求の形を見る（ask・text・end のどれか 1 つ）。形が違えば null */
export function parseTalkRequest(b: Record<string, unknown>): TalkRequest | null {
  if (!isDrillId(b.action)) return null;
  if ([given(b.ask), given(b.text), given(b.end)].filter(Boolean).length !== 1) return null;
  if (given(b.ask)) return isTalkAsk(b.ask) ? { action: b.action, ask: b.ask } : null;
  if (given(b.end)) return b.end === true ? { action: b.action, end: true } : null;
  if (typeof b.text !== "string") return null;
  const text = b.text.trim();
  if (text === "" || [...text].length > TALK_TEXT_MAX) return null;
  return { action: b.action, text };
}

/**
 * 往復の POST（JSON）。{ step: 読んだ今の刻み, actions: 読んだ手の数, action: 手の番号（a3）, ask?: 決まった問い, text?: 自由の 1 文（60 字まで）, end?: true }。
 * 自由の文を伏せきれなければ 400（label「伏字不可」）。続けられない（最新でない手・出なかった電話・4 往復目・切った後）は 409（label「終話」）
 */
export async function talkPost(db: D1Database, p: Principal | null, id: string, json: unknown, opts: { hook?: TalkHook } = {}): Promise<Response> {
  if (!p) return drillError("login_required");
  const scope = drillScope(p);
  if (!scope) return drillError("forbidden");
  const b = obj(json);
  if (!isDrillId(id) || !b || !isStep(b.step) || !isCount(b.actions)) return drillError("invalid");
  const req = parseTalkRequest(b);
  if (!req) return drillError("invalid");
  let r: TalkDrillResult;
  try {
    r = await talkDrill(db, scope, id, { step: b.step, actions: b.actions }, req, opts);
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
  return Response.json({ ok: true, action: r.action, rounds: r.rounds, minute: r.minute }, { headers: NO_STORE });
}
