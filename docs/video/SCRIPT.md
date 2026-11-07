# ナレーションの台本

3 分動画の声の台本。場面と画面は [PLAN.md](PLAN.md)。文の ID は PLAN.md と `video/src/timeline.ts` と同じで、文を直すときは 3 か所とも直して `video/` で `npm run check` を流す。

- 本文は日本語。英語の字幕は案（審査員に英語の人がいるときのため。入れるかは作者の判断）
- 1 文は短く。声の速さは 1 秒に 5〜5.5 字を目安（`npm run check` が字数と秒から目安を出す。数字は読みが長いので 2 字に数える）
- ［ ］は作者が埋める所。埋めるまで声にしない（仮の声も作らない）
- 「AI が決めない・最後に決めるのは人」は N23・N24（一覧が並び替わった直後）
- 使わない言葉: 診断・判定・重症・病気がわかる。赤は「至急」、灰は「不明」
- 名前: 作者の名前は台本にもリポジトリにも書かない（言うかは作者が録音のときに決める）。家族のケアマネの名前・事業所・続柄の細かい所も書かない
- 作者について言うのは 設計の「立ち位置」にあることだけ。内側にいるのは協力してくれるケアマネで、作者ではない。作者の強みは出荷の速さと、要約の医学的な確かめ（N13）
- 冒頭 46 秒の流れ: 問いかけ（N01）→ 個別避難計画とは何かと作成率（N02）→ 作った理由（N03）→ アンケートの裏付け（N05）→ ケア72 の名前の 72 時間（N06）→ 計画・訓練・発災時の共有（N07）→ 輪島の手書きのメモ（N09）。最初の 10 秒で誰のどんな課題かが分かるようにする
- 声では「ケアマネ」と略さず「ケアマネジャー」と言う（厚労省の書き方。作者の書き込みのとおり 11/6）。「在宅の要介護」でなく「在宅の高齢者」
- N08（能登の関連死）と N09（輪島の手書きのメモ）は冒頭の組み替えで外した（欠番）
- 11/6 夕方、作者が絵コンテの頁に書いた直しで全体を組み直した。声の文は作者の文のまま（事実に合わせた所だけ直した）。外した文: N13・N14・N26・N27・N29（欠番）。11/6 夜に N16・N31 も外した（3 分に収めるため）。詳しくは PLAN.md の「時間割」の下
- N28（協力ケアマネの計画 1 件の時間）は測れないので外した（11/6）。空いた秒は N29 と N30 に回した。主役の紹介の文（前の N10）は外し、入れる欄の文を N10、「アプリの中に記録されていきます」を N11 にした（11/6）。冒頭（N01〜N08）は読み手の口が追いつくよう 1 秒に 5 字以下に縮めた（11/6）
- N04 は使わない。ID は振り直さない（録音と絵コンテが ID で指すため。N04 は欠番）

## 台本

| ID | 秒 | ナレーション | 英語の字幕（案） |
| --- | --- | --- | --- |
| N01 | 0:00.3–0:04.7 | 突然ですが『個別避難計画』を知っていますか。 | Out of the blue: have you heard of an "individual evacuation plan"? |
| N02 | 0:04.9–0:16.6 | 災害のとき、在宅の高齢者を誰がどう助けるかを決めておく計画です。でも、対象の約 670 万人のうち、できているのは 15.1% だけ。 | It sets out who will help an older person living at home in a disaster, and how. But of about 6.7 million people it covers, only 15.1% have one. |
| N03 | 0:18–0:26.8 | ケアマネジャーは利用者のことは知っていますが、計画を書く時間がありません。また、計画自体を活かせていません。 | Care managers know their clients, but have no time to write the plans. And the plans themselves go unused. |
| N05 | 0:27–0:35.4 | 独自アンケートでも、ケアマネジャー 4 人全員が、計画は市町村に出して終わりと答えました。 | In our own survey, all 4 care managers answered that the plan ends once it is handed to the city. |
| N06 | 0:35.8–0:42 | 楽に作れて、災害でも役立つ計画なら、作る意味が出る、そう考えました。 | A plan that is easy to make and useful in a disaster is worth making. That was my thought. |
| N07 | 0:42.2–0:46.3 | そこでケア72を開発しました。 | So I built Care72. |
| N08 | 0:46.5–0:55.4 | ケアマネジャーの災害対策計画づくりから訓練、発災時の対応までケア72一つで完結します。 | From the care manager's disaster planning to drills and the response in a disaster, Care72 does it all. |
| N10 | 0:55.9–1:08.3 | まずは計画。箇条書きや文書、音声で情報を入力、Claude がアプリ内に利用者の情報を記録していきます。抜けている部分は Claude が質問します。 | First, the plan. Enter notes, documents or voice, and Claude records the client's information in the app. Claude asks about whatever is missing. |
| N11 | 1:08.4–1:13.2 | 項目分けされアプリ内に見やすく記録されます。 | It is sorted into fields and kept clearly in the app. |
| N12 | 1:13.4–1:21.7 | 記録から自治体の形式の個別避難計画、本人保管書類、災害時医療班用の要約を作成できます。 | From the record: the city's plan form, a sheet for the client to keep, and a summary for the disaster medical team. |
| N15 | 1:22.2–1:31.6 | 次は訓練。Opus が災害状況を細かくシミュレーションし Haiku が利用者一人一人になりきり行動します。 | Next, the drill. Opus simulates the disaster in detail, and Haiku plays each client. |
| N17 | 1:31.8–1:41.5 | 72 時間のシミュレーション訓練では、停電や断水、電波不良や利用者自身の怪我など、さまざまな状況が起こります。 | In the 72-hour drill, all kinds of things happen: power cuts, water outages, bad signal, and the clients themselves getting hurt. |
| N18 | 1:45–1:51.4 | ケアマネジャーは本番と同じように電話したり、避難や電源の手配を行ったりできます。 | Just like the real thing, the care manager can call, and arrange evacuation or power. |
| N19 | 1:51.5–2:04.9 | 終わると Opus が対応を採点し、今回は山田ハナさんの酸素が間に合わなかったこと、連絡順の上の人から手を打つべきことを、出典付きで講評しました。 | At the end, Opus scores the response. This time, citing sources, it pointed out that Hana Yamada's oxygen ran short, and that the care manager should act from the top of the contact order. |
| N20 | 2:05–2:10.5 | そして実際の発災時。地震が発生し災害モードに切り替えました。 | Then a real disaster. An earthquake hits, and disaster mode is on. |
| N21 | 2:10.7–2:15.6 | 利用者またはその家族はスマホで安否確認ができます。 | Clients or their families can check in from their phones. |
| N22 | 2:15.8–2:22.8 | 本人がボタンを押さない場合は AI 音声で質問して録音と状況把握に努めます。 | If the client doesn't press a button, an AI voice asks, and the app records to understand the situation. |
| N24 | 2:23–2:29.4 | Haiku が録音内容をまとめます。最終決定はケアマネジャーが行います。 | Haiku summarizes the recording. The care manager makes the final call. |
| N23 | 2:29.6–2:34.8 | AI ではなくルールの表によって連絡順などを決定します。 | The order is set not by AI but by a rule table. |
| N25 | 2:35–2:42.8 | ケアマネジャーと医療班の情報共有も QR コードなどを用いて簡単にできます。 | Sharing with the medical team is easy too, with QR codes and more. |
| N30 | 2:45.2–2:57.2 | 普及や実用化への課題はあります。それでも災害時計画を計画だけで終わらせない大きなポテンシャルを持ったアプリを開発できたと思います。 | There are hurdles to real-world use. Still, I believe we built an app with real potential to make disaster plans more than just plans. |
| N31 | 2:57.6–2:59.2 | ケア72。 | Care72. |

声の無い所（アプリの音と強調の間）: 1:28–1:33（着信の声）、1:59–2:04（赤を押して一覧が並び替わる）、2:10.5–2:13（録音）。

N04 を消して空いた 6 秒は S6（発災時）に回した（並び替わりの強調 3 → 5 秒、行の詳細 6 → 8 秒、電話と医療班の受入 5 → 7 秒）。S6 は手元の dev で本物の画面を撮れる所で、S5（訓練）は本番の Claude が要るので伸ばしても今は見せる物が無いため。

## 埋める所

| ID | 埋める物 | 決まり |
| --- | --- | --- |
| N05 | アンケート（T65）の問 4「計画を作るとき、いやな所・面倒な所」で「書く時間が無い」を選んだ人の数と、答えた人の数 | 受付（11/5 23:59）が閉じてから数える。割合でなく「何人中何人」。選んだ人がほとんどいなければ、この文を外して N03 を伸ばす |
| N29 | 協力ケアマネの一言か、T34 のアンケートの結果 | 一言は本人が許した範囲（文字か声。顔なし）。アンケートは件数と母数（「12 人中 9 人」）。言い過ぎの言葉は本人が言っても使わない |

## 読み

- ケア72: 読みは作者が決める（「ケア ななじゅうに」か「ケア セブンティツー」）。動画の中で揃える。仮の声は「ケア ななじゅうに」で読ませた
- 15.1%: じゅうごてんいちパーセント
- 527 人: ごひゃくにじゅうななにん（755 人は画面の棒だけで、声では言わない）
- 能登: のと。輪島: わじま
- 山田ハナ: やまだ はな
- Claude: クロード。Haiku: ハイク。Opus: オーパス。MCP: エムシーピー。AI: エーアイ

## 数字の出典（字幕に小さく出す）

| ID | 数字 | 出典 |
| --- | --- | --- |
| 字（S6 の本人のスマホ） | 阪神・淡路大震災の直接死 5,483 人のうち窒息・圧死 3,979 人（72.57%）。本当に危ないときはボタンを押せないことの例 | [兵庫県「阪神・淡路大震災の死者にかかる調査について」2005-12-22](https://web.pref.hyogo.lg.jp/kk42/pa20_000000016.html)（11/6 に頁を開いて数を確かめた） |
| N02 | 作成率 15.1%（対象 670 万人） | [共同通信 2026-10-04（熊本日日新聞）](https://kumanichi.com/articles/2042908) |
| N05 | アンケートの「書く時間が無い」の人数 | T65（ケアマネジャーと包括支援センター。受付が閉じてから数える） |
| N29 | アンケートの結果 | T34 |

出典は 設計の「根拠の数字」と同じ。撮影の前に作者がもう一度リンクを開き、数字と言い方（「関連死」「対象」）が記事と合うことを確かめる。

## 仮の声と録音のしかた

- 今の声は Windows の読み上げ（Microsoft Haruka、`video/scripts/tts-placeholder.ps1`）で作った仮の声。置き場は `video/assets/voice-tts/N01.wav` …（commit しない）
- 作者の声は文ごとに 1 ファイル（`video/assets/voice/N01.wav` …）。前後に 0.3 秒の無音を残す。置いて `npm run scan` を流すと、作者の声がある文はそちらを使い、無い文だけ仮の声が残る（手順は docs/progress/t43.md の「自分の声の録り方」）
- 読む前に、ストップウォッチで 1 文ずつ秒の枠に入るか測る。入らなければ文を削る（速く読まない）。枠からはみ出た声は書き出しで切れる
