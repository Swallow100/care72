// AI の呼び出しの記録（D1 の ai_calls）と、事業所ごとの 1 日の上限。
// 呼ぶ前に 1 行足し（上限の内のときだけ）、終わったら状態と token を書く。入れた物・返った物（本文）は残さない。
// 失敗した呼び出しも数える（つながらないまま何度も呼ぶと費用だけ出るため）。日は JST で数える。
// Claude（lib/claude/call.ts）と声（lib/gemini/tts.ts）が同じ上限を使う。

import type { D1Database } from "@cloudflare/workers-types";
import { todayJst } from "../age.ts";
import type { AiCallError, AiPurpose, OfficeKind } from "../db/types.ts";
import type { AiEnv } from "./client.ts";
import { AiLimitReached } from "./errors.ts";

/** 1 日の上限（回）の既定。デモ事業所だけ env の AI_DAILY_LIMIT で変えられる */
export const DEFAULT_DAILY_LIMIT = 200;

/** 事業所の 1 日の上限。AI_DAILY_LIMIT が 0 以上の整数でなければ既定のまま（0 ならその日は呼ばない） */
export function dailyLimit(office: { kind: OfficeKind }, env: Pick<AiEnv, "AI_DAILY_LIMIT">): number {
  if (office.kind !== "demo") return DEFAULT_DAILY_LIMIT;
  const raw = env.AI_DAILY_LIMIT?.trim();
  if (!raw || !/^[0-9]+$/.test(raw)) return DEFAULT_DAILY_LIMIT;
  return Number(raw);
}

export type NewAiCall = {
  id: string;
  officeId: string;
  purpose: AiPurpose;
  model: string;
  /** JST の日付 */
  day: string;
  startedAt: string;
};

export type AiCallDone = {
  status: "ok" | "failed";
  error: AiCallError | null;
  /** 答えたモデル */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  finishedAt: string;
};

/** ai_calls を読み書きする所。配信では D1、テストでは node:sqlite を同じ形で包む */
export interface UsageStore {
  /** その日のその事業所の行が limit 未満なら 1 行足して true。達していれば何もせず false（数えると足すを 1 つの文で） */
  reserve(call: NewAiCall, limit: number): Promise<boolean>;
  finish(id: string, done: AiCallDone): Promise<void>;
  countDay(officeId: string, day: string): Promise<number>;
}

const RESERVE_SQL = `INSERT INTO ai_calls (id, office_id, purpose, model, day, status, started_at)
SELECT ?1, ?2, ?3, ?4, ?5, 'pending', ?6
WHERE (SELECT COUNT(*) FROM ai_calls WHERE office_id = ?2 AND day = ?5) < ?7`;

const FINISH_SQL = `UPDATE ai_calls
SET status = ?2, error = ?3, model = ?4, input_tokens = ?5, output_tokens = ?6, finished_at = ?7
WHERE id = ?1`;

const COUNT_SQL = "SELECT COUNT(*) AS n FROM ai_calls WHERE office_id = ?1 AND day = ?2";

export function d1UsageStore(db: D1Database): UsageStore {
  return {
    async reserve(c, limit) {
      const r = await db
        .prepare(RESERVE_SQL)
        .bind(c.id, c.officeId, c.purpose, c.model, c.day, c.startedAt, limit)
        .run();
      return (r.meta.changes ?? 0) === 1;
    },
    async finish(id, d) {
      await db
        .prepare(FINISH_SQL)
        .bind(id, d.status, d.error, d.model, d.inputTokens, d.outputTokens, d.finishedAt)
        .run();
    },
    async countDay(officeId, day) {
      const row = await db.prepare(COUNT_SQL).bind(officeId, day).first<{ n: number }>();
      return row?.n ?? 0;
    },
  };
}

/** AI を呼ぶときに要る物。配信では lib/claude/cloudflare.ts の aiContextFor が作る */
export type AiContext = {
  /** 鍵と上限の値（Cloudflare の env。手元は .dev.vars） */
  env: AiEnv;
  usage: UsageStore;
  office: { id: string; kind: OfficeKind };
  /** 時刻の差し替え口（テスト） */
  now?: () => Date;
};

export type UsedTokens = { model: string; inputTokens: number | null; outputTokens: number | null };

export type UsageTicket = {
  id: string;
  day: string;
  ok(used: UsedTokens): Promise<void>;
  fail(error: AiCallError, used?: UsedTokens): Promise<void>;
};

function nowOf(ctx: AiContext): Date {
  return ctx.now?.() ?? new Date();
}

/**
 * 呼ぶ前に 1 行足す。上限に達していれば AiLimitReached（行は足さない）。
 * 終わりの書き込みに失敗しても、呼び出しの結果は捨てない（行は pending のまま残り、上限には数える）。
 */
export async function beginCall(ctx: AiContext, purpose: AiPurpose, model: string): Promise<UsageTicket> {
  const started = nowOf(ctx);
  const day = todayJst(started);
  const limit = dailyLimit(ctx.office, ctx.env);
  const id = `ai-${crypto.randomUUID()}`;
  const reserved = await ctx.usage.reserve(
    { id, officeId: ctx.office.id, purpose, model, day, startedAt: started.toISOString() },
    limit,
  );
  if (!reserved) throw new AiLimitReached(ctx.office.id, limit, day);

  const finish = async (done: Omit<AiCallDone, "finishedAt">) => {
    try {
      await ctx.usage.finish(id, { ...done, finishedAt: nowOf(ctx).toISOString() });
    } catch (e) {
      console.error("ai_calls の終わりを書けない", id, e instanceof Error ? e.name : typeof e);
    }
  };
  return {
    id,
    day,
    ok: (used) => finish({ status: "ok", error: null, ...used }),
    fail: (error, used) =>
      finish({
        status: "failed",
        error,
        model: used?.model ?? model,
        inputTokens: used?.inputTokens ?? null,
        outputTokens: used?.outputTokens ?? null,
      }),
  };
}

/** 今日（JST）に使った回数と上限。画面の「残り N 回」に */
export async function usageToday(ctx: AiContext): Promise<{ day: string; used: number; limit: number }> {
  const day = todayJst(nowOf(ctx));
  return { day, used: await ctx.usage.countDay(ctx.office.id, day), limit: dailyLimit(ctx.office, ctx.env) };
}
