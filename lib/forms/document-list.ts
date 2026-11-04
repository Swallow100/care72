// 書類の一覧（/forms、docs/tasks/T87.md の 2）。ヘッダーの「書類」から、書類と様式を選び、担当の利用者の 1 人か全員の一括で出す。
// 計画書は事業所の使える様式を全部（松山市・内閣府の様式例・確かめた対応表。lib/forms/plan-form.ts の listPlanForms）並べ、
// 事業所の使用様式は「既定」の印だけ（選ぶのは今のまま事業所の画面）。使用様式でない様式でも ?form= で選んで出せる。
// 人ごとの行に、紙面が「未確認」と刷る欄の数（lib/forms/unconfirmed.ts）。医療要約は同意で出せない人に理由。
// ここは D1 を引数で受け取る（テストで node:sqlite を渡す）。紙面は台帳から定型で組み、Claude は呼ばない。

import type { D1Database } from "@cloudflare/workers-types";
import { CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS } from "../labels.ts";
import type { PersonPageRows } from "../person.ts";
import { DOCUMENT_CATALOG, type CatalogEntry, type PlanFormId } from "./catalog.ts";
import { buildMappedSheet, type MappedSheet } from "./mapped-sheet.ts";
import type { FormMapping } from "./mapping.ts";
import { loadCheckedMapping, type StoredMapping } from "./mapping-db.ts";
import { buildMatsuyamaSheet, type BuildOptions, type MatsuyamaSheet } from "./matsuyama.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import { buildOwnSheet } from "./own-sheet.ts";
import { CAO_MAPPING_ID, caoMapping, parsePlanForm, planFormHref, type PlanFormOption } from "./plan-form.ts";
import { matsuyamaAskableOf } from "./form-asks.ts";
import { mappedUnconfirmed, matsuyamaUnconfirmed, unconfirmedView, type UnconfirmedSummary, type UnconfirmedView } from "./unconfirmed.ts";

/** 一覧の道 */
export const FORMS_LIST_PATH = "/forms";
/** 計画書の一括印刷の道 */
export const FORMS_BATCH_PATH = "/forms/batch";
/** 本人の 1 枚の一括印刷（T62。担当一覧の入口と同じ） */
export const OWN_BATCH_PATH = "/caseload/own-sheets";

/** 画面の言葉 */
export const FORMS_LIST_LABELS = {
  title: "書類",
  plan: "計画書",
  person: "本人ごと",
  office: "事業所",
  isDefault: "既定",
  batch: "一括印刷",
  add: "様式追加",
  people: "担当",
  open: "表示",
  print: "印刷",
  noPrint: "印刷不可",
} as const;

/** 本人ごとの書類（計画書のほか。本人のページの書類の行と同じ順） */
export const PERSON_DOCS = ["medical", "own", "qr", "phone"] as const;
export type PersonDoc = (typeof PERSON_DOCS)[number];

/** 一覧で選んだ書類 */
export type ListSelection = { doc: "plan"; form: PlanFormOption } | { doc: PersonDoc; entry: CatalogEntry };

type Param = string | string[] | undefined;
const one = (v: Param): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * ?form=（計画書の様式）と ?doc=（ほかの書類）から選んだ書類。どちらも無ければ事業所の使用様式の計画書。
 * 知らない値・事業所の候補に無い様式（ほかの事業所の対応表・下書き）は null（頁は 404）
 */
export function selectDocument(options: readonly PlanFormOption[], current: PlanFormId, q: { form?: Param; doc?: Param }): ListSelection | null {
  if (q.form !== undefined) {
    const id = parsePlanForm(one(q.form));
    const hit = id ? options.find((o) => o.id === id) : undefined;
    return hit ? { doc: "plan", form: hit } : null;
  }
  if (q.doc !== undefined) {
    const doc = one(q.doc);
    if (doc === "plan") return selectDocument(options, current, {});
    return (PERSON_DOCS as readonly string[]).includes(doc ?? "") ? { doc: doc as PersonDoc, entry: DOCUMENT_CATALOG[doc as PersonDoc] } : null;
  }
  const hit = options.find((o) => o.id === current) ?? options[0];
  return { doc: "plan", form: hit };
}

/** 一覧の書類の道 */
export function listHref(sel: { doc: "plan"; id: PlanFormId } | { doc: PersonDoc }): string {
  return sel.doc === "plan" ? `${FORMS_LIST_PATH}?form=${encodeURIComponent(sel.id)}` : `${FORMS_LIST_PATH}?doc=${sel.doc}`;
}

/** 選ぶ欄の 1 行 */
export type MenuItem = { key: string; label: string; note: string; href: string; current: boolean; isDefault: boolean };

/** 選ぶ欄（計画書の様式と、本人ごとの書類） */
export function documentMenu(
  options: readonly PlanFormOption[],
  current: PlanFormId,
  sel: ListSelection,
): { plan: MenuItem[]; person: MenuItem[] } {
  return {
    plan: options.map((o) => ({
      key: o.id,
      label: o.entry.short,
      note: o.entry.version,
      href: listHref({ doc: "plan", id: o.id }),
      current: sel.doc === "plan" && sel.form.id === o.id,
      isDefault: o.id === current,
    })),
    person: PERSON_DOCS.map((d) => ({
      key: d,
      label: DOCUMENT_CATALOG[d].short,
      note: DOCUMENT_CATALOG[d].version,
      href: listHref({ doc: d }),
      current: sel.doc === d,
      isDefault: false,
    })),
  };
}

// ---------- 計画書の様式 ----------

/** 紙面を組める形にした様式。対応表の紙は対応表の中身も持つ（事業所の対応表は頁の画像も） */
export type ResolvedPlanForm =
  | { id: PlanFormId; entry: CatalogEntry; kind: "matsuyama" }
  | { id: PlanFormId; entry: CatalogEntry; kind: "mapped"; mappingId: string; mapping: FormMapping; stored: StoredMapping | null };

/** 様式の中身を読む。事業所の対応表は確認済の物だけ（ほかの事業所・下書き・消えた物は null） */
export async function resolvePlanForm(db: D1Database, officeId: string, form: PlanFormOption): Promise<ResolvedPlanForm | null> {
  if (form.id === "matsuyama") return { id: form.id, entry: form.entry, kind: "matsuyama" };
  if (form.id === "cao") return { id: form.id, entry: form.entry, kind: "mapped", mappingId: CAO_MAPPING_ID, mapping: caoMapping(), stored: null };
  const stored = await loadCheckedMapping(db, officeId, form.id.slice("mapping:".length));
  return stored ? { id: form.id, entry: form.entry, kind: "mapped", mappingId: stored.id, mapping: stored.mapping, stored } : null;
}

/** 1 人の紙面（一括印刷と一覧の数で使う。1 人の頁と同じ組み方） */
export type PlanSheet = { kind: "matsuyama"; sheet: MatsuyamaSheet } | { kind: "mapped"; sheet: MappedSheet };

export function buildPlanSheet(rows: PersonPageRows, form: ResolvedPlanForm, opts: BuildOptions): PlanSheet {
  return form.kind === "matsuyama"
    ? { kind: "matsuyama", sheet: buildMatsuyamaSheet(rows, opts) }
    : { kind: "mapped", sheet: buildMappedSheet(rows, form.mapping, opts) };
}

/** 紙面の未確認の欄。rows を渡すと、計画書（松山市）の未確認を問いで埋められる物と未入力に分ける（T117。lib/forms/form-asks.ts） */
export function planUnconfirmed(s: PlanSheet, rows?: PersonPageRows): UnconfirmedSummary {
  return s.kind === "matsuyama" ? matsuyamaUnconfirmed(s.sheet, rows ? matsuyamaAskableOf(rows) : undefined) : mappedUnconfirmed(s.sheet);
}

// ---------- 人ごとの行 ----------

/** 出せない理由（医療要約の同意） */
export type Blocked = { kind: "refused" | "unconfirmed"; reason: string };

export type PersonDocRow = {
  id: string;
  name: string;
  /** 紙面の頁（無ければ開けない） */
  href: string;
  /** 印刷の窓まで（出せない人は null） */
  printHref: string | null;
  /** 紙面の未確認（数えない書類は null） */
  unconfirmed: UnconfirmedView | null;
  blocked: Blocked | null;
};

const withPrint = (href: string) => `${href}${href.includes("?") ? "&" : "?"}print=1`;

/** 本人ごとの書類の頁（lib/person.ts の書類の行と同じ道） */
export function personDocHref(doc: PersonDoc, personId: string): string {
  const p = encodeURIComponent(personId);
  return doc === "phone" ? `/people/${p}/phone` : `/people/${p}/forms/${doc}`;
}

/** 計画書の 1 人の行 */
export function planRow(rows: PersonPageRows, form: ResolvedPlanForm, opts: BuildOptions): PersonDocRow {
  const href = planFormHref(form.id, rows.person.id);
  return {
    id: rows.person.id,
    name: rows.person.name,
    href,
    printHref: withPrint(href),
    unconfirmed: unconfirmedView(planUnconfirmed(buildPlanSheet(rows, form, opts), rows)),
    blocked: null,
  };
}

/** 本人ごとの書類の 1 人の行。医療要約は同意の無い人を出せない（紙面の頁は理由だけ。T24）、本人の 1 枚は「決める」所を未確認に数える */
export function personDocRow(doc: PersonDoc, rows: PersonPageRows, opts: BuildOptions): PersonDocRow {
  const href = personDocHref(doc, rows.person.id);
  const base = { id: rows.person.id, name: rows.person.name, href, printHref: withPrint(href), unconfirmed: null, blocked: null };
  if (doc === "medical") {
    const r = buildMedicalSummary(rows, opts);
    if (r.kind !== "sheet") {
      return {
        ...base,
        printHref: null,
        blocked: { kind: r.kind, reason: `${CONSENT_KIND_LABELS.medical} ${CONSENT_STATUS_LABELS[r.consent.status]}` },
      };
    }
    const labels = r.sheet.pending.map((p) => p.label);
    return { ...base, unconfirmed: { count: labels.length, blank: labels, noSource: [] } };
  }
  if (doc === "own") {
    const labels = buildOwnSheet(rows, opts)
      .open.filter((o) => o.kind === "decide")
      .map((o) => o.label);
    return { ...base, unconfirmed: { count: labels.length, blank: labels, noSource: [] } };
  }
  return base;
}

/** 一括印刷の道（計画書・医療要約・本人の 1 枚。QR・スマホ入口は 1 人ずつ） */
export function batchHref(sel: ListSelection): string | null {
  if (sel.doc === "plan") return `${FORMS_BATCH_PATH}?form=${encodeURIComponent(sel.form.id)}&print=1`;
  if (sel.doc === "medical") return `${FORMS_BATCH_PATH}?doc=medical&print=1`;
  if (sel.doc === "own") return `${OWN_BATCH_PATH}?print=1`;
  return null;
}
