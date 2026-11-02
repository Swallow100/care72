// 本人のスマホが送る信号の形（docs/tasks/T10.md）。端末とサーバーが同じ形を使う。
//
// - 本人の id と出どころ（本人）は送らない。サーバーがログインの役から決める（lib/signals/save.ts）
// - 信号の id は端末で作る（UUID）。通信が無いときに端末に残して送り直しても、同じ信号を 2 回入れない
// - 時刻は端末の時計で「起きた時刻」と「送った時刻」を送り、サーバーは差（送るまでの遅れ）だけを使う。
//   端末の時計が進んでいても、信号がルールの表で「まだ先の物」として外されないように

import * as z from "zod";
import { WHERE_NOW, type WhereNow } from "../db/types.ts";
import { RED_QUESTIONS, type RedQuestion } from "./phrases.ts";

/** 赤の 4 問の答え。null は答えていない（20 秒で音声に替わったときなど） */
export type RedAnswers = Record<RedQuestion, boolean | null>;

export const NO_ANSWERS: RedAnswers = { injured: null, atHome: null, canMove: null, hasMedicine: null };

/** 本人が押した色。未知は本人が送る物でない */
export type PhoneColor = "green" | "red";

export type SignalBody = {
  id: string;
  color: PhoneColor;
  /** 緑の 1 問の答え。赤は null */
  whereNow: WhereNow | null;
  /** 赤の 4 問の答え。緑は全部 null */
  answers: RedAnswers;
  /** 押した時刻（端末の時計、ISO 8601） */
  occurredAt: string;
  /** 送った時刻（端末の時計、ISO 8601）。送り直すたびに今にする */
  sentAt: string;
};

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const answer = z.boolean().nullable();
const iso = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "時刻");

/** 送る形。知らない欄（personId など）は読まずに捨てる */
export const SignalBodySchema = z
  .object({
    id: z.string().regex(UUID),
    color: z.enum(["green", "red"]),
    whereNow: z.enum(WHERE_NOW).nullable(),
    answers: z.object({ injured: answer, atHome: answer, canMove: answer, hasMedicine: answer }),
    occurredAt: iso,
    sentAt: iso,
  })
  .refine(
    (b) =>
      b.color === "green"
        ? b.whereNow !== null && RED_QUESTIONS.every((q) => b.answers[q] === null)
        : b.whereNow === null,
    "色と答えが合わない",
  );

/** 送るまでの遅れの上限（端末に残ったまま 72 時間を超えた物は、遅れを 72 時間とみなす） */
export const MAX_DELAY_MS = 72 * 3_600_000;

/**
 * 起きた時刻（サーバーの時計）。送るまでの遅れ（送った時刻 − 押した時刻）を今から引く。
 * 遅れが負（端末の時計が戻った）なら 0、上限を超えれば上限
 */
export function occurredAtOnServer(body: Pick<SignalBody, "occurredAt" | "sentAt">, now: string): string {
  const delay = Date.parse(body.sentAt) - Date.parse(body.occurredAt);
  const d = Number.isFinite(delay) ? Math.min(Math.max(delay, 0), MAX_DELAY_MS) : 0;
  return new Date(Date.parse(now) - d).toISOString();
}

/** 新しい信号の id。crypto.randomUUID が無い所（http の手元の端末）では getRandomValues で作る */
export function newSignalId(c: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** 0・1・null（表の列の形） */
export const bit = (v: boolean | null): 0 | 1 | null => (v === null ? null : v ? 1 : 0);
