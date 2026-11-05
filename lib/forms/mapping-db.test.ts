// 様式の対応表の D1（T08）: 役の壁と事業所の壁、同じ様式は読み直さない、確かめた物だけ差し込みに使う、版の競合。
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { checkReadResult } from "./mapping.ts";
import {
  findMappingByHash,
  formsScope,
  getMapping,
  insertManualMapping,
  insertReadMapping,
  listMappings,
  loadCheckedMapping,
  officePeople,
  readStoredMapping,
  saveCheckedMapping,
} from "./mapping-db.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const principal = (p: Partial<Principal>): Principal => ({
  role: "care_manager",
  judge: false,
  admin: false,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});

const HASH = "a".repeat(64);
const AT = "2026-11-02T10:00:00.000Z";
const mapping = () => checkReadResult(CAO_FORM_READ).mapping;
const read = (over: Partial<Parameters<typeof insertReadMapping>[1]> = {}) =>
  insertReadMapping(db, { id: "fm-1", officeId: "office-demo", hash: HASH, kind: "pdf", mapping: mapping(), model: "claude-opus-5-5", by: "acct-yamamoto", at: AT, ...over });

describe("役の壁", () => {
  it("ケアマネの役（管理者・審査員のケアマネの役を含む）だけ。行政・医療班・本人・家族・役未選択は開けない", () => {
    expect(formsScope(principal({ admin: true }))).toEqual({ officeId: "office-demo", accountId: "acct-yamamoto" });
    expect(formsScope(principal({ judge: true, accountId: "acct-judge" }))).toEqual({ officeId: "office-demo", accountId: "acct-judge" });
    expect(formsScope(principal({ role: "medical", office: null, caseloadOf: null }))).toBeNull();
    expect(formsScope(principal({ role: "government", office: null, caseloadOf: null }))).toBeNull();
    expect(formsScope(principal({ role: "self", personId: "p-01" }))).toBeNull();
    expect(formsScope(principal({ role: "family", personId: "p-01", contactId: "c-01-1" }))).toBeNull();
    expect(formsScope(principal({ role: "unselected" }))).toBeNull();
    expect(formsScope(principal({ office: null }))).toBeNull();
    expect(formsScope(null)).toBeNull();
  });
});

describe("保存と再利用", () => {
  it("読んだ対応表は下書きで入り、同じ写真・PDF は同じ対応表を返す（読み直さない）", async () => {
    expect(await read()).toEqual({ id: "fm-1", reused: false });
    expect(await findMappingByHash(db, "office-demo", HASH)).toEqual({ id: "fm-1", status: "draft", page_images: null });
    // 同じ物をもう一度（同時に読んだときも）: 足さずに前の id
    expect(await read({ id: "fm-2" })).toEqual({ id: "fm-1", reused: true });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM form_mappings").get()).toEqual({ n: 1 });
    // ほかの事業所は別に持つ
    expect(await read({ id: "fm-3", officeId: "office-partner" })).toEqual({ id: "fm-3", reused: false });

    const m = await getMapping(db, "office-demo", "fm-1");
    expect(m).toMatchObject({ status: "draft", source_kind: "pdf", ai_model: "claude-opus-5-5", created_by_name: "山本", version: 1 });
    expect(m!.mapping.fields).toHaveLength(41);
  });

  it("下書きは差し込みに使わない。確かめて保存すると確認済になり、版が 1 つ上がる", async () => {
    await read();
    expect(await loadCheckedMapping(db, "office-demo", "fm-1")).toBeNull();
    const m = mapping();
    m.fields.find((f) => f.label === "メールアドレス")!.item = null;
    expect(await saveCheckedMapping(db, { officeId: "office-demo", id: "fm-1", version: 1, mapping: m, by: "acct-yamamoto", at: AT })).toEqual({ ok: true, version: 2 });
    const checked = await loadCheckedMapping(db, "office-demo", "fm-1");
    expect(checked).toMatchObject({ status: "checked", checked_by_name: "山本", checked_at: AT, version: 2 });
    expect(checked!.mapping.fields.find((f) => f.label === "メールアドレス")).toMatchObject({ item: null, ai: { item: "basic.contactMeans" } });

    const list = await listMappings(db, "office-demo");
    expect(list).toEqual([
      expect.objectContaining({ id: "fm-1", status: "checked", issuer: "内閣府（様式例）", stats: expect.objectContaining({ read: 41, autoMapped: 38, changed: 1 }) }),
    ]);
  });

  it("版が違えば競合、ほかの事業所の対応表は無いのと同じ（事業所の壁）", async () => {
    await read();
    const save = (officeId: string, version: number) =>
      saveCheckedMapping(db, { officeId, id: "fm-1", version, mapping: mapping(), by: "acct-yamamoto", at: AT });
    expect(await save("office-demo", 1)).toEqual({ ok: true, version: 2 });
    expect(await save("office-demo", 1)).toEqual({ ok: false, error: "conflict" });
    expect(await save("office-partner", 2)).toEqual({ ok: false, error: "not_found" });
    expect(await getMapping(db, "office-partner", "fm-1")).toBeNull();
    expect(await loadCheckedMapping(db, "office-partner", "fm-1")).toBeNull();
    expect(await listMappings(db, "office-partner")).toEqual([]);
  });

  it("手で作る対応表（AI 未設定の道）は欄なしの下書きで入る", async () => {
    await insertManualMapping(db, { id: "fm-m", officeId: "office-demo", title: "〇〇市 様式", by: "acct-yamamoto", at: AT });
    expect(await getMapping(db, "office-demo", "fm-m")).toMatchObject({ source_kind: "manual", form_hash: null, status: "draft", mapping: { title: "〇〇市 様式", fields: [] } });
  });

  it("差し込みの宛先は事業所の本人（カナの順）", async () => {
    const people = await officePeople(db, "office-demo");
    expect(people).toHaveLength(10);
    expect(people.map((p) => p.kana)).toEqual([...people.map((p) => p.kana)].sort());
    expect(await officePeople(db, "office-partner")).toEqual([]);
  });

  it("種を入れ直すと事業所と一緒に消える", async () => {
    await read();
    for (const s of seedStatements()) sqlite.exec(s);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM form_mappings").get()).toEqual({ n: 0 });
  });

  it("保存した JSON の項目名が一覧から消えていたら対応なしで読む。壊れた JSON は null", () => {
    const m = mapping();
    const json = JSON.parse(JSON.stringify(m));
    json.fields[0].item = "old.item";
    json.fields[0].ai.item = "old.item";
    expect(readStoredMapping(JSON.stringify(json))!.fields[0]).toMatchObject({ item: null, ai: { item: null } });
    expect(readStoredMapping("{")).toBeNull();
  });
});
