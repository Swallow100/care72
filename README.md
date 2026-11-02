# ケア72（Care72）

ケアマネが持っている利用者のことを、災害の最初の 72 時間に届ける。計画 → 訓練 → 発災時。

このリポジトリは Built with Claude: Japan 2026 の期間中（2026-11-02 12:30 JST 以降）に作った。設計はキックオフ前に文書で行い、docs/SPEC.md に写した。

この道具は診断・用量・医療助言をしない。安否の色と連絡の順位はコードに書いたルールの表（lib/triage）で出し、AI は決めない。利用者は全員架空。

ルールの表を人が読める形にした物: [docs/TRIAGE.md](docs/TRIAGE.md)（コードから作る。`npm run docs:triage`）。

## 触り方

ログイン（審査員の ID とパスワード）は提出書類に書く。

## 作るもの

- 計画: 台帳（本人・薬・病気・関係・行動・特記）から個別避難計画の様式を埋める
- 訓練: 利用者ごとのエージェントが 72 時間を早送りで動き、ケアマネの対応を採点する
- 発災時: 本人・家族の赤緑の 2 ボタンと録音、ケアマネの一覧の並び替え、医療班・行政への受け渡し

## 守り

- 鍵は .dev.vars（手元。.dev.vars.example は項目だけ）と Cloudflare の secret だけ。.env・.dev.vars は commit しない
- AI（Claude と Gemini TTS）の呼び出しは事業所ごとに 1 日の上限（既定 200 回）。超えたらその日は呼ばない
- 個人の情報は Claude に渡す前に仮名化する（lib/pseudonym）
- 本運用の条件: 事業所との委託契約、学習に使わない契約、電気通信事業法の確認

## 使った資料と方法

期間中に足す。使った物だけ書く。

- Claude Code: 設計（Fable）と実装（Opus のサブエージェント）の分担、作業ごとの brief、テスト先行、フックで守りを強制、Skill で手順を固定。数字と commit の hash は [docs/CLAUDE_CODE.md](docs/CLAUDE_CODE.md)

## 進み

docs/PROGRESS.md。期間中の判断は docs/DECISIONS.md。

## ライセンス

AGPL-3.0（LICENSE）。本運用で別の条件が要るときは作者に相談する。
