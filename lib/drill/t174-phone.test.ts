// T174: 本人が電話に出られない人（寝たきりで固定電話だけ・聞こえが困難・気管切開の記録）。誰が出るか・出ないかはコードが台帳で決める

import { describe, expect, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import { TALK_ASK_WORDS } from "./dialogue.ts";
import { createCallHook, createTalkHook } from "./hooks.ts";
import { phoneAnswerer, selfCanAnswer } from "./person-facts.ts";
import { buildPersona } from "./persona.ts";
import { EMPTY_WORLD } from "./scenarios.ts";

const seedInput = (id: string): PseudonymInput => {
  const p = SEED_PEOPLE.find((x) => x.person.id === id)!;
  return { person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks };
};
const sources = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p.person.id)] as const));
const load = async () => sources;

function fakeAi(speech = "妻は電話に出られません。私が代わりに聞きます。") {
  const sent: string[] = [];
  const client = {
    beta: {
      messages: {
        create: async (params: { messages: Array<{ content: unknown }> }) => {
          sent.push(String(params.messages[0].content));
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: "claude-haiku-5-5",
            content: [{ type: "text", text: JSON.stringify({ speech, asks: [] }), citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          };
        },
      },
    },
  } as unknown as ClaudeClient;
  const ai: AskJsonContext = {
    env: { ANTHROPIC_API_KEY: "dummy" },
    usage: { reserve: async () => true, finish: async () => undefined, countDay: async () => 0 },
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date("2026-11-05T01:00:00Z"),
    claude: client,
  };
  return { ai, sent };
}

const ask = (person: string, over: Record<string, unknown> = {}) =>
  ({ person, target: { kind: "self" }, pickup: "answers", hour: 2, world: EMPTY_WORLD, incidents: [], state: null, ...over }) as never;

describe("本人が電話に出られるか（台帳の事実）", () => {
  it("寝たきりで手元に電話が無い・聞こえが困難・気管切開の記録は出られない。手元に電話のある人・一部の聞こえ・認知症は出る", () => {
    expect(selfCanAnswer({ care: { bedridden: true }, basic: { contactMeans: { mobile: false, smartphone: "none" } } })).toBe(false);
    expect(selfCanAnswer({ care: { bedridden: true }, basic: { contactMeans: { mobile: true, smartphone: "none" } } })).toBe(true);
    expect(selfCanAnswer({ care: { bedridden: true }, basic: { contactMeans: { mobile: false, smartphone: "uses" } } })).toBe(true);
    expect(selfCanAnswer({ care: { hearing: "hard" } })).toBe(false);
    expect(selfCanAnswer({ care: { hearing: "some" } })).toBe(true);
    expect(selfCanAnswer({ medical: { devices: [{ detail: "気管切開" }] }, basic: { contactMeans: { mobile: true } } })).toBe(false);
    expect(selfCanAnswer({ medical: { devices: [{ detail: "鼻マスク" }] } })).toBe(true);
    expect(selfCanAnswer({})).toBe(true);
  });

  it("出られなければ同居の人、誰もいなければ null", () => {
    const cant = { care: { hearing: "hard" } };
    expect(phoneAnswerer(cant, ["夫", "娘"])).toBe("夫");
    expect(phoneAnswerer(cant, [])).toBeNull();
    expect(phoneAnswerer({}, ["夫"])).toBe("本人");
  });

  it("全部の人で、出る人は本人か、本人役の周りにいて話せる人か、誰も出ない", () => {
    for (const p of SEED_PEOPLE) {
      const persona = buildPersona(seedInput(p.person.id), { on: "2026-11-05" });
      expect(persona.phone === null || persona.phone === "本人" || persona.reporters.some((r) => r.role === persona.phone)).toBe(true);
      expect(persona.phone === "本人").toBe(selfCanAnswer(p.ledger));
    }
  });

  it("種の 2 人: 同居の夫がいる人は夫、一人暮らしの人は誰も出ない。説明の文にも書く", () => {
    const withHusband = buildPersona(seedInput("p-02"), { on: "2026-11-05" });
    expect(withHusband.phone).toBe("夫");
    expect(withHusband.profile.text).toContain("本人への電話には同居の夫が出る");
    const alone = buildPersona(seedInput("p-05"), { on: "2026-11-05" });
    expect(alone.phone).toBeNull();
    expect(alone.profile.text).toContain("本人への電話には誰も出ない");
    expect(buildPersona(seedInput("p-01"), { on: "2026-11-05" }).profile.text).not.toContain("本人は出られない");
  });
});

describe("本人への電話の口", () => {
  it("誰も出ない人は Claude を呼ばず呼び出し音だけ", async () => {
    const { ai, sent } = fakeAi();
    const r = await createCallHook({ load, ai })(ask("p-05"));
    expect(r).toMatchObject({ pickup: "no_answer", speech: null, called: false });
    expect(r.answeredBy).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("同居の人が代わりに出る。本人役に代わりと伝え、話し手を記録に残す", async () => {
    const { ai, sent } = fakeAi();
    const r = await createCallHook({ load, ai })(ask("p-02"));
    expect(r).toMatchObject({ pickup: "answers", ai: true, answeredBy: "夫" });
    expect(sent[0]).toContain("電話に出た人: 夫");
    expect(sent[0]).toContain("本人の言葉として話さない");
    expect(sent[0]).not.toContain("電話に出た人: 本人");
  });

  it("出られる人は今までどおり本人。話し手の記録は無い", async () => {
    const { ai, sent } = fakeAi("はい、家にいます。");
    const r = await createCallHook({ load, ai })(ask("p-01"));
    expect(r.answeredBy).toBeUndefined();
    expect(sent[0]).toContain("電話に出た人: 本人");
  });

  it("上限に達した訓練は呼ばないが、誰が出るかは同じ", async () => {
    const { ai, sent } = fakeAi();
    const world = { ...EMPTY_WORLD, counts: { director: 0, persona: 150, free: 0, call: 0 } };
    expect(await createCallHook({ load, ai })(ask("p-05", { world }))).toMatchObject({ pickup: "no_answer", called: false });
    expect(await createCallHook({ load, ai })(ask("p-02", { world }))).toMatchObject({ pickup: "answers", speech: null, answeredBy: "夫", called: false });
    expect(sent).toHaveLength(0);
  });

  it("往復も最初の言葉と同じ人が答える", async () => {
    const { ai, sent } = fakeAi("妻は横になっています。");
    const hook = createTalkHook({ load, ai });
    const r = await hook({ person: "p-02", callee: { kind: "self", id: null }, minute: 120, world: EMPTY_WORLD, state: null, tell: null, fit: null, first: "はい。", lines: [], actions: [], ask: "where" } as never);
    expect(r.called).toBe(true);
    expect(sent[0]).toContain("電話に出た人: 夫");
    expect(sent[0]).toContain(TALK_ASK_WORDS.where);
  });
});
