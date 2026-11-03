// 電話の「通話」と聞いた安否（docs/tasks/T58.md）を D1（node:sqlite に種の 10 人）で。
// 聞いた安否は人が確かめた事実として信号（出どころ care_manager）に乗り、色と連絡順はルールの表が決める。
// ケアマネの「無事」が置き換えない物（赤 けが・動けない・期限を過ぎた機器の時計・頼り先の未確認・時計の半分）をここで縛る。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { saveDisasterInfo, switchDisasterMode } from "../disaster/db.ts";
import { personDisaster } from "../disaster/person.ts";
import { disasterScope } from "../disaster/scope.ts";
import { loadPersonPage } from "../person.ts";
import { NO_ANSWERS, type SignalBody } from "../signals/body.ts";
import { saveSignal, signalScope } from "../signals/save.ts";
import { callLogBody, heardText, parseCallPayload, parseHeard } from "./calls.ts";
import { callPost } from "./http.ts";

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

/** 審査員の本人のスマホ（p-01） */
const self = (): Principal => ({
  role: "self",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: "山田 ハナ",
  office: DEMO,
  caseloadOf: null,
  personId: "p-01",
  contactId: null,
});

/** 浸水と停電の時刻（2026-11-05 18:00 JST）。発災は -2 時間。停電は事業所全体で 0 時間から */
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };
const TODAY = "2026-11-05";

async function heavyRain() {
  const scope = disasterScope(careManager())!;
  expect(await switchDisasterMode(db, scope, { kind: "heavy_rain", version: 0, at: at(-2) })).toEqual({ ok: true, changed: true });
  expect(
    await saveDisasterInfo(db, scope, {
      version: 1,
      at: at(0),
      info: { startedAt: at(-2), outage: { scope: "office", towns: [], startedAt: at(0) }, alertLevel: 4, water: null, road: null },
    }),
  ).toEqual({ ok: true, changed: true });
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const red = (answers: Partial<SignalBody["answers"]>, time: string): SignalBody => ({
  id: uuid(),
  color: "red",
  whereNow: null,
  answers: { ...NO_ANSWERS, ...answers },
  occurredAt: time,
  sentAt: time,
});

const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
const contactOf = (person: string, kind = "family") =>
  rows(`SELECT id, relation FROM contacts WHERE person_id = '${person}' AND kind = '${kind}' ORDER BY sort LIMIT 1`)[0] as {
    id: string;
    relation: string | null;
  };

async function row(id: string, h: number) {
  const data = await loadCaseload(db, SCOPE, TODAY, at(h));
  return data!.rows.find((r) => r.id === id)!;
}

async function call(person: string, body: Record<string, unknown>, h: number, p: Principal | null = careManager()) {
  const res = await callPost(db, p, { person, ...body }, at(h));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("通話と聞いた安否の保存", () => {
  it("安否なしの通話は経過だけ（平時も残せる）。本文は「家族 娘 通話」、メモは payload だけ", async () => {
    const c = contactOf("p-01");
    expect((await call("p-01", { contact: c.id, result: "connected", memo: " 夕方にもう一度 " }, 1)).status).toBe(200);
    const t = rows("SELECT body, payload, signal_id FROM timeline_entries WHERE kind = 'called'");
    expect(t).toHaveLength(1);
    expect(t[0].body).toBe(`家族 ${c.relation} 通話`);
    expect(String(t[0].body)).not.toContain("夕方");
    expect(t[0].signal_id).toBeNull();
    expect(parseCallPayload(String(t[0].payload))).toMatchObject({ result: "connected", memo: "夕方にもう一度" });
    expect(rows("SELECT * FROM signals")).toEqual([]);
  });

  it("安否つきは 1 つの batch で信号（care_manager、訓練でない）と経過（signal_id・payload に heard とメモ）", async () => {
    await heavyRain();
    const c = contactOf("p-01");
    const r = await call("p-01", { contact: c.id, result: "connected", heard: { color: "green" }, memo: "停電 ボンベ使用" }, 0.5);
    expect(r).toEqual({ status: 200, json: { ok: true } });
    const s = rows("SELECT id, person_id, drill_id, color, source, injured, can_move, occurred_at FROM signals");
    expect(s).toEqual([
      { id: s[0].id, person_id: "p-01", drill_id: null, color: "green", source: "care_manager", injured: null, can_move: null, occurred_at: at(0.5) },
    ]);
    const t = rows("SELECT body, payload, signal_id FROM timeline_entries WHERE kind = 'called'")[0];
    expect(t.signal_id).toBe(s[0].id);
    expect(t.body).toBe(`家族 ${c.relation} 通話 無事`);
    expect(String(t.body)).not.toContain("ボンベ");
    expect(parseCallPayload(String(t.payload))).toMatchObject({ heard: { color: "green" }, memo: "停電 ボンベ使用" });

    // 行の詳細: 電話の記録にメモ、連絡先の最後の電話に「通話 無事」、距離
    const d = (await row("p-01", 0.6)).detail!;
    expect(d.calls[0]).toMatchObject({ result: "connected", heard: { color: "green" }, memo: "停電 ボンベ使用" });
    const fam = d.contacts.find((x) => x.id === c.id)!;
    expect(fam.lastCall).toMatchObject({ result: "connected", heard: { color: "green" } });
    expect(fam.reach).toBe("市内");
    expect(d.contacts.find((x) => x.kind === "self")!.reach).toBeNull();
    expect(d.signals[0]).toMatchObject({ source: "ケアマネ", color: "green" });
  });

  it("無事でない＋けが・動けないは本人・家族の答えと同じ列（injured 1・can_move 0）。選ばない問いは null", async () => {
    await heavyRain();
    const c = contactOf("p-02");
    expect((await call("p-02", { contact: c.id, result: "connected", heard: { color: "red", injured: true, canMove: false } }, 1)).status).toBe(200);
    const c3 = contactOf("p-03");
    expect((await call("p-03", { contact: c3.id, result: "connected", heard: { color: "red" } }, 1)).status).toBe(200);
    expect(rows("SELECT person_id, color, injured, can_move FROM signals ORDER BY person_id")).toEqual([
      { person_id: "p-02", color: "red", injured: 1, can_move: 0 },
      { person_id: "p-03", color: "red", injured: null, can_move: null },
    ]);
    expect(rows("SELECT body FROM timeline_entries WHERE kind = 'called' ORDER BY person_id").map((x) => x.body)).toEqual([
      `家族 ${c.relation} 通話 無事でない けが 動けない`,
      `家族 ${c3.relation} 通話 無事でない`,
    ]);
  });

  it("断る: 平時の安否 409（通話だけは通る）、範囲の外の連絡先 404、通話でない結果の安否・メモ 400、メモ 101 字 400、形の違う安否 400、ケアマネでない 403", async () => {
    const c = contactOf("p-01");
    const other = contactOf("p-02");
    expect(await call("p-01", { contact: c.id, result: "connected", heard: { color: "green" } }, 1)).toEqual({
      status: 409,
      json: { ok: false, error: "normal", label: "平時" },
    });
    await heavyRain();
    expect((await call("p-01", { contact: other.id, result: "connected", heard: { color: "green" } }, 1)).status).toBe(404);
    expect((await call("p-01", { contact: c.id, result: "no_answer", heard: { color: "green" } }, 1)).status).toBe(400);
    expect((await call("p-01", { contact: c.id, result: "dialed", memo: "a" }, 1)).status).toBe(400);
    expect((await call("p-01", { contact: c.id, result: "connected", memo: "あ".repeat(101) }, 1)).status).toBe(400);
    expect((await call("p-01", { contact: c.id, result: "connected", heard: { color: "yellow" } }, 1)).status).toBe(400);
    expect((await call("p-01", { contact: c.id, result: "connected", heard: { color: "red", injured: "yes" } }, 1)).status).toBe(400);
    expect((await call("p-01", { contact: c.id, result: "connected", memo: 3 }, 1)).status).toBe(400);
    expect((await call("p-01", { contact: c.id, result: "connected", heard: { color: "green" } }, 1, self())).status).toBe(403);
    expect((await call("p-01", { contact: c.id, result: "connected", heard: { color: "green" } }, 1, null)).status).toBe(401);
    expect(rows("SELECT * FROM signals")).toEqual([]);
    expect(rows("SELECT * FROM timeline_entries WHERE kind = 'called'")).toEqual([]);
    // 100 字ちょうどは通る
    expect((await call("p-01", { contact: c.id, result: "connected", memo: "あ".repeat(100) }, 1)).status).toBe(200);
  });
});

describe("聞いた安否と表の色（色と連絡順は表だけ）", () => {
  it("ケアマネの「無事」で緑・連絡順が一番下へ。理由は表の言葉「ケアマネが「無事」」", async () => {
    await heavyRain();
    const before = await row("p-09", 0.5);
    expect(before.triage).toMatchObject({ color: "gray", rule: "unknown" });
    await call("p-09", { contact: contactOf("p-09").id, result: "connected", heard: { color: "green" } }, 0.5);
    const data = await loadCaseload(db, SCOPE, TODAY, at(0.6));
    const after = data!.rows.find((r) => r.id === "p-09")!;
    expect(after.triage).toMatchObject({ color: "green", rule: "green", reason: "ケアマネが「無事」" });
    expect(after.rank).toBe(data!.rows.length);
    // 本人のページも同じ色
    const page = await loadPersonPage(db, careManager(), "p-09");
    expect((await personDisaster(db, page!, at(0.6))).triage).toMatchObject({ color: "green", reason: "ケアマネが「無事」" });
  });

  it("ケアマネの緑のあとに本人の赤 → 赤", async () => {
    await heavyRain();
    await call("p-01", { contact: contactOf("p-01").id, result: "connected", heard: { color: "green" } }, 0.3);
    expect((await row("p-01", 0.4)).triage).toMatchObject({ color: "green" });
    await saveSignal(db, signalScope(self())!, red({}, at(0.5)), at(0.5));
    expect((await row("p-01", 0.6)).triage).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });
  });

  it("ケアマネの緑のあとに機器の時計が半分 → 黄、切れる → 赤（green_out_after_report）", async () => {
    await heavyRain();
    // 酸素 内蔵電池 2 時間（停電 0 時間から）
    await call("p-01", { contact: contactOf("p-01").id, result: "connected", heard: { color: "green" } }, 0.5);
    expect((await row("p-01", 0.6)).triage).toMatchObject({ color: "green", rule: "green" });
    expect((await row("p-01", 1.5)).triage).toMatchObject({ color: "yellow", rule: "green_device_low" });
    expect((await row("p-01", 3)).triage).toMatchObject({
      color: "red",
      rule: "green_out_after_report",
      reason: "無事の報告のあとに電池が切れた、酸素 内蔵電池 2 時間を超過",
    });
  });

  it("頼り先が未確認の人はケアマネの緑でも黄（green_unchecked）", async () => {
    await heavyRain();
    await call("p-03", { contact: contactOf("p-03").id, result: "connected", heard: { color: "green" } }, 1);
    expect((await row("p-03", 1.1)).triage).toMatchObject({ color: "yellow", rule: "green_unchecked", reason: "無事・透析先 未確認" });
  });

  it("機器以外の時計の半分を過ぎた人はケアマネの緑でも黄（green_clock_half）", async () => {
    await heavyRain();
    // 栄養剤 3 日（発災 -2 時間から）。半分の 36 時間を過ぎたあと
    await call("p-06", { contact: contactOf("p-06").id, result: "connected", heard: { color: "green" } }, 40);
    expect((await row("p-06", 40.1)).triage).toMatchObject({ color: "yellow", rule: "green_clock_half" });
  });

  it("ケアマネが聞いた「無事でない けが」は赤の最上位（red_injury）", async () => {
    await heavyRain();
    await call("p-02", { contact: contactOf("p-02").id, result: "connected", heard: { color: "red", injured: true } }, 1);
    const data = await loadCaseload(db, SCOPE, TODAY, at(1.1));
    const r = data!.rows.find((x) => x.id === "p-02")!;
    expect(r.triage).toMatchObject({ color: "red", rule: "red_injury", group: 0, reason: "ケアマネが「けが」" });
    expect(r.rank).toBe(1);
  });

  it("赤 けが・動けない の人への「無事」は書かずに断る（至急維持）。色・理由・連絡順は変わらない", async () => {
    await heavyRain();
    await saveSignal(db, signalScope(self())!, red({ canMove: false }, at(0.5)), at(0.5));
    const before = await row("p-01", 0.7);
    expect(before.triage).toMatchObject({ rule: "red_injury", reason: "本人が「動けない」" });
    const r = await call("p-01", { contact: contactOf("p-01").id, result: "connected", heard: { color: "green" }, memo: "本人は大丈夫と" }, 0.6);
    expect(r).toEqual({ status: 409, json: { ok: false, error: "injury", label: "至急維持" } });
    expect(rows("SELECT * FROM signals WHERE source = 'care_manager'")).toEqual([]);
    expect(rows("SELECT * FROM timeline_entries WHERE kind = 'called'")).toEqual([]);
    const after = await row("p-01", 0.7);
    expect(after.triage).toMatchObject({ rule: "red_injury", reason: "本人が「動けない」" });
    expect(after.rank).toBe(before.rank);
    // 安否なしの通話（聞けず）とメモは残せる
    expect((await call("p-01", { contact: contactOf("p-01").id, result: "connected", memo: "折り返し待ち" }, 0.6)).status).toBe(200);
    expect((await row("p-01", 0.7)).triage).toMatchObject({ rule: "red_injury" });
  });

  it("ケアマネが直した分類の けが（red_injury）にも「無事」は断る", async () => {
    await heavyRain();
    await saveSignal(db, signalScope(self())!, red({}, at(0.5)), at(0.5));
    sqlite.exec(`UPDATE signals SET classes = '["injury"]', classified_by = 'care_manager' WHERE source = 'self'`);
    expect((await row("p-01", 0.6)).triage).toMatchObject({ rule: "red_injury" });
    expect((await call("p-01", { contact: contactOf("p-01").id, result: "connected", heard: { color: "green" } }, 0.6)).status).toBe(409);
  });

  it("Claude の分類（けが）だけの赤は red のまま。ケアマネの「無事」は表に渡り緑に戻る（分類は色・順を動かさない）", async () => {
    await heavyRain();
    await saveSignal(db, signalScope(self())!, red({}, at(0.5)), at(0.5));
    sqlite.exec(`UPDATE signals SET classes = '["injury"]', classified_by = 'claude' WHERE source = 'self'`);
    expect((await row("p-01", 0.6)).triage).toMatchObject({ rule: "red", reason: "本人が「無事じゃない」、録音の分類（AI）: けが" });
    expect((await call("p-01", { contact: contactOf("p-01").id, result: "connected", heard: { color: "green" } }, 0.6)).status).toBe(200);
    expect((await row("p-01", 0.7)).triage).toMatchObject({ color: "green", reason: "ケアマネが「無事」" });
  });

  it("問い（docs/progress/t58.md）: 本人の 赤 けが のあとのケアマネの「無事でない」（けが・動けないを選ばない）は red に（色は赤のまま、組は 0 → 1）", async () => {
    await heavyRain();
    await saveSignal(db, signalScope(self())!, red({ injured: true }, at(0.5)), at(0.5));
    expect((await call("p-01", { contact: contactOf("p-01").id, result: "connected", heard: { color: "red" } }, 0.6)).status).toBe(200);
    expect((await row("p-01", 0.7)).triage).toMatchObject({ color: "red", rule: "red", group: 1, reason: "ケアマネが「無事じゃない」" });
  });
});

describe("言葉と形", () => {
  it("聞いた安否の読み方: 緑は けが・動けない を持たない。けが false・動けない true は持たない", () => {
    expect(parseHeard({ color: "green", injured: true })).toEqual({ color: "green" });
    expect(parseHeard({ color: "red", injured: false, canMove: true })).toEqual({ color: "red" });
    expect(parseHeard({ color: "red", injured: true, canMove: false })).toEqual({ color: "red", injured: true, canMove: false });
    expect(parseHeard({ color: "unknown" })).toBeNull();
    expect(parseHeard(null)).toBeNull();
    expect(heardText({ color: "red", canMove: false })).toBe("無事でない 動けない");
    expect(callLogBody({ kind: "self", relation: null }, "connected")).toBe("本人 通話");
    // 前の形の payload（heard・memo なし）も読める
    expect(parseCallPayload(JSON.stringify({ source: "call", contactId: "c", contactKind: "family", result: "dialed" }))).toEqual({
      source: "call",
      contactId: "c",
      contactKind: "family",
      result: "dialed",
    });
  });

  it("メモは Claude の入力に無い: askJson を呼ぶ所は経過の表（timeline_entries）を読まない", () => {
    const ROOT = join(__dirname, "..", "..");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return files(p);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
      });
    const callers = [...files(join(ROOT, "lib")), ...files(join(ROOT, "app"))].filter((f) => {
      const s = readFileSync(f, "utf8");
      return /\baskJson\(/.test(s) && !f.replaceAll("\\", "/").endsWith("lib/claude/call.ts");
    });
    expect(callers.length).toBeGreaterThan(0);
    const reading = callers.filter((f) => /timeline_entries|callLogsOf|parseCallPayload/.test(readFileSync(f, "utf8")));
    expect(reading.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
