// 評価の台（docs/tasks/T108.md）の記録。1 回の訓練の出来事を、起きた順に JSON Lines で残す（あとから最初から読み直せる形）。
//
// - Claude への 1 回（askJson が通る ClaudeClient.beta.messages.create）を包み、役・モデル・effort・送った中身の全文（仮名化のあと）・
//   返ってきた中身の全文・かかった時間・token と費用・失敗と再試行を 1 行に
// - 世界の部屋（Managed Agents、RoomClient）も包み、刻みの文 1 つ（user.message）と、それに返った world_step を 1 行に
//   （部屋の token は残らないので費用は null）
// - 本物の client は SDK の再試行を止め（maxRetries 0）、ここで同じ回数だけ送り直して数える

import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync } from "node:fs";
import type { ClaudeClient, ClaudeRequestOptions } from "../../../lib/claude/client.ts";
import { MAX_RETRIES } from "../../../lib/claude/client.ts";
import type { RoomClient, RoomEvent } from "../../../lib/drill/world-room.ts";
import { costUsd } from "./prices.ts";
import { roleOfSystem, systemTexts, type Role } from "./roles.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

export type LogRecord = { seq: number; ms: number; type: string } & Record<string, unknown>;

/** 1 回の訓練の記録。file があれば 1 行ずつ足す（途中で落ちても残る） */
export type RunLog = {
  readonly records: LogRecord[];
  push(rec: { type: string } & Record<string, unknown>): LogRecord;
};

export function runLog(file?: string, clock: () => number = Date.now): RunLog {
  const start = clock();
  const records: LogRecord[] = [];
  return {
    records,
    push: (rec) => {
      const out = { seq: records.length + 1, ms: clock() - start, ...rec } as LogRecord;
      records.push(out);
      if (file) appendFileSync(file, `${JSON.stringify(out)}\n`, "utf8");
      return out;
    },
  };
}

/** AI の 1 回の記録（type ai） */
export type AiRecord = LogRecord & {
  type: "ai";
  role: Role;
  model: string;
  answeredModel: string | null;
  effort: string | null;
  maxTokens: number | null;
  sent: { system: string[]; user: string };
  returned: { stopReason: string | null; text: string; blocks: string[] } | null;
  took: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
  costUsd: number | null;
  retries: number;
  attempts: Array<{ took: number; error: string | null }>;
  error: string | null;
  /** 返った文が JSON として読めたか（形の検査は askJson の zod。ここは読めたかだけ） */
  parsed: boolean | null;
};

function userText(params: Params): string {
  return params.messages
    .map((m) => (typeof m.content === "string" ? m.content : (m.content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n")))
    .join("\n");
}

/** 失敗の名前（SDK の失敗は name が「Error」のままのことがあるので、型の名前を先に） */
function errorName(e: unknown): string {
  if (!(e instanceof Error)) return typeof e;
  const type = e.constructor?.name && e.constructor.name !== "Error" ? e.constructor.name : e.name;
  return e instanceof Anthropic.APIError && typeof e.status === "number" ? `${type} ${e.status}` : type;
}

/** SDK が送り直す失敗（つながらない・時間切れ・408・409・429・5xx） */
export function retryable(e: unknown): boolean {
  if (e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.APIError && typeof e.status === "number") return [408, 409, 429].includes(e.status) || e.status >= 500;
  return false;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Claude の client を包む。inner は偽か本物（本物は maxRetries 0 で作る）。送り直しの回数は要求の maxRetries（askJson が用途ごとに渡す）
 */
export function recordClaude(
  inner: ClaudeClient,
  log: RunLog,
  opts: { clock?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): ClaudeClient {
  const clock = opts.clock ?? Date.now;
  const sleep = opts.sleep ?? wait;
  return {
    beta: {
      messages: {
        create: async (params, options?: ClaudeRequestOptions) => {
          const role = roleOfSystem(params.system);
          const tries = 1 + (options?.maxRetries ?? MAX_RETRIES);
          const attempts: AiRecord["attempts"] = [];
          const t0 = clock();
          const base = {
            type: "ai" as const,
            role,
            model: params.model,
            effort: (params.output_config as { effort?: string } | undefined)?.effort ?? null,
            maxTokens: params.max_tokens ?? null,
            sent: { system: systemTexts(params.system), user: userText(params) },
          };
          for (let i = 0; i < tries; i++) {
            const a0 = clock();
            try {
              const m = await inner.beta.messages.create(params, { ...(options ?? {}), maxRetries: 0 });
              attempts.push({ took: clock() - a0, error: null });
              const text = m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
              const u = m.usage;
              const input = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
              let parsed: boolean;
              try {
                JSON.parse(text);
                parsed = true;
              } catch {
                parsed = false;
              }
              log.push({
                ...base,
                answeredModel: m.model,
                returned: { stopReason: m.stop_reason ?? null, text, blocks: m.content.map((b) => b.type) },
                took: clock() - t0,
                usage: { input, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
                costUsd: costUsd(m.model, input, u.output_tokens),
                retries: i,
                attempts,
                error: null,
                parsed,
              });
              return m;
            } catch (e) {
              attempts.push({ took: clock() - a0, error: errorName(e) });
              if (i + 1 < tries && retryable(e)) {
                await sleep(Math.min(8000, 500 * 2 ** i));
                continue;
              }
              log.push({ ...base, answeredModel: null, returned: null, took: clock() - t0, usage: null, costUsd: null, retries: i, attempts, error: errorName(e), parsed: null });
              throw e;
            }
          }
          throw new Error("ここには来ない");
        },
      },
    },
  };
}

/** 世界の部屋を包む。刻みの文 1 つ（user.message）ごとに、返った world_step と止まった理由を 1 行に。finish で開いている物を閉じる */
export function recordRoom(inner: RoomClient, log: RunLog, opts: { clock?: () => number } = {}): RoomClient & { finish(): void } {
  const clock = opts.clock ?? Date.now;
  const seen = new Set<string>();
  let agent: { model: string | null; effort: string | null } = { model: null, effort: null };
  let open: { sent: string; session: string; t0: number; tools: unknown[]; replies: string[] } | null = null;
  const close = (error: string | null, stop: string | null) => {
    if (!open) return;
    log.push({
      type: "ai",
      role: "world_room" satisfies Role,
      model: agent.model ?? "",
      answeredModel: agent.model,
      effort: agent.effort,
      maxTokens: null,
      sent: { system: [], user: open.sent },
      returned: { stopReason: stop, text: JSON.stringify(open.tools), blocks: open.tools.map(() => "world_step") },
      took: clock() - open.t0,
      usage: null,
      costUsd: null,
      retries: 0,
      attempts: [],
      error,
      parsed: open.tools.length > 0 ? true : null,
      session: open.session,
      toolReplies: open.replies,
    });
    open = null;
  };
  const agentRecord = (op: string, p: Record<string, unknown>) => {
    const model = p.model as { id?: string; effort?: string } | string | undefined;
    agent = typeof model === "string" ? { model, effort: null } : { model: model?.id ?? null, effort: model?.effort ?? null };
    log.push({ type: "room_agent", op, model: agent.model, effort: agent.effort, system: p.system ?? null, tools: p.tools ?? null });
  };
  return {
    agents: {
      create: async (p) => {
        agentRecord("create", p);
        return inner.agents.create(p);
      },
      update: async (id, p) => {
        agentRecord("update", p);
        return inner.agents.update(id, p);
      },
    },
    environments: { create: (p) => inner.environments.create(p) },
    sessions: {
      create: async (p) => {
        const s = await inner.sessions.create(p);
        log.push({ type: "room_session", session: s.id, params: p });
        return s;
      },
      send: async (id, events) => {
        for (const e of events) {
          if (e.type === "user.message") {
            close("no_answer", null);
            const text = ((e.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "") as string;
            open = { sent: text, session: id, t0: clock(), tools: [], replies: [] };
          } else if (e.type === "user.custom_tool_result" && open) {
            open.replies.push(((e.content as Array<{ text?: string }> | undefined)?.[0]?.text ?? "") as string);
          }
        }
        return inner.sessions.send(id, events);
      },
      list: async (id, after) => {
        const out: RoomEvent[] = await inner.sessions.list(id, after);
        for (const e of out) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (!open) continue;
          if (e.type === "agent.custom_tool_use") open.tools.push(e.input ?? null);
          else if (e.type === "session.error" || e.type === "session.status_terminated") close(e.type, null);
          else if (e.type === "session.status_idle" && e.stop_reason) close(open.tools.length > 0 ? null : "no_world_step", e.stop_reason.type);
        }
        return out;
      },
    },
    finish: () => close("unfinished", null),
  };
}
