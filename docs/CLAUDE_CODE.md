# Claude Code の使い方

この作品は Claude Code を開発の中心に置いて作っている。人（作者）は決めることを受け持ち、コードと文書の行は Claude Code が書く。ここに書くことは、すべて commit の hash とリポジトリの中の物で裏が取れる物だけにした。使っていない物は「使っていない」と書く。

数えた時点: 「何が可能になったか」の数字は `36f82bd`（11/3 18:14、origin/integrate/t11-t12 の先頭）で数えた物（T28）で、そのあとも作業が続いている。**数え直し**: 提出の前に作者が同じ数え方（一番下）でもう一度数える。ほかの節は書いた時点の物で、最初は `b28fbb7`（11/2 15:19）、11/4 朝に今の中身へ合わせた（T75、本番は `686f2e7`）。「3 軸」の節とサブエージェント・MCP の節は T32（branch task/t32）で足した。

## Claude の使い方の 3 軸

作品の側で、Claude の使い方を 3 つに分けて整理した（作品の中で使う・開発の中心に置く・用途ごとに使い分ける）。それぞれに「これ」と指せる物を並べた。1 行目が芯、その下が裏（ファイルと commit）。

### 軸 1 Claude を作品の中で使う

- **10 体の Haiku が別々の人生を演じ、Opus が監督する訓練**（docs/tasks/T18.md・T19.md・T22.md、本番に入っている）: 利用者 1 人に Haiku 1 体。台帳の仮名（本番の Claude に渡すのと同じ形）から本人役・家族役を演じ、言葉は毎回違うが形は同じ JSON で返す。Opus は世界の状態（停電・道路・電話）と出来事の差し込みを持ち、終わったら連絡の順と抜けを講評する。ケアマネは本番と同じ画面で手を打ち、訓練の信号も本番と同じルールの表で色が付く。机上訓練の相手役を、10 人それぞれ別の台帳から作る。裏は用途ごとのモデルの表（lib/claude/models.ts の PURPOSES、`9ddd957`）と訓練の表（migrations/0001_init.sql の drills・drill_events）。出力を確かめる道具は先に作った（下の persona-tester と MCP、`b7fb97f`・`8400fe0`）。デモでない事業所でも回るように、想定の表の行を台帳の条件（機器・時計・ハザード・独居・スマホなし）で事業所の人に配り直す（T70、`0d1a29a`）
- **型で縛った仮名化の門**: Claude に渡せる物は lib/pseudonym の関数だけが作れる印付きの型 `ForClaude<T>`（unique symbol）で、Claude を呼ぶ所 1 か所（lib/claude/call.ts の askJson）は型でも実行時（作った物の WeakSet と assertClaudeInput）でも印の無い物を断る。作った物は凍結し、元の氏名・電話が残っていれば PseudonymLeakError で止める。人が付ける欄（本人の報告を当てにしない印など）は渡す形に持たないので、Claude が推し量って付ける道が無い。`d870751`（仮名化の層）・`2dff8ce`（askJson）、テストは lib/pseudonym/pseudonym.test.ts と lib/claude/call.test.ts の「仮名化の層を通っていない物は、型で通らず、実行しても止まる」。11/4 に、台帳に無い敬称つきの名前・番地までの住所・郵便番号・メールも形で伏せるようにした（lib/pseudonym/forms.ts、`2cbf29a`）。Claude の返事に作った名前・住所の形があれば、文を捨てずに（氏名）（住所）に置き換える（T74 の続き、`793ef11`）
- **本名を見ないまま漏れを数える**: 手元の MCP（下）の check_leaks と drill_events は、サーバーの中で元の氏名・電話・町名と照らし、Claude には「A さんの電話」のような何が漏れたかだけを返す。persona-tester（Haiku）は本名を一度も見ずに、120 の出力の漏れを数えられる。開発の道具も作品と同じ門を通る。`8400fe0`
- **ルールの表と、Claude は分類と写しとまとめだけ（HITL）**: 発災時の色と連絡の順位は人が読めてテストできる表で出し、Claude は録音と自由文を 6 つ（けが・動けない・水が来た・機器が止まった・その他・不明）に分け、本人の言葉を聞き取りの欄に写し、録音を言い換えでまとめるだけ（下の「モデルの使い分け」）。まとめは本人の元の言葉と必ず並べ、ルールの表はまとめを読まない（テストで縛った。T69b、`da6fe72`）。電話で聞いた安否も、ケアマネの入力として同じ表に入る（T58、`6e9625b`）。強いモデルを使わない所を決めたこと自体が設計。`8d991be`（テストが先）→ `6984964`（中身）、大雨の筋の受け入れ `45dd9e1`
- **Opus の文書の目で様式を読む**（docs/tasks/T08.md）: 市町村ごとに違う個別避難計画の様式の写真・PDF から、欄の対応表を作って台帳を差し込む。様式ごとにコードを書かない。裏は PURPOSES の form_read（Opus、effort high、`9ddd957`）。写真は送る前に端末で縮める（T68、`00dcb00`）

### 軸 2 Claude Code を開発の中心に

- **人は決めるだけ、行は Claude Code**: 人が書いた commit の行は 0、期間の始まりから 38 分で最初のコード（上の表と下の「何が可能になったか」）
- **文書をコードから作り、テストで一致を守る**: docs/TRIAGE.md はルールの表のコードから作る（`0118f20`）。設定どうしの一致もテストにした: CLAUDE.md のフックの行と tools/hooks/rules.ts、Skill の表の見直し役とモデルと .claude/agents、.claude/agents が書く MCP の道具の名前と tools/mcp/care72-local/tools.ts、この文書に書いた commit の hash がどれも履歴に本当にあるか（どれも tools/claude-code.test.ts、`b7fb97f`・`ad037e2`・`fbe0a8a`）
- **フックで守りを強制**: ネットに出る wrangler・鍵のファイル・履歴の書き換えを、Claude が決める前に Claude Code が止める（下の節、`241a8a0`・`58bef77`）
- **Skill で手順を固定**: ルールの表の足し方、作業の始め方、見直し役の選び方（下の節、`b28fbb7`・`fbe0a8a`）
- **1 作業ずつの brief と、2 つのアカウントの並行**: docs/tasks（`78f2bb7`）、worktree と branch と PR（docs/tasks/README.md）。この T32 も worktree の branch task/t32 で、進みは docs/progress/t32.md に分けた（main と同じファイルを触らない）
- **洗い出しから、並列の波で幅を足す**（11/3 夜〜11/4 朝）: 選べる物の少なさを設計の側が洗い出し、台帳・担当一覧・訓練・事業所の 4 本を同時に出した（T57〜T60、`6137bfe`・`6e9625b`・`d950f63`・`4351b26`）。続けてアカウント・書き出し・撤回・細かい物とアンケートの 5 本（T61〜T65）。実際の事業所で使うときの穴は、まず読むだけの監査で「本物の事業所が 1 日目に使ったら」とコードを追い（docs/progress/real-use-audit-20261104.md、`da1428e`）、地域・本人と家族の入口・訓練・オフライン・気象庁・運用・同意の作業に分けた（T68〜T74、`00dcb00`〜`686f2e7`）。作業の間で触るファイルと migration の番号を先に分け、取り込みのたびに配信した。線に関わる判断は作業者が決めきらず「案」として残し、作者が確かめてから入れた
- **配信を壊さない守り**: 番号を足すだけの migration と、入った番号のファイルの中身を固定する錠（docs/deploy/migrations.lock、`4ee9ade`）。配信の既定は表を落とさず migration だけ当てる形にし、作り直しはデモ以外のデータがあれば止まる（T73、`216138d`）

### 軸 3 用途ごとの使い分け

- **モデル**: 作品の中は 様式・監督・採点・世界の部屋 = Opus、台帳の入力 = Sonnet、ペルソナ・分類・録音のまとめ = Haiku。effort は分類（low）のほか high。開発の中は 設計 = Fable、実装 = Opus、見直し役は医療 = Opus・画面 = Sonnet・ペルソナ = Haiku（下の「モデルの使い分け」）
- **機能**: 必ず守る物はフック、決まった手順は Skill、別の目と少ない道具はサブエージェント、Claude に見えないデータは MCP、目安は CLAUDE.md（下の「サブエージェントと MCP の使い分け」）

## 何が可能になったか

**数え直し**: この節の数は `36f82bd`（11/3 18:14。期間の始まり 11/2 12:30 から約 30 時間）で数えた物。そのあと T55〜T74 が入ったので、提出の前に作者が下の「数え方」で数え直し、表を差し替える。

| 数字 | 値 | 裏 |
| --- | --- | --- |
| 期間の始まり → 最初のコードの commit | 12:30 → 13:08 | `341a56e`（骨組み） |
| commit の数 | 609。merge 94 を含み、merge を除くと 515 | `git rev-list --count 36f82bd`、`--merges`、`--no-merges` |
| merge でない 515 の書き手（Co-Authored-By の字） | Opus 5.5 422・Fable 5.1 87・Sonnet 5.5 5・無し 1 | `git log --no-merges --format=%(trailers)` |
| 人が書いた commit の行 | 0。Co-Authored-By の無い merge でない commit は、GitHub がリポジトリを作ったときの .gitignore と LICENSE の雛形 `8a0cb78`（170 行）だけ。merge 94 の差分（衝突を解いた所）は数えに入れていない。うち 11 件は人（作者のアカウント）が GitHub の画面で押した PR の merge で、`git diff-tree --cc` で見るとどちらかの親の行を選んだだけで、新しく書いた行は無い | `git log --numstat`、`git diff-tree --cc` |
| テストの数 | 1,598（87 ファイル）。T00 の終わり `6e8ca41` で 139、11/2 15:19 `b28fbb7` で 326 | `npm test` |
| PR | 44。全部 merge commit（親 2 つ）で取り込み（integrate/t11-t12 宛 31・main 宛 13）。rebase・squash は 0 | `gh pr list --state all --json mergeCommit` と `git rev-list --parents` |
| 作業の brief | 53 ファイル（docs/tasks の T00〜T54。T36・T39 はファイルなし、T39 は取り下げ）。1 つ 1〜3 時間で、別のアカウントにもそのまま渡せる形 | docs/tasks |
| 配信 | 数えた時点の本番 https://care72.app は `d90de01`（11/3 18:1x）。11/4 05:2x は `686f2e7` | docs/HANDOFF.md、/api/health の commit |

11/2 の午後に進んだ物（commit の時刻）: 設計の文書を写す 12:46 → Next.js と OpenNext の骨組み 13:08 → D1 の表 13:11 → 架空の 10 人 13:15 → 仮名化 13:19 → ルールの表のテスト 13:22 → 中身 13:24 → 担当一覧 13:27 → 案 1〜6・9 と大雨の筋の受け入れのテスト 14:02〜14:19 → 作業の分け方 docs/tasks 14:20 → T00（Claude と Gemini を呼ぶ層）14:30〜14:53 → T31（この文書とフック・Skill）15:15〜。

足した行（`git log --no-merges --numstat` の足した行。削った行は引かない。package-lock.json を除く）:

| | Opus 5.5 | Fable 5.1 | Sonnet 5.5 | 人 |
| --- | ---: | ---: | ---: | ---: |
| コード（.ts・.tsx・.mjs・.js・.sql・.json・.jsonc・.css、テストを除く） | 70,172 | 299 | 821 | 0 |
| テスト（.test.ts・.test.tsx） | 25,750 | 18 | 531 | 0 |
| 文書（.md。仕様書の写し docs/SPEC.md も Fable に入る） | 7,005 | 3,115 | 218 | 0 |
| その他（.html・.ps1・.sh など） | 252 | 732 | 175 | 0 |

誰が書いたかは commit の末尾の Co-Authored-By で分けた。11/2 13:08〜13:30 の 8 件（`341a56e`〜`f49f334`、コード 3,074・テスト 574・文書 98・その他 4 行）は「Fable 5.1」と書いてあるが Opus 5.5 が書いた（履歴は書き換えない）ので、Opus に数えた。人の列の 0 は、GitHub の雛形 `8a0cb78` を除いた数。

## 分担: 設計は Fable、実装は Opus のサブエージェント

- **設計の側**（Claude Fable 5.1、main のセッション）: キックオフ前の設計の文書を docs/SPEC.md に写し（`cc9e8f9`）、期間中の判断の案を docs/DECISIONS.md に書き（`60d826c`）、作業を 1 つずつの brief に分けた（`78f2bb7` の T00〜T30、`7b9d14c` の T31）。brief は「目的・読む物・作る物・終わりの形・触るファイル・守ること」の形で、それだけ読めば始められる
- **実装の側**（Claude Opus 5.5 のサブエージェント。effort は xhigh。effort は git に残らないので、ここは作者の設定の記録）: brief 1 つを受け取り、テスト → 中身 → docs/PROGRESS.md の「できた物・未確認・決めた所」まで進める。brief と違えた所は PROGRESS に書き、Fable と作者が見る（例: T00 の「T00 と違えた所」）
- **人**（作者）: 案を見て「確定」にする

## 進め方の型

- **テストを先に**: ルールの表はテストだけの commit が先（`8d991be` 13:22）で、中身があと（`6984964` 13:24）。10 人を大雨の筋に流す受け入れのテスト（`45dd9e1`）を、案をわざと外すと落ちることまで確かめた
- **文書をコードから作る**: docs/TRIAGE.md はルールの表のコードから作り（`0118f20`、`npm run docs:triage`）、違えば `npm test` が落ちる（lib/triage/doc.test.ts）。人が読む表とコードが食い違わない
- **CLAUDE.md に決まり**: 守ること（医療の助言をしない・仮名で渡す・鍵の置き場・隣のフォルダを開かない）、動かし方、画面の決まり。どのセッションも最初にこれを読む
- **Claude Code の Skill を開発で使った**: 組み込みの claude-api を T00 で読み、モデル名・構造化出力・断られたときの回し先を推測でなく確かめた（lib/claude/models.ts と lib/claude/call.ts の頭の注）
- **2 つのアカウントの並行**: 決まりは docs/tasks/README.md（別のアカウントは worktree と branch、PR を merge commit で取り込む、同じファイルを 2 つの作業で触らない）。11/2 15:19 の時点では merge commit は 0 件だったが、`36f82bd` までに PR 44・merge commit 94（PR の取り込みと、branch に integrate/t11-t12 を取り込んで衝突を解いた物）

## フックで守りを強制する

CLAUDE.md に書くだけでは、急いだセッションが破ることがある。`wrangler deploy` は 1 回打つだけで、ログインしているアカウントにネットの資源ができる。そこで決まりの一部をフックにした（`241a8a0`・`58bef77`。.claude/settings.json → tools/hooks）。

| いつ | 何をする | なぜ |
| --- | --- | --- |
| Bash・PowerShell の前 | 手元でない wrangler（login・whoami・deploy・d1 create・r2 bucket create・secret put・--remote ほか）と opennextjs-cloudflare deploy を止める。--local の d1 と dev・types は通す | 作業のセッションからネットの資源を作らない。配信は T27 だけ |
| Bash・PowerShell・Read・Write・Edit・Grep の前 | .env・.dev.vars を読む・書くのを止める。.example は通す | 鍵を Claude の文脈に入れない。鍵は人が手で入れる |
| Bash・PowerShell の前 | git push --force・rebase・pull --rebase・commit --amend・reset --hard、gh pr merge の rebase・squash を止める | 履歴を書き換えない。commit の時刻が期間中に作った裏になる |
| Write・Edit の後（.ts・.tsx） | `tsc --noEmit` を流し、誤りを Claude に返す | 型の誤りをその場で直す。測って 8〜9 秒 |

- 止めるときは理由を日本語で返す（例「止めた: wrangler deploy。wrangler でネットに出る命令は打たない…」）。Claude はそれを読んで別の道を取る
- 命令の文字列は、引用符・ヒアドキュメント・`$( )`・`bash -c`・`npm run` の中身（package.json）まで分けて見る。commit の文に「wrangler deploy」と書いても止まらない
- 止める物・通す物の一覧はテストにした（tools/hooks/rules.test.ts。script を node で動かし、終わりの番号 2 と理由まで見る）。CLAUDE.md のフックの行と rules.ts の一覧が食い違うと tools/claude-code.test.ts が落ちる
- 届かない所: フックが見るのは Claude が打とうとした文字列だけで、script のファイルの中身（node x.mjs の x.mjs）や `grep -r` が拾うファイルは見ない。node が起動できないと止められない（失敗したら止める `onFailure` は Claude Code 2.1.295 から。作ったときの CLI は 2.1.202 なので使っていない）。前のフックは 1 回 0.35 秒ほど（node の起動が 0.2 秒）
- フックは `58bef77` から、care72 で開いたセッションで効く作り。T31 を作ったセッションは care72 の外で始まっていたのでフックが読み込まれず、settings.json の command を同じ形で動かして確かめた（Claude Code の中で止まるのは、次に care72 で開いたセッションで見る）

## Skill で手順を固定する

`.claude/skills` の 3 つ（`b28fbb7` の 2 つと、T32 の `fbe0a8a`）。公式の文書の置き場所と書き方なので、Claude Code は `/triage-rule`・`/task`・`/care72-review` として出し、説明に合う頼みなら自分で読む（一覧に出るのは、次に care72 で開いたセッションの `/skills` で見る）。

- **triage-rule**: ルールの表に行を足す手順。テストを先に（落ちるのを見て `it.fails` で commit）→ lib/triage/index.ts → 大雨の筋 → `npm run docs:triage` → docs/DECISIONS.md に案。表の中身は人が決める物なので、案のまま本運用に使わない
- **task**: docs/tasks の作業を始めてから取り込むまで。main の先頭と作業中の行、worktree と branch、終わりの形、PR を merge commit で
- **care72-review**（T32）: commit の前に、変えたファイルに合う見直し役（下のサブエージェント）を選び、1 つのメッセージで並べて走らせ、返った表を 1 つにまとめる。医療の文 → medical-reviewer、画面 → screen-checker、ペルソナ → persona-tester。医療の見直しで「人が決める所」と返った物は直さず docs/DECISIONS.md の案に回す
- 書き方は Claude Code の公式の文書（hooks・skills）で確かめた。SKILL.md の頭の項目と、中に書いたファイル・npm run の名前が本当にあるかはテストで見る（tools/claude-code.test.ts）

## サブエージェントと MCP の使い分け

この作品で「サブエージェント」は 2 種類ある。混ぜないように分けて書く。

- **実装役のサブエージェント**: 設計の側（Fable）が Agent の道具に docs/tasks の brief を 1 つ渡して起こす Opus。書く・テストする・commit する。定義のファイルは無く、brief が中身（上の「分担」）
- **リポジトリの見直し役**（.claude/agents、T32 の `b7fb97f`）: 定義をリポジトリに置いた 3 つ。どれも読むだけの道具（Read・Grep・Glob と、persona-tester は手元の MCP）しか持たず、書かない。書いた本人の文脈を持たない別の目として、表だけを返す

| 見直し役 | モデル | 見る物 | 返す物 | なぜこのモデル |
| --- | --- | --- | --- | --- |
| medical-reviewer | opus | ルールの表の理由の言葉、画面の言葉、Claude への指示の文、講評・要約（T22・T07 ができたら） | 場所・文・種類（病名の言い切り・薬の量・助言・出典なし・色を AI が決める・AI の印なし・書かない言葉）・直し案・確かさ、と「人が決める所」 | 医療の線は越えると戻せない。言い換えの判断が要る |
| screen-checker | sonnet | app と components の .tsx、app/globals.css | 場所・決まりの番号（CLAUDE.md の画面の決まりと状態の 4 色を 12 に分けた物）・今・直し案、と目で見てほしい画面 | 決まりの数が多い照合。速さと質の釣り合い |
| persona-tester | haiku | 訓練の出来事（MCP の drill_events）か、ペルソナの出力の JSON | 刻み・仮名ごとに 形・漏れ・色や病名を言い切る言葉・台帳との食い違い | 1 回の訓練で 10 人 × 12 刻み = 120 の出力。同じ確かめを速く数多く |

**MCP**（tools/mcp/care72-local、`8400fe0`・`ad037e2`）: 手元の D1（`npm run db:reset` が作る SQLite）の種と訓練記録を、Claude Code から読むだけのサーバー。stdio、.mcp.json に登録、.claude/settings.json の enabledMcpjsonServers で許可。道具は 7 つ:

| 道具 | 返す物 |
| --- | --- |
| people | 本人の一覧（仮名、年齢・世帯・要介護度・スマホ・機器・時計・連絡先の役割名） |
| person | 1 人の台帳を、ペルソナに渡るのと同じ仮名の形で |
| drills・drill | 訓練記録の一覧と、1 つの世界の状態・採点・仮名ごとの出来事の数と最初の時刻（採点の確かめ） |
| drill_events | 出来事を seq の順に。payload は仮名に置き換え、置き換える前の漏れは leaks に「何が」だけ |
| check_leaks | 渡した文に元の氏名・電話・町名が入っていないか。何が漏れたかだけを返す |
| ai_usage | ai_calls を日・用途・モデルごとに数える（本文の無い表） |

- 人のデータは lib/pseudonym を通してから返す。MCP の返事も Claude に渡る物なので、作品の中と同じ決まり（CLAUDE.md「守ること」）。元に戻す鍵はサーバーの処理の中だけに置く
- 読むだけ: node:sqlite で読むだけで開く（書く文は SQLite が断る）。ネットに出ない、鍵を読まない（.mcp.json に env も URL も無いことをテストで見る）
- テスト（tools/mcp/care72-local/care72-local.test.ts）: 種を入れた D1 の写しを一時フォルダに作り、読む関数と、子の処理として起こしたサーバー（SDK の stdio の client）を呼ぶ。種の氏名・電話・町名が 1 つも返らないことを、種の値と照らして見る。payload の置き換えを外すと落ちることも確かめた
- Cloudflare の MCP は使わない（配信は T27 だけ）。手元のデータに要るのは 1 つの小さなサーバーで、外のサービスにつなぐ物は足していない

**使い分けの決め方**: 必ず起きてほしい物（止める・型の検査）はフック。順番のある手順（ルールの表の足し方、見直し役の選び方）は Skill。別の目・少ない道具・目的に合うモデルが要る物はサブエージェント。Claude Code に見えないデータ（手元の D1 の中）は MCP。どれでもない目安は CLAUDE.md。Claude Code の公式のベストプラクティス（Deterministic and non-deterministic instructions）の分け方に合わせた

## モデルの使い分け

作品の中（lib/claude/models.ts の用途ごとの既定と、録音のまとめの RECORDING_SUMMARY。本番の鍵での応答と所要時間はまだ確かめていない。docs/KNOWN_UNKNOWN.md の U10）。effort は分類のほかは high にそろえた（Managed Agents の世界の部屋も。T67、`7b5f1c0`。待ちと上限の決め方は docs/progress/t67.md）:

| 用途 | モデル | effort・上限・待ち | なぜこのモデル |
| --- | --- | --- | --- |
| 様式の読み取り（写真・PDF → 欄の対応表、T08） | Opus 5.5 | high・16000・180 秒 | 役所の様式の欄の名前と順を読む文書の目 |
| 訓練の監督（出来事の差し込み、世界の状態、T19。仮想モードの世界の 1 回呼び、T50） | Opus 5.5 | high・16000・180 秒 | 10 人の 72 時間を 1 つの流れで持つ。決まった流れ＋判断点 |
| 仮想モードの世界の部屋（Managed Agents、T50） | Opus 5.5 | high・1 刻み 120 秒 | 道具のループと前の刻みの記憶が要る。下の「使っていない物」の Managed Agents |
| 採点とレビュー（T22） | Opus 5.5 | high・16000・180 秒 | 訓練記録の全部を読み、連絡の順と抜けを講評する |
| 台帳の入力（文字・話した物 → 項目、問い返し、T03） | Sonnet 5.5（写真・PDF は Opus 5.5） | high・16000・180 秒 | 自由文を項目に分ける。回数と質の釣り合い。AI 提供が不同意の人には呼ばない（T74） |
| 要約（用途 summary。今呼ぶのはアンケートの集計 tools/survey/summarize.ts で、作者の手元だけ） | Sonnet 5.5 | high・16000・180 秒 | 理由の文を 7 つの型に分ける。ご意見・その他の記入は AI に渡さない |
| ペルソナ（本人役・家族役の 1 刻み、T18） | Haiku 5.5 | high・8000・90 秒 | 10 人 × 刻みで回数が多い。小さな文脈で速く |
| 録音と自由文の分類（T12・T64） | Haiku 5.5 | low・4000・12 秒 | 6 つに分けるだけ。録音の応答のあとの 30 秒に再試行込みで収めるため、これだけ low のまま |
| 録音のまとめ（T69b） | Haiku 5.5 | high・4000・20 秒、再試行なし | 本人が言った事の言い換えだけ（80 字まで）。分類と並べて走らせる。元の言葉と必ず並べ、AI の印、ケアマネが直せる。色と順には使わない。決まりで禁じた言葉が文字起こしに無いのに出たら捨てる |
| 声（T21） | Gemini TTS | — | 声は他社の物を使う（仕様書） |

使わない所（Claude を呼ばない）: 安否の色と連絡順（lib/triage）、119 の案内、医療要約・様式の紙面、通話で聞いた安否・経過の撤回・連絡先の順・住所と位置・同意、本人・家族のスマホの選択肢の帯（表の答えから決める）、気象庁の警報・地震・雨雲（電文のまま）、通信なしの写しと保留、CSV と一括印刷。作業ごとの「使う所・使わない所」は docs/progress/tNN.md の頭の 1 行。

開発の中:

| 役 | モデル | 裏 |
| --- | --- | --- |
| 設計・brief・判断の案 | Fable 5.1 | `cc9e8f9`・`78f2bb7`・`60d826c`・`7b9d14c` |
| 実装・テスト・進みの記録 | Opus 5.5 のサブエージェント（effort xhigh） | `341a56e`〜`f49f334`（Co-Authored-By は Fable のまま）、`382d477`〜`6e8ca41`、`241a8a0`〜 |
| 見直し役（.claude/agents） | 医療 Opus・画面 Sonnet・ペルソナ Haiku | `b7fb97f`。上の「サブエージェントと MCP の使い分け」 |
| アンケートの質問・集計の手順（T34） | Sonnet 5.5 | `7e6ff79`〜`bb8c00d` の 5 件 |

**発災時は Claude を分類と写しとまとめだけに留めた**。安否の色（赤 至急・黄 要確認・灰 不明・緑 無事）と連絡の順位はルールの表（lib/triage、docs/TRIAGE.md）で出し、Claude は録音と自由文を「けが・動けない・水が来た・機器が止まった・その他・不明」に分け、本人の言葉を聞き取りの欄に写し、録音を本人の言葉と並べてまとめるだけ（まとめは 11/4 に足した。前の決まりは「Claude は要約しない」）。理由は 3 つ: 最後に判断するのは人で、ケアマネが表の理由を読んで直せる（HITL）。表は人が読めてテストでき、同じ入力で同じ色が出るので、あとから責任を追える。Anthropic の利用ポリシーは、医療に関わる高リスクな使い方に人の確認と AI を使っていることの開示を求めており、AI に個人の病気を決めさせない（docs/DECISIONS.md「AI の使い所」）。分類が外れても色は表が決め、「赤＋不明」は赤のまま（docs/DECISIONS.md「色と連絡順」）。Claude の出力には画面に「AI」の印を付ける。強いモデルを使う所（様式の読み取り・監督・採点）と、使わない所（色と順位）を分けたことが、この作品の使い分け。

## 使っていない物

- **外の MCP**: Cloudflare の MCP は使っていない。配信（T27）の確かめに使うかを、そのときに決める。それまでは使わない（docs/tasks/README.md）。使っている MCP は手元の care72-local の 1 つだけ（T32）
- **見直し役と MCP を Claude Code の中から呼ぶこと**: T32 を作ったセッションは care72 の外で始まり、.claude/agents と .mcp.json を読み込んでいない。サーバーはテストで SDK の client から起こして呼び、`claude mcp get care72-local` で Claude Code が .mcp.json から読むこと（Pending approval、フォルダの信頼のあとに許可が効く）までを見た。medical-reviewer と screen-checker は、本文を Agent の道具（モデルを opus・sonnet に指定）に渡して今の lib/triage・lib/labels・本人のページに流し、返った「分かりにくかった所」で定義を直した（`463d735`）。.claude/agents から名前で呼ぶのと、MCP の道具を Claude から呼ぶのは、次に care72 で開いたセッションで見る
- **Managed Agents**: 仮想モード（T50）の世界の部屋だけに使う。72 時間の架空の街の流れを 1 つの session が持ち続け（Agent と Environment は 1 回だけ作って D1 の ai_agents に ID を持つ。訓練ごとに session 1 つ、予算 $3）、刻みごとの返事は custom tool の world_step の schema で縛り、受け取ってからまた zod で確かめる（lib/drill/world-room.ts）。使わない所: 録音の分類、色と順（lib/triage の表）、本人役 10 体、講評、固定の筋（大雨・地震・10 分版）の監督。これらは Messages API の 1 回呼び（askJson）のまま。理由: 道具を回すループと前の刻みの記憶が要るのは世界だけで、ほかは 1 回の入力で答えが決まる。部屋が作れない・時間切れ・形の違い・上限のときは、その刻みだけ 1 回呼び（lib/drill/world-oneshot.ts、同じ指示と schema、世界の履歴の要約を足す）に落ち、画面に「世界 代替」の印。結末も世界の部屋が決める（T53）。訓練の仮想モードの架空の人だけで、固定の筋と発災時の色と順（lib/triage）には持ち込まない。部屋には時計の計算（lib/drill/outcome.ts、採点と同じ関数）を目安として渡し、部屋が世界の流れで結末を迎えた人（1 刻み 2 人まで）・やわらかい 1 文・理由（街と物の事実）を決める。コードは守りだけ（知らない仮名・結末済を捨てる、禁じる語は固定の文、理由の医療の語は外す）。部屋も 1 回呼びも落ちた刻みは結末を出さない（コードで代わりに決めない）。講評では「結末 筋書（AI）」と「条件到達 時計計算」を別の行で数える。11/4 の変更: 部屋の Agent を effort high にし、1 刻みの待ちを 60 秒から 120 秒に（T67、`7b5f1c0`）。デモでない事業所では、街を参加者の台帳の町名から作り（町の名前は別名で渡す）、刻みの文に「結末: 決めない」と書いて結末を求めず、返ってきた結末は捨てる。実在の人の仮名に結末を付けないため（T70、`0d1a29a`・`ae51c19`。部屋の Agent の版は 4）。AI の 1 日の上限で止まった刻みには「世界 停止」「本人役 停止」の印
- **フックの PreToolUse・PostToolUse 以外**（Stop・SessionStart など）: 使っていない

## 数え方

```sh
R=36f82bd
git rev-list --count $R; git rev-list --count --merges $R; git rev-list --count --no-merges $R
git log --no-merges $R --format='%(trailers:key=Co-Authored-By,valueonly)' | sort | uniq -c   # 書き手
git log --no-merges $R --numstat --format='@@%h|%(trailers:key=Co-Authored-By,valueonly)'   # 行は拡張子で分けて足す（package-lock.json を除く）
git log $R --merges --format='%h %an %s'   # 人が GitHub の画面で押した PR の merge は作者のアカウントの名前
git diff-tree --cc <merge の hash> | grep '^++'   # merge で新しく書いた行（11 件とも 0）
gh pr list --state all --limit 200 --json number,state,baseRefName
ls docs/tasks/T*.md | wc -l
npm test
```
