// T153: デモ事業所と確認用の事業所の種は平時で始まり、事業所の画面の「発災開始」で今の種の大雨の想定（警戒レベル 4・浸水 3 m の町で停電）と
// 山田の赤（録音・分類の経過）に入る。平時に戻す・入れ直し・審査員 3 人で共有・確認用の事業所・断る人・通知の合図・訓練。
// D1 は node:sqlite に種の全部（seed/full.ts）。パスワードはテストだけの値（本物ではない）。

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fullSeedStatements } from "../../seed/full.ts";
import { insert } from "../../seed/sql.ts";
import { todayJst } from "../age.ts";
import {
  CHECK_CARE_MANAGER_ID,
  CHECK_OFFICE_ID,
  DEMO_CARE_MANAGER_ID,
  DEMO_OFFICE_ID,
  JUDGE_ACCOUNTS,
  LOGIN_CARE_MANAGER_ID,
} from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { chooseRole, login, type Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadDisasterState, loadOfficeLog } from "../disaster/db.ts";
import { modePost } from "../disaster/http.ts";
import { drillScope, listDrills, startDrill } from "../drill/db.ts";
import { DAILY_RESET_CRON, scheduledReset } from "./cron.ts";
import {
  CHECK_RED_SIGNAL_ID,
  demoDisasterRows,
  demoTimes,
  SEED_RECORDING_KEYS,
  SEED_RED_SIGNAL_ID,
  SEED_RED_TRANSCRIPT,
} from "./demo.ts";
import { CHECK_SEED_DRILL_ID, SEED_DRILL_ID } from "./drill.ts";
import { canStartSeed, startPost } from "./http.ts";
import { resetPost } from "./http.ts";
import type { SeedBucket } from "./reset.ts";

const SECRET = "test-secret-t153-0123456789-0123456789-abcdef";
const NOW_SEC = 1_800_000_000;
const SEED_NOW = "2026-11-06T00:00:00.000Z";
/** 「発災開始」を押した時刻（2026-11-06 11:00 JST） */
const AT = "2026-11-06T02:00:00.000Z";
const LATER = "2026-11-06T02:30:00.000Z";
const AGAIN = "2026-11-06T03:00:00.000Z";
const JUDGE_PW = "test-judge-pass-t153";
const CM_PW = "test-cm-pass-t153";

let judgeHash: string;
let cmHash: string;
let statements: string[];

beforeAll(async () => {
  [judgeHash, cmHash] = await Promise.all([JUDGE_PW, CM_PW].map((pw) => hashPassword(pw, { iterations: 1000 })));
  statements = await fullSeedStatements({ now: SEED_NOW, passwordHashes: { [LOGIN_CARE_MANAGER_ID]: cmHash } });
}, 60_000);

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

function seeded(): DatabaseSync {
  const s = migratedSqlite();
  for (const x of statements) s.exec(x);
  return s;
}

beforeEach(() => {
  sqlite = seeded();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

function fakeBucket(initial: string[] = []): SeedBucket {
  const keys = new Set<string>(initial);
  return {
    head: async (k) => (keys.has(k) ? {} : null),
    list: async ({ prefix }) => ({ objects: [...keys].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    delete: async (ks) => {
      for (const k of ks) keys.delete(k);
    },
  };
}

/** フォームの偽物（version など） */
const form = (fields: Record<string, string>) => ({ get: (k: string) => fields[k] ?? null, getAll: (k: string) => (k in fields ? [fields[k]!] : []) });

async function cmOf(loginId: string, password: string): Promise<Principal> {
  const r = await login(db, env(), SECRET, { loginId, password }, NOW_SEC);
  if (!r.ok) throw new Error(`ログインできない: ${loginId}`);
  if (r.principal.role === "care_manager") return r.principal;
  const c = await chooseRole(db, env(), SECRET, r.token, "care_manager", NOW_SEC);
  if (!c) throw new Error("役を選べない");
  return c.principal;
}
const judgeCm = (n: 1 | 2 | 3) => cmOf(JUDGE_ACCOUNTS[n - 1].loginId, JUDGE_PW);
const yamamoto = () => cmOf("yamamoto", CM_PW);

const count = (sql: string, ...args: string[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;
/** 事業所の人の、訓練でない信号の数 */
const liveSignals = (officeId: string) =>
  count("SELECT count(*) AS n FROM signals s JOIN people p ON p.id = s.person_id WHERE p.office_id = ? AND s.drill_id IS NULL", officeId);

async function caseload(officeId: string, careManagerId: string, now: string) {
  const list = await loadCaseload(db, { officeId, careManagerId }, todayJst(new Date(now)), now);
  if (!list) throw new Error("担当一覧が無い");
  return list;
}

/** 並びと色と理由（担当一覧の行の順に） */
const order = (list: Awaited<ReturnType<typeof caseload>>) =>
  list.rows.map((r) => ({ id: r.id, rank: r.rank, color: r.triage?.color ?? null, reason: r.triage?.reason ?? null }));

async function start(p: Principal, at: string, bucket = fakeBucket()) {
  const version = (await loadDisasterState(db, p.office!.id)).version;
  return startPost(db, bucket, p, form({ version: String(version) }), at);
}

describe("T153 種は平時", () => {
  it("手元の種（npm run db:reset）: デモ・確認用とも災害モードの行・事業所の経過・訓練でない信号が無い。担当一覧は平時の形", async () => {
    for (const officeId of [DEMO_OFFICE_ID, CHECK_OFFICE_ID]) {
      expect((await loadDisasterState(db, officeId)).kind).toBe("normal");
      expect(count("SELECT count(*) AS n FROM disaster_state WHERE office_id = ?", officeId)).toBe(0);
      expect(count("SELECT count(*) AS n FROM office_timeline_entries WHERE office_id = ?", officeId)).toBe(0);
      expect(liveSignals(officeId)).toBe(0);
    }
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id IN ('p-01', 'chk-p-01')")).toBe(0);
    const list = await caseload(DEMO_OFFICE_ID, DEMO_CARE_MANAGER_ID, AT);
    expect(list.situation).toBeNull();
    expect(list.rows).toHaveLength(10);
    expect(list.rows.every((r) => r.triage === null || r.triage === undefined)).toBe(true);
  });

  it("毎朝 4 時と「最初に戻す」: 発災開始のあとでも、両方の種の事業所が平時に戻る", async () => {
    const j = await judgeCm(1);
    const y = await yamamoto();
    expect((await start(j, AT)).entered).toBe(DEMO_OFFICE_ID);
    expect((await start(y, AT)).entered).toBe(CHECK_OFFICE_ID);
    await scheduledReset({ DB: db, RECORDINGS: fakeBucket() }, DAILY_RESET_CRON, Date.parse("2026-11-06T19:00:00.000Z"));
    for (const officeId of [DEMO_OFFICE_ID, CHECK_OFFICE_ID]) {
      expect((await loadDisasterState(db, officeId)).kind).toBe("normal");
      expect(liveSignals(officeId)).toBe(0);
    }
    // 最初に戻す（審査員はデモ事業所だけ）
    expect((await start(j, AGAIN)).entered).toBe(DEMO_OFFICE_ID);
    const r = await resetPost(db, fakeBucket(), j, form({ confirm: "1" }), AGAIN);
    expect(r).toEqual({ status: 303, location: "/office?reset=done" });
    expect((await loadDisasterState(db, DEMO_OFFICE_ID)).kind).toBe("normal");
    expect(liveSignals(DEMO_OFFICE_ID)).toBe(0);
  });
});

describe("T153 発災開始", () => {
  it("審査員 1 で入る: 大雨・警戒レベル 4・浸水 3 m の町で停電（押した時刻の 4 時間前に発災・3 時間前に停電）、版 2、書き手は審査員 1", async () => {
    const j = await judgeCm(1);
    expect(canStartSeed(j)).toBe(true);
    const r = await start(j, AT);
    expect(r).toEqual({ outcome: { status: 303, location: "/office?started=1" }, entered: DEMO_OFFICE_ID });
    const t = demoTimes(AT);
    expect(await loadDisasterState(db, DEMO_OFFICE_ID)).toMatchObject({
      kind: "heavy_rain",
      startedAt: t.disasterAt,
      startedBy: j.accountId,
      startedByName: "審査員 1",
      outage: { scope: "area", towns: ["かわなぎ町"], startedAt: t.outageAt },
      alertLevel: 4,
      water: null,
      road: null,
      version: 2,
    });
    const log = await loadOfficeLog(db, DEMO_OFFICE_ID);
    expect(log.map((l) => [l.kind, l.body, l.who])).toEqual([
      ["disaster_info", "停電 地区（かわなぎ町） 11/6 08:00〜・警戒レベル 4", "審査員 1"],
      ["disaster_on", "大雨", "審査員 1"],
    ]);
    // 確認用の事業所は平時のまま
    expect((await loadDisasterState(db, CHECK_OFFICE_ID)).kind).toBe("normal");
  });

  it("山田の赤と経過の 3 行が押した時に入る（けが あり・文字起こし・分類）", async () => {
    await start(await judgeCm(1), AT);
    const sig = sqlite.prepare("SELECT * FROM signals WHERE id = ?").get(SEED_RED_SIGNAL_ID) as Record<string, unknown>;
    expect(sig).toMatchObject({
      person_id: "p-01",
      color: "red",
      injured: 1,
      transcript: SEED_RED_TRANSCRIPT,
      classes: '["immobile"]',
      classified_by: "claude",
      recording_key: null,
      occurred_at: demoTimes(AT).redAt,
    });
    expect(sqlite.prepare("SELECT author_role, kind, body FROM timeline_entries WHERE person_id = 'p-01' ORDER BY occurred_at").all()).toEqual([
      { author_role: "self", kind: "signal", body: "無事じゃない けが あり・未回答 3" },
      { author_role: "self", kind: "signal", body: "録音なし 文字起こし「いたい、うごけない」" },
      { author_role: "system", kind: "note", body: "録音の分類（AI）: 動けない 確信 90%「うごけない」" },
    ]);
  });

  it("種の録音が R2 にあれば山田の赤に結ぶ", async () => {
    await start(await judgeCm(1), AT, fakeBucket([SEED_RECORDING_KEYS.m4a]));
    expect(sqlite.prepare("SELECT recording_key AS k FROM signals WHERE id = ?").get(SEED_RED_SIGNAL_ID)).toEqual({ k: SEED_RECORDING_KEYS.m4a });
    expect(sqlite.prepare("SELECT body FROM timeline_entries WHERE id = 't-seed-red-2'").get()).toEqual({ body: "録音 文字起こし「いたい、うごけない」" });
  });

  it("担当一覧は発災時の並びで、山田が至急の 1 番。色・連絡順・理由は T153 の前の種（同じ時刻の大雨の想定を種で入れた形）と同じ", async () => {
    await start(await judgeCm(1), AT);
    const now = LATER;
    const after = await caseload(DEMO_OFFICE_ID, DEMO_CARE_MANAGER_ID, now);
    expect(after.situation).not.toBeNull();
    const top = after.rows.find((r) => r.rank === 1);
    expect(top?.id).toBe("p-01");
    expect(top?.triage?.color).toBe("red");
    expect(top?.triage?.reason).toContain("（AI）");

    // 比べる元: 平時の種に、前の種と同じ行（書き手 山本）をそのまま入れた DB
    const old = seeded();
    try {
      for (const r of demoDisasterRows(AT)) old.exec(insert(r.table, r.row));
      const oldDb = d1FromSqlite(old);
      const before = await loadCaseload(oldDb, { officeId: DEMO_OFFICE_ID, careManagerId: DEMO_CARE_MANAGER_ID }, todayJst(new Date(now)), now);
      expect(order(after)).toEqual(order(before!));
      expect(after.rows.map((r) => r.triage?.color)).toContain("red");
    } finally {
      old.close();
    }
  });

  it("審査員 3 人で共有: 審査員 1 が入れた状態が審査員 2・3 にも見え、もう一度押すと断る（競合）。審査員 2 が平時に戻すと 3 にも平時", async () => {
    const [j1, j2, j3] = [await judgeCm(1), await judgeCm(2), await judgeCm(3)];
    for (const j of [j1, j2, j3]) expect(j.office?.id).toBe(DEMO_OFFICE_ID);
    // 3 人とも同じ版の画面を開いていた
    const v = String((await loadDisasterState(db, DEMO_OFFICE_ID)).version);
    expect((await startPost(db, fakeBucket(), j1, form({ version: v }), AT)).entered).toBe(DEMO_OFFICE_ID);
    // 審査員 2 の古い画面から押しても入れ直さない
    const stale = await startPost(db, fakeBucket(), j2, form({ version: v }), LATER);
    expect(stale).toEqual({ outcome: { status: 303, location: "/office?error=conflict" }, entered: null });
    // 読み直した画面（災害モードの間）から押しても断る
    expect((await start(j3, LATER)).entered).toBeNull();
    expect(liveSignals(DEMO_OFFICE_ID)).toBe(1);
    const s = await loadDisasterState(db, DEMO_OFFICE_ID);
    expect(s).toMatchObject({ kind: "heavy_rain", startedByName: "審査員 1", version: 2 });

    // 審査員 2 が平時に戻す（今の切替の確認の欄から）
    const back = await modePost(db, j2, form({ kind: "normal", confirm: "1", version: String(s.version) }), LATER);
    expect(back).toEqual({ status: 303, location: "/office" });
    expect((await loadDisasterState(db, DEMO_OFFICE_ID)).kind).toBe("normal");
    const calm = await caseload(DEMO_OFFICE_ID, DEMO_CARE_MANAGER_ID, LATER);
    expect(calm.situation).toBeNull();
  });

  it("平時に戻してもう一度入れると、山田の赤と経過は 1 組のまま（二重にしない）。時刻は 2 回目の押した時刻から。事業所の経過は切替の履歴として残る", async () => {
    const [j1, j3] = [await judgeCm(1), await judgeCm(3)];
    await start(j1, AT);
    // 審査員が山田の分類を直した行（赤を指す経過）も入れ直しで消える
    sqlite.exec(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, signal_id, occurred_at, created_at)
       VALUES ('t-judge-note', 'p-01', '${j1.accountId}', 'care_manager', 'note', '分類（ケアマネ）', '${SEED_RED_SIGNAL_ID}', '${LATER}', '${LATER}')`,
    );
    const s = await loadDisasterState(db, DEMO_OFFICE_ID);
    await modePost(db, j1, form({ kind: "normal", confirm: "1", version: String(s.version) }), LATER);
    const r = await start(j3, AGAIN);
    expect(r.entered).toBe(DEMO_OFFICE_ID);
    expect(liveSignals(DEMO_OFFICE_ID)).toBe(1);
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = 'p-01'")).toBe(3);
    expect(sqlite.prepare("SELECT occurred_at AS t FROM signals WHERE id = ?").get(SEED_RED_SIGNAL_ID)).toEqual({ t: demoTimes(AGAIN).redAt });
    const after = await loadDisasterState(db, DEMO_OFFICE_ID);
    expect(after).toMatchObject({ kind: "heavy_rain", startedAt: demoTimes(AGAIN).disasterAt, startedByName: "審査員 3", version: s.version + 1 + 2 });
    const log = await loadOfficeLog(db, DEMO_OFFICE_ID);
    expect(log.map((l) => [l.kind, l.who])).toEqual([
      ["disaster_info", "審査員 3"],
      ["disaster_on", "審査員 3"],
      ["disaster_off", "審査員 1"],
      ["disaster_info", "審査員 1"],
      ["disaster_on", "審査員 1"],
    ]);
    const top = (await caseload(DEMO_OFFICE_ID, DEMO_CARE_MANAGER_ID, AGAIN)).rows.find((x) => x.rank === 1);
    expect(top?.id).toBe("p-01");
  });

  it("確認用の事業所（山本）: 確認用の id（chk-）で入り、書き手は確認用の山本。デモ事業所は平時のまま", async () => {
    const y = await yamamoto();
    expect(y.office?.id).toBe(CHECK_OFFICE_ID);
    expect((await start(y, AT)).entered).toBe(CHECK_OFFICE_ID);
    expect(await loadDisasterState(db, CHECK_OFFICE_ID)).toMatchObject({ kind: "heavy_rain", startedBy: CHECK_CARE_MANAGER_ID, alertLevel: 4, version: 2 });
    expect(sqlite.prepare("SELECT person_id AS p FROM signals WHERE id = ?").get(CHECK_RED_SIGNAL_ID)).toEqual({ p: "chk-p-01" });
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = 'chk-p-01'")).toBe(3);
    expect((await loadDisasterState(db, DEMO_OFFICE_ID)).kind).toBe("normal");
    expect(liveSignals(DEMO_OFFICE_ID)).toBe(0);
    const top = (await caseload(CHECK_OFFICE_ID, CHECK_CARE_MANAGER_ID, LATER)).rows.find((r) => r.rank === 1);
    expect(top?.id).toBe("chk-p-01");
    // 審査員が押しても確認用の事業所には効かない（審査員はデモ事業所）
    const j = await judgeCm(1);
    await start(j, LATER);
    expect((await loadDisasterState(db, CHECK_OFFICE_ID)).startedBy).toBe(CHECK_CARE_MANAGER_ID);
  });

  it("断る: ログインなし 401、医療班・本人の役と協力事業所のケアマネは 403、版の無いフォームは入力不正。何も書かない", async () => {
    expect((await startPost(db, fakeBucket(), null, form({ version: "0" }), AT)).outcome).toEqual({ status: 401 });
    const base = await judgeCm(1);
    const partner: Principal = {
      ...base,
      judge: false,
      admin: true,
      accountId: "acct-partner",
      office: { id: "office-partner", name: "協力事業所", kind: "regular" },
      caseloadOf: "acct-partner",
    };
    const medical: Principal = { ...base, role: "medical", caseloadOf: null };
    for (const p of [partner, medical]) {
      expect(canStartSeed(p)).toBe(false);
      expect((await startPost(db, fakeBucket(), p, form({ version: "0" }), AT)).outcome).toEqual({ status: 403 });
    }
    expect((await startPost(db, fakeBucket(), base, form({}), AT)).outcome).toEqual({ status: 303, location: "/office?error=bad" });
    expect(count("SELECT count(*) AS n FROM disaster_state")).toBe(0);
    expect(count("SELECT count(*) AS n FROM office_timeline_entries")).toBe(0);
  });

  it("通知の合図（T149）: 平時から入った時だけ entered に事業所（route が本人・家族へ「大丈夫ですか」を送る）。断った時は null", async () => {
    const j = await judgeCm(1);
    expect((await start(j, AT)).entered).toBe(DEMO_OFFICE_ID);
    expect((await start(j, LATER)).entered).toBeNull();
  });
});

describe("T153 訓練は今どおり", () => {
  it("種の終わった訓練は両方の種の事業所にある。新しい訓練は平時でも発災開始のあとでも始められる", async () => {
    expect((await listDrills(db, DEMO_OFFICE_ID)).map((d) => [d.id, d.status])).toEqual([[SEED_DRILL_ID, "finished"]]);
    expect((await listDrills(db, CHECK_OFFICE_ID)).map((d) => [d.id, d.status])).toEqual([[CHECK_SEED_DRILL_ID, "finished"]]);
    const j1 = await judgeCm(1);
    const calm = await startDrill(db, drillScope(j1)!, "heavy_rain", AT);
    expect(calm.ok).toBe(true);
    const j2 = await judgeCm(2);
    await start(j2, AT);
    const busy = await startDrill(db, drillScope(j2)!, "earthquake", LATER);
    expect(busy.ok).toBe(true);
    // 訓練の信号は事業所の安否に混ざらない（訓練でない信号は山田の赤の 1 つだけ）
    expect(liveSignals(DEMO_OFFICE_ID)).toBe(1);
  });
});
