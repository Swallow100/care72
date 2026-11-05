// 見直しの紙を、紙の画面と同じ作り方でサーバーで作る（T136）。紙の画面（app/people/[id]/forms の matsuyama・medical・mapped）と
// 見直しの受け口（app/api/forms/review）が同じ紙を作る（紙の版 sheetHash が同じになる）。原本の枠・元の様式の上の紙だけ（前からの紙面は見ない）。
// 見直しはケアマネの道具なので、ケアマネの役で、自分の事業所の人だけ（原本と対応表は事業所の物）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { loadPersonDocument, medicalSummaryView } from "../consent/documents.ts";
import { parseLedger } from "../db/ledger.ts";
import type { PersonPageRows } from "../person.ts";
import { kirokuFrameSheet, matsuyamaFrameSheet, routeMapFor } from "./frame-build.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import { formsScope, loadCheckedMapping, type StoredMapping } from "./mapping-db.ts";
import type { FormMapping } from "./mapping.ts";
import { buildMatsuyamaSheet } from "./matsuyama.ts";
import { buildMedicalSummary } from "./medical-summary.ts";
import { originalPageHref } from "./originals.ts";
import { loadOriginal, type OriginalBucket } from "./originals-http.ts";
import { buildOverlaySheet, canOverlay, type OverlaySheet } from "./overlay-sheet.ts";
import { pageImageHref } from "./page-images.ts";
import { applyFixes, loadFixes, type FieldFix } from "./review-db.ts";
import { kirokuSubject, mappedSubject, matsuyamaSubject, sheetHash, type ReviewSubject } from "./review.ts";

export type ReviewFormKey = "matsuyama" | "kiroku" | `mapped:${string}`;

export function parseFormKey(v: unknown): ReviewFormKey | null {
  if (v === "matsuyama" || v === "kiroku") return v;
  if (typeof v === "string" && /^mapped:[A-Za-z0-9_-]{1,64}$/.test(v)) return v as ReviewFormKey;
  return null;
}

export const mappedFormKey = (mappingId: string): ReviewFormKey => `mapped:${mappingId}`;

export type ReviewPaper = {
  formKey: ReviewFormKey;
  officeId: string;
  rows: PersonPageRows;
  subject: ReviewSubject;
  sheet: OverlaySheet;
  hash: string;
  href: (page: number) => string;
  /** 対応表の紙: 対応表（再考の直しを当てた物）と直し */
  mapped?: { stored: StoredMapping; mapping: FormMapping; fixes: ReadonlyMap<string, FieldFix> };
};

export type ReviewLoadDeps = {
  db: D1Database;
  /** R2 の原本・頁の画像 */
  get: OriginalBucket["get"];
  today: string;
};

/** 見直しができる人か（ケアマネの役で自分の事業所の人） */
export function canReview(principal: Principal | null, officeId: string): boolean {
  const scope = formsScope(principal);
  return principal?.role === "care_manager" && scope !== null && scope.officeId === officeId;
}

/** 見直しの紙。紙が無い（原本を取り込んでいない・対応表の場所が無い・同意で医療要約を作らない）・見直せない人は null */
export async function loadReviewPaper(deps: ReviewLoadDeps, principal: Principal | null, personId: string, formKey: ReviewFormKey): Promise<ReviewPaper | null> {
  if (!principal) return null;
  const doc = formKey === "kiroku" ? "medical" : formKey === "matsuyama" ? "matsuyama" : "mapped";
  const opened = await loadPersonDocument(deps.db, principal, personId, doc);
  if (!opened) return null;
  const { rows } = opened;
  const officeId = rows.person.office_id;
  if (!canReview(principal, officeId)) return null;
  const office = await deps.db.prepare("SELECT name FROM offices WHERE id = ?1").bind(officeId).first<{ name: string }>();
  const opts = { today: deps.today, officeName: office?.name ?? null };
  const store = { get: deps.get };

  if (formKey === "matsuyama") {
    const manifest = await loadOriginal(store, officeId, "matsuyama");
    if (!manifest) return null;
    const ms = buildMatsuyamaSheet(rows, opts);
    const sheet = matsuyamaFrameSheet(ms, manifest, { routeMap: routeMapFor(parseLedger(rows.person.ledger)) });
    return { formKey, officeId, rows, subject: matsuyamaSubject(ms, sheet), sheet, hash: await sheetHash(sheet), href: (p) => originalPageHref("matsuyama", p) };
  }
  if (formKey === "kiroku") {
    const result = buildMedicalSummary(rows, { ...opts, view: medicalSummaryView(opened.scope) });
    if (result.kind !== "sheet") return null;
    const manifest = await loadOriginal(store, officeId, "kiroku");
    if (!manifest) return null;
    const sheet = kirokuFrameSheet(result.sheet, manifest);
    return { formKey, officeId, rows, subject: kirokuSubject(result.sheet, sheet), sheet, hash: await sheetHash(sheet), href: (p) => originalPageHref("kiroku", p) };
  }
  const mappingId = formKey.slice("mapped:".length);
  const stored = await loadCheckedMapping(deps.db, officeId, mappingId);
  if (!stored || !stored.pageImages) return null;
  const fixes = await loadFixes(deps.db, officeId, formKey, stored.version);
  const { mapping } = applyFixes(stored.mapping, fixes);
  if (!canOverlay(mapping.fields, stored.pageImages)) return null;
  const mappedSheet = buildMappedSheet(rows, mapping, opts);
  const sheet = buildOverlaySheet(mappedSheet, stored.pageImages, mapping.typeface);
  return {
    formKey,
    officeId,
    rows,
    subject: mappedSubject(mappedSheet, sheet),
    sheet,
    hash: await sheetHash(sheet),
    href: (p) => pageImageHref(stored.id, p),
    mapped: { stored, mapping, fixes },
  };
}
