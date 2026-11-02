// 本人のページの出し分け（docs/tasks/T24.md）。医療班・行政が受け入れた人のページを、同意の範囲で組む。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。受け入れは lib/custody/store.ts の receive（審査員の医療班の役）。
// 見えない区分は作らない（「非表示」とも書かない）ので、区分の id・欄の key・画面に出る文字の全部で確かめる。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { staffActor } from "../custody/actor.ts";
import { receive } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadPersonPage, toPersonView, type PersonView } from "../person.ts";
import { scopeOfRows } from "./scope.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-03";
const AT = "2026-11-03T01:00:00.000Z";
const SHELTER = "みどり小学校";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const base: Principal = {
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
const medical = (): Principal => base;
const government = (): Principal => ({ ...base, role: "government" });
const judgeCm = (): Principal => ({ ...base, role: "care_manager", caseloadOf: "acct-yamamoto", displayName: "山本" });

async function received(personId: string, p: Principal = medical()) {
  const r = await receive(db, staffActor(p)!, { personId, shelter: SHELTER, via: "search" }, AT);
  expect(r.ok).toBe(true);
}

async function viewAs(p: Principal, personId: string): Promise<PersonView> {
  const rows = (await loadPersonPage(db, p, personId))!;
  expect(rows).not.toBeNull();
  return toPersonView(rows, { today: TODAY, scope: scopeOfRows(p.role, rows) });
}

/** 画面に出る文字の全部（区分・欄・経過・上の段） */
const allText = (v: PersonView) => JSON.stringify(v);
const rowKeys = (v: PersonView, id: string) =>
  v.sections.find((s) => s.id === id)?.blocks.flatMap((b) => (b.type === "row" ? [b.row.key] : [])) ?? [];

describe("医療班・行政の本人のページ（同意あり 1 山田）", () => {
  it("医療・避難・人の一部・書類（医療要約だけ）・経過。基本と同意の区分は無い", async () => {
    await received("p-01");
    const v = await viewAs(medical(), "p-01");
    expect(v.sections.map((s) => s.id)).toEqual(["medical", "evacuation", "people", "documents", "timeline"]);
    const docs = v.sections.find((s) => s.id === "documents")!.blocks.flatMap((b) => (b.type === "documents" ? b.documents : []));
    expect(docs.map((d) => [d.key, d.href])).toEqual([["medical", "/people/p-01/forms/medical"]]);
    // 行政も同じ（審査員は行政の役を選べないので、行政の役の Principal で同じアカウントを読む）
    const g = await viewAs(government(), "p-01");
    expect(g.sections.map((s) => s.id)).toEqual(v.sections.map((s) => s.id));
  });

  it("住所が無い（町名も市も）。本人の電話・世帯・心身・特記も無い", async () => {
    await received("p-01");
    const cm = await viewAs(judgeCm(), "p-01");
    const v = await viewAs(medical(), "p-01");
    // ケアマネには住所がある（種の山田は かわなぎ町）
    expect(rowKeys(cm, "basic")).toContain("basic.address");
    const address = cm.sections
      .find((s) => s.id === "basic")!
      .blocks.flatMap((b) => (b.type === "row" && b.row.key === "basic.address" && b.row.field.kind === "lines" ? b.row.field.lines.flat() : []))
      .map((s) => s.text)
      .join(" ");
    expect(address.length).toBeGreaterThan(0);
    expect(allText(v)).not.toContain(address);
    for (const town of address.split(" ").filter((s) => s.endsWith("町"))) expect(allText(v)).not.toContain(town);
    expect(v.sections.some((s) => s.id === "basic")).toBe(false);
    // 本人の電話（090-0000-0001）は基本の区分の物なので出ない
    expect(allText(v)).not.toContain("090-0000-0001");
  });

  it("人の一部: 緊急連絡先（名前・電話）と支援者 1・2 の役割名。家族・民生委員・夜間支援の欄と支援者の名前は無い", async () => {
    await received("p-01");
    const v = await viewAs(medical(), "p-01");
    expect(rowKeys(v, "people")).toEqual(["people.emergency", "people.supporter1", "people.supporter2"]);
    const people = v.sections.find((s) => s.id === "people")!;
    const lineOf = (key: string) =>
      people.blocks
        .flatMap((b) => (b.type === "row" && b.row.key === key && b.row.field.kind === "lines" ? b.row.field.lines : []))
        .map((l) => l.map((s) => s.text).join(" "));
    // 緊急連絡先は名前と電話つき（山田の娘）
    expect(lineOf("people.emergency").join("\n")).toMatch(/090-0000-00\d\d/);
    // 支援者は役割名だけ（電話・名前が無い）
    for (const key of ["people.supporter1", "people.supporter2"]) {
      for (const line of lineOf(key)) expect(line).not.toMatch(/090-0000|山田|[ァ-ヶ]{2,} [ァ-ヶ]{2,}/);
    }
    // 上の段: 医療の印・時計・緊急連絡先は出る、避難計画と未確認の数は出ない
    expect(v.head.show).toEqual({ medical: true, people: true, plan: false });
    expect(v.head.marks.map((m) => m.label)).toContain("酸素");
    expect(v.head.emergency.length).toBeGreaterThan(0);
  });

  it("緊急連絡先でない支援者の名前と電話（ケアマネには出る）が医療班のページのどこにも無い。役割名は出る", async () => {
    // 種の支援者はみな緊急連絡先なので、隣人（支援者 2）を緊急連絡先から外して確かめる
    sqlite.prepare("UPDATE contacts SET emergency_order = NULL WHERE id = 'c-01-2'").run();
    await received("p-01");
    const cm = await viewAs(judgeCm(), "p-01");
    const v = await viewAs(medical(), "p-01");
    const c = sqlite.prepare("SELECT name, phone, relation FROM contacts WHERE id = 'c-01-2'").get() as {
      name: string;
      phone: string;
      relation: string;
    };
    expect(allText(cm)).toContain(c.name);
    expect(allText(cm)).toContain(c.phone);
    expect(allText(v)).not.toContain(c.name);
    expect(allText(v)).not.toContain(c.phone);
    const supporter2 = v.sections
      .find((s) => s.id === "people")!
      .blocks.flatMap((b) => (b.type === "row" && b.row.key === "people.supporter2" && b.row.field.kind === "lines" ? b.row.field.lines : []));
    expect(supporter2.map((l) => l.map((s) => s.text).join(" "))).toEqual([c.relation]);
  });

  it("住所は医療班への提供の同意の範囲（{\"address\": true}）にあるときだけ、基本の区分に住所の行だけ", async () => {
    sqlite.prepare(`UPDATE consents SET scope = '{"address":true}' WHERE person_id = 'p-01' AND kind = 'medical'`).run();
    await received("p-01");
    const v = await viewAs(medical(), "p-01");
    expect(rowKeys(v, "basic")).toEqual(["basic.address"]);
    const pr = sqlite.prepare("SELECT scope FROM third_party_provisions").get() as { scope: string };
    expect(JSON.parse(pr.scope)).toEqual(["identity", "medical", "evacuation", "people_partial", "address"]);
  });

  it("ケアマネのページは今までどおり全部（範囲を渡さなくても同じ）", async () => {
    const rows = (await loadPersonPage(db, judgeCm(), "p-01"))!;
    const a = toPersonView(rows, { today: TODAY });
    const b = toPersonView(rows, { today: TODAY, scope: scopeOfRows("care_manager", rows) });
    expect(a).toEqual(b);
    expect(a.sections.map((s) => s.id)).toEqual(["medical", "evacuation", "people", "basic", "consent", "documents", "timeline"]);
    expect(a.head.show).toEqual({ medical: true, people: true, plan: true });
  });
});

describe("医療班への提供に同意の無い 9 渡辺", () => {
  it("医療班に医療が出ない。区分は経過だけで、上は名前・カナ・年齢", async () => {
    await received("p-09");
    const cm = await viewAs(judgeCm(), "p-09");
    const v = await viewAs(medical(), "p-09");
    expect(v.sections.map((s) => s.id)).toEqual(["timeline"]);
    expect(v.head.show).toEqual({ medical: false, people: false, plan: false });
    expect(v.head).toMatchObject({ name: "渡辺 清", marks: [], clocks: [], emergency: [], careLevel: null });
    expect(v.head.age).toBe(cm.head.age);
    // 渡辺の薬（降圧薬）の名前がどこにも無い
    const meds = cm.sections
      .find((s) => s.id === "medical")!
      .blocks.flatMap((b) => (b.type === "row" && b.row.key === "medical.medications" && b.row.field.kind === "lines" ? b.row.field.lines : []))
      .map((l) => l[0].text);
    expect(meds.length).toBeGreaterThan(0);
    for (const m of meds) expect(allText(v)).not.toContain(m);
    expect(v.unconfirmed).toEqual([]);
  });

  it("経過は医療班・行政の書いた行と提供の行だけ（ケアマネの電話・同意・台帳作成は出ない）", async () => {
    sqlite
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, occurred_at)
         VALUES ('tl-cm-call', 'p-09', 'acct-yamamoto', 'care_manager', 'called', '娘さんに電話 降圧薬あり', ?)`,
      )
      .run("2026-11-03T00:30:00.000Z");
    await received("p-09");
    const items = (v: PersonView) =>
      v.sections.find((s) => s.id === "timeline")!.blocks.flatMap((b) => (b.type === "timeline" ? b.items : []));
    const cm = items(await viewAs(judgeCm(), "p-09"));
    const staff = items(await viewAs(medical(), "p-09"));
    expect(cm.map((t) => t.kind)).toEqual(expect.arrayContaining(["入力", "同意", "電話", "受入", "提供"]));
    expect(staff.map((t) => t.kind)).toEqual(["受入", "提供"]);
    expect(JSON.stringify(staff)).not.toContain("降圧薬");
  });

  it("同意ありの人の経過はケアマネの行も出る", async () => {
    sqlite
      .prepare(
        `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, occurred_at)
         VALUES ('tl-cm-call', 'p-01', 'acct-yamamoto', 'care_manager', 'called', '娘さんに電話', ?)`,
      )
      .run("2026-11-03T00:30:00.000Z");
    await received("p-01");
    const v = await viewAs(medical(), "p-01");
    const kinds = v.sections.find((s) => s.id === "timeline")!.blocks.flatMap((b) => (b.type === "timeline" ? b.items.map((t) => t.kind) : []));
    expect(kinds).toContain("電話");
  });
});

describe("提供の行", () => {
  it("経過に「提供 医療班 医療・避難・人の一部 同意」の 1 行（受入のあと）", async () => {
    await received("p-01");
    const v = await viewAs(judgeCm(), "p-01");
    const items = v.sections.find((s) => s.id === "timeline")!.blocks.flatMap((b) => (b.type === "timeline" ? b.items : []));
    const i = items.findIndex((t) => t.kind === "提供");
    expect(items[i]).toMatchObject({ kind: "提供", body: "医療・避難・人の一部 同意", at: AT, derived: true, staff: true });
    expect(items[i].who).toBe("医療班 審査員");
    expect(items[i - 1].kind).toBe("受入");
    // 書類の面には出さない
    const docs = v.sections.find((s) => s.id === "documents")!.blocks.flatMap((b) => (b.type === "documents" ? b.documents : []));
    expect(docs.map((d) => d.label).join("")).not.toContain("提供");
  });

  it("9 渡辺は「提供 医療班 本人確認 生命保護」", async () => {
    await received("p-09");
    const v = await viewAs(judgeCm(), "p-09");
    const item = v.sections
      .find((s) => s.id === "timeline")!
      .blocks.flatMap((b) => (b.type === "timeline" ? b.items : []))
      .find((t) => t.kind === "提供");
    expect(item).toMatchObject({ body: "本人確認 生命保護", who: "医療班 審査員" });
  });
});
