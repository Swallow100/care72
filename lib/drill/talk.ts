// 通話の往復（docs/tasks/T93.md の 2）の保存と API の中身。route（app/api/drill/[id]/talk）は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。
//
// - 電話の手（本人電話・連絡先電話・119勧奨・見守依頼）で相手が出て言葉があったら、最初の言葉のあと 8 往復まで（T155 で 3 から）。1 往復は本人役 Haiku × 1 回で、
//   ケアマネの時計は文の長さで 1〜3 分進む（T155、lib/drill/talk-turn.ts。刻みは進めない。次の刻みは「進める」か次の手で）
// - 往復の 1 回の作り方（想定の門・頼み事・数え・時計）は掛かってきた電話と同じ所（lib/drill/talk-turn.ts の talkRound）
// - ケアマネの言葉は決まった問い（TALK_ASKS）か自由の 1 文（120 字まで。声で入れた文は voice の印）。自由の文は口の中で仮名化の門を通し、伏せきれなければ 400「伏字不可」
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
import { clockOver } from "./action-terms.ts";
import { clampClock } from "./actions.ts";
import { capReached } from "./clock.ts";
import { drillScope, loadDrillRow, stateOfRow, type DrillScope } from "./db.ts";
import { canTalk, isTalkAsk, TALK_TEXT_MAX, TALK_UI, talkRounds, type TalkAsk, type TalkHook, type TalkLine } from "./dialogue.ts";
import { drillEnded, fitOf, timeOf, withoutMemo, type ActionResult } from "./engine.ts";
import { fitKindOf } from "./fit.ts";
import { drillError, isDrillId } from "./http.ts";
import { talkRound } from "./talk-turn.ts";

/** 往復の要求。ask（決まった問い）・text（自由の 1 文）・end（切る）のどれか 1 つ */
export type TalkRequest = { action: string } & ({ ask: TalkAsk } | { text: string; voice?: true } | { end: true });

export type TalkDrillResult =
  | { ok: true; action: string; rounds: number; minute: number; lines: TalkLine[]; ended: boolean }
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
  // 切るのは 8 往復に届いたあとも（切った時刻を残す。T155）。往復を足すのは続けられる間だけ
  const open = "end" in req ? r?.status === "connected" && r.speech !== null && r.talkEnd === undefined : canTalk(r);
  if (!rec.person || !rec.callee || !r || !open) return { ok: false, error: "closed" };
  // 連続の時計が 72 時間に着いた後は往復を足さない（T123。切るのはよい。区切りは「進める」が作って終わる）
  if (!("end" in req) && clockOver(before)) return { ok: false, error: "closed" };
  const person = rec.person;

  let result: ActionResult;
  let world = before.world;
  let minute = before.minute;
  if ("end" in req) {
    result = { ...r, talkEnd: before.minute };
  } else {
    const at = before.minute;
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
            fit: fitKindOf(before, world),
            ...timeOf(before),
            first: r.speech,
            lines: r.talk ?? [],
            actions: withoutMemo(before.actions.filter((a) => a.person === person)),
            ...(ask ? { ask } : { text: text ?? "" }),
          })
        : null;
    // 往復の 1 回（想定の門・頼み事・数え・時計。掛かってきた電話と同じ所）
    const round = talkRound({
      world,
      person,
      at,
      ...(ask ? { ask } : { text: text ?? "", ...("voice" in req && req.voice ? { voice: true } : {}) }),
      reply,
      fit: fitOf(before, world),
    });
    world = round.world;
    result = { ...r, talk: [...(r.talk ?? []), round.cm, round.them] };
    // 連続の時計は 72 時間で止める（T123）
    minute = clampClock(before, Math.max(minute, round.replyAt));
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
  return { ok: true, action: rec.id, rounds: talkRounds(result), minute, lines: result.talk ?? [], ended: "end" in req };
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
  // 声の印（T155）は自由の文にだけ付く。true のほかは断る
  if (given(b.voice) && (b.voice !== true || !given(b.text))) return null;
  if (given(b.ask)) return isTalkAsk(b.ask) ? { action: b.action, ask: b.ask } : null;
  if (given(b.end)) return b.end === true ? { action: b.action, end: true } : null;
  if (typeof b.text !== "string") return null;
  const text = b.text.trim();
  if (text === "" || [...text].length > TALK_TEXT_MAX) return null;
  return { action: b.action, text, ...(b.voice === true ? { voice: true as const } : {}) };
}

/**
 * 往復の POST（JSON）。{ step: 読んだ今の刻み, actions: 読んだ手の数, action: 手の番号（a3）, ask?: 決まった問い, text?: 自由の 1 文（120 字まで）, voice?: true（声で入れた文）, end?: true }。
 * 返すのは往復の全部の行（T155。通話の画面が読み直さずに描ける）。
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
  return Response.json({ ok: true, action: r.action, rounds: r.rounds, minute: r.minute, lines: r.lines, ended: r.ended }, { headers: NO_STORE });
}
