// デモ事業所の種と「最初に戻す」・毎日 4 時（docs/tasks/T26.md）のテスト。D1 は node:sqlite、R2 は偽物。
// - 種の冪等（同じ now で 2 回作ると同じ、同じ DB に 2 回流しても同じ）と中身（大雨・山田の赤・終わった訓練）
// - 戻すの範囲（デモ事業所だけ。協力事業所の行・AI の呼び出しの記録・山本のハッシュは残る）
// - 「最初に戻す」の壁（審査員と管理者だけ）、cron のハンドラ、R2 の録音、上限での再生への切替

import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_ACCOUNTS } from "../../seed/people.ts";
import { fullSeedStatements } from "../../seed/full.ts";
import { CLEAR_ORDER } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { todayJst } from "../age.ts";
import { loadCaseload } from "../caseload.ts";
import { drillGate } from "../claude/gate.ts";
import { HAIKU } from "../claude/models.ts";
import { staffActor } from "../custody/actor.ts";
import { receive, registerOnSite } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadDisasterState, loadOfficeLog } from "../disaster/db.ts";
import { abandonDrill, drillScope, listDrills, startDrill } from "../drill/db.ts";
import { recordingGet, type RecordingReader } from "../list/recording.ts";
import { DAILY_RESET_CRON, scheduledReset } from "./cron.ts";
import {
  DEMO_RECORDING_PREFIX,
  demoOutageTowns,
  demoTimes,
  SEED_RECORDING_KEYS,
  SEED_RED_SIGNAL_ID,
  SEED_RED_TRANSCRIPT,
} from "./demo.ts";
import { SEED_DRILL_ID, seedDrillStartedAt } from "./drill.ts";
import { canResetDemo, officeResetHref, resetPost } from "./http.ts";
import { DEMO_CLEAR, resetDemoOffice, type SeedBucket } from "./reset.ts";

/** 種を入れた時刻（2026-11-05 10:00 JST） */
const NOW = "2026-11-05T01:00:00.000Z";
/** 前の日に入れた種（戻す前の DB） */
const BEFORE = "2026-11-04T01:00:00.000Z";

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
const judgeCm = () => careManager({ judge: true, admin: false, accountId: "acct-judge" });
const judgeMedical = () => careManager({ role: "medical", judge: true, admin: false, accountId: "acct-judge", caseloadOf: null });
const partnerAdmin = () => careManager({ accountId: "acct-partner-cm", office: PARTNER, caseloadOf: "acct-partner-cm" });

// ---------- 手元の D1 と R2 ----------

let sqlite: DatabaseSync | undefined;

async function seeded(now = NOW): Promise<DatabaseSync> {
  const db = migratedSqlite();
  for (const s of await fullSeedStatements({ now })) db.exec(s);
  return db;
}

afterEach(() => {
  sqlite?.close();
  sqlite = undefined;
});

/** 全部の表を created_at を除いて並べた物（行の順は問わない） */
function dump(db: DatabaseSync, skip: ReadonlyArray<string> = []): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of CLEAR_ORDER) {
    if (skip.includes(t)) continue;
    const rows = db.prepare(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>;
    out[t] = rows
      .map((r) => {
        const { created_at: _c, ...rest } = r;
        return JSON.stringify(rest);
      })
      .sort();
  }
  return out;
}

const count = (db: DatabaseSync, sql: string, ...args: string[]) => (db.prepare(sql).get(...args) as { n: number }).n;

type FakeObject = { bytes: Uint8Array; type: string };

/** R2 の偽物（head・list・delete と、録音の再生の get） */
function fakeBucket(initial: Record<string, string> = {}) {
  const objects = new Map<string, FakeObject>();
  for (const [k, type] of Object.entries(initial)) objects.set(k, { bytes: new Uint8Array([1, 2, 3, 4]), type });
  const bucket: SeedBucket & RecordingReader = {
    head: async (key: string) => {
      const o = objects.get(key);
      return o ? { size: o.bytes.length, httpMetadata: { contentType: o.type } } : null;
    },
    get: async (key: string) => {
      const o = objects.get(key);
      return o ? { body: o.bytes, size: o.bytes.length, httpMetadata: { contentType: o.type } } : null;
    },
    // 2 件ずつ返して、続き（cursor）を読むことも確かめる
    list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
      // 続き（cursor）は最後に返した鍵。消したあとも続きから読める（R2 の cursor と同じく位置がずれない）
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
      const page = keys.slice(0, 2);
      const truncated = keys.length > 2;
      return { objects: page.map((key) => ({ key })), truncated, ...(truncated ? { cursor: page[page.length - 1] } : {}) };
    },
    delete: async (keys: string[]) => {
      for (const k of keys) objects.delete(k);
    },
  };
  return { bucket, objects };
}

// ---------- 種 ----------

describe("種（npm run db:reset）", () => {
  it("同じ now で 2 回作ると同じ。同じ DB に 2 回流しても同じ（created_at を除く）", async () => {
    sqlite = await seeded();
    const again = await seeded();
    expect(dump(again)).toEqual(dump(sqlite));
    const twice = migratedSqlite();
    const statements = await fullSeedStatements({ now: NOW });
    for (const s of statements) twice.exec(s);
    for (const s of statements) twice.exec(s);
    expect(dump(twice)).toEqual(dump(sqlite));
    again.close();
    twice.close();
  });

  it("デモ事業所は大雨・警戒レベル 4・浸水 3 m の町で停電（発災 4 時間前・停電 3 時間前）。事業所の経過に 2 行", async () => {
    sqlite = await seeded();
    const db = d1FromSqlite(sqlite);
    const t = demoTimes(NOW);
    expect(demoOutageTowns()).toEqual(["かわなぎ町"]);
    const s = await loadDisasterState(db, DEMO.id);
    expect(s).toMatchObject({
      kind: "heavy_rain",
      startedAt: t.disasterAt,
      startedBy: "acct-yamamoto",
      startedByName: "山本",
      outage: { scope: "area", towns: ["かわなぎ町"], startedAt: t.outageAt },
      alertLevel: 4,
      water: null,
      road: null,
      version: 2,
    });
    expect(Date.parse(NOW) - Date.parse(t.outageAt)).toBe(3 * 3_600_000);
    const log = await loadOfficeLog(db, DEMO.id);
    expect(log.map((l) => [l.kind, l.body, l.who])).toEqual([
      ["disaster_info", "停電 地区（かわなぎ町） 11/5 07:00〜・警戒レベル 4", "山本"],
      ["disaster_on", "大雨", "山本"],
    ]);
    // 協力事業所は平時のまま
    expect((await loadDisasterState(db, PARTNER.id)).kind).toBe("normal");
  });

  it("山田の赤: けが あり・文字起こし・Claude の分類の列（動けない・確信 0.9・引用・モデル名）。経過に信号・録音・分類の 3 行", async () => {
    sqlite = await seeded();
    const sig = sqlite.prepare("SELECT * FROM signals WHERE drill_id IS NULL").all() as Array<Record<string, unknown>>;
    expect(sig).toHaveLength(1);
    expect(sig[0]).toMatchObject({
      id: SEED_RED_SIGNAL_ID,
      person_id: "p-01",
      color: "red",
      source: "self",
      injured: 1,
      at_home: null,
      can_move: null,
      has_medicine: null,
      recording_key: null,
      transcript: SEED_RED_TRANSCRIPT,
      classes: '["immobile"]',
      classified_by: "claude",
      ai_classes: '["immobile"]',
      ai_confidence: 0.9,
      ai_quote: "うごけない",
      ai_model: HAIKU,
      ai_error: null,
      occurred_at: demoTimes(NOW).redAt,
    });
    const log = sqlite
      .prepare("SELECT author_role, kind, body FROM timeline_entries WHERE person_id = 'p-01' ORDER BY occurred_at")
      .all();
    expect(log).toEqual([
      { author_role: "self", kind: "signal", body: "無事じゃない けが あり・未回答 3" },
      { author_role: "self", kind: "signal", body: "録音なし 文字起こし「いたい、うごけない」" },
      { author_role: "system", kind: "note", body: "録音の分類（AI）: 動けない 確信 90%「うごけない」" },
    ]);
  });

  it("担当一覧は災害モードで、山田が赤の最上位（理由に AI の印）", async () => {
    sqlite = await seeded();
    const list = await loadCaseload(d1FromSqlite(sqlite), { officeId: DEMO.id, careManagerId: "acct-yamamoto" }, todayJst(new Date(NOW)), NOW);
    expect(list?.situation).not.toBeNull();
    const top = list!.rows.find((r) => r.rank === 1);
    expect(top?.id).toBe("p-01");
    expect(top?.triage?.color).toBe("red");
    expect(top?.triage?.reason).toContain("（AI）");
  });

  it("終わった訓練 1 回（大雨、12 刻み、開始者 山本、前の日の 14:00 JST）。手の履歴と採点は空", async () => {
    sqlite = await seeded();
    const drills = await listDrills(d1FromSqlite(sqlite), DEMO.id);
    expect(drills).toHaveLength(1);
    expect(drills[0]).toMatchObject({
      id: SEED_DRILL_ID,
      scenario: "heavy_rain",
      status: "finished",
      step: 11,
      sim_hour: 72,
      started_by_name: "山本",
      started_at: "2026-11-04T05:00:00.000Z",
    });
    expect(seedDrillStartedAt(NOW)).toBe("2026-11-04T05:00:00.000Z");
    // 日本の 0 時すぎでも前の日
    expect(seedDrillStartedAt("2026-11-04T15:30:00.000Z")).toBe("2026-11-04T05:00:00.000Z");
    const row = sqlite.prepare("SELECT world, score FROM drills WHERE id = ?").get(SEED_DRILL_ID) as { world: string; score: string | null };
    expect(row.score).toBeNull();
    expect(JSON.parse(row.world).actions).toEqual([]);
    const steps = sqlite.prepare("SELECT DISTINCT step FROM drill_events WHERE drill_id = ? ORDER BY step").all(SEED_DRILL_ID);
    expect(steps.map((s) => (s as { step: number }).step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // 訓練の山田の赤は訓練の信号（本番の読み方に混ざらない）
    expect(count(sqlite, "SELECT count(*) AS n FROM signals WHERE drill_id = ? AND person_id = 'p-01' AND color = 'red'", SEED_DRILL_ID)).toBe(1);
  });
});

// ---------- 戻す ----------

/** 前の日の種のあとに、審査員の操作と協力事業所の記録を足した DB */
async function used(): Promise<{ db: DatabaseSync; partnerDump: () => Record<string, string[]> }> {
  const db = await seeded(BEFORE);
  const d1 = d1FromSqlite(db);
  const at = "2026-11-04T03:00:00.000Z";
  db.exec(`UPDATE accounts SET password_hash = 'hash-of-yamamoto' WHERE id = 'acct-yamamoto'`);
  db.exec(`UPDATE offices SET name = '名前を変えた' WHERE id = 'office-demo'`);
  // デモ事業所: 審査員の訓練（中断）と進行中の訓練、足した利用者とケアマネ、様式 9 の手直し、平時に戻した、山田の QR・信号・録音
  const scope = drillScope(judgeCm())!;
  const a = await startDrill(d1, scope, "short", at, {}, () => "drill-judge-1");
  expect(a.ok).toBe(true);
  await abandonDrill(d1, scope, "drill-judge-1", at);
  expect((await startDrill(d1, scope, "earthquake", at, {}, () => "drill-judge-2")).ok).toBe(true);
  db.exec(`INSERT INTO accounts (id, office_id, role, display_name, login_id) VALUES ('acct-cm-2', 'office-demo', 'care_manager', '追加', 'cm2')`);
  db.exec(
    `INSERT INTO people (id, office_id, care_manager_id, name, kana, ledger) VALUES ('p-new', 'office-demo', 'acct-cm-2', '架空 次郎', 'カクウ ジロウ', '{}')`,
  );
  db.exec(`INSERT INTO contacts (id, person_id, kind) VALUES ('c-new', 'p-new', 'self')`);
  db.exec(
    `INSERT INTO form9_rank_edits (id, office_id, person_id, mode, rank, auto_rank, reason, set_by, set_at) VALUES ('f9-1', 'office-demo', 'p-02', 'disaster', 1, 2, '理由', 'acct-judge', '${at}')`,
  );
  db.exec(`DELETE FROM disaster_state WHERE office_id = 'office-demo'`);
  db.exec(
    `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, occurred_at) VALUES ('ot-judge', 'office-demo', 'acct-judge', 'care_manager', 'disaster_off', '${at}')`,
  );
  db.exec(`UPDATE people SET qr_generation = 3, qr_issued_at = '${at}' WHERE id = 'p-01'`);
  db.exec(
    `INSERT INTO signals (id, person_id, color, source, recording_key, occurred_at) VALUES ('11111111-1111-4111-8111-111111111111', 'p-01', 'green', 'self', 'recordings/office-demo/p-01/20261104T030000000Z.webm', '${at}')`,
  );
  db.exec(`INSERT INTO ai_calls (id, office_id, purpose, model, day, status, started_at) VALUES ('ai-demo', 'office-demo', 'classify', 'm', '2026-11-04', 'pending', '${at}')`);
  // 審査員（医療班の役）がその場で登録した所属なしの人と、別の医療班が登録した人
  db.exec(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-2', NULL, 'medical', '医療班 2')`);
  const onSite = (name: string) => ({
    name,
    kana: "カクウ",
    age: 80,
    birthDate: null,
    medications: [],
    devices: [],
    contact: null,
    shelter: "みどり小学校",
  });
  expect((await registerOnSite(d1, staffActor(judgeMedical())!, onSite("架空 一"), at, { personId: "p-onsite-judge" })).ok).toBe(true);
  const med2 = staffActor(careManager({ role: "medical", accountId: "acct-med-2", office: null, caseloadOf: null }))!;
  expect((await registerOnSite(d1, med2, onSite("架空 二"), at, { personId: "p-onsite-other" })).ok).toBe(true);

  // 協力事業所: 利用者・信号・経過・訓練・災害モード・事業所の経過・AI の記録。審査員が医療班の役で受け入れた受け持ちも
  db.exec(
    `INSERT INTO people (id, office_id, care_manager_id, name, kana, ledger) VALUES ('p-partner-1', 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '{}')`,
  );
  db.exec(`INSERT INTO contacts (id, person_id, kind) VALUES ('c-partner-1', 'p-partner-1', 'self')`);
  db.exec(`INSERT INTO consents (person_id, kind, status, recorded_at) VALUES ('p-partner-1', 'registry', 'granted', '${at}')`);
  db.exec(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('s-partner-1', 'p-partner-1', 'red', 'family', '${at}')`);
  db.exec(
    `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, signal_id, occurred_at) VALUES ('t-partner-1', 'p-partner-1', 'acct-partner-cm', 'care_manager', 'signal', 's-partner-1', '${at}')`,
  );
  db.exec(
    `INSERT INTO drills (id, office_id, scenario, status, started_by, started_at) VALUES ('drill-partner-1', 'office-partner', 'short', 'finished', 'acct-partner-cm', '${at}')`,
  );
  db.exec(
    `INSERT INTO drill_events (id, drill_id, seq, step, sim_hour, actor, kind) VALUES ('de-partner-1', 'drill-partner-1', 1, 0, 0, 'world', 'incident')`,
  );
  db.exec(
    `INSERT INTO disaster_state (office_id, kind, started_at, started_by, version, updated_by, updated_at) VALUES ('office-partner', 'earthquake', '${at}', 'acct-partner-cm', 1, 'acct-partner-cm', '${at}')`,
  );
  db.exec(
    `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, occurred_at) VALUES ('ot-partner', 'office-partner', 'acct-partner-cm', 'care_manager', 'disaster_on', '${at}')`,
  );
  db.exec(`INSERT INTO ai_calls (id, office_id, purpose, model, day, status, started_at) VALUES ('ai-partner', 'office-partner', 'classify', 'm', '2026-11-04', 'pending', '${at}')`);
  expect((await receive(d1, staffActor(judgeMedical())!, { personId: "p-partner-1", shelter: "みどり小学校", via: "search" }, at)).ok).toBe(true);

  /** 協力事業所の人・事業所の行と、所属なしの別の医療班の行（戻しても同じであるはずの物） */
  const partnerDump = () => {
    const pick = (sql: string) => (db.prepare(sql).all() as unknown[]).map((r) => JSON.stringify(r)).sort();
    return {
      people: pick("SELECT * FROM people WHERE office_id = 'office-partner' OR id = 'p-onsite-other'"),
      contacts: pick("SELECT * FROM contacts WHERE person_id IN ('p-partner-1', 'p-onsite-other')"),
      consents: pick("SELECT * FROM consents WHERE person_id IN ('p-partner-1', 'p-onsite-other')"),
      signals: pick("SELECT * FROM signals WHERE person_id IN ('p-partner-1', 'p-onsite-other')"),
      timeline: pick("SELECT * FROM timeline_entries WHERE person_id IN ('p-partner-1', 'p-onsite-other')"),
      custody: pick("SELECT * FROM custody WHERE person_id IN ('p-partner-1', 'p-onsite-other')"),
      provisions: pick("SELECT * FROM third_party_provisions WHERE person_id IN ('p-partner-1', 'p-onsite-other')"),
      drills: pick("SELECT * FROM drills WHERE office_id = 'office-partner'"),
      events: pick("SELECT * FROM drill_events WHERE drill_id = 'drill-partner-1'"),
      disaster: pick("SELECT * FROM disaster_state WHERE office_id = 'office-partner'"),
      officeLog: pick("SELECT * FROM office_timeline_entries WHERE office_id = 'office-partner'"),
      ai: pick("SELECT * FROM ai_calls"),
      offices: pick("SELECT * FROM offices WHERE id <> 'office-demo'"),
      accounts: pick("SELECT * FROM accounts WHERE office_id IS NULL OR office_id <> 'office-demo'"),
    };
  };
  return { db, partnerDump };
}

/** 戻したあとの DB から、種に無い物（協力事業所・別の医療班・AI の記録）を外す。山本のハッシュも種の値（null）に */
function withoutOthers(db: DatabaseSync): Record<string, string[]> {
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec("DELETE FROM third_party_provisions WHERE person_id IN ('p-partner-1', 'p-onsite-other')");
  db.exec("DELETE FROM custody WHERE person_id IN ('p-partner-1', 'p-onsite-other')");
  db.exec("DELETE FROM timeline_entries WHERE person_id IN ('p-partner-1', 'p-onsite-other')");
  db.exec("DELETE FROM signals WHERE person_id IN ('p-partner-1', 'p-onsite-other')");
  db.exec("DELETE FROM consents WHERE person_id IN ('p-partner-1', 'p-onsite-other')");
  db.exec("DELETE FROM contacts WHERE person_id IN ('p-partner-1', 'p-onsite-other')");
  db.exec("DELETE FROM people WHERE id IN ('p-partner-1', 'p-onsite-other')");
  db.exec("DELETE FROM drill_events WHERE drill_id = 'drill-partner-1'");
  db.exec("DELETE FROM drills WHERE id = 'drill-partner-1'");
  db.exec("DELETE FROM disaster_state WHERE office_id = 'office-partner'");
  db.exec("DELETE FROM office_timeline_entries WHERE office_id = 'office-partner'");
  db.exec("DELETE FROM accounts WHERE id = 'acct-med-2'");
  db.exec("UPDATE accounts SET password_hash = NULL WHERE id = 'acct-yamamoto'");
  db.exec("PRAGMA foreign_keys = ON;");
  return dump(db, ["ai_calls"]);
}

describe("最初に戻す（デモ事業所だけ）", () => {
  let fresh: DatabaseSync;
  beforeEach(async () => {
    fresh = await seeded(NOW);
  });
  afterEach(() => fresh.close());

  it("審査員の操作のあとでも、デモ事業所は同じ now の種と同じになる。協力事業所の行は変わらない", async () => {
    const { db, partnerDump } = await used();
    sqlite = db;
    const before = partnerDump();
    const { bucket } = fakeBucket();
    await resetDemoOffice(d1FromSqlite(db), bucket, NOW);

    expect(partnerDump()).toEqual(before);
    // AI の呼び出しの記録はデモ事業所の分も残る（1 日の上限の数え）
    expect(count(db, "SELECT count(*) AS n FROM ai_calls WHERE office_id = 'office-demo'")).toBe(1);
    // 山本のパスワードのハッシュは残る（Worker はハッシュを知らない）
    expect(db.prepare("SELECT password_hash AS h FROM accounts WHERE id = 'acct-yamamoto'").get()).toEqual({ h: "hash-of-yamamoto" });
    // 審査員がその場で登録した所属なしの人は消え、別の医療班が登録した人は残る
    expect(count(db, "SELECT count(*) AS n FROM people WHERE id = 'p-onsite-judge'")).toBe(0);
    expect(count(db, "SELECT count(*) AS n FROM people WHERE id = 'p-onsite-other'")).toBe(1);
    // 審査員が医療班の役で受け入れた協力事業所の人の受け持ちは、その人の行として残る
    expect(count(db, "SELECT count(*) AS n FROM custody WHERE person_id = 'p-partner-1' AND holder_id = 'acct-judge'")).toBe(1);

    expect(withoutOthers(db)).toEqual(dump(fresh, ["ai_calls"]));
  });

  it("2 回戻しても同じ", async () => {
    const { db } = await used();
    sqlite = db;
    const { bucket } = fakeBucket();
    await resetDemoOffice(d1FromSqlite(db), bucket, NOW);
    const once = dump(db);
    await resetDemoOffice(d1FromSqlite(db), bucket, NOW);
    expect(dump(db)).toEqual(once);
  });

  it("消す範囲は手元の種の入れ直し（CLEAR_ORDER）の表を全部決めている。残すのは AI の記録・ログインの失敗の数え・事業所の行だけ", () => {
    expect(Object.keys(DEMO_CLEAR).sort()).toEqual([...CLEAR_ORDER].sort());
    expect(Object.entries(DEMO_CLEAR).filter(([, w]) => w === null).map(([t]) => t).sort()).toEqual([
      "ai_calls",
      "login_attempts",
      "offices",
    ]);
  });

  it("R2: 審査員の録音を消し、種の録音と協力事業所の物は残す。種の録音があれば山田の信号に結び、再生できる", async () => {
    const { db } = await used();
    sqlite = db;
    const judgeKeys = [1, 2, 3].map((i) => `${DEMO_RECORDING_PREFIX}p-01/2026110${i}T000000000Z.webm`);
    const partnerKey = "recordings/office-partner/p-partner-1/20261104T000000000Z.webm";
    const { bucket, objects } = fakeBucket({
      [SEED_RECORDING_KEYS.m4a]: "audio/mp4",
      [partnerKey]: "audio/webm",
      ...Object.fromEntries(judgeKeys.map((k) => [k, "audio/webm"])),
    });
    const r = await resetDemoOffice(d1FromSqlite(db), bucket, NOW);
    expect(r).toEqual({ recording: true, removedRecordings: 3 });
    expect([...objects.keys()].sort()).toEqual([partnerKey, SEED_RECORDING_KEYS.m4a].sort());

    const sig = db.prepare("SELECT recording_key AS k FROM signals WHERE id = ?").get(SEED_RED_SIGNAL_ID);
    expect(sig).toEqual({ k: SEED_RECORDING_KEYS.m4a });
    const body = db.prepare("SELECT body FROM timeline_entries WHERE id = 't-seed-red-2'").get();
    expect(body).toEqual({ body: "録音 文字起こし「いたい、うごけない」" });
    // 審査員（ケアマネの役）が担当一覧の行の詳細から再生する道
    const res = await recordingGet(d1FromSqlite(db), bucket, judgeCm(), SEED_RED_SIGNAL_ID, null);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mp4");
  });

  it("種の録音が R2 に無ければ録音なし（文字起こしと分類だけ）", async () => {
    const { db } = await used();
    sqlite = db;
    const { bucket } = fakeBucket();
    expect((await resetDemoOffice(d1FromSqlite(db), bucket, NOW)).recording).toBe(false);
    expect(db.prepare("SELECT recording_key AS k FROM signals WHERE id = ?").get(SEED_RED_SIGNAL_ID)).toEqual({ k: null });
    const res = await recordingGet(d1FromSqlite(db), bucket, judgeCm(), SEED_RED_SIGNAL_ID, null);
    expect(res.status).toBe(404);
  });
});

describe("「最初に戻す」のボタン（/office/reset）", () => {
  beforeEach(async () => {
    sqlite = (await used()).db;
  });

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const drillsOf = (office: string) => count(sqlite!, "SELECT count(*) AS n FROM drills WHERE office_id = ?", office);

  it("出せるのはデモ事業所の審査員（ケアマネの役）と管理者だけ", () => {
    expect(canResetDemo(judgeCm())).toBe(true);
    expect(canResetDemo(careManager())).toBe(true);
    expect(canResetDemo(careManager({ admin: false, accountId: "acct-cm-2", caseloadOf: "acct-cm-2" }))).toBe(false);
    expect(canResetDemo(partnerAdmin())).toBe(false);
    expect(canResetDemo(judgeMedical())).toBe(false);
    expect(canResetDemo(careManager({ role: "self", judge: true, personId: "p-01" }))).toBe(false);
    expect(canResetDemo(null)).toBe(false);
  });

  it("ログインなし 401、ほかの人 403（協力事業所の管理者も）。何も消えない", async () => {
    const db = d1FromSqlite(sqlite!);
    const { bucket } = fakeBucket();
    const yes = form({ confirm: "1" });
    expect(await resetPost(db, bucket, null, yes, NOW)).toEqual({ status: 401 });
    for (const p of [partnerAdmin(), judgeMedical(), careManager({ admin: false, accountId: "acct-cm-2" })]) {
      expect(await resetPost(db, bucket, p, yes, NOW)).toEqual({ status: 403 });
    }
    expect(drillsOf("office-demo")).toBe(3);
    expect(drillsOf("office-partner")).toBe(1);
  });

  it("確認の欄を通らない POST は確認の欄へ。確認の欄からは戻して /office?reset=done", async () => {
    const db = d1FromSqlite(sqlite!);
    const { bucket } = fakeBucket();
    expect(await resetPost(db, bucket, judgeCm(), form({}), NOW)).toEqual({ status: 303, location: officeResetHref("confirm") });
    expect(drillsOf("office-demo")).toBe(3);
    expect(await resetPost(db, bucket, judgeCm(), form({ confirm: "1" }), NOW)).toEqual({ status: 303, location: "/office?reset=done" });
    expect(drillsOf("office-demo")).toBe(1);
    expect(drillsOf("office-partner")).toBe(1);
    // 管理者（山本）も押せる
    expect(await resetPost(db, bucket, careManager(), form({ confirm: "1" }), NOW)).toEqual({ status: 303, location: "/office?reset=done" });
  });
});

describe("毎日 4 時（cron）", () => {
  it("wrangler.jsonc の triggers と入口が合っている（19:00 UTC = 4:00 JST、入口は worker.ts）", () => {
    const text = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
    expect(text).toContain(`"crons": ["${DAILY_RESET_CRON}"]`);
    expect(text).toMatch(/"main": "worker\.ts"/);
    expect(DAILY_RESET_CRON).toBe("0 19 * * *");
  });

  it("毎日 4 時の物ならデモ事業所だけを種に戻す。予定の時刻から種の時刻を数える。ほかの cron は何もしない", async () => {
    const { db, partnerDump } = await used();
    sqlite = db;
    const before = partnerDump();
    const { bucket } = fakeBucket();
    const env = { DB: d1FromSqlite(db), RECORDINGS: bucket };
    const at = Date.parse("2026-11-05T19:00:00.000Z");

    expect(await scheduledReset(env, "*/5 * * * *", at)).toBeNull();
    expect(count(db, "SELECT count(*) AS n FROM drills WHERE office_id = 'office-demo'")).toBe(3);

    expect(await scheduledReset(env, DAILY_RESET_CRON, at)).toEqual({ recording: false, removedRecordings: 0 });
    expect(partnerDump()).toEqual(before);
    const s = await loadDisasterState(d1FromSqlite(db), DEMO.id);
    expect(s.startedAt).toBe("2026-11-05T15:00:00.000Z");
    expect(s.outage.startedAt).toBe("2026-11-05T16:00:00.000Z");
    const drills = await listDrills(d1FromSqlite(db), DEMO.id);
    expect(drills.map((d) => [d.id, d.status])).toEqual([[SEED_DRILL_ID, "finished"]]);
    // 4:00 JST に戻すと、訓練は前の日（11/5）の 14:00 JST
    expect(drills[0].started_at).toBe("2026-11-05T05:00:00.000Z");
  });
});

describe("上限での再生への切替", () => {
  const items = [
    { id: "d-running", status: "running" as const },
    { id: "d-abandoned", status: "abandoned" as const },
    { id: "d-finished-new", status: "finished" as const },
    { id: "d-finished-old", status: "finished" as const },
  ];

  it("上限の内は開始のまま、残りの回数を出す", () => {
    expect(drillGate({ used: 37, limit: 200 }, items)).toEqual({ kind: "start", remaining: 163, limit: 200 });
    expect(drillGate({ used: 199, limit: 200 }, items)).toEqual({ kind: "start", remaining: 1, limit: 200 });
  });

  it("上限に達したら、いちばん新しい終わった訓練の再生（残り 0）。終わった訓練が無ければ再生なし", () => {
    expect(drillGate({ used: 200, limit: 200 }, items)).toEqual({ kind: "limit", remaining: 0, limit: 200, replay: "d-finished-new" });
    expect(drillGate({ used: 250, limit: 200 }, items)).toMatchObject({ kind: "limit", remaining: 0 });
    expect(drillGate({ used: 0, limit: 0 }, items)).toMatchObject({ kind: "limit", replay: "d-finished-new" });
    expect(drillGate({ used: 5, limit: 5 }, items.slice(0, 2))).toEqual({ kind: "limit", remaining: 0, limit: 5, replay: null });
  });

  it("使った回数が読めなければ開始のまま（止めない）", () => {
    expect(drillGate(null, items)).toEqual({ kind: "start", remaining: null, limit: null });
  });

  it("種の直後のデモ事業所は、上限に達すると種の訓練を再生する", async () => {
    sqlite = await seeded();
    const drills = await listDrills(d1FromSqlite(sqlite), DEMO.id);
    expect(drillGate({ used: 200, limit: 200 }, drills)).toMatchObject({ kind: "limit", replay: SEED_DRILL_ID });
  });
});

describe("種の決まり", () => {
  it("種のアカウントはデモ事業所の 2 つ（山本・審査員）と協力事業所の 1 つ", () => {
    expect(SEED_ACCOUNTS.map((a) => [a.id, a.office_id])).toEqual([
      ["acct-yamamoto", "office-demo"],
      ["acct-judge", "office-demo"],
      ["acct-partner-cm", "office-partner"],
    ]);
  });
});
