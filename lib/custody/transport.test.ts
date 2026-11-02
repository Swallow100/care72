// 搬送のあとのケアマネの一覧の状態と、受け持ちの一覧の同意の範囲（docs/tasks/T24.md）。
// - 搬送で受け持ちを閉じると、ケアマネの一覧・本人のページ・様式 9 の状態が「搬送 行き先」（緑のまま）。退所は「到着」のまま
// - 受け持ちの一覧（/staff）は医療班への提供に同意の無い人の医療の列と理由を空で渡す（client の部品に範囲の外の値を渡さない）
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。色の言葉は文字で書かず色の値で比べる。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { personDisaster } from "../disaster/person.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { loadPersonPage } from "../person.ts";
import { staffActor, type StaffActor } from "./actor.ts";
import { loadStaffBoard } from "./board.ts";
import { receive, release } from "./store.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-03";
const DISASTER_AT = "2026-11-03T00:00:00.000Z";
const AT = "2026-11-03T01:00:00.000Z";
const LATER = "2026-11-03T01:30:00.000Z";
const NOW = "2026-11-03T02:00:00.000Z";
const SHELTER = "みどり小学校";
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite
    .prepare(
      `INSERT INTO disaster_state (office_id, kind, started_at, started_by, outage_scope, version, updated_by, updated_at)
       VALUES ('office-demo', 'heavy_rain', ?, 'acct-yamamoto', 'none', 1, 'acct-yamamoto', ?)`,
    )
    .run(DISASTER_AT, DISASTER_AT);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const medical: Principal = {
  role: "medical",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: null,
  office: DEMO,
  caseloadOf: null,
  personId: null,
  contactId: null,
};
const yamamoto: Principal = { ...medical, role: "care_manager", judge: false, admin: true, accountId: "acct-yamamoto", displayName: "山本", caseloadOf: "acct-yamamoto" };
const actor: StaffActor = staffActor(medical)!;

async function receiveThen(personId: string, kind: "transported" | "discharged", note: string | null) {
  const r = await receive(db, actor, { personId, shelter: SHELTER, via: "search" }, AT);
  if (!r.ok) throw new Error(r.error);
  const out = await release(db, actor, { custodyId: r.custodyId, kind, note }, LATER);
  expect(out.ok).toBe(true);
}

async function caseloadTriage(personId: string) {
  const c = await loadCaseload(db, SCOPE, TODAY, NOW);
  return c!.rows.find((r) => r.id === personId)!.triage!;
}

describe("搬送のあとのケアマネの一覧の状態", () => {
  it("搬送で閉じると「搬送 行き先」で緑のまま。本人のページ・様式 9 も同じ", async () => {
    await receiveThen("p-01", "transported", "中央病院");
    const t = await caseloadTriage("p-01");
    expect(t.color).toBe("green");
    expect(t.reason.startsWith("搬送 中央病院")).toBe(true);

    const page = (await loadPersonPage(db, yamamoto, "p-01"))!;
    const d = await personDisaster(db, page, NOW);
    expect(d.triage).toMatchObject({ color: "green", reason: t.reason });

    const f9 = await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: { now: NOW, disasterAt: DISASTER_AT, outageAt: null } });
    expect(f9!.sheet.rows.find((r) => r.id === "p-01")!.color).toBe("green");
  });

  it("行き先が無ければ「搬送」だけ。退所は「到着 避難所」のまま", async () => {
    await receiveThen("p-01", "transported", null);
    expect((await caseloadTriage("p-01")).reason.startsWith("搬送")).toBe(true);
    expect((await caseloadTriage("p-01")).reason.includes(SHELTER)).toBe(false);

    await receiveThen("p-10", "discharged", null);
    expect((await caseloadTriage("p-10")).reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
  });

  it("搬送より後の赤は赤。搬送の前（受け入れだけ）は「到着」", async () => {
    const r = await receive(db, actor, { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    if (!r.ok) throw new Error(r.error);
    expect((await caseloadTriage("p-01")).reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
    await release(db, actor, { custodyId: r.custodyId, kind: "transported", note: "中央病院" }, LATER);
    sqlite.prepare(`INSERT INTO signals (id, person_id, color, source, occurred_at) VALUES ('s-red', 'p-01', 'red', 'family', ?)`).run(
      "2026-11-03T01:45:00.000Z",
    );
    expect((await caseloadTriage("p-01")).color).toBe("red");
  });
});

describe("受け持ちの一覧の同意の範囲", () => {
  it("9 渡辺（医療班への提供に同意なし）は医療の列と理由が空、医療要約の入口も無い。色と番号はある", async () => {
    await receive(db, actor, { personId: "p-09", shelter: SHELTER, via: "search" }, AT);
    await receive(db, actor, { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    const board = await loadStaffBoard(db, actor, TODAY, NOW);
    const watanabe = board.rows.find((r) => r.personId === "p-09")!;
    expect(watanabe).toMatchObject({ marks: [], medications: [], devices: [], remain: null, reason: "", summary: false, color: "green" });
    expect(watanabe.rank).toBeGreaterThan(0);
    // 渡辺の降圧薬の名前は一覧のどこにも無い
    const meds = JSON.parse((sqlite.prepare("SELECT ledger FROM people WHERE id = 'p-09'").get() as { ledger: string }).ledger).medical
      .medications as Array<{ name: string }>;
    expect(meds.length).toBeGreaterThan(0);
    for (const m of meds) expect(JSON.stringify(board)).not.toContain(m.name);

    const yamada = board.rows.find((r) => r.personId === "p-01")!;
    expect(yamada.summary).toBe(true);
    expect(yamada.marks.length).toBeGreaterThan(0);
    expect(yamada.reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
    // 要配慮は医療が範囲にある人だけ数える
    expect(board.medical).toBe(1);
  });
});
