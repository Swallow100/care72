// 色と置き場所。作者の指示（11/3 03:4x）で。
// 白地に濃い青の字と面、青地に白の字と面、の 2 つを場面で切り替える（場面ごとの地は timeline.ts の ground）。
// 澄んだ青 2 段と白だけ。強調に意味色の赤（至急）と緑（無事）だけを使う。
// 使わない物: グラデーション、光る影、黒を混ぜた濁った青、ピル型、字間、絵文字、斜体、番号のラベル、等幅のラベル。
// アプリの画面の録画はアプリの色のまま（編集で色を変えない）。

export const COLOR = {
  white: "#ffffff",
  blue: "#1453c8", // 濃い青。白地の字と面、青地の地
  blueLight: "#5a8ee8", // 1 段明るい青。白地の小さな字・線、青地の埋まっていない目盛り
  blueTint: "#e7effc", // 白に青を少し混ぜた面。白地の上の 2 段目の面・仮の面
  onBlueSub: "#cddcf7", // 青地の上の小さな字
  urgent: "#c0292b", // 赤 至急（アプリと同じ値）
  ok: "#1d7a45", // 緑 無事（アプリと同じ値）
} as const;

export type Ground = "white" | "blue";

/** 地ごとの色。fg = 字、sub = 小さな字、surface = 地の上に置く逆の色の面、onSurface = その面の字 */
export function palette(ground: Ground) {
  return ground === "blue"
    ? { bg: COLOR.blue, fg: COLOR.white, sub: COLOR.onBlueSub, surface: COLOR.white, onSurface: COLOR.blue, tint: COLOR.blueLight }
    : { bg: COLOR.white, fg: COLOR.blue, sub: COLOR.blueLight, surface: COLOR.blue, onSurface: COLOR.white, tint: COLOR.blueTint };
}

export const STATE_LABEL = { urgent: "至急", check: "要確認", unknown: "不明", ok: "無事" } as const;

export const FONT = {
  // アプリと同じ書体。本人・家族のスマホの文字を引用するときだけ UD
  main: '"IBM Plex Sans JP", "Yu Gothic UI", "Meiryo", sans-serif',
  ud: '"BIZ UDPGothic", "IBM Plex Sans JP", sans-serif',
} as const;

// 置き場所（1920×1080 の中の px）
export const LAYOUT = {
  // 録画の枠。下に字幕の帯を置くので、少し縮めて上に寄せる
  footage: { left: 120, top: 36, width: 1680, height: 945 },
  // 字幕の帯
  subtitle: { bottom: 18, maxWidth: 1600 },
  // 上の細い 72 時間の線（G4）
  topLine: { top: 14, height: 6 },
} as const;
