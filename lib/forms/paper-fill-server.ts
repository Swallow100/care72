// 紙の上でその場で入れる（T135）の紙と画面の中身を作る（サーバーだけ）。書類の頁（app/people/[id]/forms の matsuyama・mapped）が呼ぶ。
// 紙の手入れ（lib/forms/form-entries.ts）を読み、様式だけの欄の値を紙面に効かせ、置いた文字の枠と画像を頁の上の物にし（印刷に出る）、
// 書ける人（ケアマネの役で自分の事業所の人）には欄の一覧と紙から聞く問いを渡す。Claude は呼ばない。

import type { D1Database } from "@cloudflare/workers-types";
import { questionQueue } from "../intake/ask.ts";
import type { PersonPageRows } from "../person.ts";
import { assetsByIds } from "./form-assets.ts";
import { loadFormEntries, mappedFormId, withFreeItems, withMappedEntries, withMatsuyamaEntries, type FormEntry } from "./form-entries.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import { matsuyamaFrameSheet, type RouteMapImage } from "./frame-build.ts";
import { buildMappedSheet } from "./mapped-sheet.ts";
import type { FormMapping } from "./mapping.ts";
import type { MatsuyamaSheet } from "./matsuyama.ts";
import type { OriginalManifest } from "./originals.ts";
import { buildOverlaySheet, canOverlay, FONT_MAX_PT, type OverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";
import type { PaperFillData } from "./paper-fill.ts";
import { frameSlots, mappedSlots, paperQuestions } from "./paper-slots.ts";

const pagesOf = (sheet: OverlaySheet) => sheet.pages.map((p) => ({ page: p.page, w: p.image.w, h: p.image.h }));

async function freeAssets(db: D1Database, officeId: string, entries: readonly FormEntry[]) {
  return assetsByIds(
    db,
    officeId,
    entries.filter((e) => e.kind === "image").map((e) => e.value),
  );
}

/**
 * 添付の様式（T86）。差し込みの紙面に手入れを効かせ、元の様式の上の紙（頁の画像があれば）と画面の中身。
 * edit は書ける人（ケアマネの役で自分の事業所の人）
 */
export async function mappedPaper(
  db: D1Database,
  input: {
    rows: PersonPageRows;
    officeId: string;
    mappingId: string;
    mapping: FormMapping;
    images: readonly PageImage[] | null;
    opts: Parameters<typeof buildMappedSheet>[2];
    overlay: boolean;
    edit: boolean;
  },
): Promise<{ sheet: ReturnType<typeof buildMappedSheet>; overlay: OverlaySheet | null; fill: PaperFillData | null }> {
  const { rows, mapping } = input;
  const formId = mappedFormId(input.mappingId);
  const entries = await loadFormEntries(db, input.officeId, rows.person.id, formId);
  const sheet = withMappedEntries(buildMappedSheet(rows, mapping, input.opts), entries);
  if (!input.overlay || !canOverlay(mapping.fields, input.images)) return { sheet, overlay: null, fill: null };
  const assets = await freeAssets(db, input.officeId, entries);
  const overlay = withFreeItems(buildOverlaySheet(sheet, input.images, mapping.typeface), entries, assets, FONT_MAX_PT);
  if (!input.edit) return { sheet, overlay, fill: null };
  const queue = questionQueue(rows);
  const slots = mappedSlots(rows, mapping, overlay, sheet, entries, queue);
  return {
    sheet,
    overlay,
    fill: {
      personId: rows.person.id,
      version: rows.person.version ?? 1,
      formId,
      typeface: mapping.typeface ?? "gothic",
      maxPt: FONT_MAX_PT,
      pages: pagesOf(overlay),
      slots,
      free: entries.filter((e) => e.kind === "text" || e.kind === "image"),
      assets: Object.fromEntries([...assets].map(([id, a]) => [id, { name: a.name, src: a.src }])),
      questions: paperQuestions(queue, slots),
    },
  };
}

/**
 * 計画書（松山市）。紙面に様式だけの欄の手入れを効かせ、原本を取り込んでいれば原本の枠の紙（T101）に置いた文字の枠と画像を足す。
 * 原本の枠の紙の書ける人には画面の中身
 */
export async function matsuyamaPaper(
  db: D1Database,
  input: {
    rows: PersonPageRows;
    officeId: string;
    sheet: MatsuyamaSheet;
    manifest: OriginalManifest | null;
    routeMap: RouteMapImage | null;
    edit: boolean;
  },
): Promise<{ sheet: MatsuyamaSheet; framed: OverlaySheet | null; fill: PaperFillData | null }> {
  const { rows } = input;
  const entries = await loadFormEntries(db, input.officeId, rows.person.id, "matsuyama");
  const sheet = withMatsuyamaEntries(input.sheet, entries);
  if (!input.manifest) return { sheet, framed: null, fill: null };
  const assets = await freeAssets(db, input.officeId, entries);
  const framed = withFreeItems(matsuyamaFrameSheet(sheet, input.manifest, { routeMap: input.routeMap }), entries, assets, MATSUYAMA_FRAME.maxPt);
  if (!input.edit) return { sheet, framed, fill: null };
  const queue = questionQueue(rows);
  const slots = frameSlots(
    rows,
    MATSUYAMA_FRAME,
    sheet,
    input.manifest.pages.map((p) => p.page),
    entries,
    queue,
  );
  return {
    sheet,
    framed,
    fill: {
      personId: rows.person.id,
      version: rows.person.version ?? 1,
      formId: "matsuyama",
      typeface: "gothic",
      maxPt: MATSUYAMA_FRAME.maxPt,
      pages: pagesOf(framed),
      slots,
      free: entries.filter((e) => e.kind === "text" || e.kind === "image"),
      assets: Object.fromEntries([...assets].map(([id, a]) => [id, { name: a.name, src: a.src }])),
      questions: paperQuestions(queue, slots),
    },
  };
}
