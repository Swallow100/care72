# 作り方

ケア72 を Claude Code でどう作ったか。期間は Built with Claude: Japan 2026 の 11/2 12:30〜11/8 20:00（JST）。詳しい使い方と数え方は [docs/CLAUDE_CODE.md](CLAUDE_CODE.md)。数はこの文書を書いた時点の物（下の「数」）。

## 体制

- **設計と相談のセッション**（Claude Fable 5.1）: キックオフ前に書いた設計（リポジトリの外）をもとに、作業を 1 つずつの頼み文（[docs/tasks](tasks/)）に分け、作業者の問いに答え、決めた事を [docs/DECISIONS.md](DECISIONS.md) にテーマごとにまとめる。merge と配信の段取りもここ。
- **作業者のセッション**（Claude Opus 5.5）: 頼み文 1 つを受け取り、テスト → 中身 → 進みの記録（[docs/progress](progress/)）まで進める。同時に何本も並べて動かす。
- **人**: 決める事（ルールの表の中身、画面の方向、配信）と、鍵の要る操作（配信・本物の Claude での確かめ）を受け持つ。

## 1 作業 1 worktree

- 頼み文は「目的・読む物・作る物・終わりの形・触るファイル・問い」の形。知らないエージェントでも [docs/tasks/CONTEXT.md](tasks/CONTEXT.md) → [CLAUDE.md](../CLAUDE.md) → [docs/tasks/README.md](tasks/README.md) → 頼み文の順に読めば始められるように書く。
- 作業ごとに `git worktree add ../care72-tNN -b task/tNN` で別の checkout と branch を作り、その中で `npm ci` と手元の D1 を用意する。同じファイルを 2 つの作業で触らない。
- 終わったら統合の branch（integrate/t11-t12）を取り込んで衝突を解き、PR を出す。取り込みは設計の側が merge commit で行う。履歴は書き換えない（rebase・amend・force push をしない。例外は下の「公開の履歴」の 1 回）。
- 決めきれない所は止まらずに、CLAUDE.md と文書に合う側を選んで進め、進みの記録の「問い」に残す。設計の側が答え、決まった事を DECISIONS.md に書く。

## 別の目の点検

書いた本人の文脈を持たない目で見直す。

- **見直し役のサブエージェント**（[.claude/agents](../.claude/agents)。読むだけの道具しか持たない）: medical-reviewer（Opus。医療の線を越える言葉・AI の印の抜け）、screen-checker（Sonnet。画面の決まり）、persona-tester（Haiku。本人役の出力の形と仮名の漏れ）。Skill の care72-review が、変えたファイルに合う役を選んで並べて走らせ、表を 1 つにまとめる。
- **点検のセッション**: 審査員の手順を手元で全部通す点検（[qa](progress/qa-20261104.md)）、安全とプライバシー・正しさの読むだけの見直し（[review](progress/review-20261104.md)）、実際の事業所で使うときの穴の洗い出し（[real-use-audit](progress/real-use-audit-20261104.md)）。見つかった物は新しい頼み文にして作業者に渡した。

## ルールの表とテスト

- 安否の色と連絡の順は、人が読めるルールの表（lib/triage）が決める。Claude の分類は表に渡す印で、順を動かさない。表は [docs/TRIAGE.md](TRIAGE.md) にコードから書き出し（`npm run docs:triage`）、一致をテストで確かめる。出典の登録簿（lib/sources → [docs/SOURCES.md](SOURCES.md)）も同じ作り。
- テストを先に書き、落ちるのを見てから中身を書く。本物の API は呼ばず、偽の client で Claude の返事の形・仮名化・上限を確かめる。描く画面は HTML の文字列で、D1 は node:sqlite の写しで確かめる。
- Claude を呼ぶ入口は lib/claude/call.ts の 1 か所で、仮名化した物しか渡せないことを型と実行時の両方で確かめる。

## 守りの仕組み

- **フック**（.claude/settings.json → tools/hooks）: ネットに出る wrangler の命令、鍵のファイル（.env・.dev.vars）を読む・書く操作、履歴の書き換えを、Claude が打つ前に止めて理由を返す。.ts・.tsx を書いたあとは型の検査を流して誤りを返す。止める物と通す物の一覧はテストにしてある。
- **手元の MCP**（tools/mcp/care72-local）: 手元の D1 の種と訓練の記録を、仮名にしてから読むだけで返す。
- **配信の守り**（tools/deploy）: 配信は人が端末で打つ。当てた migration の書き換えを錠（docs/deploy/migrations.lock の SHA-256）で止め、表を作り直す前に本物の事業所のデータを数えてあれば止め、配信のあとに /api/health の commit とログインの壁を確かめる。

## 公開の履歴

公開の文書に個人に関わる情報が含まれていたため、11/4 20:27 に一度だけ履歴を書き換え、リポジトリを同じ名前で作り直した。変えたのは文書の中の個人のメモと引用、commit メッセージの中の名前、12 件の作者欄のメールで、commit の数・日時・順番・親と、コードの変化（差はコメントだけ）は元のまま。文書の中の commit の番号は、書き換えたあとの番号に置き換えた。作り直す前の PR（#1〜#114）の番号・題・branch・取り込んだ日時は [docs/PULL_REQUESTS.md](PULL_REQUESTS.md) に、GitHub が受け取った push の日時（931 件）は [docs/PUSHES.md](PUSHES.md) に残した。merge の commit メッセージの「PR #N」はこの一覧の番号。

## 数

| 物 | 数 |
| --- | --- |
| commit（初日 12:42 のリポジトリ作成から） | 1,068（merge commit 210） |
| commit を書いたモデル（Co-Authored-By） | Opus 5.5 850・Fable 5.1 94・Sonnet 5.5 5（初日の 8 件は Fable と書いてあるが Opus が書いた） |
| 取り込んだ PR | 97 |
| 頼み文（docs/tasks/TNN.md） | 74 |
| 進みの記録（docs/progress の md） | 88 |
| テスト | 2,543 件（155 ファイル。通過 2,542・skip 1。`npx vitest run`） |
| 見直し役・Skill・フック・MCP の道具 | 3・3・2・7 |

数え方: commit と Co-Authored-By は統合の branch（origin/integrate/t11-t12 の fb9a176）の `git log`、PR は作り直す前の GitHub の merged の数（[一覧](PULL_REQUESTS.md)）、テストは `npx vitest run --maxWorkers=4` の結果。公開のための片付けの commit は数に入れていない。
