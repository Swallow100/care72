// 事業所の「使用様式」（T47 の 4）: 保存と読み出し、候補に無い値を断る、本人のページの書類の行への差し込み。
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_AT, SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { toPersonView, type DocumentView } from "../person.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { checkReadResult } from "./mapping.ts";
import { insertReadMapping, saveCheckedMapping } from "./mapping-db.ts";
import {
  CAO_MAPPING_ID,
  caoMapping,
  listPlanForms,
  loadPlanForm,
  parsePlanForm,
  planFormHref,
  planFormPost,
  planFormView,
  savePlanForm,
} from "./plan-form.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const OFFICE = "office-demo";
const principal = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: false,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: OFFICE, name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
const form = (v: string | null) => ({ get: (n: string) => (n === "plan_form" ? v : null) });

/** 内閣府の読み取りの形から対応表を 1 つ作る。checked なら確かめた物にする */
async function mapping(checked: boolean): Promise<string> {
  const { id } = await insertReadMapping(db, {
    id: checked ? "map-checked" : "map-draft",
    officeId: OFFICE,
    hash: (checked ? "b" : "a").repeat(64),
    kind: "pdf",
    mapping: checkReadResult(CAO_FORM_READ).mapping,
    model: "test",
    by: "acct-yamamoto",
    at: "2026-11-03T00:00:00.000Z",
  });
  if (checked) {
    const r = await saveCheckedMapping(db, {
      officeId: OFFICE,
      id,
      version: 1,
      mapping: checkReadResult(CAO_FORM_READ).mapping,
      by: "acct-yamamoto",
      at: "2026-11-03T01:00:00.000Z",
    });
    expect(r.ok).toBe(true);
  }
  return id;
}

describe("様式の id", () => {
  it("松山市・内閣府・mapping:<id> だけを受け取る", () => {
    expect(parsePlanForm("matsuyama")).toBe("matsuyama");
    expect(parsePlanForm("cao")).toBe("cao");
    expect(parsePlanForm("mapping:map-1")).toBe("mapping:map-1");
    for (const bad of ["", "mapping:", "mapping:a b", "other", null, 3]) expect(parsePlanForm(bad)).toBeNull();
  });

  it("紙面の URL: 松山市は計画書、内閣府は組み込みの対応表、対応表は差し込み", () => {
    expect(planFormHref("matsuyama", "p-01")).toBe("/people/p-01/forms/matsuyama");
    expect(planFormHref("cao", "p-01")).toBe(`/people/p-01/forms/mapped/${CAO_MAPPING_ID}`);
    expect(planFormHref("mapping:m-1", "p-01")).toBe("/people/p-01/forms/mapped/m-1");
    expect(caoMapping().fields.length).toBe(CAO_FORM_READ.fields.length);
  });
});

describe("保存と読み出し", () => {
  it("既定は松山市。内閣府を選ぶと読み出しも内閣府", async () => {
    expect((await loadPlanForm(db, OFFICE)).id).toBe("matsuyama");
    expect(await savePlanForm(db, principal(), "cao")).toEqual({ ok: true });
    const c = await loadPlanForm(db, OFFICE);
    expect(c.id).toBe("cao");
    expect(c.about).toContain("個別避難計画（様式例）");
  });

  it("確かめた対応表は候補に出て選べる。下書きは候補に出ず、断る", async () => {
    const draft = await mapping(false);
    expect((await listPlanForms(db, OFFICE)).map((o) => o.id)).toEqual(["matsuyama", "cao"]);
    expect(await savePlanForm(db, principal(), `mapping:${draft}`)).toEqual({ ok: false, error: "bad" });
    sqlite.exec("DELETE FROM form_mappings");
    const checked = await mapping(true);
    expect((await listPlanForms(db, OFFICE)).map((o) => o.id)).toEqual(["matsuyama", "cao", `mapping:${checked}`]);
    expect(await savePlanForm(db, principal(), `mapping:${checked}`)).toEqual({ ok: true });
    const c = await loadPlanForm(db, OFFICE);
    expect(c.id).toBe(`mapping:${checked}`);
    expect(c.href("p-01")).toBe(`/people/p-01/forms/mapped/${checked}`);
  });

  it("選んだ対応表が無くなったら松山市に戻す", async () => {
    sqlite.exec("UPDATE offices SET plan_form = 'mapping:gone' WHERE id = 'office-demo'");
    expect((await loadPlanForm(db, OFFICE)).id).toBe("matsuyama");
  });

  it("表の CHECK: 知らない値は入らない", () => {
    expect(() => sqlite.exec("UPDATE offices SET plan_form = 'tokyo' WHERE id = 'office-demo'")).toThrow();
  });

  it("ケアマネの役だけ。行政・医療班は 403、ログインなしは 401、知らない値は画面へ戻して form_error", async () => {
    expect(await planFormPost(db, null, form("cao"))).toEqual({ status: 401 });
    expect(await planFormPost(db, principal({ role: "medical", office: null }), form("cao"))).toEqual({ status: 403 });
    expect(await planFormPost(db, principal(), form("tokyo"))).toEqual({ status: 303, location: "/office?form_error=bad#plan-form" });
    expect(await planFormPost(db, principal(), form("cao"))).toEqual({ status: 303, location: "/office#plan-form" });
    expect((await loadPlanForm(db, OFFICE)).id).toBe("cao");
  });
});

describe("本人のページの書類の行", () => {
  const p = SEED_PEOPLE[0];
  const rows = {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
  const docs = (planForm?: ReturnType<typeof planFormView>): DocumentView[] => {
    const v = toPersonView(rows, { today: "2026-11-03", planForm });
    const s = v.sections.find((x) => x.id === "documents")!;
    return s.blocks.flatMap((b) => (b.type === "documents" ? b.documents : []));
  };

  it("書類ごとに何の書類かの 1 行（正式な名前・誰が誰に・版）が付く", () => {
    const d = docs();
    expect(d.map((x) => x.key)).toEqual(["matsuyama", "medical", "own", "qr"]);
    for (const x of d) expect(x.about, x.key).toBeTruthy();
    expect(d[0].about).toContain("松山市避難行動要支援者名簿登録申込書 兼 個別避難計画");
    expect(d[0].about).toContain("本人・家族が市へ出す");
    expect(d[0].about).toContain("2026.9.10");
  });

  it("事業所が内閣府の様式を選ぶと、計画書の行はその様式の紙面と説明", async () => {
    await savePlanForm(db, principal(), "cao");
    const d = docs(planFormView(await loadPlanForm(db, OFFICE)));
    expect(d[0]).toMatchObject({ key: "matsuyama", label: "計画書（内閣府）", href: `/people/${p.person.id}/forms/mapped/${CAO_MAPPING_ID}` });
    expect(d[0].about).toContain("個別避難計画（様式例）");
  });
});
