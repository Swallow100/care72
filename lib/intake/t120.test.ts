// T120（docs/tasks/T120.md）の入れる欄の側: 評価の 1 回目で見えた取り違え（移動手段・寝たきり・機器の中身・連絡先の補足・薬の置き場）を
// 欄の説明と決まりで減らす、4,000 字を超える書き起こしを分けて読む、HEIC の形を見分ける。正解の表（T107）の移動手段も T112 の形に直した。
// 本物の API は呼ばない（偽の Claude）。人は種の架空の 10 人だけ。

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import { factsOf } from "../../tools/eval/forms/inputs.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { isHeic, sniffKind } from "../forms/shrink-image.ts";
import type { PersonPageRows } from "../person.ts";
import { EXTRACT_RULES, extractIntake, fieldGuide, INTAKE_CHUNK_MAX, INTAKE_TEXT_MAX, mergeExtractOutputs, splitIntakeText } from "./extract.ts";
import type { ExtractOutput } from "./schema.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const TODAY = "2026-11-05";
const P01 = SEED_PEOPLE.find((p) => p.person.id === "p-01")!;
const EMPTY: ExtractOutput = { items: [], medications: [], devices: [], hazards: [], contacts: [], notes: [], unknowns: [] };

function rowsOf(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

function aiCtx(answer: (params: Params, n: number) => ExtractOutput): { ctx: AskJsonContext; calls: Params[] } {
  const calls: Params[] = [];
  const claude: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "msg_t120",
            type: "message",
            role: "assistant",
            model: SONNET,
            content: [{ type: "text", text: JSON.stringify(answer(params, calls.length)), citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 900, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          } as unknown as Message;
        },
      },
    },
  };
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  return { calls, ctx: { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(d1FromSqlite(db)), office: { id: "office-demo", kind: "demo" }, now: () => new Date("2026-11-05T03:00:00.000Z"), claude } };
}

const sentText = (p: Params) => (JSON.parse(p.messages[0].content as string) as { 入力: { text: string } }).入力.text;

describe("欄の説明と決まり（評価の 1 回目の取り違え）", () => {
  it("移動手段は選ぶ欄と補記の両方、選んだ言葉と同じなら補記なし。連絡先の note に入れない", () => {
    const g = fieldGuide();
    expect(g).toContain("移動手段が書かれていればいつもこれを選ぶ");
    expect(g).toContain("evacuation.transportKind と両方に入れる");
    expect(g).toContain("連絡先の note に入れない");
  });

  it("「ほぼ寝たきり」も寝たきり（true）で、特記に回さない", () => {
    expect(fieldGuide()).toContain("「ほぼ寝たきり」");
    expect(EXTRACT_RULES).toContain("寝たきり（「ほぼ寝たきり」も true）は care.bedridden");
  });

  it("機器の中身に種類の名前を重ねない。薬全体の置き場は特記。連絡先の続柄は家族と支援者だけ、補足に名前・伏せ字・夜間を書かない", () => {
    expect(EXTRACT_RULES).toContain("detail に種類の名前（在宅酸素・人工呼吸器・吸引など）を重ねず");
    expect(EXTRACT_RULES).toContain("どの薬か書かれていない薬全体の置き場（「薬は 2 階の箪笥」）は、薬に足さず notes に 1 文のまま写す");
    expect(EXTRACT_RULES).toContain("relation（続柄）は家族（family）と支援者（supporter）だけに書く");
    expect(EXTRACT_RULES).toContain("役割名の「支援者 1」は名前の代わりで、続柄ではない");
    expect(EXTRACT_RULES).toContain("夜間に来られるか（night に）");
  });

  it("正解の表（評価の台）の移動手段は、選ぶ欄（台帳の文字からの読み替え）と補記。選んだ言葉と同じ「徒歩」は選ぶ欄だけ", () => {
    const of = (id: string) => factsOf(SEED_PEOPLE.find((p) => p.person.id === id)!).find((f) => f.id === "evacuation.transport")!.piece.items;
    expect(of("p-01")).toEqual([
      { field: "evacuation.transportKind", value: "family_car" },
      { field: "evacuation.transport", value: "娘の車" },
    ]);
    const walker = SEED_PEOPLE.find((p) => p.ledger.evacuation.transport === "徒歩")!;
    expect(of(walker.person.id)).toEqual([{ field: "evacuation.transportKind", value: "foot" }]);
  });
});

describe("長い書き起こしを分けて読む", () => {
  const sentence = (i: number) => `${i} 回目の訪問で、歩くときは見守りが要ると聞いた。`;
  const long = (n: number) => Array.from({ length: n }, (_, i) => sentence(i)).join("");

  it("文の切れ目で 4,000 字までの塊に分ける。つなぐと元の文、文の途中で切らない", () => {
    const t = long(400);
    expect(t.length).toBeGreaterThan(INTAKE_CHUNK_MAX * 2);
    const chunks = splitIntakeText(t);
    expect(chunks.length).toBe(Math.ceil(t.length / INTAKE_CHUNK_MAX));
    expect(chunks.every((c) => c.length <= INTAKE_CHUNK_MAX)).toBe(true);
    expect(chunks.every((c) => c.endsWith("。"))).toBe(true);
    expect(chunks.join("")).toBe(t);
    expect(splitIntakeText("短い文。")).toEqual(["短い文。"]);
    expect(splitIntakeText("  ")).toEqual([]);
    // 切れ目の無い長い文だけ字で切る
    expect(splitIntakeText("あ".repeat(INTAKE_CHUNK_MAX + 10)).map((c) => c.length)).toEqual([INTAKE_CHUNK_MAX, 10]);
    expect(INTAKE_TEXT_MAX).toBe(INTAKE_CHUNK_MAX * 3);
  });

  it("塊ごとの分け方をまとめる: 同じ物は 1 つ、機器は種類・薬は名前・連絡先は種類と続柄で、空いた所を後の塊で埋める", () => {
    const a: ExtractOutput = {
      ...EMPTY,
      items: [{ field: "care.walking", value: "some" }],
      devices: [{ kind: "oxygen", detail: "", schedule: "常時" }],
      medications: [{ name: "ワーファリン", category: "anticoagulant", schedule: "1日1回", amount: "", storage: "" }],
      contacts: [{ kind: "family", relation: "娘", night: "unknown", note: "" }],
      notes: ["ほぼ寝たきり。"],
    };
    const b: ExtractOutput = {
      ...EMPTY,
      items: [{ field: "care.walking", value: "some" }, { field: "care.bedridden", value: "true" }],
      devices: [{ kind: "oxygen", detail: "酸素濃縮器", schedule: "" }],
      medications: [{ name: "ワーファリン ", category: "anticoagulant", schedule: "", amount: "1錠", storage: "" }],
      contacts: [{ kind: "family", relation: "娘", night: "yes", note: "車あり" }],
      notes: ["ほぼ寝たきり。"],
    };
    const m = mergeExtractOutputs([a, b]);
    expect(m.items).toEqual([
      { field: "care.walking", value: "some" },
      { field: "care.bedridden", value: "true" },
    ]);
    expect(m.devices).toEqual([{ kind: "oxygen", detail: "酸素濃縮器", schedule: "常時" }]);
    expect(m.medications).toEqual([{ name: "ワーファリン", category: "anticoagulant", schedule: "1日1回", amount: "1錠", storage: "" }]);
    expect(m.contacts).toEqual([{ kind: "family", relation: "娘", night: "yes", note: "車あり" }]);
    expect(m.notes).toEqual(["ほぼ寝たきり。"]);
  });

  it("8,000 字の書き起こしは 2 回呼び、どの塊も仮名化の門を通る（氏名・電話を送らない）。分け方をまとめて差分に", async () => {
    const head = `${P01.person.name}さん、電話は${P01.contacts.find((c) => c.kind === "self")?.phone ?? "090-0000-0001"}。`;
    const text = head + long(170) + "ほぼ寝たきり。";
    expect(text.length).toBeGreaterThan(INTAKE_CHUNK_MAX);
    expect(text.length).toBeLessThanOrEqual(INTAKE_TEXT_MAX);
    const { ctx, calls } = aiCtx((_p, n) => (n === 1 ? { ...EMPTY, items: [{ field: "care.walking", value: "some" }] } : { ...EMPTY, items: [{ field: "care.bedridden", value: "true" }] }));
    const p = await extractIntake(rowsOf(P01), text, ctx, { today: TODAY, concurrency: 1 });
    expect(calls).toHaveLength(splitIntakeText(text).length);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      const sent = sentText(c);
      expect(sent.length).toBeLessThanOrEqual(INTAKE_CHUNK_MAX);
      expect(sent).not.toContain(P01.person.name);
      expect(sent).not.toMatch(/090-0000-00\d\d/);
    }
    // 2 つの塊の分け方が 1 つの差分に（差分の行の id は欄ごと）
    const ids = p.items.map((i) => i.id);
    expect(ids).toContain("field-care.walking");
    expect(ids).toContain("field-care.bedridden");
  });

  it("4,000 字までは今までどおり 1 回", async () => {
    const { ctx, calls } = aiCtx(() => EMPTY);
    await extractIntake(rowsOf(P01), long(20), ctx, { today: TODAY });
    expect(calls).toHaveLength(1);
  });
});

describe("HEIC の形を見分ける（ブラウザで描ければ JPEG に直す）", () => {
  const box = (brand: string) => new Uint8Array([0, 0, 0, 0x18, ..."ftyp".split("").map((c) => c.charCodeAt(0)), ...brand.split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
  it("ftyp の後ろの種類が heic・heix・mif1 などなら HEIC。JPEG・PNG・PDF は今までどおり", () => {
    for (const b of ["heic", "heix", "mif1", "msf1"]) {
      expect(isHeic(box(b))).toBe(true);
      expect(sniffKind(box(b))).toBe("heic");
    }
    expect(isHeic(box("isom"))).toBe(false);
    expect(sniffKind(box("isom"))).toBeNull();
    expect(sniffKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe("jpeg");
    expect(isHeic(new Uint8Array([0, 0, 0]))).toBe(false);
  });
});
