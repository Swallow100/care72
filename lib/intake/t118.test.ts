// T118（docs/tasks/T118.md）の入れる欄の側: 伏せた物は全部戻し、戻せない伏せ字は出さず保存しない。和暦の生年月日は送らずに元の書き方に戻す。
// 入力の形は評価の台（T107、tools/eval/forms）が使った物を写した:
// - 写真・PDF の道: 台帳の避難先が空の人の書類から Claude が「市坪西小学校」を読む（仮名化と同じ置き換えで（町名）小学校になり、前は戻らなかった）
// - 写真・PDF の道: 台帳の避難先（仮名化して渡した「（町名）小学校」）を Claude がそのまま写す
// - 文の道: 書き起こしの頭の行に和暦の生年月日（「昭和17年4月18日生まれで」）
// 本物の API は呼ばない（偽の Claude）。人は種の架空の 10 人だけ。

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS, SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { toFormFile } from "../forms/form-read.ts";
import { warekiText } from "../forms/wareki.ts";
import type { PersonPageRows } from "../person.ts";
import { BIRTH_MARK, TOWN_MARK } from "../pseudonym/index.ts";
import { extractIntake } from "./extract.ts";
import { readIntake } from "./read.ts";
import { SaveRequestSchema } from "./save.ts";
import type { ExtractOutput } from "./schema.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const TODAY = "2026-11-05";
// T183 で種の避難先は実在の施設の名前（町名を含まない）にした。町名を含む避難先の伏せ字を戻す確かめなので、山田の避難先 1 を前の種の
// 町名の入った名前（実の事業所でも、本人の町名を含む避難先はこの形で渡る）にして使う
const P01: SeedPerson = withTownShelter(SEED_PEOPLE.find((p) => p.person.id === "p-01")!);
function withTownShelter(p: SeedPerson): SeedPerson {
  const { destination1Location: _, ...evacuation } = p.ledger.evacuation;
  return { ...p, ledger: { ...p.ledger, evacuation: { ...evacuation, destination1: "市坪西小学校" } } };
}

function rowsOf(p: SeedPerson, ledger = p.ledger): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

function fakeClaude(value: ExtractOutput, model = SONNET) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "msg_t118",
            type: "message",
            role: "assistant",
            model,
            content: [{ type: "text", text: JSON.stringify(value), citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 900, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          } as unknown as Message;
        },
      },
    },
  };
  return { client, calls };
}

function aiCtx(claude: ClaudeClient): AskJsonContext {
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  return { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(d1FromSqlite(db)), office: { id: "office-demo", kind: "demo" }, now: () => new Date("2026-11-05T03:00:00.000Z"), claude };
}

const EMPTY_OUT: ExtractOutput = { items: [], medications: [], devices: [], hazards: [], contacts: [], notes: [], unknowns: [] };

/** 黒塗りした写真（中身は見ない。形だけ） */
function photo() {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const f = toFormFile(jpeg);
  if (!f.ok) throw new Error("jpeg");
  return f.file;
}

describe("写真・PDF の道でも伏せた物を全部戻す（T118）", () => {
  it("T107 の形: 台帳の避難先が空の人の書類から読んだ「市坪西小学校」は、伏せ直したあと元の町名に戻る（伏せ字の印なし）", async () => {
    const ledger = structuredClone(P01.ledger);
    delete ledger.evacuation.destination1;
    delete ledger.evacuation.destination2;
    const out: ExtractOutput = { ...EMPTY_OUT, items: [{ field: "evacuation.destination1", value: "市坪西小学校" }] };
    const { client } = fakeClaude(out, OPUS);
    const p = await readIntake(rowsOf(P01, ledger), photo(), aiCtx(client), { today: TODAY });
    const d1 = p.items.find((x) => x.id === "field-evacuation.destination1")!;
    expect(d1).toMatchObject({ next: "市坪西小学校", state: "add", masked: false, change: { t: "field", value: "市坪西小学校" } });
    expect(p.dropped).toBe(0);
  });

  it("台帳の避難先（仮名化して渡した「（町名）小学校」）を写した返事は、台帳の元の言葉に戻る（上書きの提案にしない）", async () => {
    const out: ExtractOutput = { ...EMPTY_OUT, items: [{ field: "evacuation.destination1", value: "（町名）小学校" }] };
    const { client, calls } = fakeClaude(out, OPUS);
    const p = await readIntake(rowsOf(P01), photo(), aiCtx(client), { today: TODAY });
    expect(JSON.stringify(calls[0].messages)).toContain("（町名）小学校");
    const d1 = p.items.find((x) => x.id === "field-evacuation.destination1")!;
    expect(d1).toMatchObject({ current: "市坪西小学校", next: "市坪西小学校", state: "same", change: null, masked: false });
  });

  it("戻せない伏せ字（Claude が書類の塗った所を（町名）（氏名）と書いた物）が残る値は出さず、捨てた数に", async () => {
    const out: ExtractOutput = {
      ...EMPTY_OUT,
      items: [
        { field: "evacuation.destination2", value: "（町名）公民館" },
        { field: "basic.household", value: "alone" },
      ],
      // 台帳に無い種類の連絡先（新しく足す提案）の備考に伏せ字
      contacts: [{ kind: "visiting_nurse", relation: "", night: "yes", note: "（氏名）が鍵を持っている" }],
      notes: [`（氏名）さんが週 2 回来る。`, `${BIRTH_MARK}生まれ。`],
    };
    const { client } = fakeClaude(out, OPUS);
    const p = await readIntake(rowsOf(P01), photo(), aiCtx(client), { today: TODAY });
    for (const item of p.items) {
      expect(item.next, item.label).not.toMatch(/（(?:氏名|町名|電話|住所|郵便番号|メール|生年月日)）/);
      expect(item.masked).toBe(false);
    }
    expect(p.items.find((x) => x.id === "field-evacuation.destination2")).toBeUndefined();
    expect(p.items.some((x) => x.label === "特記")).toBe(false);
    expect(p.dropped).toBe(4);
  });
});

describe("文の道の和暦の生年月日（T118）", () => {
  const birth = warekiText(P01.person.birth_date!).replace(/ /g, "");
  const addr = P01.ledger.basic.address!;
  // T107 の書き起こし風の頭の行（tools/eval/forms/inputs.ts の voice）
  const TEXT = `えー、${P01.person.name}さん、${birth}生まれで、${addr.city}${addr.town}にお住まいです。電話は${P01.contacts[0].phone}。娘さんが毎晩来ます。`;

  it("送る文に生年月日（和暦）が残らず（生年月日）に。伏せ字の数に入る", async () => {
    const { client, calls } = fakeClaude(EMPTY_OUT);
    const p = await extractIntake(rowsOf(P01), TEXT, aiCtx(client), { today: TODAY });
    const sent = JSON.stringify(calls[0].messages);
    for (const s of [birth, "17年4月18日", P01.person.name, addr.town, P01.contacts[0].phone!]) expect(sent, s).not.toContain(s);
    expect(sent).toContain(BIRTH_MARK);
    expect(p.masked).toBeGreaterThanOrEqual(4);
  });

  it("Claude が写した伏せ字の文は、元の書き方（昭和17年4月18日）に戻る", async () => {
    const out: ExtractOutput = { ...EMPTY_OUT, notes: [`えー、A さん、${BIRTH_MARK}生まれで、松山市${TOWN_MARK}にお住まいです。`] };
    const { client } = fakeClaude(out);
    const p = await extractIntake(rowsOf(P01), TEXT, aiCtx(client), { today: TODAY });
    const note = p.items.find((x) => x.label === "特記")!;
    expect(note.next).toBe(`えー、${P01.person.name}さん、${birth}生まれで、${addr.city}${addr.town}にお住まいです。`);
    expect(note.masked).toBe(false);
  });
});

describe("保存の検査: Claude の分け方の保存に伏せ字を残さない（T118）", () => {
  const base = { personId: "p-01", version: 1, changes: [] as unknown[] };
  it("AI の保存で、どれかの値に伏せ字が残れば断る。手で直す保存は今まで通り", () => {
    const masked = [
      { t: "field", key: "evacuation.destination1", value: "（町名）小学校" },
      { t: "note", value: `${BIRTH_MARK}生まれ` },
      { t: "contact", id: null, value: { kind: "supporter", note: "（電話）に連絡" } },
      { t: "medication", value: { name: "薬", category: "other", storage: "（住所）の棚" } },
    ];
    for (const c of masked) {
      expect(SaveRequestSchema.safeParse({ ...base, ai: { model: SONNET }, changes: [c] }).success, JSON.stringify(c)).toBe(false);
    }
    expect(SaveRequestSchema.safeParse({ ...base, ai: { model: SONNET }, changes: [{ t: "field", key: "evacuation.destination1", value: "市坪西小学校" }] }).success).toBe(true);
    expect(SaveRequestSchema.safeParse({ ...base, ai: null, edit: true, changes: [{ t: "note", value: "（町名）小学校" }] }).success).toBe(true);
  });
});
