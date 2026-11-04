# 背景の生成動画

アプリの画面が映らない場面の背景に敷く生成動画の一覧と、生成の指示文。決まりは docs/DECISIONS.md「動画」、使った物の記録は [MATERIALS.md](MATERIALS.md) の「生成画像・生成動画」。

## 決まり

- 使う場面は S1・S3・S8・S9 だけ。録画（R00）の後ろには敷かない
- 写すのは物・風景、人の手元・後ろ姿まで。顔は出さない（横顔・ぼけた顔も出さない。出たら作り直す）
- 文字・看板・印・画面（スマホやパソコンの中身）が映った物は使わない
- 実在の場所に見える物、被災地の写真に見える物は作らない。避難所・停電は「どこにでもある」作りにし、壊れた家・がれき・水につかった町は作らない
- 編集で強くぼかし（12〜20px 相当）、色を抜いて青と白に寄せる。隅に小さく「イメージ（AI 生成）」。手前の文字と数字が主役

## 生成の設定（全部共通）

- 16:9、1920×1080（無ければ 1280×720。強くぼかすので足りる）、24 か 30fps
- 長さは下の表の「要る長さ」以上（多くは 1 本 8〜10 秒）。足りなければ同じ指示で 2 本作り、編集でつなぐ
- カメラはゆっくり（ゆっくり寄る・横に流れる・止め）。速い動き・切り替えは無し
- 日本の家・日本の暮らしに見えること（畳・障子・日本の住宅街）。ただし特定の町に見えない物
- 下の指示文は英語（生成の道具は英語の方が通りやすい）。どの文の終わりにも共通の禁止を付ける:

```
No faces visible. No text, no signs, no logos, no screens. No people looking at the camera. Soft natural light, shallow depth of field, slow camera movement, calm documentary mood, muted colors.
```

## 一覧

| ID | 場面（秒） | 要る長さ | 写す物 | 指示文 |
| --- | --- | --- | --- | --- |
| B01 | S1 自己紹介（0:00–0:07） | 8 秒 | ケアマネの訪問。玄関先を歩く後ろ姿、手にファイル | `A care manager seen from behind, walking along a quiet Japanese residential street toward a small house in the morning, holding a document folder. Camera follows slowly from behind at waist height.` |
| B02 | S3 N05「家族の仕事を近くで見て」（0:20–0:25） | 6 秒 | 夜の机。手元がケアの記録の紙をめくる | `Close-up of hands turning pages of a thick paper care file at a wooden desk at night, a desk lamp, a pen and sticky notes. Slow push-in.` |
| B03 | S3 N06「全部知っている／届かない」（0:25–0:33） | 9 秒 | 在宅酸素。布団の上の高齢者の手と、鼻のチューブが続く濃縮器 | `Close-up of an elderly person's wrinkled hands resting on a futon blanket in a Japanese tatami room, a thin clear oxygen tube running across the blanket to a home oxygen concentrator in the background. Gentle afternoon light through shoji screens. Static camera with very slow drift.` |
| B04 | S3 N07「15.1%」（0:33–0:38） | 6 秒 | 雨の窓の外の住宅街 | `Heavy rain on a window, seen from inside a Japanese house, blurred houses and power lines outside, grey sky. Slow horizontal drift.` |
| B05 | S3 N08「527 人」（0:38–0:42） | 5 秒 | 停電した夜の部屋。懐中電灯の光が畳と薬袋を照らす | `A dark Japanese living room during a power outage at night, a single flashlight beam moving slowly across a tatami floor and a small paper medicine bag on a low table. No damage, quiet.` |
| B06 | S3 N09「輪島の手書きメモ」（0:42–0:46） | 5 秒 | 人のいない避難所。体育館の段ボールベッドと毛布 | `An empty school gymnasium used as an evacuation shelter, rows of cardboard beds with folded grey blankets, soft daylight from high windows. No people. Slow lateral camera move.` |
| B07 | S8 数字と一言（2:43–2:55） | 13 秒 | 訪問の終わり。高齢者の手と、話を聞く人の手が机の上で書類を挟む | `Two pairs of hands at a low Japanese table: an elderly person's hands and a younger person's hands with a pen, looking at a sheet of paper together. Warm light, tea cups. Static camera, very slow push-in.` |
| B08 | S9 締め（2:55–3:00） | 6 秒 | 朝の光の差す窓辺。湯のみを持つ高齢者の手 | `Morning sunlight through a window in a Japanese home, an elderly person's hands holding a warm tea cup, steam rising. Static camera.` |

B06 は被災地の映像に見えやすい。でき上がりが実在の避難所の報道写真に似ていたら使わず、S3 の最後は手書きのメモの線画（G3）だけにする。

## 作り方（11/4）

- 道具は fal.ai（前払い、月額なし）。鍵は環境変数 `FAL_KEY` で渡すだけで、ファイル・記録に書かない
- 先に静止画で見た目を決める（8 本の光・色・寄り方を揃えるため）: `FAL_KEY=… node video/scripts/gen-frame.mjs [ID …] --n 2` で GPT Image 2 の静止画を各 2 案 → `video/assets/bg/frames/`。作者が案を選ぶ
- 動画: `FAL_KEY=… node video/scripts/gen-bg.mjs <ID> [秒] [解像度] --from video/assets/bg/frames/<ID>-<n>.png`（Seedance 2.5 の image-to-video、音なし）→ `video/assets/bg/<ID>.mp4`。前の物は `assets/bg/old/` へ退く
- 11/4 に作った物: B01-2・B02-2・B03-2・B04-1・B05-1・B07-1・B08-1 の静止画から 7 本（480p、長さは表の「要る長さ」＋1 秒、B07 は 14 秒）。モデルは 2.5（2.0 より見た目が良かった）。B06（避難所）は本物の避難所の写真に見えるので使わず、S3 の最後は手書きのメモの図だけ
- 敷き方: `node video/scripts/bg.mjs` で 160px に縮めてから 1920px に戻してぼかした連番にし、`npm run scan`。編集で色を抜き、地の色を 74% 重ねる（split の文字の面の中は面の色を 80%）。隅に「イメージ（AI 生成）」
- できた物は MATERIALS.md の「生成画像・生成動画」に書く

## 置き場と組み込み

- 置き場は `video/assets/bg/B01.mp4` の形（ID と同じ名前。commit しない）。2 本つないだ物は `B07-1.mp4`・`B07-2.mp4`
- 組み込みは動画のセッション（video/src の背景の部品、`npm run scan` で読み場へ写す）。無い ID は今の地の色のまま
- 置いたら MATERIALS.md の「生成画像・生成動画」の表に、道具・作った日・利用規約を確かめた日と頁を書く
