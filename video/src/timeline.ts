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
  /** 録画の右下に重ねる数の面（字だけ。at は絵の頭からの秒） */
  stat?: { at: number; label: string; text: string; value: string };
  /** 一言の画面の、一言の下の名前（無ければ「協力してくれたケアマネージャー」） */
  by?: string;
  /** 前の絵と重ねずに切り替える（前の絵の印がこの絵の同じ所へ縮んで収まる、続きの絵。72 時間の輪 → 3 本立ての円柱） */
  cutIn?: boolean;
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
    end: 14.8,
    shots: [
      {
        at: 0,
        end: 3.7,
        kind: "text",
        footage: "R01",
        label: "ケアマネージャーの訪問の後ろ姿（B01）をぼかして奥に。問いかけの文字",
        bg: "B01",
        // 冒頭は問いかけ（N01）。最初の 10 秒で誰のどんな課題かを言う（N01・N02）。計画の名前を一番大きく
        cues: [
          { text: "個別避難計画", line: "N01", size: "display", row: 0, hold: true },
          { text: "を知っていますか", line: "N01", size: "h1", row: 0 },
        ],
      },
      // N02 の前半「災害のとき…決めておく計画です」の間は、左に計画の中身を言葉で、右に本物の計画書（松山市の様式の 1 頁目）
      {
        at: 3.7,
        end: 10.0,
        kind: "split",
        footages: ["", "R03"],
        // 様式の頭（題名「個別避難計画」が見える所。R03-3 の 0〜4 秒）
        froms: [0, 0.5],
        label: "これが個別避難計画（松山市の様式）",
        // 様式が映る絵には出典（作者の決め 11/6。市の頁は例外のほかの転用を認めていないので、出所を明らかにする）
        source: "松山市 個別避難計画の様式（2026.9.10）",
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
        at: 10.0,
        end: 14.8,
        kind: "number",
        bg: "B04",
        label: "作成率",
        marker: "だけ",
        value: "15.1%",
        lines: ["個別避難計画あり"],
        sub: "対象 670 万人",
        // 数え上がりが止まるのは N02 の「15.1%」の言い終わり（仮の声で 11.5 秒から）
        beats: [2.6],
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
    at: 14.8,
    end: 27.5,
    shots: [
      // 作者の紹介は左下の名札。真ん中には N03 の頭「私の家族はケアマネージャー」（作者が身近な所にいること。11/6 に文を短くした）
      {
        at: 14.8,
        end: 17.6,
        kind: "plate",
        label: "作者の名札（医学部の学生・家族にケアマネージャー）",
        marker: "ケアマネージャー",
        lines: ["作者　医学部の学生", "家族にケアマネージャー"],
        beats: [0.3, 0.9],
        bg: "B02",
        cues: [
          { text: "私の家族は", line: "N03", size: "h1", row: 0 },
          { text: "ケアマネージャー", line: "N03", size: "hero", row: 1 },
        ],
      },
      {
        at: 17.6,
        end: 22.7,
        kind: "split",
        // 録画の番号が空の所は文字の面（sub を「・」で分けて並べる）
        footages: ["", "R03"],
        // 様式の下の方（未確認の欄。R03-2 の 11 秒）
        froms: [0, 11],
        lines: ["知っている", "書けていない"],
        bg: "B03",
        // N03 の「利用者のことは知っているのに」「書く時間がないんです」に合わせて（仮の声で 17.7 秒・20.0 秒）
        beats: [0.1, 2.4],
        sub: "薬と残り日数・医療機器と電池・家族と支援者・夜に来られる人",
        label: "左に台帳の区分の名前、右に様式の未確認の欄",
        source: "松山市 個別避難計画の様式（2026.9.10）",
        marker: "書けていない",
      },
      {
        at: 22.7,
        end: 27.5,
        kind: "number",
        bg: "B02",
        bgFrom: 4,
        label: "アンケート（問 6 作った計画のその後）",
        marker: "市町村に出して終わり",
        // 受付は 11/5 に閉じた（答えは 4 人、全員ケアマネージャー）。「何人中何人」の形（割合にしない）。生の答えは repo に入れない
        value: "4 人中 4 人",
        lines: ["市町村に出して終わり"],
        sub: "アンケート（ケアマネージャー 4 人、11/4〜11/5）",
        // 「4 人全員」に合わせて（仮の声で 24.1 秒）
        beats: [1.5],
        cues: [{ text: "アンケートでも", line: "N05", size: "h2", slot: "lead" }],
      },
    ],
  },
  {
    id: "S3",
    title: "ケア72",
    ground: "blue",
    at: 27.5,
    end: 46,
    shots: [
      {
        at: 27.5,
        end: 32.4,
        kind: "text",
        label: "気づき（楽に作れて、実際の災害でも役立つ計画）",
        marker: "出る",
        bg: "B05",
        // 2 つの条件は下げずに残し、最後の「大きくなる」を一番大きく
        cues: [
          { text: "楽に作れて", line: "N06", size: "hero", row: 0, hold: true },
          { text: "災害でも役立つ計画", line: "N06", size: "hero", row: 1, hold: true },
          { text: "作る意味が", line: "N06", size: "h1", row: 2 },
          { text: "出る", line: "N06", size: "display", row: 2 },
        ],
      },
      // 題名を 72 時間の輪（G1）の中に置く。題名は N07 の「ケア72」で出す（仮の声で 33.0 秒）。輪の中に名前の 72 時間の意味を声に合わせて
      {
        at: 32.4,
        end: 38.3,
        kind: "ring",
        label: "題名と 72 時間の輪",
        marker: "72 時間",
        lines: ["ケア72"],
        sub: "災害直後の 72 時間",
        beats: [0.5],
        cues: [
          { text: "72", line: "N07", say: "72は", slot: "mark" },
          { text: "災害直後の", line: "N07", size: "h1", row: 0, hold: true },
          { text: "72 時間", line: "N07", say: "72時間", size: "h1", row: 1, hold: true },
        ],
      },
      {
        at: 38.3,
        end: 46,
        // 3 本立ての円柱（parts/Carousel.tsx。作者の頼み 11/5）。声の「計画ができ」「訓練もでき」「災害時は」で円柱が回り、その窓が正面に来る。
        // 見出しの左に白いロゴの印。前の 72 時間の輪の印がそこへ縮んで収まるので、重ねずに切り替える
        kind: "carousel",
        cutIn: true,
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
        source: "松山市 個別避難計画の様式（2026.9.10）",
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
      // 入れる欄（R02-5、11/5 に手元の dev で撮った）。N10 の 3 つの句に合わせて 3 つの絵に。右の 2 列（本人の記録と AI 入力）に寄る
      // 主役の紹介の文と本人のページの上の段は外した（作者の決め 11/6。計画 → 入力 → 記録されていく、の順）
      { at: 46, end: 49.2, kind: "footage", footage: "R02", from: 25.5, label: "入れる欄: 話した文が欄に流れる", zoom: [{ x: 0.38, y: 0.15, w: 0.62 }, { x: 0.4, y: 0.17, w: 0.6 }] },
      { at: 49.2, end: 51.4, kind: "footage", footage: "R02", from: 37.3, label: "入れる欄: Sonnet が記録の 3 項目に分ける", chip: "Claude Sonnet 5.5", zoom: [{ x: 0.4, y: 0.17, w: 0.6 }, { x: 0.42, y: 0.18, w: 0.58 }] },
      { at: 51.4, end: 53.7, kind: "footage", footage: "R02", from: 66.3, label: "入れる欄: 保存と、空いている所だけの問い返し", chip: "Claude Sonnet 5.5", zoom: [{ x: 0.4, y: 0, w: 0.6 }, { x: 0.42, y: 0.01, w: 0.58 }] },
      // 本人のページを上から下まで送る（R15。N11「アプリの中に記録されていきます」）
      // R15-2（11/6、手元の dev）。1.5 秒から 5 秒で「書類」の欄まで送る（経過の欄の手前で止めた）。右の AI 入力の欄（AI 未設定）と左の一覧は映さない
      { at: 53.7, end: 58, kind: "footage", footage: "R15", from: 1.2, rate: 1.2, label: "本人のページを下まで（アプリの中の記録）", zoom: [{ x: 0.2, y: 0.08, w: 0.54 }, { x: 0.2, y: 0.08, w: 0.54 }] },
      { at: 58, end: 64, kind: "flow", footages: ["R03", "R04", "R05"], label: "記録から 3 つの紙面", source: "松山市 個別避難計画の様式（2026.9.10）" },
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
    end: 111,
    shots: [
      // 秒は R07-6・R08-7・R09-6（11/5 夜、訓練の画面の直し〔上の操作は次までと自動進行だけ・出来事の段・着信で返す〕のあとに手元の dev で撮った大雨想定）の
      // markers.json と calls.json から。6.1 秒に訓練の画面が開き、すぐ高橋 ユキの家族の着信が鳴る
      { at: 74, end: 80, kind: "footage", footage: "R07", from: 6.4, label: "訓練の大雨想定。10 人の表と、家族からの最初の着信", chip: "Claude Haiku 5.5 × 10" },
      // 本人役・家族役の言葉: 3 時間の高橋 ユキの家族の電話（R07-6 の 120.8 秒に着信、123.3 秒に出ると「避難所に着きました。母は横になっています。様子は見ています。」が AI の印つきで出る）。
      // 通話の窓は返す言葉の候補の分だけ大きくなったので、少し引いて寄る
      { at: 80, end: 85, kind: "footage", footage: "R07", from: 122.9, label: "本人役・家族役の言葉（高橋 ユキの家族の電話）", zoom: [{ x: 0.26, y: 0.08, w: 0.5 }, { x: 0.27, y: 0.09, w: 0.48 }] },
      // 早送り（自動進行で「次まで」を繰り返す）: 経過 24 時間 → 27 時間、上に出来事の段（R07-6 の 290 秒から 4 倍。着信の窓の無い所）
      { at: 85, end: 88, kind: "footage", footage: "R07", from: 290, rate: 4, label: "72 時間を早送り" },
      // 強調の着信は小林 トシの夫（「停電して、呼吸器が電池に切り替わりました。電池は3時間しかもたないようです。」）。
      // 1.6 秒から: 鳴る → 3.0 秒に出る → 声（video/scripts/app-audio.mjs が R08 の音を作る）
      { at: 88, end: 93, kind: "footage", footage: "R08", from: 1.6, emphasis: true, label: "強調: 着信 小林 トシの夫（呼吸器の電池）", zoom: [{ x: 0.2, y: 0.05, w: 0.6 }, { x: 0.26, y: 0.07, w: 0.5 }] },
      // 手: 36.9 秒に小林 トシ、37.9 秒に訪問依頼、38.9 秒に実行、44.0 秒に「手配済 向かってもらえる」（R07-6 の押した所）。
      // 実行を押す所から、結果が出るまで（44.9 秒からは撮る道具が次の手のために画面を上へ送るので、その前で終える）。対応の欄を上から下へ追う
      { at: 93, end: 99, kind: "footage", footage: "R07", from: 38.9, label: "手: 小林 トシに訪問依頼", zoom: [{ x: 0.25, y: 0.2, w: 0.6 }, { x: 0.25, y: 0.4, w: 0.6 }] },
      // 採点（N19 の「対応の順を採点」「山田さんの酸素の電池が切れるまでに手が届かなかった」）: 真ん中の列の採点（終わった訓練は対応の所に出る）に寄り、
      // 条件到達の山田 ハナ（酸素 内蔵電池 2 時間を超過）の行に囲み
      {
        at: 99,
        end: 107.5,
        kind: "footage",
        footage: "R09",
        from: 2.0,
        label: "採点（順番・報告・空欄・条件到達）",
        chip: "Claude Opus 5.5",
        zoom: [{ x: 0.34, y: 0.11, w: 0.4 }, { x: 0.34, y: 0.12, w: 0.4 }],
        // R09-6 の 2〜8 秒（採点の欄で止まっている間）の山田 ハナの行
        callouts: [{ at: 3.0, box: { x: 0.357, y: 0.406, w: 0.257, h: 0.031 }, label: "電池 超過", tone: "urgent", place: "below" }],
      },
      // 講評と出典（N19 の「出典つきで指摘しました」）: 8.0 秒に講評へ送ったあと（13 秒まで止まっている）。山田 ハナの条件の指摘の出典の行に囲み
      {
        at: 107.5,
        end: 111,
        kind: "footage",
        footage: "R09",
        from: 9.0,
        label: "講評と出典",
        chip: "Claude Opus 5.5",
        zoom: [{ x: 0.34, y: 0.16, w: 0.4 }, { x: 0.34, y: 0.18, w: 0.4 }],
        callouts: [{ at: 0.3, box: { x: 0.364, y: 0.482, w: 0.342, h: 0.049 }, label: "出典", place: "below" }],
      },
    ],
  },
  {
    id: "S6",
    title: "発災時",
    ground: "white",
    at: 111,
    end: 153,
    shots: [
      // 秒は R10-3・R11-3・R12-3・R13-3（手元の dev、11/4 夜に今の main で撮り直した 3 回目）の markers.json とコマの変わり目から。撮り直したら合わせ直す
      // 事業所の画面は左の災害モードと災害情報と、真ん中の確認の窓（T79）に寄る（右の列にケアマネのログインの ID が出るため）
      {
        at: 111,
        end: 115,
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
      { at: 115, end: 119, kind: "split", footages: ["R11", "R10"], froms: [2, 38.9], label: "娘のスマホ（赤と緑）と担当一覧" },
      // 読み直しで山田の行が 2 番目から一番上へ（R10-3 の 49.6 秒）。半分の速さで
      {
        at: 119,
        end: 124,
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
      { at: 124, end: 127, kind: "footage", footage: "R12", from: 4.6, rate: 2.6, label: "本人のスマホ: 赤 → けが ある → 動けない" },
      { at: 127, end: 129, kind: "footage", footage: "R12", from: 12.6, label: "本人のスマホ: 声の問いかけ（大丈夫ですか 状況を説明してください）" },
      { at: 129, end: 133, kind: "footage", footage: "R12", from: 44.8, emphasis: true, label: "強調: 録音（AI が聞いている）" },
      { at: 133, end: 138, kind: "rules", label: "ルールの表の 1 枚" },
      // 行の詳細（R14-1: 11/5 に録音から分類まで撮った回）。86.5 秒に下へ送ったあと 95 秒まで止まっている。
      // 右の列の録音のまとめ（AI）・分類「けが・動けない」（AI、確信 90%）と修正・順番変更に寄る。N24 の 2 つの句に合わせて囲みを 1 つずつ
      {
        at: 138,
        end: 146,
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

      { at: 146, end: 149.5, kind: "footage", footage: "R10", from: 100.5, label: "電話 → 電話の記録" },
      // 受入（R13-3 の 8.7 秒）を押す所を 1.4 秒だけ見せ、N25 の「要約が届きます」の間は医療要約の書類へ。間は 10 コマの重ねでつなぐ
      // R13-3 は受入のすぐあとに受入一覧の「医療要約」を押して撮った（15.2 秒に押し、24.1 秒に書類が出る）
      { at: 149.5, end: 150.9, kind: "footage", footage: "R13", from: 7.9, label: "医療班の受入" },
      {
        at: 150.9,
        end: 153,
        kind: "footage",
        footage: "R13",
        // 書類が出て落ち着いたあと（R13-3 の 24.1 秒に出て 26.4 秒に止まる）。左の紙面（右の原本の列は「受入 到着 かわなぎ小学校」）に寄る
        from: 26.6,
        label: "医療班に届いた要約",
        screen: "医療要約",
        // アンケートの問 7（作者の頼み 11/6）。声は足さず字だけ。すぐ伝えられる 0 人・一部は 3 人・伝えられない 1 人
        stat: { at: 0.1, label: "アンケート（ケアマネージャー 4 人）", text: "災害のとき、薬や医療機器を／医療班にすぐ伝えられる", value: "4 人中 0 人" },
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
    at: 153,
    end: 166,
    shots: [
      { at: 153, end: 159, kind: "models", footages: ["R20", "R21"], label: "使い分けの図と、worktree・見直し役" },
      {
        at: 159,
        end: 166,
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
    at: 166,
    end: 171.5,
    shots: [
      // 計画 1 件の時間（N28）は測れないので外した（作者の決め 11/6）。空いた秒は N29 と N30 へ
      // アンケートの問 9（AI が下書きを作るなら作る気になるか）: なる 1・少しなる 2・ならない 1。一言は「なる」と答えた人の理由（引用可の人だけ。引用不可の人の文は使わない）
      {
        at: 166,
        end: 171.5,
        kind: "quote",
        label: "アンケートの一言（問 9 の理由）",
        lines: ["「作成時間が大幅に短くなると思われるから。」"],
        by: "アンケートの答え（ケアマネージャー）",
        sub: "AI の下書きなら作る気に　なる 1 人・少しなる 2 人・ならない 1 人（4 人中）",
        bg: "B07",
      },
    ],
  },
  {
    id: "S9",
    title: "締め",
    ground: "blue",
    // N28 を外し、N19 を長くして 2:51.5 から（11/6）。前半は言葉、「本当に使える形に」からロゴが描かれる
    at: 171.5,
    end: 180,
    shots: [
      {
        at: 171.5,
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
  { id: "N01", at: 0.3, end: 3.5, ja: "『個別避難計画』を知っていますか。", en: "Have you heard of an \"individual evacuation plan\"?" },
  { id: "N02", at: 3.7, end: 14.6, ja: "災害のとき、在宅の高齢者を誰がどう助けるかを決めておく計画です。でも、できているのは 15.1% だけ。", en: "It sets out who will help an older person living at home in a disaster, and how. But only 15.1% have one." },
  { id: "N03", at: 14.8, end: 22.5, ja: "私の家族はケアマネージャー。利用者のことは知っているのに、書く時間がないんです。", en: "My family member is a care manager. They know their clients well, but there's no time to write it down." },
  // N04 は消した。ID は振り直さない（欠番）
  { id: "N05", at: 22.7, end: 27.4, ja: "アンケートでも、4 人全員が『市町村に出して終わり』。", en: "In our survey, all 4 said their plans were just handed to the city and that was it." },
  { id: "N06", at: 27.6, end: 32.3, ja: "楽に作れて、災害でも役立つ計画なら、作る意味が出る。", en: "A plan that is easy to make and useful in a disaster is worth making." },
  { id: "N07", at: 32.5, end: 38.2, ja: "それがケア72。72 は、災害直後の 72 時間です。", en: "That's Care72. The 72 stands for the first 72 hours after a disaster." },
  // N08 は 3 本立ての文に使い直した（前の能登の関連死の文は 11/4 の冒頭の組み替えで外した）
  { id: "N08", at: 38.4, end: 45.8, ja: "話すだけで計画ができ、訓練もでき、災害時は医療班と情報を共有します。", en: "Talk, and the plan is made. Run drills with it. In a disaster, it shares what matters with the medical team." },
  // N09（輪島の手書きのメモ）は 11/4 の冒頭の組み替えで外した（欠番）
  { id: "N10", at: 46.2, end: 53.6, ja: "ケアマネージャーが話すと、Claude が欄に分け、空いている所だけ聞き返します。", en: "The care manager talks. Claude sorts it into fields, and asks back only about what's missing." },
  { id: "N11", at: 53.8, end: 58.0, ja: "話した内容は、アプリの中に記録されていきます。", en: "What was said is recorded in the app." },
  { id: "N12", at: 58.5, end: 64.5, ja: "記録から、市の様式の避難計画、本人の 1 枚、医療班の要約が出ます。", en: "From that record: the city's evacuation plan form, a one-page sheet for her, and a summary for the medical team." },
  { id: "N13", at: 64.7, end: 69.8, ja: "要約は医療班の記録と同じ順。医学生の目で確かめました。", en: "The summary follows the medical team's own record format. I checked it as a medical student." },
  { id: "N14", at: 70.0, end: 73.6, ja: "ほかの市の様式も、写真から読み取ります。", en: "Other cities' forms can be read from a photo." },
  { id: "N15", at: 74.3, end: 80.0, ja: "次は訓練。利用者 10 人に、Claude Haiku が 1 体ずつ付きます。", en: "Next, the drill. Each of the 10 clients gets their own Claude Haiku agent." },
  { id: "N16", at: 80.2, end: 84.6, ja: "記録を読み、本人や家族になりきって動きます。", en: "Each one reads the record and plays the client or a family member." },
  { id: "N17", at: 84.8, end: 88.0, ja: "72 時間を早送りで進めると、", en: "Fast-forward through the 72 hours, and..." },
  { id: "N18", at: 93.2, end: 98.8, ja: "ケアマネージャーは本番と同じ画面で、電話、出向く、避難所に頼む。", en: "The care manager responds on the same screen used in a real disaster: call, visit, ask a shelter." },
  { id: "N19", at: 99.0, end: 110.6, ja: "終わると Opus が講評。架空の利用者、山田ハナさんの酸素供給装置の電池が切れる前に対応できなかったと、出典つきで指摘しました。", en: "At the end, Opus reviews the response. Citing sources, it pointed out that help did not reach Hana Yamada, a fictional client, before her oxygen device's battery ran out." },
  { id: "N20", at: 111.3, end: 115.3, ja: "そして本番。大雨で、災害モードに入りました。", en: "Then the real thing. Heavy rain, and disaster mode is on." },
  { id: "N21", at: 115.5, end: 119.0, ja: "スマホで安否確認ができます。", en: "Families can check in from their phones." },
  { id: "N22", at: 124.2, end: 130.5, ja: "本人の答えがないと、声で問いかけ、答えを録音して状況をつかみます。", en: "If she doesn't answer, the app asks out loud and records her reply to understand the situation." },
  { id: "N23", at: 133.3, end: 138, ja: "色と順を決めるのは AI ではなく、人が読めるルールの表。", en: "The color and order are set not by AI, but by a rule table people can read." },
  { id: "N24", at: 138.3, end: 143.8, ja: "Claude は録音を分けるだけ。最後に決めるのは、ケアマネージャーです。", en: "Claude only sorts the recording. The care manager makes the final call." },
  { id: "N25", at: 146, end: 150.7, ja: "電話し、避難所の医療班が受け入れると、要約が届きます。", en: "The care manager calls, and when the shelter's medical team takes her in, the summary is there." },
  { id: "N26", at: 153.3, end: 159, ja: "作ったのは Claude Code。設計と実装を分け、並行で進めました。", en: "It was built with Claude Code, with design and implementation split and run in parallel." },
  { id: "N27", at: 159.3, end: 165.7, ja: "フックで鍵と配信を守り、本名を見ない MCP と見直し役で確かめています。", en: "Hooks guard the keys and deploys. An MCP server that never sees real names, and reviewer agents, check the work." },
  { id: "N29", at: 166.5, end: 171.3, ja: "AI の下書きなら作る気になる人は、4 人中 3 人。", en: "With an AI draft, 3 of 4 said they would be willing to make plans." },
  { id: "N30", at: 171.8, end: 179.9, ja: "実用化の課題は山積みです。それでも、まずは一部から、本当に使える形にしていきます。", en: "Getting this into real use still faces many hurdles. But we'll keep working to make it truly usable, starting with one part." },
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
  { what: "記録の入力・問い返し", who: "Claude Sonnet 5.5" },
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
  R15: "本人のページを下まで",
  R20: "worktree と merge の線",
  R21: "見直し役",
  R22: "フックが配信を止める",
  R23: "MCP の check_leaks",
  R24: "テストの件数",
};
