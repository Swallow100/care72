// T82（朝の見直し 11/4 の「正しさ」中 4）: 受入中（解除していない）の受け入れは、今の災害の始まりより前でも表に渡す（T80）。
// 何日も前に受け入れて解除し忘れた人が新しい発災で緑「到着」になるので、受け入れたのが今の発災より前なら理由に受入日を出す
// （「到着 みどり小学校 受入 11/1」）。色・行・組・並びは変えない。D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DisasterKind } from "../db/types.ts";
import { loadDisasterState, loadSituation, switchDisasterMode } from "../disaster/db.ts";
import { personDisaster } from "../disaster/person.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { stateLabel } from "../labels.ts";
import { loadPersonPage } from "../person.ts";
import { staffActor, type StaffActor } from "./actor.ts";
import { triageArrivals, type ArrivalRow } from "./arrivals.ts";
import { loadStaffBoard } from "./board.ts";
import { receive } from "./store.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const SHELTER = "みどり小学校";
/** 受け入れ（11/1 9:00 JST）・大雨へ切替（11/3 10:00）・今（11/3 10:01） */
const RECEIVED = "2026-11-01T00:00:00.000Z";
const SWITCH = "2026-11-03T01:00:00.000Z";
const NOW = "2026-11-03T01:01:00.000Z";
const TODAY = "2026-11-03";

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
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

async function switchTo(kind: DisasterKind, at: string) {
  const { version } = await loadDisasterState(db, "office-demo");
  const r = await switchDisasterMode(db, { officeId: "office-demo", authorId: "acct-yamamoto", authorRole: "care_manager" }, { kind, version, at });
  if (!r.ok || !r.changed) throw new Error(`切替できない: ${kind}`);
}

async function receiveP04(at: string) {
  const r = await receive(db, actor(), { personId: "p-04", shelter: SHELTER, via: "search" }, at);
  if (!r.ok) throw new Error(r.error);
}

async function everywhere(now = NOW) {
  const caseload = (await loadCaseload(db, SCOPE, TODAY, now))!.rows;
  const staff = (await loadStaffBoard(db, actor(), TODAY, now)).rows.find((r) => r.personId === "p-04")!;
  const page = (await personDisaster(db, (await loadPersonPage(db, yamamoto, "p-04"))!, now)).triage!;
  const form9 = (await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation: await loadSituation(db, "office-demo", now) }))!;
  return { caseload, p04: caseload.find((r) => r.id === "p-04")!.triage!, staff, page, form9 };
}

describe("受入中の受け入れが今の発災より前なら理由に受入日（T82）", () => {
  it("11/1 に受け入れ、解除しないまま 11/3 に大雨: 担当一覧・受入一覧・本人のページ・様式 9 の理由に「受入 11/1」。色・行・状態は前のまま", async () => {
    await receiveP04(RECEIVED);
    await switchTo("heavy_rain", SWITCH);
    const { p04, staff, page, form9 } = await everywhere();
    const reason = `到着 ${SHELTER} 受入 11/1`;
    for (const r of [p04, page]) {
      expect([r.color, r.rule, r.group, r.greenVia, stateLabel(r)]).toEqual(["green", "green", 4, "arrival", "受入"]);
      expect(r.reason.startsWith(reason)).toBe(true);
    }
    expect([staff.color, staff.greenVia, stateLabel(staff)]).toEqual(["green", "arrival", "受入"]);
    expect(staff.reason.startsWith(reason)).toBe(true);
    expect(JSON.stringify(form9)).toContain(reason);
  });

  it("並びは表のまま: 受入日を出しても、今の発災の中で受け入れた人と同じ組・同じ連絡順", async () => {
    // 今の発災の中で受け入れた物（受入日なし）
    await switchTo("heavy_rain", SWITCH);
    await receiveP04("2026-11-03T01:00:30.000Z");
    const inside = await everywhere();
    expect(inside.p04.reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
    expect(inside.p04.reason).not.toContain("受入 ");
    // 同じ受け入れを 11/1 にずらす（受入日あり）
    sqlite.exec(`UPDATE custody SET received_at = '${RECEIVED}' WHERE person_id = 'p-04'`);
    const before = await everywhere();
    expect(before.p04.reason).toContain("受入 11/1");
    expect([before.p04.color, before.p04.rule, before.p04.group]).toEqual([inside.p04.color, inside.p04.rule, inside.p04.group]);
    const order = (rows: typeof inside.caseload) => [...rows].sort((a, b) => a.rank! - b.rank!).map((r) => r.id);
    expect(order(before.caseload)).toEqual(order(inside.caseload));
  });

  it("triageArrivals: 受入中で発災より前の行だけ避難所の名前に受入日（日本の日付）。閉じた行・発災のあとの行は名前のまま", () => {
    const S = { now: NOW, disasterAt: SWITCH };
    const row = (p: Partial<ArrivalRow>): ArrivalRow => ({
      person_id: "p-04",
      shelter: SHELTER,
      received_at: RECEIVED,
      release_kind: null,
      released_at: null,
      release_note: null,
      ...p,
    });
    // 11/2 23:30 JST（UTC では 11/2 14:30）は「11/2」、11/2 0:30 JST（UTC では 11/1 15:30）も「11/2」
    expect(triageArrivals([row({ received_at: "2026-11-02T14:30:00.000Z" })], S)).toEqual([
      { at: "2026-11-02T14:30:00.000Z", shelter: `${SHELTER} 受入 11/2` },
    ]);
    expect(triageArrivals([row({ received_at: "2026-11-01T15:30:00.000Z" })], S)[0].shelter).toBe(`${SHELTER} 受入 11/2`);
    // 発災のあと
    expect(triageArrivals([row({ received_at: "2026-11-03T01:00:30.000Z" })], S)[0].shelter).toBe(SHELTER);
    // 閉じた行は発災から今までの物だけ（前のまま）。発災のあとに受け入れて搬送した物は名前のまま
    expect(
      triageArrivals(
        [row({ received_at: "2026-11-03T01:00:10.000Z", release_kind: "transported", released_at: "2026-11-03T01:00:40.000Z", release_note: "市民病院" })],
        S,
      ),
    ).toEqual([{ at: "2026-11-03T01:00:10.000Z", shelter: SHELTER, transported: { at: "2026-11-03T01:00:40.000Z", to: "市民病院" } }]);
    // 発災より前に閉じた行は渡さない
    expect(triageArrivals([row({ release_kind: "discharged", released_at: "2026-11-02T00:00:00.000Z" })], S)).toEqual([]);
  });

  it("平時の受入一覧（受け入れを発災とみなす）には受入日を足さない", async () => {
    await receiveP04(RECEIVED);
    const staff = (await loadStaffBoard(db, actor(), TODAY, NOW)).rows.find((r) => r.personId === "p-04")!;
    expect(staff.reason.startsWith(`到着 ${SHELTER}`)).toBe(true);
    expect(staff.reason).not.toContain("受入 ");
  });
});
