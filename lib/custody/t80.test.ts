// T80（2 回目の点検）: 医療班が受け入れたあとに事業所で 平時 → 大雨（大雨 → 平時 → 大雨 も）と切り替えると、
// 受入一覧に残る人が「不明 連絡なし 1 分」になっていた。表の入力（受け入れ）を「発災から今まで」で絞り、今の災害の始まりより前の
// 受け入れを落としていたため。受入中（解除していない）の受け入れは、いつ受け入れたかに関わらず表に渡す（表の決め方は変えない）。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadDisasterState, loadSituation, switchDisasterMode } from "../disaster/db.ts";
import { personDisaster } from "../disaster/person.ts";
import type { DisasterKind } from "../db/types.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { stateLabel } from "../labels.ts";
import { loadPersonPage } from "../person.ts";
import { staffActor, type StaffActor } from "./actor.ts";
import { arrivalInScope, type ArrivalRow } from "./arrivals.ts";
import { loadStaffBoard } from "./board.ts";
import { receive, release } from "./store.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-03";
/** 平時の受け入れ（JST 9:00）・大雨へ切替（10:00）・今（10:01） */
const RECEIVED = "2026-11-03T00:00:00.000Z";
const SWITCH = "2026-11-03T01:00:00.000Z";
const NOW = "2026-11-03T01:01:00.000Z";
const SHELTER = "みどり小学校";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
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
const yamamoto: Principal = { ...medical, role: "care_manager", judge: false, admin: true, accountId: "acct-yamamoto", caseloadOf: "acct-yamamoto" };
const actor = (): StaffActor => staffActor(medical)!;

async function switchTo(kind: DisasterKind, at: string) {
  const { version } = await loadDisasterState(db, "office-demo");
  const r = await switchDisasterMode(db, { officeId: "office-demo", authorId: "acct-yamamoto", authorRole: "care_manager" }, { kind, version, at });
  if (!r.ok || !r.changed) throw new Error(`切替できない: ${kind}`);
}

async function receiveP04(at = RECEIVED) {
  const r = await receive(db, actor(), { personId: "p-04", shelter: SHELTER, via: "search" }, at);
  if (!r.ok) throw new Error(r.error);
  return r.custodyId;
}

/** 担当一覧・受入一覧・本人のページ・様式 9 の p-04 の色と言葉 */
async function everywhere() {
  const caseload = (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW))!.rows.find((r) => r.id === "p-04")!;
  const staff = (await loadStaffBoard(db, actor(), TODAY, NOW)).rows.find((r) => r.personId === "p-04");
  const page = await personDisaster(db, (await loadPersonPage(db, yamamoto, "p-04"))!, NOW);
  const form9 = (await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: await loadSituation(db, "office-demo", NOW) }))!;
  return { caseload: caseload.triage!, staff, page: page.triage!, form9 };
}

describe("受入中の人は災害モードの切替のあとも「受入」（T80）", () => {
  it("平時に受け入れ → 大雨: 担当一覧・受入一覧・本人のページとも 緑・行 green・「到着 みどり小学校」・状態「受入」（前は 不明 連絡なし 1 分）", async () => {
    await receiveP04();
    // 平時の受入一覧は受け入れを発災とみなす（前のまま）
    const normal = (await loadStaffBoard(db, actor(), TODAY, SWITCH)).rows.find((r) => r.personId === "p-04")!;
    expect([normal.color, stateLabel(normal)]).toEqual(["green", "受入"]);

    await switchTo("heavy_rain", SWITCH);
    const { caseload, staff, page } = await everywhere();
    for (const r of [caseload, page]) {
      // 受け入れは今の発災より前なので理由に受入日（T82）
      expect([r.color, r.rule, r.greenVia, r.reason, stateLabel(r)]).toEqual(["green", "green", "arrival", `到着 ${SHELTER} 受入 11/3`, "受入"]);
    }
    expect([staff!.color, staff!.greenVia, stateLabel(staff!)]).toEqual(["green", "arrival", "受入"]);
    expect(staff!.reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
  });

  it("大雨で受け入れ → 平時 → 大雨（今の発災は受け入れより後）でも「受入」", async () => {
    await switchTo("heavy_rain", "2026-11-02T23:00:00.000Z");
    await receiveP04();
    await switchTo("normal", "2026-11-03T00:30:00.000Z");
    await switchTo("heavy_rain", SWITCH);
    const { caseload, staff, page } = await everywhere();
    expect([caseload.color, caseload.greenVia, stateLabel(caseload)]).toEqual(["green", "arrival", "受入"]);
    expect([page.color, page.greenVia]).toEqual(["green", "arrival"]);
    expect([staff!.color, stateLabel(staff!)]).toEqual(["green", "受入"]);
  });

  it("並びは表のまま: 受入の人は緑の組（4）、ほかの人の色と並びは切替のあとも受け入れの有る無しで変わらない", async () => {
    await switchTo("heavy_rain", SWITCH);
    const before = (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW))!.rows;
    await switchTo("normal", "2026-11-03T01:00:30.000Z");
    await receiveP04("2026-11-03T01:00:40.000Z");
    await switchTo("heavy_rain", "2026-11-03T01:00:50.000Z");
    const after = (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW))!.rows;
    const p04 = after.find((r) => r.id === "p-04")!;
    expect([p04.triage!.color, p04.triage!.group]).toEqual(["green", 4]);
    // ほかの人の色・行と並びの順は、受け入れの有る無しで変わらない
    const colors = (rows: typeof after) => Object.fromEntries(rows.filter((r) => r.id !== "p-04").map((r) => [r.id, [r.triage!.color, r.triage!.rule]]));
    const order = (rows: typeof after) => [...rows].filter((r) => r.id !== "p-04").sort((a, b) => a.rank! - b.rank!).map((r) => r.id);
    expect(colors(after)).toEqual(colors(before));
    expect(order(after)).toEqual(order(before));
  });

  it("様式 9 も同じ入力（受け入れの読み込みは 1 か所）: 受入中の人は緑", async () => {
    await receiveP04();
    await switchTo("heavy_rain", SWITCH);
    const { form9 } = await everywhere();
    expect(JSON.stringify(form9)).toContain(`到着 ${SHELTER}`);
  });

  it("切替の前に閉じた受け入れ（退所・搬送）は渡さない: 今の災害では連絡なしの不明のまま", async () => {
    for (const kind of ["discharged", "transported"] as const) {
      const id = await receiveP04();
      const r = await release(db, actor(), { custodyId: id, kind, note: kind === "transported" ? "市民病院" : null }, "2026-11-03T00:30:00.000Z");
      expect(r.ok).toBe(true);
      await switchTo("heavy_rain", SWITCH);
      const caseload = (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY, NOW))!.rows.find((x) => x.id === "p-04")!;
      expect([caseload.triage!.color, caseload.triage!.rule, caseload.triage!.greenVia], kind).toEqual(["gray", "unknown", undefined]);
      await switchTo("normal", "2026-11-03T01:00:30.000Z");
    }
  });
});

describe("表に渡す受け入れ（arrivalInScope）", () => {
  const S = { now: NOW, disasterAt: SWITCH, outageAt: null };
  const row = (p: Partial<ArrivalRow>): ArrivalRow => ({
    person_id: "p-04",
    shelter: SHELTER,
    received_at: RECEIVED,
    release_kind: null,
    released_at: null,
    release_note: null,
    ...p,
  });
  it("受入中（解除していない）: 発災より前の受け入れも渡す。今より後は渡さない", () => {
    expect(arrivalInScope(row({}), S)).toBe(true);
    expect(arrivalInScope(row({ received_at: "2026-11-03T01:30:00.000Z" }), S)).toBe(false);
  });
  it("閉じた受け入れ: 発災から今までだけ（前のまま）", () => {
    expect(arrivalInScope(row({ release_kind: "discharged", released_at: "2026-11-03T00:30:00.000Z" }), S)).toBe(false);
    expect(arrivalInScope(row({ release_kind: "transported", released_at: "2026-11-03T01:00:30.000Z", release_note: "市民病院" }), S)).toBe(false);
    expect(arrivalInScope(row({ received_at: "2026-11-03T01:00:10.000Z", release_kind: "discharged", released_at: "2026-11-03T01:00:20.000Z" }), S)).toBe(true);
  });
});
