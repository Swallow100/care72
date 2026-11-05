// T129 訓練の自由対応を、分かる・筋の通る形に（docs/tasks/T129.md）のテスト。
// 本物の API は呼ばない（偽の client・偽の口が決まった答えを返す）。手元の D1 は node:sqlite と種の 10 人。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionItem } from "../../components/drill/ActionLog.tsx";
import { FreePlanLine } from "../../components/drill/ActionPanel.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction } from "../db/types.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { buildActLog } from "./act-log.ts";
import { FREE_LABELS, FREE_IDLE_MINUTES } from "./action-catalog.ts";
import { TERM_LABELS } from "./action-terms.ts";
import { act, type ActTarget } from "./actions.ts";
import { drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { advance, initialState, type ActionRecord, type DrillState } from "./engine.ts";
import {
  createFreeHook,
  drillFreeHook,
  freeChoices,
  planFree,
  plainWords,
  readingOf,
  resolveFree,
  type FreeAsk,
  type FreeHook,
  type FreeReply,
} from "./free-action.ts";
import { situationText, whereOf } from "./free-situation.ts";
import { actionPost, freePost, planView } from "./http.ts";
import { EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { reachedAt } from "./score.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: OPUS,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 600, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(answer: (p: Params) => unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(answer(params));
        },
      },
    },
  };
  return { client, calls };
}

/** 送った入力（手の一覧と事実） */
type Sent = { 文: { text: string }; 手: { 一覧: Array<{ id: string; 今: string; 相手: Array<{ 区分: string }> }> }; 事実: { text: string } };
function sentOf(p: Params): Sent {
  const user = p.messages.find((m) => m.role === "user")!;
  const text = typeof user.content === "string" ? user.content : (user.content as Array<{ type: string; text?: string }>).map((b) => b.text ?? "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(json) as Sent;
}

// ---------- 種の 10 人と D1 ----------

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;
const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const seedOf = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const careManager = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
const SCOPE = drillScope(careManager())!;
/** 日本の 10 時に発災（昼） */
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t129";
const TERMS = { clock: true as const, terms: true as const };

async function start() {
  expect(await startDrill(db, SCOPE, "earthquake", START, {}, () => ID, TERMS)).toEqual({ ok: true, id: ID });
}
async function stored(): Promise<DrillState> {
  return stateOfRow((await loadDrillRow(db, DEMO.id, ID))!);
}
function patchWorld(f: (w: WorldState) => WorldState) {
  const row = sqlite.prepare("SELECT world FROM drills WHERE id = ?").get(ID) as { world: string };
  const raw = JSON.parse(row.world) as { world: WorldState };
  raw.world = f({ ...EMPTY_WORLD, ...raw.world });
  sqlite.prepare("UPDATE drills SET world = ? WHERE id = ?").run(JSON.stringify(raw), ID);
}

const target = (id: string, kind: ActTarget["kind"], label: string, hasPhone = true): ActTarget => ({ id, kind, label, hasPhone });
const SELF_01 = target("c-01-0", "self", "本人");
const DAUGHTER_01 = target("c-01-1", "family", "家族 娘");
const NEIGHBOR_01 = target("c-01-2", "supporter", "支援者 隣人");
/** 手の確かめに使う架空の連絡先（全部の区分を 1 人に。名前と番号は持たない） */
const ALL_01: ActTarget[] = [
  SELF_01,
  DAUGHTER_01,
  NEIGHBOR_01,
  target("c-t-ph", "pharmacy", "薬局"),
  target("c-t-pw", "power_company", "電力会社"),
  target("c-t-cs", "care_service", "介護事業所"),
];

/** 連続の時計と決まりの表の訓練を 0 分まで（エンジンだけ） */
async function clockAt0(): Promise<DrillState> {
  const init = initialState("earthquake", PARTICIPANTS, START, TERMS);
  return (await advance(init, 0, {}, { policy: "clock" }))!.state;
}

/** 内部の名前（英字の id）らしい語 */
const INNER = /[A-Za-z0-9]*_[A-Za-z0-9_]*|\b(?:free|note|none|phone|visit|desk|advise|self|family)\b/;

// ---------- 偽の口（状況に合わせて答える） ----------

/** 文の意図 → 手（偽の口の決め。本物の Opus の代わり） */
const INTENTS: ReadonlyArray<[RegExp, DrillAction | "free" | "none"]> = [
  [/119|救急/, "advise_119"],
  [/薬/, "arrange_medicine"],
  [/電源|発電機/, "arrange_power"],
  [/移送|病院へ連れて/, "arrange_transport"],
  [/避難する/, "evacuate_self"],
  [/娘|家族に/, "call_contact"],
  [/記録/, "none"],
  [/何もしない|様子を見る/, "none"],
  [/近所の人/, "free"],
];

/**
 * 状況に合わせて答える偽の口: 候補の一覧の「今」を読んで、できない手は can false・理由・別の道。理由には内部の名前を書く
 * （画面で手の名前に置き換わるか、出ないかを確かめるため）
 */
const situational: FreeHook = async (ask: FreeAsk): Promise<FreeReply> => {
  const kind = INTENTS.find(([re]) => re.test(ask.text))?.[1] ?? "none";
  const choice = ask.choices.find((c) => c.id === kind);
  const can = choice ? choice.why === null : !/通話不可/.test(ask.facts) || kind !== "free";
  return {
    stored: ask.text,
    reading: {
      kind,
      callee: choice?.callees[0] ?? "",
      text: "対応した",
      reason: `${kind} に当たる（free ではない）`,
      ...(kind === "free" ? { way: "desk" as const, minutes: 10, effect: "arrival" as const, outcome: "近所の人が向かった" } : {}),
      can,
      whyNot: can ? null : (choice?.why ?? "不可"),
      alt: can ? null : "近所の人に知らせに走ってもらう",
    },
  };
};

// ---------- 1. 内部の名前 ----------

describe("画面に出る文に内部の名前を出さない", () => {
  it("手・相手・やり方の id は手の名前・言い方に、英字の id らしい語が残れば出さない。大文字の略語と短い単位は残す", () => {
    expect(plainWords("119連絡に当たるが、一覧にadvise_119が無いためfreeの電話とした")).toBe("119連絡に当たるが、一覧に119勧奨が無いため自由対応の電話とした");
    expect(plainWords("family に call_contact")).toBe("家族 に 連絡先電話");
    expect(plainWords("callTarget を使う")).toBeNull();
    expect(plainWords("foo_bar")).toBeNull();
    expect(plainWords("AED の場所を 1 km 先で確かめる")).toBe("AED の場所を 1 km 先で確かめる");
  });

  it("返事の理由・1 文・できない理由・別の道・起きたことの全部で（仮名は氏名に、英字は手の名前に）", () => {
    const r = readingOf(
      {
        kind: "advise_119",
        callee: "self",
        text: "advise_119 を勧めた",
        reason: "A さんは advise_119 に当たるが free とした",
        whyNot: "phone 不可",
        alt: "supporter に頼む",
        outcome: "visit した",
      },
      ALL_KEY,
    );
    for (const v of [r.text, r.reason, r.whyNot, r.alt, r.outcome]) expect(v ?? "", String(v)).not.toMatch(INNER);
    expect(r.reason).toContain("119勧奨");
    expect(r.alt).toBe("支援者 に頼む");
  });
});

// ---------- 2. 候補と読み替えの筋 ----------

describe("候補には全部の手を、今できるかと一緒に", () => {
  it("本人を選ばないと本人の要る手は「対象なし」で残る。記録の手は候補に入れない", () => {
    const list = freeChoices(null, []);
    expect(list.find((c) => c.id === "advise_119")).toMatchObject({ why: FREE_LABELS.noPerson });
    expect(list.find((c) => c.id === "report_city")).toMatchObject({ why: null });
    expect(list.map((c) => c.id)).not.toContain("note");
    expect(list.map((c) => c.id)).not.toContain("free");
  });

  it("決まりの表の押せない理由を手ごと・相手ごとに（通話不可）", async () => {
    const s = await clockAt0();
    const down = { ...s, world: { ...s.world, phone: "down" as const } };
    const plan = await planFree({ ...down, participants: down.participants }, { text: "119 に連絡", person: "p-01", contacts: ALL_01 }, async (ask) => {
      expect(ask.choices.find((c) => c.id === "advise_119")?.why).toBe(TERM_LABELS.noCall);
      expect(ask.choices.find((c) => c.id === "visit")?.why).toBeNull();
      return { stored: ask.text, reading: null };
    });
    expect(plan.as).toBe("advise_119");
  });

  it("119 の文は本人を選ばなくても記録に落とさず、119勧奨のまま「対象なし」", () => {
    expect(resolveFree(null, { text: "119", person: null, contacts: [] })).toEqual({ as: "advise_119", target: null, block: FREE_LABELS.noPerson });
    expect(resolveFree({ kind: "free", callee: "", way: "phone", minutes: 5 }, { text: "危険なので119", person: null, contacts: [] })).toMatchObject({
      as: "advise_119",
      block: FREE_LABELS.noPerson,
    });
  });

  it("何もしない文・読み替えの無い文は「変化なし」（記録でない）。相手の区分が違うだけなら台帳から選ぶ", () => {
    const ctx = { text: "様子を見る", person: "p-01", contacts: ALL_01 };
    expect(resolveFree(null, ctx)).toMatchObject({ as: null, own: { idle: true, minutes: FREE_IDLE_MINUTES } });
    expect(resolveFree({ kind: "none", callee: "" }, ctx)).toMatchObject({ as: null, own: { idle: true } });
    expect(resolveFree({ kind: "note", callee: "" }, ctx)).toMatchObject({ as: null, own: { idle: true } });
    expect(resolveFree({ kind: "ask_check", callee: "pharmacy" }, ctx)).toEqual({ as: "ask_check", target: DAUGHTER_01 });
    expect(resolveFree({ kind: "arrange_dialysis", callee: "" }, ctx)).toEqual({ as: "arrange_dialysis", target: null, block: FREE_LABELS.noCallee });
  });
});

describe("同じ型の文で全部の手を、電話が使える時と使えない時で", () => {
  const CASES: ReadonlyArray<{ text: string; as: DrillAction | null; idle?: true; blockedWhenDown: boolean }> = [
    { text: "危険な状態なので 119", as: "advise_119", blockedWhenDown: true },
    { text: "薬局に薬を届けてもらう", as: "arrange_medicine", blockedWhenDown: true },
    { text: "電力会社に電源を頼む", as: "arrange_power", blockedWhenDown: true },
    { text: "移送を頼む", as: "arrange_transport", blockedWhenDown: true },
    { text: "自分も避難する", as: "evacuate_self", blockedWhenDown: false },
    { text: "娘さんに電話する", as: "call_contact", blockedWhenDown: true },
    { text: "経過を記録だけする", as: null, idle: true, blockedWhenDown: false },
    { text: "今は何もしない", as: null, idle: true, blockedWhenDown: false },
  ];
  for (const phone of ["ok", "down"] as const) {
    for (const c of CASES) {
      it(`電話 ${phone}: ${c.text}`, async () => {
        const s = await clockAt0();
        const st = { ...s, world: { ...s.world, phone } };
        const plan = await planFree({ ...st, participants: st.participants }, { text: c.text, person: "p-01", contacts: ALL_01 }, situational);
        expect(plan.as).toBe(c.as);
        expect(plan.idle === true).toBe(c.idle === true);
        const blocked = phone === "down" && c.blockedWhenDown;
        expect(plan.block).toBe(blocked ? TERM_LABELS.noCall : null);
        // できない手はその手のまま「できない」と、今できる別の道を返す
        expect(plan.alt === null).toBe(!blocked);
        // 画面に出す物に内部の名前が出ない
        const view = planView(plan);
        for (const v of [view.label, view.reason, view.words, view.alt, view.block]) expect(v ?? "").not.toMatch(INNER);
        if (c.idle) expect(view.label).toBe(FREE_LABELS.idle);
      });
    }
  }

  it("決まりの表で押せない手は、別の道が AI に無くても決まりの言葉で（訪問先にいれば、その場でできること）", async () => {
    let s = await clockAt0();
    s = { ...s, world: { ...s.world, phone: "down" } };
    const visitHome: ActionRecord = {
      ...({} as ActionRecord),
      id: "a1",
      kind: "visit",
      person: "p-01",
      as: undefined,
      result: { ok: true, status: "arrived" } as ActionRecord["result"],
    } as ActionRecord;
    const noAlt: FreeHook = async (ask) => ({ stored: ask.text, reading: { kind: "advise_119", callee: "self", text: null, reason: null, can: false } });
    const atOffice = await planFree({ ...s, participants: s.participants }, { text: "119", person: "p-01", contacts: ALL_01 }, noAlt);
    const atHome = await planFree({ ...s, actions: [visitHome], participants: s.participants }, { text: "119", person: "p-01", contacts: ALL_01 }, noAlt);
    expect(atOffice).toMatchObject({ block: TERM_LABELS.noCall, altAi: false });
    expect(atHome).toMatchObject({ block: TERM_LABELS.noCall, altAi: false });
    expect(atHome.alt).toContain("その場");
    expect(atOffice.alt).not.toContain("その場");
  });
});

// ---------- 3. 状況（今いる所・通信・本人の分かっている事） ----------

describe("AI に今の状況を渡す", () => {
  it("今いる所は打った手から（訪問で着いた家・引き返した訪問は事業所・自分の避難）", () => {
    const r = (status: string, ok = true) => ({ ok, status }) as ActionRecord["result"];
    expect(whereOf([])).toEqual({ kind: "office" });
    expect(whereOf([{ kind: "visit", person: "p-01", result: r("arrived") }])).toEqual({ kind: "home", person: "p-01" });
    expect(whereOf([{ kind: "visit", person: "p-01", result: r("arrived") }, { kind: "visit", person: "p-02", result: r("turnedBack", false) }])).toEqual({ kind: "office" });
    expect(whereOf([{ kind: "visit", person: "p-01", result: r("arrived") }, { kind: "visit", person: "p-02", result: r("blocked", false) }])).toEqual({ kind: "home", person: "p-01" });
    expect(whereOf([{ kind: "evacuate_self", person: null, result: r("evacuated") }])).toEqual({ kind: "shelter" });
    expect(whereOf([{ kind: "free", way: "visit", person: "p-03", result: r("done") }])).toEqual({ kind: "home", person: "p-03" });
  });

  it("状況の文: 時刻と夜・今いる所・電話・停電・道・職員・本人の最後の連絡。名前・町名は書かない", async () => {
    const s = await clockAt0();
    const world: WorldState = { ...s.world, phone: "down", outage: { area: { scope: "office" }, since: 0, restoredAt: null }, roads: [{ id: "r", label: "かわなぎ町の市道", open: false, person: "p-01" }] };
    const text = situationText({ ...s, world, minute: 600, actions: [{ kind: "visit", person: "p-01", result: { ok: true, status: "arrived" } } as ActionRecord] }, "p-01");
    expect(text).toContain("今いる所: 訪問先（対象の本人の家）");
    expect(text).toContain("電話: 通話不可");
    expect(text).toContain("停電: 続いている（10 時間、事業所を含む）");
    expect(text).toContain("対象の本人の家の前の道: 通行止");
    expect(text).toContain("20 時台、夜で暗い");
    expect(text).not.toContain("かわなぎ");
    expect(findLeaks(text, ALL_KEY)).toEqual([]);
  });
});

// ---------- 4. 名前を書いた文・打った文のまま（D1 を通す） ----------

/** 偽の Claude: 送った手の一覧の 119勧奨の「今」を読んで、できない理由と別の道を返す。理由には内部の名前を書く */
function situationalClient() {
  return fake((p) => {
    const sent = sentOf(p);
    const row = sent.手.一覧.find((c) => c.id === "advise_119");
    const can = row?.今 === "可";
    return {
      kind: "free",
      callee: "",
      way: "phone",
      minutes: 5,
      can,
      whyNot: can ? "" : (row?.今.replace(/^不可（|）$/g, "") ?? ""),
      alt: can ? "" : "近所の人に消防署へ知らせに走ってもらう",
      effect: "none",
      text: "119 への連絡を勧めた",
      outcome: "",
      reason: "119連絡に当たるが、一覧にadvise_119が無いためfreeの電話とした",
    };
  });
}

describe("訪問先で本人を選ばずに名前と 119 を書いた文", () => {
  it("名前から対象を決め、119勧奨のまま通話不可で「できない」と別の道。理由に内部の名前なし。内容は打った文のまま", async () => {
    await start();
    // 訪問で家に着く（roll 0）
    const visited = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "visit", person: "p-01", target: null }, START, { roll: () => 0 });
    expect(visited.status).toBe(200);
    expect((await stored()).actions[0].result?.status).toBe("arrived");
    patchWorld((w) => ({ ...w, phone: "down" }));
    const s = await stored();
    const { client, calls } = situationalClient();
    const free = drillFreeHook({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) })!;
    // 台帳の名前の空きを抜いた形と、名をひらがなにした形（仮名化で姓だけが当たる形）
    for (const name of [seedOf("p-01").person.name.replace(/\s+/g, ""), "山田はな"]) {
      const text = `${name}さんは危険な状態のため119`;
      const read = await freePost(
        db,
        careManager(),
        ID,
        { step: s.step, actions: s.actions.length, person: null, text },
        (st, input) => planFree({ ...st, participants: st.participants }, input, free),
      );
      expect(read.status).toBe(200);
      const view = ((await read.json()) as { plan: ReturnType<typeof planView> }).plan;
      expect(view).toMatchObject({ as: "advise_119", label: "119勧奨", person: "p-01", block: TERM_LABELS.noCall, idle: false });
      expect(view.alt).toBe("近所の人に消防署へ知らせに走ってもらう");
      expect(view.altAi).toBe(true);
      expect(view.reason ?? "").not.toMatch(INNER);
      expect(view.reason).toContain("119勧奨");
      // 打った文は確かめにそのまま（伏字の跡なし）
      expect((await stored()).draft?.plan.stored).toBe(text);
      expect((await stored()).draft?.plan.stored).not.toContain("（氏名）");
    }
    // Claude に渡ったのは伏せた文だけ。対象を決めたあとの候補（119勧奨は通話不可）と、今いる所
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const sent = JSON.stringify(c.messages);
      expect(findLeaks(sent, ALL_KEY)).toEqual([]);
      expect(sent).not.toContain("山田");
      const input = sentOf(c);
      expect(input.手.一覧.find((x) => x.id === "advise_119")?.今).toBe(`不可（${TERM_LABELS.noCall}）`);
      expect(input.事実.text).toContain("今いる所: 訪問先（対象の本人の家）");
    }
  });

  it("打てる 119勧奨は、名前から決めた本人に打ち、内容は打った文のまま・扱いは「扱い 119勧奨」", async () => {
    await start();
    // 地震想定の始めは通話不可。電話が戻った形にする
    patchWorld((w) => ({ ...w, phone: "ok" }));
    const { client } = situationalClient();
    const free = drillFreeHook({ DB: db, ANTHROPIC_API_KEY: "dummy" }, careManager(), { claude: client, now: () => new Date(START) })!;
    const text = "山田はなさんは危険な状態のため119";
    const res = await actionPost(db, careManager(), ID, { step: 0, actions: 0, kind: "free", person: null, target: null, text }, START, {
      hooks: { free },
      roll: () => 0,
    });
    expect(res.status).toBe(200);
    const rec = (await stored()).actions[0];
    expect(rec).toMatchObject({ kind: "free", as: "advise_119", person: "p-01", text });
    expect(rec.reason ?? "").not.toMatch(INNER);
    const row = sqlite.prepare("SELECT person_id FROM drill_events WHERE id = ?").get(`${ID}-a1`) as { person_id: string };
    expect(row.person_id).toBe("p-01");
    const html = renderToStaticMarkup(createElement(ActionItem, { a: rec, names: { "p-01": seedOf("p-01").person.name } }));
    expect(html).toContain(`${FREE_LABELS.as} 119勧奨`);
    expect(html).toContain(text);
    expect(html).not.toContain("読替");
    expect(html).not.toContain("（氏名）");
    expect(buildActLog({ actions: [rec], ticks: [] }, { finished: true })[0].what).toBe(`自由対応 ${FREE_LABELS.as} 119勧奨`);
  });
});

// ---------- 5. そのままの手の結果と世界の小さな変化 ----------

describe("そのままの手は状況に合わせて結果が決まり、世界の変化は閉じた一覧の中だけ", () => {
  const own = (over: Record<string, unknown>): FreeHook => async (ask) => ({
    stored: ask.text,
    reading: { kind: "free", callee: "", text: "近所の人に頼んだ", reason: "表に無い", way: "desk", minutes: 10, can: true, outcome: "近所の人が向かった", effect: "arrival", ...over },
  });

  it("人が向かう: 本人の所へ 30〜60 分で着く人を積み、着いたら届いたに数える。左の表の効き目（聞いた安否）は無い", async () => {
    const s = await clockAt0();
    const ok = { ...s, world: { ...s.world, phone: "ok" as const } };
    const r = await act(ok, { kind: "free", person: "p-01", target: null, text: "近所の人に様子を見に行ってもらう", contacts: ALL_01 }, { free: own({ way: "phone" }) }, () => 0);
    expect(r.record).toMatchObject({ kind: "free", way: "phone", effect: "arrival" });
    expect(r.record.result).toMatchObject({ ok: true, status: "done", text: "近所の人が向かった", heard: null });
    const arrival = r.state.world.arrivals?.find((a) => a.from === r.record.id);
    expect(arrival).toMatchObject({ person: "p-01", role: "supporter", arrive: r.record.endMinute + 30 });
    expect(reachedAt(r.record)).toBe(r.record.endMinute + 30);
    // 事業所の机上の手（誰にも頼めない）では人は向かわない
    const desk = await act(ok, { kind: "free", person: "p-01", target: null, text: "近所の人のことを考える", contacts: ALL_01 }, { free: own({}) }, () => 0);
    expect(desk.record.effect).toBeUndefined();
  });

  it("届いた（reach）は、その本人の家にいる・訪問・本人や家族への電話のときだけ。事業所の机上では付かない", async () => {
    const s = await clockAt0();
    const desk = await act(s, { kind: "free", person: "p-01", target: null, text: "本人に会う", contacts: ALL_01 }, { free: own({ effect: "reach" }) }, () => 0);
    expect(desk.record.effect).toBeUndefined();
    expect(reachedAt(desk.record)).toBeNull();
    const home = { ...s, actions: [{ id: "a0", kind: "visit", person: "p-01", result: { ok: true, status: "arrived" } } as ActionRecord] };
    const here = await act(home, { kind: "free", person: "p-01", target: null, text: "本人と話す", contacts: ALL_01 }, { free: own({ effect: "reach" }) }, () => 0);
    expect(here.record.effect).toBe("reach");
    expect(reachedAt(here.record)).toBe(here.record.endMinute);
  });

  it("決まりを選ばない訓練でも、電話が通話不可なら電話のそのままの手は届かない（起きたことの文を使わない）", async () => {
    const init = initialState("earthquake", PARTICIPANTS, START, { clock: true });
    const s0 = (await advance(init, 0, {}, { policy: "clock" }))!.state;
    const s = { ...s0, world: { ...s0.world, phone: "down" as const } };
    const r = await act(s, { kind: "free", person: "p-01", target: null, text: "近所の人に電話", contacts: ALL_01 }, { free: own({ way: "phone", effect: "arrival" }) }, () => 0);
    expect(r.record.result).toMatchObject({ ok: false, status: "noLine" });
    expect(r.record.result?.text).not.toBe("近所の人が向かった");
    expect(r.state.world.arrivals?.some((a) => a.from === r.record.id) ?? false).toBe(false);
  });

  it("何も起きない文は「変化なし」で 2 分、世界を変えない。履歴は「変化なし」を 1 回だけ", async () => {
    const s = await clockAt0();
    const r = await act(s, { kind: "free", person: "p-01", target: null, text: "今は何もしない", contacts: ALL_01 }, { free: own({ kind: "none", reason: "何もしない文" }) }, () => 0);
    expect(r.record).toMatchObject({ kind: "free", idle: true, minutes: FREE_IDLE_MINUTES });
    expect(r.record.result).toMatchObject({ ok: true, status: "unchanged" });
    expect(r.state.world.arrivals ?? []).toEqual(s.world.arrivals ?? []);
    const html = renderToStaticMarkup(createElement(ActionItem, { a: r.record, names: {} }));
    expect(html.split(FREE_LABELS.idle).length - 1).toBe(1);
    expect(html).not.toContain(FREE_LABELS.as);
    expect(buildActLog({ actions: [r.record], ticks: [] }, { finished: true })[0]).toMatchObject({ what: "自由対応", result: FREE_LABELS.idle });
  });
});

// ---------- 6. 画面の言葉 ----------

describe("確かめの 1 行の言葉", () => {
  it("扱い・対象・不可・代案（AI の印）。何も起きない文は「変化なし」だけ", () => {
    const base = { as: "advise_119" as const, label: "119勧奨", way: null, callee: "本人", minutes: 5, adds: [], block: TERM_LABELS.noCall, blockAi: false, words: null, reason: "119 の文", ai: true };
    const html = renderToStaticMarkup(createElement(FreePlanLine, { view: { ...base, person: "p-01", alt: "近所の人に頼む", altAi: true, idle: false }, person: "山田 ハナ" }));
    expect(html).toContain(`${FREE_LABELS.as} `);
    expect(html).toContain("119勧奨");
    expect(html).toContain(`${FREE_LABELS.person}</span> 山田 ハナ`);
    expect(html).toContain(`${FREE_LABELS.block} ${TERM_LABELS.noCall}`);
    expect(html).toContain(FREE_LABELS.alt);
    expect(html).toContain("近所の人に頼む");
    expect(html).not.toContain("読替");
    const idle = renderToStaticMarkup(
      createElement(FreePlanLine, { view: { ...base, as: null, label: FREE_LABELS.idle, block: null, person: null, alt: null, altAi: false, idle: true } }),
    );
    expect(idle).toContain(FREE_LABELS.idle);
    expect(idle).not.toContain(`${FREE_LABELS.as} `);
    expect(idle).toContain('data-free-as="idle"');
  });

  it("ボタンと待ちの言葉は扱いの考えにそろえる（読替を使わない）", () => {
    expect([FREE_LABELS.read, FREE_LABELS.reading, FREE_LABELS.stale]).toEqual(["扱い確認", "確認中", "再確認"]);
    for (const v of Object.values(FREE_LABELS)) expect(v).not.toContain("読替");
  });
});

// ---------- 7. 口が名前から対象を決める（偽の client） ----------

describe("口（createFreeHook）が名前を書いた文の対象を決める", () => {
  it("参加者の仮名が 1 人だけ出たら、その人で候補と状況を作り直す。2 人なら決めない", async () => {
    const sources = new Map(SEED_PEOPLE.map((p) => [p.person.id, seedInput(p)] as const));
    const { client, calls } = fake(() => ({ kind: "none", callee: "", text: "", reason: "" }));
    const hook = createFreeHook({
      load: async () => sources,
      ai: { env: { ANTHROPIC_API_KEY: "dummy" }, claude: client, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind }, now: () => new Date(START) },
      on: "2026-11-05",
    });
    let asked: string[] = [];
    const forPerson = async (p: string) => {
      asked.push(p);
      return { choices: freeChoices(p, [SELF_01]), facts: `対象: ${p}`, callees: [] };
    };
    const one = await hook({ text: "山田ハナさんの様子", person: null, participants: PARTICIPANTS, choices: freeChoices(null, []), facts: "", forPerson });
    expect(one.person).toBe("p-01");
    expect(asked).toEqual(["p-01"]);
    expect(one.stored).toBe("山田ハナさんの様子");
    asked = [];
    const two = await hook({
      text: `山田ハナさんと${seedOf("p-02").person.name}さんの様子`,
      person: null,
      participants: PARTICIPANTS,
      choices: freeChoices(null, []),
      facts: "",
      forPerson,
    });
    expect(two.person).toBeUndefined();
    expect(asked).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});
