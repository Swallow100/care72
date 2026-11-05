// 評価の台（T107）の数え直し（T133）。前の本物の回の呼び出しの記録（calls.jsonl）の返事を、同じ入力・段の順に返す client。
// 本物の API を呼ばずに、今のコードの読み取りの後の処理・台帳への保存・紙の置き方・数え方で、前の本物の答えを数え直す
// （T131 の進みの数え直しと同じ考えを台の形にした）。返事の中身は前の回の物なので、読み取りの決まり（Claude に渡す文）の直しの効き目は入らない。
// 記録の置き場は読むだけ（書かない）。

import type Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import type { AttemptHolder, CallRecord } from "./record.ts";
import { OPTION_AI_SYSTEM } from "../../../lib/forms/option-ai.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

/** 前の回の呼び出しの記録を読む（無ければ投げる） */
export function loadReplay(dir: string): CallRecord[] {
  const path = join(dir, "calls.jsonl");
  if (!existsSync(path)) throw new Error(`数え直す回に calls.jsonl が無い: ${dir}`);
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as CallRecord)
    .sort((a, b) => a.seq - b.seq);
}

/** 記録の返事の字から、考える分の印（[thinking] など。記録が content の種類を [ ] で残した物）を外す */
export function replayText(text: string): string {
  const body = text.replace(/^(?:\[(?:thinking|redacted_thinking)\])+/, "");
  // 様式の読み取りの答えの形に T131 で足した一覧の表（list）は、前の答えに無い。無い物は「表の無い頁」（null）と同じ
  try {
    const o = JSON.parse(body) as Record<string, unknown>;
    if (o && typeof o === "object" && Array.isArray(o.sections) && !("list" in o)) return JSON.stringify({ ...o, list: null });
  } catch {
    // 切れた答え（JSON の途中）はそのまま
  }
  return body;
}

export type ReplayClient = ClaudeClient & {
  /** 使われなかった記録の数（入力・段ごと） */
  left(): Record<string, number>;
  /** 前の回に選択肢と台帳の値の AI の当て（T140、lib/forms/option-ai.ts）の呼び出しがあるか */
  hasOptions(): boolean;
};

/**
 * 記録を返す client。scope は今の入力と段（記録の input・stage）。同じ入力・段の記録を順に 1 つずつ返す。
 * 記録が尽きた・失敗の記録（返事なし）は、前の回と同じく失敗にする
 */
export function replayClient(records: readonly CallRecord[], scope: () => { input: string; stage: string }, holder: AttemptHolder): ReplayClient {
  const queues = new Map<string, CallRecord[]>();
  for (const r of records) {
    const k = `${r.input}\u0000${r.stage}`;
    const q = queues.get(k) ?? [];
    q.push(r);
    queues.set(k, q);
  }
  const options = records.some((r) => r.request.system.some((t) => t.startsWith(OPTION_AI_SYSTEM.slice(0, 40))));
  return {
    hasOptions: () => options,
    left: () => Object.fromEntries([...queues].filter(([, q]) => q.length > 0).map(([k, q]) => [k.replace("\u0000", " "), q.length])),
    beta: {
      messages: {
        async create(params: Params) {
          const s = scope();
          const r = queues.get(`${s.input}\u0000${s.stage}`)?.shift();
          holder.current?.push({ n: 1, status: r?.response ? 200 : 500, ms: r?.durationMs ?? 0 });
          if (!r) throw new Error(`数え直しの記録が無い: ${s.input} ${s.stage}`);
          if (!r.response) throw new Error(r.error?.message ?? "前の回で返事が無かった");
          return {
            id: `msg_replay_${r.seq}`,
            type: "message",
            role: "assistant",
            model: r.response.model ?? params.model,
            content: [{ type: "text", text: replayText(r.response.text), citations: null }],
            stop_reason: r.response.stopReason ?? "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: r.response.usage,
          } as unknown as Message;
        },
      },
    },
  };
}
