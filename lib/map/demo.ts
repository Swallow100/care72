// 雨雲・震度の「デモ」の表示（T14）。この絵と数字は気象庁の情報を使わない（本物の雨雲は T72 の旗の下で lib/jma/nowcast.ts が重ねる）。
// 災害の状態（T09 の災害の種類を lib/disaster/state.ts の DISASTER_SCENE で大雨か地震の場面に写した物と警戒レベル）か訓練の筋書き（docs/SPEC.md: 大雨は警戒レベル 3 → 4 → 浸水 3 m、
// 地震は南海トラフで震度 6 強・沿岸の津波・停電 2 日）から作った絵と数字で、画面には必ず「デモ」の印を付ける。
// 雨雲の絵は訓練だけ（T103 の決め (c)）: 筋書きの雨の表（lib/drill/rain.ts）から時刻で動く帯を作る（lib/map/drill-rain.ts）。
// 平時（担当一覧。デモ事業所も本物の事業所も）は作り物の雨を描かず、旗が on なら本物の雨雲を重ねる（off なら雨は出さない）。
// 訓練の雨は 1 時間の降水量の段ごとの色（気象庁の降水ナウキャストの凡例と同じ 8 段と色。lib/map/rain-scale.ts。T116）で、
// 平時に重ねる本物の雨雲と同じ読み方にする。本物の情報と見間違えないよう、地図の上の帯に「デモ」「想定値」、凡例に「想定」を出し、
// 地図に「警報」「注意報」「速報」「気象庁」の言葉を使わない（訓練の画面には本物の雨雲を重ねない。T103）。

import type { GeoPoint, HazardKind } from "../db/types.ts";
import type { RainTrack } from "../drill/rain.ts";
import { checkMark, sourceById, type CheckMark } from "../sources/index.ts";
import { drillRain, type RainBand } from "./drill-rain.ts";

export type { RainBand } from "./drill-rain.ts";

/** 訓練の雨の元: 筋書きの雨の表、見ている時刻（発災からの時間。小数は分）、帯を置く真ん中（lib/map/drill-rain.ts の rainAnchor） */
export type DrillRainInput = { track: RainTrack; hour: number; anchor: GeoPoint };

/**
 * デモの場面。T09 の災害の状態（DISASTER_SCENE で写す。その他・平時は場面なしで、ここへ来ない）か訓練の筋書きから作る。
 * 大雨で警戒レベルを入れていない（null）ときは、名前を「大雨」だけにする。雨雲を描くのは訓練（drill がある）ときだけで、
 * 描く段は警戒レベルの上限の降水量まで（RAIN_CAP_MM。解除・無しの null は雨なし）
 */
export type DemoScene = { kind: "heavy_rain"; level: 3 | 4 | 5 | null; drill?: DrillRainInput } | { kind: "earthquake" };

export type DemoOverlay = {
  /** 場面の名前（大雨 レベル 4・地震 南海トラフ） */
  title: string;
  rain: RainBand[];
  /** 震度（筋書きの値）。大雨では null */
  quake: { intensity: string; area: string } | null;
  /** 既定で重ねるハザードの層 */
  layers: HazardKind[];
  /**
   * 訓練の雨の参考にした過去の雨（出典の登録簿から引いた題名の頭・URL・作者の確認の印）。雨を描くときだけ。
   * 題名は括弧の前まで（地図の帯は狭い。全部の題名は docs/SOURCES.md）
   */
  basis: { label: string; href: string; mark: CheckMark } | null;
};

/**
 * 警戒レベルごとの描く降水量の上限（mm/h。段の下の境がこれ以上の段は描かない）。訓練の雨が被害状況の警戒レベルより強くならない。
 * レベル 3 は 10〜20 まで、4 は 30〜50 まで、5 は 80 以上まで。前の 3 段（弱・強・猛。T103）の上限に合わせた
 * （弱 = 20 未満、強 = 20〜50、猛 = 50 以上）。気象の決まりではなく、筋書きの絵の決まり
 */
export const RAIN_CAP_MM: Record<3 | 4 | 5, number> = { 3: 20, 4: 50, 5: Number.POSITIVE_INFINITY };

/** 警戒レベルの上限（解除・無しの null は 0 = 雨なし） */
export function rainCapOf(level: 3 | 4 | 5 | null): number {
  return level === null ? 0 : RAIN_CAP_MM[level];
}

export function demoOverlay(scene: DemoScene): DemoOverlay {
  if (scene.kind === "heavy_rain") {
    const d = scene.drill;
    const rain = d ? drillRain(d.track, d.hour, rainCapOf(scene.level), d.anchor) : [];
    const src = d && rain.length > 0 ? sourceById(d.track.basis) : null;
    return {
      title: scene.level !== null ? `大雨 レベル ${scene.level}` : "大雨",
      rain,
      quake: null,
      layers: ["flood", "landslide"],
      basis: src ? { label: src.title.split("（")[0], href: src.url, mark: checkMark(src.id) } : null,
    };
  }
  return {
    title: "地震 南海トラフ",
    rain: [],
    quake: { intensity: "6強", area: "松山市" },
    layers: ["tsunami", "landslide"],
    basis: null,
  };
}

/** 地図の上に「デモ」の帯を出すか（作った絵か数字があるときだけ。平時の大雨の場面は雨を描かないので出さない） */
export function demoShown(demo: DemoOverlay | null): demo is DemoOverlay {
  return demo !== null && (demo.rain.length > 0 || demo.quake !== null);
}
