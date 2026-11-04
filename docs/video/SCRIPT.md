# ナレーションの台本

3 分動画の声の台本。場面と画面は [PLAN.md](PLAN.md)。文の ID は PLAN.md と `video/src/timeline.ts` と同じで、文を直すときは 3 か所とも直して `video/` で `npm run check` を流す。

- 本文は日本語。英語の字幕は案（審査員に英語の人がいるときのため。入れるかは作者の判断）
- 1 文は短く。声の速さは 1 秒に 5〜5.5 字を目安（`npm run check` が字数と秒から目安を出す。数字は読みが長いので 2 字に数える）
- ［ ］は作者が埋める所。埋めるまで声にしない（仮の声も作らない）
- 「AI が決めない・最後に決めるのは人」は N23・N24（一覧が並び替わった直後）
- 使わない言葉: 診断・判定・重症・病気がわかる。赤は「至急」、灰は「不明」
- 名前: 作者の名前は台本にもリポジトリにも書かない（言うかは作者が録音のときに決める）。家族のケアマネの名前・事業所・続柄の細かい所も書かない
- 作者について言うのは docs/SPEC.md の「立ち位置」にあることだけ。内側にいるのは協力してくれるケアマネで、作者ではない。作者の強みは出荷の速さと、要約の医学的な確かめ（N13）
- 冒頭 46 秒の流れ: 問いかけ（N01）→ 個別避難計画とは何かと作成率（N02）→ 作った理由（N03）→ アンケートの裏付け（N05）→ ケア72 の名前の 72 時間（N06）→ 計画・訓練・発災時の共有（N07）→ 輪島の手書きのメモ（N09）。最初の 10 秒で誰のどんな課題かが分かるようにする（審査基準のデモ）
- 声では「ケアマネ」と略さず「ケアマネージャー」と言う。「在宅の要介護」でなく「在宅の高齢者」
- N08（能登の関連死）は冒頭の組み替えで外した（欠番）
- N04 は使わない。ID は振り直さない（録音と絵コンテが ID で指すため。N04 は欠番）

## 台本

| ID | 秒 | ナレーション | 英語の字幕（案） |
| --- | --- | --- | --- |
| N01 | 0:00.3–0:03.9 | 突然ですが、『個別避難計画』を知っていますか。 | Have you heard of an "individual evacuation plan"? |
| N02 | 0:04.1–0:12.9 | 災害のとき、在宅の高齢者を誰がどう助けるかを決めておく計画です。でも、できているのは対象者の 15.1% だけ。 | It sets out who will help an older person living at home in a disaster, and how. But only 15.1% of the people who need one have one. |
| N03 | 0:13.1–0:21.3 | 私の家族はケアマネージャーで、その理由を家で見てきました。利用者のことは知っているのに、書く時間がないんです。 | My family member is a care manager, and I've seen why at home. They know their clients well, but there's no time to write it down. |
| N05 | 0:21.5–0:26.8 | 家族だけではありません。アンケートでも、［N］人中［N］人が『書く時間が無い』と答えました。 | It's not just my family. In our survey, [N] of [N] said they have no time to write plans. |
| N06 | 0:27.0–0:33.5 | そこで、医学生の私が作ったのがケア72。72 は、助けが届きにくい災害直後の 72 時間のことです。 | So, as a medical student, I built Care72. The 72 stands for the first 72 hours after a disaster, when help is slow to arrive. |
| N07 | 0:33.7–0:41.4 | 話すだけで計画ができ、訓練もでき、災害が起きたら安否と大事な情報をまとめて、医療班と共有します。 | Talk, and the plan is made. Run drills with it. And in a disaster, it gathers who is safe and what matters, and shares it with the medical team. |
| N09 | 0:41.6–0:45.9 | 輪島の避難所では、薬のメモが手書きで、用量が抜けていた。 | At shelters in Wajima, medication notes were handwritten, and doses were left out. |
| N10 | 0:46.3–0:51.3 | 主役は架空の利用者、山田ハナさん。84 歳、在宅酸素。 | Meet a fictional client, Hana Yamada. 84, on home oxygen. |
| N11 | 0:51.5–0:58.3 | ケアマネージャーが話すと、Claude が台帳の欄に分け、空いている所だけ聞き返します。 | The care manager talks. Claude sorts it into her record, and asks back only about what's missing. |
| N12 | 0:58.5–1:04.5 | 台帳から、市の様式の避難計画、本人の 1 枚、医療班の要約が出ます。 | From that one record: the city's evacuation plan form, a one-page sheet for her, and a summary for the medical team. |
| N13 | 1:04.7–1:09.8 | 要約は医療班の記録と同じ順。医学生の目で確かめました。 | The summary follows the medical team's own record format. I checked it as a medical student. |
| N14 | 1:10.0–1:13.6 | ほかの市の様式も、写真から読み取ります。 | Other cities' forms can be read from a photo. |
| N15 | 1:14.3–1:20.0 | 次は訓練。利用者 10 人に、Claude Haiku が 1 体ずつ付きます。 | Next, the drill. Each of the 10 clients gets their own Claude Haiku agent. |
| N16 | 1:20.2–1:24.6 | 台帳を読み、本人や家族になりきって動きます。 | Each one reads the record and plays the client or a family member. |
| N17 | 1:24.8–1:28.0 | 72 時間を早送りで進めると、 | Fast-forward through the 72 hours, and... |
| N18 | 1:33.2–1:38.8 | ケアマネージャーは本番と同じ画面で、電話、出向く、避難所に頼む。 | The care manager responds on the same screen used in a real disaster: call, visit, ask a shelter. |
| N19 | 1:39.0–1:47.6 | 終わると Opus が対応の順を採点。透析先の確認が後回しだったと、出典つきで指摘しました。 | At the end, Opus scores the order of response. It pointed out, with sources, that checking the dialysis clinic came too late. |
| N20 | 1:48.3–1:52.3 | そして本番。大雨で、災害モードに入りました。 | Then the real thing. Heavy rain, and disaster mode is on. |
| N21 | 1:52.5–1:56.0 | 娘さんのスマホには、赤と緑の 2 つだけ。 | Her daughter's phone shows just two buttons: red and green. |
| N22 | 2:01.2–2:06.0 | 本人の答えが止まると、声で問いかけ、周りの音ごと録音します。 | If she stops answering, the app asks out loud and records the sound around her. |
| N23 | 2:10.3–2:15.0 | 色と順を決めるのは AI ではなく、人が読めるルールの表。 | The color and order are set not by AI, but by a rule table people can read. |
| N24 | 2:15.3–2:20.8 | Claude は録音を分けるだけ。最後に決めるのは、ケアマネージャーです。 | Claude only sorts the recording. The care manager makes the final call. |
| N25 | 2:23.0–2:27.7 | 電話し、避難所の医療班が受け入れると、要約が届きます。 | The care manager calls, and when the shelter's medical team takes her in, the summary is there. |
| N26 | 2:30.3–2:36.0 | 作ったのは Claude Code。設計と実装を分け、並行で進めました。 | It was built with Claude Code, with design and implementation split and run in parallel. |
| N27 | 2:36.3–2:42.7 | フックで鍵と配信を守り、本名を見ない MCP と見直し役で確かめています。 | Hooks guard the keys and deploys. An MCP server that never sees real names, and reviewer agents, check the work. |
| N28 | 2:43.3–2:49.0 | 協力してくれたケアマネージャーの計画 1 件は、ふだん［X 時間］、ケア72 で［Y 分］。 | For the care manager who helped us, one plan usually takes [X hours]. With Care72, [Y minutes]. |
| N29 | 2:49.2–2:52.3 | ［協力ケアマネージャーの一言、または T34 のアンケートの結果 1 文］ | [A word from the partner care manager, or one line from the T34 survey] |
| N30 | 2:52.6–2:59.9 | 実用化の課題は山積みです。それでも、まずは一部から、本当に使える形にしていきます。 | Getting this into real use still faces many hurdles. But we'll keep working to make it truly usable, starting with one part. |

声の無い所（アプリの音と強調の間）: 1:28–1:33（着信と娘役の声）、1:56–2:01（赤を押して一覧が並び替わる）、2:06–2:10（問いかけの声と録音）。

N04 を消して空いた 6 秒は S6（発災時）に回した（並び替わりの強調 3 → 5 秒、行の詳細 6 → 8 秒、電話と医療班の受入 5 → 7 秒）。S6 は手元の dev で本物の画面を撮れる所で、S5（訓練）は本番の Claude が要るので伸ばしても今は見せる物が無いため。

## 埋める所

| ID | 埋める物 | 決まり |
| --- | --- | --- |
| N05 | アンケート（T65）の問 4「計画を作るとき、いやな所・面倒な所」で「書く時間が無い」を選んだ人の数と、答えた人の数 | 受付（11/5 23:59）が閉じてから数える。割合でなく「何人中何人」。選んだ人がほとんどいなければ、この文を外して N03 を伸ばす |
| N28 | ふだんの時間と、ケア72 での時間 | ケア72 の時間は撮影の日の実測（架空の事例、ストップウォッチ）。ふだんの時間は協力ケアマネの申告で、字幕に「本人の申告」。測れなければこの文を外し、N29 を 2 秒伸ばす。測るまで声にも字幕にも数字を出さない（「10 分」は設計の目標で、測った値ではない） |
| N29 | 協力ケアマネの一言か、T34 のアンケートの結果 | 一言は本人が許した範囲（文字か声。顔なし）。アンケートは件数と母数（「12 人中 9 人」）。言い過ぎの言葉は本人が言っても使わない |

## 読み

- 15.1%: じゅうごてんいちパーセント
- 527 人: ごひゃくにじゅうななにん（755 人は画面の棒だけで、声では言わない）
- 能登: のと。輪島: わじま
- 山田ハナ: やまだ はな
- Claude: クロード。Haiku: ハイク。Opus: オーパス。MCP: エムシーピー。AI: エーアイ

## 数字の出典（字幕に小さく出す）

| ID | 数字 | 出典 |
| --- | --- | --- |
| N07 | 作成率 15.1%（対象 670 万人） | [共同通信 2026-10-04（熊本日日新聞）](https://kumanichi.com/articles/2042908) |
| N08 | 関連死 527 人（画面の棒で死者 755 人も出す） | [熊本日日新聞 2026-08](https://kumanichi.com/articles/2027266) |
| N09 | 輪島の避難所の薬の情報が手書きのメモで用法用量が欠けた | [厚生労働省](https://www.mhlw.go.jp/content/001203369.pdf) |
| N28 | 計画 1 件の時間 | 撮影の日の実測（MATERIALS.md の「数字」）。測るまでは「未測定」 |
| N29 | アンケートの結果 | T34 |

出典は docs/SPEC.md の「根拠の数字」と同じ。撮影の前に作者がもう一度リンクを開き、数字と言い方（「関連死」「対象」）が記事と合うことを確かめる。

## 仮の声と録音のしかた

- 今の声は Windows の読み上げ（Microsoft Haruka、`video/scripts/tts-placeholder.ps1`）で作った仮の声。置き場は `video/assets/voice-tts/N01.wav` …（commit しない）
- 作者の声は文ごとに 1 ファイル（`video/assets/voice/N01.wav` …）。前後に 0.3 秒の無音を残す。置いて `npm run scan` を流すと、作者の声がある文はそちらを使い、無い文だけ仮の声が残る（手順は docs/progress/t43.md の「自分の声の録り方」）
- 読む前に、ストップウォッチで 1 文ずつ秒の枠に入るか測る。入らなければ文を削る（速く読まない）。枠からはみ出た声は書き出しで切れる
