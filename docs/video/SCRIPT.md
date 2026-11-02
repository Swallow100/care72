# ナレーションの台本

3 分動画の声の台本。場面と画面は [PLAN.md](PLAN.md)。文の ID（N01〜N30）は PLAN.md と `video/src/timeline.ts` と同じで、文を直すときは 3 か所とも直して `video/` で `npm run check` を流す。

- 本文は日本語。英語の字幕は案（審査員に英語の人がいるときのため。入れるかは作者の判断）
- 1 文は短く。声の速さは 1 秒に 5〜5.5 字を目安（`npm run check` が字数と秒から目安を出す。数字は読みが長いので 2 字に数える）
- ［ ］は作者が埋める所。埋めるまで動画に出さない
- 「AI が決めない・最後に決めるのは人」は N23・N24（一覧が並び替わった直後）
- 使わない言葉: 診断・判定・重症・病気がわかる。赤は「至急」、灰は「不明」
- 名前: 作者の名前は台本にもリポジトリにも書かない（言うかは作者が録音のときに決める）。家族のケアマネの名前・事業所・続柄の細かい所も書かない

## 台本

| ID | 秒 | ナレーション | 英語の字幕（案） |
| --- | --- | --- | --- |
| N01 | 0:00.5–0:06.5 | 医学部で学んでいます。家族は、在宅のお年寄りを受け持つケアマネです。 | I'm a medical student. Someone in my family is a care manager for older people who live at home. |
| N02 | 0:07.3–0:12.6 | ケア72。ケアマネの知っていることを、災害の 72 時間に届けます。 | Care72 carries what a care manager knows into the first 72 hours of a disaster. |
| N03 | 0:12.8–0:19.6 | 話して埋まる避難計画。AI が利用者を演じる訓練。発災時の、安否と連絡の順。 | A plan you fill in by talking. A drill where AI plays your clients. And in a disaster: who is safe, and who to call first. |
| N04 | 0:20.3–0:26.3 | 高校の［高校の学習の名前］で、［学んだこと 1 文］。 | In high school, in [name of the program], I learned [one sentence]. |
| N05 | 0:26.5–0:31.0 | 医学部に進み、家族の仕事を近くで見て、気づきました。 | Then, in medical school, watching my family's work up close, I noticed something. |
| N06 | 0:31.2–0:39.2 | ケアマネは利用者のことを全部知っている。でも計画に起こす時間がなく、72 時間に届く道もない。 | Care managers know everything about their clients. But there's no time to turn it into a plan, and no way for it to reach anyone in those 72 hours. |
| N07 | 0:39.6–0:43.6 | 個別避難計画ができているのは、対象の 15.1%。 | Only 15.1% of the people who need an individual evacuation plan have one. |
| N08 | 0:43.8–0:47.6 | 能登の死者 755 人のうち、527 人は関連死。 | Of the 755 people who died in the Noto earthquake, 527 were disaster-related deaths. |
| N09 | 0:47.8–0:51.8 | 輪島の避難所では、薬の情報が手書きで、用量が欠けていました。 | At shelters in Wajima, medication notes were handwritten, and the doses were missing. |
| N10 | 0:52.3–0:57.3 | 主役は架空の利用者、山田ハナさん。84 歳、在宅酸素。 | Meet a fictional client, Hana Yamada. 84, on home oxygen. |
| N11 | 0:57.5–1:04.3 | ケアマネが話すと、Claude が台帳の欄に分け、空いている所だけ聞き返します。 | The care manager talks. Claude sorts it into her record, and asks back only about what's missing. |
| N12 | 1:04.5–1:10.5 | 台帳から、市の様式の避難計画、本人の 1 枚、医療班の要約が出ます。 | From that one record: the city's evacuation plan form, a one-page sheet for her, and a summary for the medical team. |
| N13 | 1:10.7–1:15.8 | 要約は医療班の記録と同じ順。医学生の目で確かめました。 | The summary follows the medical team's own record format. I checked it as a medical student. |
| N14 | 1:16.0–1:19.6 | ほかの市の様式も、写真から読み取ります。 | Other cities' forms can be read from a photo. |
| N15 | 1:20.3–1:26.0 | 次は訓練。利用者 10 人に、Claude Haiku が 1 体ずつ付きます。 | Next, the drill. Each of the 10 clients gets their own Claude Haiku agent. |
| N16 | 1:26.2–1:30.6 | 台帳を読み、本人や家族になりきって動きます。 | Each one reads the record and plays the client or a family member. |
| N17 | 1:30.8–1:34.0 | 72 時間を早送りで進めると、 | Fast-forward through the 72 hours, and... |
| N18 | 1:39.2–1:44.8 | ケアマネは本番と同じ画面で手を打ちます。電話、出向く、避難所に頼む。 | The care manager responds on the same screen used in a real disaster: call, visit, ask a shelter. |
| N19 | 1:45.0–1:53.6 | 終わると Opus が対応の順を採点。透析先の確認が後回しだったと、出典つきで指摘しました。 | At the end, Opus scores the order of response. It pointed out, with sources, that checking the dialysis clinic came too late. |
| N20 | 1:54.3–1:58.3 | そして本番。大雨で、災害モードに入りました。 | Then the real thing. Heavy rain, and disaster mode is on. |
| N21 | 1:58.5–2:02.0 | 娘さんのスマホには、赤と緑の 2 つだけ。 | Her daughter's phone shows just two buttons: red and green. |
| N22 | 2:05.2–2:10.0 | 本人の答えが止まると、声で問いかけ、周りの音ごと録音します。 | If she stops answering, the app asks out loud and records the sound around her. |
| N23 | 2:14.3–2:19.0 | 色と順を決めるのは AI ではなく、人が読めるルールの表。 | The color and order are set not by AI, but by a rule table people can read. |
| N24 | 2:19.3–2:24.8 | Claude は録音を分けるだけ。最後に決めるのは、ケアマネです。 | Claude only sorts the recording. The care manager makes the final call. |
| N25 | 2:25.0–2:29.7 | 電話し、避難所の医療班が受け入れると、要約が届きます。 | The care manager calls, and when the shelter's medical team takes her in, the summary is there. |
| N26 | 2:30.3–2:36.0 | 作ったのは Claude Code。設計と実装を分け、並行で進めました。 | It was built with Claude Code, with design and implementation split and run in parallel. |
| N27 | 2:36.3–2:42.7 | フックで鍵と配信を守り、本名を見ない MCP と見直し役で確かめています。 | Hooks guard the keys and deploys. An MCP server that never sees real names, and reviewer agents, check the work. |
| N28 | 2:43.3–2:49.0 | 協力してくれたケアマネの計画 1 件は、ふだん［X 時間］、ケア72 で［Y 分］。 | For the care manager who helped us, one plan usually takes [X hours]. With Care72, [Y minutes]. |
| N29 | 2:49.2–2:54.8 | ［協力ケアマネの一言、または T34 のアンケートの結果 1 文］ | [A word from the partner care manager, or one line from the T34 survey] |
| N30 | 2:55.4–2:59.4 | 知っていることを、最初の 72 時間に。ケア72。 | What they know, into the first 72 hours. Care72. |

声の無い所（アプリの音と強調の間）: 1:34–1:39（着信と娘役の声）、2:02–2:05（赤を押して一覧が並び替わる）、2:10–2:14（問いかけの声と録音）。

## 埋める所

| ID | 埋める物 | 決まり |
| --- | --- | --- |
| N04 | 高校の学習の名前と、学んだこと 1 文 | 例の形: 「高校の〇〇で、発災から 72 時間が救命と支援が届くまでの目安だと学びました。」。名前は公開して差し支えない物だけ。言えないなら「高校で、災害の 72 時間を学びました。」 |
| N28 | ふだんの時間と、ケア72 での時間 | ケア72 の時間は撮影の日の実測（架空の事例、ストップウォッチ）。ふだんの時間は協力ケアマネの申告で、字幕に「本人の申告」。測れなければこの文を外し、N29 を 2 秒伸ばす |
| N29 | 協力ケアマネの一言か、T34 のアンケートの結果 | 一言は本人が許した範囲（文字か声。顔なし）。アンケートは件数と母数（「12 人中 9 人」）。言い過ぎの言葉は本人が言っても使わない |

## 読み

- 15.1%: じゅうごてんいちパーセント
- 755 人・527 人: ななひゃくごじゅうごにん・ごひゃくにじゅうななにん
- 能登: のと。輪島: わじま
- 山田ハナ: やまだ はな
- Claude: クロード。Haiku: ハイク。Opus: オーパス。MCP: エムシーピー

## 数字の出典（字幕に小さく出す）

| ID | 数字 | 出典 |
| --- | --- | --- |
| N07 | 作成率 15.1%（対象 670 万人） | [共同通信 2026-10-04（熊本日日新聞）](https://kumanichi.com/articles/2042908) |
| N08 | 死者 755 人、関連死 527 人 | [熊本日日新聞 2026-08](https://kumanichi.com/articles/2027266) |
| N09 | 輪島の避難所の薬の情報が手書きのメモで用法用量が欠けた | [厚生労働省](https://www.mhlw.go.jp/content/001203369.pdf) |
| N28 | 計画 1 件の時間 | 撮影の日の実測（MATERIALS.md の「数字」） |
| N29 | アンケートの結果 | T34 |

出典は docs/SPEC.md の「根拠の数字」と同じ。撮影の前に作者がもう一度リンクを開き、数字と言い方（「関連死」「対象」）が記事と合うことを確かめる。

## 録音のしかた

- 文ごとに 1 ファイル（`video/public/audio/narration/N01.wav` …）。前後に 0.3 秒の無音を残す
- 読む前に、ストップウォッチで 1 文ずつ秒の枠に入るか測る。入らなければ文を削る（速く読まない）
- 作者の声で録るか TTS かは作者の判断待ち（docs/progress/t33.md）。TTS なら MATERIALS.md の「声」の決まりで
