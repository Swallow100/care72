// 災害の種類を増やした（docs/tasks/T60.md）: 台風・土砂・津波・その他。
// 言葉と並び、場面の表（地図の雨雲・震度へ写す 1 つの表）、migration 0011 の契約（CHECK と既存の行の写し）、
// ルールの表（lib/triage）の結果が災害の種類で変わらないこと、切替の経過の 1 行。

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DatabaseSync as Db } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { DISASTER_KINDS, type DisasterKind } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { loadDisasterState, loadOfficeLog, saveDisasterInfo, switchDisasterMode } from "./db.ts";
import { disasterScope } from "./scope.ts";
import { DISASTER_KIND_LABELS, DISASTER_SCENE, disasterMark, hasAlertLevel, isDisasterKind, parseModeForm, toSituation } from "./state.ts";

describe("災害の種類の言葉と並び", () => {
  it("平時 → 大雨 → 台風 → 土砂 → 地震 → 津波 → その他（切替のボタンの並び）", () => {
    expect(DISASTER_KINDS.map((k) => DISASTER_KIND_LABELS[k])).toEqual(["平時", "大雨", "台風", "土砂", "地震", "津波", "その他"]);
  });

  it("どの種類もフォームで往復できる。知らない種類は断る", () => {
    for (const kind of DISASTER_KINDS) {
      expect(isDisasterKind(kind)).toBe(true);
      const f = new FormData();
      f.append("kind", kind);
      f.append("version", "3");
      if (kind === "normal") f.append("confirm", "1");
      expect(parseModeForm(f)).toEqual({ ok: true, value: { kind, version: 3 } });
    }
    const bad = new FormData();
    bad.append("kind", "volcano");
    bad.append("version", "0");
    expect(parseModeForm(bad)).toEqual({ ok: false, error: "bad" });
  });

  it("場面の表: 大雨・台風・土砂は大雨の場面、地震・津波は地震の場面、平時とその他は場面なし", () => {
    expect(DISASTER_SCENE).toEqual({
      normal: null,
      heavy_rain: "heavy_rain",
      typhoon: "heavy_rain",
      landslide: "heavy_rain",
      earthquake: "earthquake",
      tsunami: "earthquake",
      other: null,
    });
  });
});

// ---------- migration 0011 ----------

const MIGRATIONS = new URL("../../migrations/", import.meta.url);
const migrationNames = () => readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort();
const MIGRATION_0011 = "0011_disaster_kinds.sql";

/** 0011 の前までを流した DB（外部キーを効かせる） */
function before0011(): Db {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const n of migrationNames().filter((n) => n < MIGRATION_0011)) db.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
  return db;
}

const apply = (db: Db, pred: (n: string) => boolean) => {
  for (const n of migrationNames().filter(pred)) db.exec(readFileSync(new URL(n, MIGRATIONS), "utf8"));
};

describe("migration 0011（disaster_state.kind の CHECK）", () => {
  const T = "2026-11-05T07:00:00.000Z";

  function withOffices(db: Db) {
    for (const id of ["o-1", "o-2", "o-3"]) {
      db.prepare("INSERT INTO offices (id, name, kind, city) VALUES (?, ?, 'regular', '松山市')").run(id, `事業所 ${id}`);
    }
  }

  it("番号は 0011 で 1 つだけ", () => {
    expect(migrationNames().filter((n) => n.startsWith("0011_"))).toEqual([MIGRATION_0011]);
  });

  it("前の表の行（大雨・地震・平時、停電・レベル・断水・道路・版）をそのまま写し、前の表の名前を残さない", () => {
    const db = before0011();
    withOffices(db);
    db.exec(`
      INSERT INTO disaster_state (office_id, kind, started_at, outage_scope, outage_towns, outage_started_at, alert_level, water, road, version, updated_at)
        VALUES ('o-1', 'heavy_rain', '${T}', 'area', '["かわなぎ町"]', '${T}', 4, '断水あり', '県道 通行止め', 3, '${T}');
      INSERT INTO disaster_state (office_id, kind, started_at, outage_scope, outage_started_at, version, updated_at) VALUES ('o-2', 'earthquake', '${T}', 'office', '${T}', 2, '${T}');
      INSERT INTO disaster_state (office_id, kind, version, updated_at) VALUES ('o-3', 'normal', 5, '${T}');
    `);
    const rows = () => db.prepare("SELECT * FROM disaster_state ORDER BY office_id").all();
    const old = rows();
    expect(old).toHaveLength(3);
    apply(db, (n) => n >= MIGRATION_0011);
    expect(rows()).toEqual(old);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'disaster_state%'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(tables).toEqual(["disaster_state"]);
    db.close();
  });

  it("新しい 4 種類が入り、知らない種類は CHECK で断る。ほかの CHECK と外部キーは前と同じに効く", () => {
    const db = migratedSqlite();
    withOffices(db);
    const put = (office: string, kind: string, startedAt: string | null) =>
      db.prepare("INSERT OR REPLACE INTO disaster_state (office_id, kind, started_at, updated_at) VALUES (?, ?, ?, ?)").run(office, kind, startedAt, T);
    for (const kind of ["typhoon", "landslide", "tsunami", "other"]) expect(() => put("o-1", kind, T), kind).not.toThrow();
    expect(() => put("o-1", "volcano", T)).toThrow();
    // 平時は発災なし、災害は発災あり
    expect(() => put("o-1", "typhoon", null)).toThrow();
    expect(() => put("o-1", "normal", T)).toThrow();
    // 平時に停電は持てない
    expect(() =>
      db
        .prepare("INSERT OR REPLACE INTO disaster_state (office_id, kind, outage_scope, outage_started_at, updated_at) VALUES ('o-2', 'normal', 'office', ?, ?)")
        .run(T, T),
    ).toThrow();
    // 停電の地区は JSON の配列だけ
    expect(() =>
      db
        .prepare(
          "INSERT OR REPLACE INTO disaster_state (office_id, kind, started_at, outage_scope, outage_towns, outage_started_at, updated_at) VALUES ('o-2', 'tsunami', ?, 'area', 'x', ?, ?)",
        )
        .run(T, T, T),
    ).toThrow();
    // 事業所の外部キー（無い事業所は断る）と、事業所を消すと一緒に消える
    expect(() => put("o-none", "typhoon", T)).toThrow();
    db.prepare("DELETE FROM offices WHERE id = 'o-1'").run();
    expect(db.prepare("SELECT count(*) AS n FROM disaster_state WHERE office_id = 'o-1'").get()).toEqual({ n: 0 });
    db.close();
  });

  it("CHECK の種類の並びは DISASTER_KINDS と同じ", () => {
    const sql = readFileSync(new URL(MIGRATION_0011, MIGRATIONS), "utf8");
    const m = /kind TEXT NOT NULL CHECK \(kind IN \(([^)]*)\)\)/.exec(sql);
    expect(m?.[1].split(",").map((s) => s.trim().replace(/'/g, ""))).toEqual([...DISASTER_KINDS]);
  });
});

// ---------- 種の 10 人で: 切替・経過・ルールの表 ----------

let sqlite: Db;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const yamamoto: Principal = {
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
const SCOPE = disasterScope(yamamoto)!;
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const TODAY = "2026-11-05";
const DISASTERS = DISASTER_KINDS.filter((k): k is Exclude<DisasterKind, "normal"> => k !== "normal");

describe("切替と経過", () => {
  it("平時 → 台風 → 土砂 → 津波 → その他 → 平時。経過は「災害モード 台風」、ヘッダーの印は種類の言葉、発災は最初の時刻のまま", async () => {
    const order: DisasterKind[] = ["typhoon", "landslide", "tsunami", "other", "normal"];
    for (const [i, kind] of order.entries()) {
      const r = await switchDisasterMode(db, SCOPE, { kind, version: i, at: at(-2 + i * 0.1) });
      expect(r, kind).toEqual({ ok: true, changed: true });
      const s = await loadDisasterState(db, "office-demo");
      expect(s.kind).toBe(kind);
      if (kind !== "normal") {
        expect(s.startedAt).toBe(at(-2));
        expect(disasterMark(s, at(1))).toMatchObject({ kind: "disaster", label: DISASTER_KIND_LABELS[kind] });
      }
    }
    const log = await loadOfficeLog(db, "office-demo");
    expect(log.map((e) => [e.label, e.body]).reverse()).toEqual([
      ["災害モード", "台風"],
      ["災害モード", "土砂"],
      ["災害モード", "津波"],
      ["災害モード", "その他"],
      ["平時", null],
    ]);
  });
});

describe("ルールの表の結果は災害の種類で変わらない", () => {
  it("同じ発災・停電・時刻なら、6 つの災害の種類とも担当一覧と様式 9 の色・順位・理由が同じ", async () => {
    const seen: string[] = [];
    let version = 0;
    for (const kind of DISASTERS) {
      // 平時から入り直す（発災の時刻を毎回同じにする）
      if (version > 0) {
        expect(await switchDisasterMode(db, SCOPE, { kind: "normal", version, at: at(-3) })).toEqual({ ok: true, changed: true });
        version++;
      }
      expect(await switchDisasterMode(db, SCOPE, { kind, version, at: at(-2) })).toEqual({ ok: true, changed: true });
      version++;
      expect(
        await saveDisasterInfo(db, SCOPE, {
          version,
          at: at(0),
          info: { startedAt: at(-2), outage: { scope: "office", towns: [], startedAt: at(0) }, alertLevel: 4, water: null, road: null },
        }),
      ).toEqual({ ok: true, changed: true });
      version++;

      const state = await loadDisasterState(db, "office-demo");
      expect(state.kind).toBe(kind);
      // 表に渡す状況は種類を持たない
      expect(toSituation(state, at(3.5))).toEqual({ now: at(3.5), disasterAt: at(-2), outageAt: at(0), outageTowns: null });

      const board = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, at(3.5));
      const rows = board!.rows.map((r) => [r.id, r.triage?.color, r.triage?.rule, r.triage?.reason]);
      expect(rows.every((r) => r[1] !== undefined)).toBe(true);
      const f9 = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: toSituation(state, at(3.5)) });
      const sheet = f9!.sheet.rows.map((r) => JSON.stringify(r));
      seen.push(JSON.stringify({ rows, sheet }));
    }
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(1);
  });
});

describe("警戒レベルは大雨の場面の種類だけ（11/3 21:5x 確定）", () => {
  const info = (alertLevel: 3 | 4 | 5 | null) => ({
    startedAt: at(-2),
    outage: { scope: "none" as const, towns: [], startedAt: null },
    alertLevel,
    water: null,
    road: null,
  });
  const level = () => (sqlite.prepare("SELECT alert_level AS l FROM disaster_state WHERE office_id = 'office-demo'").get() as { l: number | null }).l;

  it("欄を出す種類は大雨・台風・土砂", () => {
    expect(DISASTER_KINDS.filter(hasAlertLevel)).toEqual(["heavy_rain", "typhoon", "landslide"]);
  });

  it("大雨 → 台風 → 土砂は持ち越し、地震へ移ると NULL。大雨の場面に戻っても前の値は戻らない。ヘッダーの印にもレベルを出さない", async () => {
    expect(await switchDisasterMode(db, SCOPE, { kind: "heavy_rain", version: 0, at: at(-2) })).toEqual({ ok: true, changed: true });
    expect(await saveDisasterInfo(db, SCOPE, { version: 1, at: at(0), info: info(4) })).toEqual({ ok: true, changed: true });
    expect(await switchDisasterMode(db, SCOPE, { kind: "typhoon", version: 2, at: at(0.1) })).toEqual({ ok: true, changed: true });
    expect(level()).toBe(4);
    expect(await switchDisasterMode(db, SCOPE, { kind: "landslide", version: 3, at: at(0.2) })).toEqual({ ok: true, changed: true });
    expect(level()).toBe(4);
    expect(disasterMark(await loadDisasterState(db, "office-demo"), at(1))).toMatchObject({ label: "土砂", details: ["レベル 4"] });
    for (const [i, kind] of (["earthquake", "tsunami", "other"] as const).entries()) {
      expect(await switchDisasterMode(db, SCOPE, { kind, version: 4 + i, at: at(0.3 + i * 0.1) })).toEqual({ ok: true, changed: true });
      expect(level(), kind).toBeNull();
      expect(disasterMark(await loadDisasterState(db, "office-demo"), at(1))).toMatchObject({ label: DISASTER_KIND_LABELS[kind], details: [] });
    }
    expect(await switchDisasterMode(db, SCOPE, { kind: "heavy_rain", version: 7, at: at(0.6) })).toEqual({ ok: true, changed: true });
    expect(level()).toBeNull();
  });

  it("地震・津波・その他でレベルを送っても NULL で保存する（変わらなければ書かない）", async () => {
    let version = 0;
    for (const kind of ["earthquake", "tsunami", "other"] as const) {
      expect(await switchDisasterMode(db, SCOPE, { kind, version, at: at(-2) })).toEqual({ ok: true, changed: true });
      version++;
      expect(await saveDisasterInfo(db, SCOPE, { version, at: at(0), info: info(5) }), kind).toEqual({ ok: true, changed: false });
      expect(level()).toBeNull();
    }
    // ほかの欄が変われば保存し、レベルは NULL のまま
    expect(await saveDisasterInfo(db, SCOPE, { version, at: at(0), info: { ...info(5), water: "断水あり" } })).toEqual({ ok: true, changed: true });
    expect(level()).toBeNull();
    const log = await loadOfficeLog(db, "office-demo");
    expect(log[0]).toMatchObject({ label: "災害情報", body: "断水 断水あり" });
  });
});
