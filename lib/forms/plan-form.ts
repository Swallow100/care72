// 事業所が計画書に使う様式（docs/tasks/T47.md の 4）。自治体で様式が違うので、事業所ごとに 1 つ選ぶ（offices.plan_form、migration 0005）。
// 候補: 松山市の様式（コードに持つ。既定）・内閣府の様式例（T08 で手で起こした対応表。コードに持つ）・事業所が確かめた対応表（form_mappings の確認済）。
// 本人のページの書類の行の「計画書」は、その事業所の様式の紙面へ行く（lib/person.ts の documentBlocks）。
// 選んだ対応表が下書きに戻った・消えたときは松山市の様式に戻す（壊れた様式で紙面を出さない）。
// ここは D1 と Principal を引数で受け取る（テストで node:sqlite を渡す）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { allows } from "../auth/guard.ts";
import { officeActor } from "../office/scope.ts";
import { CAO_FORM_READ } from "./cao-form.fixture.ts";
import { aboutLine, CAO_ENTRY, MATSUYAMA_ENTRY, mappingEntry, type CatalogEntry, type PlanFormId } from "./catalog.ts";
import { checkReadResult, type FormMapping } from "./mapping.ts";
import { listMappings, loadCheckedMapping } from "./mapping-db.ts";
import type { PlanFormView } from "../person.ts";

/** 内閣府の様式例の対応表を紙面の URL で呼ぶ id（form_mappings の id と重ならない形） */
export const CAO_MAPPING_ID = "builtin-cao";

/** 内閣府の様式例の対応表（T08 の手で起こした読み取りの形から。ケアマネの確認は経ていない） */
export function caoMapping(): FormMapping {
  return checkReadResult(CAO_FORM_READ).mapping;
}

/** 選べる様式の 1 つ */
export type PlanFormOption = { id: PlanFormId; entry: CatalogEntry };

/** 本人のページの書類の行に渡す、選んだ様式の紙面 */
export type PlanFormChoice = { id: PlanFormId; entry: CatalogEntry; about: string; href: (personId: string) => string };

const MAPPING_PREFIX = "mapping:";

/**
 * 新しい事業所の様式の既定（T68）。松山市の事業所は松山市の様式、ほかの市は内閣府の様式例
 * （松山市の様式の頭は「（あて先）松山市長」なので、ほかの市で出すと宛先が違う）。事業所を作る道具（T73）が使う。
 * 今の事業所は全部松山市なので、保存の値が読めないときの戻り先（loadPlanForm）は松山市のまま
 */
export function defaultPlanForm(city: string): "matsuyama" | "cao" {
  return city.trim() === "松山市" ? "matsuyama" : "cao";
}

/** 保存の値を様式の id に。知らない値は null */
export function parsePlanForm(v: unknown): PlanFormId | null {
  if (v === "matsuyama" || v === "cao") return v;
  if (typeof v === "string" && v.startsWith(MAPPING_PREFIX) && /^[A-Za-z0-9_-]{1,64}$/.test(v.slice(MAPPING_PREFIX.length))) {
    return v as PlanFormId;
  }
  return null;
}

const mappingIdOf = (id: PlanFormId) => (id.startsWith(MAPPING_PREFIX) ? id.slice(MAPPING_PREFIX.length) : null);

/** 紙面の URL */
export function planFormHref(id: PlanFormId, personId: string): string {
  const p = encodeURIComponent(personId);
  if (id === "matsuyama") return `/people/${p}/forms/matsuyama`;
  if (id === "cao") return `/people/${p}/forms/mapped/${CAO_MAPPING_ID}`;
  return `/people/${p}/forms/mapped/${encodeURIComponent(mappingIdOf(id)!)}`;
}

function choice(id: PlanFormId, entry: CatalogEntry): PlanFormChoice {
  return { id, entry, about: aboutLine(entry), href: (personId) => planFormHref(id, personId) };
}

export const MATSUYAMA_CHOICE: PlanFormChoice = choice("matsuyama", MATSUYAMA_ENTRY);

/** 本人のページの書類の行に渡す形（lib/person.ts の ViewOptions.planForm） */
export function planFormView(c: PlanFormChoice): PlanFormView {
  return { label: c.entry.short, about: c.about, href: c.href };
}

/** 事業所の候補（松山市・内閣府・確かめた対応表の新しい順） */
export async function listPlanForms(db: D1Database, officeId: string): Promise<PlanFormOption[]> {
  const mappings = (await listMappings(db, officeId)).filter((m) => m.status === "checked");
  return [
    { id: "matsuyama", entry: MATSUYAMA_ENTRY },
    { id: "cao", entry: CAO_ENTRY },
    ...mappings.map((m) => ({ id: `${MAPPING_PREFIX}${m.id}` as PlanFormId, entry: mappingEntry(m) })),
  ];
}

/** 事業所の選んだ様式。保存の値が読めない・対応表が確認済でないときは松山市 */
export async function loadPlanForm(db: D1Database, officeId: string): Promise<PlanFormChoice> {
  const row = await db.prepare("SELECT plan_form FROM offices WHERE id = ?1").bind(officeId).first<{ plan_form: string }>();
  const id = parsePlanForm(row?.plan_form);
  if (!id || id === "matsuyama") return MATSUYAMA_CHOICE;
  if (id === "cao") return choice("cao", CAO_ENTRY);
  const m = await loadCheckedMapping(db, officeId, mappingIdOf(id)!);
  if (!m) return MATSUYAMA_CHOICE;
  return choice(id, mappingEntry({ id: m.id, title: m.title, issuer: m.mapping.issuer, checkedAt: m.checked_at }));
}

export type SavePlanFormResult = { ok: true } | { ok: false; error: "forbidden" | "bad" };

/** 事業所の様式を選ぶ。ケアマネの役（管理者でなくても）。候補にない値（下書き・ほかの事業所の対応表）は断る */
export async function savePlanForm(db: D1Database, p: Principal | null, value: unknown): Promise<SavePlanFormResult> {
  const actor = officeActor(p);
  if (!actor || !allows(p, "save")) return { ok: false, error: "forbidden" };
  const id = parsePlanForm(value);
  if (!id) return { ok: false, error: "bad" };
  const options = await listPlanForms(db, actor.officeId);
  if (!options.some((o) => o.id === id)) return { ok: false, error: "bad" };
  await db.prepare("UPDATE offices SET plan_form = ?1 WHERE id = ?2").bind(id, actor.officeId).run();
  return { ok: true };
}

// ---------- 使用様式のフォーム（app/office/form。T147 から書類の一覧〔/forms〕の「既定設定」が送る） ----------

export const OFFICE_FORM_PATH = "/office/form";

export type FormPostOutcome = { status: 401 } | { status: 403 } | { status: 303; location: string };

/**
 * 「使用様式」の保存。戻り先は書類の一覧のその様式（T147 で事業所の画面から書類の一覧へ移した）。断られたら form_error
 */
export async function planFormPost(db: D1Database, p: Principal | null, form: { get(name: string): unknown } | null): Promise<FormPostOutcome> {
  if (!p) return { status: 401 };
  const value = form?.get("plan_form") ?? null;
  const r = await savePlanForm(db, p, value);
  if (!r.ok && r.error === "forbidden") return { status: 403 };
  return { status: 303, location: r.ok ? `/forms?form=${encodeURIComponent(String(value))}` : "/forms?form_error=bad" };
}
