// 3 分動画の時間割。場面と文は docs/video/PLAN.md と SCRIPT.md と同じ。
// 文（LINES）を直すときは PLAN.md・SCRIPT.md も直し、`npm run check` で食い違いを見る。
// このファイルは node から直接読む（scripts/check.mjs）ので、型を消すだけで動く書き方にする（enum・namespace を使わない、ほかの .ts を読まない）。

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const TOTAL_SECONDS = 180;

/** 寄りの枠。録画の幅と高さに対する割合（0〜1）。w は幅の割合で、高さは同じ割合（縦横の比は録画のまま） */
export type Rect = { x: number; y: number; w: number };

export type Shot = {
  /** 動画の頭からの秒 */
  at: number;
  end: number;
  kind:
    | "footage" // 録画 1 本
    | "split" // 録画を横に並べる（footages）
    | "title" // ケア72 の題名
    | "text" // 文字だけ（lines）
    | "ring" // 72 時間の輪（G1）
    | "number" // 大きな数字（value）
    | "bars" // 2 本の棒（G2）
    | "memo" // 手書きのメモの線画（G3）
    | "flow" // 台帳から 3 つの出力（F1）
    | "rules" // ルールの表の 1 枚（F2）
    | "models" // 使い分けの図（F3）と端末の録画
    | "quote" // 協力ケアマネの一言
    | "end"; // 終わりの画面（G5）
  /** 何を映すか（作る人向けの説明。素材が無い間は仮の面に出す） */
  label: string;
  /** 録画の番号（docs/video/MATERIALS.md の R01…） */
  footage?: string;
  footages?: string[];
  /** 録画の中の始まりの秒（同じ録画の別の所を使うとき） */
  from?: number;
  /** 録画の進む速さ。0.5 は半分の速さ（強調の所） */
  rate?: number;
  /** 寄り。始まりの枠から終わりの枠へ動く */
  zoom?: [Rect, Rect];
  /** 右上に小さく出すモデルの名前 */
  chip?: string;
  /** 下に小さく出す出典 */
  source?: string;
  /** 強調の 3 つの瞬間（電話が鳴る・並び替わる・録音）。音楽を下げる */
  emphasis?: boolean;
  /** 文字の画面・数字の画面の中身 */
  lines?: string[];
  value?: string;
  sub?: string;
};

/** 地の色。青と白のコントラスト（作者の指示 11/3 03:4x）。話の段（S1〜S3・S8・S9）は青地、道具の段（S4〜S7）は白地 */
export type Ground = "white" | "blue";

export type Scene = { id: string; title: string; ground: Ground; at: number; end: number; shots: Shot[] };

export type Line = { id: string; at: number; end: number; ja: string; en: string };

export const SCENES: Scene[] = [
  {
    id: "S1",
    title: "自己紹介",
    ground: "blue",
    at: 0,
    end: 7,
    shots: [
      {
        at: 0,
        end: 7,
        kind: "text",
        footage: "R01",
        label: "担当一覧の平時をぼかして奥に。作者の紹介の文字",
        lines: ["作者 医学部の学生"],
        sub: "ケアマネ × 在宅の要介護高齢者 × 災害の最初の 72 時間",
      },
    ],
  },
  {
    id: "S2",
    title: "3 本立て",
    ground: "blue",
    at: 7,
    end: 20,
    shots: [
      { at: 7, end: 13, kind: "title", label: "題名", lines: ["ケア72"], sub: "ケアマネが知っていることを 災害の最初の 72 時間に" },
      {
        at: 13,
        end: 20,
        kind: "split",
        footages: ["R03", "R07", "R10"],
        lines: ["計画", "訓練", "発災時"],
        label: "様式が埋まる・72 時間の棒・一覧が並び替わる",
      },
    ],
  },
  {
    id: "S3",
    title: "経緯",
    ground: "blue",
    at: 20,
    end: 52,
    shots: [
      { at: 20, end: 26, kind: "ring", label: "72 時間の輪と高校の学習の資料", lines: ["72 時間"] },
      { at: 26, end: 31, kind: "text", label: "医学部 → 家族はケアマネ", lines: ["医学部", "家族はケアマネ"] },
      {
        at: 31,
        end: 39,
        kind: "split",
        // 録画の番号が空の所は文字の面（sub を「・」で分けて並べる）
        footages: ["", "R03"],
        lines: ["知っている", "届かない"],
        sub: "薬と残り日数・医療機器と電池・家族と支援者・夜に来られる人",
        label: "左に台帳の区分の名前、右に様式の未確認の欄",
      },
      {
        at: 39,
        end: 44,
        kind: "number",
        label: "作成率",
        value: "15.1%",
        sub: "対象 670 万人",
        source: "共同通信 2026-10-04（熊本日日新聞）",
      },
      { at: 44, end: 48, kind: "bars", label: "能登の死者と関連死", source: "熊本日日新聞 2026-08" },
      { at: 48, end: 52, kind: "memo", label: "手書きのメモの線画（イメージ）", source: "厚生労働省" },
    ],
  },
  {
    id: "S4",
    title: "計画",
    ground: "white",
    at: 52,
    end: 80,
    shots: [
      {
        at: 52,
        end: 57,
        kind: "footage",
        footage: "R02",
        label: "本人のページの上の段（山田 ハナ）",
        zoom: [
          { x: 0.3, y: 0, w: 0.7 },
          { x: 0.38, y: 0.02, w: 0.5 },
        ],
      },
      { at: 57, end: 64, kind: "footage", footage: "R02", from: 8, label: "入れる欄: 話す → 欄が埋まる → 問い返し", chip: "Claude Sonnet 5.5" },
      { at: 64, end: 70, kind: "flow", footages: ["R03", "R04", "R05"], label: "台帳から 3 つの紙面" },
      {
        at: 70,
        end: 76,
        kind: "footage",
        footage: "R05",
        label: "医療班の要約: 特記事項（常用薬等）・中断注意・メディカル ID",
        sub: "災害診療記録 2018 の順",
      },
      { at: 76, end: 80, kind: "footage", footage: "R06", label: "様式の読み取り: 写真 → 対応表", chip: "Claude Opus 5.5" },
    ],
  },
  {
    id: "S5",
    title: "訓練",
    ground: "white",
    at: 80,
    end: 114,
    shots: [
      { at: 80, end: 86, kind: "footage", footage: "R07", label: "10 分版を始める。左に 10 人", chip: "Claude Haiku 5.5 × 10" },
      { at: 86, end: 91, kind: "footage", footage: "R07", from: 20, label: "本人役・家族役の言葉が流れる" },
      { at: 91, end: 94, kind: "footage", footage: "R07", from: 60, rate: 4, label: "72 時間の棒が早送りで進む" },
      { at: 94, end: 99, kind: "footage", footage: "R08", emphasis: true, label: "強調: 着信 山田 ハナの娘" },
      { at: 99, end: 105, kind: "footage", footage: "R07", from: 120, label: "7 つの手: 訪問看護に出向いてもらう" },
      { at: 105, end: 114, kind: "footage", footage: "R09", label: "採点と講評（出典つき）", chip: "Claude Opus 5.5" },
    ],
  },
  {
    id: "S6",
    title: "発災時",
    ground: "white",
    at: 114,
    end: 150,
    shots: [
      { at: 114, end: 118, kind: "footage", footage: "R10", label: "大雨に切替 → 発災時の表" },
      { at: 118, end: 122, kind: "split", footages: ["R11", "R10"], label: "娘のスマホ（赤と緑）と担当一覧" },
      { at: 122, end: 125, kind: "footage", footage: "R10", from: 30, rate: 0.5, emphasis: true, label: "強調: 山田の行が一番上へ（至急）" },
      { at: 125, end: 130, kind: "footage", footage: "R12", label: "本人のスマホ: 赤 → けが → 止まる → 声の問いかけ" },
      { at: 130, end: 134, kind: "footage", footage: "R12", from: 40, emphasis: true, label: "強調: 録音と文字起こし。理由に分類（AI）" },
      { at: 134, end: 139, kind: "rules", label: "ルールの表の 1 枚" },
      { at: 139, end: 145, kind: "footage", footage: "R10", from: 70, label: "行の詳細: 分類修正・優先変更", chip: "Claude Haiku 5.5 分類だけ" },
      { at: 145, end: 150, kind: "split", footages: ["R10", "R13"], label: "電話 → 医療班の受入 → 要約" },
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
    end: 175,
    shots: [
      {
        at: 163,
        end: 169,
        kind: "number",
        label: "計画 1 件の時間の前と後",
        value: "［X 時間］ → ［Y 分］",
        sub: "実測 架空の事例［N］件・ケアマネ［N］人。ふだんの時間は本人の申告",
      },
      { at: 169, end: 175, kind: "quote", label: "協力ケアマネの一言と 2 つ目の数字", lines: ["［協力ケアマネの一言］"], sub: "医療班の手元の割合 ［T34 か訓練の結果。無ければ未測定］" },
    ],
  },
  {
    id: "S9",
    title: "締め",
    ground: "blue",
    at: 175,
    end: 180,
    shots: [{ at: 175, end: 180, kind: "end", label: "終わりの画面" }],
  },
];

export const LINES: Line[] = [
  { id: "N01", at: 0.5, end: 6.5, ja: "医学部で学んでいます。家族は、在宅のお年寄りを受け持つケアマネです。", en: "I'm a medical student. Someone in my family is a care manager for older people who live at home." },
  { id: "N02", at: 7.1, end: 12.7, ja: "ケア72。ケアマネの知っていることを、災害の 72 時間に届けます。", en: "Care72 carries what a care manager knows into the first 72 hours of a disaster." },
  { id: "N03", at: 12.8, end: 19.6, ja: "話して埋まる避難計画。AI が利用者を演じる訓練。発災時の、安否と連絡の順。", en: "A plan you fill in by talking. A drill where AI plays your clients. And in a disaster: who is safe, and who to call first." },
  { id: "N04", at: 20.3, end: 26.3, ja: "高校の［高校の学習の名前］で、［学んだこと 1 文］。", en: "In high school, in [name of the program], I learned [one sentence]." },
  { id: "N05", at: 26.5, end: 31.0, ja: "医学部に進み、家族の仕事を近くで見て、気づきました。", en: "Then, in medical school, watching my family's work up close, I noticed something." },
  { id: "N06", at: 31.2, end: 39.2, ja: "ケアマネは利用者のことを全部知っている。でも計画に起こす時間がなく、72 時間に届く道もない。", en: "Care managers know everything about their clients. But there's no time to turn it into a plan, and no way for it to reach anyone in those 72 hours." },
  { id: "N07", at: 39.4, end: 44.0, ja: "個別避難計画ができているのは、対象の 15.1%。", en: "Only 15.1% of the people who need an individual evacuation plan have one." },
  { id: "N08", at: 44.2, end: 47.4, ja: "能登では、527 人が関連死でした。", en: "In the Noto earthquake, 527 deaths were disaster-related." },
  { id: "N09", at: 47.6, end: 51.9, ja: "輪島の避難所では、薬のメモが手書きで、用量が抜けていた。", en: "At shelters in Wajima, medication notes were handwritten, and doses were left out." },
  { id: "N10", at: 52.3, end: 57.3, ja: "主役は架空の利用者、山田ハナさん。84 歳、在宅酸素。", en: "Meet a fictional client, Hana Yamada. 84, on home oxygen." },
  { id: "N11", at: 57.5, end: 64.3, ja: "ケアマネが話すと、Claude が台帳の欄に分け、空いている所だけ聞き返します。", en: "The care manager talks. Claude sorts it into her record, and asks back only about what's missing." },
  { id: "N12", at: 64.5, end: 70.5, ja: "台帳から、市の様式の避難計画、本人の 1 枚、医療班の要約が出ます。", en: "From that one record: the city's evacuation plan form, a one-page sheet for her, and a summary for the medical team." },
  { id: "N13", at: 70.7, end: 75.8, ja: "要約は医療班の記録と同じ順。医学生の目で確かめました。", en: "The summary follows the medical team's own record format. I checked it as a medical student." },
  { id: "N14", at: 76.0, end: 79.6, ja: "ほかの市の様式も、写真から読み取ります。", en: "Other cities' forms can be read from a photo." },
  { id: "N15", at: 80.3, end: 86.0, ja: "次は訓練。利用者 10 人に、Claude Haiku が 1 体ずつ付きます。", en: "Next, the drill. Each of the 10 clients gets their own Claude Haiku agent." },
  { id: "N16", at: 86.2, end: 90.6, ja: "台帳を読み、本人や家族になりきって動きます。", en: "Each one reads the record and plays the client or a family member." },
  { id: "N17", at: 90.8, end: 94.0, ja: "72 時間を早送りで進めると、", en: "Fast-forward through the 72 hours, and..." },
  { id: "N18", at: 99.2, end: 104.8, ja: "ケアマネは本番と同じ画面で手を打ちます。電話、出向く、避難所に頼む。", en: "The care manager responds on the same screen used in a real disaster: call, visit, ask a shelter." },
  { id: "N19", at: 105.0, end: 113.6, ja: "終わると Opus が対応の順を採点。透析先の確認が後回しだったと、出典つきで指摘しました。", en: "At the end, Opus scores the order of response. It pointed out, with sources, that checking the dialysis clinic came too late." },
  { id: "N20", at: 114.3, end: 118.3, ja: "そして本番。大雨で、災害モードに入りました。", en: "Then the real thing. Heavy rain, and disaster mode is on." },
  { id: "N21", at: 118.5, end: 122.0, ja: "娘さんのスマホには、赤と緑の 2 つだけ。", en: "Her daughter's phone shows just two buttons: red and green." },
  { id: "N22", at: 125.2, end: 130.0, ja: "本人の答えが止まると、声で問いかけ、周りの音ごと録音します。", en: "If she stops answering, the app asks out loud and records the sound around her." },
  { id: "N23", at: 134.3, end: 139.0, ja: "色と順を決めるのは AI ではなく、人が読めるルールの表。", en: "The color and order are set not by AI, but by a rule table people can read." },
  { id: "N24", at: 139.3, end: 144.8, ja: "Claude は録音を分けるだけ。最後に決めるのは、ケアマネです。", en: "Claude only sorts the recording. The care manager makes the final call." },
  { id: "N25", at: 145.0, end: 149.7, ja: "電話し、避難所の医療班が受け入れると、要約が届きます。", en: "The care manager calls, and when the shelter's medical team takes her in, the summary is there." },
  { id: "N26", at: 150.3, end: 156.0, ja: "作ったのは Claude Code。設計と実装を分け、並行で進めました。", en: "It was built with Claude Code, with design and implementation split and run in parallel." },
  { id: "N27", at: 156.3, end: 162.7, ja: "フックで鍵と配信を守り、本名を見ない MCP と見直し役で確かめています。", en: "Hooks guard the keys and deploys. An MCP server that never sees real names, and reviewer agents, check the work." },
  { id: "N28", at: 163.3, end: 169.0, ja: "協力してくれたケアマネの計画 1 件は、ふだん［X 時間］、ケア72 で［Y 分］。", en: "For the care manager who helped us, one plan usually takes [X hours]. With Care72, [Y minutes]." },
  { id: "N29", at: 169.2, end: 174.8, ja: "［協力ケアマネの一言、または T34 のアンケートの結果 1 文］", en: "[A word from the partner care manager, or one line from the T34 survey]" },
  { id: "N30", at: 175.4, end: 179.4, ja: "知っていることを、最初の 72 時間に。ケア72。", en: "What they know, into the first 72 hours. Care72." },
];

/** ルールの表の 1 枚（F2）に出す行。docs/TRIAGE.md の「色と理由の 1 行」から写した 13 行のうちの 7 行。撮影の前に今の表と照らす */
export const RULE_ROWS: { input: string; state: "urgent" | "check" | "unknown" | "ok"; reason: string }[] = [
  { input: "赤 ＋ けが・動けない", state: "urgent", reason: "本人が「動けない」（最上位）" },
  { input: "赤だけ", state: "urgent", reason: "本人が「無事じゃない」" },
  { input: "不明 ＋ 停電が機器の時計を超えた", state: "urgent", reason: "酸素 内蔵電池 2 時間を超過" },
  { input: "不明 ＋ 時計の半分を過ぎた", state: "check", reason: "透析 次の回まで 残り 18 時間" },
  { input: "不明（時計の半分まで）", state: "unknown", reason: "連絡なし 6 時間" },
  { input: "緑だが機器の時計の半分を過ぎた", state: "check", reason: "無事だが酸素 内蔵電池 残り 30 分" },
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
