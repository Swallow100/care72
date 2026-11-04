// 評価の台（T107）の偽の client（本物の API を呼ばない）。呼ぶ前に台が「この呼び出しの正解」を積み、偽の client はそれを返す。
// - gold: 正解のまま返す（台の数え方が正しければ、外れ 0 になる。テストで確かめる）
// - noisy（既定）: 正解を決まった種で崩して返す（欄を落とす・項目を外す・場所をずらす・台帳に無い項目名・分け方の取りこぼし・値の取り違え）。
//   決まった入力で、送り直し（1 回目が 529）と形の違う返事（JSON でない）も起こし、失敗と再試行の数え方を通す
// 偽の回の数は台の確かめ用で、AI の力ではない（md と index.html に「偽」と出す）。

import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient, ClaudeRequestOptions } from "../../../lib/claude/client.ts";
import { HAIKU } from "../../../lib/claude/models.ts";
import { LEDGER_ITEMS, type ReadResult } from "../../../lib/forms/mapping.ts";
import { intakeField } from "../../../lib/intake/fields.ts";
import type { ExtractOutput } from "../../../lib/intake/schema.ts";
import { hashSeed, rng } from "./inputs.ts";
import type { AttemptHolder } from "./record.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

export type FakeStyle = "gold" | "noisy";

export type Expected = { kind: "read"; answer: ReadResult } | { kind: "extract"; answer: ExtractOutput };

export type FakeClient = ClaudeClient & {
  /** 次の呼び出しの正解。seed は崩し方の種（入力の id と送る単位） */
  expect(e: Expected, seed: string): void;
};

/** 台帳に無い項目名（偽の崩し方で 1 欄に入れ、checkReadResult が弾くのを数える） */
export const FAKE_UNKNOWN_ITEM = "person.nickname";

function message(model: string, text: string, params: Params): Message {
  const userChars = JSON.stringify(params.messages).length;
  const images = JSON.stringify(params.messages).match(/"type":"(image|document)"/g)?.length ?? 0;
  return {
    id: `msg_fake_${hashSeed(text).toString(16)}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    // トークンは字数から見積もる（偽）。画像 1 枚 1,600
    usage: { input_tokens: Math.ceil(Math.min(userChars, 20000) / 1.6) + 1200 + images * 1600, output_tokens: Math.ceil(text.length / 1.6), cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

/** 様式の読み取りの崩し方 */
export function noisyRead(r: ReadResult, seed: string): ReadResult {
  const rand = rng(hashSeed(`read:${seed}`));
  const keys = LEDGER_ITEMS.map((i) => i.key as string);
  const groupOf = new Map<string, string>(LEDGER_ITEMS.map((i) => [i.key as string, i.group]));
  let rejectedDone = false;
  const fields: ReadResult["fields"] = [];
  r.fields.forEach((f, i) => {
    const u = rand();
    const u2 = rand();
    if (u < 0.05) return; // 欄の読み落とし
    let item = f.item;
    if (item && u < 0.12) item = null; // 項目の取りこぼし
    else if (item && u < 0.17) {
      // 同じ区分の別の項目（外れ）
      const same = keys.filter((k) => k !== item && groupOf.get(k) === groupOf.get(item!));
      item = same[Math.floor(rand() * same.length)] ?? null;
    } else if (!rejectedDone && item && i >= 3) {
      item = FAKE_UNKNOWN_ITEM;
      rejectedDone = true;
    }
    const box = f.box && u2 < 0.12 ? { ...f.box, y: Math.min(0.97, f.box.y + 0.03) } : f.box;
    fields.push({ ...f, item, box, confidence: item === f.item ? "high" : "medium", reason: item === f.item ? "欄の名前と中身が合う" : "近い項目" });
  });
  // 余分な欄（様式に無い）
  fields.push({ page: 1, section: "", label: "備考", position: "1頁 下", shape: "lines", options: [], item: "notes.other", confidence: "low", reason: "推測", box: { x: 0.1, y: 0.95, w: 0.5, h: 0.02 }, option_boxes: [] });
  return { ...r, fields };
}

/** 入れる欄の分け方の崩し方 */
export function noisyExtract(o: ExtractOutput, seed: string): ExtractOutput {
  const rand = rng(hashSeed(`extract:${seed}`));
  const items = o.items
    .filter(() => rand() >= 0.1)
    .map((it) => {
      const f = intakeField(it.field);
      if (f && f.shape.type === "enum" && rand() < 0.08) {
        const other = f.shape.options.find((x) => x.value !== it.value);
        if (other) return { ...it, value: other.value };
      }
      return it;
    });
  return {
    items,
    medications: o.medications.filter(() => rand() >= 0.15),
    devices: o.devices.filter(() => rand() >= 0.1),
    hazards: o.hazards,
    contacts: o.contacts.map((c) => (rand() < 0.2 ? { ...c, night: c.night === "yes" ? "unknown" : c.night } : c)),
    notes: o.notes.filter(() => rand() >= 0.3),
    unknowns: o.unknowns.filter(() => rand() >= 0.3),
  };
}

export function fakeClient(style: FakeStyle, holder: AttemptHolder): FakeClient {
  const queue: Array<{ e: Expected; seed: string }> = [];
  return {
    expect(e, seed) {
      queue.push({ e, seed });
    },
    beta: {
      messages: {
        async create(params: Params, options?: ClaudeRequestOptions) {
          const next = queue.shift();
          if (!next) throw new Error("偽の client に正解が積まれていない");
          const { e, seed } = next;
          const model = params.model ?? HAIKU;
          const h = hashSeed(`fail:${seed}`);
          const noisy = style === "noisy";
          // 送り直し（1 回目が混雑の 529、2 回目で返る）。SDK の再試行の数（maxRetries）の中
          if (noisy && h % 11 === 0 && (options?.maxRetries ?? 1) >= 1) {
            holder.current?.push({ n: 1, status: 529, ms: 40, error: "overloaded_error" });
          }
          holder.current?.push({ n: (holder.current?.length ?? 0) + 1, status: 200, ms: 120 });
          // 形の違う返事（askJson が AiBadOutput の not_json にする）
          if (noisy && h % 17 === 0) return message(model, "読み取れませんでした", params);
          const answer = e.kind === "read" ? (noisy ? noisyRead(e.answer, seed) : e.answer) : noisy ? noisyExtract(e.answer, seed) : e.answer;
          return message(model, JSON.stringify(answer), params);
        },
      },
    },
  };
}
