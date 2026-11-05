// T146: 計画の状態は 3 つの段階（未作成・下書き・作成済）で出し、訓練に出たことは別に「訓練 11/5」（最後に出た終わった訓練の日）。
// DB の値（plan_status の 4 つ）は変えない。担当一覧・本人のページの頭・事業所の画面・CSV が同じ言い方を使う。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../seed/sql.ts";
import { PlanDrill, PlanState } from "../components/list/PlanState.tsx";
import type { Principal } from "./auth/principal.ts";
import { loadCaseload, sortCaseload, type CaseloadRow } from "./caseload.ts";
import { d1FromSqlite, migratedSqlite } from "./db/test-d1.ts";
import { PLAN_STATUSES, type PlanStatus } from "./db/types.ts";
import { lastDrillDays } from "./drill/last.ts";
import { PLAN_STATUS_LABELS } from "./labels.ts";
import { planCounts } from "./map/side.ts";
import { listOfficePeople } from "./office/people.ts";
import { loadPersonPage, toPersonView } from "./person.ts";
import { comparePlan, drillLine, drillMark, PLAN_STAGE_LABELS, planStage, PLAN_TONES } from "./plan-status.ts";

describe("計画の段階の言葉", () => {
  it("DB の 4 つを 3 つの段階に（同意済・訓練済は作成済）。訓練済・同意済の字は画面に出さない", () => {
    expect(PLAN_STATUSES.map(planStage)).toEqual(["none", "draft", "made", "made"]);
    expect(PLAN_STAGE_LABELS).toEqual({ none: "未作成", draft: "下書き", made: "作成済" });
    expect(PLAN_STATUSES.map((s) => PLAN_STATUS_LABELS[s])).toEqual(["未作成", "下書き", "作成済", "作成済"]);
    for (const s of PLAN_STATUSES) expect(PLAN_STATUS_LABELS[s]).not.toMatch(/訓練|同意/);
  });

  it("色は今の意味色のまま（作成済は緑）", () => {
    expect(PLAN_TONES).toEqual({ none: "unknown", draft: "check", consented: "ok", trained: "ok" });
  });

  it("訓練の欄: 最後に出た日（同じ年は月/日、違う年は年から）、記録の無い訓練済は済、どちらも無ければ未実施", () => {
    expect(drillMark("2026-11-05", "draft", "2026-11-06")).toEqual({ text: "11/5", done: true });
    expect(drillMark("2025-11-05", "consented", "2026-11-06")).toEqual({ text: "2025/11/5", done: true });
    expect(drillMark(null, "trained", "2026-11-06")).toEqual({ text: "済", done: true });
    expect(drillMark(null, "consented", "2026-11-06")).toEqual({ text: "未実施", done: false });
    expect(drillLine("2026-11-05", "none", "2026-11-06")).toBe("訓練 11/5");
  });
});

describe("並び", () => {
  const row = (id: string, plan: PlanStatus, drill: string | null, pending = 0) => ({ id, plan, drill, pending, kana: id }) as unknown as CaseloadRow;

  it("見えている段階の順（未作成 → 下書き → 作成済）。同意済と訓練済は同じ段階で、中は訓練（未実施 → 済 → 古い日）", () => {
    const rows = [
      row("a", "trained", "2026-11-05"),
      row("b", "consented", null),
      row("c", "none", null),
      row("d", "trained", null),
      row("e", "draft", null),
      row("f", "consented", "2026-11-02"),
    ];
    expect(sortCaseload(rows, "plan").map((r) => r.id)).toEqual(["c", "e", "b", "d", "f", "a"]);
    expect(sortCaseload(rows, "plan", "desc").map((r) => r.id)).toEqual(["a", "f", "d", "b", "e", "c"]);
    expect(comparePlan({ plan: "consented" }, { plan: "trained", drill: null })).toBeLessThan(0);
  });

  it("右の面の内訳は 3 つの段階と、別に訓練に出た人の数", () => {
    const rows = [row("a", "trained", null), row("b", "consented", "2026-11-05"), row("c", "consented", null), row("d", "draft", null)];
    expect(planCounts(rows).map((c) => [c.status, c.label, c.count])).toEqual([
      ["none", "未作成", 0],
      ["draft", "下書き", 1],
      ["made", "作成済", 3],
      ["drill", "訓練", 2],
    ]);
  });
});

describe("部品", () => {
  it("表の欄: 段階は色の文字、下に訓練（色を付けない）", () => {
    const html = renderToStaticMarkup(createElement(PlanState, { plan: "trained", drill: "2026-11-05" }));
    expect(html).toContain('data-plan="made"');
    expect(html).toContain('data-tone="ok"');
    expect(html).toContain("作成済");
    expect(html).toMatch(/data-drill="done"[\s\S]*訓練[\s\S]*11\/5/);
    expect(html).not.toContain("訓練済");
    const none = renderToStaticMarkup(createElement(PlanDrill, { plan: "draft", drill: null }));
    expect(none).toContain('data-drill="none"');
    expect(none).toContain("未実施");
    expect(none).not.toContain("data-tone");
  });
});

// ---------- D1 から ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const TODAY = "2026-11-06";
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };
const yamamoto: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: null,
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};

function drill(id: string, status: "running" | "finished" | "abandoned", startedAt: string, participants: string[], office = "office-demo") {
  const world = JSON.stringify({ participants }).replace(/'/g, "''");
  sqlite.exec(
    `INSERT INTO drills (id, office_id, scenario, status, world, started_at, finished_at)
     VALUES ('${id}', '${office}', 'heavy_rain', '${status}', '${world}', '${startedAt}', ${status === "running" ? "NULL" : `'${startedAt}'`})`,
  );
}

describe("最後に出た訓練の日（drills の参加者）", () => {
  beforeEach(() => {
    // p-01: 11/2 と 11/5（JST の 11/6 の朝 1 時に始めた回）に出た。p-02: 中断だけ。p-03: 進行中だけ。p-04: ほかの事業所の回だけ
    drill("d-1", "finished", "2026-11-02T01:00:00.000Z", ["p-01", "p-05"]);
    drill("d-2", "finished", "2026-11-05T16:00:00.000Z", ["p-01"]);
    drill("d-3", "abandoned", "2026-11-05T01:00:00.000Z", ["p-02"]);
    drill("d-4", "running", "2026-11-06T00:00:00.000Z", ["p-03"]);
    drill("d-5", "finished", "2026-11-05T01:00:00.000Z", ["p-04"], "office-partner");
  });

  it("終わった訓練だけを数え、日は始めた時刻の JST の日。事業所をまたがない", async () => {
    const days = await lastDrillDays(db, "office-demo");
    expect(Object.fromEntries(days)).toEqual({ "p-01": "2026-11-06", "p-05": "2026-11-02" });
  });

  it("担当一覧の行・事業所の画面・本人のページの頭が同じ日と言い方", async () => {
    const rows = (await loadCaseload(db, SCOPE, TODAY, "2026-11-06T03:00:00.000Z"))!.rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("p-01")!.drill).toBe("2026-11-06");
    expect(byId.get("p-02")!.drill).toBeNull();
    expect(byId.get("p-03")!.drill).toBeNull();

    const office = await listOfficePeople(db, "office-demo", TODAY);
    expect(office.find((p) => p.id === "p-01")!.drill).toBe("2026-11-06");
    expect(office.find((p) => p.id === "p-04")!.drill).toBeNull();

    const page = (await loadPersonPage(db, yamamoto, "p-01"))!;
    expect(page.lastDrill).toBe("2026-11-06");
    const head = toPersonView(page, { today: TODAY }).head;
    expect(head.drill).toBe("11/6");
    expect(head.plan).toBe(PLAN_STATUS_LABELS[page.person.plan_status]);
    expect(["未作成", "下書き", "作成済"]).toContain(head.plan);

    const none = (await loadPersonPage(db, yamamoto, "p-03"))!;
    expect(none.lastDrill).toBeNull();
    expect(toPersonView(none, { today: TODAY }).head.drill).toBe(none.person.plan_status === "trained" ? "済" : "未実施");
  });
});
