# BGM の合成（自作のコード）

動画の BGM の案を、外の音源・サンプル・ループを使わずに、このフォルダのコードだけで作る。ネットは使わない。

```sh
node scripts/music/render.mjs A   # A-piano（澄んだピアノ）
node scripts/music/render.mjs B   # B-pulse（刻む時計、拍がはっきり）
node scripts/music/render.mjs C   # C-ambient（静かな見守り、環境音寄り）
node scripts/music/render.mjs D   # D-phase（ずれて、そろう。少し大胆な案）
node scripts/music/render.mjs T   # 道具の通しの確かめ（頭の 12 秒だけ鳴る。T-test）
node scripts/music/zoom.mjs A-piano 31.8 33.2 20   # 書き出した WAV の一部の大きさを 20 ms ごとに見る
node scripts/music/edges.mjs        # 強調の窓の端（88・93・116・121・126・130 秒）の谷を WAV から計り直す
node scripts/music/summary.mjs      # 4 案の計測と山の秒を Markdown の表に
```

1 つ 2〜4 分。出す物は `out/music/`（git に入らない）:

| ファイル | 中身 |
| --- | --- |
| `<id>.wav` | 48 kHz・24 bit・ステレオ・ちょうど 180.0 秒（8,640,000 標本）。-16 LUFS、真のピーク -2 dBTP 以下。179.9 秒から後は無音 |
| `<id>.m4a` | 試聴用（AAC 256 kbps） |
| `<id>.beats.json` | 拍の表。`bpm`・`offsetSec`（最初の拍）・`beats`・`downbeats`（曲の小節の頭。小節の長さはところどころ変わる）・`sections`・`hits`（曲の山）・`holds`（強調の窓で音楽が息をつく所）・`anchors`（台本の区切りと、曲の区切り・近い拍） |
| `<id>.report.json`・`<id>.png` | 計測（大きさ・帯域・クリックの候補）と図（上: 大きさ、下: 帯域。横 1 秒 10 px） |

## 作り

- `lib/core.mjs` 拍の表（Timeline。速さは一定で、題名 32.6 秒とロゴ 178.3 秒を小節の頭にする）・音名・乱数
- `lib/inst.mjs` 楽器（ピアノは倍音を 1 本ずつ減衰させる式、弦・パッドは折り返しを抑えた鋸歯と SVF、マリンバ・鐘は板の振動の比、キック・刻みは式）
- `lib/dsp.mjs` フィルター・残響（FDN）・遅れ・コーラス・制限（真のピーク）・大きさの計り（BS.1770）
- `lib/mixer.mjs` パートを 1 つずつ作って足す。仕上げで 25 Hz より下を切り、声の帯域（2.5 kHz の広い山）を 3 dB 下げる
- `render.mjs` -16 LUFS に平らにそろえ（ffmpeg の loudnorm は計るだけで音を変えない）、WAV・m4a・拍の表・計測を書く

台本の区切りの秒（`render.mjs` の SPEC）と、強調の窓（88・116・126 秒）は `src/timeline.ts` と合わせてある。区切りを動かしたら、各案の `form`（小節の並び）を直す。
