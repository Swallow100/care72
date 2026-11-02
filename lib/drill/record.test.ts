// 着信の応答・拒否の記録と、訓練記録（採点の保存・前回・講評）のテスト（docs/tasks/T22.md）。node:sqlite の D1 と種の 10 人。
// 本物の API は呼ばない（偽の client が決まった JSON を返す）。鍵が無いときは講評を作らず、機械の数字だけが出る。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { OPUS } from "../claude/models.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction, DrillScenario } from "../db/types.ts";
import { findLeaks, pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { advanceDrill, drillScope, loadDrillRow, startDrill, stateOfRow } from "./db.ts";
import { actionPost } from "./http.ts";
import { loadDrillRecord, parseStoredScore, shownReview } from "./record.ts";
import { callPost, reviewPost } from "./record-http.ts";
import { loadCallRecords, respondCall } from "./responses.ts";
import { REVIEW_SYSTEM, reviewBody } from "./review.ts";
import { scoreNumbers } from "./score.ts";

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
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };
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
const START = "2026-11-05T01:00:00.000Z";
const LATER = "2026-11-05T02:00:00.000Z";

async function start(id: string, scenario: DrillScenario = "heavy_rain", at = START) {
  const r = await startDrill(db, SCOPE, scenario, at, {}, () => id);
  expect(r).toEqual({ ok: true, id });
}

/** 手を 1 つ（画面と同じ道。手の前の左の表の並びも残る）。roll 0 は届く */
async function act(id: string, kind: DrillAction, person: string | null, target: string | null = null) {
  const row = (await loadDrillRow(db, DEMO.id, id))!;
  const n = stateOfRow(row).actions.length;
  const res = await actionPost(db, careManager(), id, { step: row.step, actions: n, kind, person, target }, START, { roll: () => 0 });
  expect(res.status).toBe(200);
}

async function finish(id: string) {
  for (;;) {
    const row = (await loadDrillRow(db, DEMO.id, id))!;
    if (row.status !== "running") return;
    expect((await advanceDrill(db, SCOPE, id, row.step, START)).ok).toBe(true);
  }
}

const storedScore = (id: string) =>
  parseStoredScore((sqlite.prepare("SELECT score FROM drills WHERE id = ?").get(id) as { score: string | null }).score);

describe("着信の応答・拒否の記録", () => {
  it("call_in の着信に応答・拒否を 1 回だけ残す（ケアマネの時計、色と本人は着信から写す）。2 回目は残さない", async () => {
    await start("d1");
    const calls = await loadCallRecords(db, "d1");
    // 大雨の 0 時間: 高橋と田中の家族の着信
    expect(calls.map((c) => [c.person, c.color, c.response])).toEqual([
      ["p-06", "green", null],
      ["p-03", "green", null],
    ]);
    await act("d1", "call_person", "p-01");
    expect(await respondCall(db, SCOPE, "d1", calls[0].signal, "decline")).toEqual({ ok: true, recorded: true });
    expect(await respondCall(db, SCOPE, "d1", calls[0].signal, "answer")).toEqual({ ok: true, recorded: false });
    expect(await respondCall(db, SCOPE, "d1", calls[1].signal, "answer")).toEqual({ ok: true, recorded: true });
    const after = await loadCallRecords(db, "d1");
    expect(after.map((c) => [c.person, c.response, c.respondedAt])).toEqual([
      ["p-06", "decline", 5],
      ["p-03", "answer", 5],
    ]);
    const rows = sqlite
      .prepare("SELECT kind, actor, person_id, payload FROM drill_events WHERE drill_id = 'd1' AND kind LIKE 'call\\_%' ESCAPE '\\' AND kind <> 'call_in' ORDER BY seq")
      .all() as Array<{ kind: string; actor: string; person_id: string; payload: string }>;
    expect(rows.map((r) => [r.kind, r.actor, r.person_id])).toEqual([
      ["call_decline", "care_manager", "p-06"],
      ["call_answer", "care_manager", "p-03"],
    ]);
    expect(JSON.parse(rows[0].payload)).toEqual({ signal: calls[0].signal, response: "decline", color: "green", source: "family", callMinute: 0, minute: 5 });
  });

  it("この訓練の着信でなければ 404。終わった訓練でも残せる（最後の刻みの着信）", async () => {
    await start("d1");
    const [c] = await loadCallRecords(db, "d1");
    expect(await respondCall(db, SCOPE, "d1", "d1-0-s99", "answer")).toEqual({ ok: false, error: "not_found" });
    expect(await respondCall(db, { officeId: PARTNER.id }, "d1", c.signal, "answer")).toEqual({ ok: false, error: "not_found" });
    await finish("d1");
    expect(await respondCall(db, SCOPE, "d1", c.signal, "answer")).toEqual({ ok: true, recorded: true });
  });

  it("API の壁: 未ログイン 401、ケアマネの役でない 403、形が違う 400、事業所の外・無い着信 404", async () => {
    await start("d1");
    const [c] = await loadCallRecords(db, "d1");
    const body = { signal: c.signal, response: "decline" };
    expect((await callPost(db, null, "d1", body)).status).toBe(401);
    expect((await callPost(db, careManager({ role: "government", caseloadOf: null }), "d1", body)).status).toBe(403);
    expect((await callPost(db, careManager(), "d1", { signal: c.signal, response: "maybe" })).status).toBe(400);
    expect((await callPost(db, careManager(), "d1", { signal: "x y", response: "answer" })).status).toBe(400);
    expect((await callPost(db, careManager(), "d1/../x", body)).status).toBe(400);
    const partner = careManager({ office: PARTNER, accountId: "acct-partner-cm", caseloadOf: "acct-partner-cm" });
    expect((await callPost(db, partner, "d1", body)).status).toBe(404);
    const ok = await callPost(db, careManager(), "d1", body);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, recorded: true });
  });
});

describe("訓練記録（採点の保存と前回）", () => {
  it("進行中は数えない。終わったら最初に開いたときに数えて drills.score に残し、あとで台帳を直しても残した数字のまま", async () => {
    await start("d1");
    expect(await loadDrillRecord(db, SCOPE, "d1", LATER)).toBe("running");
    expect(storedScore("d1")).toBeNull();
    await act("d1", "call_person", "p-03"); // 0 時間の左の表の一番上（透析先 未確認で黄）
    await act("d1", "call_person", "p-01");
    await act("d1", "report_city", null);
    const [c0, c1] = await loadCallRecords(db, "d1");
    await respondCall(db, SCOPE, "d1", c0.signal, "answer");
    await respondCall(db, SCOPE, "d1", c1.signal, "decline");
    await finish("d1");

    const rec = await loadDrillRecord(db, SCOPE, "d1", LATER);
    if (rec === null || rec === "running") throw new Error("記録が無い");
    expect(rec.score.order.turns.map((t) => [t.person, t.match])).toEqual([
      ["p-03", true],
      ["p-01", true],
    ]);
    expect(scoreNumbers(rec.score)).toEqual({ order: { matched: 2, total: 10 }, report: 20, form9: 3, reached: 1 });
    // 小林（人工呼吸器 内蔵電池 3 時間、停電の 1 時間から）には手が無い
    expect(rec.score.reached.map((r) => [r.person, r.label, r.outMinute])).toEqual([["p-02", "人工呼吸器 内蔵電池", 240]]);
    expect(rec.score.calls).toMatchObject({ answered: 1, declined: 1 });
    expect(rec.previous).toBeNull();
    expect(rec.review).toBeNull();
    expect(storedScore("d1")?.score).toEqual(rec.score);

    // 台帳を直しても（伊藤の避難所を足す）、残した数字は変わらない
    const ledger = JSON.parse((sqlite.prepare("SELECT ledger FROM people WHERE id = 'p-05'").get() as { ledger: string }).ledger);
    ledger.evacuation.destination1 = "みずほし小学校";
    sqlite.prepare("UPDATE people SET ledger = ? WHERE id = 'p-05'").run(JSON.stringify(ledger));
    const again = await loadDrillRecord(db, SCOPE, "d1", "2026-11-06T00:00:00.000Z");
    if (again === null || again === "running") throw new Error("記録が無い");
    expect(again.score.form9.blanks).toBe(3);
    expect(again.scoredAt).toBe(LATER);
  });

  it("中断した訓練も数える（中断の時刻までの時計）。範囲の外は null", async () => {
    await start("d1");
    await advanceDrill(db, SCOPE, "d1", 0, START);
    sqlite.prepare("UPDATE drills SET status = 'abandoned' WHERE id = 'd1'").run();
    const rec = await loadDrillRecord(db, SCOPE, "d1", LATER);
    if (rec === null || rec === "running") throw new Error("記録が無い");
    expect(rec.score.endMinute).toBe(60);
    expect(rec.score.reached).toEqual([]);
    expect(await loadDrillRecord(db, { officeId: PARTNER.id }, "d1", LATER)).toBeNull();
  });

  it("前回: 同じ事業所の前の終わった訓練で、同じ災害（10 分版は大雨と比べる）。前回の採点が無ければ数えて残す", async () => {
    await start("d1", "heavy_rain", "2026-11-04T01:00:00.000Z");
    await finish("d1");
    await start("d2", "earthquake", "2026-11-04T05:00:00.000Z");
    await finish("d2");
    await start("d3", "short", START);
    await act("d3", "call_person", "p-03");
    await finish("d3");
    expect(storedScore("d1")).toBeNull();
    const rec = await loadDrillRecord(db, SCOPE, "d3", LATER);
    if (rec === null || rec === "running") throw new Error("記録が無い");
    expect(rec.previous).toMatchObject({ id: "d1", scenario: "heavy_rain", numbers: { order: { matched: 0, total: 10 }, report: null, form9: 3 } });
    expect(storedScore("d1")).not.toBeNull();
    // 最初の訓練には前回が無い
    const first = await loadDrillRecord(db, SCOPE, "d1", LATER);
    if (first === null || first === "running") throw new Error("記録が無い");
    expect(first.previous).toBeNull();
  });
});

// ---------- 講評 ----------

const ANSWER = {
  summary: "A さんへの本人電話は早かった。次は B さんの人工呼吸器の電池が切れる前に訪問依頼を。",
  findings: [
    { person: "B さん", kind: "reached", text: "停電の 1 時間のあと、B さんへの手が無いまま電池の時計が切れた。訪問依頼か受入依頼を。", basis: "nanbyo-tsuiho-2022" },
    { person: "全体", kind: "report", text: "行政報告は早かった。", basis: "根拠なし" },
    // 登録簿に無い根拠は弾く
    { person: "A さん", kind: "order", text: "順番はよい。", basis: "who-2020" },
    // 医療の助言・使わない言葉は弾く
    { person: "C さん", kind: "reached", text: "透析の用量を減らすよう伝える。", basis: "jadp-dialysis-2023" },
    { person: "C さん", kind: "reached", text: "関連死の条件に近い。", basis: "jadp-dialysis-2023" },
    // 知らない仮名は弾く
    { person: "ZZ さん", kind: "order", text: "連絡がない。", basis: "根拠なし" },
    { person: "D さん", kind: "unknown_kind", text: "D さんの家族の着信は応答できた。", basis: "mhlw-bcp-2020" },
  ],
};

async function finishedWithActions(id = "d1") {
  await start(id);
  await act(id, "call_person", "p-03");
  await act(id, "call_person", "p-01");
  await act(id, "report_city", null);
  await finish(id);
}

const ENV = (key = true) => ({ DB: db, ...(key ? { ANTHROPIC_API_KEY: "dummy" } : {}) });

describe("講評（Opus 1 回）", () => {
  it("鍵が無ければ作らない（503 未設定）。採点の数字は残っている", async () => {
    await finishedWithActions();
    const f = fake(() => reply(ANSWER, OPUS));
    const res = await reviewPost(ENV(false), careManager(), "d1", {}, { claude: f.client });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_configured", label: "未設定" });
    expect(f.calls).toHaveLength(0);
    const s = storedScore("d1")!;
    expect(s.review).toBeNull();
    expect(scoreNumbers(s.score).form9).toBe(3);
  });

  it("仮名だけを渡し、登録簿に無い根拠・医療の助言・知らない仮名の指摘は捨てる。仮名は氏名に戻して残す。2 回目は呼ばない", async () => {
    await finishedWithActions();
    const f = fake(() => reply(ANSWER, OPUS));
    const res = await reviewPost(ENV(), careManager(), "d1", {}, { claude: f.client, now: () => new Date(LATER) });
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(1);
    const p = f.calls[0];
    expect(p.model).toBe(OPUS);
    expect(systemOf(p)).toContain(REVIEW_SYSTEM);
    expect(systemOf(p)).toContain("nanbyo-tsuiho-2022");
    // 渡した物に氏名・カナ・電話・町名・生年月日が無い
    const sent = JSON.stringify(p.messages);
    expect(findLeaks(sent, ALL_KEY)).toEqual([]);
    expect(sent).not.toMatch(/090-?0000/);
    const record = (JSON.parse(p.messages[0].content as string) as { 記録: { text: string } }).記録.text;
    expect(record).toContain("対応の順番の一致: 2/10");
    expect(record).toContain("様式 9 の空欄: 3");
    expect(record).toContain("本人電話 → ");

    const review = storedScore("d1")!.review!;
    expect(review.state).toBe("done");
    const shown = shownReview(review)!;
    expect(shown.edited).toBe(false);
    expect(shown.findings.map((x) => [x.person, x.kind, x.basis])).toEqual([
      ["p-08", "reached", "nanbyo-tsuiho-2022"],
      [null, "report", null],
      ["p-02", "other", "mhlw-bcp-2020"],
    ]);
    // 仮名は参加者の並び（担当一覧のカナ順: A 伊藤・B 井上・C 加藤・D 小林…）で付き、残すときは氏名に戻る
    expect(shown.findings[0].text).toContain("井上 誠さん");
    expect(shown.findings[0].text).not.toMatch(/[A-Z] ?さん/);
    expect(shown.summary).not.toMatch(/[A-Z] ?さん/);
    // 用途 scoring で 1 日の上限に数える
    expect(sqlite.prepare("SELECT purpose, status FROM ai_calls").all()).toEqual([{ purpose: "scoring", status: "ok" }]);
    // できていれば 2 回目は呼ばない
    const again = await reviewPost(ENV(), careManager(), "d1", {}, { claude: f.client });
    expect(again.status).toBe(200);
    expect(f.calls).toHaveLength(1);
  });

  it("ケアマネが直した講評は別に残し、AI の元は消さない。指摘を空にすると外れる", async () => {
    await finishedWithActions();
    const f = fake(() => reply(ANSWER, OPUS));
    await reviewPost(ENV(), careManager(), "d1", {}, { claude: f.client });
    const before = shownReview(storedScore("d1")!.review)!;
    const edit = { summary: "次は小林さんに先に訪問依頼。", findings: before.findings.map((x, i) => ({ text: i === 1 ? "" : `${x.text}（確認）` })) };
    const res = await reviewPost(ENV(), careManager(), "d1", { edit }, { now: () => new Date(LATER) });
    expect(res.status).toBe(200);
    const r = storedScore("d1")!.review!;
    if (r.state !== "done") throw new Error("講評が無い");
    expect(r.ai.findings).toHaveLength(3);
    expect(r.edited).toMatchObject({ summary: "次は小林さんに先に訪問依頼。", by: "山本", at: LATER });
    expect(r.edited!.findings).toHaveLength(2);
    expect(shownReview(r)!.edited).toBe(true);
    // 指摘の数が違う直しは 400
    expect((await reviewPost(ENV(), careManager(), "d1", { edit: { summary: "x", findings: [] } })).status).toBe(400);
  });

  it("失敗（形の違い）は残し、再作成できる。作成中は重ねて呼ばない", async () => {
    await finishedWithActions();
    const bad = fake(() => reply({ nope: true }, OPUS));
    const res = await reviewPost(ENV(), careManager(), "d1", {}, { claude: bad.client });
    expect(res.status).toBe(502);
    expect(storedScore("d1")!.review).toMatchObject({ state: "failed", error: "bad_output" });
    // 作成中（ほかの画面が作っている）なら呼ばずに今の物を返す
    sqlite
      .prepare("UPDATE drills SET score = json_set(score, '$.review', json(?)) WHERE id = 'd1'")
      .run(JSON.stringify({ state: "pending", at: new Date().toISOString() }));
    const ok = fake(() => reply(ANSWER, OPUS));
    const busy = await reviewPost(ENV(), careManager(), "d1", {}, { claude: ok.client });
    expect(await busy.json()).toMatchObject({ ok: true, review: { state: "pending" } });
    expect(ok.calls).toHaveLength(0);
    // 作成中が古ければ取り直す
    sqlite
      .prepare("UPDATE drills SET score = json_set(score, '$.review', json(?)) WHERE id = 'd1'")
      .run(JSON.stringify({ state: "pending", at: "2026-11-01T00:00:00.000Z" }));
    expect((await reviewPost(ENV(), careManager(), "d1", {}, { claude: ok.client })).status).toBe(200);
    expect(ok.calls).toHaveLength(1);
  });

  it("進行中の訓練は 409、ほかの役 403、事業所の外 404", async () => {
    await start("d1");
    expect((await reviewPost(ENV(), careManager(), "d1", {})).status).toBe(409);
    expect((await reviewPost(ENV(), null, "d1", {})).status).toBe(401);
    expect((await reviewPost(ENV(), careManager({ role: "medical", caseloadOf: null }), "d1", {})).status).toBe(403);
    const partner = careManager({ office: PARTNER, accountId: "acct-partner-cm", caseloadOf: "acct-partner-cm" });
    expect((await reviewPost(ENV(), partner, "d1", {})).status).toBe(404);
  });

  it("返事の検査（reviewBody）: 指摘は 8 つまで、文の長さで切る", () => {
    const { key } = pseudonymize(SEED_PEOPLE.slice(0, 2).map(seedInput), { on: "2026-11-05" });
    const many = { summary: "あ".repeat(400), findings: Array.from({ length: 12 }, () => ({ person: "A さん", kind: "order", text: "い".repeat(300), basis: "根拠なし" })) };
    const b = reviewBody(many, { key, members: new Set(["p-01", "p-02"]) });
    expect(b.findings).toHaveLength(8);
    expect(Array.from(b.findings[0].text)).toHaveLength(120);
    expect(Array.from(b.summary)).toHaveLength(240);
    expect(b.findings[0].person).toBe("p-01");
  });
});
