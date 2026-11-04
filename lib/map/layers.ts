// 地図の層と出典（T14）。利用の条件と確かめた日は docs/progress/t14.md。
// - 下の地図: 国土地理院の地理院タイル（淡色地図）。ウェブで読み込んで使うときは出典の明示だけでよく、
//   出典は「国土地理院」か「地理院タイル」と書き、地理院タイル一覧のページへリンクする
// - 重ねる層: ハザードマップポータルサイト「重ねるハザードマップ」のタイル。出典の記載例は「出典：「ハザードマップポータルサイト」」。
//   層ごとのデータの作成者（洪水・津波）と、土砂災害警戒区域の加工の表記はポータルのオープンデータの頁の「出典のデータの名称／作成者等」のまま
// どの層も透過して重ねるだけで、絵を描き変えない。

import type { HazardKind } from "../db/types.ts";

export type Attribution = { text: string; href: string };

export const BASE_LAYER = {
  /** 淡色地図。ズーム 5〜18（日本とその周り） */
  url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
  minZ: 5,
  maxZ: 18,
  attribution: { text: "地理院タイル", href: "https://maps.gsi.go.jp/development/ichiran.html" } satisfies Attribution,
} as const;

/**
 * 気象庁の雨雲（降水ナウキャスト、T72）。担当一覧の地図（デモ事業所も。T103）に、旗 JMA_NOWCAST が on のときだけ、加工せずに重ねる。訓練の画面には重ねない。
 * タイルは Workers の route（app/api/jma/nowc）から。出典と凡例は地図の右下（components/map/NowcastLayer.tsx、lib/jma/nowcast.ts）
 */
export const NOWCAST_LAYER = {
  attribution: { text: "気象庁ホームページ", href: "https://www.jma.go.jp/bosai/nowc/" } satisfies Attribution,
} as const;

/** 重ねるハザードマップのポータル（出典の記載例の名前） */
export const HAZARD_PORTAL: Attribution = {
  text: "ハザードマップポータルサイト",
  href: "https://disaportal.gsi.go.jp/hazardmap/copyright/opendata.html",
};

export type HazardLayer = {
  id: HazardKind;
  /** 切替のボタンの言葉（lib/labels.ts の HAZARD_LABELS と同じ） */
  label: string;
  /** タイルの URL。土砂は 3 つ（土石流・急傾斜地の崩壊・地すべり）を重ねる */
  urls: readonly string[];
  /** データの名前 */
  data: string;
  /** データの作成者・加工の表記（ポータルの頁のまま） */
  origin: string;
  /** ズームの範囲 */
  minZ: number;
  maxZ: number;
};

const PORTAL = "https://disaportaldata.gsi.go.jp/raster";

export const HAZARD_LAYERS: readonly HazardLayer[] = [
  {
    id: "flood",
    label: "浸水",
    urls: [`${PORTAL}/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`],
    data: "洪水浸水想定区域（想定最大規模）",
    origin: "国土交通省各地方整備局等・都道府県",
    minZ: 2,
    maxZ: 17,
  },
  {
    id: "landslide",
    label: "土砂",
    urls: [
      `${PORTAL}/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png`,
      `${PORTAL}/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png`,
      `${PORTAL}/05_jisuberikeikaikuiki/{z}/{x}/{y}.png`,
    ],
    data: "土砂災害警戒区域",
    origin: "国土交通省政策統括官付地理空間情報課「国土数値情報（令和７年度土砂災害警戒区域）」をもとに国土地理院が加工",
    minZ: 2,
    maxZ: 17,
  },
  {
    id: "tsunami",
    label: "津波",
    urls: [`${PORTAL}/04_tsunami_newlegend_data/{z}/{x}/{y}.png`],
    data: "津波浸水想定",
    origin: "都道府県",
    minZ: 2,
    maxZ: 17,
  },
];

export function hazardLayer(id: HazardKind): HazardLayer {
  const l = HAZARD_LAYERS.find((x) => x.id === id);
  if (!l) throw new Error(`層が無い: ${id}`);
  return l;
}

/** 重ねた層の不透明度（下の地図とピンが読めるように）。T66 で 0.6 → 0.72（下の地図を薄くした分、層を強く） */
export const HAZARD_OPACITY = 0.72;

/**
 * 下の地図（淡色地図）の不透明度。ライトだけ少し薄くして、重ねた層と雨雲とピンを浮かせる（T66。地は面の中の灰）。
 * ダークは明るさを落とした地図のまま（薄くすると暗い地が透けて雨雲の線が沈む）
 */
export const BASE_OPACITY = 0.7;
