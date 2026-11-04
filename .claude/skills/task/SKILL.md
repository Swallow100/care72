---
name: task
description: docs/tasks の作業（T00〜T31 の 1 つ）を始めてから取り込むまでの手順。main の先頭と作業中の行を見て重なりを避け、別のセッションなら worktree と branch で進め、小さく commit し、終わりの形を確かめ、docs/PROGRESS.md に書き、PR を merge commit で取り込む。「T05 をやって」「docs/tasks/T12.md を進めて」と言われたときに使う。
argument-hint: "[T番号（例 T05）]"
---

# docs/tasks の作業

作業: $ARGUMENTS（docs/tasks/$ARGUMENTS.md）

## 1. 始める前

- `git fetch origin` と `git log origin/main -1 --oneline` で main の先頭を見る。docs/PROGRESS.md の頭に同じ作業の「作業中」の行があれば始めない
- CLAUDE.md、docs/tasks/README.md、docs/tasks/$ARGUMENTS.md と、その「読む物」を読む。「前に要る物」が済んでいるかを docs/PROGRESS.md で見る
- 「触るファイル」が、ほかの作業中の物と重ならないかを見る。重なるなら順番にする

## 2. 場所

- 設計の側のセッション（元の checkout の main）は、そのまま main で進める
- 作業者のセッションは worktree で進める。番号は小文字（T05 → t05）:
  - `git worktree add ../care72-t05 -b task/t05 main`
  - その中で `npm install` と `npm run db:reset`（手元の D1 は worktree ごと。--local だけ）
- docs/PROGRESS.md の頭に「$ARGUMENTS 作業中（だれ、11/3 10:00〜）」の 1 行を commit して push する
- worktree の外を開かない（隣のフォルダはほかのプロジェクトで、持ち込まない）

## 3. 進め方

- テストを先に書き、落ちるのを見てから中身を書く。ルールの表に触るなら Skill の triage-rule の手順
- commit は日本語で小さく、`npm test` と `npm run typecheck` が通ってから。末尾は書いたモデルの Co-Authored-By（Opus なら `Claude Opus 5.5 <noreply@anthropic.com>`）。毎回 `git push origin HEAD`
- 履歴を書き換えない（rebase・amend・force push をしない）。直すときは新しい commit
- フックが命令を止めたら、理由を読んで別の道を取る。フックを外したり、止まらない書き方を探したりしない
- 鍵を探さない・置かない。本物の API は、その作業のファイルに書いてあるときだけ。wrangler は --local だけ
- Claude に渡す物は lib/pseudonym を通した仮名だけ

## 4. 終わりの形

- docs/tasks/$ARGUMENTS.md の「終わりの形」と、docs/tasks/README.md の「全部の作業に共通の終わりの形」を 1 つずつ確かめる
- `npm test` と `npm run typecheck` が通る
- 画面があれば `npm run dev`（port 3072）で開き、ライトとダークの両方で見て、サーバーを止める
- docs/PROGRESS.md の作業中の行を、「できた物・未確認・決めた所」の節に置き換える。作業のファイルと違えた所も書く
- 決めたことで仕様書と違う物は docs/DECISIONS.md に「案」として書く。docs/SPEC.md は書き換えない

## 5. 取り込み（worktree のとき）

- `git push origin HEAD`
- `gh pr create --fill`
- `gh pr merge --merge --delete-branch`（merge commit を残す。rebase・squash はしない）
- main の checkout に戻り、`git worktree remove ../care72-t05`

## 確かめ方

- `git log origin/main --oneline -5` に作業の commit（worktree なら merge commit も）がある
- docs/PROGRESS.md の頭に作業中の行が残っていない
- `git worktree list` に終えた作業の worktree が残っていない
