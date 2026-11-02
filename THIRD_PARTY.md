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
| @modelcontextprotocol/sdk | 手元の MCP サーバー（tools/mcp/care72-local）。開発の道具で配信には入らない（devDependencies）。間接の依存の内訳は docs/progress/t32.md | MIT |
| BIZ UDPGothic（next/font/google で build のときに取り込む） | 書体 | OFL-1.1 |

## 画面で読み込む外の配信（リポジトリにも build にも入れない）

担当一覧の右の面の地図（T14）。ブラウザがタイルをその場で読み込み、地図の下に出典を出す。条件と確かめた日は docs/progress/t14.md。地図の道具は使わず、タイルを並べる計算は lib/map/geo.ts に自分で書いた（Leaflet は BSD-2-Clause、MapLibre GL は BSD-3-Clause で、上の決まりに入らない）。

| 名前 | 用途 | 条件 |
| --- | --- | --- |
| 地理院タイル（淡色地図） | 下の地図 | 国土地理院コンテンツ利用規約。ウェブでリアルタイムに読み込むときは出典の明示（「地理院タイル」と地理院タイル一覧のページへのリンク）で申請不要 |
| 重ねるハザードマップ（洪水浸水想定区域〔想定最大規模〕・土砂災害警戒区域・津波浸水想定） | 重ねる層 | ハザードマップポータルサイトのオープンデータ。出典「ハザードマップポータルサイト」と層ごとの作成者。土砂災害警戒区域は国土数値情報の利用規約と都道府県の条件 |
