---
name: triage-rule
description: ルールの表（lib/triage。安否の色・理由の 1 行・同じ色の中の並び）に行・足す言葉・並びの鍵を足すか直すときの手順。テストを先に書き、lib/triage/index.ts を直し、npm run docs:triage で docs/TRIAGE.md をコードから作り直し、docs/DECISIONS.md に案として書く。安否の色（赤 至急・黄 要確認・灰 未知・緑 無事）や連絡の順を変えたいと言われたときに使う。
argument-hint: "[足したい行の中身]"
---

# ルールの表に行を足す

足したい物: $ARGUMENTS

ルールの表の中身は人が決める物。Claude が足した行は、作者が確かめて「確定」にするまで「案」で、本運用に使わない。Claude を表の中に入れない（録音と自由文の分類だけが Claude。色と順位は表で出す）。

## 先に読む

- CLAUDE.md の「守ること」: 診断・用量・医療助言をしない。赤は「至急」で本人の状態を言い切らない。「診断」「判定」「重症」「危険」を言葉に入れない（lib/labels.test.ts が見る）
- docs/TRIAGE.md: 今の表（コードから作った物。手で直さない）
- docs/DECISIONS.md の「色と連絡順」と読み方の決まり（「超えた」「過ぎた」はちょうどを含まない）
- lib/triage/index.ts の `RuleId`・`RULES`・`QUALIFIERS`・`ORDER`

## 手順

1. どこに足すかを決める
   - 色が変わる → `RULES` の行。上から順に当て、最初に当たった行で決まる。信号（赤・未知・緑）ごとの最後の行はいつも当たるので、その上に入れる
   - 色はそのままで理由に言葉を足す → `QUALIFIERS`（足す順は配列の順）
   - 同じ色の中の並び → `ORDER`
2. テストを先に書く（lib/triage/triage.test.ts）
   - `describe("案 N: …")` を足し、10 人の種（seed/people.ts）か、違いが 1 つだけの架空の人で、色・理由の 1 行・並びを確かめる。種の 10 人は仕様書の人なので変えない
   - 行を足すなら「表の行」の 2 つにも足す: `all`（`Record<RuleId, true>`。id の抜けは型で落ちる）と `cases`（表の「理由の例」が本当の出力と同じか）
   - `npx vitest run lib/triage` で、足したテストが落ちることを見る
   - 落ちるテストを `it.fails` にして commit する（「ルールの表のテストを先に書く: 案 N」）。npm test は通ったまま、テストが先にあったことが履歴に残る
3. lib/triage/index.ts を直す
   - `RuleId` の union に id とコメント（「→ 色（案 N）」）、`RULES` に `{ id, signal, input, color, example, origin: "案 N", match }`
   - 理由の 1 行は台帳の値と時計の事実だけ（「酸素 内蔵電池 2 時間を超過」）。推し量りの言葉（「動いている」）を入れない
   - `it.fails` を `it` に戻し、`npx vitest run lib/triage` が通る
4. 大雨の筋（lib/triage/heavy-rain.test.ts）を流す。10 人の色・並びが変わったら、変わった所を期待に書き、なぜ変わってよいかを commit の文に書く
5. `npm run docs:triage` で docs/TRIAGE.md を作り直す（作り直さないと doc.test.ts が落ちる）
6. docs/DECISIONS.md の「色と連絡順」に「案」として、番号・中身・理由（なぜその人が先か）を書く。docs/SPEC.md は書き換えない
7. `npm test` と `npm run typecheck` が通ってから commit する（「ルールの表に案 N」）。.ts を書くたびにフックが型の検査を流すので、誤りはその場で直す

## 確かめ方

- `git log --oneline -3` で、テストの commit が中身の commit より先にある
- `git diff HEAD~2 -- docs/TRIAGE.md` に足した行が 1 行だけ出る
- `npm test` が通る。足した行をわざと外すとテストが落ちる（外したら戻す）
- docs/DECISIONS.md「色と連絡順」の案の番号と、`RULES` の行の `origin` が同じ
