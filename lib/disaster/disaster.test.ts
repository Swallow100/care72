// 災害モード（docs/tasks/T09.md）: 切替の権限、事業所の経過、停電の開始時刻がルールの表の入力に渡ること、
// 災害モードで担当一覧・本人のページ・様式 9 の色と並びが変わること。D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload, sortCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadForm9, loadSituation as loadForm9Situation } from "../forms/form9-db.ts";
import { loadPersonPage, toPersonView } from "../person.ts";
import {
  loadDisasterState,
  loadOfficeLog,
  loadOfficeTowns,
  loadSituation,
  logLine,
  saveDisasterInfo,
  switchDisasterMode,
} from "./db.ts";
import { infoPost, modePost, officeHref } from "./http.ts";
import { personDisaster } from "./person.ts";
import { disasterScope } from "./scope.ts";
import {
  disasterMark,
  fromLocalInput,
  inOutageArea,
  parseInfoForm,
  personSituation,
  toLocalInput,
  toSituation,
  type DisasterInfo,
} from "./state.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

const principal = (p: Partial<Principal> = {}): Principal => ({
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

const YAMAMOTO = disasterScope(principal())!;

/** 浸水と停電の時刻（2026-11-04 10:00 JST）。h 時間あとの時刻は at(h) */
const FLOOD = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** 大雨に入れて、停電（事業所全体）の始まりを入れる。発災は at(-2)、停電は at(0)（heavy-rain.test.ts の筋と同じ） */
async function heavyRain(outage: DisasterInfo["outage"] = { scope: "office", towns: [], startedAt: at(0) }) {
  expect(await switchDisasterMode(db, YAMAMOTO, { kind: "heavy_rain", version: 0, at: at(-2) })).toEqual({ ok: true, changed: true });
  const r = await saveDisasterInfo(db, YAMAMOTO, {
    version: 1,
    at: at(0),
    info: { startedAt: at(-2), outage, alertLevel: 4, water: null, road: null },
  });
  expect(r).toEqual({ ok: true, changed: true });
}

describe("切替の権限", () => {
  it("ケアマネの役（管理者・管理者でないケアマネ・審査員のケアマネの役）だけ。範囲は自分の事業所", () => {
    expect(disasterScope(principal())).toEqual({ officeId: "office-demo", authorId: "acct-yamamoto", authorRole: "care_manager" });
    expect(disasterScope(principal({ admin: false }))?.officeId).toBe("office-demo");
    expect(disasterScope(principal({ admin: false, judge: true, accountId: "acct-judge" }))).toEqual({
      officeId: "office-demo",
      authorId: "acct-judge",
      authorRole: "care_manager",
    });
  });

  it("行政・医療班は押せない（本人の経過を書く save は持つが、事業所の状態は変えない）。本人・家族・役未選択も", () => {
    for (const role of ["government", "medical", "self", "family", "unselected"] as const) {
      expect(disasterScope(principal({ role, admin: false, caseloadOf: null })), role).toBeNull();
    }
    expect(disasterScope(principal({ office: null }))).toBeNull();
    expect(disasterScope(null)).toBeNull();
  });

  it("POST: 行政・医療班は 403、ログインなしは 401。表は平時のまま、経過も増えない", async () => {
    const f = form({ kind: "heavy_rain", version: "0" });
    expect(await modePost(db, principal({ role: "government", admin: false, caseloadOf: null }), f, at(0))).toEqual({ status: 403 });
    expect(await modePost(db, principal({ role: "medical", admin: false, caseloadOf: null }), f, at(0))).toEqual({ status: 403 });
    expect(await modePost(db, principal({ role: "family", personId: "p-01", caseloadOf: null }), f, at(0))).toEqual({ status: 403 });
    expect(await modePost(db, null, f, at(0))).toEqual({ status: 401 });
    const info = form({ version: "0", started: "2026-11-04T08:00", outage: "none", level: "" });
    expect(await infoPost(db, principal({ role: "medical", admin: false, caseloadOf: null }), info, at(0))).toEqual({ status: 403 });
    expect((await loadDisasterState(db, "office-demo")).kind).toBe("normal");
    expect(count("disaster_state")).toBe(0);
    expect(count("office_timeline_entries")).toBe(0);
  });

  it("POST: 管理者でないケアマネも押せる。押した人が経過に残る", async () => {
    const r = await modePost(db, principal({ admin: false }), form({ kind: "earthquake", version: "0" }), at(0));
    expect(r).toEqual({ status: 303, location: "/office" });
    const log = await loadOfficeLog(db, "office-demo");
    expect(log.map(logLine)).toEqual(["災害モード 地震 山本 11/4 10:00"]);
  });
});

describe("切替と事業所の経過", () => {
  it("大雨に入れると、発災は押した時刻・押した人が残り、経過に「災害モード 大雨 山本 11/4 10:42」", async () => {
    const pressed = "2026-11-04T01:42:00.000Z";
    expect(await switchDisasterMode(db, YAMAMOTO, { kind: "heavy_rain", version: 0, at: pressed })).toEqual({ ok: true, changed: true });
    const s = await loadDisasterState(db, "office-demo");
    expect(s).toMatchObject({ kind: "heavy_rain", startedAt: pressed, startedByName: "山本", version: 1, updatedByName: "山本" });
    expect(s.outage).toEqual({ scope: "none", towns: [], startedAt: null });
    const log = await loadOfficeLog(db, "office-demo");
    expect(log.map(logLine)).toEqual(["災害モード 大雨 山本 11/4 10:42"]);
    expect(log[0]).toMatchObject({ kind: "disaster_on", label: "災害モード", body: "大雨", who: "山本", at: pressed });
  });

  it("審査員（ケアマネの役）が押すと書き手は審査員", async () => {
    const judge = disasterScope(principal({ admin: false, judge: true, accountId: "acct-judge" }))!;
    await switchDisasterMode(db, judge, { kind: "heavy_rain", version: 0, at: at(0) });
    expect((await loadOfficeLog(db, "office-demo")).map(logLine)).toEqual(["災害モード 大雨 審査員 11/4 10:00"]);
  });

  it("画面で読んだ版が古ければ競合（重なった切替は片方だけ）。同じ状態を押しても何も書かない", async () => {
    await switchDisasterMode(db, YAMAMOTO, { kind: "heavy_rain", version: 0, at: at(0) });
    expect(await switchDisasterMode(db, YAMAMOTO, { kind: "earthquake", version: 0, at: at(0.1) })).toEqual({ ok: false, error: "conflict" });
    expect(await switchDisasterMode(db, YAMAMOTO, { kind: "heavy_rain", version: 1, at: at(0.2) })).toEqual({ ok: true, changed: false });
    expect(count("office_timeline_entries")).toBe(1);
    expect((await loadDisasterState(db, "office-demo")).version).toBe(1);
  });

  it("大雨 → 地震は種類だけ替え、発災・停電はそのまま。警戒レベルは大雨の場面の種類だけなので空に（11/3 21:5x 確定、T60）", async () => {
    await heavyRain();
    expect(await switchDisasterMode(db, YAMAMOTO, { kind: "earthquake", version: 2, at: at(1) })).toEqual({ ok: true, changed: true });
    const s = await loadDisasterState(db, "office-demo");
    expect(s).toMatchObject({ kind: "earthquake", startedAt: at(-2), alertLevel: null, version: 3 });
    expect(s.outage).toEqual({ scope: "office", towns: [], startedAt: at(0) });
  });

  it("平時に戻すは確認が要る。確認のあとは発災・停電・レベル・断水・道路を全部空に戻し、経過に「平時」", async () => {
    await heavyRain();
    const noConfirm = await modePost(db, principal(), form({ kind: "normal", version: "2" }), at(5));
    expect(noConfirm).toEqual({ status: 303, location: officeHref({ confirm: true }) });
    expect((await loadDisasterState(db, "office-demo")).kind).toBe("heavy_rain");

    const done = await modePost(db, principal(), form({ kind: "normal", version: "2", confirm: "1" }), at(5));
    expect(done).toEqual({ status: 303, location: "/office" });
    const s = await loadDisasterState(db, "office-demo");
    expect(s).toMatchObject({ kind: "normal", startedAt: null, startedByName: null, alertLevel: null, water: null, road: null, version: 3 });
    expect(s.outage).toEqual({ scope: "none", towns: [], startedAt: null });
    expect(await loadSituation(db, "office-demo", at(5))).toBeNull();
    expect((await loadOfficeLog(db, "office-demo")).map(logLine)).toEqual([
      "平時 山本 11/4 15:00",
      "災害情報 停電 事業所全体 11/4 10:00〜・警戒レベル 4 山本 11/4 10:00",
      "災害モード 大雨 山本 11/4 08:00",
    ]);
  });

  it("平時に戻したあとに入れ直すと、前の停電の時刻は残らない（発災も押し直した時刻）", async () => {
    await heavyRain();
    await switchDisasterMode(db, YAMAMOTO, { kind: "normal", version: 2, at: at(5) });
    await switchDisasterMode(db, YAMAMOTO, { kind: "earthquake", version: 3, at: at(6) });
    expect(await loadSituation(db, "office-demo", at(7))).toEqual({
      now: at(7),
      disasterAt: at(6),
      outageAt: null,
      outageTowns: null,
    });
  });

  it("表の CHECK: 平時の行に停電・レベルは入らない", () => {
    expect(() =>
      sqlite.exec(
        `INSERT INTO disaster_state (office_id, kind, outage_scope, outage_started_at, updated_at)
         VALUES ('office-demo', 'normal', 'office', '${at(0)}', '${at(0)}');`,
      ),
    ).toThrow();
  });

  it("種を入れ直すと平時に戻り、事業所の経過も消える（事業所と一緒に）", async () => {
    await heavyRain();
    for (const s of seedStatements()) sqlite.exec(s);
    expect(count("disaster_state")).toBe(0);
    expect(count("office_timeline_entries")).toBe(0);
  });
});

describe("災害の情報", () => {
  it("平時は入れられない", async () => {
    const r = await saveDisasterInfo(db, YAMAMOTO, {
      version: 0,
      at: at(0),
      info: { startedAt: at(0), outage: { scope: "none", towns: [], startedAt: null }, alertLevel: null, water: null, road: null },
    });
    expect(r).toEqual({ ok: false, error: "normal" });
  });

  it("更新のたびに変わった所だけ経過に残る。変わらなければ書かない", async () => {
    await heavyRain();
    const base = { startedAt: at(-2), outage: { scope: "office" as const, towns: [], startedAt: at(0) }, alertLevel: 4 as const, water: null, road: null };
    expect(await saveDisasterInfo(db, YAMAMOTO, { version: 2, at: at(1), info: base })).toEqual({ ok: true, changed: false });
    expect(
      await saveDisasterInfo(db, YAMAMOTO, {
        version: 2,
        at: at(1),
        info: { ...base, alertLevel: 5, water: "東部で断水", road: "県道 通行止め" },
      }),
    ).toEqual({ ok: true, changed: true });
    expect((await loadOfficeLog(db, "office-demo"))[0].body).toBe("警戒レベル 5・断水 東部で断水・道路 県道 通行止め");
    expect(count("office_timeline_entries")).toBe(3);
    // 古い版の保存は競合
    expect(await saveDisasterInfo(db, YAMAMOTO, { version: 2, at: at(2), info: base })).toEqual({ ok: false, error: "conflict" });
  });

  it("フォーム: 時刻は日本の時刻。停電の地区は町名を選ぶ。先の時刻・開始時刻なし・地区なしは断る", () => {
    const now = at(0); // 11/4 10:00 JST
    const ok = parseInfoForm(
      form({
        version: "1",
        started: "2026-11-04T08:00",
        outage: "area",
        outage_at: "2026-11-04T10:00",
        town: ["かわなぎ町", "かわなぎ町", "みずほし町"],
        level: "4",
        water: " ",
        road: "国道 片側通行",
      }),
      now,
    );
    expect(ok).toEqual({
      ok: true,
      version: 1,
      value: {
        startedAt: at(-2),
        outage: { scope: "area", towns: ["かわなぎ町", "みずほし町"], startedAt: at(0) },
        alertLevel: 4,
        water: null,
        road: "国道 片側通行",
      },
    });
    const bad = (fields: Record<string, string | string[]>) =>
      parseInfoForm(form({ version: "1", started: "2026-11-04T08:00", outage: "office", outage_at: "2026-11-04T09:00", level: "", ...fields }), now);
    expect(bad({ started: "2026-11-04T11:00" })).toEqual({ ok: false, error: "future" });
    expect(bad({ outage_at: "" })).toEqual({ ok: false, error: "outage_at" });
    expect(bad({ outage: "area" })).toEqual({ ok: false, error: "towns" });
    expect(bad({ level: "6" })).toEqual({ ok: false, error: "bad" });
    expect(bad({ outage: "town" })).toEqual({ ok: false, error: "bad" });
    expect(bad({ started: "2026-02-30T08:00" })).toEqual({ ok: false, error: "started" });
    expect(bad({ road: "あ".repeat(201) })).toEqual({ ok: false, error: "long" });
    // 停電なしなら開始時刻は見ない
    expect(bad({ outage: "none", outage_at: "" })).toMatchObject({ ok: true, value: { outage: { scope: "none", startedAt: null } } });
  });

  it("datetime-local の値と ISO の行き来（日本の時刻）", () => {
    expect(fromLocalInput("2026-11-04T10:42")).toBe("2026-11-04T01:42:00.000Z");
    expect(toLocalInput("2026-11-04T01:42:00.000Z")).toBe("2026-11-04T10:42");
    expect(fromLocalInput("2026-11-04 10:42")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });

  it("情報の POST: 保存して画面へ戻る。誤りは理由を付けて戻る", async () => {
    await switchDisasterMode(db, YAMAMOTO, { kind: "heavy_rain", version: 0, at: at(-2) });
    const fields = { version: "1", started: "2026-11-04T08:00", outage: "office", outage_at: "2026-11-04T10:00", level: "3" };
    expect(await infoPost(db, principal(), form({ ...fields, outage_at: "" }), at(1))).toEqual({
      status: 303,
      location: "/office?error=outage_at",
    });
    expect(await infoPost(db, principal(), form(fields), at(1))).toEqual({ status: 303, location: "/office" });
    expect(await infoPost(db, principal(), form({ ...fields, level: "4" }), at(1))).toEqual({
      status: 303,
      location: "/office?error=conflict",
    });
  });
});

describe("停電の開始時刻がルールの表の入力に渡る", () => {
  it("今・発災・停電の始まり（様式 9 の loadSituation も同じ）", async () => {
    await heavyRain();
    const expected = { now: at(3), disasterAt: at(-2), outageAt: at(0), outageTowns: null };
    expect(await loadSituation(db, "office-demo", at(3))).toEqual(expected);
    expect(await loadForm9Situation(db, "office-demo", at(3))).toEqual(expected);
    // 停電なしなら停電の始まりは null。平時の事業所は null
    expect(await loadSituation(db, "office-partner", at(3))).toBeNull();
  });

  it("停電の範囲が地区なら、地区の外の人は停電なし。町名の無い人は外さない", () => {
    const s = { now: at(3), disasterAt: at(-2), outageAt: at(0), outageTowns: ["みずほし町"] };
    expect(personSituation(s, "みずほし町").outageAt).toBe(at(0));
    expect(personSituation(s, "かわなぎ町").outageAt).toBeNull();
    expect(personSituation(s, null).outageAt).toBe(at(0));
    expect(personSituation({ ...s, outageTowns: null }, "かわなぎ町").outageAt).toBe(at(0));
    expect(inOutageArea(["みずほし町"], " みずほし町 ")).toBe(true);
  });

  it("事業所の町名と人数（地区を選ぶ欄）", async () => {
    const towns = await loadOfficeTowns(db, "office-demo");
    expect(towns.reduce((n, t) => n + t.count, 0)).toBe(10);
    expect(towns.find((t) => t.town === "かわなぎ町")?.count).toBe(2);
  });

  it("ヘッダーの印: 平時は「平時」、大雨は「レベル 4」「停電 3 時間」", async () => {
    expect(disasterMark(await loadDisasterState(db, "office-demo"), at(0))).toEqual({ kind: "normal", label: "平時" });
    await heavyRain();
    const s = await loadDisasterState(db, "office-demo");
    expect(disasterMark(s, at(3))).toEqual({ kind: "disaster", label: "大雨", details: ["レベル 4", "停電 3 時間"] });
    expect(disasterMark(s, at(0.5))).toMatchObject({ details: ["レベル 4", "停電 30 分"] });
    expect(toSituation(s, at(3))?.outageAt).toBe(at(0));
  });
});

describe("災害モードで並びが変わる（担当一覧・本人のページ・様式 9）", () => {
  const scope = { officeId: "office-demo", careManagerId: "acct-yamamoto" };
  const CHAR = { red: "赤", yellow: "黄", gray: "灰", green: "緑" } as const;

  it("平時は優先の骨格の順（色なし）", async () => {
    const data = await loadCaseload(db, scope, "2026-11-04", at(3));
    expect(data?.situation).toBeNull();
    expect(data?.rows.every((r) => r.triage === null)).toBe(true);
    expect(sortCaseload(data!.rows, "tier").map((r) => r.id).slice(0, 3)).toEqual(["p-02", "p-01", "p-03"]);
  });

  it("大雨・停電 3 時間: 小林が田中より上（呼吸器の電池の半分を過ぎた）、田中は黄「透析先 未確認」", async () => {
    await heavyRain();
    const data = await loadCaseload(db, scope, "2026-11-04", at(3));
    expect(data?.situation).toEqual({ now: at(3), disasterAt: at(-2), outageAt: at(0), outageTowns: null });
    const lines = sortCaseload(data!.rows, "tier").map((r) => `${r.name.split(" ")[0]} ${CHAR[r.triage!.color]} ${r.triage!.reason}`);
    expect(lines.slice(0, 3)).toEqual([
      "山田 赤 酸素 内蔵電池 2 時間を超過",
      "小林 黄 人工呼吸器 内蔵電池 残り 0 分、連絡なし 5 時間",
      "田中 黄 透析先 未確認、連絡なし 5 時間",
    ]);
    // 3 時間を過ぎたら小林は赤
    const later = await loadCaseload(db, scope, "2026-11-04", at(3.5));
    const kobayashi = later!.rows.find((r) => r.id === "p-02")!;
    expect(kobayashi.triage).toMatchObject({ color: "red", rule: "unknown_device_over" });
  });

  it("停電の地区の外（小林のかわなぎ町を外す）なら、呼吸器の時計は走らず灰", async () => {
    await heavyRain({ scope: "area", towns: ["みずほし町"], startedAt: at(0) });
    const data = await loadCaseload(db, scope, "2026-11-04", at(6));
    expect(data!.rows.find((r) => r.id === "p-02")!.triage).toMatchObject({ color: "gray", rule: "unknown" });
    expect(data!.rows.find((r) => r.id === "p-03")!.triage?.reason).toContain("透析先 未確認");
  });

  it("信号の表を読む: 発災のあとの赤は使い、訓練の信号と発災の前の信号は使わない", async () => {
    await heavyRain();
    sqlite.exec(`INSERT INTO drills (id, office_id, scenario, status, started_at) VALUES ('d1', 'office-demo', 'short', 'running', '${at(0)}');`);
    sqlite.exec(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('s1', 'p-09', 'red', 'self', '${at(1)}');`);
    sqlite.exec(`INSERT INTO signals (id, person_id, drill_id, color, source, occurred_at) VALUES ('s2', 'p-10', 'd1', 'red', 'agent', '${at(1)}');`);
    sqlite.exec(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('s3', 'p-07', 'red', 'self', '${at(-3)}');`);
    const data = await loadCaseload(db, scope, "2026-11-04", at(3));
    const row = (id: string) => data!.rows.find((r) => r.id === id)!.triage!;
    expect(row("p-09")).toMatchObject({ color: "red", reason: "本人が「無事じゃない」" });
    expect(row("p-10").color).toBe("gray");
    expect(row("p-07").color).toBe("gray");
  });

  it("本人のページ: 災害モードなら経過が一番上、上に色と理由の 1 行。平時は骨格", async () => {
    const rows = await loadPersonPage(db, principal(), "p-03");
    expect(await personDisaster(db, rows!, at(3))).toEqual({ mode: "normal", triage: null, situation: null });
    await heavyRain();
    const d = await personDisaster(db, rows!, at(3));
    expect(d.mode).toBe("disaster");
    const view = toPersonView(rows!, { today: "2026-11-04", mode: d.mode, triage: d.triage });
    expect(view.sections[0].id).toBe("timeline");
    expect(view.head.priority).toMatchObject({ kind: "triage", color: "yellow", label: "要確認", reason: "透析先 未確認、連絡なし 5 時間" });
  });

  it("様式 9 も同じ色と順位（災害モードの表から読む）", async () => {
    await heavyRain();
    const situation = await loadForm9Situation(db, "office-demo", at(3));
    const sheet = (await loadForm9(db, { officeId: "office-demo" }, { today: "2026-11-04", situation }))!.sheet;
    expect(sheet.mode).toBe("disaster");
    const caseload = await loadCaseload(db, scope, "2026-11-04", at(3));
    expect(sheet.rows.map((r) => r.id)).toEqual(sortCaseload(caseload!.rows, "tier").map((r) => r.id));
  });
});
