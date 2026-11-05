// 声の聞き取りの会話（docs/tasks/T137.md）の、本人のスマホからサーバーへの道。会話の記録の全部を送り、次の手を受け取る。
// 送れない・断られた・形の違う返事は null（端末は決まった問いで続ける。会話の記録は録音を添えるときにも送る）。
// 端末に残して送り直すことはしない（本人が答えを待っているので、遅れて届いた次の手は使わない）。

import { DANGER_KINDS, isTalkTopic, TALK_ENDS } from "./talk.ts";
import type { TalkLine, TalkLog } from "./talk.ts";
import type { TalkReply } from "./talk-ai.ts";

export const talkPath = (signalId: string) => `/api/signals/${encodeURIComponent(signalId)}/talk`;

/** サーバーの返事を確かめる（読む文の長さ・知らない値） */
export function readTalkReply(v: unknown): TalkReply | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const called = r.called === true;
  if (r.kind === "buttons") return { kind: "buttons", called: false };
  if (r.kind === "danger") {
    return (DANGER_KINDS as readonly unknown[]).includes(r.danger) ? { kind: "danger", danger: r.danger as (typeof DANGER_KINDS)[number], called: false } : null;
  }
  if (r.kind === "close") {
    return (TALK_ENDS as readonly unknown[]).includes(r.end) ? { kind: "close", end: r.end as (typeof TALK_ENDS)[number], called } : null;
  }
  if (r.kind !== "ask" || !r.line || typeof r.line !== "object") return null;
  const l = r.line as Record<string, unknown>;
  if (typeof l.text !== "string" || !l.text.trim() || l.text.length > 80 || typeof l.question !== "string") return null;
  if (l.by !== "ai" && l.by !== "fixed") return null;
  if (l.topic !== "open" && !isTalkTopic(l.topic)) return null;
  if (l.easy !== null && typeof l.easy !== "string") return null;
  const line: TalkLine = { text: l.text, question: l.question, easy: (l.easy as string | null) ?? null, by: l.by, topic: l.topic as TalkLine["topic"] };
  return { kind: "ask", called, line };
}

export async function fetchTalk(signalId: string, log: TalkLog, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<TalkReply | null> {
  try {
    const res = await fetchImpl(talkPath(signalId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ log }),
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as { reply?: unknown } | null;
    return readTalkReply(json?.reply);
  } catch {
    return null;
  }
}
