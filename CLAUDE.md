# ケア72（Care72）

ケアマネの手元の道具。個別避難計画の作成（台帳 → 松山市の様式）、72 時間の訓練、発災時の安否の整理。
Built with Claude: Japan 2026 の期間中（2026-11-02 12:30 〜 2026-11-08 20:00 JST）に作る。設計は docs/SPEC.md（キックオフ前に文書で行い、写した）。期間中の判断は docs/DECISIONS.md。

## 守ること

- 診断・用量・医療助言をしない。安否の色と連絡の順位は lib/triage のルールの表で出し、Claude は録音と自由文を「けが・動けない・水が来た・機器が止まった・不明」に分けるだけ。
- 根拠は出典の登録簿からだけ引く。登録簿に無い根拠を作らない。根拠は画面に出す。
- 最後に判断するのは人。Claude の出力には画面に「AI」の印を付け、ケアマネが直せる形にする。画面・README・動画に「診断」「判定」「病気がわかる」「重症」と書かない。赤は「至急」（連絡の順の言葉）で、本人の状態を言い切らない。
- 氏名・住所・電話はブラウザとサーバーだけで扱う。Claude には仮名（A さん）と役割名（支援者 1）で渡す。lib/pseudonym を必ず通す。
- 秘密を書かない。.env は commit しない。鍵は .dev.vars（手元、commit しない）と Cloudflare の secret（配信）だけ。審査員のログインは README にも動画にも出さない。
- 人のデータは全部架空。実在の人・事業所・同僚の名前を書かない。電話番号は 090-0000-00NN、町名は架空、番地なし。
- 役所・学会の PDF はリポジトリに入れずリンクする。欄の名前と順をコードに持つのはよい。引用は短く出典付き。
- 依存は MIT・Apache-2.0・OFL の物だけ。足したら THIRD_PARTY.md に書く。
- 期間外に作った物、他のプロジェクトのコードを持ち込まない。このリポジトリ（worktree）の外のフォルダを開かない。`C:\Users\choco\dev` の隣のフォルダは別のプロジェクトのコードと本物の鍵で、見るのも持ち込むのも禁止。
- 返事とコミットは日本語。コミットは小さく、履歴を書き換えない。push はする。配信は頼まれたときだけ。
- docs/SPEC.md は書き換えない（キックオフ前の文書）。直したい点と決めたことは docs/DECISIONS.md と docs/PROGRESS.md に。
- 次の物はフック（.claude/settings.json → tools/hooks/guard.mjs）でも止まる: 手元でない wrangler（login・whoami・deploy・d1 create・r2 bucket create・secret put・--remote ほか）と opennextjs-cloudflare deploy、.env・.dev.vars を読む・書く命令と Read・Write・Edit（.example は通す）、git push --force・rebase・pull --rebase・commit --amend・reset --hard、gh pr merge の rebase・squash。止める物を変えるときは、この行と tools/hooks/rules.ts の両方を直す。.ts・.tsx を書いたあとはフックが型の検査を流す。

## 動かし方

- `npm install`、`npm run db:reset`（手元の D1 に表と 10 人。--local だけ）、`npm run dev`（port 3072）、`npm test`、`npm run typecheck`。
- wrangler でネットに出る命令（login・whoami・deploy・d1 create・r2 bucket create・secret put）を打たない。手元は dev・types と、--local を付けた d1・r2・kv だけ。
- commit の末尾の Co-Authored-By は、Opus が書いたら `Claude Opus 5.5 <noreply@anthropic.com>`、Fable なら `Claude Fable 5.1 <noreply@anthropic.com>`。
- 作業の分け方と、2 つのセッションが同時に動くときの決まり（worktree・branch・PR）は docs/tasks/README.md。この checkout の main は設計をしている側の物で、別のアカウントは worktree で作業する。

## 作り

- Next.js + TypeScript + Tailwind、Cloudflare Workers（OpenNext）+ D1 + R2。OpenNext で 1 時間以上詰まれば Vite + React + Hono に切り替えてよい（理由を docs に書く）。
- 長い処理は 1 要求で回さない。ブラウザから刻んで呼ぶ。
- Claude: claude-opus-5-5（様式の読み取り、訓練の監督・採点）、claude-haiku-5-5（ペルソナ、録音の分類）、claude-sonnet-5-5（台帳の入力、要約）。
- 声は Gemini TTS と Web Speech。
- 人の区分は本人・家族・支援者・ケアマネ・医療班・行政。色は 緑 無事・赤 至急・黄 要確認・灰 未知。
- データの本体は「台帳」だが画面には出さず「本人のページ」と呼ぶ。「札」と書かず印・ラベル。

## 画面の決まり

- 区切りは枠線より地の色。地（薄い灰色）・面（白）・面の中、の 3 段。色の枠は選択・注意・危険だけ。選んだ印にテーマ色の薄い下地を敷かない。
- ボタン・見出し・状態は 2〜4 字の漢語（確認開始・未確認・受領）。「を・が・の」でつなぐ文にしない。
- 常設の説明文・長い注意書きを置かない。見出しに読点・句点を付けない。
- 使わない型: クリーム色の背景、見出しの斜体、01/02/03 の番号、等幅フォントのラベル、ピル型ボタン、details の既定の▼、ライトで真っ黒の塗りボタン、グラデーション・光る影、字間、文字の中の絵文字、カードの下の縁。
- 押したときの変化は灰色だけ。
- 本人と家族の画面だけ、大きな文字と赤緑の 2 ボタンとやさしい日本語。
- 書体は BIZ UDPGothic。ライトとダークの両方で確かめる。
- 意味色をしっかり使う。色は意味にだけ使い、飾りには使わない。状態の 4 色（緑 無事・赤 至急・黄 要確認・灰 未知）は CSS 変数で持ち、ライトとダークで値を変える。薄い下地は color-mix で作る。状態は色＋2 字の文字で示し、色だけの印にしない。同じ意味は画面のどこでも同じ色（一覧の行、人数の数字、本人のページの上、時計の残り、経過の行、地図のピン）。操作の色は 1 色、危険な操作は赤。面全体を塗らず、印・文字・数字・細い帯に色を置く。本人・家族の画面の赤緑のボタンだけは面で塗る。
- 簡素化しない。情報は多く出す（本人・家族のスマホの画面だけは逆で、大きく少なく）。台帳の項目は区分ごとに全部見せ、一覧は列を減らさない。大事な物（優先と理由、医療の印、時計の残り、緊急連絡先、災害の状態）は上に大きく、細かい物（既往症の一覧、住まいの構造、書類の履歴、設定）は小さく、区分の中の畳みや別のタブに。空の面や余白だけの枠を作らない。小さな字と密度で PC の 1 画面に収め、スクロールは区分の中で。
