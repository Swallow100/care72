// T88: 入れる欄の提案が台帳を壊さない。伏せた町名の入った施設名（避難先 1）を上書きの提案にしない、
// 続柄＋名前を「娘の娘」にして新しい連絡先を足させない。本物の API は呼ばない（偽の Claude）。

import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { PersonPageRows } from "../person.ts";
import { extractIntake } from "./extract.ts";
import type { ExtractOutput } from "./schema.ts";

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const TODAY = "2026-11-04";
const p01 = SEED_PEOPLE.find((p) => p.person.id === "p-01")!;

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

function fakeClaude(value: ExtractOutput) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: SONNET,
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
  return { env: { ANTHROPIC_API_KEY: "dummy" }, usage: d1UsageStore(d1FromSqlite(db)), office: { id: "office-demo", kind: "demo" }, now: () => new Date("2026-11-04T03:00:00.000Z"), claude };
}

const TEXT = "避難先は かわなぎ小学校。娘の森 恵子さん（090-0000-0011）が市内にいて車がある。隣の田中さんが鍵を持っている。2 次避難先は かわなぎ公民館";

/** Claude が入力と今の台帳（仮名化済み）の言葉のまま写した分け方 */
const OUTPUT: ExtractOutput = {
  items: [
    { field: "evacuation.destination1", value: "（町名）小学校" },
    { field: "evacuation.destination2", value: "（町名）公民館" },
  ],
  medications: [],
  devices: [],
  hazards: [],
  contacts: [{ kind: "family", relation: "娘", night: "unknown", note: "市内にいて車がある" }],
  notes: ["隣の（氏名）が鍵を持っている。"],
  unknowns: [],
};

describe("入れる欄の提案が台帳を壊さない（T88）", () => {
  it("Claude に渡る文は「娘の娘」にならず、町名・名前・電話は伏せたまま", async () => {
    const { client, calls } = fakeClaude(OUTPUT);
    await extractIntake(rowsOf(p01), TEXT, aiCtx(client), { today: TODAY });
    const sent = JSON.stringify(calls[0].messages);
    expect(sent).toContain("娘（（電話））が市内にいて車がある");
    expect(sent).not.toContain("娘の娘");
    for (const s of ["かわなぎ", "森 恵子", "恵子", "田中", "090-0000-0011"]) expect(sent, s).not.toContain(s);
    // 今の台帳の避難先も（町名）小学校で渡る
    expect(sent).toContain("（町名）小学校");
  });

  it("避難先 1 は今の台帳と同じ（上書きの提案にしない）。2 は入れた文の元の言葉に戻る", async () => {
    const { client } = fakeClaude(OUTPUT);
    const p = await extractIntake(rowsOf(p01), TEXT, aiCtx(client), { today: TODAY });
    const d1 = p.items.find((x) => x.id === "field-evacuation.destination1")!;
    expect(d1).toMatchObject({ current: "かわなぎ小学校", next: "かわなぎ小学校", state: "same", change: null, masked: false });
    const d2 = p.items.find((x) => x.id === "field-evacuation.destination2")!;
    expect(d2).toMatchObject({ next: "かわなぎ公民館", masked: false });
  });

  it("娘は今の連絡先の行に当たり、新しい連絡先を足す提案にしない。特記は元の文", async () => {
    const { client } = fakeClaude(OUTPUT);
    const p = await extractIntake(rowsOf(p01), TEXT, aiCtx(client), { today: TODAY });
    const contacts = p.items.filter((x) => x.id.startsWith("contact-"));
    expect(contacts).toHaveLength(1);
    expect(contacts[0].change).not.toMatchObject({ t: "contact", id: null });
    if (contacts[0].change?.t === "contact") expect(contacts[0].change.id).toBe("c-01-1");
    const note = p.items.find((x) => x.id === "note-0")!;
    expect(note).toMatchObject({ next: "隣の田中さんが鍵を持っている。", masked: false });
  });
});
