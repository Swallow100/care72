// T186: 訓練の参加者は 20 人まで。担当一覧が 20 人を越えるときは選んだ人だけで始め、選ばない・越える開始はサーバーが断る。
// 担当一覧が 20 人以下なら今のまま（選ばなければ全員）。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { drillScope, drillStartInfo, loadDrillRow, participantsOf, pickParticipants, startDrill, startFactsOf } from "./db.ts";
import { startPost } from "./http.ts";
import { defaultParticipants, overParticipants, PARTICIPANTS_LIMIT } from "./options.ts";
import { loadDrillScreen } from "./view.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const principal: Principal = {
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
const SCOPE = drillScope(principal)!;
const START = "2026-11-08T01:00:00.000Z";

/** 担当一覧に p-01 の写しを n 人足す（よみは「ン」で始め、種の 10 人より後ろに並ぶ） */
function addPeople(n: number) {
  const cols = (sqlite.prepare("PRAGMA table_info(people)").all() as Array<{ name: string }>).map((c) => c.name);
  const rest = cols.filter((c) => c !== "id" && c !== "name" && c !== "kana");
  for (let i = 0; i < n; i++) {
    const no = String(i + 1).padStart(2, "0");
    sqlite
      .prepare(`INSERT INTO people (id, name, kana, ${rest.join(", ")}) SELECT ?, ?, ?, ${rest.join(", ")} FROM people WHERE id = 'p-01'`)
      .run(`t186-${no}`, `試行 ${no}`, `ンシコウ${no}`);
  }
}

const caseload = async () => (await drillStartInfo(db, SCOPE)).people.map((p) => p.id);

describe("上限の決まり", () => {
  it("上限は 20 人。既定は担当一覧の順の上から 20 人、20 人以下なら全員", () => {
    expect(PARTICIPANTS_LIMIT).toBe(20);
    expect(overParticipants(20)).toBe(false);
    expect(overParticipants(21)).toBe(true);
    const ids = Array.from({ length: 25 }, (_, i) => `x${i}`);
    expect(defaultParticipants(ids)).toEqual(ids.slice(0, 20));
    expect(defaultParticipants(ids.slice(0, 7))).toEqual(ids.slice(0, 7));
    // 越えるときは要点（機器・独居など）の多い人を先に選び、並びは担当一覧の順のまま
    const rows = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, facts: i === 22 ? ["酸素", "独居"] : i === 21 ? ["独居"] : [] }));
    const got = defaultParticipants(rows).map((r) => r.id);
    expect(got).toHaveLength(20);
    expect(got).toContain("p22");
    expect(got).toContain("p21");
    expect(got).not.toContain("p19");
    expect(got).toEqual([...got].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it("pickParticipants: 越える担当一覧で選ばない・21 人選ぶは断る。20 人は通る", () => {
    const ids = Array.from({ length: 25 }, (_, i) => `x${i}`);
    expect(pickParticipants(ids, undefined)).toBeNull();
    expect(pickParticipants(ids, ids.slice(0, 21))).toBeNull();
    expect(pickParticipants(ids, ids.slice(5, 25))).toEqual(ids.slice(5, 25));
    // 20 人以下の担当一覧は今のまま（選ばなければ全員）
    expect(pickParticipants(ids.slice(0, 20), undefined)).toEqual(ids.slice(0, 20));
  });
});

describe("20 人以下の担当一覧は今のまま", () => {
  it("種の 10 人: 選ばずに始めれば全員", async () => {
    const all = await caseload();
    expect(all).toHaveLength(10);
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "d10")).toEqual({ ok: true, id: "d10" });
    expect(participantsOf((await loadDrillRow(db, DEMO.id, "d10"))!)).toEqual(all);
  });

  it("ちょうど 20 人: 選ばずに始めれば 20 人全員", async () => {
    addPeople(10);
    const all = await caseload();
    expect(all).toHaveLength(20);
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "d20")).toEqual({ ok: true, id: "d20" });
    expect(participantsOf((await loadDrillRow(db, DEMO.id, "d20"))!)).toEqual(all);
  });
});

describe("21 人以上の担当一覧", () => {
  beforeEach(() => addPeople(13));

  it("選ばない開始・21 人の開始は断り、訓練を作らない", async () => {
    const all = await caseload();
    expect(all).toHaveLength(23);
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "x")).toEqual({ ok: false, error: "invalid" });
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "x", { participants: all.slice(0, 21) })).toEqual({ ok: false, error: "invalid" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM drills").get()).toEqual({ n: 0 });
  });

  it("開始の POST でも 21 人は入力不正（400）", async () => {
    const all = await caseload();
    const res = await startPost(db, principal, { scenario: "heavy_rain", options: { participants: all.slice(0, 21), clock: true } }, START);
    expect(res.status).toBe(400);
  });

  it("選んだ 20 人で始め、画面と仮想の世界の参加者は選んだ人だけ", async () => {
    const all = await caseload();
    const picked = all.slice(3, 23);
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "d", { participants: picked, clock: true })).toEqual({ ok: true, id: "d" });
    const row = (await loadDrillRow(db, DEMO.id, "d"))!;
    expect(participantsOf(row)).toEqual(picked);
    const screen = (await loadDrillScreen(db, SCOPE, "d", null))!;
    expect(screen.rows.map((r) => r.id).sort()).toEqual([...picked].sort());
  });

  it("仮想も選んだ 20 人だけで始まる", async () => {
    const all = await caseload();
    const picked = all.slice(0, 20);
    expect(await startDrill(db, SCOPE, "virtual", START, {}, () => "v", { participants: picked, clock: true })).toEqual({ ok: true, id: "v" });
    expect(participantsOf((await loadDrillRow(db, DEMO.id, "v"))!)).toEqual(picked);
  });

  it("ほかの事業所・ほかの担当の人は選べない（壁の中だけ）", async () => {
    const all = await caseload();
    const other = sqlite.prepare("SELECT id FROM people WHERE office_id <> 'office-demo' OR care_manager_id <> 'acct-yamamoto' LIMIT 1").get() as
      | { id: string }
      | undefined;
    if (!other) return;
    expect(await startDrill(db, SCOPE, "heavy_rain", START, {}, () => "x", { participants: [...all.slice(0, 19), other.id] })).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("開始の前の一覧に町と台帳の要点", async () => {
    const people = (await drillStartInfo(db, SCOPE)).people;
    expect(people).toHaveLength(23);
    for (const p of people) {
      expect(typeof p.town === "string" || p.town === null).toBe(true);
      expect(Array.isArray(p.facts)).toBe(true);
    }
    expect(people.some((p) => p.facts.length > 0)).toBe(true);
  });
});

describe("台帳の要点", () => {
  it("医療依存の印、時計の無い人は機器、独居", () => {
    const ledger = (household: string | null, devices: Array<{ kind: string }>) =>
      ({ basic: { household }, medical: { devices } }) as unknown as Parameters<typeof startFactsOf>[0] extends infer T ? (T extends { ledger: infer L } ? L : never) : never;
    expect(startFactsOf({ ledger: ledger("alone", [{ kind: "oxygen" }]), clocks: [{ category: "oxygen" }] as never })).toEqual(["酸素", "独居"]);
    expect(startFactsOf({ ledger: ledger(null, []), clocks: [] })).toEqual([]);
    expect(startFactsOf(undefined)).toEqual([]);
  });
});
