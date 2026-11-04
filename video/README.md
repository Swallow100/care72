# 動画の編集の枠（Remotion）

ケア72 の 3 分動画（提出物）を組む枠。場面と文は [docs/video/PLAN.md](../docs/video/PLAN.md)・[SCRIPT.md](../docs/video/SCRIPT.md) と同じで、`src/timeline.ts` に持つ。素材（録画・声・音楽）が無い所は仮の面で描くので、素材がそろう前から通しで見られる。

アプリの一部ではない。`package.json` はこのフォルダだけの物で、ルートの依存・build・配信に入らない（ルートの tsconfig.json と vitest.config.ts は `video` を外してある）。

## ライセンスの注意

Remotion は MIT ではない。Remotion License で、個人・従業員 3 人以下の営利の団体・非営利の団体は無料で使える（[LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)）。このリポジトリの決まり（CLAUDE.md「依存は MIT・Apache-2.0・OFL の物だけ」）の外なので、使うかは作者が決める（docs/progress/t33.md の問い 1）。使わないなら、MIT の Motion Canvas で同じ形に組み直せる（`src/timeline.ts` と docs はそのまま使える）。ルートの THIRD_PARTY_NOTICES.md の「動画の編集の道具」の節にも書いた。

## 作り方

```sh
cd video
npm install        # Remotion と React。初めての書き出しで Chrome Headless Shell を node_modules に落とす
npm run check      # 台本の食い違い・時間割・声の速さの目安
npm run scan       # public/assets.json を作る（素材が無くても作る。無いと読み込みの 404 が出る）
npm run studio     # Remotion Studio（http://localhost:3000）で通しで見る
```

- `npm run check` は、文（N01〜N30）が PLAN.md・SCRIPT.md・`src/timeline.ts` で同じか、場面が 0〜180 秒で隙間なく続くか、を見る。文を直したら 3 か所とも直して流す
- 書体はアプリと同じで、英数字の Inter と BIZ UDPGothic（OFL）を Google Fonts から読み、日本語は端末の書体（Windows では Yu Gothic UI）。書き出すときはネットにつながっていること（つながっていないと英数字も端末の書体になる）

## 素材の置き方

素材はリポジトリに入れない（`.gitignore`）。置き場所と一覧は docs/video/MATERIALS.md。

素材は `assets/`（置き場）に置き、`npm run scan` で `public/`（Remotion の読み場）へ写す。どちらも commit しない。

```sh
# 仮の声（Windows の読み上げ。台本 docs/video/SCRIPT.md の表から 1 文 1 WAV → assets/voice-tts/N01.wav …）
powershell -ExecutionPolicy Bypass -File scripts/tts-placeholder.ps1
# 作者の声は assets/voice/N01.wav … に置く（ある文は仮の声より先に使われる）

# 手元の dev の本物の画面を撮る（鍵の要らない所だけ。→ assets/rec/R10-1/00001.jpg … と markers.json）
#   ルートで: CLOUDFLARE_INCLUDE_PROCESS_ENV=true JUDGE_PASSWORD=<捨てる値> CAREMANAGER_DEMO_PASSWORD=<捨てる値> npx next dev -p 3073
CARE72_CM_PASSWORD=<同じ値> CARE72_JUDGE_PASSWORD=<同じ値> MSYS_NO_PATHCONV=1 node scripts/record.mjs prep      # 最初に戻す → 平時
CARE72_CM_PASSWORD=<同じ値> CARE72_JUDGE_PASSWORD=<同じ値> MSYS_NO_PATHCONV=1 node scripts/record.mjs calm      # R01〜R05
CARE72_CM_PASSWORD=<同じ値> CARE72_JUDGE_PASSWORD=<同じ値> MSYS_NO_PATHCONV=1 node scripts/record.mjs disaster  # R10〜R13
node scripts/sheet.mjs assets/rec/R10-1 12      # 等間隔に 12 コマ抜いた一覧（out/sheet/）。映ってはいけない物を見る

# OBS などで撮った録画を静止画の連番と音に分ける（→ assets/rec/R10-<次の回>/、public/audio/app/R10.wav）
node scripts/frames.mjs raw/R10-2.mp4 R10 12.5 95

# 音楽は手で置く: public/audio/music/bed.wav（か .mp3）
npm run scan      # assets から public へ写し、public/assets.json を書き直す。撮影待ちの録画と声の数を出す
```

- 同じ番号の録画が 2 回以上あれば、一番大きい回を使う（古い回を使うなら新しい回のフォルダの名前を変える）
- 録画が無い所と、撮れた長さより後ろを使う所は、青の面に白で「撮影待ち R07 訓練」と出る（`src/parts/Footage.tsx`）
- 秒（`from`）は録画ごとに違う。撮り直したら markers.json を見て `src/timeline.ts` の `from`・`froms` を合わせる
- 録画の中のどこを使うかは `src/timeline.ts` の各絵の `from`（録画の頭からの秒）、速さは `rate`、寄りは `zoom`（録画の幅に対する割合の枠を 2 つ。始まり → 終わり）
- アプリの音（着信・問いかけ・録音）は、速さを変えていない絵だけで鳴る
- 音楽は声のある所で 0.12、強調の所で 0.05、ほかで 0.3 の大きさ（`src/Video.tsx` の musicVolume）

## 書き出し

| 物 | 値 |
| --- | --- |
| 大きさ | 1920×1080 |
| コマ | 30fps |
| 長さ | 180 秒（5400 コマ） |
| 映像 | h264、crf 16 |
| 音 | AAC 320kbps、48kHz、-14 LUFS（真のピーク -1.5 dBTP 以下） |

```sh
npm run render                          # out/Care72.mp4（英語の字幕つき）
npm run render -- Care72Ja              # out/Care72Ja.mp4（日本語の字幕だけ）
npm run loudnorm -- out/Care72.mp4 out/Care72-final.mp4   # 音を -14 LUFS に（2 回測って合わせ、最後にもう 1 回測る）
npm run still -- Care72 1260 out/still.png                # 1 コマだけ png（見本や確かめ）
```

docs/video の見本（`sample-blue.png` は 1260 コマ目、`sample-white.png` は 4110 コマ目）はこの `still` で作った。

## Windows の罠

- **OffthreadVideo の "No frame found"**: Windows で mp4 を `<OffthreadVideo>` で読むと、書き出しの途中で "No frame found" で止まることがある。この枠は録画を静止画の連番（`scripts/frames.mjs`）にして `<Img>` で 1 コマずつ読むので起きない。録画を足すときも連番にする
- **一時フォルダ**: Remotion は書き出しの途中のコマを一時フォルダに書く。Windows の `%TEMP%` は C: にあり、3 分の書き出しで C: が埋まることがある。ストレージ センサーが書き出しの途中で `%TEMP%` を消すこともある。`scripts/` の命令は全部 `TEMP`・`TMP` をこのフォルダの `.tmp/` に向けてから Remotion と ffmpeg を呼ぶ（`scripts/lib.mjs` の tmpEnv）。`npx remotion` を直に打つときも、先に `TEMP` と `TMP` を `.tmp` に向ける
- **npx は .cmd**: Windows の npx は batch なので shell が要り、`=`・`,`・`;` も引数の区切りに読まれる（`fps=30` が `fps` と `30` に割れた）。`scripts/lib.mjs` は npx のときだけ shell で呼び、空白とこれらを含む引数を引用符で囲む（Node が DEP0190 の注意を出すが、引数は自分で囲んでいる）。ffmpeg は shell を通さず直に呼ぶ
- **install script**: npm が esbuild の postinstall を「allowScripts に無い」と止めることがある。手元では止まったままで書き出せた。bundle で esbuild が見つからないと言われたら `npm install-scripts approve esbuild` のあと `npm rebuild esbuild`

## 音（loudnorm）

`scripts/frames.mjs` と `scripts/loudnorm.mjs` は ffmpeg を、環境変数 `FFMPEG` → PATH の ffmpeg → Remotion の部品に入っている ffmpeg（`node_modules/@remotion/compositor-*/ffmpeg`、直に呼ぶ）→ `npx remotion ffmpeg` の順で探す。Remotion の ffmpeg は filter を絞った物（11/3 に数えて 50）で、`fps` の filter が無い（frames は出力の `-r 30 -fps_mode cfr` で 30fps にそろえる）、映像を null に出す encoder も無い（loudnorm は `-vn` で音だけ測る）。loudnorm はある。11/3 に 5 秒の試しの書き出しで -18.85 → -14.05 LUFS を確かめた。別の ffmpeg を使うなら `FFMPEG` に道を入れる（道具で、リポジトリにも依存にも入れない）。

## ファイル

| 場所 | 中身 |
| --- | --- |
| `src/timeline.ts` | 場面・絵・文・ルールの表の行・使い分けの図（docs と同じ。node からも直に読む） |
| `src/Video.tsx` | 本体。場面を並べ、字幕と声と音楽を重ねる |
| `src/theme.ts` | 色（青と白。PLAN.md の「色の決まり」）、書体、置き場所 |
| `src/parts/Footage.tsx` | 録画の連番を枠に描く（寄り・速さ）と仮の面 |
| `src/parts/Overlay.tsx` | 字幕・モデルの名前・出典・「利用者は架空」・72 時間の線・強調の囲み |
| `src/parts/Graphics.tsx` | 図（台帳の流れ・ルールの表・使い分け・72 時間の輪・数字・棒・メモ・終わりの画面） |
| `src/fonts.ts`・`src/assets.ts`・`src/ground.tsx` | 書体の読み込み、素材の有無、場面の地の色 |
| `scripts/` | check・scan・frames・render・loudnorm、tts-placeholder.ps1（仮の声）、record.mjs・record-lib.mjs（手元の dev の画面を撮る。puppeteer-core はルートの物）、sheet.mjs・look.mjs（撮れた物を見る） |

## 守ること

- 映すのは期間中に作った物だけ。利用者は全員架空。審査員の ID とパスワード、ログインの画面を映さない（docs/video/PLAN.md の「守ること」）
- 素材のファイルを commit しない。録画を足したら、編集の前に 1 本ずつ実名・ID・パスワード・ほかのプロジェクトが映っていないかを見る
