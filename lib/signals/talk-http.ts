// 声の聞き取りの会話の API（app/api/signals/[id]/talk）の中身（docs/tasks/T137.md）。route は同じ所からの POST かを見て、ここの応答を返すだけ。
// D1・Principal・AI の文脈を引数で受け取る（テストで node:sqlite と偽の client を渡す）。
//
// 本人のスマホの役だけ（家族・ケアマネ・医療班・行政は 403、ログインなしは 401）。書けるのは自分が送った赤の信号だけ。平時は 409。
// 端末は 1 往復を聞くたびに会話の記録の全部を送る。ここで記録を信号に書き（後勝ち）、次の手（lib/signals/talk-ai.ts の nextTalk）を返す。
// Claude を呼ぶのは次の 1 文を聞くときだけで、本人の台帳から作った鍵で名前・住所・電話を伏せてから（仮名化の門）。

import type { D1Database } from "@cloudflare/workers-types";
import type { PersonBrief } from "../auth/scope.ts";
import type { Principal } from "../auth/principal.ts";
import type { AskJsonContext } from "../claude/call.ts";
import { loadDisasterState } from "../disaster/db.ts";
import { isDisaster } from "../disaster/state.ts";
import { pseudonymInputOf } from "../intake/extract.ts";
import { loadPersonRows } from "../person.ts";
import { pseudonymize, type PseudonymKey } from "../pseudonym/index.ts";
import { UUID } from "./body.ts";
import { personHasDevice } from "./family.ts";
import { signalError } from "./http.ts";
import { readAnswers } from "./questions.ts";
import { saveTalk, signalScope } from "./save.ts";
import { parseTalkLog } from "./talk.ts";
import { nextTalk } from "./talk-ai.ts";

const NO_STORE = { "Cache-Control": "no-store" };

/** 送られる本文の上限（字。会話の記録の JSON） */
export const TALK_BODY_MAX = 24_000;

export type TalkApiDeps = {
  /** Claude を呼ぶ文脈（事業所の 1 日の上限を数える）。呼ぶときだけ作る */
  ai: (officeId: string) => Promise<AskJsonContext>;
  /** 今（ミリ秒） */
  now: () => number;
  /**
   * AI の 1 文の声（Gemini TTS）を用意して URL を返す（lib/signals/voice.ts の talkLineVoice）。間に合わなければ null（端末の読み上げ）。
   * 無ければ声を作らない
   */
  voice?: (text: string, key: PseudonymKey) => Promise<string | null>;
};

/** 本人の台帳から、機器の有無と仮名化の鍵（台帳は Claude に渡さない） */
async function personForTalk(db: D1Database, officeId: string, personId: string): Promise<{ hasDevice: boolean; key: PseudonymKey } | null> {
  const brief = await db
    .prepare(
      `SELECT id, office_id, care_manager_id, name, kana, birth_date, plan_status, ledger
         FROM people WHERE id = ?1 AND office_id = ?2`,
    )
    .bind(personId, officeId)
    .first<PersonBrief>();
  const rows = brief ? await loadPersonRows(db, brief) : null;
  if (!rows) return null;
  return { hasDevice: personHasDevice(rows), key: pseudonymize([pseudonymInputOf(rows)]).key };
}

/**
 * 会話の POST（JSON { log }）。記録を書いて、次の手を返す: { ok, reply }（reply は talk-ai.ts の TalkReply）。
 * 本人が見つからない・鍵を作れないときも、決まった問いで続ける（Claude を呼ばない）
 */
export async function talkPost(db: D1Database, p: Principal | null, signalId: string, json: unknown, deps: TalkApiDeps): Promise<Response> {
  const scope = signalScope(p, "save");
  if (!scope) return signalError(p === null ? "login_required" : "forbidden");
  if (scope.writer.kind !== "self") return signalError("forbidden");
  if (!UUID.test(signalId)) return signalError("not_found");
  const raw = json && typeof json === "object" ? (json as { log?: unknown }).log : undefined;
  const log = parseTalkLog(raw);
  if (!log) return signalError("invalid");
  if (!isDisaster(await loadDisasterState(db, scope.officeId))) return signalError("normal");
  const saved = await saveTalk(db, scope, signalId, log);
  if (!saved.ok) return signalError(saved.error);

  const row = await db.prepare(`SELECT answers FROM signals WHERE id = ?1`).bind(signalId).first<{ answers: string | null }>();
  const person = await personForTalk(db, scope.officeId, scope.personId).catch(() => null);
  const officeId = scope.officeId;
  const reply = await nextTalk(
    log,
    { hasDevice: person?.hasDevice ?? false, answers: readAnswers(row?.answers), now: deps.now() },
    person ? { ctx: () => deps.ai(officeId), key: person.key } : null,
  );
  // AI の 1 文の声（決まった文の声は端末が id で頼む）
  if (reply.kind === "ask" && reply.line.by === "ai" && person && deps.voice) {
    const voice = await deps.voice(reply.line.text, person.key).catch(() => null);
    if (voice) reply.line = { ...reply.line, voice };
  }
  return Response.json({ ok: true, reply }, { headers: NO_STORE });
}
