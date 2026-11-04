// 色と置き場所。作者の指示（11/3 03:4x）で。
// 青地に白の字と面（話の段）、薄い青の地に白い面と青の字（道具の段）の 2 つを場面で切り替える（場面ごとの地は timeline.ts の ground）。
// 澄んだ青 2 段と白だけ。強調に意味色の赤（至急）と緑（無事）だけを使う。
// 区切りは線より地の色の段（地 → 面）で付ける。線を使うのは録画の上の囲みだけ。
// 使わない物: グラデーション、光る影、黒を混ぜた濁った青、ピル型、字間、絵文字、斜体、番号のラベル、等幅のラベル、跳ねる動き。
// アプリの画面の録画はアプリの色のまま（編集で色を変えない）。

export const COLOR = {
  white: "#ffffff",
  blue: "#1453c8", // 濃い青。白地の字と面、青地の地
  blueLight: "#5a8ee8", // 1 段明るい青。白地の小さな字・線、青地の埋まっていない目盛り
  blueTint: "#e7effc", // 白に青を少し混ぜた面。道具の段の地
  blueMid: "#2a63d1", // 青地の上の 1 段明るい面（青地の中の面）
  onBlueSub: "#cddcf7", // 青地の上の小さな字
  urgent: "#c0292b", // 赤 至急（アプリと同じ値）
  ok: "#1d7a45", // 緑 無事（アプリと同じ値）
} as const;

export type Ground = "white" | "blue";

/**
 * 地ごとの色。bg = 地、fg = 字、sub = 小さな字、surface = 地の上に置く面、onSurface = その面の字、
 * strong = 面の中で目立たせる面（青地では白、薄い青の地では青）、onStrong = その字、tint = 埋まっていない目盛り・薄い線
 */
export function palette(ground: Ground) {
  return ground === "blue"
    ? {
        bg: COLOR.blue,
        fg: COLOR.white,
        sub: COLOR.onBlueSub,
        surface: COLOR.blueMid,
        onSurface: COLOR.white,
        strong: COLOR.white,
        onStrong: COLOR.blue,
        tint: COLOR.blueLight,
      }
    : {
        bg: COLOR.blueTint,
        fg: COLOR.blue,
        sub: COLOR.blueLight,
        surface: COLOR.white,
        onSurface: COLOR.blue,
        strong: COLOR.blue,
        onStrong: COLOR.white,
        tint: "#c7d8f5",
      };
}

export const STATE_LABEL = { urgent: "至急", check: "要確認", unknown: "不明", ok: "無事" } as const;

export const FONT = {
  // アプリと同じ書体: 英数字は Inter、日本語は端末の書体（11/3 10:3x 作者。Web の日本語書体は使わない）。
  // 書き出す端末（Windows）では Yu Gothic UI。本人・家族のスマホの文字を引用するときだけ UD
  main: '"Inter", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif',
  ud: '"BIZ UDPGothic", "Inter", "Yu Gothic UI", sans-serif',
  // 手書きのメモの図（G3）だけ。Windows の教科書体（端末の書体なので読み込まない）
  hand: '"UD Digi Kyokasho N-R", "UD デジタル 教科書体 N-R", "Yu Gothic UI", sans-serif',
} as const;

/** 字の大きさの段。部品はこの 6 つだけを使う（場面ごとにばらばらの大きさにしない） */
export const TYPE = {
  display: 176, // 題名・大きな数字
  hero: 96, // 文字だけの画面の 1 行目
  h1: 64, // 文字だけの画面の 2 行目・数字の単位
  h2: 44, // 面の見出し
  body: 34, // 表の行・図の中の字
  caption: 22, // 出典・「利用者は架空」・目盛り
} as const;

// 置き場所（1920×1080 の中の px）。上から 見出しの帯 → 舞台 → 字幕の帯。舞台の物は全部、舞台の中で真ん中にそろえる
export const LAYOUT = {
  /** 上の見出しの帯（道具の段だけ。段の名前・72 時間の線・利用者は架空） */
  header: { top: 22, height: 40, left: 120, right: 120 },
  /** 舞台。録画・図・文字はこの箱の中に置く */
  stage: { left: 120, top: 84, width: 1680, height: 840 },
  /** 字幕の帯。舞台の下 */
  subtitle: { top: 936, height: 128, maxWidth: 1560 },
  /** 録画の窓の上の帯の高さ */
  windowBar: 40,
} as const;

export const STAGE_CENTER_Y = LAYOUT.stage.top + LAYOUT.stage.height / 2;
