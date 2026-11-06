# 端末の録画の道具（S7 の R20〜R24）

本物の命令を疑似端末（ConPTY）で流し、出た文字を時刻つきで記録して（`term.cast`、asciicast v2）、
その記録をそのまま xterm.js に流して 1/30 秒ごとに撮る。出す物は `video/assets/rec/<番号>-<回>/` の
`00001.jpg …`（1920×1080・30fps）と `markers.json`（ほかの録画と同じ形。`npm run scan` で読み場へ写る）。

- 画面を描き直さない・文字を足さない。描くのは記録の文字だけ。待つだけの所は描くときに切る（record-lib.mjs の一時止めと同じ）
- 描くたびに、各コマの見えている文字にユーザー名の入った道（`C:\Users\…`）・ログインの名前・メールの形が無いかを見る。
  1 コマでもあれば連番を消して止まる（記録は残る。`--from`・`--cut` で避けて描き直す）
- 白地の端末（S7 は白地の段）。字は約 20pt（80×20 の升で 1920×1080 いっぱい。Claude Code は 84×22 で約 17pt）。日本語は升 2 つにそろえる
- プロンプトは `care72 $`（ユーザー名・フォルダの道を出さない）。git の道は `sed` で `dev/` までを落として出す
- 初めに `video/scripts/term` で `npm install`（node-pty と xterm。node_modules は commit しない）

| 道具 | すること |
| --- | --- |
| `shoot.mjs R20\|R24` | 端末だけの録画を撮って描く |
| `claude.mjs R21\|R22\|R23` | Claude Code に頼み文を打って記録する（`--render` で描く） |
| `rec.mjs <番号>` | 作者が自分で打つ間を記録して描く（asciinema の rec と同じ） |
| `render.mjs <cast> <フォルダ>` | 記録を描き直す（始まり・終わり・切る所を変える） |
| `text.mjs <cast>` | ある秒の画面の文字・印の一覧を出す（描く前に名前・道を見る） |

## 端末だけ（R20・R24）

```
node video/scripts/term/shoot.mjs R20     # worktree の一覧と origin/main の merge の線（30 秒ほど）
node video/scripts/term/shoot.mjs R24     # テストの終わりの件数（テストに 5 分ほど）
```

R24 の件数は編集の日に撮り直す（同じ命令）。vitest は 1 行目に `RUN v5 C:/Users/<名前>/dev/…` と道を出すので、
dot の報告（`--reporter=dot --silent`）で点を並べ、1 行目を画面の上へ流してから終わりの数を描く。**`@summary` より前は描かない**
（記録の term.cast にはこの 1 行が残っている）。`--maxWorkers=4` は、PC が混んでいると headless Chrome を閉じる後片付けが
時間切れになり「failed」が出たため（11/5、テストは全部通っていた）。

## Claude Code（R21〜R23）

```
node video/scripts/term/claude.mjs R22 --render   # フックが npx wrangler deploy を止める
node video/scripts/term/claude.mjs R23 --render   # MCP の check_leaks（漏れの数）
node video/scripts/term/claude.mjs R21 --render   # /care72-review で見直し役 3 つが並んで走る（数分）
```

- 開発に使っている claude（デスクトップのアプリが持つ版。`CLAUDE_EXE` で替えられる）を、care72-t43 で次の形で起こす:
  `--permission-mode dontAsk`（前もって許した物のほかは聞かずに断る。Bash・Edit・Write は許さない）、
  `--strict-mcp-config --mcp-config .mcp.json --allowedTools mcp__care72-local`（MCP は手元の care72-local だけ）、
  `--setting-sources project,local`（利用者の設定を読まない。プロジェクトのフックは読む）、環境 `IS_DEMO=1`
  （Claude Code の録画用の切り替え。組織名・メールを出さず、初回の設定の画面を飛ばし、ログイン済みの資格を使う）
- R22 の守りは 2 つ: プロジェクトの PreToolUse のフック（tools/hooks/guard.mjs）が止め、万一通っても dontAsk が断る。
  撮る前にフックへ見本の入力を渡して止まることを確かめた（`npx wrangler deploy`・`wrangler deploy`・PowerShell の形、どれも exit 2）
- 起動の枠に出るのは `Claude Code v2.1.317`・`Opus 5.5 · Claude Max`・`~\dev\care72-t43`（名前・ユーザー名・メールは出ない）。
  `/mcp` の画面は道（ユーザー名入り）を出すので開かない
- 色は Claude Code の既定（ダーク）のまま白地に描く（本文は黒、薄い字は灰、送った頼み文は濃い灰の帯に白い字。テーマは利用者全体の設定にしかないので変えない）
- 待つ文字（R22 は `Bash(npx wrangler deploy` と `止めた: wrangler deploy`、R23 は `check_leaks (MCP)`、R21 は見直し役の名前）が
  出ないまま答えが終わったとき、使える量の上限の知らせが出たとき、送ってから 90 秒なにも動かないとき、打つ前に窓が出ているときは、
  記録だけ残して止まる。記録は 1 件ずつ書き足すので、外から止めてもそこまでを text.mjs で見られる。30 秒ごとに画面の終わりを出す
- 試すときは `--dir <置き場の外> --max 120`（答えを待つ秒）。R21 は見直し役が数分走るので、走り出しの 10 秒と終わりの表の前から後ろだけを描く（`--cut`）
- 11/5 に R21・R22・R23 とも、頼み文が入力の欄に入って送られ、上限の知らせを拾って止まるところまで試した。撮影の起こし方で MCP は care72-local だけがつながる
- 11/5 は端末の claude の利用の上限の知らせで止まった（撮れていない）。11/6 7:15・7:19 は上限ではなく
  「Claude Code can't use your Claude subscription, usually because a payment is past due」で止まった（端末の claude の資格は古い Max 5x。
  待っても戻らない）。この知らせを拾ってすぐ止まる（claude.mjs の NO_PLAN）。端末の claude を今の契約でログインし直してから撮る

## 確かめる（撮ったら 1 本ずつ）

```
node video/scripts/sheet.mjs video/assets/rec/R20-1          # 12 コマの一覧（video/out/sheet/）
node video/scripts/term/text.mjs video/assets/rec/R20-1/term.cast --at @graph+1   # その秒の画面の文字
node video/scripts/term/text.mjs video/assets/rec/R20-1/term.cast --marks         # 印の一覧
```

## 描き直す（撮り直さずに始まりを変える）

```
node video/scripts/term/render.mjs video/assets/rec/R20-1/term.cast video/assets/rec/R20-1 --name R20 --from @graph-1.4 --to @end
```

秒は記録の始めからの秒か `@印±秒`。`--cut 始..終,…` で間を切る。S7 の `Cycle` は録画の頭から 2.3〜3 秒だけ使うので、
見せたい所を頭に置く。

## そのまま記録する（作者が打つ）

`rec.mjs` は作者の端末の中に固定の大きさの疑似端末を開き、打った物と出た物を記録して、終わったら同じ形で描く。
撮っている間に **F12**（か Ctrl+\）で印（1 つ目の印の 0.5 秒前から描く）。外の端末は中より大きくしておく（100×30 以上）。

```
node video/scripts/term/rec.mjs R22 --claude      # 中で claude（claude.mjs と同じ版・引数・IS_DEMO）。/exit で終わる
node video/scripts/term/rec.mjs R20               # 中で bash。exit で終わる
```
