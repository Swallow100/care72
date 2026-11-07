// T185（docs/tasks/T185.md）: 人ごとの講評を訓練の間に裏で作る・全体の講評を項目ごとに・良かった所。
// node:sqlite の D1 と種の 10 人。偽の client だけ（本物の Claude を呼ばない）。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewBox } from "../../components/drill/ReviewBox.tsx";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU, OPUS } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction } from "../db/types.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { actionPost } from "./http.ts";
import {
  PERSON_REVIEW_SPEC,
  PERSON_REVIEW_SYSTEM,
  PERSON_TRIES_MAX,
  PERSONS_PER_TICK,
  PERSON_TICK_CALLS_MAX,
  PERSONS_AT_END,
  PERSONS_PER_CALL,
  personBody,
  planPersons,
  type StoredPersons,
} from "./person-review.ts";
import { claimPersons, loadDrillRecord, parseStoredScore, readPersons, savePerson, shownReview } from "./record.ts";
import { personReviewsAfterStep, reviewPost } from "./record-http.ts";
import { REVIEW_BANNED, REVIEW_SPEC, REVIEW_SYSTEM, REVIEW_TOPICS, reviewBody, reviewSections } from "./review.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

function reply(value: unknown, model: string): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

const PERSON_ANSWER = {
  text: "0 時間に本人電話で本人に届いた。次の刻みで家族へ連絡先電話を足すと、頼み事を早く聞けた。",
  good: ["0 時間の本人電話で、左の表の上から手を打てた。"],
  next: ["電話のあとに家族へ連絡先電話。"],
};

const OVERALL = {
  summary: "連絡の順は上から打てた。次は報告を早く。",
  findings: [{ person: "全体", kind: "report", text: "行政報告をもっと早く。", basis: "根拠なし" }],
  sections: [
    { topic: "order", text: "0 時間に左の表の一番上から本人電話を打てた。" },
    { topic: "talk", text: "電話で頼み事を聞けた。" },
    { topic: "visit", text: "該当なし" },
    { topic: "report", text: "行政報告は 20 分に届いた。" },
    // 使わない言葉の文だけ捨て、ほかの文は残す
    { topic: "clock", text: "時計の期限までに手が届かなかった人がいた。透析の用量を減らす。" },
    // 知らない項目は捨てる
    { topic: "weather", text: "雨だった。" },
  ],
  good: ["0 時間の本人電話。", "0 時間の本人電話。", "服薬を確かめた。"],
};

function fake(answer: (p: Params) => Message) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return answer(params);
        },
      },
    },
  };
  return { client, calls };
}

/** 人ごとの講評はまとめて呼ぶ（入力の「## 仮名」の節ごとに 1 人分を返す） */
const aliasesOf = (p: Params) => [...recordOf(p).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const personsAnswer = (p: Params) => ({ persons: aliasesOf(p).map((person) => ({ person, ...PERSON_ANSWER })) });
const byModel = (p: Params) => (p.model === HAIKU ? reply(personsAnswer(p), HAIKU) : reply(OVERALL, OPUS));
const haiku = (cs: Params[]) => cs.filter((p) => p.model === HAIKU);
const opus = (cs: Params[]) => cs.filter((p) => p.model === OPUS);
const recordOf = (p: Params) => (JSON.parse(p.messages[0].content as string) as { 記録: { text: string } }).記録.text;
const systemOf = (p: Params) => (p.system as Array<{ text: string }>).map((b) => b.text).join("\n");

const seedInput = (p: SeedPerson): PseudonymInput => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks });
const ALL_KEY = pseudonymize(SEED_PEOPLE.map(seedInput), { on: "2026-11-05" }).key;

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const careManager = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});
const SCOPE = drillScope(careManager())!;
const START = "2026-11-05T01:00:00.000Z";
const LATER = "2026-11-05T02:00:00.000Z";
const ENV = (key = true) => ({ DB: db, ...(key ? { ANTHROPIC_API_KEY: "dummy" } : {}) });

async function start(id: string) {
  const r = await startDrill(db, SCOPE, "heavy_rain", START, {}, () => id);
  expect(r).toEqual({ ok: true, id });
}

async function act(id: string, kind: DrillAction, person: string | null) {
  const row = (await loadDrillRow(db, DEMO.id, id))!;
  const n = stateOfRow(row).actions.length;
  const res = await actionPost(db, careManager(), id, { step: row.step, actions: n, kind, person, target: null }, START, { roll: () => 0 });
  expect(res.status).toBe(200);
}

async function step(id: string) {
  const row = (await loadDrillRow(db, DEMO.id, id))!;
  expect((await advanceDrill(db, SCOPE, id, row.step, START)).ok).toBe(true);
  return (await loadDrillRow(db, DEMO.id, id))!.status;
}

async function finish(id: string) {
  while ((await step(id)) === "running");
}

const rawScore = (id: string) => (sqlite.prepare("SELECT score FROM drills WHERE id = ?").get(id) as { score: string | null }).score;

describe("人ごとの講評を訓練の間に作る", () => {
  it("刻みの裏では作らず（評価の 12 回目で全部が終わりに作り直された）、終わりの講評と並べて全員分を作る", async () => {
    await start("d1");
    await act("d1", "call_person", "p-03");
    const f = fake(byModel);
    const opts = { claude: f.client, now: () => new Date(LATER) };
    expect(PERSON_TICK_CALLS_MAX).toBe(0);
    while ((await step("d1")) === "running") await personReviewsAfterStep(ENV(), careManager(), "d1", opts);
    expect(haiku(f.calls)).toHaveLength(0);
    expect((await reviewPost(ENV(), careManager(), "d1", {}, opts)).status).toBe(200);
    const calls = haiku(f.calls);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(aliasesOf(c).length).toBeLessThanOrEqual(PERSONS_PER_TICK);
      expect(c.model).toBe(PERSON_REVIEW_SPEC.model);
      expect(systemOf(c)).toContain(PERSON_REVIEW_SYSTEM);
      // 渡した物に氏名・電話・町名が無い（全体の講評と同じ伏せ方）
      expect(findLeaks(JSON.stringify(c.messages), ALL_KEY)).toEqual([]);
    }
    const end = await readPersons(db, DEMO.id, "d1");
    expect(end["p-03"]?.done?.good[0]).toContain("本人電話");
    expect(end["p-03"]?.tries).toBe(1);
    for (const r of Object.values(end)) expect(r.tries).toBeLessThanOrEqual(PERSON_TRIES_MAX);
  });

  it("鍵が無ければ作らない。作る印を取られていれば作らない", async () => {
    await start("d1");
    await act("d1", "call_person", "p-03");
    const f = fake(byModel);
    for (let i = 0; i < 2; i++) {
      await step("d1");
      await personReviewsAfterStep(ENV(false), careManager(), "d1", { claude: f.client });
    }
    expect(f.calls).toHaveLength(0);
    expect(await claimPersons(db, DEMO.id, "d1", new Date().toISOString())).toBe(true);
    for (let i = 0; i < 2; i++) {
      await step("d1");
      await personReviewsAfterStep(ENV(), careManager(), "d1", { claude: f.client });
    }
    expect(f.calls).toHaveLength(0);
  });

  it("作る人の決め方: 刻みは落ち着いた人だけ・同じ印の失敗は作り直さない・回数の上限・人数の上限。終わりは変わった人を全部", () => {
    const stored: StoredPersons = {
      a: { seen: "1", tries: 0 },
      b: { seen: "x", tries: 0 },
      c: { seen: "3", tries: 1, failed: { print: "3", at: "", error: "failed" } },
      d: { seen: "4", tries: PERSON_TRIES_MAX },
      e: { seen: "5", tries: 1, done: { print: "5", at: "", model: "", text: "t", good: [], next: [] } },
    };
    const prints = ["a", "b", "c", "d", "e"].map((p, i) => ({ person: p, print: String(i + 1), active: true }));
    const tick = planPersons(prints, stored, "tick", 3);
    expect(tick.make).toEqual(["a"]);
    expect(tick.seen).toEqual({ b: "2" });
    expect(planPersons(prints, stored, "end", 8).make).toEqual(["a", "b", "c"]);
    expect(planPersons(prints, stored, "end", 1).make).toEqual(["a"]);
    // 手の無い人は刻みでは作らない
    expect(planPersons([{ person: "a", print: "1", active: false }], stored, "tick", 3).make).toEqual([]);
  });

  it("採点の前の殻に書いた人ごとの講評は、終わって採点を残しても消えない", async () => {
    await start("d1");
    await savePerson(db, DEMO.id, "d1", "p-03", { tries: 1, done: { print: "aa", at: START, model: HAIKU, text: "講評", good: ["良"], next: ["次"] } });
    await finish("d1");
    const rec = await loadDrillRecord(db, SCOPE, "d1", LATER);
    if (rec === null || rec === "running") throw new Error("記録が無い");
    expect(rec.persons["p-03"]?.done?.text).toBe("講評");
    expect(parseStoredScore(rawScore("d1"))?.score.v).toBe(1);
  });
});

describe("終わりの講評: 全体を項目ごとに、人ごとの講評と並べて", () => {
  it("全体の講評は人ごとの要旨を入力に使い、項目ごとの文と良かった所を残す。まだ無い人は並べて作る", async () => {
    await start("d1");
    await act("d1", "call_person", "p-03");
    await act("d1", "call_person", "p-01");
    await savePerson(db, DEMO.id, "d1", "p-03", { tries: 1, done: { print: "old", at: START, model: HAIKU, text: "前の講評", good: ["前の良い手"], next: ["前の次の手"] } });
    await finish("d1");
    const f = fake(byModel);
    const res = await reviewPost(ENV(), careManager(), "d1", {}, { claude: f.client, now: () => new Date(LATER) });
    expect(res.status).toBe(200);
    expect(opus(f.calls)).toHaveLength(1);
    expect(opus(f.calls)[0].output_config).toMatchObject({ effort: REVIEW_SPEC.effort });
    expect(systemOf(opus(f.calls)[0])).toContain(REVIEW_SYSTEM);
    // 全体の入力に人ごとの要旨（仮名で）
    const whole = recordOf(opus(f.calls)[0]);
    expect(whole).toContain("人ごとの講評の要旨");
    expect(whole).toMatch(/- [A-Z] さん: 良: 前の良い手。次: 前の次の手/);
    // 終わりは印の変わった人も作る（参加者 10 人。PERSONS_AT_END まで）
    expect(haiku(f.calls).length).toBeGreaterThan(1);
    const body = (await res.json()) as { shown: { sections?: Array<{ topic: string; text: string }>; good?: string[] }; persons: Record<string, { text: string }> };
    expect(body.shown.sections?.map((s) => s.topic)).toEqual(["order", "talk", "visit", "report", "clock"]);
    expect(body.shown.sections?.find((s) => s.topic === "clock")?.text).toBe("時計の期限までに手が届かなかった人がいた。");
    expect(body.shown.good).toEqual(["0 時間の本人電話。"]);
    expect(Object.keys(body.persons)).toContain("p-01");
    // 保存した物を読み直しても同じ
    const stored = parseStoredScore(rawScore("d1"))!;
    expect(shownReview(stored.review)?.sections).toHaveLength(5);
    expect(stored.persons?.["p-01"]?.done?.text).toContain("本人電話");
  });

  it("前に保存した講評（項目なし）もそのまま読める", async () => {
    await start("d1");
    await finish("d1");
    await loadDrillRecord(db, SCOPE, "d1", LATER);
    sqlite
      .prepare("UPDATE drills SET score = json_set(score, '$.review', json(?)) WHERE id = 'd1'")
      .run(JSON.stringify({ state: "done", ai: { summary: "前の総評", findings: [{ person: null, kind: "report", text: "前の指摘", basis: null }], model: OPUS, at: START }, edited: null }));
    const s = parseStoredScore(rawScore("d1"))!;
    expect(shownReview(s.review)).toEqual({ summary: "前の総評", findings: [{ person: null, kind: "report", text: "前の指摘", basis: null }], model: OPUS, at: START, edited: false });
    expect(s.persons).toEqual({});
  });
});

describe("文の検査", () => {
  const key = pseudonymize(SEED_PEOPLE.slice(0, 3).map(seedInput), { on: "2026-11-05" }).key;
  it("項目ごとの文は、使わない言葉の文だけ捨て、項目の順に並べる。重ねた項目・知らない項目は捨てる", () => {
    const got = reviewSections(
      {
        sections: [
          { topic: "report", text: "報告は早かった。" },
          { topic: "order", text: "順番はよい。病名は書かない。" },
          { topic: "order", text: "重ねた。" },
          { topic: "x", text: "知らない。" },
        ],
        good: ["本人電話。"],
      },
      key,
    );
    expect(got.sections).toEqual([
      { topic: "order", text: "順番はよい。" },
      { topic: "report", text: "報告は早かった。" },
    ]);
    expect(got.good).toEqual(["本人電話。"]);
  });

  it("人ごとの講評も文ごとに検査する。何も残らなければ null", () => {
    expect(personBody({ text: "本人電話は早かった。脱水が心配。", good: ["点滴を頼んだ。"], next: ["家族へ連絡先電話。"] }, key)).toEqual({
      text: "本人電話は早かった。",
      good: [],
      next: ["家族へ連絡先電話。"],
    });
    expect(personBody({ text: "診断した。", good: [], next: [] }, key)).toBeNull();
  });

  it("前の形の返事（項目なし）は今までどおり総評と指摘だけ", () => {
    const b = reviewBody({ summary: "総評。", findings: [] }, { key, members: new Set() });
    expect(b).toEqual({ summary: "総評。", findings: [] });
  });

  it("指示の文に使わない言葉が無い。項目は 5 つ", () => {
    expect(PERSON_REVIEW_SYSTEM).not.toMatch(REVIEW_BANNED);
    expect(PERSON_REVIEW_SYSTEM).not.toMatch(/死亡|関連死|診断|判定|重症|緊急度|札/);
    expect(REVIEW_SYSTEM).not.toMatch(/緊急度|札/);
    expect(REVIEW_TOPICS).toHaveLength(5);
  });
});

describe("講評の画面と紙", () => {
  const names = { "p-01": "伊藤 一郎", "p-03": "加藤 花子" };
  const done = {
    state: "done" as const,
    ai: {
      summary: "総評。",
      findings: [{ person: null, kind: "report" as const, text: "指摘。", basis: null }],
      sections: [
        { topic: "order" as const, text: "連絡の順の文。" },
        { topic: "visit" as const, text: "該当なし" },
      ],
      good: ["良い対応の文。"],
      model: OPUS,
      at: START,
    },
    edited: null,
  };
  const persons = { "p-03": { text: "加藤さんの講評。", good: ["良い手。"], next: ["次の手。"], at: START } };

  it("画面: 良い対応・項目別（該当なしは出さない）・指摘と、人ごとの講評を名前で開く行。AI の印", () => {
    const h = renderToStaticMarkup(createElement(ReviewBox, { drillId: "d1", initial: done, persons, canReview: true, names }));
    expect(h).toContain("良い対応");
    expect(h).toContain("良い対応の文。");
    expect(h).toContain("項目別");
    expect(h).toContain("連絡順");
    expect(h).not.toContain("訪問手配");
    expect(h).toContain("個別講評");
    expect(h).toContain("加藤 花子");
    expect(h).toContain("開く");
    // 閉じている間は 1 行の文だけ
    expect(h).toContain("加藤さんの講評。");
    expect(h).not.toContain("次の手。");
    expect(h).not.toMatch(/診断|判定|重症|緊急度|札/);
  });

  it("前の形の講評（項目なし）は今までどおり。人ごとの講評が無ければ欄を出さない", () => {
    const old = { ...done, ai: { summary: "総評。", findings: done.ai.findings, model: OPUS, at: START } };
    const h = renderToStaticMarkup(createElement(ReviewBox, { drillId: "d1", initial: old, canReview: true, names }));
    expect(h).toContain("総評。");
    expect(h).not.toContain("項目別");
    expect(h).not.toContain("個別講評");
  });
});

describe("呼び出しの数", () => {
  it("人ごとの講評は 1 回の訓練に、刻みの裏 PERSON_TICK_CALLS_MAX 回と終わり 3 回まで（参加者の数によらず 7 回まで）", () => {
    expect(PERSON_TICK_CALLS_MAX + Math.ceil(PERSONS_AT_END / PERSONS_PER_CALL)).toBeLessThanOrEqual(7);
    expect(PERSON_REVIEW_SPEC.timeoutMs).toBeLessThanOrEqual(20_000);
    expect(PERSON_REVIEW_SPEC.maxRetries).toBe(0);
  });
});
