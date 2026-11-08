// T122（docs/tasks/T122.md の 3）の入れる欄の側: Claude の返事で伏せ字の括弧が崩れた値（評価の 2 回目で自由文の避難先が「(町名)総合病院」で
// 返り、戻しも捨てもされずに台帳に入った）も元の言葉に戻し、戻せない物は出さず保存しない（T118 の決まりを全部の形に）。
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
import type { PersonPageRows } from "../person.ts";
import { hasAnyMark } from "../pseudonym/index.ts";
import { extractIntake } from "./extract.ts";
import { readIntake } from "./read.ts";
import type { ExtractOutput } from "./schema.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;

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

function fakeClaude(value: ExtractOutput, model = SONNET): ClaudeClient {
  return {
    beta: {
      messages: {
        create: async () =>
          ({
            id: "msg_t122",
            type: "message",
            role: "assistant",
            model,
            content: [{ type: "text", text: JSON.stringify(value), citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 900, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }) as unknown as Message,
      },
    },
  };
}

function aiCtx(claude: ClaudeClient): AskJsonContext {
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  return { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(d1FromSqlite(db)), office: { id: "office-demo", kind: "demo" }, now: () => new Date("2026-11-05T03:00:00.000Z"), claude };
}

const EMPTY_OUT: ExtractOutput = { items: [], medications: [], devices: [], hazards: [], contacts: [], notes: [], unknowns: [] };

function photo() {
  const f = toFormFile(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]));
  if (!f.ok) throw new Error("jpeg");
  return f.file;
}

/** 評価の 2 回目の形（半角の括弧）と、括弧の落ちた形・別の括弧・片方だけ・空き */
const BROKEN = ["(町名)総合病院", "町名総合病院", "【町名】総合病院", "［町名］総合病院", "（ 町名 ）総合病院", "（町名)総合病院", "町名）総合病院", "〔町名〕総合病院"];

describe("文の道: 崩れた町名の伏せ字を元の言葉に戻す（T122）", () => {
  // 評価の台の自由文の形（避難先の行）。台帳の避難先 2 は空
  const TEXT = "・避難先2：市坪西総合病院\n・移動手段：家族の車";

  for (const v of BROKEN) {
    it(`「${v}」は「市坪西総合病院」に戻る`, async () => {
      const out: ExtractOutput = { ...EMPTY_OUT, items: [{ field: "evacuation.destination2", value: v }] };
      const p = await extractIntake(rowsOf(P01), TEXT, aiCtx(fakeClaude(out)), { today: TODAY });
      const d2 = p.items.find((x) => x.id === "field-evacuation.destination2");
      expect(d2).toMatchObject({ next: "市坪西総合病院", state: "add", change: { t: "field", value: "市坪西総合病院" } });
      expect(p.dropped).toBe(0);
    });
  }

  it("戻せない崩れた形（元の文に無い町名の施設・作った名前・電話）は出さず、捨てた数に", async () => {
    const out: ExtractOutput = {
      ...EMPTY_OUT,
      items: [
        { field: "evacuation.destination2", value: "(町名)公民館" },
        { field: "evacuation.barriers", value: "町名の坂が急" },
      ],
      contacts: [{ kind: "visiting_nurse", relation: "", night: "yes", note: "【氏名】が鍵を持っている" }],
      notes: ["(電話)に夜かける。"],
    };
    const p = await extractIntake(rowsOf(P01), TEXT, aiCtx(fakeClaude(out)), { today: TODAY });
    for (const item of p.items) expect(hasAnyMark(item.next), item.label).toBe(false);
    expect(p.items.find((x) => x.id === "field-evacuation.destination2")).toBeUndefined();
    expect(p.dropped).toBe(4);
  });

  it("ケアマネが自分で書いた形（「連絡(電話)」）は伏せ字でない。特記に残る", async () => {
    const text = "娘への連絡(電話)は夜だけ。";
    const out: ExtractOutput = { ...EMPTY_OUT, notes: [text] };
    const p = await extractIntake(rowsOf(P01), text, aiCtx(fakeClaude(out)), { today: TODAY });
    expect(p.items.find((x) => x.label === "特記")).toMatchObject({ next: text });
    expect(p.dropped).toBe(0);
  });
});

describe("写真・PDF の道: 崩れた伏せ字（T122）", () => {
  it("台帳の避難先を崩した形で写した返事は、台帳の元の言葉に戻る（上書きの提案にしない）", async () => {
    for (const v of ["(町名)小学校", "町名小学校", "【町名】小学校"]) {
      const out: ExtractOutput = { ...EMPTY_OUT, items: [{ field: "evacuation.destination1", value: v }] };
      const p = await readIntake(rowsOf(P01), photo(), aiCtx(fakeClaude(out, OPUS)), { today: TODAY });
      expect(p.items.find((x) => x.id === "field-evacuation.destination1"), v).toMatchObject({ next: "市坪西小学校", state: "same", change: null });
    }
  });

  it("書類の塗った所を崩した形で書いた返事は、戻せないので出さない", async () => {
    const out: ExtractOutput = { ...EMPTY_OUT, items: [{ field: "evacuation.destination2", value: "(町名)総合病院" }], notes: ["[氏名]さんが週 2 回来る。"] };
    const p = await readIntake(rowsOf(P01), photo(), aiCtx(fakeClaude(out, OPUS)), { today: TODAY });
    expect(p.items.find((x) => x.id === "field-evacuation.destination2")).toBeUndefined();
    expect(p.items.some((x) => x.label === "特記")).toBe(false);
    expect(p.dropped).toBe(2);
  });
});
