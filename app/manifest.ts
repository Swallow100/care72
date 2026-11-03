import type { MetadataRoute } from "next";

// ホーム画面に追加したときの名前・色・印（T44）。Next が /manifest.webmanifest として出し、<link rel="manifest"> を付ける。
// 色は globals.css のライトの地（--base）。既定はライトで OS の設定に従わないので、ダークの値は持たない。
// 印は app/icon.svg（72 時間の輪）と、同じ形を PNG に描いた 192・512（public/。tools/icons/render-icons.mjs で作る）。
export const MANIFEST_BACKGROUND = "#eceef1";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ケア72",
    short_name: "ケア72",
    description: "個別避難計画、72 時間の訓練、発災時の安否の整理",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: MANIFEST_BACKGROUND,
    background_color: MANIFEST_BACKGROUND,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
  };
}
