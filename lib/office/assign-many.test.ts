// 担当の一括変更（docs/tasks/T60.md）。事業所の担当の表で複数を選び、1 回で移す。
// 人ごとに assignPerson と同じ検査（事業所の中・移動先のケアマネ・今の担当が送ったときと違えば飛ばす）、書くのは 1 つの batch、
// 経過は person_assigned を人数ぶん（事業所の経過と本人の経過）。戻り先に「変更 N 人・飛ばし M 人」。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人（全員 山本の担当）と、協力事業所の本人 1 人（テストだけ）。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AssignMany, PickAll, PickBox } from "../../components/office/AssignMany.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadOfficeLog } from "../disaster/db.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { assignManyHref, parseAssignedMany, peoplePost } from "./http.ts";
import { OFFICE_LABELS, assignManyDetails, assignManyText } from "./labels.ts";
import { assignMany, listCareManagers, MAX_ASSIGN_MANY } from "./people.ts";
import { officeActor } from "./scope.ts";
import { addCareManager } from "./staff.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const PARTNER_PERSON = "p-partner-1";
const AT = "2026-11-03T01:00:00.000Z";
const FAST = { iterations: 1000 };

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite
    .prepare(
      `INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date)
       VALUES (?, 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01')`,
    )
    .run(PARTNER_PERSON);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };
const yamamoto = (p: Partial<Principal> = {}): Principal => ({
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
const judgeCm = () => yamamoto({ judge: true, admin: false, accountId: "acct-judge", displayName: "山本" });
const partnerCm = () => yamamoto({ accountId: "acct-partner-cm", displayName: null, office: PARTNER, caseloadOf: "acct-partner-cm" });
const medical = () => yamamoto({ role: "medical", admin: false, accountId: null, office: null, caseloadOf: null });

const count = (sql: string, ...args: (string | number | null)[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;
const cmOf = (id: string) => (sqlite.prepare("SELECT care_manager_id AS c FROM people WHERE id = ?").get(id) as { c: string | null }).c;

async function addSato(): Promise<string> {
  const r = await addCareManager(db, officeActor(yamamoto())!, { displayName: "佐藤", loginId: "sato" }, AT, FAST);
  if (!r.ok) throw new Error("足せない");
  return r.account.id;
}

const fromYamamoto = (...ids: string[]) => ids.map((personId) => ({ personId, from: "acct-yamamoto" }));

function form(fields: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
}

describe("一括変更（people.ts の assignMany）", () => {
  it("選んだ 3 人を 1 回で移す。担当一覧の人数・本人の経過・事業所の経過（人数ぶんの担当変更）", async () => {
    const sato = await addSato();
    const logs = count("SELECT count(*) AS n FROM office_timeline_entries");
    const r = await assignMany(db, officeActor(yamamoto())!, { items: fromYamamoto("p-01", "p-02", "p-03"), to: sato }, AT);
    expect(r).toEqual({ ok: true, changed: 3, skipped: 0 });
    for (const id of ["p-01", "p-02", "p-03"]) expect(cmOf(id)).toBe(sato);
    expect(cmOf("p-04")).toBe("acct-yamamoto");
    expect((await listCareManagers(db, "office-demo")).map((c) => [c.name, c.people])).toEqual([
      ["山本", 7],
      ["西村", 0],
      ["佐藤", 3],
    ]);

    expect(count("SELECT count(*) AS n FROM office_timeline_entries") - logs).toBe(3);
    expect(count("SELECT count(*) AS n FROM office_timeline_entries WHERE kind = 'person_assigned'")).toBe(3);
    // 同じ時刻のケアマネ追加の行と並びが入れ替わることがあるので、種類で絞る
    const log = (await loadOfficeLog(db, "office-demo")).filter((e) => e.kind === "person_assigned");
    expect(log.map((e) => [e.label, e.body])).toEqual(Array(3).fill(["担当変更", "担当 山本 → 佐藤"]));
    expect(new Set(log.map((e) => e.person)).size).toBe(3);

    for (const id of ["p-01", "p-02", "p-03"]) {
      const items = timelineItems((await loadPersonPage(db, yamamoto(), id))!);
      expect(items.at(-1), id).toMatchObject({ kind: "担当変更", body: "担当 山本 → 佐藤", who: "ケアマネ 山本" });
    }
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = 'p-04'")).toBe(0);
  });

  it("飛ばす: 今の担当が送ったときと違う人・事業所の外の人・無い人・もう移動先の人。ほかは移す", async () => {
    const sato = await addSato();
    const a = officeActor(yamamoto())!;
    // p-02 は先に佐藤へ（画面を読んだあとにほかの人が変えた）
    expect(await assignMany(db, a, { items: fromYamamoto("p-02"), to: sato }, AT)).toEqual({ ok: true, changed: 1, skipped: 0 });
    const logs = count("SELECT count(*) AS n FROM office_timeline_entries");
    const r = await assignMany(
      db,
      a,
      {
        items: [
          ...fromYamamoto("p-01", "p-02", "p-05"),
          { personId: PARTNER_PERSON, from: "acct-partner-cm" },
          { personId: "p-none", from: "acct-yamamoto" },
          { personId: "p-03", from: sato },
        ],
        to: sato,
      },
      AT,
    );
    expect(r).toEqual({ ok: true, changed: 2, skipped: 4 });
    expect(cmOf("p-01")).toBe(sato);
    expect(cmOf("p-05")).toBe(sato);
    expect(cmOf("p-03")).toBe("acct-yamamoto");
    expect(cmOf(PARTNER_PERSON)).toBe("acct-partner-cm");
    expect(count("SELECT count(*) AS n FROM office_timeline_entries") - logs).toBe(2);
  });

  it("未割当の人も移せる（from が空）。経過は「担当 未割当 → 佐藤」", async () => {
    const sato = await addSato();
    sqlite.prepare("UPDATE people SET care_manager_id = NULL WHERE id = 'p-06'").run();
    const r = await assignMany(db, officeActor(yamamoto())!, { items: [{ personId: "p-06", from: null }, ...fromYamamoto("p-07")], to: sato }, AT);
    expect(r).toEqual({ ok: true, changed: 2, skipped: 0 });
    expect(cmOf("p-06")).toBe(sato);
    const bodies = (sqlite.prepare("SELECT body FROM office_timeline_entries WHERE kind = 'person_assigned' ORDER BY body").all() as { body: string }[]).map(
      (r) => r.body,
    );
    expect(bodies).toEqual(["担当 山本 → 佐藤", "担当 未割当 → 佐藤"]);
  });

  it("移動先が事業所の外のケアマネ・ケアマネでない・無いなら何も書かない", async () => {
    const a = officeActor(yamamoto())!;
    const logs = count("SELECT count(*) AS n FROM office_timeline_entries");
    for (const to of ["acct-partner-cm", "acct-judge", "acct-none"]) {
      expect(await assignMany(db, a, { items: fromYamamoto("p-01", "p-02"), to }, AT), to).toEqual({ ok: false, error: "care_manager" });
    }
    expect(cmOf("p-01")).toBe("acct-yamamoto");
    expect(count("SELECT count(*) AS n FROM office_timeline_entries")).toBe(logs);
    expect(count("SELECT count(*) AS n FROM timeline_entries")).toBe(0);
  });

  it("事業所の壁: 協力事業所のケアマネはデモ事業所の人を移せない（全部飛ばし）", async () => {
    const r = await assignMany(db, officeActor(partnerCm())!, { items: fromYamamoto("p-01", "p-02"), to: "acct-partner-cm" }, AT);
    expect(r).toEqual({ ok: true, changed: 0, skipped: 2 });
    expect(cmOf("p-01")).toBe("acct-yamamoto");
  });

  it("同じ人を 2 回送っても 1 回だけ。審査員のケアマネの役は書き手が審査員のアカウント", async () => {
    const sato = await addSato();
    const r = await assignMany(db, officeActor(judgeCm())!, { items: fromYamamoto("p-08", "p-08"), to: sato }, AT);
    expect(r).toEqual({ ok: true, changed: 1, skipped: 0 });
    const t = sqlite.prepare("SELECT author_id FROM office_timeline_entries WHERE kind = 'person_assigned'").all() as { author_id: string }[];
    expect(t).toEqual([{ author_id: "acct-judge" }]);
  });

  it("10 人全部を 1 回で（文の数は人数で増えない 1 つの batch）", async () => {
    const sato = await addSato();
    const ids = Array.from({ length: 10 }, (_, i) => `p-${String(i + 1).padStart(2, "0")}`);
    const r = await assignMany(db, officeActor(yamamoto())!, { items: fromYamamoto(...ids), to: sato }, AT);
    expect(r).toEqual({ ok: true, changed: 10, skipped: 0 });
    expect(count("SELECT count(*) AS n FROM people WHERE office_id = 'office-demo' AND care_manager_id = ?", sato)).toBe(10);
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE kind = 'note'")).toBe(10);
  });
});

describe("フォームの POST（action=assign_many）", () => {
  const many = (to: string, ids: string[], from = "acct-yamamoto"): Array<[string, string]> => [
    ["action", "assign_many"],
    ["back", "office"],
    ["to", to],
    ...ids.flatMap((id): Array<[string, string]> => [
      ["person", id],
      [`from.${id}`, from],
    ]),
  ];

  it("移すと事業所の担当の表へ 303、戻り先に変更と飛ばしの人数", async () => {
    const sato = await addSato();
    const r = await peoplePost(db, yamamoto(), form(many(sato, ["p-01", "p-02", PARTNER_PERSON])), AT);
    expect(r).toEqual({ status: 303, location: assignManyHref(2, 1) });
    expect(assignManyHref(2, 1)).toBe("/office?moved=2&skipped=1#assign");
    expect(parseAssignedMany({ moved: "2", skipped: "1" })).toEqual({ moved: 2, skipped: 1 });
    expect(parseAssignedMany({ moved: "x" })).toBeNull();
    expect(parseAssignedMany({})).toBeNull();
    expect(cmOf("p-01")).toBe(sato);
  });

  it("誤り: 選んでいない・形の違う id・多すぎは bad、移動先の誤りは care_manager。何も書かない", async () => {
    const sato = await addSato();
    const bad = "/office?people_error=bad#assign";
    expect(await peoplePost(db, yamamoto(), form(many(sato, [])), AT)).toEqual({ status: 303, location: bad });
    expect(await peoplePost(db, yamamoto(), form(many(sato, ["p 01"])), AT)).toEqual({ status: 303, location: bad });
    const tooMany = Array.from({ length: MAX_ASSIGN_MANY + 1 }, (_, i) => `p-x${i}`);
    expect(await peoplePost(db, yamamoto(), form(many(sato, tooMany)), AT)).toEqual({ status: 303, location: bad });
    expect(await peoplePost(db, yamamoto(), form(many("", ["p-01"])), AT)).toEqual({
      status: 303,
      location: "/office?people_error=care_manager#assign",
    });
    expect(await peoplePost(db, yamamoto(), form(many("acct-partner-cm", ["p-01"])), AT)).toEqual({
      status: 303,
      location: "/office?people_error=care_manager#assign",
    });
    // from の形が違えば bad
    expect(await peoplePost(db, yamamoto(), form([...many(sato, ["p-01"]).filter(([k]) => k !== "from.p-01"), ["from.p-01", "a b"]]), AT)).toEqual({
      status: 303,
      location: bad,
    });
    expect(cmOf("p-01")).toBe("acct-yamamoto");
  });

  it("権限: 医療班は 403、ログインなしは 401", async () => {
    const sato = await addSato();
    expect(await peoplePost(db, medical(), form(many(sato, ["p-01"])), AT)).toEqual({ status: 403 });
    expect(await peoplePost(db, null, form(many(sato, ["p-01"])), AT)).toEqual({ status: 401 });
    expect(cmOf("p-01")).toBe("acct-yamamoto");
  });
});

describe("言葉と確認の窓", () => {
  it("戻り先の 1 行と確認の窓の名前（6 行まで、超えたら「ほか N 件」）", () => {
    expect(assignManyText({ moved: 3, skipped: 0 })).toBe("変更済 3 人");
    expect(assignManyText({ moved: 2, skipped: 1 })).toBe("変更済 2 人・飛ばし 1 人");
    const names = ["一", "二", "三", "四", "五", "六", "七", "八"].map((n) => `架空 ${n}`);
    expect(assignManyDetails(names.slice(0, 6))).toEqual(names.slice(0, 6));
    expect(assignManyDetails(names)).toEqual([...names.slice(0, 5), "ほか 3 件"]);
    for (const l of [OFFICE_LABELS.selectAll, OFFICE_LABELS.assignMany, OFFICE_LABELS.moveTo]) expect(l.length).toBeLessThanOrEqual(4);
  });
});

describe("担当の表の部品（AssignMany）", () => {
  const rows = [
    { id: "p-01", name: "山田 ハナ", careManagerId: "acct-yamamoto" },
    { id: "p-02", name: "鈴木 イチ", careManagerId: "acct-yamamoto" },
    { id: "p-03", name: "佐々木 ジロウ", careManagerId: null },
  ];
  const cms = [
    { id: "acct-yamamoto", name: "山本" },
    { id: "acct-sato", name: "佐藤" },
  ];
  const html = renderToStaticMarkup(
    createElement(
      AssignMany,
      { rows, careManagers: cms, children: null },
      createElement(
        "table",
        null,
        createElement("thead", null, createElement("tr", null, createElement("th", null, createElement(PickAll)))),
        createElement(
          "tbody",
          null,
          rows.map((r) => createElement("tr", { key: r.id }, createElement("td", null, createElement(PickBox, { id: r.id, label: r.name })))),
        ),
      ),
    ),
  );

  it("各行のチェック・見出しの全選択・担当ごとの選択・移動先・一括変更。押せる物は焦点の枠を持つ", () => {
    expect(html.match(/type="checkbox"/g)).toHaveLength(4);
    expect(html).toContain(`aria-label="${OFFICE_LABELS.selectAll}"`);
    expect(html).toContain('aria-label="山田 ハナ 選択"');
    // 担当ごと: 担当の名前と人数（未割当も）
    expect(html).toMatch(/data-pick-cm="acct-yamamoto"[^>]*>[\s\S]*?山本[\s\S]*?2</);
    expect(html).toMatch(/data-pick-cm=""[^>]*>[\s\S]*?未割当[\s\S]*?1</);
    expect(html).not.toContain('data-pick-cm="acct-sato"');
    expect(html).toContain(OFFICE_LABELS.moveTo);
    expect(html).toContain(OFFICE_LABELS.assignMany);
    expect(html).toContain("選択 <span");
    expect(html).toMatch(/name="action" value="assign_many"/);
    for (const m of html.matchAll(/<input type="checkbox"[^>]*>/g)) expect(m[0]).toContain("focus-visible:outline-solid");
  });
});
