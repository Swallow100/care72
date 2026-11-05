// T126 訓練の手の欄（押せない手を薄く・押せる手を先に、打てる手の候補、訪問と訪問依頼の時間の言い方、メモの入力を外す。docs/tasks/T126.md）のテスト。
// 本物の API は呼ばない。手元の D1 は node:sqlite と種の 10 人。決まりの表の結果（ActionTerm）は手で作り、決まりの中身（T125 が直す）に頼らない。

import { readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetailHints, FADED } from "../../components/drill/ActionHints.tsx";
import { ActionPanel } from "../../components/drill/ActionPanel.tsx";
import { DrillRowDetail } from "../../components/drill/DrillRowDetail.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { ContactKind, DrillAction } from "../db/types.ts";
import { ACTION_CATALOG, ACTION_GROUPS } from "./action-catalog.ts";
import {
  actAvail,
  ALT_ACTIONS,
  askActions,
  CLOCK_HINTS,
  HINT_LABELS,
  hintsOf,
  PANEL_HIDDEN,
  panelActionsOf,
  phoneOut,
  PHONE_ACTIONS,
  timeParts,
  usableFirst,
  type HintClock,
  type HintInput,
} from "./action-hints.ts";
import type { ActionTerm } from "./action-terms.ts";
import { actDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { ASK_KINDS, EMPTY_WORLD, type WorldState } from "./scenarios.ts";
import { loadDrillScreen } from "./view.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

// ---------- 決まりの表の結果（手で作る） ----------

const term = (minutes: number, over: Partial<ActionTerm> = {}): ActionTerm => ({ minutes, block: null, targets: {}, adds: [], pickup: 1, ...over });
const OPEN_TERMS = (): Record<DrillAction, ActionTerm> =>
  Object.fromEntries(ACTION_CATALOG.map((r) => [r.id, term(r.minutes)])) as Record<DrillAction, ActionTerm>;
/** 理由の言葉は何でもよい（決まりの表の中身に頼らない。T125 が段を分けても同じ） */
const DOWN = "回線断";
/** 電話で済む手と、電話で頼み誰かが向かう手を全部押せなくする（電話の不通の形） */
function phoneDownTerms(): Record<DrillAction, ActionTerm> {
  const t = OPEN_TERMS();
  for (const k of [...PHONE_ACTIONS, "ask_check", "request_backup", "arrange_medicine", "arrange_dialysis", "request_welfare_shelter", "request_hospital", "arrange_transport", "arrange_power", "call_vendor", "report_city", "dispatch"] as DrillAction[]) {
    t[k] = term(t[k].minutes, { block: DOWN });
  }
  return t;
}

/** 酸素の人の連絡先（本人・娘・隣人。薬局・業者・病院は無い） */
const CONTACTS_01: Array<{ kind: ContactKind }> = [{ kind: "self" }, { kind: "family" }, { kind: "supporter" }];

const clock = (over: Partial<HintClock> = {}): HintClock => ({
  id: "k-1",
  category: "oxygen",
  label: "酸素 内蔵電池",
  running: true,
  left: 1.5,
  remaining: "残り 1 時間 30 分",
  tone: "urgent",
  depends_on: null,
  depends_check: null,
  ...over,
});

const input = (over: Partial<HintInput> = {}): HintInput => ({
  person: "p-01",
  asks: [],
  clocks: [],
  world: EMPTY_WORLD,
  terms: OPEN_TERMS(),
  contacts: CONTACTS_01,
  hoursLeft: 70,
  ...over,
});

const kindsOf = (acts: ReadonlyArray<{ kind: DrillAction }>) => acts.map((a) => a.kind);

// ---------- 1. 表 ----------

describe("候補の表（lib/drill/action-hints.ts）", () => {
  it("頼み事 → 手: 手の表の効き目（ask_done）から引き、足りない物だけ足す。並びは手の表の順", () => {
    expect(askActions("power")).toEqual(["arrange_power", "call_vendor"]);
    expect(askActions("battery")).toEqual(["arrange_power", "call_vendor"]);
    expect(askActions("medicine")).toEqual(["arrange_medicine"]);
    expect(askActions("transport")).toEqual(["request_welfare_shelter", "arrange_transport"]);
    expect(askActions("family_contact")).toEqual(["call_contact"]);
    // 手の表の効き目（ask_done）を持つ手は、その頼み事の候補にいつも入る
    for (const r of ACTION_CATALOG) {
      for (const e of r.effects) if (e.kind === "ask_done") for (const ask of e.asks) expect(askActions(ask)).toContain(r.id);
    }
  });

  it("時計の区分 → 手: 酸素・呼吸器は 119勧奨・病院受入・電源手配・業者連絡、透析は透析調整・病院受入、薬は薬手配", () => {
    expect(CLOCK_HINTS.oxygen).toEqual(["advise_119", "request_hospital", "arrange_power", "call_vendor"]);
    expect(CLOCK_HINTS.ventilator).toEqual(CLOCK_HINTS.oxygen);
    expect(CLOCK_HINTS.dialysis).toEqual(["arrange_dialysis", "request_hospital"]);
    expect(CLOCK_HINTS.insulin).toEqual(["arrange_medicine"]);
    expect(CLOCK_HINTS.dementia).toBeUndefined();
  });

  it("訪問で分かった頼み事（電源・電池・薬）と走っている酸素の時計から候補。同じ手の並びの元は 1 行に。済んだ頼み事は出さない", () => {
    const h = hintsOf(
      input({
        asks: [
          { kind: "power", at: 50, done: null },
          { kind: "battery", at: 50, done: null },
          { kind: "medicine", at: 50, done: null },
          { kind: "water", at: 10, done: 40 },
        ],
        clocks: [clock(), clock({ id: "k-2", label: "酸素 予備ボンベ", left: 6 }), clock({ id: "k-3", category: "insulin", label: "インスリン", left: 90 })],
      }),
    )!;
    expect(h.groups.map((g) => g.sources.map((s) => s.label))).toEqual([["電源", "電池"], ["薬"], ["酸素 内蔵電池", "酸素 予備ボンベ"]]);
    expect(h.groups[0].sources.map((s) => s.from)).toEqual(["ask", "ask"]);
    // 電源・電池: 電源手配（固定の相手の市役所で押せる）を先、業者連絡（台帳に業者の連絡先が無い）は相手なしであと
    expect(h.groups[0].actions).toEqual([
      { kind: "arrange_power", state: "ok", why: null, minutes: 15 },
      { kind: "call_vendor", state: "block", why: HINT_LABELS.noTarget, minutes: 5 },
    ]);
    // 薬: 薬手配（薬局・かかりつけが台帳に無い）
    expect(h.groups[1].actions).toEqual([{ kind: "arrange_medicine", state: "block", why: HINT_LABELS.noTarget, minutes: 10 }]);
    // 酸素の時計: 119勧奨・電源手配を先（病院・業者の連絡先が無い手はあと）。訓練の終わりまでに切れないインスリンは出さない
    expect(kindsOf(h.groups[2].actions)).toEqual(["advise_119", "arrange_power", "request_hospital", "call_vendor"]);
    expect(h.groups.flatMap((g) => g.sources).some((s) => s.label === "インスリン")).toBe(false);
    // 電話の手は押せるので代替は無い
    expect(h.alt).toBeNull();
  });

  it("走っていない時計・候補の無い区分は出さない。表の入力の頼り先が未確認なら、確認済にする手（効き目 check）を候補に", () => {
    expect(hintsOf(input({ clocks: [clock({ running: false, left: 2 })] }))).toBeNull();
    expect(hintsOf(input({ clocks: [clock({ category: "dementia", label: "見守り" })] }))).toBeNull();
    const h = hintsOf(
      input({
        contacts: [...CONTACTS_01, { kind: "dialysis_center" }],
        clocks: [clock({ category: "dialysis", label: "透析 次の回まで", left: 40, depends_on: "dialysis_center", depends_check: "unconfirmed" })],
        world: { ...EMPTY_WORLD, facilities: [{ id: "f-1", label: "透析施設", open: false, person: "p-01", depends: "dialysis_center" }] },
      }),
    )!;
    // 透析施設の休止（公表の事実）と透析の時計は同じ手の並びなので 1 行
    expect(h.groups).toHaveLength(1);
    expect(h.groups[0].sources.map((s) => s.label)).toEqual([HINT_LABELS.dialysisClosed, "透析 次の回まで"]);
    expect(kindsOf(h.groups[0].actions)).toEqual(["arrange_dialysis", "request_hospital"]);
  });

  it("向かっている人がいる・届いた・確認済の手は手配済（押せるまま）。押せない手よりは前", () => {
    const world: WorldState = {
      ...EMPTY_WORLD,
      arrivals: [{ person: "p-01", role: "power", arrive: 200, back: null, arrived: false, from: "a1" }],
    };
    const h = hintsOf(input({ asks: [{ kind: "power", at: 50, done: null }], world }))!;
    expect(h.groups[0].actions).toEqual([
      { kind: "arrange_power", state: "done", why: HINT_LABELS.done, minutes: 15 },
      { kind: "call_vendor", state: "block", why: HINT_LABELS.noTarget, minutes: 5 },
    ]);
    // 届いたあと（supplies）も手配済
    const got = hintsOf(input({ asks: [{ kind: "power", at: 50, done: null }], world: { ...EMPTY_WORLD, supplies: { "p-01": { power: 220 } } } }))!;
    expect(got.groups[0].actions[0]).toMatchObject({ kind: "arrange_power", state: "done" });
  });

  it("記録の手（note）は対応の欄の一覧にも候補にも出さない（表の行は前の訓練のために残る）", () => {
    expect(ACTION_CATALOG.some((r) => r.id === "note")).toBe(true);
    expect(ACTION_GROUPS.flatMap((g) => panelActionsOf(g))).not.toContain("note");
    expect(PANEL_HIDDEN).toEqual(["note"]);
    const all = hintsOf(
      input({
        terms: phoneDownTerms(),
        asks: ASK_KINDS.map((kind) => ({ kind, at: 1, done: null })),
        clocks: Object.keys(CLOCK_HINTS).map((c, i) => clock({ id: `k${i}`, category: c as HintClock["category"], label: c })),
      }),
    )!;
    expect([...all.groups.flatMap((g) => kindsOf(g.actions)), ...kindsOf(all.alt!)]).not.toContain("note");
  });

  it("候補は色と連絡順に使わない（lib/triage は候補の表を読まない）。言葉は 2〜4 字で、診断・判定の語を使わない", () => {
    const dir = new URL("../triage/", import.meta.url);
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".ts")) expect(readFileSync(new URL(f, dir), "utf8")).not.toContain("action-hints");
    }
    for (const label of Object.values(HINT_LABELS)) {
      expect([...label].length).toBeGreaterThanOrEqual(2);
      expect([...label].length).toBeLessThanOrEqual(4);
      expect(label).not.toMatch(/診断|判定|重症|緊急度|札/);
    }
  });
});

// ---------- 2. 電話の手が全部押せない時の代替 ----------

describe("電話の手が全部押せない時の代替", () => {
  it("本人電話・連絡先電話・119勧奨が全部押せないと、代替の 1 行（訪問・訪問依頼・見守依頼・自由対応）。可否は決まりの表の結果のまま", () => {
    expect(PHONE_ACTIONS).toEqual(["call_person", "call_contact", "advise_119"]);
    const h = hintsOf(input({ terms: phoneDownTerms(), asks: [{ kind: "power", at: 50, done: null }] }))!;
    expect(h.alt).not.toBeNull();
    expect(new Set(kindsOf(h.alt!))).toEqual(new Set(ALT_ACTIONS));
    // 押せる物（訪問・自由対応）を先、押せない物（訪問依頼・見守依頼）は理由つきであと
    expect(h.alt).toEqual([
      { kind: "visit", state: "ok", why: null, minutes: 40 },
      { kind: "free", state: "ok", why: null, minutes: 0 },
      { kind: "dispatch", state: "block", why: DOWN, minutes: 10 },
      { kind: "ask_check", state: "block", why: DOWN, minutes: 5 },
    ]);
    // 候補の行の手も押せない理由つき
    expect(h.groups[0].actions.every((a) => a.state === "block")).toBe(true);
  });

  it("決まりの表が訪問依頼・見守依頼を押せるとすれば（T125 の直し）、代替でも押せる側に並ぶ", () => {
    const t = phoneDownTerms();
    t.dispatch = term(10, { targets: { visiting_nurse: DOWN, care_service: DOWN } });
    t.ask_check = term(5, { targets: { family: DOWN } });
    const h = hintsOf(input({ terms: t }))!;
    expect(h.groups).toEqual([]);
    expect(h.alt!.map((a) => [a.kind, a.state])).toEqual([
      ["visit", "ok"],
      ["dispatch", "ok"],
      ["ask_check", "ok"],
      ["free", "ok"],
    ]);
  });

  it("家の電話だけが不通（家族の携帯にはかけられる）なら代替は出さない。決まりを選ばなかった訓練も出さない", () => {
    const t = OPEN_TERMS();
    t.call_person = term(5, { block: DOWN });
    t.advise_119 = term(5, { targets: { self: DOWN } });
    expect(phoneOut({ person: "p-01", terms: t, contacts: CONTACTS_01 })).toBe(false);
    expect(phoneOut({ person: "p-01", terms: null, contacts: CONTACTS_01 })).toBe(false);
    expect(hintsOf(input({ terms: null }))).toBeNull();
  });

  it("決まりを選ばなかった訓練（terms なし）も、候補は連絡先の有無で出す", () => {
    const h = hintsOf(input({ terms: null, asks: [{ kind: "power", at: 1, done: null }] }))!;
    expect(h.groups[0].actions.map((a) => [a.kind, a.state])).toEqual([
      ["arrange_power", "ok"],
      ["call_vendor", "block"],
    ]);
    expect(h.alt).toBeNull();
  });
});

// ---------- 3. 手 1 つの見え方・並び・時間の言い方 ----------

describe("手 1 つの見え方（対応の欄の手のボタンと候補が同じ所）", () => {
  it("本人を選ぶ前は wait、相手の連絡先が無ければ相手なし、決まりの表の理由、選べる相手が全部押せなければ相手の理由", () => {
    expect(actAvail("call_contact", { person: null, term: null, contacts: [] })).toEqual({ state: "wait", why: null });
    expect(actAvail("note", { person: null, term: null, contacts: [] })).toEqual({ state: "ok", why: null });
    expect(actAvail("call_vendor", { person: "p-01", term: term(5), contacts: CONTACTS_01 })).toEqual({ state: "block", why: HINT_LABELS.noTarget });
    expect(actAvail("visit", { person: "p-01", term: term(40, { block: "通行止" }), contacts: CONTACTS_01 })).toEqual({ state: "block", why: "通行止" });
    expect(actAvail("call_contact", { person: "p-01", term: term(5, { targets: { family: "x", supporter: "y" } }), contacts: CONTACTS_01 })).toEqual({
      state: "block",
      why: "x",
    });
    expect(actAvail("call_contact", { person: "p-01", term: term(5, { targets: { family: "x" } }), contacts: CONTACTS_01 })).toEqual({ state: "ok", why: null });
  });

  it("押せる物を先、手配済、押せない物をあと。同じ状態の中は元の並び（本人を選ぶ前の手は押せる側）", () => {
    const xs = [
      { id: 1, state: "block" as const },
      { id: 2, state: "ok" as const },
      { id: 3, state: "wait" as const },
      { id: 4, state: "done" as const },
      { id: 5, state: "ok" as const },
    ];
    expect(usableFirst(xs).map((x) => x.id)).toEqual([2, 3, 5, 4, 1]);
  });

  it("訪問は自分 40 分、訪問依頼は自分 10 分 職員 40 分（自分が出る訪問の間は手が止まり、職員に行ってもらう手は自分の時間が短い）", () => {
    expect(timeParts("visit", 40)).toEqual([{ who: "self", minutes: 40 }]);
    expect(timeParts("visit", 80)).toEqual([{ who: "self", minutes: 80 }]);
    expect(timeParts("dispatch", 10)).toEqual([
      { who: "self", minutes: 10 },
      { who: "staff", minutes: 40 },
    ]);
    expect(timeParts("call_person", 5)).toEqual([{ who: null, minutes: 5 }]);
  });
});

// ---------- 4. 画面 ----------

const ID = "drill-t126";

describe("対応の欄と本人の詳細", () => {
  it("押せない手は薄く（地を外し字を弱く）理由の字は残す。区分の段の中で押せる手を先。メモの入力と記録の手は無い", () => {
    const base = OPEN_TERMS();
    const terms = { "": { ...base, evacuate_self: term(30, { block: "時間満了" }) } };
    const html = renderToStaticMarkup(
      createElement(ActionPanel, { drillId: ID, step: 0, actions: 0, people: [{ id: "p-01", name: "本人 一", tag: null }], contacts: {}, terms }),
    );
    const tag = (k: string) => html.split("<button").find((t) => t.includes(`data-act-kind="${k}"`))!;
    // 記録の段: 自由対応（押せる）→ 退避（押せない）。記録の手（note）は出さない
    const record = [...html.matchAll(/data-act-kind="(note|evacuate_self|free)"/g)].map((m) => m[1]);
    expect(record).toEqual(["free", "evacuate_self"]);
    expect(tag("evacuate_self")).toContain('data-act-state="block"');
    for (const c of FADED.split(" ")) expect(tag("evacuate_self")).toContain(c);
    expect(tag("evacuate_self")).toContain('data-act-block="時間満了"');
    expect(tag("evacuate_self")).toMatch(/text-muted" data-act-why="true">時間満了/);
    // 押せる手と本人を選ぶ前の手は薄くしない
    expect(tag("free")).not.toContain("bg-transparent!");
    expect(tag("visit")).toContain('data-act-state="wait"');
    expect(tag("visit")).not.toContain("bg-transparent!");
    // 訪問と訪問依頼の時間の言い方
    expect(tag("visit")).toContain('data-act-time="self40"');
    expect(tag("visit")).toContain(">自分<");
    expect(tag("dispatch")).toContain('data-act-time="self10 staff40"');
    expect(tag("dispatch")).toContain(">職員<");
    expect(tag("dispatch")).toContain("col-span-2");
    // メモの入力は外した
    expect(html).not.toContain("data-act-memo");
    // 本人を選ぶまで候補は出さない
    expect(html).not.toContain("data-act-hints");
    expect(html).not.toMatch(/rounded-full|tracking-|bg-black/);
  });

  it("本人の詳細の候補: 元 → 手のボタン。押せない候補は薄く理由つき、代替の 1 行", () => {
    const h = hintsOf(input({ terms: phoneDownTerms(), asks: [{ kind: "power", at: 50, done: null }], clocks: [clock({ left: -0.5, remaining: "超過 30 分" })] }))!;
    const html = renderToStaticMarkup(createElement(DetailHints, { person: "p-01", hints: h }));
    expect(html).toContain("data-detail-hints");
    expect(html).toContain(`>${HINT_LABELS.head}<`);
    expect(html).toContain('data-hint-row="ask"');
    expect(html).toContain('data-hint-row="clock"');
    expect(html).toContain("超過 30 分");
    expect(html).toContain('data-hint-alt=""');
    expect(html).toContain(`>${HINT_LABELS.alt}<`);
    const tag = (k: string, row: string) =>
      html
        .split("data-hint-row=")
        .find((r) => r.startsWith(`"${row}"`))!
        .split("<button")
        .find((t) => t.includes(`data-hint-act="${k}"`))!;
    expect(tag("arrange_power", "ask")).toContain('data-hint-state="block"');
    expect(tag("arrange_power", "ask")).toContain("bg-transparent!");
    expect(tag("arrange_power", "ask")).toContain(DOWN);
    expect(tag("visit", "alt")).toContain('data-hint-state="ok"');
    expect(tag("visit", "alt")).not.toContain("bg-transparent!");
    // 本人の詳細の中は面の中の上なので白のボタン、押すまで選んだ印は無い
    expect(tag("visit", "alt")).toContain("bg-panel ");
    expect(html).not.toContain("aria-pressed");
    // 何をすべきとは書かない
    expect(html).not.toMatch(/すべき|してください|おすすめ|推奨/);
  });

  it("行の詳細に候補を渡すと、未対応の頼み事の下に出す。渡さなければ出さない", () => {
    const detail = {
      personId: "p-01",
      color: "yellow",
      tone: "check",
      reason: "酸素 停電",
      baseColor: "yellow",
      contacts: [],
      clocks: [],
      destinations: { first: null, second: null, transport: null },
      supporters: [],
      lastContact: null,
      signals: [],
      calls: [],
      override: null,
    } as never;
    const h = hintsOf(input({ asks: [{ kind: "power", at: 50, done: null }] }))!;
    const on = renderToStaticMarkup(
      createElement(DrillRowDetail, { detail, startedAt: "2026-11-05T01:00:00.000Z", asks: [{ kind: "power", at: 50, done: null }], hints: h }),
    );
    expect(on.indexOf("data-open-asks")).toBeGreaterThan(-1);
    expect(on.indexOf("data-detail-hints")).toBeGreaterThan(on.indexOf("data-open-asks"));
    const off = renderToStaticMarkup(createElement(DrillRowDetail, { detail, startedAt: "2026-11-05T01:00:00.000Z" }));
    expect(off).not.toContain("data-detail-hints");
  });
});

// ---------- 5. 手元の D1 で（大雨想定・連続の時計と決まり。10 分版は使わない） ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const careManager: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};
const SCOPE = drillScope(careManager)!;
const START = "2026-11-05T01:00:00.000Z";

async function visitWithAsks() {
  const row = (await loadDrillRow(db, DEMO.id, ID))!;
  const s = stateOfRow(row);
  return actDrill(db, SCOPE, ID, { step: row.step, actions: s.actions.length }, { kind: "visit", person: "p-01", target: null }, START, {
    roll: () => 0,
    hooks: {
      visit: async () => ({ report: { condition: "居間にいる", asks: ["power", "medicine"], speech: null, ai: true }, called: true }),
    },
  });
}

describe("訓練の画面の中身（lib/drill/view.ts の hints）", () => {
  it("訪問で聞いた頼み事（電源・薬）から、その人の候補が画面の中身に入る。進行中の今の区切りだけ", async () => {
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID, { clock: true, terms: true })).toEqual({ ok: true, id: ID });
    const r = await visitWithAsks();
    expect(r).toMatchObject({ ok: true, record: { result: { status: "arrived" } } });
    const s = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(s.terms).not.toBeNull();
    const h = s.hints?.["p-01"];
    expect(h).toBeDefined();
    const ask = h!.groups.find((g) => g.sources.some((x) => x.from === "ask" && x.label === "電源"))!;
    expect(new Set(kindsOf(ask.actions))).toEqual(new Set(["arrange_power", "call_vendor"]));
    // 台帳に業者の連絡先が無いので業者連絡は相手なし（押せない物はあと）
    expect(ask.actions.at(-1)).toMatchObject({ kind: "call_vendor", state: "block", why: HINT_LABELS.noTarget });
    const med = h!.groups.find((g) => g.sources.some((x) => x.from === "ask" && x.label === "薬"))!;
    expect(kindsOf(med.actions)).toContain("arrange_medicine");
    // 候補の可否は画面の決まりの表の結果と食い違わない
    for (const g of h!.groups) {
      for (const a of g.actions) {
        if (a.state === "block" && a.why !== HINT_LABELS.noTarget) expect(s.terms!["p-01"][a.kind].block ?? Object.values(s.terms!["p-01"][a.kind].targets)[0]).toBe(a.why);
      }
    }
  });

  it("決まりを選ばなかった訓練も候補を出す（可否は連絡先の有無だけ）。再生（前の区切り）では出さない", async () => {
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => ID, { clock: true })).toEqual({ ok: true, id: ID });
    await visitWithAsks();
    const s = (await loadDrillScreen(db, SCOPE, ID, null))!;
    expect(s.terms).toBeNull();
    expect(s.hints?.["p-01"]?.groups.some((g) => g.sources.some((x) => x.label === "電源"))).toBe(true);
    expect(s.hints?.["p-01"]?.alt).toBeNull();
    // 中断した訓練（進行中でない）は出さない
    sqlite.prepare("UPDATE drills SET status = 'abandoned' WHERE id = ?").run(ID);
    expect((await loadDrillScreen(db, SCOPE, ID, null))!.hints).toBeNull();
  });
});
