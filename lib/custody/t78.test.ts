// T78（qa-20261104 の中 4）: 本人がスマホで赤（けが・動けない）を送ったあとに医療班が受け入れると、表は受け入れを緑に数える
// （色と連絡順はルールの表のまま）。受入一覧・担当一覧・CSV の状態の言葉は「無事」でなく「受入」、受入一覧の行に受入の前の答え、
// 経過には赤の行が残る。D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { StaffTable } from "../../components/staff/StaffTable.tsx";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { staffCsv } from "../forms/staff-csv.ts";
import { stateLabel } from "../labels.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { saveSignal } from "../signals/save.ts";
import { staffActor, type StaffActor } from "./actor.ts";
import { beforeReceive, loadStaffBoard } from "./board.ts";
import { receive } from "./store.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-03";
const DISASTER_AT = "2026-11-03T00:00:00.000Z";
/** 本人の赤（JST 9:30）・受け入れ（10:00）・今 */
const RED_AT = "2026-11-03T00:30:00.000Z";
const AT = "2026-11-03T01:00:00.000Z";
const NOW = "2026-11-03T02:00:00.000Z";
const SHELTER = "みどり小学校";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
  sqlite
    .prepare(
      `INSERT INTO disaster_state (office_id, kind, started_at, started_by, outage_scope, version, updated_by, updated_at)
       VALUES ('office-demo', 'heavy_rain', ?, 'acct-yamamoto', 'none', 1, 'acct-yamamoto', ?)`,
    )
    .run(DISASTER_AT, DISASTER_AT);
});
afterEach(() => sqlite.close());

const medical: Principal = {
  role: "medical",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: null,
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: null,
  personId: null,
  contactId: null,
};
const actor = (): StaffActor => staffActor(medical)!;

/** 種の 1 人（p-04）が本人のスマホで赤を送る（けが あり・動けない） */
async function redFromPhone(personId = "p-04") {
  const r = await saveSignal(
    db,
    { officeId: "office-demo", personId, authorId: null, writer: { kind: "self" } },
    {
      id: "00000000-0000-4000-8000-000000000078",
      color: "red",
      whereNow: null,
      answers: { injured: true, atHome: true, canMove: false, hasMedicine: null },
      occurredAt: RED_AT,
      sentAt: RED_AT,
    },
    RED_AT,
  );
  if (!r.ok) throw new Error(r.error);
}

describe("赤（けが・動けない）のあとに受け入れた人（T78）", () => {
  it("受入一覧: 色は緑・理由「到着 みどり小学校」のまま、状態は「受入」、行に受入の前の答え", async () => {
    await redFromPhone();
    await receive(db, actor(), { personId: "p-04", shelter: SHELTER, via: "search" }, AT);
    const board = await loadStaffBoard(db, actor(), TODAY, NOW);
    const row = board.rows.find((r) => r.personId === "p-04")!;
    expect([row.color, row.greenVia, stateLabel(row)]).toEqual(["green", "arrival", "受入"]);
    expect(row.reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
    expect(row.before).toBe("本人「けが」「動けない」 11/3 09:30");
    // 上の人数は色の区分（緑に数える。言葉の「無事」は区分の名前のまま）
    expect(board.counts.green).toBe(1);

    const html = renderToStaticMarkup(createElement(StaffTable, { rows: board.rows, shelters: board.shelters }));
    // 行の状態の印は「受入」（上の状態の切替の「無事 1」は色の区分の名前で、そのまま）
    const tr = html.match(/<tr data-person="p-04"[^>]*>(.*?)<\/tr>/)![1];
    expect(tr).toContain(">受入<");
    expect(tr).not.toContain(">無事<");
    expect(html).toMatch(/data-before[^>]*>.*受入前.*本人「けが」「動けない」 11\/3 09:30/);

    const csv = staffCsv(board, { name: "医療班", judge: false }, NOW);
    expect(csv).toContain(`,受入,到着 ${SHELTER}`);
  });

  it("担当一覧: 色・連絡順は表のまま（緑、組 4 の並び）、状態の言葉は「受入」", async () => {
    await redFromPhone();
    const before = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    const red = before!.rows.find((r) => r.id === "p-04")!;
    expect([red.triage?.color, red.triage?.rule, stateLabel(red.triage!)]).toEqual(["red", "red_injury", "至急"]);

    await receive(db, actor(), { personId: "p-04", shelter: SHELTER, via: "search" }, AT);
    const after = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW);
    const row = after!.rows.find((r) => r.id === "p-04")!;
    expect([row.triage?.color, row.triage?.rule, row.triage?.group, row.triage?.greenVia]).toEqual(["green", "green", 4, "arrival"]);
    expect(stateLabel(row.triage!)).toBe("受入");
    // 連絡順は緑の中の並び（表の compareResults のまま）。ほかの人の言葉は「無事」でない色の言葉のまま
    const greens = after!.rows.filter((r) => r.triage?.color === "green").sort((a, b) => a.rank! - b.rank!);
    expect(greens.map((r) => r.rank)).toEqual([...greens.map((r) => r.rank)].sort((a, b) => a! - b!));
    for (const r of after!.rows.filter((x) => x.id !== "p-04")) expect(r.triage?.greenVia).toBeUndefined();
  });

  it("経過には受入の前の赤の行（無事じゃない けが あり・動けない）と受入の行が残る", async () => {
    await redFromPhone();
    await receive(db, actor(), { personId: "p-04", shelter: SHELTER, via: "search" }, AT);
    const yamamoto: Principal = { ...medical, role: "care_manager", judge: false, admin: true, accountId: "acct-yamamoto", caseloadOf: "acct-yamamoto" };
    const rows = await loadPersonPage(db, yamamoto, "p-04");
    const items = timelineItems(rows!);
    const red = items.find((x) => x.at === RED_AT)!;
    expect(red.body).toMatch(/^無事じゃない .*けが.*動け/);
    expect(red.tone).toBe("urgent");
    expect(items.some((x) => x.kind === "受入" && x.body === SHELTER)).toBe(true);
  });

  it("医療班への提供に同意の無い人は、受入の前の答えを出さない（理由と同じ。経過の信号の行も医療班には出ない）", async () => {
    await redFromPhone();
    expect(sqlite.prepare(`UPDATE consents SET status = 'refused' WHERE person_id = 'p-04' AND kind = 'medical'`).run().changes).toBe(1);
    await receive(db, actor(), { personId: "p-04", shelter: SHELTER, via: "search" }, AT);
    const row = (await loadStaffBoard(db, actor(), TODAY, NOW)).rows.find((r) => r.personId === "p-04")!;
    expect([row.reason, row.before, stateLabel(row)]).toEqual(["", null, "受入"]);
  });
});

describe("受入の前の答えの 1 行（beforeReceive）", () => {
  const S = { now: NOW, disasterAt: DISASTER_AT, outageAt: null };
  const sig = (p: Partial<Parameters<typeof beforeReceive>[0][number]>) => ({
    color: "red" as const,
    source: "self" as const,
    injured: null,
    can_move: null,
    occurred_at: RED_AT,
    ...p,
  });
  it("受入の前の最後が赤なら誰が・答え・時刻。答えが無ければ「無事じゃない」", () => {
    expect(beforeReceive([sig({ injured: 1 })], AT, S)).toBe("本人「けが」 11/3 09:30");
    expect(beforeReceive([sig({ source: "family" })], AT, S)).toBe("家族「無事じゃない」 11/3 09:30");
  });
  it("受入の前の最後が緑・受入より後の赤・発災より前は出さない", () => {
    expect(beforeReceive([sig({ injured: 1 }), sig({ color: "green", occurred_at: "2026-11-03T00:45:00.000Z" })], AT, S)).toBeNull();
    expect(beforeReceive([sig({ injured: 1, occurred_at: "2026-11-03T01:30:00.000Z" })], AT, S)).toBeNull();
    expect(beforeReceive([sig({ injured: 1, occurred_at: "2026-11-02T23:00:00.000Z" })], AT, S)).toBeNull();
    expect(beforeReceive([], AT, S)).toBeNull();
  });
});
