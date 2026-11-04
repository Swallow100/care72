# 進み

## 11/3 02:4x 配信（Fable）

- main 175d0eb（T18 本人役、T24 同意の範囲と経過、T26 デモの種と「最初に戻す」、テストの直し、docs/JUDGING.md）を https://care72.app に出した（Worker version 2b9e57a1）。remote の D1 は tools/deploy/rebuild-remote.sh で作り直した（DEPLOY_DIR=care72-deploy2。確認用の dev が care72-deploy を使っていたため）
- 確かめ: /api/health ok（DB・RECORDINGS・anthropic true、gemini false）、/ → /login 307、people 10 人。workers.dev は閉じたまま
- 未確認: 本番の鍵での入れる欄・分類・本人役（ai_calls は作り直しで 0 件）、T26 の cron と「最初に戻す」を本番で押すこと

## 11/3 02:20 落ちるテストの直しと T24 の取り込み（Opus）

- 始める前（integrate/t11-t12 の 1df68e9、T26 #19 を取り込んだ所）: `npm test` 1043 件のうち 4 件が落ちていた（本人役 3 件と MCP 1 件）。全部を流すと、ほかに 1 件が時々 5 秒の時間切れで落ちた
- 本人役の 3 件（lib/drill/persona.test.ts、5ec514f）: T26 で山田 ハナの連絡手段のスマホを「使える」にした（審査員の本人スマホ。docs/progress/t26.md）のに、T18 のテストが「山田はスマホを持たない」のままだった。lib/drill/persona.ts の決まり（本人は「使える」だけ、家族・支援者はスマホのある人だけ、事業所は連絡しない）は正しいので、期待だけを直した。山田は押せる側（本人、娘。説明に「スマホ 使える」、本人の赤と 4 問）、スマホを持たない本人が赤を押せない確かめは佐藤と伊藤で、説明の「スマホ 持たない」は佐藤で見る
- MCP の 1 件（tools/mcp/care72-local、888361a）: 「miniflare の置き場から people の表がある .sqlite を選ぶ」は手元の D1 の置き場には依らない（一時フォルダに置き場の形を作る）。落ちたのは時間切れで、テストの中で表と種を文ごとの自動の確定で file の SQLite に書いていたため（単独で 1.8 秒、50 の worker が同時に動くと vitest の既定の 5 秒を超える。`--testTimeout=1500` で同じ落ち方を出せる）。探し方は people の表があるかだけを見るので、表 1 つの .sqlite で確かめる（0.1 秒）。people の無い物・SQLite でない物は選ばず、2 つあれば新しい方を選ぶことも足した。beforeAll の種も BEGIN〜COMMIT の 1 つの書き込みに
- 時々落ちる 1 件（tools/claude-code.test.ts、a9b38bf）: docs/CLAUDE_CODE.md の commit の hash の確かめが hash ごとに git を起こしていた（単独で 1.5 秒、混んだ時に 5 秒の時間切れ）。`git cat-file --batch-check` で 1 回にまとめた（0.2 秒）
- T24（#20、task/t24）を merge commit で取り込んだ（02e7e45）。衝突なし。T24 は 0001・lib/db/types.ts・seed を変えていないので、remote の D1 の作り直しは T23・T26 の分のまま（T24 で増えない）。手元は `npm run db:fresh` で作り直した
- 取り込んだあと: `npm test` 1086 件が通る（3 回流して 3 回とも）、`npm run typecheck` も通る。全部を流したときに 3 秒前後かかるテスト（lib/person.test.ts の 10 人を描く物、lib/forms/matsuyama.test.ts の欄の物）がまだあり、PC が混んでいると時間切れに近づく
- main を integrate/t11-t12 の先頭まで fast-forward で進めた（`git push origin integrate/t11-t12:main`）。残りの分岐の T19（task/t19）は integrate より先の commit が無い

## 11/3 01:13 配信（Fable）

- main a8750d0 を https://care72.app に出した（Worker version e4a930a9）。訓練（T17）と行政・医療班の受け持ち（T23）が本番に。remote の D1 は作り直し（0001 の表＋種 10 人、278 行）。作者の端末のタブから tools/deploy/rebuild-remote.sh
- 確かめ: /api/health ok（DB・RECORDINGS・anthropic true、gemini false）、/ → /login 307。workers.dev は閉じたまま
- 未確認: 本番での訓練の進め方（D1 の重なりの 409 は node:sqlite でしか見ていない）、/staff の受入の流れ、本番の鍵での分類

## 11/3 01:1x T17・T23 の取り込み（Fable）

- T17 訓練の骨組み（#15、task/t17。言葉の校正 11 件の直し a9f9522 も）と T23 行政・医療班の受け持ち（#16・#17、task/t23。経過の種類「受領」→「受入」も）を integrate/t11-t12 に merge commit で取り込み、main を進めた。テスト 1005 件、`npm run typecheck`。T23 が 0001 を直した（custody・第三者提供の記録・所属なしの事業所・申告の年齢）ので、手元の D1 は `npm run db:fresh`、配信は D1 の作り直し
- 手元で確かめた: ケアマネで /drill → 大雨の想定 → 72 時間の棒・表（担当一覧と同じ色）・状況・対応（枠）・被害状況・地図。「進める」3 回で経過 6 時間、山田が至急「本人が「けが」」、小林が至急「人工呼吸器 内蔵電池 3 時間を超過」、田中が要確認「無事だが透析先 未確認」。受け持ち（/staff）は T23 の記録の確かめ（headless Chrome）に任せ、こちらでは開いていない
- 地図のデモの印「筋書きの値」→「想定の値」（訓練の言葉に合わせた）
- 進みの詳しい記録は docs/progress/t17.md・t23.md・wording.md。T23 の問い（搬送のあとの状態・平時の事業所の人の受入・提供記録を画面に）は T24 の依頼で決めた（搬送 行き先 の状態、提供の行を経過に）
- `npm run typecheck` は next dev を立てたまま回すと `.next/dev/types` の生成ファイルが壊れて落ちることがある（Next 16.4.3 の書き込みの競合）。止めて `.next/dev/types` を消せば通る

## 11/3 00:24 配信（Fable）

- main d9937f0 を https://care72.app に出した（Worker version 7bd37d8b）。T13 発災時の一覧・T11 家族のスマホ・T12 録音の分類・言葉の直し（#14）・書体 Plex が本番に
- remote の D1 は tools/deploy/rebuild-remote.sh で作り直した（表を全部消す → 0001 → 種 10 人、276 行）。作者の端末のタブ（Git Bash）から流した
- 確かめ: /api/health ok（DB・RECORDINGS・anthropic true、gemini false）、/ → /login 307、people 10 人。workers.dev は 1042/404 で閉じたまま（意図どおり）
- 未確認: 本番の鍵での分類（docs/progress/t12.md の「本番の鍵で最初に確かめること」）と本人のスマホの実機（T10 の記録）。Gemini の鍵は未設定なので、定型文の声は端末の読み上げになる

## 11/3 深夜 書体（Fable。設計の側の判断）

- 画面の書体を BIZ UDPGothic → IBM Plex Sans JP に。本人・家族のスマホ（`/me`・`/family` の main に `font-ud`。部品の `.phone-text`・`[data-phone]` にも）と本人の 1 枚（`[data-sheet="own"]`）だけ BIZ UDPGothic のまま（`--font-ud`）。家族の災害モードの部品は `.phone-text` を持たないので、頁の main で当てる。手元で `font-ud` と `.phone-text` の computed font が BIZ UDPGothic になることを確かめた
- 理由: BIZ UDPGothic は `tabular-nums` が効かず（「0000」121.6px に対して「1111」100.8px）、表の時刻・残り時間・人数の縦が揃わなかった。Plex は数字がもともと等幅（どちらも 100.8px）。字が締まって密度の高い表の折り返しが減る。Noto Sans JP も揃うがどのアプリでも見る顔、Zen Kaku Gothic New は 400 が細くかなの字間が広い。発災時の担当一覧を 1280px のライトで 4 書体を当てて見比べて決めた
- 本人の画面に UD を残すのは、大きな字とふりがなで読み違えにくい作りのため
- 一緒に直した: 発災時の右の面を横に出すのは 1536px（2xl）から。表に約 64rem 要るので、1280px で横に並べると右端（避難計画の列）が切れていた。1280px は表の下に 2 列、1536px は右（app/page.tsx・components/list/SidePane.tsx）。手元の 1280・1536 のライトで全部の列が見えることを確かめた

## 11/2 夜 その 5（Opus。docs/tasks/T13.md: 担当一覧の発災時）

作っていたエージェントは 23:08 に利用量の上限で切れた。続きは別のセッション（Opus）が引き継いで、残っていた幅の直しを commit し、この記録を書いた。

### できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | 信号の読み方: 同じ出来事の赤を重ねて読む（けがの赤のあとの答えなしの赤で「けが」を落とさない）。担当一覧・本人のページ・様式 9 が同じ読み方（triageInDisaster）。大雨の筋は heavy-rain.fixture.ts に移し、一覧の並びのテストと共有 | lib/triage/from-ledger.ts（foldSignals）・index.ts、lib/disaster/triage.ts | ddfefab |
| 2 | 未知の信号（家族の「分からない」）は新しい情報なしとして表に渡さない。赤を解くのは緑だけ（T11 の問い） | lib/triage/from-ledger.ts | d556734 |
| 3 | 分類の出どころ: ケアマネが直した分類は「分類（ケアマネ）: 動けない」（AI の印なし）。人の直しが前の赤の Claude の分類に勝ち、外した分類を戻さない（T12 の問い）。docs/TRIAGE.md を作り直した | lib/disaster/triage.ts（toTriageSignal）、lib/triage | 0538f4b |
| 4 | 優先修正（上げる・下げる・理由・解除）は本人の経過の override の行。色はサーバーで当て直し、一覧・本人のページ・様式 9 が同じ上書きを読む。電話の記録は called の行（名前と番号は文に書かない）。録音の再生 `GET /api/recordings/<信号>`（本人のページと同じ壁、範囲の外は 404、Range で 206）。`POST /api/caseload/override`・`/api/caseload/call` はケアマネの役だけ | lib/disaster/override.ts、lib/list/calls.ts・override.ts・recording.ts・http.ts、app/api/caseload/、app/api/recordings/[signal]/ | 966685a |
| 5 | 発災時の表: 先頭に状態（色の印と 2 字）と優先（並びの番号）、残り・最終連絡の列。列は減らさず、どの列でも並べ替え（既定は優先）。上に至急・要確認・未知・無事の人数と発災・停電からの経過。行を押すと行の下に詳細（理由、連絡先と電話・不通、時計の残り・出典・確認、避難先、支援者、最終連絡、信号の答え、録音の再生、文字起こし、分類の差し込み口、優先修正） | components/list/DisasterTable.tsx・RowDetail.tsx・CallButtons.tsx・OverrideForm.tsx・ExpandRow.tsx・DisasterSummary.tsx・SortHeader.tsx、lib/list/detail.ts、lib/caseload.ts、app/page.tsx | 9bed955 |
| 6 | 幅: 発災時は右の面を 1280px から（1024〜1279px は表の下に 2 列）。セルの余白と最小幅を詰め、時刻・残り・ハザード・支援者・計画は折り返さない。連絡先は 1 行目に誰か、2 行目に電話と不通。本人の連絡先の行は「本人 本人」にしない。電話の記録の時刻は「11/4 10:42」 | app/page.tsx、components/list/、lib/list/calls.ts・detail.ts | この記録の 1 つ前 |
| 7 | テスト: 大雨の筋の 10 人が画面の並びと一致（lib/list/board.test.ts）、D1 での上書き・電話・録音・詳細（lib/list/list.test.ts）、信号の重ね読み（lib/triage/fold.test.ts） | | 各 commit |

テストは 905 件。`npm run typecheck` も通る。

### T11（#12）・T12（#13）の取り込み

- 2 つとも衝突なしで merge できた（lib/signals/http.ts は自動で合わさった）。テスト 960 件、`npm run typecheck` も通る
- 分類の部品（components/list/Classification.tsx）を行の詳細の差し込み口につないだ（app/page.tsx の CLASSIFICATION。担当一覧はケアマネの役しか開けないので直す口はいつも出す）。行の詳細の信号の型（SignalForDetail）に ai_* の列を足し、型の抜け道（as unknown）を使わない
- 並行で作った所の突き合わせ: classified_by の値（claude・care_manager）は T12 の保存と T13 の読み方で同じ。家族の「分からない」は T11 が color `unknown` で保存し、T13 の重ね読みは赤・緑のほかを表に渡さないので、赤が下がらない

### 手元で確かめた所（next dev、手元の D1 は `npm run db:fresh`、使い捨てのパスワードを環境変数で渡し値は残さない）

- 大雨・レベル 4・停電 3 時間、1024px のダーク: 上に至急 2・要確認 1・未知 7・無事 0。山田（酸素 内蔵電池 2 時間を超過）と小林（人工呼吸器 内蔵電池 3 時間を超過）が至急で上、田中は要確認「透析先 未確認」、伊藤の理由に「支援者なし」
- 行の詳細: 連絡先は本人の行に名前を重ねない、電話と不通が 2 行目。不通を押すと電話の記録に「11/2 23:29 本人 不通 山本」、連絡先の横にも不通の時刻
- 優先修正: 山田を無事にして理由を入れると、無事 1 に増えて山田が 10 番目へ、理由の下に「優先修正 至急→無事」
- 1280px のライト: 右に地図（ピンは状態の色）・人数・ハザード別・避難先。表の理由は 2〜3 行に折り返すが崩れない
- 分類（取り込みのあと）: 山田に文字起こし「いたい、うごけない」と Claude の分類（動けない、確信 0.9）の赤の信号を手元の D1 に入れると、理由が「録音の分類（AI）: 動けない」、信号の欄に文字起こし・分類・AI の印・確信 90%・引用・修正。修正でけがを足して保存すると、理由が「分類（ケアマネ）: けが・動けない」に替わり、AI の印が消える

### 未確認

- 録音の再生（本物の録音が要る）。本物の Claude の分類（鍵の入った配信先で、T12 の「本番の鍵で最初に確かめること」）
- 1280px のダーク、1024px のライト（片方ずつしか見ていない）

### 決めた所

- 「分からない」とケアマネの「つながらない」は新しい情報なしで、既にある赤・黄を下げない。緑だけが赤を解く
- 同じ出来事の答えは重ねて読む。ケアマネが直した分類は、それより前の Claude の分類を捨てて人の分類だけを引き継ぐ

## 11/2 夜 その 4（Opus。docs/tasks/T10.md: 本人のスマホ 赤緑 → 1 問ずつ → 音声 → 録音）

### できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | 信号の保存: 役「本人のスマホ」だけが書ける（ケアマネ・医療班・行政・家族・役未選択は 403、ログインなしは 401）。本人の id と出どころ（self）はログインから決め、送った物の中の id は読まない。色・緑の 1 問（家・避難所・その他）・赤の 4 問（けが・家・動けるか・薬。答えていない問いは null）・時刻を signals に、経過に「信号」の 1 行（「無事じゃない けが あり・自宅・動けない・未回答 1」「無事 自宅」）。災害モードの間だけ受け、平時は 409。id は端末で作る UUID で、送り直しても重ねない（別の人の id なら競合）。分類（classes・classified_by）は空のまま | lib/signals/body.ts・save.ts・http.ts・labels.ts、app/api/signals/route.ts | ae0c157 |
| 2 | 録音と文字起こし: 先に送った自分の信号に 1 回だけ添える。音声は R2 の `recordings/<事業所>/<本人>/<時刻>.webm`（時刻は信号の時刻。Safari の mp4 は .m4a）、鍵と文字起こしは信号の行に、経過に「録音 30 秒 文字起こし「…」」の行（payload の source は recording）。音声だけ・文字起こしだけでもよい。8 MB・600 秒・2,000 字まで | lib/signals/save.ts・http.ts、app/api/recordings/route.ts | ae0c157 |
| 3 | 定型文の声: 「大丈夫ですか。状況を説明してください」の 1 文だけ（名前を入れない）。Gemini の鍵があれば 1 回だけ作って R2 の `voice/<モデル>/<声>/prompt-1.wav` に置き、次からはそれを返す（用途 voice で事業所の上限に数える）。鍵が無ければ 404 で、端末は speechSynthesis で同じ文を ja-JP で読む | lib/signals/voice.ts・phrases.ts、app/api/signals/voice/route.ts | ae0c157 |
| 4 | 流れ（画面に触らない）: 上 → 緑 → 1 問 → 送る、赤 → 1 画面 1 問 × 4 → 送る。20 秒は赤を押した時か最後に答えた時から数え、送ったあとは数えない。20 秒押さないと、それまでの答えで赤の信号を先に送り、定型文を流して（15 秒で打ち切り）、30 秒録る。延長は 30 秒ずつ・上限 120 秒、「送る」で早く止める。マイクも文字起こしも使えなければ録らずに終わる | lib/signals/phone.ts | 6eab1f1 |
| 5 | 通信が無いとき: 送る前に端末（localStorage）に書き、届いたら消す。開いたとき・つながったとき・20 秒ごとに順に送る（前が送れないうちは後ろを送らない）。送り直しても通らない応答（400・403・404・409・413）は捨てる。音声は端末に書かず（開いている間だけ覚える）、閉じると文字起こしだけ送る。持ち主は「役:本人」（self:p-01） | lib/signals/outbox.ts | 6eab1f1・aa4513b |
| 6 | 音: 赤を押した時に、音の要素を音を出さずに 1 回鳴らして読み込み（携帯が 20 秒あとに鳴らせるように）、マイクの許可を聞いてすぐ閉じる（許可済みなら聞かない）。MediaRecorder は webm → mp4 → ogg の順。文字起こしは T04 の lib/speech/dictation.ts で、長い無音でブラウザが止めたら 5 回まで続きから聞き直す（言い換えない） | lib/signals/media.ts | 6eab1f1 |
| 7 | 画面 `/me`: 平時は本人の 1 枚（T06）の文を大きな字で（電話は押すとかけられる、119 はリンクにしない）。30 秒ごとに読み直して災害モードに替わる。災害モードは「無事」緑と「無事じゃない」赤の 2 つだけを面で塗り（状態の色の変数のまま。ダークは上の字を濃く）、1 画面 1 問、ボタンは 2〜3 つ、戻るなし、説明文なし、漢字は全部ふりがな。録っている間は「AI が きいています」・定型文・「あと 25 秒」・もっと 話す・送る。終わりは「とどきました」（通信なしは「まだ とどいて いません」「つながったら 送ります」）と「もう 一度」、赤の終わりに「いのちの 危険が あるときは 119」。上と終わりにいる間だけ 30 秒ごとに読み直す。言葉の途中で折り返さない（keep-all） | app/me/page.tsx、components/phone/PhoneSheet.tsx・PhoneView.tsx・PhoneDisaster.tsx・phone.css | 745f7d0・063615e |
| 8 | テスト 57 件: 送る形と色・答えの組、端末の時計のずれ、役の壁（ケアマネは 403、送った物の中の p-02 は p-01 に入る、録音も自分の信号だけ）、平時 409、保存の形と経過の 1 行、送り直し・競合、保存のあとの担当一覧（赤（けが）で「本人が「けが」」、答えなしの赤で「本人が「無事じゃない」」、緑で無事）、録音の鍵と R2・2 回目は何もしない、声は 1 回だけ作る。流れ（偽の時計）: 緑 1 問、赤 4 問、20 秒で音声 → 定型文 → 30 秒 → 録音を添える、2 問のあとの 20 秒、延長と上限、送ったあとは数えない、定型文が終わらないとき、閉じたとき。端末の残し方（通信の失敗・開き直し・録音は信号のあと・音声が消えたとき・捨てる応答・ほかの人と役・書けない端末）。音・録音・文字起こしの偽物。画面の静的な描画（ボタンの数、面で塗るのは 2 つだけ、判定の言葉なし、ふりがな、119 は赤の終わりだけ、平時は T06 と同じ文） | lib/signals/signals.test.ts・phone.test.ts・view.test.ts | 各 commit |

テストは 811 件（754 から）。`npm run typecheck` と `npm run build` も通る。

### 本番で最初に確かめること（鍵の入った配信先、実機のスマホで）

1. 審査員 → 本人スマホ → 事業所を災害モードに（別の端末でケアマネ）→ `/me` が 30 秒以内に赤緑に替わるか。赤を押すとマイクの許可が出るか
2. 何も押さずに 20 秒 → `GET /api/signals/voice` が 200 の audio/wav、D1 の ai_calls に `purpose = 'voice'` の行が 1 つ、R2 に `voice/gemini-3.8-flash-tts/Kore/prompt-1.wav`。2 回目の赤では行が増えないか。声が実際に鳴るか（押してから 20 秒あと。iPhone の Safari が鳴らすかが一番あやしい）
3. 録音 30 秒 → R2 に `recordings/office-demo/p-01/<時刻>.webm`（iPhone は .m4a）、信号の行に鍵と文字起こし。Android の Chrome で MediaRecorder と Web Speech が同時にマイクを使えるか（使えなければ文字起こしは空で、録音だけ届く）
4. ケアマネの担当一覧で山田 ハナが 60 秒の読み直しのうちに「至急」、本人のページの経過に「信号」2 行（信号と録音）
5. 機内モード → 緑 → 避難所 →「まだ とどいて いません」→ 戻す → 一覧が無事に、端末の `care72.phone.outbox.v1` が消える

### 確かめた所

- `npm test` 811 件、`npm run typecheck`、`npm run build`
- 手元の next dev（port 3072）。この回だけの使い捨ての審査員と山本のパスワードと SESSION_SECRET を dev のプロセスの環境変数で渡し（`CLOUDFLARE_INCLUDE_PROCESS_ENV=true`。シェルにあった別の名前の鍵の変数は外して起こした）、終わってファイルを消した。鍵（Gemini・Anthropic）は渡していないので、声は 404 → speechSynthesis の道を通った。本物の API は呼んでいない
- 自分の headless Chrome（puppeteer-core、cookie はほかの作業と別、偽のマイク `--use-fake-device-for-media-stream`、偽の SpeechRecognition と 2 秒で終わる偽の speechSynthesis）で、本人（審査員 → 本人スマホ）とケアマネ（山本）を別の窓に、375×812 のライトとダーク:
  - 平時の `/me` に本人の 1 枚 → `/office` で大雨 → `/me` が赤緑
  - 赤 → ある・はい・動けない・ある →「とどきました」と 119 → 担当一覧の山田が 未知 → 至急「本人が「けが」「動けない」」
  - 赤 → 押さずに 20 秒（20 秒で替わった）→ 定型文（speechSynthesis に「大丈夫ですか。状況を説明してください」ja-JP）→「AI が きいています」と残りの秒 → 録っている間に一覧はもう至急（先に送った赤）→ 30 秒 → 録音を添えて「とどきました」。押してから終わりまで 53 秒。経過に「無事じゃない 未回答 4」と「録音 30 秒 文字起こし「あしが いたい」」、手元の R2 の模擬に WebM（約 475 KB、頭が EBML）、信号の行に鍵
  - 緑 → 家 → 一覧の山田が無事「本人が「無事」」
  - 通信を切って 緑 → 避難所 →「まだ とどいて いません」、端末に 1 件 → 戻すと送られ、端末が空、経過に「無事 避難所」
  - 撮って直した所: 言葉の途中の折り返し（「来 / ます」「いま / せん」）を空白で折るように、「AI」の印が地と同じ色で見えなかったのを面の色に
- 終わってサーバーを止め、`npm run db:fresh` で手元の D1 を種に戻し、手元の R2 の模擬（.wrangler/state/v3/r2）を消した

### 決めた所（見直してほしい）

- 赤の信号は、ボタンの流れが終わった時（4 問目を答えた時か、20 秒で音声に替わった時）に、それまでの答えで送る。録音と文字起こしはあとで `/api/recordings` で同じ信号に添える。T10 の「録音 30 秒 → 送信」の 1 回送りから変えた。一覧に赤が約 20 秒で出て（録り終わる 50 秒を待たない）、録音の送信が失敗しても赤は失われない。音声の回の経過は「信号」が 2 行（信号・録音）
- 「とどきました」は信号が届いたかだけを見る。録音が送れなかった（端末に残した）ときも、赤が届いていれば「とどきました」
- 本人の役は ai を持たないが、定型文の声は recording を持つ役（本人・家族）が開ける。本人の言葉を送らない決まった 1 文で、作るのは 1 回だけ（R2 の録音の bucket の `voice/` に置き、事業所の上限に用途 voice で数える）。lib/auth/roles.ts は変えていない
- 平時は信号を断る（409）。通信が戻ったときに平時へ戻っていた信号は端末が捨てる
- 起きた時刻はサーバーの時計から「送るまでの遅れ（端末の送った時刻 − 押した時刻）」を引いて出す（0〜72 時間）。端末の時計が進んでいると、ルールの表が「まだ先の信号」として外すため。録音の経過の時刻も同じ
- 録音の鍵の拡張子は音声の形から（Chrome・Edge は webm、Safari は mp4 で .m4a、Firefox は ogg）。T10 の `.webm` 固定から変えた
- マイクの許可は赤を押した時に聞いてすぐ閉じる（20 秒あとに許可の画面が出ると、押せない人は録れない）。音の要素も押した時に音を出さずに鳴らしておく。答えるだけの人にも許可の画面が出る
- 音声は端末に書かない（localStorage に入れない）。開き直すと音声は消え、文字起こしだけ送る
- 端末の残りの持ち主は「役:本人」。出どころはサーバーがログインの役から決めるので、審査員が本人 → 家族に替えたときに本人の残りを家族として送らないように
- 119 はリンクにしない（押し間違いで救急にかけない）。平時の電話は押すとかけられる。紙で手で書く線の所（ケアマネ・かかりつけの電話が無い）は番号を出さない
- 答えは 2 つで「わからない」は置かない（分からなければ 20 秒で音声に替わる）。緑には音声が無く、答えずに離れたら送らない（未知のまま。間違えて押した緑を無事にしない）。緑の時刻は「無事」を押した時刻
- 終わりは「もう 一度」で上へ（戻るでなく、次の報告）
- 経過の書き手は審査員のアカウント（「本人 審査員」と出る。入れる欄の保存と同じ）
- 平時の画面と、災害モードの上・終わりの画面だけ 30 秒ごとに読み直す（答えている途中・録っている途中は読み直さない）。新しい災害モードに入ったら前の流れを持ち越さない（key は発災の時刻）
- 本人の画面の言葉は lib/signals/phrases.ts の定型だけ（Claude に作らせない）。ケアマネの側の経過の言葉は lib/signals/labels.ts（lib/labels.ts は触っていない）

### 問い

- 録音の同意: 同意 4 つ（名簿登録・計画の共有・支援者への提供・医療班への提供）に「発災時の電話・録音」が無いので、録音は同意で止めていない。T10 の「録音は本人の同意の範囲でだけ送る」をどれで見るか、5 つ目を足すか
- ルールの表は最新の信号だけを読む。手元の確かめで、赤（けが・動けない）のあとに音声の赤（答えなし）を送ると、理由が「本人が「けが」「動けない」」から「本人が「無事じゃない」」に下がった（色は赤のまま、並びの組は 0 → 1）。同じ出来事の中の答えを重ねて読むか（T12・T13）
- 種の山田 ハナの台帳はスマホ「持たない」だが、審査員の本人スマホは山田 ハナ（T26 で「使える」にするか）
- 本人のスマホの上の帯（ケア72・役・ログアウト・役変更）はそのまま出している。審査員には要るが、本物の本人のアカウント（QR のトークン）では隠すか

### 次の作業への引き継ぎ

- T11（家族）: lib/signals/save.ts の signalScope に family を足す（出どころ・書き手の役は family）。端末の残りの持ち主は `family:<本人>`。PhoneView はそのまま使え、言葉だけ「お母さんは 無事ですか」の形に（phrases.ts に足す）。声は家族の役も開ける
- T12（分類）: 文字起こし（signals.transcript）は話したままで、名前が入ることがある（「娘の恵子が…」）。Haiku に渡す前に必ず lib/pseudonym を通す。分類を付ける所は attachRecording のあと。classes・classified_by は空
- T13（一覧の行の詳細）: 録音を再生する GET の道は作っていない。鍵は signals.recording_key（R2 の RECORDINGS）。本人・ケアマネの範囲の壁を付けて作る

### 未確認

- 実機（iPhone の Safari・Android の Chrome）。押して 20 秒あとに声が鳴るか、MediaRecorder と Web Speech が同時にマイクを使えるか、Safari の mp4、ホーム画面に追加した形
- 本物の Gemini TTS（呼んでいない）と、R2 に置いた声の再生。端末の speechSynthesis に日本語の声があるか（無い端末は定型文が流れず、すぐ録り始める）
- 配信先（Workers）の R2 への put と、multipart の大きさ
- 偽のマイク（headless Chrome の偽の機械の音）でしか録っていない。うめき声・周りの音がどう録れるか

### T10 と違えた所

- 赤の信号を先に送り、録音をあとで添える 2 回送り（上の「決めた所」の 1 つ目）
- 録音の鍵の拡張子を音声の形から（.webm 固定でない）
- 触るファイルの外は無し（lib/labels.ts・lib/auth/roles.ts・lib/triage は変えていない）。テストは lib/signals に置いた（components のテストも renderToStaticMarkup で lib/signals/view.test.ts から）
- app/api/signals/voice/route.ts を足した（T10 の app/api/signals/ の中）

## 11/2 夜 その 3（Opus。PR #9・#7 の merge と仕上げ）

### できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | PR #9（T06 本人の 1 枚）を main に merge。衝突は書類の入口の 3 か所で、T16 の QR と T06 の本人の 1 枚を両方残した（計画書・医療要約・本人の1枚・QR の順） | lib/person.ts、lib/person.test.ts、lib/forms/matsuyama.test.ts | e4bfce2 |
| 2 | PR #7（T14 右の面）を main に merge。担当一覧の行は T09 の triage と T14 の右の面の列を両方持つ。災害モードの右の面をつないだ: 行の lib/triage の結果を表の並びに並べ直してピンに、雨雲・震度のデモは事業所の災害の種類と警戒レベルから（sideDisasterOf）。警戒レベルの無い大雨は「大雨」だけ。一覧の見出しの帯は災害モードの色ごとの人数と時点だけ（平時の計画の人数は右の面） | app/page.tsx、lib/caseload.ts、lib/map/side.ts・demo.ts・map.test.ts | 5073950 |
| 3 | 本人の 1 枚の裏の QR を T16 の QrBlock に。QrBlock に caption を足し、外すと一辺 18mm の四角だけ。「この QR は医療班が読みます」と期限は題名の段の右の小さな字の一番上（MedicalSummaryPaper の note）。未作成・期限切れは同じ 18mm の枠に状態。画面の上の帯に QR の状態と期限（押すと QR の画面） | components/forms/QrBlock.tsx・OwnSheet.tsx・MedicalSummarySheet.tsx・own-paper.css、app/people/[id]/forms/own/page.tsx、lib/forms/own-sheet.test.ts | 032c830 |
| 4 | 種の入れ直しで消す順に migrations の表を全部（timeline_entries・office_timeline_entries・form9_rank_edits・disaster_state・ai_calls・signals …）。AI を呼んだあとの npm run db:reset が外部キーで落ちていた | seed/sql.ts、seed/seed.test.ts | b20dd3d |
| 5 | migration を 0001 に畳んだ: QR の列を people の表に入れ、0002_qr.sql を消した | migrations/0001_init.sql、lib/qr/store.ts | bc6aaa8 |
| 6 | DECISIONS に「11/2 夜（2）の案と問い（Fable）」、担当の割り振りを今の形に | docs/DECISIONS.md、docs/tasks/README.md | この commit |

テストは 754 件（main の 692 → T06 の merge で 715 → T14 の merge とつなぎで 748 → QR で 752 → 種で 754）。型の検査も通る。merge した branch（task/t06・task/t14）は GitHub で消した。PR #9・#7 は merged になった。

### 衝突の解き方

- T06: DOCUMENT_PATHS と 2 つのテストの期待値だけ。医療要約の紙面の分割（MedicalSummaryPaper）は main に変更がなく、そのまま入った
- T14: lib/caseload.ts は行の型・import・行を作る所で、T09 の triage と T14 の pendingFields・hazardKinds・destination・location を両方。app/page.tsx は、自動の merge で落ちた TONE_TEXT の import を戻し、T09 の PlanSummary（T14 が右の面に移した）を消し、見出しの帯は災害モードのときだけ T09 の色ごとの人数と時点。右の面の disaster は T14 の記録の「T13 が渡す」を待たず、merge でつないだ

### 確かめた所

- 各 commit の前に npm test と npm run typecheck
- 本人の 1 枚を 10 人分、vitest で静的な HTML に書き出し（紙面の CSS 3 つと BIZ UDPGothic）、手元の Chrome（headless）の印刷で PDF にして頁を数えた: QR なし・QR ありとも 10 人とも 2 頁。書き出しの道具はリポジトリに入れていない
- 手元の next dev（port 3072）に使い捨ての山本のパスワードをプロセスの環境変数で渡し（ファイルに残していない）、アプリのブラウザペインで:
  - 本人の 1 枚（山田 ハナ）: 帯に「QR 未作成」→ QR の画面で作成 → 帯に「QR 期限 2027-01-31」、裏の QR は 68px（18mm）、紙は 2 枚、1 行と期限が題名の段の右
  - 事業所で大雨（警戒レベルなし）→ 担当一覧の右の面が発災時（デモ「大雨」、ピンは行の色）。レベル 4・停電 事業所全体（3.5 時間前）→ デモ「大雨 レベル 4」、山田・小林 至急、田中 要確認、ほか未知、ピンの一番上は山田。ヘッダーに「大雨 レベル 4 停電 3 時間」
  - 終わってサーバーを止め、パスワードのファイルを消し、npm run db:fresh で手元の D1 を種に戻した
- 手元の D1: npm run db:fresh のあと d1_migrations は 0001_init.sql だけ。AI の行・災害モード・QR の版を入れてから npm run db:reset が通り、全部種に戻る

### 未確認

- 18mm の QR を紙に刷ってスマホのカメラで読めるか（URL の長さで 1 つの点は約 0.3mm。T16 の QR の画面は 32mm）。読めなければ裏の置き場を変えて大きくする（18mm を超えると山田 ハナの裏が 3 頁になる）
- 配信の D1 は作り直しが要る（0001 に災害モードの表と QR の列が入った）。d1_migrations も消してから 0001（docs/DECISIONS.md「配信と守り」）。docs/progress/t16.md の「0002 を当てる」は古い
- merge のあとの担当一覧の右の面は、ライトの広い幅だけ見た（ダーク・狭い幅の畳み・地震の場面は画面で見ていない。テストだけ）
- 実機・Safari・印刷の本物の紙

## 11/2 夜 その 2（Opus。docs/tasks/T04.md: 話して入れる（Web Speech）と入れる欄の磨き）

### できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | DECISIONS に「11/2 夜の案と問い（Fable）」（配信前の D1 は作り直す、T07 の問い 4 つ、T15・T03 の決めた所）。docs/tasks/README.md の担当の割り振りを今の形に | docs/DECISIONS.md、docs/tasks/README.md | b40ace8 |
| 2 | 話して入れるの芯: SpeechRecognition（無ければ webkit の名前）を ja-JP・continuous・interimResults で使い、押したときの欄の文に、確定した区切りを改行で足し、認識中の区切りは置き換える。人が止めたら onend のあとに 1 回だけ送る合図（onDone）、ブラウザ側で終わった・失敗したときは送らない（onEnd: マイク不可・音声なし・認識失敗）。止めたあと onend が来なければ 4 秒で打ち切る。4,000 字で切って止める。画面（DOM）に触らず、作る物を渡す | lib/speech/dictation.ts | 917620f |
| 3 | 画面から使う形 useDictation（対応の判定は描いたあと。最初は false でサーバーの描画と合わせる） | lib/speech/use-dictation.ts | 53071ec |
| 4 | 入れる欄の「話す」: 抽出の隣。聞いている間は「停止」（主の操作の色）・状態に「認識中」・欄は readOnly・抽出は押せない。停止 → 欄の文のまま抽出に送る（話して足したときだけ）。対応していないブラウザ（Firefox など）はボタンを出さない。手入力に切り替えたら聞くのをやめる | components/person/Intake.tsx、intake-ui.ts、lib/labels.ts | 53071ec・0466997 |
| 5 | 入れる欄を人ごとに作り直す（key）。担当一覧の右の面で別の人を開いても、前の人の文・変更点・話している途中を持ち越さない | components/person/PersonWithIntake.tsx | 53071ec |
| 6 | README の守りに「Web Speech はブラウザが音声を外部の認識サービスに送る物。本運用で使うかは事業所の判断」 | README.md | 53071ec |
| 7 | AI 失敗の理由: 抽出の失敗の応答に reason（ai_calls の error の分け方。形式相違・出力超過・拒否・時間切れ・呼出失敗）。欄に「AI 失敗 時間切れ 再試行」の 1 行、再試行は同じ文・同じ問いで送り直す。未設定・上限・伏せきれない入力は今までどおり上の状態の欄 | lib/intake/http.ts、components/person/Intake.tsx、lib/labels.ts | 69693af |
| 8 | 変更点の項目の行ごとに小さな AI の印（見出しの印はそのまま）。人が「修正」で直した行は「修正済」 | components/person/IntakeChanges.tsx、parts.tsx | 742275d |
| 9 | テスト 21 件: 偽の SpeechRecognition で、対応の判定、ja-JP・continuous、認識中の置き換えと確定の改行、押したときの欄の文が残る、字を変えない（前後の空白だけ）、改行で文に分かれ特記を元の 1 行に戻せる、停止で 1 回だけ送る（残った認識中も入る）、何も話さずに止めたら送らない、ブラウザ側の終わり・失敗の分け方では送らない、aborted は失敗にしない、onend が来ないときの打ち切り、上限、abort は何も知らせない、始められないとき、止めたあと直してもう一度話すと直した文に続く。AI 失敗の理由の応答（値と場所を返さない）と ai_calls の bad_output。変更点の描画で行ごとの印と修正済 | lib/speech/speech.test.ts、lib/intake/intake.test.ts | 各 commit |

テストは 631 件（610 から）。型の検査も通る。

### 本番で最初に確かめること（鍵の入った配信先、PC の Chrome で）

1. 審査員 → ケアマネで 佐藤 キミ（`/people/p-04`）を開き、入れる欄の「話す」→ マイクの許可 →「88 歳、独居、認知症で民生委員の〇〇さんが週 2 回来る。土砂の区域」と話す。欄に流れ、息つぎごとに改行が入るか。句読点が付くか（付かなければそのまま）
2. 「停止」→ 変更点が出るか。停止の直前に話した最後の区切りが欄と送った文に入っているか（偽物は停止のあと onend だけを送るので、本物の「停止 → 最後の確定 → onend」の順は通していない）。特記が話した 1 行のまま戻るか（伏せ字のまま出たら、話した文と Claude の写した文が合っていない）
3. マイクの許可を断ると状態に「マイク不可」。話さずに待つと Chrome が止まり「音声なし」、文は残って送られない。話している途中に黙ると何秒で止まるか（Chrome は無音が続くと終わる。訪問中に考え込むと「話す」を押し直すことになる）
4. AI 失敗が出たら、欄の理由（形式相違・時間切れ・呼出失敗）と D1 の ai_calls の error が合うか

### 確かめた所

- `npm test` 631 件、`npm run typecheck`。各 commit の前に流した
- 手元の next dev（port 3072）。使い捨ての山本のパスワードと SESSION_SECRET、ダミーの ANTHROPIC_API_KEY、送り先を閉じた手元の port に向けた ANTHROPIC_BASE_URL を、dev を起こすプロセスの環境変数だけで渡した（ファイルに書いていない。本物の API には出ない）。自分の headless Chrome（puppeteer-core。cookie はほかの作業と別）から山本で入り:
  - 偽の SpeechRecognition を入れて `/people/p-04` の「話す」→「停止」と「認識中」、欄は readOnly、抽出は押せない、認識中の区切りが置き換わり確定が改行でつながる → 停止 → 欄の文のまま `/api/intake/extract` に 1 回（返事はテストと同じ形の偽の差分）
  - 変更点: 介護度（既入力）を選ぶ・薬を外す・既往を修正（「修正済」が付く）→ 保存 → 本物の `/api/intake/save` で手元の D1 に。本人のページが 計画 下書き、介護度 要介護3、既往 認知症・高血圧、特記、経過に「入力」と AI の印。薬は入らない
  - 失敗: 偽の時間切れの返事 →「AI 失敗 時間切れ 再試行」→ 再試行で同じ文を送り直して変更点。偽にしないで送る → サーバーが閉じた port に繋がらず「AI 失敗 呼出失敗」、手元の D1 の ai_calls に ledger_input・api_error の 1 行
  - SpeechRecognition の無い形（Firefox）→「話す」が出ない
  - 担当一覧の右の面（`/?open=p-04`）で話している途中に別の人を開く → 欄が空になり、前の認識は abort
  - ライト・ダーク、1280px（右の面 20rem）と 760px（欄が上）で撮って見た
- アプリのブラウザペインは、ほかの worktree の dev と localhost の cookie を共有する（port をまたぐ）ので、ほかの作業のログインで自分のセッションが 401 になった。自分の headless Chrome に替えた。並べて確かめる作業は、それぞれ別の Chrome（または別のホスト名）を使うのがよい
- 終わってから dev を止め、`npm run db:fresh` で手元の D1 を種に戻した（`db:reset` は下の件で落ちた）

### 決めた所（見直してほしい）

- 「止めると分けるに送る」と「送る前・保存前に直せる」: 停止で抽出に送る。欄の文は残るので、直して抽出し直せる。変更点は保存の前に修正できる。聞いている間は欄を readOnly にした（認識の結果と打った字が混ざって二重にならないように）。止めたあとに直してもう一度話すと、直した文のあとに続く
- 送るのは押してから話して足したときだけ。何も話さずに停止したら送らない（AI の回数を使わない）。ブラウザ側で終わった（長い無音・通信）ときと失敗のときも送らず、文は残す
- 確定した区切り（息つぎ）ごとに改行でつなぐ。句点は足さず、字は変えず、区切りの前後の空白だけ落とす。改行は lib/intake/diff.ts の sentencesOf の文の区切りなので、句点の無い話し言葉でも特記を元の 1 行に戻せる
- 4,000 字（抽出の上限）で切って止め、人が止めたのと同じく送る
- 言葉: 「話す」は T04 の言葉のまま（2〜4 字の漢語の決まりから外れる）。止めるは「停止」、状態は「認識中」、失敗は「マイク不可」「音声なし」「認識失敗」。「もう一度」はボタンの決まりで「再試行」にした
- AI 失敗の理由は ai_calls の error（refused・bad_output・timeout・api_error）に合わせ、bad_output のうち途中で切れた物（max_tokens）だけ「出力超過」、ほかの形の違い（schema・not_json など）は「形式相違」。断られたは今までどおり 422 の ai_refused で、理由「拒否」。形の違う場所（issues）は応答に出さない。再試行を出すのは AI の返事の失敗だけ。文を直したら再試行の行は消え、抽出で送る
- 行の AI の印は小さくし、読み上げは見出しの印に任せる（行の印は aria-hidden）。人が直した行は「修正済」で、印は AI のまま
- 入れる欄を人ごとに作り直した（key）。前は担当一覧の右の面で別の人を開くと、前の人の文と変更点が残り、そのまま保存すると今開いている人の id と版で送られるおそれがあった（T03 から。直す前の動きはブラウザで確かめていない）

### 問い

- 話して入れると「民生委員の〇〇さん」のような台帳に無い名前がそのまま入りやすい。docs/DECISIONS.md「仮名化・同意・個人情報」の問い（台帳に無い名前は伏せきれず Claude に渡る）が、話す入力で効きやすくなる。直し方は T03 の案のまま
- ブラウザ側で止まったとき（無音・通信）に、人が「停止」を押すまで自動で聞き直すか。今は止まったら聞くのをやめるだけ（送らない）。本番で止まるまでの長さを見てから決める

### 見つけた所（直していない）

- `npm run db:reset` は、AI を 1 回でも呼んだあと（ai_calls に行がある）は FOREIGN KEY で落ちる。seed/sql.ts の CLEAR_ORDER に ai_calls が無く、offices を消せないため。手元は `npm run db:fresh` で戻る。T26（最初に戻す・毎日 4 時に戻す）で ai_calls を消すかを決める（消すと 1 日の上限の数えも戻る）

### 未確認

- 本物のマイクと Chrome の認識（日本語の区切り方、句読点、長い無音で止まるまでの長さ）。Safari（iPhone・iPad）と Android の Chrome（continuous の結果が重なって返る癖がある）
- 本物の API での抽出（手元に鍵が無い）。話した文が Sonnet にどう分けられるか
- 実機、キーボードだけの操作、読み上げ。Workers（配信先）

### T04 と違えた所

- 触るファイルの外: lib/labels.ts（言葉）、components/person/intake-ui.ts（ボタンの見た目）、PersonWithIntake.tsx（key）、README.md（守り）。磨きの分で lib/intake/http.ts・intake.test.ts、IntakeChanges.tsx、parts.tsx
- テストは lib の状態の遷移（偽の SpeechRecognition）と、変更点の描画（renderToStaticMarkup）。入れる欄の部品そのものの操作は jsdom を足さず、ブラウザで確かめた
- 押している間だけ聞く形は作らず、押して始め・押して止めにした

## 11/2 夜（Opus。docs/tasks/T03.md: 入れる欄（文字・貼り付け → 項目、問い返し））

### できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | 台帳に 4 つの欄: 寝室（basic.housing.bedroom）・支援の内容（evacuation.support と supportNote）・マイ・タイムライン（evacuation.myTimeline）・みまもり員（local.watcher）。本人のページ（寝室・支援内容・タイムラインは避難、みまもり員は人）、松山市の様式（4 つの欄が値を出す、pending は理由で）、仮名化（みまもり員は有無だけ渡し、自由文の名前は役割名に）。種の値は空のまま | lib/db/types.ts、lib/person.ts、lib/forms/matsuyama.ts、lib/pseudonym/index.ts、lib/labels.ts | 2a01bcb |
| 2 | 分ける: 今の台帳（仮名化済み）と伏せた文を Sonnet に 1 回（askJson、用途 ledger_input）。返事の形は schema.ts（値は全部文字、union・null・省略なし）。欄の一覧は表（fields.ts）から system に作る | lib/intake/extract.ts・schema.ts・fields.ts | acacd93 |
| 3 | 差分: 返事を今の台帳と並べる（追加・一致・既入力）。選択肢に無い値は捨てて数え、伏せ字（（氏名）（町名）（電話））が残れば印。特記は仮名化の前の同じ文に戻す。連絡先は同じ種類の行に当て、空いた所（夜間・続柄・備考）だけ。無ければ足す（名前・電話は人が画面で入れる） | lib/intake/diff.ts・changes.ts | acacd93 |
| 4 | 差分の当て方: 埋まった欄は上書きしない（人が既入力を選んだときだけ）、配列は無い物だけ足す、薬・機器・ハザードは同じ物の空いた所だけ、値の入った欄の未確認は消え、分からない・答えない・次回は pending に残る | lib/db/ledger.ts の applyLedgerChanges | acacd93 |
| 5 | 医療依存の印: 機器・薬（骨格に入る区分）・認知症を入れて時計が無ければ、値の空いた時計を作る（印と骨格の段は時計の区分から出る）。新しい薬の中断注意も区分から。Claude は決めない | lib/intake/marks.ts、lib/db/ledger.ts | acacd93 |
| 6 | 次の問い: 空欄から 1 問ずつ。医療依存（値の空いた時計・薬の残り・回数・用量・保管）→ 夜間の支援者・避難の支援者 → その他（本人のページの区分の順）。問いの文は定型。不明・無回答と記録した欄は問わず、未聴取（種と「次回」）は問う | lib/intake/ask.ts・answer.ts | acacd93 |
| 7 | 保存: ケアマネの役だけ、版の確かめ。経過の行（でたらめの id）を最初に読んだ版のときだけ入れ、台帳・連絡先・時計の文はその行があるときだけ効く（重なった保存は片方だけ）。未作成は下書きに。経過に「入力」（AI の分け方、人が確認: 欄の名前）。値は残さない | lib/intake/save.ts | acacd93・d3be244 |
| 8 | API: POST /api/intake/extract（分ける。書かない）・/api/intake/save。同じ所からだけ、ケアマネの役だけ、personInScope。AI 未設定 503・上限 429・伏せきれない入力 422・競合 409 | app/api/intake/、lib/intake/http.ts | 8d574dd |
| 9 | 画面: 本人のページの右に常に開く入れる欄。文字（抽出）と手入力の切り替え、変更点（AI の印・伏せ字・修正・既入力の上書き・保存で付く印）、質問（選択肢・数字・文字・夜間の連絡先、不明・無回答・次回）。面が 56rem 以上なら右に留め、狭ければ上に。単独のページと担当一覧の右の面の両方 | components/person/Intake*.tsx・PersonWithIntake.tsx・intake-ui.ts、app/page.tsx、app/people/[id]/page.tsx | 1ce6a2f |
| 10 | テスト 36 件（lib/intake/intake.test.ts 30 件ほか）: 差分の当て方（埋まった欄を上書きしない）、差分の状態、特記の戻し方、Sonnet を 1 回・送った物に氏名・町名・電話・生年月日が無い、仮名化を通らない入力が型で止まる（@ts-expect-error）と実行時に止まる、AI 未設定と上限で呼ばない、問いの順、答え → 変更、印、保存で未作成 → 下書き、版の競合、重なった保存、夜間・薬の残りの答えで未確認が消える、役と範囲、手入力。Claude の応答は固定の JSON | lib/intake/intake.test.ts、lib/person.test.ts、lib/forms/matsuyama.test.ts、lib/pseudonym/pseudonym.test.ts | 各 commit |

テストは 538 件（502 から）。型の検査と `npm run build` も通る。

### 本番で最初に確かめること（鍵の入った配信先で、T03 の画面から）

1. 審査員 → ケアマネで 佐藤 キミ（`/people/p-04`）を開き、入れる欄の文字に「88 歳、独居、認知症で民生委員の〇〇さんが週 2 回来る。土砂の区域」→ 抽出。変更点が 医療（既往 認知症 など）・避難（ハザード 土砂 一致）・人（民生委員）・基本（世帯 独居 一致・特記）に分かれて出るか。見出しに AI の印
2. 応答の形が schema に合うか: 失敗なら欄に「AI 失敗」と出て、D1 の ai_calls に `purpose = 'ledger_input'` の行が `error = 'bad_output'`（形が違う）か `api_error`（schema が API に断られた）で残る。ai_calls には本文が残らないので、形の違いは手元で同じ schema（lib/intake/schema.ts）を見直す
3. 保存すると担当一覧の 佐藤 キミ が「未作成」→「下書き」、経過に「入力」と AI の印、次の問いが「抗認知症薬 残り」から始まるか
4. 1 回の分け方の時間（Sonnet、effort medium）。長ければ lib/claude/models.ts の ledger_input を low に

### 確かめた所

- `npm test` 538 件、`npm run typecheck`、`npm run build`
- テストが効くか: 埋まった欄の上書きを止める所を外すと 2 件、重なった保存の連絡先の守りを外すと 1 件落ちた（戻した）
- 手元の next dev（port 3079、この回だけの使い捨ての審査員のパスワードと SESSION_SECRET をプロセスの環境変数で渡し、値のファイルは消した。鍵は置いていない）でブラウザの道具から、審査員 → ケアマネ → `/people/p-04`:
  - 入れる欄に「AI 未設定」の印が出て、手入力が開く。文字に T03 の文を入れると抽出は押せない。`/api/intake/extract` を直接呼ぶと 503「AI 未設定」
  - 質問「抗認知症薬の残りは何日分か」に 14 → 保存済、計画が「下書き」、上の時計に「抗認知症薬 14 日」、次の問いが用量へ。不明 → 医療の未確認 1、次回 → 夜間の問いへ。夜間の問いで清水 正子 → 人の区分の夜間支援が 清水 正子
  - 手入力で寝室とマイ・タイムライン → 本人のページの避難の区分と、松山市の様式の寝室・マイ・タイムラインの欄に値が出た
  - 変更点の見た目は、鍵が無く Claude の応答を作れないので、テストと同じ固定の分け方を変更点の部品で描いた HTML を画面に差し込んで見た（コードは足していない）
  - ライト 1280px（担当一覧の右の面: 一覧・本人のページ 2 段・入れる欄が 1 画面に並ぶ）、1024px、ダーク 768px（入れる欄が上）
  - 終わってからサーバーを止め、手元の D1 を `npm run db:reset` で種に戻した

### 決めた所（見直してほしい）

- 返事の形は、値を全部文字にした平らな形（欄の鍵の enum ＋ 値の文字、薬・機器・ハザード・連絡先・特記・分からない）。null や union を 40 近く持つ形は構造化出力の複雑さの上限に当たるおそれがあるため。選択肢の値は system の一覧で伝え、合わない値は捨てて「除外 N」と出す
- 入力に書かれた欄は、今の値と同じでも出させる（画面で「一致」と並べる）。佐藤 キミ の種は世帯・認知症・土砂がもう入っているので、T03 の文は多くが「一致」になり、追加は既往と特記と民生委員の備考くらい
- 「埋まっている欄は変えない」は Claude にも書くが、守るのはコード（保存の当て方）。今と違う値は「既入力」で既定は外し、人が選んだときだけ上書き
- 特記は Claude に入力の 1 文をそのまま写させ、仮名化の前の同じ文（句点・改行で区切った同じ番目の文）に戻す。文が合わなければ伏せ字のまま出し、人が直す。仮名（A さん）は氏名に戻すが、連絡先の役割名（民生委員）は戻さない
- 連絡先は Claude の分け方から足せる（名前・電話は空で、人が変更点の修正で入れる。Claude には渡らない）。今の行は空いた所（夜間・続柄・名前・電話・備考）だけ埋める。避難支援等実施者の順（supporter_order）と緊急連絡先の順は付けない（人が決める所）
- 医療依存の印は時計から出るので、機器・骨格に入る薬（インスリン・抗凝固薬・ステロイド・抗てんかん薬）・認知症を入れて時計が無ければ、値の空いた時計を作る（電源の機器は停電で走る「〇〇 内蔵電池」、透析・栄養剤・薬は発災で走る、インスリンは種と同じく停電で走る）。値（長さ）は人が問いに答えて入れ、出典は「ケアマネ」、確認の日は答えた日
- 新しい薬の中断注意は骨格の 5 段の区分（抗凝固薬・ステロイド・抗てんかん薬）から付ける。区分そのものは Claude が名前から選ぶ（分からなければ その他）。画面で直せる
- 問いの答えは Claude を通さず保存する（選択肢・数字・文字・夜間の連絡先）。決まった形の無い問い（避難を手伝う人）だけ文で答えて抽出
- 「不明」「無回答」は pending の unknown・declined として残し、その欄はもう問わない（計画と本人のページに「未確認（不明）」）。「次回」は not_asked として残し、この回は飛ばす。開き直すとまた問う（未聴取は次の訪問の問い）
- 経過の kind に input を足さず note にし、payload の source を intake にした（`IntakePayload`）。kind を足すと timeline_entries の CHECK を作り直す migration が要り、配信済みの D1 の表を建て直すため。画面は「入力」と出す
- 重なった保存の守り: 経過の行を最初に、読んだ版のときだけ入れ、ほかの文は「この経過の行があるとき」だけ効く。版と時刻で守ると、同じミリ秒の 2 つの保存を見分けられないため
- Claude に渡す「今の問い」（focus）はコードの定数の言葉だけ（「薬の残りの日数」など）。薬の名前や時計の名前は渡さない（system は仮名化を通らないため）
- 入れる欄はケアマネの役だけ（審査員のケアマネの役を含む）。行政・医療班は save を持つが、入れる欄の API は断る
- 担当一覧の右の面は最大 90rem（1280px で入れる欄が右に並ぶ幅）。本人のページの区分の 2 段は 42rem から 40rem に（入れる欄の隣でも 2 段になるように）
- 入力の文は 4,000 字まで（ケアプラン 1 枚の写しが入る長さ）
- 問い（案。DECISIONS には書いていない）: 自由文の中の台帳に無い名前（「民生委員の田村さん」など）は Claude に残る。T03 では足していない。足すなら「台帳に無い漢字・カナ 1〜4 字＋さん・様・氏」を（氏名）に置き換える規則を lib/pseudonym に。「お母さん」「娘さん」「民生委員さん」を除く一覧が要り、誤って伏せた語は人が変更点で直す。新しいみまもり員の名前も同じ（台帳に入れたあとは役割名に置き換わる）

### T03 と違えた所

- 触るファイルの外: lib/db/types.ts（欄と経過の payload）、lib/person.ts（欄の行、経過の「入力」、`pendingClockId`、版を読む）、lib/labels.ts、lib/pseudonym/index.ts、lib/forms/matsuyama.ts、lib/db/test-d1.ts（batch を取引にし、書く文の meta.changes を返す）、components/person/PersonView.tsx・Timeline.tsx・parts.tsx（AI の印）、app/page.tsx
- 連絡先の表と時計の表にも書く（台帳の JSON だけでは夜間の支援者と医療の印が出ないため）
- 話して入れる（Web Speech）は T04。手入力の連絡先の追加・並べ替え、時計の編集（出典・頼り先）は作っていない（連絡先は変更点から、時計の長さは問いから）
- 年齢（「88 歳」）は台帳でなく生年月日の列なので、分け方に欄を持たない

### 未確認

- 本物の API（手元に鍵が無い）: Sonnet 5.5 がこの schema（欄の鍵の enum 36 個と文字の値）を構造化出力で受けるか、分け方の質（特記を 1 文そのまま写すか、選択肢の値を守るか）、時間、fallbacks
- Workers（配信先）での動き。next dev と next build だけ
- 変更点の画面の操作（チェック・修正・保存）は本物の分け方では動かしていない（部品の描画と、保存の API・当て方はテスト）
- 実機（iPhone・iPad）、キーボードだけの操作、読み上げ

## 11/2 夕方 その 6（Opus。PR #3 の merge、様式の同意の範囲、録音の分類の AI の印）

### できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | PR #3（task/t05、T05 松山市の様式の紙面）を main に merge（--no-ff）。衝突は本人のページの書類の行の 1 か所で、main の T02 の最終形（DocumentView を受ける行、小さい字）に t05 の計画書への「表示」のリンク（href があればリンク）を足した。PR #3 は merged になり、origin の task/t05 は消した。T05 の記録は docs/progress/t05.md | components/person/PersonView.tsx ほか t05 の物 | 23436c8 |
| 2 | 様式の医療の欄（かかりつけ医・薬局、医薬品情報、特記の医療、別紙）は計画共有の同意に従う。医療班提供は様式に効かない（要約 T07 と QR T16 だけ）。9 渡辺の様式に医療の欄が戻った（降圧薬、別紙 あり）。計画共有なしは実施組織と医療の欄を「省略（計画共有 同意なし）」。7 加藤の実施者の省略は今のまま。医療班提供の pending はその他に出す。テスト: 渡辺を直し、計画共有なしの 1 件を足し、「省略が無い」を加藤のほかの 9 人に | lib/forms/matsuyama.ts・matsuyama.test.ts | 242b44e |
| 3 | 赤 ＋ けが・動けないの理由に AI の印。4 問の答え（ボタン）からなら「本人が「動けない」」のまま、録音・自由文の分類（Claude）からなら「録音の分類（AI）: 動けない」（2 つなら「けが・動けない」）。答えにある言葉は分類から重ねず、両方あれば「、」でつなぐ。色と並びは変えない。読み方に 1 行足し、`npm run docs:triage` で TRIAGE.md を作り直した（SOURCES.md は変わらない） | lib/triage/index.ts・triage.test.ts、docs/TRIAGE.md | 4afffa4 |
| 4 | DECISIONS の末尾に「11/2 夕方の案（Fable）」: (a) 様式の医療の欄と計画共有、(b) 分類の理由の AI の印、(c) 作者への問い 4 つ | docs/DECISIONS.md | 6ed8fbc |
| 5 | docs/tasks/README.md の wrangler の注を「配信は既存のアカウントで作者が手で打つ（T27）。エージェントはネットに出る wrangler を打たない」に（その 5 で残した 19 行目） | docs/tasks/README.md | この commit |

テストは 502 件（main の 486 → merge で 500 → 様式で 501 → AI の印で 502）。型の検査も通る。

### 確かめた所

- merge のあと、各 commit の前に `npm test` と `npm run typecheck`。`gh pr view 3` は MERGED（merge commit 23436c8）
- テストが効くか: 様式の直した・足したテスト 3 件は merge 直後の matsuyama.ts で落ち、AI の印のテストは前の index.ts で落ちた（戻した）
- 手元の next dev（port 3079、この回だけの使い捨ての審査員のパスワードと SESSION_SECRET をプロセスの環境変数で渡し、ファイルは消した）に curl でログインし、ケアマネの役で: `/people/p-01` の書類の計画書が `/people/p-01/forms/matsuyama` への「表示」のリンク、`/people/p-09/forms/matsuyama` に降圧薬と別紙の医療要約が出て「省略」が無い、`/people/p-07/forms/matsuyama` は「省略（支援者提供 同意なし）」が 4 か所。サーバーは止めた

### 決めた所（見直してほしい）

- 様式で落とす物があるのは計画共有と支援者提供だけ（sheet.withheld はこの 2 つから）。名簿登録は問いの答えだけ、医療班提供は様式に効かない
- 別紙の「あり」も計画共有で付ける（指示のとおり）。別紙は医療要約（T07）を指し、要約は医療班提供に従うので、9 渡辺は「別紙 あり（医療要約）」なのに要約は医療班へ渡らない（docs/DECISIONS.md「書類」）
- 医療班提供の pending（consent.medical）は、前は別紙の欄に「未確認」と出していたが、様式の欄に効かなくなったので欄の無い pending と同じく「その他」に出す。種にこの pending の人はいない
- 分類の理由: 答えが「けがなし」「動ける」でも分類が「けが」「動けない」なら、今までどおり赤・最上位の組で、言葉は「録音の分類（AI）: …」。分類の言葉には「本人が」を付けない（指示の形）。水が来た・機器が止まった・不明は赤だけの行のままで、理由に AI の言葉は出さない

### 未確認

- 画面の見た目（書類の行のリンク、渡辺の紙面）はブラウザで撮っていない。HTML の中身だけ curl で見た
- 本物の松山市の様式との照らし合わせ（docs/progress/t05.md の 7 か所）は T05 のまま
- 発災時の画面（T13）はまだ無いので、AI の印の付いた理由が画面に出るところは見ていない

### 違えた所

- docs/progress/t05.md の「医療班提供なし → 医療の欄を省略」の記述は T05 の時点の記録なので書き換えていない（今の決まりは docs/DECISIONS.md「書類」）

## 11/2 夕方 その 5（Opus。16:1x〜16:4x の判断を main に）

### できた物

| # | 物 | 場所 | commit |
| --- | --- | --- | --- |
| 1 | ゲストを外した（判断 B）。役の表に guest は無く、cookie が無い・壊れている・切れているときは Principal が null。画面は `/login` へ（`/`・`/people/[id]`・`/drill`・`/me`・`/family`・`/staff`・`/login/role`）、API は `denied(null)` が 401。ヘッダーのログインの印（LoginLink）を消し、ログアウトは `/login` へ。`/me` は本人の役の personId だけ。README の「触り方」はログインが提出書類にあることの 1 行 | lib/auth/、app/、components/AppHeader.tsx、README.md | d52081b |
| 2 | パスワードの受け口を 2 通りに。審査員は `JUDGE_PASSWORD_HASH`、無ければ `JUDGE_PASSWORD`（平文）。山本は env の `CAREMANAGER_DEMO_PASSWORD_HASH` → `CAREMANAGER_DEMO_PASSWORD` → 種のハッシュの順。ログインとセッションの確かめの両方が lib/auth/credential.ts を通る | lib/auth/credential.ts・password.ts・session.ts・principal.ts、cloudflare-env.d.ts、.dev.vars.example、seed/build-sql.ts（注だけ） | b93beaf |
| 3 | 配信の script: `db:migrate:remote`・`db:seed:remote`・`deploy`（書いただけで打っていない）。フックのテストを「配信の 3 つのほかは通る・3 つは止まる」に | package.json、tools/hooks/rules.test.ts | d64df19 |
| 4 | wrangler.jsonc: database_id を 11/2 に作った D1 care72 の物に。R2 は care72-recordings のまま、account_id は書かない。冒頭の注を「配信は作者が手で打つ」に | wrangler.jsonc | 1febd9c |
| 5 | CLAUDE.md の「画面の決まり」に 2 つ（意味色、簡素化しない） | CLAUDE.md | 27e2976 |
| 6 | DECISIONS の確定の節、見るだけのゲストの案に「取り下げ」、T01・T26・T28 の追記のゲストの行を「取り下げ（16:10）」、T27 を今の形に、一覧に T32 の行 | docs/DECISIONS.md、docs/tasks/ | 06c9bbc |
| 7 | 担当一覧に意味色: 計画の状態の印（未作成 灰・下書き 黄・同意済と訓練済 緑。PLAN_TONES）、上の人数の数字も同じ色（0 は色なし）、右の「未確認」の見出しに人数（黄） | app/page.tsx、lib/caseload.ts | 4bf1f92 |

テストは 428 件（414 から。ゲストの分を消し、受け口 8 件・平文の比べ方 3 件・配信の script 1 件・計画の色 1 件ほかを足した）。型の検査も通る。

### 作者がすること（配信。順に）

1. ダッシュボードの Workers の care72 の Secrets に入れる（チャット・ファイル・commit に貼らない）:
   - `SESSION_SECRET`: 32 字以上のでたらめな文字列。**無い・短いと全部の画面が 500**
   - `JUDGE_PASSWORD`（平文。8 字以上にする）か `JUDGE_PASSWORD_HASH`（`npm run -s hash-password` の 1 行）。両方あればハッシュを使う
   - 山本も使うなら `CAREMANAGER_DEMO_PASSWORD` か `CAREMANAGER_DEMO_PASSWORD_HASH`（無ければ山本は入れない。審査員は入れる）
   - `ANTHROPIC_API_KEY`、`GEMINI_API_KEY`
2. 自分の端末で `npm run db:migrate:remote` → `npm run db:seed:remote` → `npm run deploy`
3. 確かめ: ログインなしの `/` が `/login` へ、審査員ログイン → 役選択 → 担当一覧、`/api/health` の ai が true

- 16:45 に配信した版（手元の care72-deploy の worktree は 2955103）はこの回より前で、ゲストがまだある。`npm run deploy` をし直すまで公開の URL ではログインなしで担当一覧が見える
- `db:seed:remote` は全部の表を消して種に戻す（協力事業所の記録も）。`--file` は D1 への取り込みで、流している間は DB が止まることがあるので、人が触っている時間には流さない
- 山本のハッシュを種に入れたいときは、`db:seed:remote` を打つ端末の環境変数か .dev.vars に `CAREMANAGER_DEMO_PASSWORD_HASH`（今まで通り）。平文は種に入らない

### 確かめた所

- `npm test` 428 件、`npm run typecheck`。
- wrangler.jsonc の database_id を変えたので手元の D1 は別のファイルになる。`npm run db:reset`（--local）で作り直した。
- `.dev.vars` の無い手元で `npm run dev`: `/`・`/?open=p-01`・`/people/p-01`・`/drill`・`/me`・`/family`・`/staff`・`/login/role` は全部 307 で `/login`、`/login` は 200。審査員・山本のログインは `/login?e=1` で「認証失敗」（鍵が無いので当然）。ログアウトは `/login` へ。`/api/health` は ai が両方 false
- この回だけの使い捨ての平文を `JUDGE_PASSWORD` として dev のプロセスの環境変数に渡し（`CLOUDFLARE_INCLUDE_PROCESS_ENV=true`、値はファイルに書かず、あとで消した）: 違うパスワードは認証失敗、合うと役選択 → ケアマネ → 次の要求で担当一覧 200（ヘッダーに ケアマネ 山本・審査員）
- 見た目: headless の Chrome で担当一覧とログインの画面を 1280px・768px、ライトとダークで撮って見た。計画の印は灰・黄・緑と文字、上の人数も同じ色。ログインなしはヘッダーが名前だけ
- テストが効くか: セッションの確かめを種のハッシュだけにすると「山本: 種にハッシュが無くても env の平文で入り、次の要求でも切れない」が落ちた（戻した）

### 決めた所（見直してほしい）

- ログインしていないことを役（guest）でなく null で表す。`getPrincipal`・`resolvePrincipal`・`principalFromRequest` は `Principal | null`、`requirePage` が `/login` へ送る。`denied(null, need)` は読むのも 401
- 平文の比べ方: 両方を NFC にそろえて SHA-256 にし、定数時間で比べる。ハッシュの道と同じだけ PBKDF2（100,000 回）の時間をかける（平文の道でも総当たりを遅くし、どちらの道かを時間で分からせない）
- 平文で入ったセッションの指紋（cookie の pv）は `SESSION_SECRET` の HMAC。平文の素の SHA-256 を cookie に入れると cookie から総当たりで戻せるため。平文を変える・ハッシュに替えると前のセッションは切れる
- 山本は env を種より先に見る（作者が Secrets に貼った値が、種にハッシュが残っていても必ず効くように）。env の山本の値は山本（acct-yamamoto）にだけ効き、ほかのアカウントには効かない
- env の値の前後の空白は落とす（スマホで貼ったときの改行）。打ったパスワードの空白は落とさない（今まで通り）
- 平文の長さの下限はコードで強いない（短いと気付かずに入れなくなるため）。.dev.vars.example に「8 字以上にする」と書いた
- 計画の状態の色に操作の色（`--accent`）は使わず、同意済・訓練済とも緑の薄い印（色は意味にだけ、操作の色は操作にだけ）

### 違えた所

- 触るファイルの外: tools/hooks/rules.test.ts（「scripts は全部通る」のテストを配信の 3 つで分けないと npm test が落ちる）、cloudflare-env.d.ts（env の型）、seed/people.ts（注のゲストの言葉だけ）
- docs/tasks/README.md の 19 行目（この PC の wrangler の注）は古いが、一覧の表のほかは触らない決まりなので残した
- このセッションは care72 の外で始まったので、care72 のフック（.claude/settings.json）は読み込まれていない。配信の 3 つの script は打っていない

### 未確認

- Workers（配信先）での平文の道。Node と next dev（miniflare）でだけ確かめた
- ダッシュボードの Secrets に入れた値が Worker の env に出ること（wrangler の secret と同じはず）
- ログインの回数の制限は無いまま（T27 の残り）
- 実機（iPhone・iPad）での /login

## 11/2 夕方 その 4（Opus。docs/tasks/T02.md: 本人のページ（読む側））

### できた物

| # | 物 | 場所 |
| --- | --- | --- |
| 1 | 本人のページの形: 台帳・連絡先・同意・時計・経過を 医療・避難・人・基本・同意・書類・経過 の区分の行にする（toPersonView）。区分の順（sectionOrder、発災時は経過が一番上）、優先（priorityOf、平時は骨格の段・発災時は TriageResult の色と理由）、欄と台帳の場所の表（FIELDS・sectionOfField）、未確認の一覧（view.unconfirmed） | lib/person.ts |
| 2 | 読み出し loadPersonPage: personInScope を通った人だけ、連絡先・同意（記録した人の名前）・時計・経過（書き手の名前と信号の色）を 1 回の batch で | lib/person.ts |
| 3 | 部品: 上（名前・年齢・介護度・計画・未確認の 1 行と、大きく 優先と理由・医療の印・時計の残り・緊急連絡先）、区分（面の幅で 1〜3 段に流す）、時計、経過、状態の印、未確認の印。状態を持たない | components/person/PersonView.tsx・PersonHead.tsx・Timeline.tsx・parts.tsx |
| 4 | `/people/[id]`: 単独で開く形。範囲の外（違う事業所・無い id・医療班と行政の今）は 404 | app/people/[id]/page.tsx |
| 5 | 担当一覧の右の面: 行を押すと `/?open=<id>` で右に開き、一覧は左に圧縮（優先・氏名・医療の印）。閉じる、別の行で切り替え、ブラウザの戻るで閉じる。狭い幅（lg 未満）は本人のページだけ。範囲の外の open は面に「該当なし」 | app/page.tsx |
| 6 | 担当一覧と共有: 医療の印・ハザード（marksOf・hazardsOf）、URL（caseloadHref・parseOpen・rowLink・closeHref） | lib/caseload.ts |
| 7 | 画面の言葉（区分・連絡先・時計・同意・空欄の理由・経過・書類）。labels.test.ts の言い切る言葉の検査に入る | lib/labels.ts |
| 8 | 状態の 4 色 `--state-ok`・`--state-urgent`・`--state-check`・`--state-unknown`（ライトとダーク）と薄い下地 `-soft`（color-mix）。`--safe`・`--caution`・`--unknown` は置き換えた。`--danger` は誤りと危険な操作の赤 | app/globals.css |
| 9 | テスト 34 件: 10 人全員の区分と値・電話のリンク、山田さんの未確認 3 の場所、10 人の数の一致、数えない空欄、田中・佐藤・伊藤・加藤・渡辺・中村の値、10 人の描画と言い切る言葉、色（時計・印・優先、色の印は文字を持つ）、並び、発災時の口、pending の場所、経過（作る物・並び・信号の色）、D1 の壁（違う事業所・無い id・医療班と行政）、?open= の URL と置き換え、上の時計の残りと緊急連絡先、薬（用量・残り・保管）と機器（電池・予備）、時計の確認の日、連絡先の夜間、空でも全部の欄を出す | lib/person.test.ts、lib/caseload.test.ts |

テストは 414 件（T02 で 34 件足した）。型の検査と `npm run build` も通る。

### 確かめた所

- `npm test` 414 件、`npm run typecheck`、`npm run build`。
- 手元の D1 を `npm run db:reset` で作り直し、`npm run dev`:
  - ブラウザの道具で 一覧 → 山田 ハナを押す → `/?open=p-01` で右に開く（見出しは 担当一覧・山田 ハナ）→ 左の田中 茂を押す → `/?open=p-03` に切り替わり、履歴の数は増えない → ブラウザの戻る → `/` に戻り、右の面が閉じた
  - `/people/p-01` 200、`/people/p-nothing` 404、`/?open=p-nothing` は面に「該当なし」、`?sort=kana` のまま開くと行のリンクも `?sort=kana&open=…`、閉じるは `/`
- 見た目: Chrome（headless）で 一覧・`/?open=p-01`・`/?open=p-03`・`/people/p-01`・`p-04`・`p-07` を 1280px と 768px、ライトとダークで撮って見た。768px の開いた形は本人のページだけ。時計の項目の文字が地の色で消えていた（`text-base` が `--color-base` と重なる。globals.css に 1 行書いた）のを直した。情報を増やしたあと、山田さんの単独のページは 1280px で高さ約 1000px（区分は 3 段）、右の面は 2 段で約 1340px、768px は 2 段
- テストが効くか: 薬の時計に pending を付ける所を外すと 1 件、時計の赤の境目を壊すと 2 件落ちた（戻した）。

### 決めた所（見直してほしい）

- 意味色: 色は意味にだけ使い、状態の 4 色を `--state-*` で持つ。同じ意味は同じ色で、色の印には必ず文字を添え、面全体は塗らない（印・文字・数字・細い帯だけ）。
- ゲストの役は外す（全部ログイン）。T02 ではゲスト向けの表示や導線を増やしていない。外す作業は T02 のあとに別で入れる（lib/auth は触っていない）。
- 本人のページは簡素にしない: 台帳の項目は区分ごとに全部出し、大事な物（優先と理由・医療の印・時計の残り・緊急連絡先）は上に大きく、細かい物（既往・予防接種・経路・段差・ペット・手帳・難病・書類）は小さく、空の面や余白だけの枠を作らず、小さな字と密度で PC の 1 画面に収める（本人・家族のスマホは逆で T10）。
- 情報を多く出す形: 薬は 名前・区分・回数・用量・残り（同じ名前の時計。薬の時計か、インスリンのような物の時計）・保管・印。機器は 名前・内容・回数と、同じ区分の時計（電池・予備）。電源で動く機器（酸素・人工呼吸器・吸引）に時計が無ければ「電池 未確認」。時計は 値・種類・起点・出典・確認の日（confirmed_at）・頼り先。連絡先は 名前・間柄・どこに・車・夜間（夜間可・夜間不可・夜間未確認。来てくれる人だけ）・スマホ・電話・備考。心身は 6 項目と寝たきり・認知症を空でも出す。上の時計の残りは走る時計を短い順（値の無い物は後ろ）。
- 区分の並べ方: 本人のページの幅で段を変える（container query。42rem から 2 段、64rem から 3 段）。CSS の段組みなので、区分は上から下へ流れ、段の高さはそろえない。担当一覧の右の面（1280px で約 54rem）は 2 段、単独のページ（1280px）は 3 段。
- 色の当て方: 時計は長さが 1 日以内なら赤、7 日より短ければ黄、それ以上は色なし、値が無ければ黄（平時は全部の長さで。発災時の残りで塗るのは T13）。医療の印と優先の段の数字は、その区分の時計の色。同意は緑、同意なしは黄（灰にしない）。未確認・支援者なし・中断注意・頼り先 未確認・本人報告の参考扱いは黄。頼り先 確認済は緑。経過は 赤の信号は赤（信号の表の色）、受領・到着・迎え決定は緑、優先修正は黄、時計確認は付けた側（未確認 黄・確認済 緑）、同意は全部同意なら緑・同意なしがあれば黄。電話・診察・配薬・搬送・受持解除・記録・安否確認・入力は色なし（状態でなく行った事のため。文字は太字）。電話のリンクは操作の色 `--accent`。
- 空欄: 台帳の pending は、その欄に黄の「未確認」と理由（不明・未聴取・無回答）を出し、区分の見出しに数える。数は pending の数と同じ（担当一覧の「未確認 N」と合わせる）。pending に無い空の欄も灰の文字で「未確認」と出すが、数えない（まだ入れていない欄）。T03 は view.unconfirmed（区分・場所・理由）と FIELDS・sectionOfField を読めば、問いを区分ごとに並べられる。
- pending の付け方: いちばん長く一致する欄に付ける。薬の残り（`medical.medications.<x>.remaining`）は、その薬の時計の値の欄に付ける。`<x>` は番号か名前で探し、合わなければ、値の無い薬の時計が 1 つだけのときにそこへ（種の山田さんの `warfarin`）。`clocks.<id>` の形も読む。欄の無い場所は区分の終わりに「その他」の行を足す。値のある欄に pending が付いたときは値と「未確認」を両方出して数える。
- 住居は台帳では `basic.housing` だが、仕様書の「画面 2」のとおり避難の区分に出す。夜間支援（`people.night_supporter`）は連絡先の night_ok から（1 の人がいれば名前、0 だけならなし、全部空なら未確認）。
- 配列の欄（薬・機器・ハザード）が空なら「なし」、欄が無ければ「未確認」。連絡先は表に全部あるので、その間柄の人が無ければ「なし」（かかりつけだけは未確認）。特記が無ければ「なし」。台帳の欄は空でも全部行を出す（透析先は透析の人だけ、関係先はほかの区分に出ない連絡先があるときだけ）。
- 経過: 経過の表の行に、種から作れる「入力」（people.created_at、書き手は担当のケアマネ。その場で作った人は医療班）と「同意」（consents の記録の時刻と記録した人ごとに 1 行）を足す。同じ時刻の consent の行が表にあれば作らない。並びは時刻の古い順（発災時も同じ。新しい順にするなら T13 で）。時計の値を確かめた時刻（confirmed_at）は書き手が無いので経過にしない。
- `?open=`: 開くときは履歴に足し、開いている間の切り替えは履歴を置き換える（ブラウザの戻るは一覧に戻る）。「閉じる」は履歴に足す（戻ると開き直す）。open は id の形（英数字・-・_、64 字まで）のときだけ読み、personInScope を通す。範囲の外は面に「該当なし」と出して一覧は残す（`/people/[id]` は 404）。
- 狭い幅は lg（1024px）未満。768px で開くと本人のページだけになり、「閉じる」で一覧に戻る。
- 見出し: 単独のページは名前が h1・区分が h2、右の面は一覧の h1 があるので名前が h2・区分が h3。
- 書類は 計画書・医療要約・本人の1枚 の 3 行に「準備中」。T05〜T07 の画面ができたら行をリンクにする（今リンクにすると 404）。
- 発災時の口: toPersonView に mode "disaster" と TriageResult を渡すと、経過が一番上、優先が色と言葉（至急など）、理由の 1 行、上に細い色の帯。画面からは今は平時だけで呼ぶ（T09 の災害モードで切り替える）。
- 担当一覧の右の「未確認」の名前も押すと右に開く。

### T02 と違えた所

- 「支援の内容」は台帳（Ledger）に欄が無いので出していない。段差・持出品・ペットは出す。欄を足す作業（T03 か T05）で lib/db/types.ts と lib/person.ts の FIELDS に 1 行ずつ足す。
- 触るファイルの外も直した: lib/person.ts（新しい）、lib/labels.ts（言葉）、app/globals.css（意味色）、lib/caseload.test.ts。
- 担当一覧の医療の印は、本人のページと違って色を付けていない（灰の印のまま）。同じ意味は同じ色にするなら、CaseloadRow に印の色を足して一覧にも塗る（T13 の発災時の一覧と一緒が軽い）。

### 未確認

- 実機（iPhone・iPad）、キーボードでの操作、読み上げ。
- 経過の表の行が入ったときの見た目（種に無いので、色はテストで描いただけ）。発災時の形も画面では見ていない（T09）。
- 担当 30〜40 人のとき、左の圧縮した一覧の自分の送りの位置が、行を切り替えたあとも残るか。
- Workers（cf:build・cf:preview）では動かしていない（next build は通る）。
- 本人のページの D1 の往復は 2 回（personInScope と batch 1 回）。

## 11/2 夕方 その 3（Opus。docs/tasks/T01.md: ログインと役、事業所の切替、審査員ログイン、見るだけのゲスト）

### できた物

| # | 物 | 場所 |
| --- | --- | --- |
| 1 | パスワードのハッシュ: Web Crypto の PBKDF2-SHA256・100,000 回（Workers の上限）。形は `pbkdf2-sha256:<回数>:<salt>:<hash>`（base64url）。NFC にそろえる。無い ID にも同じだけ時間をかける | lib/auth/password.ts、bytes.ts |
| 2 | セッション: SESSION_SECRET の HMAC-SHA256 で署名した cookie（HttpOnly・SameSite=Lax・7 日、https のときだけ Secure）。中身は「誰か」（アカウントの id、または審査員と選んだ役）とパスワードの指紋だけ。事業所・役の名前・担当は毎回 D1 から | lib/auth/session.ts、cookie.ts |
| 3 | 役と到達の表: ゲスト・ケアマネ（管理者は印）・行政・医療班・本人・家族・役未選択。開ける画面と、できること（read 読む・save 保存・ai Claude と声・recording 録音の送信） | lib/auth/roles.ts |
| 4 | ログイン・cookie からの役（Principal）・審査員の役選択と選び直し。デモの決まった ID | lib/auth/principal.ts、choices.ts、demo.ts |
| 5 | 事業所の壁: 本人を読むのは personInScope だけ（範囲の外は在っても無くても null → 404）。担当一覧も事業所とケアマネで絞る | lib/auth/scope.ts、lib/caseload.ts |
| 6 | API の守り `denied(principal, need)`: ゲストの保存・Claude・録音は 401、ほかの役で持たない物は 403。別のサイトからの POST は 403 | lib/auth/guard.ts、cookie.ts の isSameOrigin |
| 7 | Next の入口: getPrincipal（1 つの要求で 1 回）、requirePage（開けない役はその役の入口へ）、principalFromRequest（route 用） | lib/auth/server.ts |
| 8 | 画面: /login（ID・パスワード、違えば「認証失敗」）、/login/role（審査員の 4 つ、今の役は枠）、ヘッダー（右上に 事業所名・役・ログアウト。ゲストはログイン、審査員は「審査員」と役変更）、担当一覧を役で、/people/[id]（一覧の行の中身まで）、/staff・/me・/family・/drill は枠 | app/、components/AppHeader.tsx ほか |
| 9 | POST /api/auth/login・logout・role（フォームの POST → 303。JavaScript が無くても動く） | app/api/auth/ |
| 10 | 種: 協力事業所（kind regular、利用者なし、ケアマネ 1 人を空の名前で）、審査員の書き手の行（DEMO_JUDGE_ACCOUNT_ID）、山本の login_id。ハッシュは種に書かず、db:seed が CAREMANAGER_DEMO_PASSWORD_HASH を入れる | seed/people.ts、sql.ts、build-sql.ts |
| 11 | `npm run -s hash-password`: パスワードを標準入力から読み（端末では 2 回、画面に出さない）、ハッシュの 1 行だけを出す | tools/hash-password.ts |
| 12 | テスト 54 件: ハッシュ（形・照合・壊れた形・上限）、署名と期限（書き換え・違う鍵・7 日ちょうど）、鍵の決まり、cookie の属性、ログイン（ケアマネ・審査員・医療班・失敗）、パスワードを変えると切れる、審査員の役の選び直し、役ごとの到達（画面とできることの表、API の 401・403）、事業所の壁、種、hash-password を node で動かす | lib/auth/*.test.ts、tools/hash-password.test.ts |

テストは 380 件（T01 で 54 件足した）。型の検査と `npm run build`（next build）も通る。

### 動かし方（作者がすること）

```sh
npm run -s hash-password   # 審査員の分。パスワードを 2 回（画面に出ない）。出た 1 行がハッシュ
npm run -s hash-password   # 山本の分
# .dev.vars（.dev.vars.example を写す）に 3 つ入れてから
npm run db:reset           # 山本のハッシュが種に入る（「山本のパスワード: 設定済」と出る）
npm run dev
```

- .dev.vars の項目:
  - `JUDGE_PASSWORD_HASH`: 審査員のパスワードのハッシュ（hash-password の 1 行）。審査員の ID はコードの定数で、ここには書かない
  - `SESSION_SECRET`: 32 字以上のでたらめな文字列。例 `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`。空なら手元は開発用の値で動き、console に 1 行出る
  - `CAREMANAGER_DEMO_PASSWORD_HASH`: 山本のパスワードのハッシュ。`npm run db:reset` が種に入れる（Worker は読まない）。変えたら db:reset をし直す。山本の ID は種の login_id
- 平文のパスワードはどこにも書かない。ハッシュも .dev.vars と Cloudflare の secret だけ（seed/generated/seed.sql にも入るが git に入らない）
- 配信（T27）: `JUDGE_PASSWORD_HASH`・`SESSION_SECRET` を secret に。山本のハッシュは remote の種を流すときに環境変数で渡す（build-sql.ts は環境変数を先に見る）
- ゲストは `/` を開くだけ。審査員はログイン → 役選択 → 選んだ役の入口（ケアマネ `/`、医療班 `/staff`、本人 `/me`、家族 `/family`）。ヘッダーの「役変更」で選び直す
- API を足す作業（T03・T10・T12 ほか）は、route の頭で `const { principal } = await principalFromRequest(request); const no = denied(principal, "save"); if (no) return no;`。本人を読むときは `personInScope` を通す

### 確かめた所

- `npm test` 380 件、`npm run typecheck`、`npm run build`（全部の画面が動的）。
- `npm run dev` で（.dev.vars が無いので、この回だけの使い捨てのパスワードを作り、ハッシュを環境変数で渡した。wrangler の `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`。値は消し、種も戻した）:
  - ゲスト: `/` が担当一覧 10 人、ヘッダーに デモ事業所・閲覧・ログイン。`/people/p-01` は 200、無い id は 404。`/staff`・`/family`・`/login/role` は `/` へ
  - ログイン: 違うパスワードは「認証失敗」。別の Origin からの POST は 403。審査員 → 役選択（4 つ。名前は種から）→ ケアマネ → 担当一覧、ヘッダーに ケアマネ 山本・審査員・役変更 → 役変更で医療班 → `/staff`（`/people/p-01` は 404）→ 本人 → `/me` → 家族 → `/family`。役の値を変えた POST は役選択に戻り、審査員でない cookie での役の POST は 403
  - 山本でログイン → 担当一覧、ヘッダーは 管理者 山本。ログインと役選択の画面は入口へ送り返す
  - ログアウト → cookie を Max-Age=0 で消してゲストに戻る。GET のログアウトは 405
  - cookie は `HttpOnly; SameSite=Lax; Max-Age=604800`、手元の http では Secure なし
  - 見た目: ライトとダーク、1280px と 375px（担当一覧・ログイン・役選択・本人のページ）
- 事業所の壁のテストが効くか: personInScope から事業所の条件を外すと 2 件落ちた（戻した）。

### 決めた所（見直してほしい）

- sessions の表を作らず、署名だけのセッションにした。ログアウトは cookie を消すだけで、盗まれた cookie は 7 日まで使える。代わりに毎回 D1 でアカウントを読み、cookie にパスワードの指紋（ハッシュの SHA-256 の先頭 16 字）を入れて、パスワードを変える・アカウントを消すと前のセッションが切れる。審査員の cookie は JUDGE_PASSWORD_HASH を変えると全部切れる
- 管理者は役でなく印（accounts.is_office_admin）。印のあるケアマネはヘッダーに「管理者」。審査員の「ケアマネ（山本）」には管理者の印を付けない（T26 の「最初に戻す」は審査員を別に許す）
- 審査員は accounts の行で入らない（ID はコードの定数、ハッシュは env）。書き手の行（lib/auth/demo.ts の DEMO_JUDGE_ACCOUNT_ID）を種に足し、審査員がどの役で書いても書き手はこの行
- 審査員の医療班は事業所をデモ事業所のまま、受け持ちは空。本人・家族は山田 ハナ（p-01）とその娘（c-01-1）に固定
- ゲストが見る担当一覧は山本の担当。ゲストが開けるのは 担当一覧・本人のページ・訓練記録・本人のスマホの平時（`/me`）で、家族のスマホは開けない
- できることの表: ゲストは read だけ。ケアマネ・行政・医療班は read・save・ai。本人・家族は read・save・recording（録音の分類はサーバーが送ったあとに付けるので ai は持たない）。役を選ぶ前の審査員は何もできない（API は 403）。T10〜T12 で変えるなら lib/auth/roles.ts の表とテスト
- ケアマネが本人のページで読めるのは事業所の中の全員（担当でない人も）。担当一覧は自分の担当だけ。発災時に同じ事業所の人を代わりに見られるように
- 事業所の切替の画面は作っていない。1 つのアカウントは 1 つの事業所で、ログインで決まる。ゲスト・審査員はデモ事業所だけで、事業所の行の kind が demo でなければ何も見せない。協力事業所は見えない
- 協力事業所のケアマネは is_office_admin = 1（T30 でケアマネ追加と割当をできるように）。login_id とハッシュは空のまま
- 「配信の build では SESSION_SECRET が無いと起動時に止まる」は、最初の要求で止まる形（Workers は env を要求の中でしか読めない）。どの画面もヘッダーが鍵を読むので全部の画面が 500 になる。32 字未満も止まる。`npm run cf:preview` も NODE_ENV=production なので SESSION_SECRET が要る
- Secure は要求の URL が https のときだけ（NODE_ENV で決めない）。cf:preview の http://localhost でも cookie が使える
- 審査員の ID は大文字と小文字を分ける。T30 のケアマネ追加では `isReservedLoginId`（lib/auth/demo.ts）で審査員の ID を使わせない
- ハッシュの区切りは「:」（dotenv の「$」の展開を避ける）。パスワードは 8 字以上（hash-password が断る）
- ログインの失敗は「認証失敗」だけで、ID とパスワードのどちらが違うかは出さない
- ヘッダーをルートの layout に置いた（T09 の「app/layout.tsx（ヘッダーの印）」に合わせた）。本人・家族のスマホの画面にも出る（審査員が役変更できるように）。本人・家族の画面の上をどうするかは T10・T11 で
- 担当一覧の名前を `/people/[id]` へのリンクにした（T02 で右の面 `?open=` に変える）
- 主のボタン（ログイン）と選んだ印の枠に操作の色 `--accent` を足した（ライト #2a5d8f、ダーク #8db8e4）。塗りのボタンの押したときは、地の色を残して灰色を重ねる（`data-press="overlay"`）

### T01 と違えた所

- sessions の表は作っていない（上）。migration は変えていない
- 「起動時に止まる」は最初の要求で止まる（上）
- 本番のアカウントの作り方（管理者がケアマネを足す）は作っていない。T30 で。それまでは種と hash-password で
- `/me`・`/family`・`/drill`・`/staff` は T10・T11・T17・T23 の入口の枠だけ（「準備中」「なし」）

### 未確認

- 本物の .dev.vars を置いた形（作者が作る）。wrangler は .dev.vars があればそれを読む作りで、今回は process.env で渡した
- Workers（cf:preview・配信）での PBKDF2 100,000 回の時間と Web Crypto の動き。Node でだけ確かめ、cf:build と cf:preview は流していない
- ログインの回数の制限は無い（総当たりへの守りは PBKDF2 の遅さだけ）。配信の前に T27 で、Cloudflare の rate limiting の規則か、失敗の数を D1 に数える形を決める
- hash-password の 2 回入力を Git Bash の mintty で試していない。mintty では node が端末と分からず、打った字が見えることがある。Windows Terminal か PowerShell で打つ（管から渡す形はテストした）
- `/me`・`/family` を開いたゲスト・本人・家族の画面の大きな文字・赤緑（T10・T11）、ゲストに「最初に戻す」を押させない（T26）、訓練記録の再生（T17・T26）

## 11/2 夕方 その 2（Opus。docs/tasks/T31.md: フック・Skill・Claude Code の記録）

### できた物

| # | 物 | 場所 |
| --- | --- | --- |
| 1 | 命令の文字列を単純な命令に分ける所: 引用符の中（commit の文）は 1 語、ヒアドキュメントは中身、`$( )` と ` ` は別の文。Bash と PowerShell | tools/hooks/shell.ts |
| 2 | 止める決まり: 手元でない wrangler と opennextjs-cloudflare deploy、.env・.dev.vars を読む・書く命令と道具（.example は通す）、force push・rebase・pull --rebase・commit --amend・reset --hard・gh pr merge の rebase と squash。`bash -c`・`node -e`・`npm run`（package.json の中身）の中も見る | tools/hooks/rules.ts |
| 3 | PreToolUse のフック: 止めるときは理由を stderr に書いて 2 で終わる。読めない入力も止める | tools/hooks/guard.mjs、.claude/settings.json |
| 4 | PostToolUse のフック: .ts・.tsx を Write・Edit したら tsc --noEmit を流し、誤りの先頭 30 行を返す | tools/hooks/typecheck.mjs、.claude/settings.json |
| 5 | テスト: 止める命令・通す命令の一覧（Bash・PowerShell・Read など）、script を node で動かして終わりの番号と理由、settings.json の形、CLAUDE.md のフックの行と rules.ts の一覧の一致、SKILL.md の形と中に書いたファイル・npm run の名前 | tools/hooks/rules.test.ts、shell.test.ts、tools/claude-code.test.ts |
| 6 | Skill 2 つ: triage-rule（ルールの表に行を足す）、task（docs/tasks の作業の始め方から取り込みまで） | .claude/skills/ |
| 7 | Claude Code の使い方の記録: 数字（b2c92e1 の時点）、分担、進め方の型、フックと Skill、モデルの使い分け、使っていない物。README から 1 行 | docs/CLAUDE_CODE.md、README.md |
| 8 | CLAUDE.md の「守ること」にフックで止まる物の 1 行、「動かし方」の wrangler の手元の命令。.gitignore に .claude/settings.local.json | CLAUDE.md、.gitignore |

テストは 326 件（T31 で 187 件足した）、型の検査も通る。

### 確かめた所

- settings.json の command を Git Bash で同じ形に動かした: `wrangler deploy` → 2 と理由、`wrangler d1 execute DB --local …` → 0、`cat .dev.vars` → 2 と理由、`npm run db:reset` → 0。
- 型の検査のフック: 型の誤りのある .ts を置いて 2 と誤りの行（置いた物は消した）、誤りが無ければ 0。どちらも 8.8 秒。
- 前のフックは 1 回 0.35 秒ほど（node の起動だけで 0.2 秒）。
- `npm test` 326 件、`npm run typecheck`。

### 決めた所（見直してほしい）

- wrangler は止める物の一覧でなく、通す物の一覧にした: dev・types・help・version・d1 migrations create と、--local を付けた d1 execute・d1 migrations apply|list・r2 object・kv key|bulk。ほかは全部止まる（secret list・d1 list・versions upload も）。「手元は --local だけ」をそのまま形にするため。--local の無い d1 execute も止まる（wrangler 4 の既定は手元だが、付け忘れを残さない）。
- .env・.dev.vars は、命令の名前を問わず、語にその名前があれば止める（cat・type・Get-Content・grep・cp・git add も）。通すのは中身を読まない ls・test・Test-Path・Get-ChildItem と git check-ignore だけ。リダイレクトの行き先は命令を問わず止める。.env.local・.dev.vars.review のような名前も止め、.example は通す。`cp .dev.vars.example .dev.vars` も止まる（.dev.vars を作るのは人）。
- Bash だけでなく PowerShell の道具と、Read・Write・Edit・NotebookEdit・Grep のパスも見る。Claude がファイルを読むのは cat より Read が多いため。
- 止める物を足した: git pull --rebase（rebase と同じ）、gh pr merge --rebase・--squash（docs/tasks/README.md の「merge commit を残す」）、opennextjs-cloudflare deploy・upload（中で wrangler deploy を呼ぶ）、wrangler の --remote。CLAUDE.md の行にも足した。
- 型の検査は npm を通さず node で tsc を直接呼ぶ（npm を通すと 9.6 秒、直接で 8.3 秒、書いたあとで 8.8 秒）。全体で 10 秒の内なので、変わったファイルだけには絞っていない。lint はリポジトリに無い。
- フックの command は shell の形（`node "${CLAUDE_PROJECT_DIR}/tools/hooks/guard.mjs"`）。公式の文書にある exec の形（args）と onFailure は、この PC の CLI（2.1.202）で効くか確かめられないので使っていない。args が効かない版では node が入力を JS として読んで 1 で終わり、止まらずに通ってしまうため。
- フックの中で落ちたとき・入力が読めないときは止める（2）。node が起動できないときは止められない（docs/CLAUDE_CODE.md の「届かない所」）。
- 配信（T27）でも、Claude Code が打つ wrangler deploy・secret put・d1 create はフックが止める。配信の命令は作者が自分の端末で打つか、T27 の始めにフックの扱いを決める（rules.ts と CLAUDE.md の行を一緒に直す）。
- Skill triage-rule の「テストを先に」は、落ちるテストを `it.fails` で commit してから中身を書く形にした。npm test が通ってから commit する決まりと、テストが先にあったことを履歴に残すのを両立するため（cd0ebcb は落ちるテストのまま commit していた）。
- docs/CLAUDE_CODE.md の数字は b2c92e1 の時点。足した行は Co-Authored-By で分け、13:08〜13:30 の 8 件は作業の記録どおり Opus に数えた。effort の xhigh は git に残らないので「作者の設定の記録」と書いた。

### T31 と違えた所

- フックの入口は tools/hooks/guard.mjs と typecheck.mjs、決まりは rules.ts と shell.ts に分けた。決まりを .ts にしたのは型の検査とテストに入れるため（allowJs が false なので .mjs は型の検査に入らない）。node 24 は .ts をそのまま読む（seed/build-sql.ts と同じ）。
- 止める物を足した（上）。T31 の「守ること」のとおり CLAUDE.md も直した（T31 の「触るファイル」に CLAUDE.md は無い）。
- 「人が書いた行とエージェントが書いた行」は Co-Authored-By で数えた。人の commit の行は 0（GitHub の雛形だけ）なので、表はモデルごとに分けた。
- Sonnet の機械的な直しと MCP は使っていないので、「使っていない」とだけ書いた。

### 未確認

- Claude Code の中でフックが本当に止めるか。このセッションは care72 の外で始まったので、care72 の .claude/settings.json は読み込まれていない。次に care72 で開いたセッションで、`wrangler whoami` を頼んで止まること、`/hooks` に 2 つ出ることを見る。
- `/triage-rule`・`/task` が `/skills` の一覧に出るか（同じ理由）。
- 初めてフックを読み込むときに、Claude Code が確かめを求めるか。
- Git Bash の無い Windows での動き。shell の形の command は Git Bash が無いと PowerShell で動き、`${CLAUDE_PROJECT_DIR}` が展開されるかを見ていない（展開されなければ script が見つからず、止まらない）。
- 型の検査は画面が増えると伸びる。10 秒を超えたら、変わったファイルだけにするか外す。.ts を続けて書くと、そのたびに 9 秒ほど待つ。
- Claude Code の版が 2.1.295 より新しくなったら、onFailure: "block" を足して、フックが落ちても止まる形にできる。

## 11/2 夕方（Opus。docs/tasks/T00.md: Claude と Gemini を呼ぶ層、鍵の置き場、1 日の上限）

### できた物

| # | 物 | 場所 |
| --- | --- | --- |
| 1 | 赤の状態の言葉を「至急」、担当一覧の並びの列名を「優先」に（医療の高リスクな使い方を避けるため。docs/DECISIONS.md「119 の案内と画面の言葉」）。画面の言葉に「危険」「診断」「判定」「重症」が入らないテスト | lib/labels.ts、app/page.tsx、lib/labels.test.ts、docs/TRIAGE.md、CLAUDE.md の色の行 |
| 2 | モデルと用途の既定: 様式の読み取り・監督・採点は Opus 5.5、入れる欄・要約は Sonnet 5.5、ペルソナ・分類は Haiku 5.5。用途ごとに effort・max_tokens・待ち時間 | lib/claude/models.ts |
| 3 | client: env の鍵だけで作る。鍵が無い（空・空白も）と AiNotConfigured。SDK の再試行 1 回 | lib/claude/client.ts、lib/claude/errors.ts |
| 4 | askJson: 入力は lib/pseudonym の印付きの物か、それに名前を付けて並べた物だけ（型と実行時）。JSON の形は構造化出力で縛り、返った物を zod で検査。戻りは { ai: true, model, purpose, value }。どの用途にも先に付ける指示（COMMON_SYSTEM: 仮名を推し量らない・診断や薬の量を言わない・下書き） | lib/claude/call.ts |
| 5 | ai_calls の表と 1 日の上限: 呼ぶ前に 1 行足し（上限の内のときだけ、1 つの SQL で）、終わったら状態と token。本文は残さない。失敗も数える | migrations/0001_init.sql、lib/db/types.ts、lib/claude/usage.ts |
| 6 | 声: 仮名の文を「あなた」で読ませて WAV にする。key を渡せば元の氏名・電話が残っていないか確かめてから送る。Claude と同じ上限に数える | lib/gemini/tts.ts |
| 7 | 鍵の置き場: .dev.vars.example（値は空）、CloudflareEnv の型、/api/health の ai: { anthropic, gemini }（true/false だけ）、配信先で env・D1・事業所から渡す形を作る aiContextFor | .dev.vars.example、cloudflare-env.d.ts、app/api/health/route.ts、lib/claude/cloudflare.ts |
| 8 | テスト: 本物の API を呼ばず偽の client を渡す。鍵なし・上限・形の違う返事・JSON でない・切れた・断られた・時間切れ・仮名でない入力（@ts-expect-error と実行時）。ai_calls は node:sqlite を D1 の形で包んで同じ SQL を流す | lib/claude/*.test.ts、lib/gemini/tts.test.ts、lib/db/test-d1.ts |
| 9 | 依存: @anthropic-ai/sdk 1.3.0・@google/genai 2.32.0・zod 4.6.7 | package.json、THIRD_PARTY_NOTICES.md |

テストは 139 件、型の検査も通る。

### 動かし方（鍵の入れ方）

```sh
cp .dev.vars.example .dev.vars   # 値を入れる（.dev.vars は git に入らない）。鍵をチャット・commit に貼らない
npm run db:fresh                 # migration 0001 に ai_calls を足したので、前に db:reset した手元は作り直す
npm run dev                      # /api/health の ai が鍵の有無を true/false で出す
```

- 配信先は Cloudflare の secret（T27。`wrangler secret put` は配信のときだけ作者と）。
- 呼ぶ側（あとの作業）の形:

```ts
const ctx = await aiContextFor(officeId);          // lib/claude/cloudflare.ts
const { payload } = pseudonymize([input]);         // 印付きの物だけ渡せる
const r = await askJson({ purpose: "classify", system: PROMPT, input: pseudonymizeText(text, key), schema }, ctx);
// r.ai === true、r.model は答えたモデル。画面に「AI」の印を出す
```

- 上限を超えたら AiLimitReached（訓練は終わった記録の再生に切り替える）。鍵が無ければ AiNotConfigured（画面は「AI 未設定」）。

### 確かめた所

- `npm test` 139 件、`npm run typecheck`。
- `npm run db:fresh` で手元の D1 に ai_calls ができた。`npm run dev` で /api/health が `ai: { anthropic: false, gemini: false }`（.dev.vars を置いていない）、担当一覧の列名が「優先」（確かめたあと止めた）。
- `npm run cf:build` と `opennextjs-cloudflare preview`（手元の workerd、`--remote` なし）で、2 つの SDK を読む一時の route が動き、client を作れて、D1 からデモ事業所を読めた（API は呼んでいない。route は消した）。@google/genai は web の入口から読むので google-auth-library は束ねられていない。

### 決めた所（見直してほしい）

- 1 日の上限は Claude と声（Gemini TTS）を合わせて数える（用途 voice）。費用の守りを 1 つにするため。
- AI_DAILY_LIMIT はデモ事業所だけに効く（T00 の「デモ事業所は環境変数で変えられる」の読み）。ほかの事業所は 200 のまま。0 以上の整数でない値は 200。0 ならその日は呼ばない。
- 失敗した呼び出しも上限に数える。呼ぶ前に足した行が落ちて pending のまま残っても数える（多めに止まる方に倒した）。鍵が無いときは行を足さない。
- 断られたとき（stop_reason が refusal）に、Opus と Sonnet はサーバー側で別のモデルに回す（`fallbacks: "default"`、beta `server-side-fallback-2026-07-01`。skill claude-api の既定）。Haiku には回す先が無いので送らない。印の model は答えたモデル（回った先）。回したくなければ lib/claude/models.ts の SERVER_FALLBACK_MODELS を空にする。
- 形の違う返事は送り直さず AiBadOutput（送り直すと費用と上限が倍になる）。再試行は SDK の 1 回（429・5xx・つながらない）だけ。
- thinking・temperature は送らない（Opus 5.5 は考えるのを止められず、温度は 400）。考える深さは effort だけで決める。
- askJson の入力は印付きの物 1 つか、印付きの物に名前を付けて並べた物（`{ 本人: payload, 話した文: text }`）。並べた物の中に印の無い物が 1 つでもあれば止まる。入力は JSON の文字列にして user の 1 通で送る。
- 印付きの物を `{ ...x }` で写すと、型では印付きに見えるが印は付いていない（印は lib/pseudonym の WeakSet）。実行時の確かめで止まる。
- 声の読み方: 仮名（A さん）は「あなた」、伏せた所の印は（氏名）→「その方」、（町名）→「近く」、（電話）→「電話番号」。家族役の言葉で本人を指すときは仮名でなく続柄（妻・母）で書くこと（仮名だと「あなた」になる）。T18・T21 で守る。
- 声のモデルは gemini-3.8-flash-tts、既定の声は Kore、WAV で受け取る。Gemini API の音声生成の案内（Interactions API）に合わせた。声の SDK の待ちは 60 秒、再試行は SDK の既定。
- ai_calls の input_tokens はキャッシュの読み書きの分も足した数。
- .dev.vars.example に TURNSTILE_SECRET は入れていない（T00 と T27 の一覧に無い）。使うときに足す。

### T00 と違えた所

- @anthropic-ai/sdk のライセンスは MIT でなく Apache-2.0（1.0.0 から。npm view と同梱の LICENSE で確かめた）。決まり（MIT・Apache-2.0・OFL）の中なので入れた。
- zod（MIT）を足した。構造化出力の形を書く SDK の zodOutputFormat が使い、返った物の検査にも使う。
- 「tool use か構造化出力」のうち構造化出力だけ。tool_choice で呼ぶ道具を決める書き方は Opus 5.5・Sonnet 5.5 で 400 になる。
- 失敗の種類に AiRefused・AiBadOutput・AiCallFailed を足し、lib/claude/errors.ts に置いた。env を読むのは lib/claude/cloudflare.ts に分けた（client.ts は env を受け取るだけ）。テストで Cloudflare に触らないため。

### 未確認

- 本物の API は 1 回も呼んでいない（鍵を置いていない）。Opus・Sonnet・Haiku の構造化出力、fallbacks、Gemini の Interactions API の返す音声の形は、鍵を入れてから最初の作業（T03・T12・T21）で確かめる。
- 鍵を .dev.vars に入れたときに /api/health が true になるか（next dev と preview が .dev.vars を読む作り。値を置いていないので見ていない）。
- SDK の zodOutputFormat は enum を JSON Schema の説明文に回す（文法では縛らない）。違う値が返れば zod の検査で AiBadOutput になる。分類（T12）で違う値が多いなら、形の書き方を見直す。
- 様式の読み取り（T08）は写真・PDF を渡すが、askJson は今 JSON の文字列しか送らない。白紙の様式は個人の情報ではないので、lib/pseudonym に「個人の情報の無い物」の印を付ける道と、画像・PDF の入れ方を T08 で足す。
- 呼び出し 1 回の長さ（Opus の採点 180 秒・再試行で最長 360 秒）が Workers の 1 要求に収まるか。長い処理は刻んで呼ぶ決まり（CLAUDE.md）なので、T19・T22 で 1 回を短くする。
- 同時に呼んだときの上限の超え方: 数えると足すは 1 つの SQL だが、D1 での同時の要求は試していない。
- 間接の依存に Apache-2.0（google-auth-library・gaxios ほか。web の入口では使わない）、BSD-3-Clause（protobufjs の一式）、Unlicense（fast-sha256）が入った。案 8 の読み（決まりは直接の依存）のまま。
- npm audit の 5 件は前と同じ（足した依存では増えていない）。

## 11/2 午後 その 2（Opus。ルールの表の案 1〜6・9 を入れた。docs/DECISIONS.md「色と連絡順」）

下の「問い（作者へ）」1〜9 は、どれも設計の側の案で実装した（確認待ち）。案はまだ作者の確認前なので、ルールの表の「案」の行は本運用に使わない。

### できた物

| # | 物 | 場所 |
| --- | --- | --- |
| 1 | 台帳に人が付ける 2 つの欄: 時計の頼り先（透析先・冷蔵・配達）と確認（確認済・未確認）、本人の報告を当てにしない印。付けた・外したの経過の kind（clock_check・self_report_mark）と、その行を作る関数（書き手は人の役だけ）。種は 3 田中の透析が透析先 未確認、4 佐藤に印 | migrations/0001_init.sql、lib/db/types.ts、seed/people.ts、lib/ledger-marks.ts |
| 2 | ルールの表の入力を時刻に: 今・発災・停電の始まりと、信号ごとの時刻と出どころ。信号は 1 人ぶんの全部を受ける | lib/triage/index.ts |
| 3 | 案 1〜6 の行、理由に足す言葉（透析先 未確認・本人の緑は参考・支援者なし）、並びの鍵（色 → 時計の残り → 支援者なし → 骨格の段 → id）。行・足す言葉・並びは配列に持つ | lib/triage/index.ts、lib/triage/triage.test.ts |
| 4 | 受け入れのテスト: 大雨の筋（レベル 3 → 4 → 浸水と停電）を 10 人に流し、停電から 0・1・3・6・30・72 時間の並び・色・理由を全部確かめる | lib/triage/heavy-rain.test.ts |
| 5 | docs/TRIAGE.md: ルールの表を人が読める表に。コードから作り（npm run docs:triage）、違えば npm test が止まる。README からリンク | lib/triage/doc.ts、build-doc.ts、doc.test.ts |
| 6 | 担当一覧の読み込みに新しい列。平時の画面は変えていない | lib/caseload.ts |

テストは 110 件が通り（it.todo は無くなった）、型の検査も通る。

### 動かし方の足し

- migration 0001 を直したので、前に db:reset した手元は `npm run db:fresh`（.wrangler/state/v3/d1 を消してから db:reset。--local だけ）。
- `npm run docs:triage` で docs/TRIAGE.md を作り直す。ルールの表の行・言葉を変えたら流す。

### 決めた所（見直してほしい）

- 案 1 を未知にも広げた: 未知 ＋ 頼り先が未確認 → 黄「透析先 未確認、未確認 N 時間」。緑で黄なのに未知で灰だと、無事と言った人が連絡の無い人より上に並ぶため。案 1 の「押すまで黄が残る」とも合う。
- 案 1 の確認は時計が走っていなくても効く（停電していなくても、冷蔵が未確認なら黄）。ほかの行で色が決まったときも理由に「透析先 未確認」を足す（赤でも）。
- 案 3 の黄の理由は、案の「電池を超えて動いている。確認」でなく「電池が切れたあとに緑の報告、酸素 内蔵電池 2 時間を超過」にした。「動いている」は推し量りで、理由の 1 行は台帳の値と時計の事実だけにするため。赤は案のとおり「緑の報告のあとに電池が切れた」に時計を添えた。
- 案 3 の「切れる前の報告」は、切れる時刻ちょうどの報告を含む（ちょうどはまだ超えていない、の読み方に合わせた）。
- 案 2・3 の「機器の時計」は種類が機器（A）の時計（始まりが停電か発災かを問わない）。前は停電で走る機器だけを見ていた。種の 10 人では変わらない。
- 案 4 で使わない本人の緑は、本人（self）と訓練の本人役（agent）。ケアマネが入れた緑は使う。いちばん新しい信号がその緑なら理由に「本人の緑は参考」（支援者の緑のあとに本人の緑が来たときも足す。色は支援者の緑で緑）。
- 信号は今までの中で時刻のいちばん新しい物を使う（同じ時刻ならあとに入れた物）。今より後の信号は使わない（訓練の早送りで先の信号が入っていても）。未知の信号（ケアマネの「つながらない」など）は未知。
- 理由の言い方は信号の出どころから: 「家族が「無事」」「支援者が「無事」」。
- 「支援者なし」は色を問わず理由に足す。足す順は 透析先 未確認 → 本人の緑は参考 → 支援者なし。
- 時計が切れる時刻ちょうどの理由は「残り 0 分」にした（前は色が黄なのに「超過」と出ていた）。
- 大雨の筋の時刻: レベル 3 を発災（停電の 2 時間前）、レベル 4 は 1 時間前、浸水と停電を 0。信号と時刻は heavy-rain.test.ts の頭に書いた。
- 人が付ける欄の経過を書けるのは ケアマネ・医療班・行政 だけ（system・本人・家族の役では作れない）。
- 人が付ける欄は台帳の JSON（Ledger）に入れず表の列に持った。Ledger・Claude に渡す型（ClaudePerson・ClaudeClock）・仮名化の入れる形にこの欄の名前を足すと、型の検査で止まる（pseudonym.test.ts）。

### 指示・案のとおりに作れなかった所

- 「小林 未知 3 時間で赤」: 停電 3 時間ちょうどは呼吸器の電池（3 時間）をまだ超えていないので黄にした（「超えた」はちょうどを含まない、の今の読み方。「12 時間までは灰」と同じ）。3.1 時間からは赤、6 時間は赤。ちょうどで赤にするなら「超えた」だけ ちょうどを含む読み方に変える（「半分を過ぎた」と分かれる）。決めてほしい。
- 「佐藤 娘の緑は緑」: 種の佐藤に娘はいない（民生委員と県外の息子）。筋では民生委員（支援者）の緑にした。家族の緑で緑になることは triage.test.ts で確かめた。
- 「伊藤 同じ残りなら先」: 種の 10 人に、伊藤と時計の残りが同じ人がいない（伊藤 5 日、加藤・渡辺 7 日）。種は仕様書の 10 人なので変えず、支援者の有無だけが違う架空の 2 人で確かめた（triage.test.ts の案 5）。筋では伊藤は灰の中で加藤・渡辺より上で、理由に「支援者なし」が出る。
- 「山田 赤＋録音で最上位」: うめき声は分類で不明（案 9）なので「赤だけ」の組で、けが・動けないの組ではない。赤の組の中で酸素の電池の残りが小林より短いので一番上になる。
- 担当一覧（平時）には理由の 1 行が出ていないので、画面は変えていない。理由の 1 行は発災時の一覧を作るときに出す。

### 確かめた所

- `npm test` 110 件、`npm run typecheck`。
- `npm run db:fresh` で手元の D1 を作り直し、新しい列（佐藤の印、田中の透析先 未確認）が入った。`npm run dev` で担当一覧に 10 人が前と同じ緊急度の順で出て、/api/health も返った（確かめたあと止めた）。
- 受け入れのテストが効くか: 案 4 をわざと外すと大雨の筋のテストが 3 件落ちた（戻した）。
- docs/TRIAGE.md を作り直さずにコードの言葉を変えると doc.test.ts が落ちた（作り直して通した）。

### 未確認

- 画面は変えていないので、見た目（ライト・ダーク）は見ていない。
- 発災時の一覧と本人のページが無いので、ルールの表はまだ画面から使っていない。頼り先の確認と本人の印を付ける画面も無い（経過の行を作る関数だけ）。
- 確認済を発災のたびに未確認へ戻すか、確認に期限を付けるか（今は人が戻すまで確認済のまま）。
- 本人の報告を当てにしない人の、本人の赤の扱い（案 4 のとおり赤のまま。空振りは電話 1 本）。

## 11/2 午後（留守中のエージェント）

### できた物

| # | 物 | 場所 |
| --- | --- | --- |
| 1 | Next.js 16（App Router）・TypeScript・Tailwind 4 と OpenNext（@opennextjs/cloudflare）の骨組み。D1（DB）と R2（RECORDINGS）の binding は名前だけ。/api/health で binding が見えるか | package.json、wrangler.jsonc、next.config.ts、open-next.config.ts、app/ |
| 2 | D1 の表と型: 事業所・アカウント（ケアマネ・行政・医療班・審査員）・本人（台帳は JSON の列、氏名・カナ・生年月日・事業所・担当は列）・連絡先・同意 4 つ・時計・訓練・訓練の出来事・信号・経過 | migrations/0001_init.sql、lib/db/types.ts |
| 3 | 種のデータ: 架空の 10 人とデモ事業所・ケアマネ 山本 | seed/people.ts、seed/sql.ts |
| 4 | 仮名化の層: A さん・役割名、渡す項目は書いた物だけ、凍結と印、漏れの見張り | lib/pseudonym/ |
| 5 | ルールの表: 色・理由 1 行・並び・ケアマネの上書き。テストを先に書いた（commit cd0ebcb → 01ec4dd） | lib/triage/ |
| 6 | ケアマネの担当一覧（平時）: 10 人が D1 から並ぶ。緊急度・氏名・年齢・計画で並び替え | app/page.tsx、lib/caseload.ts |

テストは 55 件が通り、表に行が無くて決めていない 5 件を it.todo に置いた（下の問い）。型の検査も通る。

### 動かし方

```sh
npm install
npm run db:reset   # 手元の D1 に表を作り、10 人を入れる（--local だけ。何度流しても同じ）
npm run dev        # http://localhost:3072 に担当一覧
npm test           # vitest
npm run typecheck
```

- wrangler の命令は全部 `--local`。配信の script（deploy）は置いていない。
- `npm run db:seed` は seed/people.ts から seed/generated/seed.sql（git に入れない）を作って流す。
- `npm run cf:build` は OpenNext の build（手元だけ）。`cf:preview` は build のあと手元の Workers で開く。

### あとで本物にする所

- wrangler.jsonc の `database_id` は仮の `00000000-0000-0000-0000-000000000000`。Cloudflare のアカウントを作り、D1 を作ってから本物の id に替える。R2 の bucket 名（care72-recordings）も同じとき。`account_id` は書いていない。
- `compatibility_date` は 2026-10-01 にした。配信の前に見直す。
- ログインは無い。担当一覧は「事業所の最初のケアマネ」を出している。審査員・協力事業所・行政・医療班のアカウントは種に入れていない。

### 確かめた所

- `npm run dev` で担当一覧と /api/health が返る（wrangler の `--local` で入れた D1 と、next dev が読む D1 が同じ）。
- `npm run cf:build`（OpenNext の build）が Windows で通り、`opennextjs-cloudflare preview`（手元の wrangler dev、`--remote` なし）で同じ 10 人が出た。OpenNext は「Windows では完全には動かない、WSL を勧める」と警告を出す。配信の build は WSL か CI でするのがよい。

### 未確認

- 配信（Cloudflare のアカウント、本物の D1・R2、`--remote` の migration）。
- 見た目はライトとダークを 1280px の幅で見ただけ。スマホの幅、キーボードでの操作、読み上げは見ていない。
- 書体（BIZ UDPGothic）は next/font/google が dev と build のときに取り込むので、ネットが要る。
- npm audit が 5 件（glob・minimatch。@opennextjs/aws → @node-minify/core の build のときだけ使う物）。直すと OpenNext が 0.3 に下がるので、そのまま。
- npm 11 の allowScripts で esbuild と workerd の postinstall が走っていない。wrangler も esbuild も動いたので、承認はしていない。

### 詰まった所と理由

- `next dev` がリポジトリの根に AGENTS.md（Next.js の案内）を書いた。決まりは CLAUDE.md にあるので、next.config.ts の `agentRules: false` で止めて消した。
- 日本語の書体の切れ端を 74 本も先読みしていた。`preload: false` にした。
- OpenNext で 1 時間以上止まった所は無い。Vite + Hono には切り替えていない。

### 決めた所（見直してほしい）

- 同意 4 つは「名簿登録・計画の共有・支援者への提供・医療班への提供」にした。仕様書には松山市の 4 つ（名簿登録・計画の共有・実施者ごと・組織）と、機能の 3 つ（支援者への提供・医療班への提供・発災時の電話）の 2 通りがあり、種の 7（支援者への提供に同意しない）と 9（医療班への提供に同意しない）を両方出せる組にした。松山市の「実施者ごと」は「支援者への提供」に当て、「組織」は別に持っていない。
- 時計の 4 つ（A 機器・B 物・C 薬・D 本人の状態）は 10 人の表の印のとおり。透析の「次の回まで 2 日」は B（物）。インスリンは「冷蔵が切れて時計が走る」に合わせて停電で走る。降圧薬の「週単位」は 1 週。山田さんのワーファリンは残りの日数が未確認なので値を空けた。
- ルールの表の読み方: 「超えた」「過ぎた」はちょうどを含まない（「12 時間までは灰」に合わせた。2 時間の電池なら、緑で「残り 1 時間」ちょうどはまだ緑で、過ぎたら黄）。「機器の時計」は種類が機器（A）の時計だけ。停電していないときの停電の時計は止まったままで、並びの「残り」は全部の長さ。
- 並びの最後の決め手は id（同じ色・同じ残り・同じ骨格のとき）。
- 上書きは理由が要る。上書きしたときより表の色が悪くなったら切れる。ただし上げた色より下げはしない。上書きは経過（timeline_entries の kind = override）に残す形にした（まだ書いていない）。
- 寝たきり = 台帳の「寝たきり」か、歩行が「困難」。支援者 = 避難支援等実施者の順（supporter_order）がある連絡先。
- 「家族 2」は家族があと 2 人と読み、田中さんに長男・長女、高橋さんに息子・孫を足した。
- 赤の 4 問の「家」は「家にいるか」と読んで at_home にした。問いの言い方が決まったら直す。
- 仮名化: 住所は町名も渡さない（仕様書は町丁目まで渡してよいとしているが、今の使い道ではハザードで足りる）。自由文の町名は「（町名）」、避難先の名前の中の町名も伏せる。同じ姓の人が何人かいるときの姓だけは本人を優先し、決められなければ「（氏名）」。台帳に無い名前が自由文にあると残る（電話番号らしい並びは伏せる）。
- 担当一覧の「緊急度」は、平時は骨格の段（1〜8）を数で出し、名前は数に重ねると出る。既定の並びは緊急度の順。
- 録音の分類は CLAUDE.md の 5 つ（けが・動けない・水が来た・機器が止まった・不明）だけにした。「うめき声」「黙っている」は不明に入る。

### 問い（作者へ）

11/2 午後 その 2 に、全部設計の側の案で実装した（確認待ち。今の決まりは docs/DECISIONS.md「色と連絡順」「仮名化・同意・個人情報」）。各行の末尾の → がその中身。

1. 3 田中さん「緑だが透析先が未確認で黄」が、ルールの表のどの行にも当たらない。表のままだと緑のまま。足すなら「緑だが機器以外の時計の半分を過ぎた → 黄」か、ケアマネが付ける「要確認」の印か。
   → 案 1 で実装した（確認待ち）。時計の頼り先と確認の欄、未確認なら緑でも黄「透析先 未確認」。未知にも広げた
2. 未知で機器以外の時計（透析・インスリン・栄養剤・薬）が切れたとき、表のままだと黄のまま。赤に上げるか。
   → 案 2 で実装した（確認待ち）。赤
3. 緑のまま機器の時計が切れた（電池を超えた）とき、表のままだと黄。赤に上げるか。
   → 案 3 で実装した（確認待ち）。緑の報告のあとに切れたら赤、切れたあとの報告なら黄（黄の言い方は時計の事実に変えた）
4. 4 佐藤さん（認知症で本人の信号が当てにならない）の緑を、緑のまま受けるか。表に行が無い。
   → 案 4 で実装した（確認待ち）。本人の報告を当てにしない印、本人の緑は未知「本人の緑は参考」
5. 5 伊藤さん「灰だが支援者なしで次に上がる」: 骨格はステロイドの 5 が先に効き、寝たきり・支援者なしの 7 は出てこない。並びに出すなら何で。
   → 案 5 で実装した（確認待ち）。並びの鍵に「支援者なし」（時計の残りのあと、骨格の段の前）、理由に「支援者なし」
6. 入力の「警戒レベル」と「最後の連絡からの経過時間」は、表に使う行が無いので入れていない。理由の「未確認 N 時間」は発災からの時間で出している。
   → 案で実装した（確認待ち）。入力に持たないまま。信号の時刻と停電の始まりの時刻は入力に足した（案 3 に要る）
7. 同意 4 つの決め方（上の「決めた所」）。松山市の「組織」を別に持つか。
   → 案 7 で実装した（確認待ち）。4 つのまま、変えていない
8. 依存のライセンス: 直接の依存は MIT・Apache-2.0 だけ（THIRD_PARTY_NOTICES.md）。間接の依存には ISC・BSD・BlueOak・0BSD・CC0、CC-BY-4.0（caniuse-lite）、MPL-2.0（Tailwind 4 の lightningcss）、LGPL-3.0（next の任意の依存 sharp の libvips。画像の最適化用で、Workers では使わない）が入る。「MIT・Apache-2.0・OFL だけ」は直接の依存の決まりと読んでよいか。
   → 案 8 で実装した（確認待ち）。直接の依存の決まりと読む。この回は依存を足していない
9. 「うめき声」「黙っている」を分類に足すか（担当一覧の仕様にはある）。
   → 案 9 で実装した（確認待ち）。5 つのまま、うめき声・黙っているは不明。赤＋不明は赤（テストで確かめた）

### 仕様書・CLAUDE.md で直したい所（このファイルにだけ書いた）

- CLAUDE.md に動かし方（`npm run db:reset`・`npm run dev`・`npm test`）と「wrangler は --local だけ」を足すとよい。
- 仕様書の写しの誤字: 「経緒」→「経緯」、「頃み・頃む」→「頼み・頼む」、「抵けやすい」→「抜けやすい」、「昨のセッション」、「技術の堆」。
