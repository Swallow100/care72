// 3 分動画の時間割。場面と文は docs/video/PLAN.md と SCRIPT.md と同じ。
// 文（LINES）を直すときは PLAN.md・SCRIPT.md も直し、`npm run check` で食い違いを見る。
// このファイルは node から直接読む（scripts/check.mjs）ので、型を消すだけで動く書き方にする（enum・namespace を使わない、ほかの .ts を読まない）。

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TOTAL_SECONDS = 180;

/** 寄りの枠。録画の幅と高さに対する割合（0〜1）。w は幅の割合で、高さは同じ割合（縦横の比は録画のまま） */
export type Rect = { x: number; y: number; w: number };

/** 囲みの枠。録画の幅と高さに対する割合（0〜1）。寄りの前の録画の上の位置で書く */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * 録画の上の囲み（細い線）と、その脇の短い名前（2〜4 字の漢語）。at・end は絵の頭からの秒（無ければ絵の間ずっと）。
 * place は名前を置く向き。above・below は囲みに付けた小さな面、left・right は録画の外（スマホの横）に線を引いて置く
 */
export type Callout = { box: Box; label: string; at?: number; end?: number; tone?: "urgent"; place?: "above" | "below" | "left" | "right" };

/**
 * 声に合わせて出す言葉（文字が主役の絵。話の段）。出る時刻は書かない: 文 line の中の say（無ければ text）を声が言い始める所（src/voice.ts の sayAt）。
 * 画面に出すのは声が強く言う 2〜4 句だけ（文の全部は字幕の帯にある）。
 * size は字の大きさの段（theme.ts の TYPE）、row は行（同じ行の言葉は横に並ぶ）。後ろの行が出ると前の行は小さな字の色に下がる（hold なら下げない）。
 * mark は行の左に 6px の帯。slot は決まった所に置く言葉（数字の画面の lead は数の上、tail は数の後ろ。mark は字を出さず、
 * 声がその言葉を言う所で画面の物を強調する: 72 時間の輪の題名の数の下に帯）。shift は声からのずれの秒（先に出すなら負）
 */
export type Cue = {
  text: string;
  line: string;
  say?: string;
  size?: "display" | "hero" | "h1" | "h2";
  row?: number;
  hold?: boolean;
  mark?: boolean;
  slot?: "lead" | "tail" | "mark";
  shift?: number;
};

export type Shot = {
  /** 動画の頭からの秒 */
  at: number;
  end: number;
  kind:
    | "footage" // 録画 1 本
    | "split" // 録画を横に並べる（footages）
    | "carousel" // 録画の窓を円柱に並べて回す（footages と lines。cues の mark で回る）
    | "title" // ケア72 の題名
    | "text" // 文字だけ（lines）
    | "plate" // 左下の名札（lines。大きな字にしない自己紹介）
    | "ring" // 72 時間の輪（G1）
    | "number" // 大きな数字（value）
    | "bars" // 2 本の棒（G2）
    | "memo" // 手書きのメモの線画（G3）
    | "flow" // 台帳から 3 つの出力（F1）
    | "rules" // ルールの表の 1 枚（F2）
    | "models" // 使い分けの図（F3）と端末の録画
    | "quote" // 協力ケアマネージャーの一言
    | "end"; // 終わりの画面（G5）
  /** 何を映すか（作る人向けの説明。素材が無い間は仮の面に出す） */
  label: string;
  /** 録画の番号（docs/video/MATERIALS.md の R01…） */
  footage?: string;
  footages?: string[];
  /** 録画の中の始まりの秒（同じ録画の別の所を使うとき） */
  from?: number;
  /** split・flow で録画ごとに始まりの秒を変えるとき（footages と同じ順）。無ければ from */
  froms?: number[];
  /** 録画の進む速さ。0.5 は半分の速さ（強調の所） */
  rate?: number;
  /** 寄り。始まりの枠から終わりの枠へ動く */
  zoom?: [Rect, Rect];
  /** 録画の上の囲み */
  callouts?: Callout[];
  /** 奥に敷く背景の生成動画（docs/video/BACKGROUND.md の B01…）。無ければ地の色だけ。split では文字の面の中だけに敷く（録画の後ろには敷かない） */
  bg?: string;
  /** 背景の生成動画の何秒目から使うか（1 本を 2 つの絵で続けて使うとき） */
  bgFrom?: number;
  /** 窓の上の帯の右に出すモデルの名前（スマホの録画では横に出す） */
  chip?: string;
  /** 窓の帯に出す画面の名前（1 本の録画の中で画面が替わる所。無ければ RECORDINGS の名前） */
  screen?: string;
  /** 下に小さく出す出典 */
  source?: string;
  /** 強調の 3 つの瞬間（電話が鳴る・並び替わる・録音）。音楽を下げる */
  emphasis?: boolean;
  /** 文字の画面・数字の画面の中身 */
  lines?: string[];
  /** 文字だけの画面で lines と sub を出す秒（絵の頭から。声に合わせる）。無ければ 0.9 秒ずつ */
  beats?: number[];
  /** 声に合わせて出す言葉（文字が主役の絵）。あれば lines より先に使う */
  cues?: Cue[];
  /** 白い帯（parts/Marker.tsx）を引く言葉。絵ごとに 1 つだけ。cues の text・分割の見出し（lines）・数字の画面の tail か lines[0] と同じ字で書く */
  marker?: string;
  value?: string;
  sub?: string;
};

/** 地の色。青と白のコントラスト。話の段（S1〜S3・S8・S9）は青地、道具の段（S4〜S7）は白地 */
export type Ground = "white" | "blue";

export type Scene = { id: string; title: string; ground: Ground; at: number; end: number; shots: Shot[] };

export type Line = { id: string; at: number; end: number; ja: string; en: string };

export const SCENES: Scene[] = [
  {
    id: "S1",
    title: "問いかけ",
    ground: "blue",
    at: 0,
    end: 13.1,
    shots: [
      {
        at: 0,
        end: 4.1,
        kind: "text",
        footage: "R01",
        label: "ケアマネージャーの訪問の後ろ姿（B01）をぼかして奥に。問いかけの文字",
        bg: "B01",
        // 冒頭は問いかけ（N01）。最初の 10 秒で誰のどんな課題かを言う（N01・N02）。計画の名前を一番大きく
        cues: [
          { text: "突然ですが", line: "N01", size: "h1", row: 0 },
          { text: "個別避難計画", line: "N01", size: "display", row: 1, hold: true },
          { text: "を知っていますか", line: "N01", size: "h1", row: 1 },
        ],
      },
      // N02 の前半「災害のとき…決めておく計画です」の間は、左に計画の中身を言葉で、右に本物の計画書（松山市の様式の 1 頁目）
      {
        at: 4.1,
        end: 8.8,
        kind: "split",
        footages: ["", "R03"],
        // 様式の頭（題名「個別避難計画」が見える所。R03-3 の 0〜4 秒）
        froms: [0, 0.5],
        label: "これが個別避難計画（松山市の様式）",
        marker: "どう助けるか",
        cues: [
          { text: "災害のとき", line: "N02", size: "h2", row: 0 },
          { text: "在宅の高齢者を", line: "N02", size: "h1", row: 1 },
          { text: "誰が", line: "N02", size: "hero", row: 2, hold: true },
          { text: "どう助けるか", line: "N02", size: "hero", row: 3, hold: true },
          { text: "決めておく計画", line: "N02", size: "h1", row: 4 },
        ],
      },
      {
        at: 8.8,
        end: 13.1,
        kind: "number",
        bg: "B04",
        label: "作成率",
        marker: "だけ",
        value: "15.1%",
        lines: ["個別避難計画あり"],
        sub: "対象 670 万人",
        // 数え上がりが止まるのは N02 の「15.1%」（仮の声で 11.0 秒）
        beats: [2.2],
        cues: [
          { text: "できているのは", line: "N02", size: "h2", slot: "lead" },
          { text: "だけ", line: "N02", size: "h1", slot: "tail" },
        ],
        source: "共同通信 2026-10-04（熊本日日新聞）",
      },
    ],
  },
  {
    id: "S2",
    title: "理由",
    ground: "blue",
    at: 13.1,
    end: 25.2,
    shots: [
      // 作者の紹介は大きな字にせず、左下の名札（N03 の「私の家族はケアマネージャーで」）
      // 真ん中には N03 の後半「その理由を家で見てきました」（作者が身近な所にいること）。名札より大きいが、作者の紹介そのものは大きくしない
      {
        at: 13.1,
        end: 17.2,
        kind: "plate",
        label: "作者の名札（医学部の学生・家族にケアマネージャー）",
        marker: "家で見てきた",
        lines: ["作者　医学部の学生", "家族にケアマネージャー"],
        beats: [0.3, 0.9],
        bg: "B02",
        cues: [
          { text: "その理由を", line: "N03", size: "h1", row: 0 },
          { text: "家で見てきた", line: "N03", say: "家で見てきました", size: "hero", row: 1 },
        ],
      },
      {
        at: 17.2,
        end: 21.5,
        kind: "split",
        // 録画の番号が空の所は文字の面（sub を「・」で分けて並べる）
        footages: ["", "R03"],
        // 様式の下の方（未確認の欄。R03-2 の 11 秒）
        froms: [0, 11],
        lines: ["知っている", "書けていない"],
        bg: "B03",
        // N03 の「利用者のことは知っているのに」「書く時間がないんです」に合わせて（仮の声で 17.3 秒・19.1 秒）
        beats: [0.1, 1.9],
        sub: "薬と残り日数・医療機器と電池・家族と支援者・夜に来られる人",
        label: "左に台帳の区分の名前、右に様式の未確認の欄",
        marker: "書けていない",
      },
      {
        at: 21.5,
        end: 25.2,
        kind: "number",
        bg: "B02",
        bgFrom: 4,
        label: "アンケート（T65 の問 4）",
        marker: "書く時間が無い",
        // 数は受付（11/5 23:59）が閉じてから。「何人中何人」の形（割合にしない）。入るまでは字だけ
        value: "［N］人中［N］人",
        lines: ["書く時間が無い"],
        sub: "アンケート（ケアマネージャーと包括支援センター）",
        beats: [2.6],
        cues: [{ text: "アンケートでも", line: "N05", size: "h2", slot: "lead" }],
      },
    ],
  },
  {
    id: "S3",
    title: "ケア72",
    ground: "blue",
    at: 25.2,
    end: 46,
    shots: [
      {
        at: 25.2,
        end: 32.5,
        kind: "text",
        label: "気づき（楽に作れて、実際の災害でも役立つ計画）",
        marker: "大きくなる",
        bg: "B05",
        // 2 つの条件は下げずに残し、最後の「大きくなる」を一番大きく
        cues: [
          { text: "楽に作れて", line: "N06", size: "hero", row: 0, hold: true },
          { text: "実際の災害でも役立つ計画", line: "N06", size: "hero", row: 1, hold: true },
          { text: "作る意味も", line: "N06", size: "h1", row: 2 },
          { text: "大きくなる", line: "N06", size: "display", row: 2 },
        ],
      },
      // 題名を 72 時間の輪（G1）の中に置く。題名は N07 の「ケア72」で出す（仮の声で 33.0 秒）。輪の中に名前の 72 時間の意味を声に合わせて
      {
        at: 32.5,
        end: 38,
        kind: "ring",
        label: "題名と 72 時間の輪",
        marker: "災害直後の 72 時間",
        lines: ["ケア72"],
        sub: "助けが届きにくい災害直後の 72 時間",
        beats: [0.5],
        cues: [
          { text: "72", line: "N07", say: "72は", slot: "mark" },
          { text: "助けが届きにくい", line: "N07", size: "h2", row: 0, hold: true },
          { text: "災害直後の 72 時間", line: "N07", size: "h2", row: 1, hold: true },
        ],
      },
      {
        at: 38,
        end: 46,
        // 3 本立ての円柱（parts/Carousel.tsx。作者の頼み 11/5）。声の「計画ができ」「訓練もでき」「災害時は」で円柱が回り、その窓が正面に来る
        kind: "carousel",
        footages: ["R03", "R07", "R10"],
        // R03 は様式の頭（R03-3 の 0 秒から。4 秒ほどで下へ送る）、R10 は山田の行が至急で一番上に上がったあと（R10-3 の 49.6 秒）
        froms: [0, 7.2, 50.9],
        lines: ["計画", "訓練", "発災時"],
        cues: [
          { text: "計画", line: "N08", say: "計画ができ", slot: "mark" },
          { text: "訓練", line: "N08", say: "訓練もでき", slot: "mark" },
          { text: "発災時", line: "N08", say: "災害時は", slot: "mark" },
        ],
        label: "様式が埋まる・72 時間の棒・一覧が並び替わる（円柱）",
      },
    ],
  },
  {
    id: "S4",
    title: "計画",
    ground: "white",
    at: 46,
    end: 74,
    shots: [
      {
        at: 46,
        end: 51,
        kind: "footage",
        footage: "R02",
        label: "本人のページの上の段（山田 ハナ）",
        // 真ん中の列（優先・医療・時計・緊急連絡先）。右の入れる欄は撮っていない所（手元に鍵が無く「AI 未設定」）なので映さない
        zoom: [
          { x: 0.2, y: 0.06, w: 0.55 },
          { x: 0.21, y: 0.07, w: 0.45 },
        ],
      },
      // 入れる欄（R02-5、11/5 に手元の dev で撮った）。N11 の 3 つの句に合わせて 3 つの絵に。右の 2 列（本人の台帳と AI 入力）に寄る
      { at: 51, end: 53.2, kind: "footage", footage: "R02", from: 25.5, label: "入れる欄: 話した文が欄に流れる", zoom: [{ x: 0.38, y: 0.15, w: 0.62 }, { x: 0.4, y: 0.17, w: 0.6 }] },
      { at: 53.2, end: 55.2, kind: "footage", footage: "R02", from: 37.3, label: "入れる欄: Sonnet が台帳の 3 項目に分ける", chip: "Claude Sonnet 5.5", zoom: [{ x: 0.4, y: 0.17, w: 0.6 }, { x: 0.42, y: 0.18, w: 0.58 }] },
      { at: 55.2, end: 58, kind: "footage", footage: "R02", from: 66.3, label: "入れる欄: 保存と、空いている所だけの問い返し", chip: "Claude Sonnet 5.5", zoom: [{ x: 0.4, y: 0, w: 0.6 }, { x: 0.42, y: 0.01, w: 0.58 }] },
      { at: 58, end: 64, kind: "flow", footages: ["R03", "R04", "R05"], label: "台帳から 3 つの紙面" },
      {
        at: 64,
        end: 70,
        kind: "footage",
        footage: "R05",
        // 下へ送っている所（特記事項・常用薬・メディカル ID）
        from: 6,
        label: "医療班の要約: 特記事項（常用薬等）・中断注意・メディカル ID",
        sub: "災害診療記録 2018 の順",
      },
      // 様式の読み取り（R06-1）。架空の「こもれび市」の白紙の様式の画像 → Opus の対応表（16.6 秒に出る）
      { at: 70, end: 74, kind: "footage", footage: "R06", from: 15.6, label: "様式の読み取り: 写真 → 対応表", chip: "Claude Opus 5.5", zoom: [{ x: 0, y: 0, w: 1 }, { x: 0.1, y: 0.05, w: 0.8 }] },
    ],
  },
  {
    id: "S5",
    title: "訓練",
    ground: "white",
    at: 74,
    end: 108,
    shots: [
      // 秒は R07-4・R08-5・R09-5（11/5 昼に手元の dev で撮った訓練の大雨想定。10 分版はアプリから外した）の markers.json と calls.json から
      // 6.1 秒に訓練の画面が開き、すぐ高橋 ユキの家族の着信が鳴る
      { at: 74, end: 80, kind: "footage", footage: "R07", from: 6.3, label: "訓練の大雨想定。10 人の表と、家族からの最初の着信", chip: "Claude Haiku 5.5 × 10" },
      // 本人役・家族役の言葉: 3 時間の刻みの高橋 ユキの家族の電話（R07-4 の 70.4 秒に着信、出ると「母は避難所に着きました。今は落ち着いています。」が AI の印つきで出る）
      { at: 80, end: 85, kind: "footage", footage: "R07", from: 72.4, label: "本人役・家族役の言葉（高橋 ユキの家族の電話）", zoom: [{ x: 0.265, y: 0.115, w: 0.48 }, { x: 0.275, y: 0.12, w: 0.46 }] },
      // 早送り（「次まで」を繰り返す）: 経過 37 時間 → 43 時間（R07-4 の 302.5 秒から 4 倍。着信の窓の無い所）
      { at: 85, end: 88, kind: "footage", footage: "R07", from: 302.5, rate: 4, label: "72 時間を早送り" },
      // 強調の着信は小林 トシの夫（訪問看護が来た・停電で呼吸器が電池に・残り 50 分）。1.6 秒から: 鳴る → 3.0 秒に出る → 声（video/scripts/app-audio.mjs が R08 の音を作る）
      { at: 88, end: 93, kind: "footage", footage: "R08", from: 1.6, emphasis: true, label: "強調: 着信 小林 トシの夫（呼吸器の電池）", zoom: [{ x: 0.2, y: 0.08, w: 0.6 }, { x: 0.265, y: 0.115, w: 0.48 }] },
      // 手: 39.6 秒に小林 トシ、40.5 秒に訪問依頼、41.5 秒に実行、46 秒ごろに「手配済 向かってもらえる」（R07-4 の押した所）。対応の欄を上から下へ追う
      { at: 93, end: 99, kind: "footage", footage: "R07", from: 40.6, label: "手: 小林 トシに訪問依頼", zoom: [{ x: 0.25, y: 0.08, w: 0.6 }, { x: 0.25, y: 0.4, w: 0.6 }] },
      // 採点（N19 の「対応の順を採点」「透析先の確認が後回し」）: 右の列の採点と条件到達に寄る。田中の透析先 未確認の行に囲み
      {
        at: 99,
        end: 104.5,
        kind: "footage",
        footage: "R09",
        from: 2.0,
        label: "採点（順番・報告・空欄・条件到達）",
        chip: "Claude Opus 5.5",
        // 囲みの名前が窓の下の端で切れないよう、少し下に寄る（上の「採点」の見出しは切れてよい）
        zoom: [{ x: 0.6, y: 0.17, w: 0.4 }, { x: 0.6, y: 0.18, w: 0.4 }],
        // R09-5 の 2〜8 秒（採点の欄で止まっている間）の田中 茂の行（2 行に折れる）
        callouts: [{ at: 3.0, box: { x: 0.751, y: 0.469, w: 0.232, h: 0.055 }, label: "透析先 未確認", tone: "urgent", place: "below" }],
      },
      // 講評と出典（N19 の「出典つきで指摘しました」）: 8.1 秒に講評へ送ったあと（13 秒まで止まっている）。順番の指摘（田中 茂さんが先）の出典の行に囲み
      {
        at: 104.5,
        end: 108,
        kind: "footage",
        footage: "R09",
        from: 9.0,
        label: "講評と出典",
        chip: "Claude Opus 5.5",
        zoom: [{ x: 0.6, y: 0.4, w: 0.4 }, { x: 0.6, y: 0.42, w: 0.4 }],
        callouts: [{ at: 0.3, box: { x: 0.757, y: 0.562, w: 0.165, h: 0.026 }, label: "出典", place: "below" }],
      },
    ],
  },
  {
    id: "S6",
    title: "発災時",
    ground: "white",
    at: 108,
    end: 150,
    shots: [
      // 秒は R10-3・R11-3・R12-3・R13-3（手元の dev、11/4 夜に今の main で撮り直した 3 回目）の markers.json とコマの変わり目から。撮り直したら合わせ直す
      // 事業所の画面は左の災害モードと災害情報と、真ん中の確認の窓（T79）に寄る（右の列にケアマネのログインの ID が出るため）
      {
        at: 108,
        end: 112,
        kind: "footage",
        footage: "R10",
        from: 1,
        label: "大雨に切替（確認の窓）",
        screen: "事業所",
        zoom: [
          { x: 0, y: 0, w: 0.66 },
          { x: 0.04, y: 0.05, w: 0.6 },
        ],
      },
      { at: 112, end: 116, kind: "split", footages: ["R11", "R10"], froms: [2, 38.9], label: "娘のスマホ（赤と緑）と担当一覧" },
      // 読み直しで山田の行が 2 番目から一番上へ（R10-3 の 49.6 秒）。半分の速さで
      {
        at: 116,
        end: 121,
        kind: "footage",
        footage: "R10",
        from: 47.9,
        rate: 0.5,
        emphasis: true,
        label: "強調: 山田の行が一番上へ（至急）",
        // 録画の 49.6 秒（絵の 3.4 秒）で山田の行が 1 番目に上がる。囲みは上がった行に（R10-3 の 50.1 秒のコマで測る）
        callouts: [{ at: 3.8, box: { x: 0.0125, y: 0.394, w: 0.975, h: 0.072 }, label: "至急 連絡順 1", tone: "urgent", place: "below" }],
      },
      // 本人のスマホ（R12-4）: 赤 5.0 → けが ある 8.5 → 動けない 11.6 を 2.6 倍で、定型文の声の問いかけ、録音（44.6 秒から）
      { at: 121, end: 124, kind: "footage", footage: "R12", from: 4.6, rate: 2.6, label: "本人のスマホ: 赤 → けが ある → 動けない" },
      { at: 124, end: 126, kind: "footage", footage: "R12", from: 12.6, label: "本人のスマホ: 声の問いかけ（大丈夫ですか 状況を説明してください）" },
      { at: 126, end: 130, kind: "footage", footage: "R12", from: 44.8, emphasis: true, label: "強調: 録音（AI が聞いている）" },
      { at: 130, end: 135, kind: "rules", label: "ルールの表の 1 枚" },
      // 行の詳細（R14-1: 11/5 に録音から分類まで撮った回）。86.5 秒に下へ送ったあと 95 秒まで止まっている。
      // 右の列の録音のまとめ（AI）・分類「けが・動けない」（AI、確信 90%）と修正・順番変更に寄る。N24 の 2 つの句に合わせて囲みを 1 つずつ
      {
        at: 135,
        end: 143,
        kind: "footage",
        footage: "R14",
        from: 87.0,
        label: "行の詳細: 録音の分類（AI）と人の判断",
        chip: "Claude Haiku 5.5",
        zoom: [{ x: 0.42, y: 0.28, w: 0.58 }, { x: 0.46, y: 0.32, w: 0.54 }],
        // 囲みの位置は R14-1 の 87 秒のコマで測る。撮り直したら測り直す
        callouts: [
          { at: 0.4, box: { x: 0.665, y: 0.57, w: 0.31, h: 0.04 }, label: "AI の分類" },
          { at: 2.4, box: { x: 0.663, y: 0.635, w: 0.315, h: 0.15 }, label: "人の判断", place: "below" },
        ],
      },

      { at: 143, end: 146.5, kind: "footage", footage: "R10", from: 100.5, label: "電話 → 電話の記録" },
      // 受入（R13-3 の 8.7 秒）を押す所を 1.4 秒だけ見せ、N25 の「要約が届きます」の間は医療要約の書類へ。間は 10 コマの重ねでつなぐ
      // R13-3 は受入のすぐあとに受入一覧の「医療要約」を押して撮った（15.2 秒に押し、24.1 秒に書類が出る）
      { at: 146.5, end: 147.9, kind: "footage", footage: "R13", from: 7.9, label: "医療班の受入" },
      {
        at: 147.9,
        end: 150,
        kind: "footage",
        footage: "R13",
        // 書類が出て落ち着いたあと（R13-3 の 24.1 秒に出て 26.4 秒に止まる）。左の紙面（右の原本の列は「受入 到着 かわなぎ小学校」）に寄る
        from: 26.6,
        label: "医療班に届いた要約",
        screen: "医療要約",
        zoom: [
          { x: 0.03, y: 0.16, w: 0.64 },
          { x: 0.05, y: 0.2, w: 0.58 },
        ],
      },
    ],
  },
  {
    id: "S7",
    title: "Claude の使い分け",
    ground: "white",
    at: 150,
    end: 163,
    shots: [
      { at: 150, end: 156, kind: "models", footages: ["R20", "R21"], label: "使い分けの図と、worktree・見直し役" },
      {
        at: 156,
        end: 163,
        kind: "models",
        footages: ["R22", "R23", "R24"],
        label: "フック・MCP・テストの件数",
        lines: ["commit ［N］", "テスト ［N］", "人が書いた行 ［N］"],
      },
    ],
  },
  {
    id: "S8",
    title: "数字と一言",
    ground: "blue",
    at: 163,
    end: 172.5,
    shots: [
      {
        at: 163,
        end: 169,
        kind: "number",
        bg: "B07",
        label: "計画 1 件の時間の前と後",
        value: "［X 時間］ → ［Y 分］",
        // 「→」のある値は前と後を 1 行に並べる（Graphics.tsx の Compare）。lines は各数の下の名前
        lines: ["ふだん", "ケア72"],
        sub: "実測 架空の事例［N］件・ケアマネージャー［N］人。ふだんの時間は本人の申告",
        // 上に「協力ケアマネージャーの計画 1 件」（文の頭で出す）、前の数は声の「ふだん」、後の数は声の「ケア72 で」で出す（声を録るまでは文の秒の割合）
        cues: [
          { text: "協力ケアマネージャーの計画 1 件", line: "N28", say: "協力してくれたケアマネージャーの計画1件は", size: "h2", slot: "lead" },
          { text: "ふだん", line: "N28", slot: "mark" },
          { text: "ケア72", line: "N28", say: "ケア72で", slot: "mark" },
        ],
      },
      // 背景の B07 は 1 本（14 秒）を 2 つの絵で続けて使う（前の絵が 6 秒）
      { at: 169, end: 172.5, kind: "quote", label: "協力ケアマネージャーの一言と 2 つ目の数字", lines: ["［協力ケアマネージャーの一言］"], sub: "医療班の手元の割合 ［T34 か訓練の結果。無ければ未測定］", bg: "B07", bgFrom: 6 },
    ],
  },
  {
    id: "S9",
    title: "締め",
    ground: "blue",
    // 締めの文（N30）が長くなったので 2:52.5 から（11/4 15:5x）。前半は言葉、「本当に使える形に」からロゴが描かれる
    at: 172.5,
    end: 180,
    shots: [
      {
        at: 172.5,
        end: 178.3,
        kind: "text",
        label: "締めの言葉（課題は山積み・それでも・まずは一部から・本当に使える形に）",
        // 一番の言葉は「本当に使える形に」（作者の決め 11/5。字幕だけでなく大きく出し、ロゴはそのあと）
        marker: "本当に使える形に",
        bg: "B08",
        cues: [
          { text: "実用化の課題は", line: "N30", size: "h1", row: 0 },
          { text: "山積み", line: "N30", size: "hero", row: 0 },
          { text: "それでも", line: "N30", size: "h1", row: 1 },
          { text: "まずは一部から", line: "N30", size: "hero", row: 2, hold: true },
          // 声より 0.25 秒先に出す（帯を引き終えてから抜ける間を作るため）
          { text: "本当に使える形に", line: "N30", size: "hero", row: 3, hold: true, shift: -0.25 },
        ],
      },
      // ロゴは 1.7 秒（描く動きを短くする。parts/Graphics.tsx の EndCard）
      { at: 178.3, end: 180, kind: "end", label: "終わりの画面", bg: "B08", bgFrom: 5.8 },
    ],
  },
];

export const LINES: Line[] = [
  { id: "N01", at: 0.3, end: 3.9, ja: "突然ですが、『個別避難計画』を知っていますか。", en: "Have you heard of an \"individual evacuation plan\"?" },
  { id: "N02", at: 4.1, end: 12.9, ja: "災害のとき、在宅の高齢者を誰がどう助けるかを決めておく計画です。でも、できているのは対象者の 15.1% だけ。", en: "It sets out who will help an older person living at home in a disaster, and how. But only 15.1% of the people who need one have one." },
  { id: "N03", at: 13.1, end: 21.3, ja: "私の家族はケアマネージャーで、その理由を家で見てきました。利用者のことは知っているのに、書く時間がないんです。", en: "My family member is a care manager, and I've seen why at home. They know their clients well, but there's no time to write it down." },
  // N04 は消した。ID は振り直さない（欠番）
  { id: "N05", at: 21.5, end: 25.2, ja: "アンケートでも、［N］人中［N］人が『書く時間が無い』と答えました。", en: "In our survey too, [N] of [N] said they have no time to write plans." },
  { id: "N06", at: 25.4, end: 32.4, ja: "そこで考えました。楽に作れて、実際の災害でも役立つ計画なら、作る意味も大きくなる。", en: "So I thought: if a plan were easy to make and actually useful in a real disaster, making it would mean much more." },
  { id: "N07", at: 32.6, end: 37.9, ja: "それがケア72。72 は、助けが届きにくい災害直後の 72 時間です。", en: "That's Care72. The 72 stands for the first 72 hours after a disaster, when help is slow to arrive." },
  // N08 は 3 本立ての文に使い直した（前の能登の関連死の文は 11/4 の冒頭の組み替えで外した）
  { id: "N08", at: 38.1, end: 45.8, ja: "話すだけで計画ができ、訓練もでき、災害時は安否と大事な情報をまとめて、医療班と共有します。", en: "Talk, and the plan is made. Run drills with it. In a disaster, it gathers who is safe and what matters, and shares it with the medical team." },
  // N09（輪島の手書きのメモ）は 11/4 の冒頭の組み替えで外した（欠番）
  { id: "N10", at: 46.3, end: 51.3, ja: "主役は架空の利用者、山田ハナさん。84 歳、在宅酸素。", en: "Meet a fictional client, Hana Yamada. 84, on home oxygen." },
  { id: "N11", at: 51.5, end: 58.3, ja: "ケアマネージャーが話すと、Claude が台帳の欄に分け、空いている所だけ聞き返します。", en: "The care manager talks. Claude sorts it into her record, and asks back only about what's missing." },
  { id: "N12", at: 58.5, end: 64.5, ja: "台帳から、市の様式の避難計画、本人の 1 枚、医療班の要約が出ます。", en: "From that one record: the city's evacuation plan form, a one-page sheet for her, and a summary for the medical team." },
  { id: "N13", at: 64.7, end: 69.8, ja: "要約は医療班の記録と同じ順。医学生の目で確かめました。", en: "The summary follows the medical team's own record format. I checked it as a medical student." },
  { id: "N14", at: 70.0, end: 73.6, ja: "ほかの市の様式も、写真から読み取ります。", en: "Other cities' forms can be read from a photo." },
  { id: "N15", at: 74.3, end: 80.0, ja: "次は訓練。利用者 10 人に、Claude Haiku が 1 体ずつ付きます。", en: "Next, the drill. Each of the 10 clients gets their own Claude Haiku agent." },
  { id: "N16", at: 80.2, end: 84.6, ja: "台帳を読み、本人や家族になりきって動きます。", en: "Each one reads the record and plays the client or a family member." },
  { id: "N17", at: 84.8, end: 88.0, ja: "72 時間を早送りで進めると、", en: "Fast-forward through the 72 hours, and..." },
  { id: "N18", at: 93.2, end: 98.8, ja: "ケアマネージャーは本番と同じ画面で、電話、出向く、避難所に頼む。", en: "The care manager responds on the same screen used in a real disaster: call, visit, ask a shelter." },
  { id: "N19", at: 99.0, end: 107.6, ja: "終わると Opus が対応の順を採点。透析先の確認が後回しだったと、出典つきで指摘しました。", en: "At the end, Opus scores the order of response. It pointed out, with sources, that checking the dialysis clinic came too late." },
  { id: "N20", at: 108.3, end: 112.3, ja: "そして本番。大雨で、災害モードに入りました。", en: "Then the real thing. Heavy rain, and disaster mode is on." },
  { id: "N21", at: 112.5, end: 116.0, ja: "娘さんのスマホには、赤と緑の 2 つだけ。", en: "Her daughter's phone shows just two buttons: red and green." },
  { id: "N22", at: 121.2, end: 126.0, ja: "本人の答えが止まると、声で問いかけ、周りの音ごと録音します。", en: "If she stops answering, the app asks out loud and records the sound around her." },
  { id: "N23", at: 130.3, end: 135.0, ja: "色と順を決めるのは AI ではなく、人が読めるルールの表。", en: "The color and order are set not by AI, but by a rule table people can read." },
  { id: "N24", at: 135.3, end: 140.8, ja: "Claude は録音を分けるだけ。最後に決めるのは、ケアマネージャーです。", en: "Claude only sorts the recording. The care manager makes the final call." },
  { id: "N25", at: 143.0, end: 147.7, ja: "電話し、避難所の医療班が受け入れると、要約が届きます。", en: "The care manager calls, and when the shelter's medical team takes her in, the summary is there." },
  { id: "N26", at: 150.3, end: 156.0, ja: "作ったのは Claude Code。設計と実装を分け、並行で進めました。", en: "It was built with Claude Code, with design and implementation split and run in parallel." },
  { id: "N27", at: 156.3, end: 162.7, ja: "フックで鍵と配信を守り、本名を見ない MCP と見直し役で確かめています。", en: "Hooks guard the keys and deploys. An MCP server that never sees real names, and reviewer agents, check the work." },
  { id: "N28", at: 163.3, end: 169, ja: "協力してくれたケアマネージャーの計画 1 件は、ふだん［X 時間］、ケア72 で［Y 分］。", en: "For the care manager who helped us, one plan usually takes [X hours]. With Care72, [Y minutes]." },
  { id: "N29", at: 169.2, end: 172.3, ja: "［協力ケアマネージャーの一言、または T34 のアンケートの結果 1 文］", en: "[A word from the partner care manager, or one line from the T34 survey]" },
  { id: "N30", at: 172.6, end: 179.9, ja: "実用化の課題は山積みです。それでも、まずは一部から、本当に使える形にしていきます。", en: "Getting this into real use still faces many hurdles. But we'll keep working to make it truly usable, starting with one part." },
];

/** ルールの表の 1 枚（F2）に出す行。docs/TRIAGE.md の「色と理由の 1 行」から写した 13 行のうちの 7 行。撮影の前に今の表と照らす */
export const RULE_ROWS: { input: string; state: "urgent" | "check" | "unknown" | "ok"; reason: string }[] = [
  { input: "赤 ＋ けが・動けない", state: "urgent", reason: "本人が「動けない」（最上位）" },
  { input: "赤だけ", state: "urgent", reason: "本人が「無事じゃない」" },
  { input: "不明 ＋ 停電が機器の時計を超えた", state: "urgent", reason: "酸素 内蔵電池 2 時間を超過" },
  { input: "不明 ＋ 時計の半分を過ぎた", state: "check", reason: "透析 次の回まで 残り 18 時間" },
  { input: "不明（時計の半分まで）", state: "unknown", reason: "連絡なし 6 時間" },
  { input: "緑 ＋ 機器の時計の半分を過ぎた", state: "check", reason: "無事・酸素 内蔵電池 残り 30 分" },
  { input: "緑", state: "ok", reason: "本人が「無事」（一番下）" },
];

/** 使い分けの図（F3）。docs/CLAUDE_CODE.md の「モデルの使い分け」から */
export const MODEL_ROWS: { what: string; who: string }[] = [
  { what: "台帳の入力・問い返し", who: "Claude Sonnet 5.5" },
  { what: "様式の読み取り", who: "Claude Opus 5.5" },
  { what: "訓練の本人役・家族役", who: "Claude Haiku 5.5 × 10" },
  { what: "訓練の監督と採点", who: "Claude Opus 5.5" },
  { what: "録音の分類", who: "Claude Haiku 5.5" },
  { what: "安否の色と連絡の順位", who: "ルールの表（AI を使わない）" },
];

/** 録画の番号と場面の名前（docs/video/MATERIALS.md の表と同じ）。仮の面に「撮影待ち R07 訓練」と出す */
export const RECORDINGS: Record<string, string> = {
  R01: "担当一覧 平時",
  R02: "本人のページと入れる欄",
  R03: "松山市の様式",
  R04: "本人の 1 枚",
  R05: "医療班の要約",
  R06: "様式の読み取り",
  R07: "訓練",
  R08: "訓練の着信",
  R09: "訓練の採点",
  R10: "発災時の担当一覧",
  R11: "家族のスマホ",
  R12: "本人のスマホ",
  R13: "医療班の受入",
  R14: "行の詳細（録音の分類）",
  R20: "worktree と merge の線",
  R21: "見直し役",
  R22: "フックが配信を止める",
  R23: "MCP の check_leaks",
  R24: "テストの件数",
};
