---
name: care72-review
description: commit や PR の前に、変えたファイルに合う見直し役（.claude/agents の medical-reviewer・screen-checker・persona-tester）を選んで並べて走らせ、返った表を 1 つにまとめる。医療の文（ルールの表・講評・要約・Claude への指示）、画面、訓練のペルソナに触ったとき、「見直して」「commit の前に確かめて」と言われたときに使う。
argument-hint: "[見る範囲（既定は main との差分と、まだ commit していない変更）]"
---

# 見直し役を選んで走らせる

見る範囲: $ARGUMENTS（無ければ `git diff --name-only main...HEAD` と `git status --short` のファイル）

見直し役は 3 つで、モデルを目的で分けてある。医療の線は越えると戻せないので強いモデル、画面の決まりは数が多い照合なので中くらい、ペルソナの出力は 1 回の訓練で 120 あるので速いモデル。どれも読むだけの道具しか持たない（書く・git を打つのはこのセッション）。

## 1. 変えたファイルを見直し役に分ける

| 変えた物 | 見直し役 | モデル |
| --- | --- | --- |
| lib/triage の行と理由の言葉、lib/labels.ts、lib/claude の指示の文（system）、docs/TRIAGE.md、訓練の講評（docs/tasks/T22.md の物）、医療班の要約（docs/tasks/T07.md の物）、本人の 1 枚 | medical-reviewer | opus |
| app と components の .tsx、app/globals.css | screen-checker | sonnet |
| ペルソナの指示と schema（docs/tasks/T18.md の物）、訓練を回したあと | persona-tester | haiku |

1 つのファイルが 2 つに当たるなら両方（本人の画面の言葉は medical-reviewer と screen-checker）。どれにも当たらなければ「見直し役なし」とだけ返して終わる。

## 2. 走らせる

- 当たった見直し役を、1 つのメッセージで並べて呼ぶ（Agent の道具、subagent_type に見直し役の名前）。順に呼ばない
- 渡す物: 見る範囲のファイルの一覧と、何を変えたかの 1〜2 行。差分の本文は渡さず、見直し役が自分で読む
- persona-tester には訓練の id か、ペルソナの出力の JSON を渡す。手元の MCP（care72-local）が手元の D1 を読むので、`.wrangler` が無ければ先に `npm run db:reset`（--local だけ）
- 本物の Claude の API は呼ばない。見直し役は Claude Code の中で動き、作品の 1 日の上限（ai_calls）は減らない

## 3. まとめる

- 返った表を 1 つにする: | 見直し役 | 場所（ファイル:行） | 中身 | 直し案 |
- 直すかはこのセッションが決める。直したら、同じ見直し役をもう一度走らせて同じ行が出ないのを見る
- medical-reviewer が「人が決める所」として返した物（ルールの表の中身）は直さず、docs/DECISIONS.md の今日の「案」に書いて 作者に渡す
- persona-tester の「漏れ」は、仮名化の層（lib/pseudonym）かペルソナの指示の直しで止める。見直し役の表に値は出ない（MCP は何が漏れたかだけを返す）

## 確かめ方

- 見直し役ごとに表が返り、どの行にも場所（ファイル:行、または訓練の刻みと仮名）がある
- 直したあとの 2 回目で、直した行が出ない
- `npm test` と `npm run typecheck` が通る
