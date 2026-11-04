// 計画書（松山市）と医療要約（災害診療記録2018）を原本の枠に置いた紙にする（T101。lib/forms/frame-sheet.ts の buildFrameSheet）。
// 値は前からの紙面と同じ（buildMatsuyamaSheet・buildMedicalSummary の cells）。原本の頁は事業所が取り込んだ物（lib/forms/originals.ts）。
// サーバーの描画で、Claude は呼ばない。

import type { Ledger } from "../db/types.ts";
import { ROUTE_LABELS } from "../labels.ts";
import { routeMapSvg, routeSceneOf } from "../map/route-image.ts";
import { buildFrameSheet, ROUTE_TEXT_MM, type SlotImageFor } from "./frame-sheet.ts";
import { MATSUYAMA_FRAME } from "./frame-matsuyama.ts";
import { KIROKU_FRAME } from "./frame-kiroku.ts";
import { MATSUYAMA_FIELDS, MATSUYAMA_FORM_VERSION, type MatsuyamaKey, type MatsuyamaSheet } from "./matsuyama.ts";
import { MEDICAL_FIELDS, type MedicalKey, type MedicalSummary } from "./medical-summary.ts";
import type { OriginalManifest } from "./originals.ts";
import type { OverlaySheet } from "./overlay-sheet.ts";
import { matsuyamaFieldName, matsuyamaUnconfirmed, medicalUnconfirmed, unconfirmedText } from "./unconfirmed.ts";

/** 避難経路の欄の画像の受け口の名前（T102 が地図の画像を渡す。lib/forms/frame-matsuyama.ts の image の slot） */
export const ROUTE_MAP_SLOT = "route-map";

/**
 * 避難経路の欄の大きさ（mm。地図の画像を作るときの縦横の比に）。避難経路の文があれば欄の上 12.2mm を文に使うので、地図は withText の高さ
 */
export const ROUTE_MAP_BOX_MM = { w: 173.25, h: 73.46, withTextH: Math.round((73.46 - ROUTE_TEXT_MM.top) * 100) / 100 } as const;

/**
 * 原本を取り込む前の紙面（T85、components/forms/MatsuyamaSheet.tsx）の避難経路の地図の箱（mm）。その紙は 2 頁に地図の場所が無いので
 * 地図は別紙の頁に置く。幅は段の内側（A4 から左 20.6mm・右 15.6mm の余白と段の枠の線を引いた幅）、高さは経路地図で決めた範囲と同じ 2:1
 */
export const ROUTE_MAP_ANNEX_MM = { w: 173.25, h: 86.6 } as const;

/** 避難経路の地図（T106）。欄の箱の大きさ（mm）を受けて SVG を作る（lib/forms/frame-sheet.ts の SlotImageFor） */
export type RouteMapImage = SlotImageFor;

/**
 * 紙の地図のタイルの細かさ（lib/map/route-image.ts の routeMapSvg の detail）。1 はタイルを 1 段細かく敷き、刷った線と道がくっきりする
 * （地図の字はその分小さい）
 */
export const ROUTE_MAP_DETAIL = 1;

/**
 * 台帳の経路地図（T102）を紙の避難経路の欄に置く物（T106）。経路地図か家の位置が無ければ null（欄を空け、文字の経路だけ）。
 * SVG は地理院タイルを <image href> で読むので、紙面の部品は <img> にせず欄の中にそのまま埋め込む。
 * 中身は台帳の座標から計算した数・固定の言葉（「家」「避難先1」「経路 目安」と出典）・地理院タイルの URL だけで、名前・住所の文字は入らない
 */
export function routeMapFor(ledger: Ledger): RouteMapImage | null {
  if (!routeSceneOf(ledger, { w: ROUTE_MAP_BOX_MM.w, h: ROUTE_MAP_BOX_MM.h })) return null;
  return (box) => {
    const svg = routeMapSvg(ledger, box, { unit: "mm", detail: ROUTE_MAP_DETAIL });
    return svg ? { svg, alt: ROUTE_LABELS.open } : null;
  };
}

/** 同意の記録の日と人（ケア72 の添え。様式の値でない）は原本の紙に書かない */
const MATSUYAMA_DROP_AFTER = new Set<MatsuyamaKey>(["consent.registry", "consent.planShare"]);

/** 計画書を原本の枠に。routeMap は避難経路の欄に置く地図（無ければ空ける） */
export function matsuyamaFrameSheet(sheet: MatsuyamaSheet, manifest: OriginalManifest, opts: { routeMap?: RouteMapImage | null } = {}): OverlaySheet {
  return buildFrameSheet<MatsuyamaKey>({
    frame: MATSUYAMA_FRAME,
    personId: sheet.personId,
    name: sheet.name,
    title: "計画書",
    issuer: `松山市 様式【${MATSUYAMA_FORM_VERSION}】`,
    // 特記事項の中の段（医療・本人の言葉・夜間支援・その他）は段の名前だけ、ほかは帯と同じ欄の名前
    fields: MATSUYAMA_FIELDS.map((f) => ({ key: f.key, label: f.block === "notes" ? f.label : matsuyamaFieldName(f), handwrite: f.shape === "handwrite" })),
    cells: sheet.cells,
    pages: manifest.pages.map((p) => p.page),
    images: { [ROUTE_MAP_SLOT]: opts.routeMap ?? null },
    dropAfter: MATSUYAMA_DROP_AFTER,
    annexChoice: { key: "notes.annex", yes: "あり", no: "なし" },
    unconfirmed: matsuyamaUnconfirmed(sheet).fields.map(unconfirmedText),
    withheld: sheet.withheld,
  });
}

/** 医療要約を災害診療記録2018 の 1 頁目の枠に。医師が書く欄・範囲の外の欄（hidden）は空ける */
export function kirokuFrameSheet(sheet: MedicalSummary, manifest: OriginalManifest): OverlaySheet {
  const hidden = new Set<MedicalKey>(sheet.hidden ?? []);
  return buildFrameSheet<MedicalKey>({
    frame: KIROKU_FRAME,
    personId: sheet.personId,
    name: sheet.name,
    title: "医療要約",
    issuer: "災害診療記録2018",
    fields: MEDICAL_FIELDS.map((f) => ({ key: f.key, label: f.label, handwrite: ("doctor" in f && f.doctor) || hidden.has(f.key) })),
    cells: sheet.cells,
    pages: manifest.pages.map((p) => p.page),
    unconfirmed: medicalUnconfirmed(sheet).fields.map(unconfirmedText),
    withheld: [],
  });
}
