// 評価の台（T107）の紙の値の置き場。アプリと同じ部品で紙を組む（lib/forms/mapped-sheet.ts の buildMappedSheet・overlay-sheet.ts の
// buildOverlaySheet）。元の様式の頁の画像と場所のある欄があれば元の様式の上の紙、無ければ前からの 2 列の紙。
// 埋めた紙の HTML はアプリの紙面の部品（components/forms）を vite の runnerImport で読んで作る（tools/eval/forms/paper-html.tsx）。

import { fileURLToPath } from "node:url";
import { buildMappedSheet, type MappedSheet } from "../../../lib/forms/mapped-sheet.ts";
import type { FormMapping } from "../../../lib/forms/mapping.ts";
import { buildOverlaySheet, canOverlay, type OverlaySheet } from "../../../lib/forms/overlay-sheet.ts";
import type { PageImage } from "../../../lib/forms/page-images.ts";
import type { PersonPageRows } from "../../../lib/person.ts";

export type Sheets = { mapped: MappedSheet; overlay: OverlaySheet | null };

export function buildSheets(rows: PersonPageRows, mapping: FormMapping, images: readonly PageImage[] | null, today: string): Sheets {
  const mapped = buildMappedSheet(rows, mapping, { today, officeName: "デモ事業所" });
  const overlay = canOverlay(mapping.fields, images) ? buildOverlaySheet(mapped, images, mapping.typeface ?? "gothic") : null;
  return { mapped, overlay };
}

type PaperHtml = typeof import("./paper-html.tsx");
let loaded: Promise<PaperHtml> | null = null;

/** 紙面の部品（TSX）を読む。初めの 1 回だけ数秒かかる */
export function paperHtmlModule(): Promise<PaperHtml> {
  loaded ??= (async () => {
    const { runnerImport } = await import("vite");
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const { module } = await runnerImport<PaperHtml>(fileURLToPath(new URL("./paper-html.tsx", import.meta.url)), {
      root,
      configFile: false,
      logLevel: "error",
      resolve: { alias: { "@": root } },
    });
    return module;
  })();
  return loaded;
}

/** 紙の HTML（色付けの版は fill）。頁の画像は data: の URL */
export async function sheetHtml(s: Sheets, pageImage: (page: number) => string, fill: boolean, today: string): Promise<string> {
  const m = await paperHtmlModule();
  return s.overlay ? m.overlayPaperHtml(s.overlay, pageImage, fill) : m.mappedPaperHtml(s.mapped, today);
}
