// 評価の台（T107）の記録。AI の呼び出し 1 つずつを、送る前の中身（仮名化の門を通った後）・返った中身・時間・トークン・費用・失敗と再試行で残す。
// - Claude の client（lib/claude/client.ts の ClaudeClient）と ai_calls の置き場（lib/claude/usage.ts の UsageStore）を包む。
//   askJson（lib/claude/call.ts）は reserve → create → finish の順に呼ぶので、入力ごとの包みの中で順に結び付ける（1 つの入力の呼び出しは直列）
// - 再試行: 本物は SDK の中で送り直すので、client に渡す fetch を包んで 1 回の送りごとに状態と時間を残す。偽の client は自分で同じ形を書く
// - 送る中身の漏れ: 種の 10 人の氏名・カナ・電話・町名・住所・生年月日の文字を、送る文（system と利用者の文）で探す。画像は塗った所が黒いかを
//   ブラウザの段（tools/eval/forms/browser.ts）で測った結果を持つ
// - 画像の中身（base64）は JSON Lines に書かず、ハッシュと大きさと、同じ回のフォルダに置いた画像のファイル名

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ClaudeClient, ClaudeRequestOptions } from "../../../lib/claude/client.ts";
import { MAX_RETRIES } from "../../../lib/claude/client.ts";
import type { AiCallDone, NewAiCall, UsageStore } from "../../../lib/claude/usage.ts";
import { warekiText } from "../../../lib/forms/wareki.ts";
import { SEED_PEOPLE } from "../../../seed/people.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 単価 ----------

/**
 * 1M トークンあたりの単価（USD）。Claude Code の skill claude-api の表（2026-10-06 時点）。Haiku 5.5 は 100K トークンまでの値。
 * ai_calls の input_tokens はキャッシュの書き込み・読み込みも足した数なので、全部を入力の単価で数える（上に寄った見積もり）
 */
export const PRICES_USD_PER_MTOK: Readonly<Record<string, { input: number; output: number }>> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
export const PRICES_AS_OF = "2026-10-06";

export function costUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  const p = PRICES_USD_PER_MTOK[model];
  if (!p || inputTokens == null || outputTokens == null) return null;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

// ---------- 漏れの検査 ----------

export type LeakKind = "name" | "kana" | "phone" | "town" | "birth" | "weak";
export const LEAK_KIND_LABELS: Record<LeakKind, string> = { name: "氏名", kana: "カナ", phone: "電話", town: "町名・住所", birth: "生年月日", weak: "姓・名だけ" };
export type LeakHit = { kind: LeakKind; word: string };

const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const digits = (s: string) => s.normalize("NFKC").replace(/[^0-9]/g, "");

type Banned = { kind: LeakKind; word: string };

/** 種の 10 人と連絡先から、送ってはいけない字の一覧 */
export function bannedWords(): Banned[] {
  const out: Banned[] = [];
  const add = (kind: LeakKind, w: string | null | undefined) => {
    const v = w ? squash(w) : "";
    if (v.length >= 2 && !out.some((b) => b.kind === kind && b.word === v)) out.push({ kind, word: v });
  };
  const weak = (full: string | null | undefined) => {
    for (const part of (full ?? "").split(/\s+/)) if (part.length >= 2) add("weak", part);
  };
  for (const p of SEED_PEOPLE) {
    add("name", p.person.name);
    add("kana", p.person.kana);
    weak(p.person.name);
    if (p.person.birth_date) {
      const [y, m, d] = p.person.birth_date.split("-").map(Number);
      add("birth", p.person.birth_date);
      add("birth", `${y}/${m}/${d}`);
      add("birth", `${y}年${m}月${d}日`);
      add("birth", warekiText(p.person.birth_date));
    }
    const a = p.ledger.basic.address;
    if (a) {
      add("town", a.town);
      add("town", a.town.replace(/町$/, ""));
    }
    for (const c of p.contacts) {
      if (c.phone) add("phone", c.phone);
      if (c.kind === "family" || c.kind === "supporter" || c.kind === "welfare_commissioner") {
        add("name", c.name);
        weak(c.name);
      } else add("name", c.name);
    }
  }
  return out;
}

const BANNED = bannedWords();
/** 電話らしい並び（数字・ハイフン・空白で 10 字以上） */
const PHONE_RUN = /[0-9０-９][0-9０-９\-‐－ー\s]{8,}[0-9０-９]/g;

export function scanLeaks(text: string): LeakHit[] {
  const flat = squash(text);
  const hits: LeakHit[] = [];
  for (const b of BANNED) {
    if (b.kind === "phone") continue;
    if (flat.includes(b.word)) hits.push({ kind: b.kind, word: b.word });
  }
  const runs = (text.normalize("NFKC").match(PHONE_RUN) ?? []).map(digits);
  for (const b of BANNED.filter((x) => x.kind === "phone")) {
    const d = digits(b.word);
    if (runs.some((r) => r.includes(d))) hits.push({ kind: "phone", word: b.word });
  }
  return hits;
}

// ---------- 記録の形 ----------

export type Attempt = { n: number; status: number | null; ms: number; error?: string; requestId?: string | null };

/** 再試行を書き込む所。包んだ client が呼ぶ前に current を空の配列にし、fetch（本物）か偽の client が足す */
export type AttemptHolder = { current: Attempt[] | null };

export type SentAttachment = { kind: "image" | "pdf"; mediaType: string; bytes: number; sha256: string; file: string };

export type CallRecord = {
  run: string;
  seq: number;
  input: string;
  stage: string;
  aiCallId: string | null;
  purpose: string | null;
  model: string;
  effort: string | null;
  maxTokens: number;
  timeoutMs: number | null;
  maxRetries: number | null;
  request: { system: string[]; userText: string; attachments: SentAttachment[]; fallback: boolean };
  response: { model: string; stopReason: string | null; text: string; usage: Message["usage"] } | null;
  startedAt: string;
  durationMs: number;
  attempts: Attempt[];
  /** ai_calls の終わりの行（status・error・トークン） */
  usage: { status: string; error: string | null; model: string; inputTokens: number | null; outputTokens: number | null } | null;
  costUsd: number | null;
  error: { name: string; message: string } | null;
  leaks: LeakHit[];
};

// ---------- JSON Lines ----------

export type Jsonl = { write(file: string, row: unknown): void; dir: string };

export function jsonl(dir: string): Jsonl {
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    write(file, row) {
      appendFileSync(join(dir, file), `${JSON.stringify(row)}\n`, "utf8");
    },
  };
}

/** 送った画像・PDF を回のフォルダに置く（同じ中身は 1 つ） */
function saveSent(dir: string, a: { data: string; ext: string }): { sha256: string; file: string; bytes: number } {
  const buf = Buffer.from(a.data, "base64");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const file = join("sent", `${sha256.slice(0, 16)}.${a.ext}`);
  const path = join(dir, file);
  if (!existsSync(path)) {
    mkdirSync(join(dir, "sent"), { recursive: true });
    writeFileSync(path, buf);
  }
  return { sha256, file: file.replace(/\\/g, "/"), bytes: buf.length };
}

function requestOf(params: Params, dir: string): CallRecord["request"] {
  const system = Array.isArray(params.system) ? params.system.map((b) => ("text" in b ? b.text : "")) : params.system ? [params.system] : [];
  const msg = params.messages[0];
  let userText = "";
  const attachments: SentAttachment[] = [];
  if (typeof msg?.content === "string") userText = msg.content;
  else
    for (const b of msg?.content ?? []) {
      if (b.type === "text") userText += b.text;
      else if (b.type === "image" && b.source.type === "base64") {
        const s = saveSent(dir, { data: b.source.data, ext: "jpg" });
        attachments.push({ kind: "image", mediaType: b.source.media_type, ...s });
      } else if (b.type === "document" && b.source.type === "base64") {
        const s = saveSent(dir, { data: b.source.data, ext: "pdf" });
        attachments.push({ kind: "pdf", mediaType: "application/pdf", ...s });
      }
    }
  return { system, userText, attachments, fallback: "fallbacks" in params };
}

export type Recorder = {
  client(inner: ClaudeClient): ClaudeClient;
  usage(inner: UsageStore): UsageStore;
  /** 入力・段の名前（呼び出しの記録に付ける）。入力ごとに設定する */
  scope(input: string, stage: string): void;
  holder: AttemptHolder;
  /** 書き終えた呼び出し（finish まで済んだ物）を JSON Lines に出し、返す */
  flush(): CallRecord[];
  all(): CallRecord[];
};

/** 呼び出しの記録。dir は回のフォルダ（送った画像もここ） */
export function recorder(o: { run: string; dir: string; log: Jsonl; now?: () => number }): Recorder {
  const now = o.now ?? (() => performance.now());
  const holder: AttemptHolder = { current: null };
  const records: CallRecord[] = [];
  const pendingIds: Array<{ id: string; purpose: string }> = [];
  let pendingFlush: CallRecord[] = [];
  let scope = { input: "", stage: "" };
  let seq = 0;
  return {
    holder,
    scope(input, stage) {
      scope = { input, stage };
    },
    usage(inner) {
      return {
        async reserve(call: NewAiCall, limit: number) {
          const ok = await inner.reserve(call, limit);
          if (ok) pendingIds.push({ id: call.id, purpose: call.purpose });
          return ok;
        },
        async finish(id: string, done: AiCallDone) {
          await inner.finish(id, done);
          const r = records.find((x) => x.aiCallId === id);
          if (r) {
            r.usage = { status: done.status, error: done.error, model: done.model, inputTokens: done.inputTokens, outputTokens: done.outputTokens };
            r.costUsd = costUsd(done.model, done.inputTokens, done.outputTokens);
          }
        },
        countDay: (officeId, day) => inner.countDay(officeId, day),
      };
    },
    client(inner) {
      return {
        beta: {
          messages: {
            async create(params: Params, options?: ClaudeRequestOptions) {
              const pending = pendingIds.shift() ?? null;
              const rec: CallRecord = {
                run: o.run,
                seq: ++seq,
                input: scope.input,
                stage: scope.stage,
                aiCallId: pending?.id ?? null,
                purpose: pending?.purpose ?? null,
                model: params.model,
                effort: (params.output_config as { effort?: string } | undefined)?.effort ?? null,
                maxTokens: params.max_tokens,
                timeoutMs: options?.timeout ?? null,
                maxRetries: options?.maxRetries ?? null,
                request: requestOf(params, o.dir),
                response: null,
                startedAt: new Date().toISOString(),
                durationMs: 0,
                attempts: [],
                usage: null,
                costUsd: null,
                error: null,
                leaks: [],
              };
              rec.leaks = scanLeaks([...rec.request.system, rec.request.userText].join("\n"));
              records.push(rec);
              pendingFlush.push(rec);
              holder.current = [];
              const t0 = now();
              try {
                const m = await inner.beta.messages.create(params, options);
                rec.response = {
                  model: m.model,
                  stopReason: m.stop_reason ?? null,
                  text: m.content.map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join(""),
                  usage: m.usage,
                };
                return m;
              } catch (e) {
                rec.error = { name: e instanceof Error ? e.name : typeof e, message: e instanceof Error ? e.message : String(e) };
                throw e;
              } finally {
                rec.durationMs = Math.round(now() - t0);
                rec.attempts = holder.current ?? [];
                holder.current = null;
              }
            },
          },
        },
      };
    },
    flush() {
      const out = pendingFlush;
      pendingFlush = [];
      for (const r of out) o.log.write("calls.jsonl", r);
      return out;
    },
    all: () => records,
  };
}

/** 本物の client。fetch を包んで、SDK の中の送り直しも 1 回ずつ記録する。鍵は呼ぶ側が環境変数から渡す（ファイルを探さない） */
export function realClient(apiKey: string, holder: AttemptHolder): ClaudeClient {
  const logged = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const n = (holder.current?.length ?? 0) + 1;
    const t0 = performance.now();
    try {
      const res = await fetch(input, init);
      holder.current?.push({ n, status: res.status, ms: Math.round(performance.now() - t0), requestId: res.headers.get("request-id") });
      return res;
    } catch (e) {
      holder.current?.push({ n, status: null, ms: Math.round(performance.now() - t0), error: e instanceof Error ? e.name : String(e) });
      throw e;
    }
  };
  return new Anthropic({ apiKey, maxRetries: MAX_RETRIES, fetch: logged });
}
