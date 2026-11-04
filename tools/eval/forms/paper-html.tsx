// 評価の台（T107）の埋めた紙の HTML。アプリの紙面の部品（components/forms の OverlaySheet・MappedSheet）をそのまま使い、
// 印刷のテストと同じ頁の形（lib/forms/print-harness.ts の paperPage と紙面の CSS）にする。
// node は JSX を通さないので、この file は vite の runnerImport で読む（tools/eval/forms/paper.ts）。部品の複製は作らない。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MappedSheet } from "../../../components/forms/MappedSheet.tsx";
import { OverlaySheet } from "../../../components/forms/OverlaySheet.tsx";
import type { MappedSheet as Mapped } from "../../../lib/forms/mapped-sheet.ts";
import type { OverlaySheet as Overlay } from "../../../lib/forms/overlay-sheet.ts";
import { paperCss, paperPage } from "../../../lib/forms/print-harness.ts";

let css: string | null = null;

/** 元の様式の頁の上に値を置いた紙。imageSrc は頁の画像（data: の URL）。fill は未記入の色付けの版 */
export function overlayPaperHtml(sheet: Overlay, imageSrc: (page: number) => string, fill: boolean): string {
  css ??= paperCss();
  return paperPage(renderToStaticMarkup(createElement(OverlaySheet, { sheet, imageSrc, checked: "", fill, kind: "overlay" })), css);
}

/** 場所の無い対応表の紙（欄名と値の 2 列。前からの差し込みの紙） */
export function mappedPaperHtml(sheet: Mapped, date: string): string {
  css ??= paperCss();
  return paperPage(renderToStaticMarkup(createElement(MappedSheet, { sheet, meta: { date, checked: "", office: "デモ事業所", author: null } })), css);
}
