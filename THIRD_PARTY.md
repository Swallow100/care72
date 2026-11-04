# 依存と素材の一覧

依存は MIT・Apache-2.0・OFL の物だけ。足したらここに書く。直接の依存（package.json に書いた物）と、取り込んだ素材を並べる。間接の依存の内訳は docs/PROGRESS.md に書く。

| 名前 | 用途 | ライセンス |
| --- | --- | --- |
| next | 画面とサーバーの枠（App Router） | MIT |
| react・react-dom | 画面 | MIT |
| @opennextjs/cloudflare | Next.js を Cloudflare Workers で動かす | MIT |
| wrangler | Workers の設定、手元の D1・R2 の模擬 | MIT OR Apache-2.0 |
| @cloudflare/workers-types | D1・R2 の型 | MIT OR Apache-2.0 |
| tailwindcss・@tailwindcss/postcss | 見た目 | MIT |
| postcss | CSS の処理 | MIT |
| typescript | 型 | Apache-2.0 |
| @types/node・@types/react・@types/react-dom | 型 | MIT |
| vitest | テスト | MIT |
| @anthropic-ai/sdk | Claude を呼ぶ（lib/claude） | Apache-2.0（1.0.0 から。前の版は MIT） |
| @google/genai | Gemini TTS で声を作る（lib/gemini。fetch だけで動く web の入口を使う） | Apache-2.0 |
| zod | Claude の返す JSON の形を書き、返った物を検査する | MIT |
| qrcode-generator | QR の頁の QR の点の並び（lib/qr/image.ts）。SVG はこちらで描く。間接の依存なし | MIT |
| fast-xml-parser（5.11.2） | 気象庁の防災情報 XML（Atom のフィードと電文）を読む（lib/jma/xml.ts。Workers には DOMParser が無いので。T72）。間接の依存は strnum・anynum・is-unsafe（2.0.2 に固定。2.0.3 は入れた日の前日に出た版なので package.json の overrides で 1 つ前に）・xml-naming・fast-xml-builder・@nodable/entities・path-expression-matcher で、全部 MIT | MIT |
| @heroicons/react | 操作のアイコン（components/ui/Icon.tsx。文字と並べて使う。訓練の 7 つの手は components/drill/icons.tsx） | MIT |
| pdfjs-dist（6.4.299） | 黒塗りの画面（T52）で、選んだ PDF の頭の 3 頁をブラウザの中で画像にする（lib/redact/browser.ts）。PDF を選んだときだけ読み込む。元の PDF はブラウザの外へ出さない。直接の依存は無く、任意の依存の @napi-rs/canvas（MIT。Node で描くための物で、ブラウザでは使わない）が手元に入る。内訳は docs/progress/t52.md | Apache-2.0 |
| puppeteer-core | 紙面の印刷の確かめ（手元の Chrome・Edge で印刷して PDF の頁数を数える。lib/forms/print-pages.test.ts、tools/print）。開発の道具で配信には入らない（devDependencies）。Chrome は同梱しない。間接の依存の内訳は docs/progress/t36.md | Apache-2.0 |
| @modelcontextprotocol/sdk | 手元の MCP サーバー（tools/mcp/care72-local）。開発の道具で配信には入らない（devDependencies）。間接の依存の内訳は docs/progress/t32.md | MIT |
| Inter（next/font/google で build のときに取り込む） | 画面の英数字の書体（日本語は端末の書体に任せ、配信に入れない。11/3 10:3x に M PLUS 2 から替えた。前の比較は docs/progress/t35.md） | OFL-1.1 |
| BIZ UDPGothic（同上） | 本人・家族のスマホと本人の 1 枚の書体、書類の紙面（印刷）の書体（components/forms/paper.css） | OFL-1.1 |
| BIZ UDPMincho（同上） | 書類の紙面で、元の様式が明朝の字（松山市の計画書の題・同意の問い・注など。T85。原本の游明朝・MS 明朝の置き換え） | OFL-1.1 |
| BIZ UDGothic（同上） | 書類の紙面で、松山市の計画書の本文（原本の書体のまま。かなが等幅） | OFL-1.1 |

## 画面で読み込む外の配信（リポジトリにも build にも入れない）

担当一覧の右の面の地図（T14）。ブラウザがタイルをその場で読み込み、地図の下に出典を出す。条件と確かめた日は docs/progress/t14.md。地図の道具は使わず、タイルを並べる計算は lib/map/geo.ts に自分で書いた（Leaflet は BSD-2-Clause、MapLibre GL は BSD-3-Clause で、上の決まりに入らない）。

| 名前 | 用途 | 条件 |
| --- | --- | --- |
| 地理院タイル（淡色地図） | 下の地図 | 国土地理院コンテンツ利用規約。ウェブでリアルタイムに読み込むときは出典の明示（「地理院タイル」と地理院タイル一覧のページへのリンク）で申請不要 |
| 重ねるハザードマップ（洪水浸水想定区域〔想定最大規模〕・土砂災害警戒区域・津波浸水想定） | 重ねる層 | ハザードマップポータルサイトのオープンデータ。出典「ハザードマップポータルサイト」と層ごとの作成者。土砂災害警戒区域は国土数値情報の利用規約と都道府県の条件 |
| 気象庁 防災情報XML（PULL 型のフィード extra.xml・eqvol.xml と電文） | 事業所の画面の警報・注意報と地震（T72）。ブラウザは読まず、Workers の cron が 5 分ごとに 1 か所で取って D1 に写す | 気象庁ホームページのコンテンツ利用規約（公共データ利用規約 第1.0版）。加工せず出典「気象庁ホームページ（https://www.jma.go.jp/bosai/warning/）、気象庁防災情報XML」。条件は docs/progress/jma-terms-20261104.md |
| 気象庁 降水ナウキャストのタイルと凡例の画像 | 本物の事業所の地図の雨雲（T72）。旗 JMA_NOWCAST が on のときだけ。タイルは Workers の route が取って 5 分写して配り、凡例の画像だけブラウザが読む | 同上。加工せず重ね、凡例も気象庁のまま、出典「雨雲：気象庁ホームページ（https://www.jma.go.jp/bosai/nowc/）／背景：地理院タイル」。bosai/ の仕様は非公開で予告なく変わりうる |

## 動画の編集の道具（video/。アプリの依存にも build にも配信にも入らない）

提出の 3 分動画を組む枠（T33）。`video/package.json` はこのフォルダだけの物で、ルートの依存とは別。**Remotion は MIT ではなく、上の決まり（MIT・Apache-2.0・OFL）の外**。使うかは作者の判断待ち（docs/progress/t33.md の問い 1）。使わないなら MIT の Motion Canvas で組み直せる。

| 名前 | 用途 | ライセンス |
| --- | --- | --- |
| remotion・@remotion/cli（4.0.539） | 動画の編集の枠、書き出し | Remotion License（個人・従業員 3 人以下の営利の団体・非営利の団体は無料。MIT ではない）。[LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) |
| react・react-dom | 動画の画面 | MIT |
| typescript | 型 | Apache-2.0 |
| @types/react | 型 | MIT |
| IBM Plex Sans JP・BIZ UDPGothic（書き出しのときに Google Fonts から読む） | 動画の字幕と図の書体 | OFL-1.1 |

間接の依存（`video/package-lock.json`、11/3 に数えた）は MIT 200・ISC 18・BSD 15・Apache-2.0 5・MPL-2.0 4（mediabunny）・Unlicense 2・0BSD・CC-BY-4.0（caniuse-lite）・Python-2.0（argparse）のほか、Remotion の部品（@remotion/bundler・renderer・studio ほか。Remotion License）と、書き出しに使う ffmpeg の入った @remotion/compositor（license の欄なし）。動画の素材（録画・声・音楽・生成画像）の出典とライセンスは docs/video/MATERIALS.md。
