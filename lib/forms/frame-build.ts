// 計画書（松山市）と医療要約（災害診療記録2018）を原本の枠に置いた紙にする（T101。lib/forms/frame-sheet.ts の buildFrameSheet）。
// 値は前からの紙面と同じ（buildMatsuyamaSheet・buildMedicalSummary の cells）。原本の頁は事業所が取り込んだ物（lib/forms/originals.ts）。
// サーバーの描画で、Claude は呼ばない。

import { buildFrameSheet, type SlotImage } from "./frame-sheet.ts";
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
export const ROUTE_MAP_BOX_MM = { w: 173.25, h: 73.46, withTextH: 61.26 } as const;

/** 避難経路の地図（T102）。src は同じ origin の URL か data: の URL。alt は「避難経路の地図」など */
export type RouteMapImage = SlotImage;

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
