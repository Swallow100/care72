// 元の様式の上に置いた紙の見た目の検査（T133）。置いた字が印刷の字と重なっていないか、欄の枠の外へ出ていないか、
// 隣の欄の枠に掛かっていないかを、置いた字の箱（字の大きさと行から見積もった物）で数える。評価の台（tools/eval/forms）とテストが使う。
//
// - 字の箱: 置いた所（item.box）の内側の空き（PAD）から、行の数 × 字の高さ、いちばん長い行の幅。1・2 行の欄は高さの真ん中、高い欄は上から
//   （components/forms/overlay-paper.css の .ov-text と同じ）
// - 印刷の字: 頁の印刷の字の位置（lib/forms/ink.ts）のかたまり。字の箱と、かたまりの面の 2 割より多く重なれば「重なり」
// - はみ出し: 字の箱・印（レ点・丸）がその欄の枠（box）の外へ 0.3mm より多く出る
// - 隣の欄: 字の箱が、ほかの欄の枠と縦横どちらも 0.3mm より多く重なる（その欄の枠を中に持つ欄〔外の段〕と、同じ書く所の欄は除く）

import { unpackInk } from "./ink.ts";
import type { FieldBox, MappingField } from "./mapping.ts";
import { containsMost, hitsInk, inside, textExtent, type OverlaySheet } from "./overlay-sheet.ts";
import type { PageImage } from "./page-images.ts";

/** 許す出入り（mm） */
const TOL_MM = 0.3;

export type LookIssue = { page: number; fieldId: string; kind: "overlap" | "outside" | "neighbor" };

export type LookCheck = {
  /** 置いた字の数（区切りの空きは 1 つずつ） */
  texts: number;
  /** 置いた印（レ点・丸）の数 */
  marks: number;
  /** 印刷の字と重なった字 */
  overlap: number;
  /** 欄の枠の外へ出た字・印 */
  outside: number;
  /** 隣の欄の枠に掛かった字 */
  neighbor: number;
  /** 欄の枠の中の空いた所へずらして置いた字（T133） */
  shifted: number;
  /** 置けなかった欄（T133。値はあるが置かず、印を付けた欄） */
  unplaced: number;
  /** 印刷の字の位置のある頁の数（無い頁は重なりを数えない） */
  inkPages: number;
  issues: LookIssue[];
};

const inter = (a: FieldBox, b: FieldBox) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return { w: Math.max(0, w), h: Math.max(0, h) };
};

/** 書く所がほぼ同じ（重なりが 9 割）か（overlay-sheet.ts の同じ書く所の欄と同じ） */
function sameArea(a: FieldBox, b: FieldBox): boolean {
  const i = inter(a, b);
  return i.w * i.h >= 0.9 * Math.max(a.w * a.h, b.w * b.h);
}

/** 紙を数える。fields は対応表の欄（外した欄を含んでよい）、images は頁の画像（印刷の字の位置を持つ物） */
export function checkLook(sheet: OverlaySheet, fields: readonly MappingField[], images: readonly PageImage[]): LookCheck {
  const out: LookCheck = { texts: 0, marks: 0, overlap: 0, outside: 0, neighbor: 0, shifted: 0, unplaced: sheet.unplaced?.length ?? 0, inkPages: 0, issues: [] };
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const page of sheet.pages) {
    const img = images.find((x) => x.page === page.page);
    const ink = img?.ink ? (unpackInk(img.ink) ?? []) : null;
    if (ink) out.inkPages += 1;
    const tolX = TOL_MM / page.image.w;
    const tolY = TOL_MM / page.image.h;
    const others = fields.filter((f) => !f.removed && f.page === page.page && f.box && f.shape !== "handwrite");
    for (const it of page.items) {
      if (it.kind === "image" || it.kind === "picture") continue;
      const field = byId.get(it.fieldId);
      const own = field?.box ?? null;
      if (it.kind === "mark") {
        out.marks += 1;
        if (own && !inside(it.box, own, tolX, tolY)) {
          out.outside += 1;
          out.issues.push({ page: page.page, fieldId: it.fieldId, kind: "outside" });
        }
        continue;
      }
      out.texts += 1;
      if (it.shifted) out.shifted += 1;
      const ext = textExtent(it, page.image);
      if (own && !inside(ext, own, tolX, tolY)) {
        out.outside += 1;
        out.issues.push({ page: page.page, fieldId: it.fieldId, kind: "outside" });
      }
      if (ink && hitsInk(ext, ink)) {
        out.overlap += 1;
        out.issues.push({ page: page.page, fieldId: it.fieldId, kind: "overlap" });
      }
      if (own) {
        const bad = others.some((g) => {
          if (g.id === it.fieldId || !g.box) return false;
          // その欄を中に持つ欄（外の段）・同じ書く所の欄は除く
          if (containsMost(g.box, own) || sameArea(own, g.box)) return false;
          const i = inter(ext, g.box);
          return i.w > tolX && i.h > tolY;
        });
        if (bad) {
          out.neighbor += 1;
          out.issues.push({ page: page.page, fieldId: it.fieldId, kind: "neighbor" });
        }
      }
    }
  }
  return out;
}
