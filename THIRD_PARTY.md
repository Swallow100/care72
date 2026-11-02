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
| BIZ UDPGothic（next/font/google で build のときに取り込む） | 書体 | OFL-1.1 |
