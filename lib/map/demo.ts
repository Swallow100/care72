// 雨雲・震度の「デモ」の表示（T14）。この絵と数字は気象庁の情報を使わない（本物の雨雲は T72 の旗の下で lib/jma/nowcast.ts が重ねる）。
// 災害の状態（T09 の災害の種類を lib/disaster/state.ts の DISASTER_SCENE で大雨か地震の場面に写した物と警戒レベル）か訓練の筋書き（docs/SPEC.md: 大雨は警戒レベル 3 → 4 → 浸水 3 m、
// 地震は南海トラフで震度 6 強・沿岸の津波・停電 2 日）から作った絵と数字で、画面には必ず「デモ」の印を付ける。
// 雨雲の絵は訓練だけ（T103 の決め (c)）: 筋書きの雨の表（lib/drill/rain.ts）から時刻で動く帯を作る（lib/map/drill-rain.ts）。
// 平時（担当一覧。デモ事業所も本物の事業所も）は作り物の雨を描かず、旗が on なら本物の雨雲を重ねる（off なら雨は出さない）。
// 本物の警報と見間違えないように、雨雲は気象庁の色の段（青・黄・赤・紫）を使わず、淡い青灰の面と短い雨の筋の 1 色で描き、
// 「警報」「注意報」「速報」の言葉を使わない。

import type { GeoPoint, HazardKind } from "../db/types.ts";
import type { RainTrack } from "../drill/rain.ts";
import { checkMark, sourceById, type CheckMark } from "../sources/index.ts";
import { drillRain, type RainBand } from "./drill-rain.ts";
import { seeded } from "./seeded.ts";

export type { RainBand } from "./drill-rain.ts";

/** 訓練の雨の元: 筋書きの雨の表、見ている時刻（発災からの時間。小数は分）、帯を置く真ん中（lib/map/drill-rain.ts の rainAnchor） */
export type DrillRainInput = { track: RainTrack; hour: number; anchor: GeoPoint };

/**
 * デモの場面。T09 の災害の状態（DISASTER_SCENE で写す。その他・平時は場面なしで、ここへ来ない）か訓練の筋書きから作る。
 * 大雨で警戒レベルを入れていない（null）ときは、名前を「大雨」だけにする。雨雲を描くのは訓練（drill がある）ときだけで、
 * 描く段は警戒レベルまで（RAIN_STRENGTHS。解除・無しの null は雨なし）
 */
export type DemoScene = { kind: "heavy_rain"; level: 3 | 4 | 5 | null; drill?: DrillRainInput } | { kind: "earthquake" };

/**
 * 雨雲の描き方（components/map/CaseMap.tsx の Rain）。淡い青灰の面に、細く短い雨の筋を斜めに不規則な間で置く。
 * 帯は入れ子（弱が広く猛が細い）なので、面は重なるほど濃くなり、筋は 3 つの帯の分が足される。強いほど筋を詰めて長く。
 * tile はくり返しの 1 枚の大きさ（px）、streaks はその中の筋の本数、length は筋の長さの幅（px）、fill は面の濃さ。
 * T66 は濃い墨の長い斜線を等間隔に並べた（雨雲に見えなかった）。T96 で面と短い筋に替えた。
 */
export const RAIN_STYLE: Record<
  RainBand["strength"],
  { tile: number; streaks: number; length: readonly [number, number]; width: number; fill: number }
> = {
  1: { tile: 46, streaks: 9, length: [4, 6], width: 1.1, fill: 0.26 },
  2: { tile: 42, streaks: 13, length: [5, 7], width: 1.2, fill: 0.22 },
  3: { tile: 38, streaks: 17, length: [6, 8.5], width: 1.3, fill: 0.22 },
};
/** 筋の傾き（縦から左へ、度）。風に流れる雨の向き */
export const RAIN_SLANT_DEG = 18;
/**
 * 雨雲の面の色（淡い青灰。oklch 0.72 0.05 245）と筋の色（oklch 0.50 0.10 252。黒を混ぜない、澄んだ青の明るさを下げた色）。
 * 気象庁の雨雲の色の段（水色・青・紺・黄・橙・赤・紫）と重ならない。下の地図（淡色地図）はダークの画面でも明るいままなので、
 * ライトとダークで同じ値（本文色や CSS 変数にしない）
 */
export const RAIN_FILL = "#8ba9c2";
export const RAIN_STREAK = "#35669a";

/** 雨の筋 1 本（タイルの中の px） */
export type RainStreak = { x1: number; y1: number; x2: number; y2: number };

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * タイル 1 枚の雨の筋（RAIN_STYLE の streaks 本）。タイルを升に分けて 1 升に 1 本、升の中の位置と長さを種からずらす
 * （間が不規則で、偏りも無い）。筋は上の端から左下へ落ちる向き。タイルの端をまたぐ筋は、反対の端にも同じ筋を写して
 * くり返しの境で切れないようにする（写しは 1 本に数えない: 戻り値は 1 本ごとの組）。強さごとに種を変える
 */
export function rainStreaks(strength: RainBand["strength"]): RainStreak[][] {
  const s = RAIN_STYLE[strength];
  const rand = seeded(9600 + strength * 131);
  const sin = Math.sin((RAIN_SLANT_DEG * Math.PI) / 180);
  const cos = Math.cos((RAIN_SLANT_DEG * Math.PI) / 180);
  const cols = Math.ceil(Math.sqrt(s.streaks));
  const rows = Math.ceil(s.streaks / cols);
  const cellW = s.tile / cols;
  const cellH = s.tile / rows;
  const out: RainStreak[][] = [];
  for (let i = 0; i < s.streaks; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const len = s.length[0] + rand() * (s.length[1] - s.length[0]);
    const x1 = (c + rand()) * cellW;
    const y1 = (r + rand()) * cellH;
    const x2 = x1 - len * sin;
    const y2 = y1 + len * cos;
    const shiftsX = x2 < 0 ? [0, s.tile] : [0];
    const shiftsY = y2 > s.tile ? [0, -s.tile] : [0];
    out.push(
      shiftsX.flatMap((ox) =>
        shiftsY.map((oy) => ({ x1: round1(x1 + ox), y1: round1(y1 + oy), x2: round1(x2 + ox), y2: round1(y2 + oy) })),
      ),
    );
  }
  return out;
}

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

/** 警戒レベルごとに描く段（レベル 3 は弱だけ、4 は強まで、5 は猛まで）。訓練の雨が被害状況の警戒レベルより強くならない */
export const RAIN_STRENGTHS: Record<3 | 4 | 5, RainBand["strength"][]> = { 3: [1], 4: [1, 2], 5: [1, 2, 3] };

export function demoOverlay(scene: DemoScene): DemoOverlay {
  if (scene.kind === "heavy_rain") {
    const d = scene.drill;
    const rain = d ? drillRain(d.track, d.hour, scene.level === null ? [] : RAIN_STRENGTHS[scene.level], d.anchor) : [];
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
