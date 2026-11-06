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
  /** split の 2 つの間に、左から右への矢印と赤い ×（知っている → 書けていない。11/6） */
  cross?: boolean;
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
    end: 14.5,
    shots: [
      {
        at: 0,
        end: 3.5,
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
        at: 3.5,
        end: 9.8,
        kind: "split",
        footages: ["", "R03"],
        // 様式の頭（題名「個別避難計画」が見える所。R03-3 の 0〜4 秒）
        froms: [0, 0.5],
        label: "これが個別避難計画（松山市の様式）",
        // 様式が映る絵には出典（作者の決め 11/6。市の頁は例外のほかの転用を認めていないので、出所を明らかにする）
        source: "松山市 個別避難計画の様式（2026.9.10）・記入は架空の例",
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
        at: 9.8,
        end: 14.5,
        kind: "number",
        bg: "B04",
        label: "作成率",
        // 白い帯は数（作者の頼み 11/6。前は「だけ」）
        marker: "15.1%",
        value: "15.1%",
        lines: ["個別避難計画あり"],
        sub: "対象 全国 670 万人",
        // 数え上がりが止まるのは N02 の「15.1%」の言い終わり
        beats: [4.0],
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
    at: 14.5,
    end: 29.2,
    shots: [
      // 作者の紹介は左下の名札。真ん中に N03 の頭「私は家族にケアマネジャーがいます」（作者の文 11/6）
      {
        at: 14.5,
        end: 18.0,
        kind: "plate",
        label: "作者の名札（医学部の学生・家族にケアマネジャー）",
        marker: "ケアマネジャー",
        lines: ["作者　医学部の学生", "家族にケアマネジャー"],
        beats: [0.3, 0.9],
        bg: "B02",
        cues: [
          { text: "私は家族に", line: "N03", size: "h1", row: 0 },
          { text: "ケアマネジャー", line: "N03", size: "hero", row: 1 },
        ],
      },
      {
        at: 18.0,
        end: 24.0,
        kind: "split",
        // 録画の番号が空の所は文字の面（sub を「・」で分けて並べる）。前の赤い × の矢印は安っぽいので外した（作者の声 11/6）
        footages: ["", "R03"],
        // 様式の下の方（未確認の欄。R03-2 の 11 秒）
        froms: [0, 11],
        lines: ["知っている", "書けていない"],
        bg: "B03",
        // N03 の「利用者のことは知っています」「でも計画を書く時間がないんです」に合わせて
        beats: [0.1, 2.7],
        sub: "薬と残り日数・医療機器と電池・家族と支援者・かかりつけ医",
        label: "左に知っていること、右に様式の未確認の欄",
        marker: "書けていない",
        source: "松山市 個別避難計画の様式（2026.9.10）・記入は架空の例",
      },
      {
        at: 24.0,
        end: 29.2,
        kind: "number",
        bg: "B02",
        bgFrom: 4,
        label: "アンケート（問 6 作った計画のその後）",
        // 受付は 11/5 に閉じた（答えは 4 人、全員ケアマネジャー）。「何人中何人」の形（割合にしない）。生の答えは repo に入れない
        marker: "4 人",
        value: "4 人中 4 人",
        // 問 6（いくつでも）: 市町村に出して終わり 4・本人家族の手元 1・事業所で見返している 0（作者の頼み 11/6「活用できる人もゼロ」）
        lines: ["市町村に出して終わり", "事業所で見返す人は 0 人"],
        sub: "1 事業所のケアマネジャー 4 人（自己調査、11/4〜11/5）",
        // 「4 人全員」に合わせて
        beats: [1.7],
        cues: [{ text: "アンケートでも", line: "N05", size: "h2", slot: "lead" }],
      },
    ],
  },
  {
    id: "S3",
    title: "ケア72",
    ground: "blue",
    at: 29.2,
    end: 48.5,
    shots: [
      {
        at: 29.2,
        end: 35.9,
        kind: "text",
        label: "気づき（楽に作れて、災害でも役立つ計画）",
        marker: "出る",
        bg: "B05",
        cues: [
          { text: "楽に作れて", line: "N06", size: "hero", row: 0, hold: true },
          { text: "災害でも役立つ計画", line: "N06", size: "hero", row: 1, hold: true },
          { text: "作る意味が", line: "N06", size: "h1", row: 2 },
          { text: "出る", line: "N06", size: "display", row: 2 },
        ],
      },
      // 題名。ロゴと名前を出して弧が回るだけ（作者の頼み 11/6。前の 72 時間の時計と言葉は外した）。最後に印が次の見出しの印へ縮んで収まる
      {
        at: 35.9,
        end: 40.8,
        kind: "ring",
        label: "題名（ロゴが回る）",
        lines: ["ケア72"],
        beats: [0.8],
      },
      {
        at: 40.8,
        end: 48.5,
        // 3 本立ての円柱（parts/Carousel.tsx）。声の「災害対策計画づくりから」「訓練」「発災時の対応まで」で円柱が回り、その窓が正面に来る
        kind: "carousel",
        cutIn: true,
        footages: ["R03", "R07", "R10"],
        froms: [0, 7.2, 50.9],
        lines: ["計画", "訓練", "発災時"],
        cues: [
          { text: "計画", line: "N08", say: "災害対策計画づくりから", slot: "mark" },
          { text: "訓練", line: "N08", say: "訓練", slot: "mark" },
          { text: "発災時", line: "N08", say: "発災時の対応まで", slot: "mark" },
        ],
        label: "様式・訓練・一覧（円柱）",
        source: "松山市 個別避難計画の様式（2026.9.10）・記入は架空の例",
      },
    ],
  },
  {
    id: "S4",
    title: "計画",
    ground: "white",
    at: 48.5,
    end: 75.5,
    shots: [
      // 入れる欄（R02-5、11/5 に手元の dev で撮った）。N10 の句に合わせて 3 つの絵に。右の 2 列（本人の記録と AI 入力）に寄る
      { at: 48.5, end: 53.0, kind: "footage", footage: "R02", from: 25.5, label: "入れる欄: 話した文が欄に流れる", zoom: [{ x: 0.38, y: 0.15, w: 0.62 }, { x: 0.4, y: 0.17, w: 0.6 }] },
      {
        at: 53.0,
        end: 57.0,
        kind: "footage",
        footage: "R02",
        from: 37.3,
        label: "入れる欄: Sonnet が記録の 3 項目に分ける",
        chip: "Claude Sonnet 5.5",
        zoom: [{ x: 0.4, y: 0.17, w: 0.6 }, { x: 0.42, y: 0.18, w: 0.58 }],
        // アンケートの問 9（11/6。前の S8 の声を字だけにしてここへ）: なる 1・少しなる 2・ならない 1
        stat: { at: 0.2, label: "アンケート（ケアマネジャー 4 人）", text: "AI の下書きなら／作る気になる", value: "4 人中 3 人" },
      },
      { at: 57.0, end: 62.1, kind: "footage", footage: "R02", from: 66.3, label: "入れる欄: 保存と、抜けている所の質問", chip: "Claude Sonnet 5.5", zoom: [{ x: 0.4, y: 0, w: 0.6 }, { x: 0.42, y: 0.01, w: 0.58 }] },
      // R15-2（11/6、手元の dev）。本人のページを上から「書類」の欄まで送る（経過の欄の手前で止めた）。右の AI 入力の欄（AI 未設定）と左の一覧は映さない
      { at: 62.1, end: 66.7, kind: "footage", footage: "R15", from: 1.2, rate: 1.15, label: "本人のページを下まで（アプリの中の記録）", zoom: [{ x: 0.2, y: 0.08, w: 0.54 }, { x: 0.2, y: 0.08, w: 0.54 }] },
      { at: 66.7, end: 71.0, kind: "flow", footages: ["R03", "R04", "R05"], label: "記録から 3 つの紙面", source: "松山市 個別避難計画の様式（2026.9.10）・記入は架空の例" },
      // 様式の読み取り（R06-1）。架空の「こもれび市」の白紙の様式の画像 → Opus の対応表（16.6 秒に出る）。作者の推す所（11/6）は字で
      {
        at: 71.0,
        end: 75.5,
        kind: "footage",
        footage: "R06",
        from: 14.1,
        label: "様式の読み取り: 写真 → 対応表",
        chip: "Claude Opus 5.5",
        // 字幕と重ならないよう、窓の右下の面に（11/6）
        stat: { at: 0.3, label: "自治体ごとの様式", text: "欄を読み取って枠ごとに書き込み／足りない所は手で直す", value: "" },
        zoom: [{ x: 0, y: 0, w: 1 }, { x: 0.1, y: 0.05, w: 0.8 }],
      },
    ],
  },
  {
    id: "S5",
    title: "訓練",
    ground: "white",
    at: 75.5,
    end: 121.4,
    shots: [
      // 地震想定で撮り直した R07-8・R08-8・R09-8（11/6 夜、手元の dev）。秒は markers.json と calls.json から。6.1 秒に訓練の画面、14.1 秒に小林 トシへ訪問依頼
      { at: 75.5, end: 85.5, kind: "footage", footage: "R07", from: 6.1, rate: 0.8, label: "訓練の地震想定。10 人の表と被害状況", chip: "Claude Haiku 5.5 × 10" },
      // 早送り（自動進行で「次まで」を繰り返す）。着信の窓の無い 230 秒から 4 倍
      { at: 85.5, end: 94.0, kind: "footage", footage: "R07", from: 230, rate: 4, label: "72 時間を早送り" },
      // 強調の着信は山田 ハナの娘（「母の家に向かっています。酸素ボンベが残り少ないです。」）。R08-8: 0.5 秒に鳴る → 3.0 秒に出る → 声（app-audio.mjs）
      { at: 94.0, end: 99.9, kind: "footage", footage: "R08", from: 2.2, emphasis: true, label: "強調: 着信 山田 ハナの娘（酸素ボンベ）", zoom: [{ x: 0.2, y: 0.05, w: 0.6 }, { x: 0.26, y: 0.07, w: 0.5 }] },
      // 手: 14.1 秒に小林 トシ → 訪問依頼を選ぶ所（結果は地震で人が足りず「手配不可」になるので、その前で終える）
      { at: 99.9, end: 108.0, kind: "footage", footage: "R07", from: 14.3, rate: 0.95, label: "手: 小林 トシに訪問依頼", zoom: [{ x: 0.25, y: 0.2, w: 0.6 }, { x: 0.25, y: 0.4, w: 0.6 }] },
      // 採点（R09-8 の 2〜8 秒）。条件到達の 1 行目が「山田 ハナ 酸素 内蔵電池 2 時間を超過」
      { at: 108.0, end: 114.5, kind: "footage", footage: "R09", from: 2.0, label: "採点（順番・報告・空欄・条件到達）", chip: "Claude Opus 5.5", zoom: [{ x: 0.34, y: 0.11, w: 0.4 }, { x: 0.34, y: 0.11, w: 0.4 }] },
      // 講評と出典（8.1 秒に講評へ送り、13.2 秒に出典の行へ）。止まった囲みは付けない
      { at: 114.5, end: 121.4, kind: "footage", footage: "R09", from: 8.4, rate: 0.8, label: "講評と出典", chip: "Claude Opus 5.5", zoom: [{ x: 0.34, y: 0.16, w: 0.4 }, { x: 0.34, y: 0.16, w: 0.4 }] },
    ],
  },
  {
    id: "S6",
    title: "発災時",
    ground: "white",
    at: 121.4,
    end: 160.2,
    shots: [
      // 地震で撮り直した R10-9・R11-9・R12-10・R13-9・R14-10（11/6 夜、手元の dev）。事業所の画面は左の災害モードと真ん中の確認の窓に寄る
      {
        at: 121.4,
        end: 127.6,
        kind: "footage",
        footage: "R10",
        from: 1.0,
        label: "地震に切替（確認の窓）",
        screen: "事業所",
        zoom: [
          { x: 0, y: 0, w: 0.66 },
          { x: 0.04, y: 0.05, w: 0.6 },
        ],
      },
      // 家族のスマホ（R11-9: 2.1 秒に「無事ですか」、5.1 秒に赤）と担当一覧（R10-9: 101.1 秒に家族の赤で読み直し）
      { at: 127.6, end: 133.0, kind: "split", footages: ["R11", "R10"], froms: [2, 96.5], label: "家族のスマホ（無事ですか）と担当一覧" },
      // 本人のスマホ（R12-10）: 赤 5.0 → けが ある 8.0 → 動けない 10.3 を 2.2 倍で、定型文の問いかけ（AI 音声。文は決まった物）、録音
      {
        at: 133.0,
        end: 136.0,
        kind: "footage",
        footage: "R12",
        from: 4.6,
        rate: 2.2,
        label: "本人のスマホ: 赤 → けが ある → 動けない",
        // 本当に危ないときはボタンを押せない（作者の頼み 11/6。出典は兵庫県の調査、SCRIPT.md の出典の表）
        stat: { at: 0.2, label: "阪神・淡路大震災の直接死（兵庫県 2005）", text: "窒息・圧死が占める割合", value: "72.6%" },
      },
      { at: 136.0, end: 138.2, kind: "footage", footage: "R12", from: 12.9, label: "本人のスマホ: AI 音声の問いかけ（大丈夫ですか 状況を説明してください）" },
      { at: 138.2, end: 140.4, kind: "footage", footage: "R12", from: 44.6, emphasis: true, label: "強調: 録音（背景の音からも情報を得る）", stat: { at: 0.1, label: "録音", text: "背景の音からも／情報を得る", value: "" } },
      // 行の詳細（R14-10）。44.0 秒に下へ送ったあと止まっている。録音のまとめ（AI）・分類と人の判断（順番変更）に囲みを 1 つずつ（51 秒のコマで測った）
      {
        at: 140.4,
        end: 147.1,
        kind: "footage",
        footage: "R14",
        from: 51.0,
        label: "行の詳細: 録音のまとめ（AI）と人の判断",
        chip: "Claude Haiku 5.5",
        zoom: [{ x: 0.42, y: 0.28, w: 0.58 }, { x: 0.46, y: 0.32, w: 0.54 }],
        callouts: [
          { at: 0.4, box: { x: 0.666, y: 0.465, w: 0.22, h: 0.15 }, label: "AI のまとめ" },
          { at: 3.0, box: { x: 0.666, y: 0.652, w: 0.312, h: 0.15 }, label: "人の判断", place: "below" },
        ],
      },
      // 読み直しで山田の行が一番上へ（R10-9 の 110.8 秒、本人の赤）。半分の速さで
      {
        at: 147.1,
        end: 150.0,
        kind: "footage",
        footage: "R10",
        from: 109.6,
        rate: 0.5,
        emphasis: true,
        label: "強調: 山田の行が一番上へ（至急）",
        callouts: [{ at: 2.5, box: { x: 0.0125, y: 0.394, w: 0.975, h: 0.072 }, label: "至急 連絡順 1", tone: "urgent", place: "below" }],
      },
      { at: 150.0, end: 152.8, kind: "rules", label: "ルールの表の 1 枚" },
      // 受入（R13-9 の 10.5 秒）を押す所を 1.8 秒、そのあと医療要約の書類（55 秒ごろに出て 55.9 秒から下へ送るので、その前をゆっくり）
      // 問 7 は受入の絵から出す（作者の決め 11/6）。次の要約の絵も同じ所に出し続ける（at を負にして出る動きを繰り返さない）
      { at: 152.8, end: 154.6, kind: "footage", footage: "R13", from: 9.8, label: "医療班の受入", stat: { at: 0.1, label: "アンケート（ケアマネジャー 4 人）", text: "災害のとき、薬や医療機器を／医療班にすぐ伝えられる", value: "4 人中 0 人" } },
      {
        at: 154.6,
        end: 160.2,
        kind: "footage",
        footage: "R13",
        from: 55.0,
        rate: 0.15,
        label: "医療班に届いた要約",
        screen: "医療要約",
        // アンケートの問 7（前の受入の絵から続けて出す）。声は足さず字だけ
        stat: { at: -1, label: "アンケート（ケアマネジャー 4 人）", text: "災害のとき、薬や医療機器を／医療班にすぐ伝えられる", value: "4 人中 0 人" },
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
    at: 160.2,
    end: 163.7,
    shots: [
      // 作者の声（11/6）: 右の端末の録画は何の画面か分からないので外し、短く。声なしで使い分けの表と、右に作り方の字
      { at: 160.2, end: 163.7, kind: "models", footages: [], label: "使い分けの表", sub: "開発は Claude Code／設計と実装を分けて並行で／フックと見直し役で確かめる" },
    ],
  },
  {
    id: "S9",
    title: "締め",
    ground: "blue",
    // S8（アンケートの一言）は外し、問 9 は S4 の入れる欄に字で（11/6）
    at: 163.7,
    end: 180,
    shots: [
      {
        at: 163.7,
        end: 177.2,
        kind: "text",
        label: "締めの言葉（作者の文 11/6）",
        marker: "計画だけで終わらせない",
        bg: "B08",
        cues: [
          { text: "普及や実用化への課題はあります", line: "N30", size: "h1", row: 0 },
          { text: "それでも", line: "N30", size: "h1", row: 1 },
          { text: "計画だけで終わらせない", line: "N30", size: "hero", row: 2, hold: true },
          { text: "大きなポテンシャル", line: "N30", size: "hero", row: 3, hold: true },
        ],
      },
      { at: 177.2, end: 180, kind: "end", label: "終わりの画面", bg: "B08", bgFrom: 5.8 },
    ],
  },
];

export const LINES: Line[] = [
  // 11/6 作者の絵コンテの書き込みで全体を組み直した。声の文は作者の文のまま（直したのは事実に合わせた所だけ）。N13・N14・N16・N26・N27・N29・N31 は外した（欠番。N16 と N31 は 3 分に収めるため作者の決め 11/6）
  { id: "N01", at: 0.3, end: 3.3, ja: "『個別避難計画』を知っていますか。", en: "Have you heard of an \"individual evacuation plan\"?" },
  { id: "N02", at: 3.5, end: 14.3, ja: "災害のとき、在宅の高齢者を誰がどう助けるかを決めておく計画です。でも、できているのは 15.1% だけ。", en: "It sets out who will help an older person living at home in a disaster, and how. But only 15.1% have one." },
  { id: "N03", at: 14.6, end: 23.9, ja: "私は家族にケアマネジャーがいます。利用者のことは知っています、でも計画を書く時間がないんです。", en: "A member of my family is a care manager. They know their clients, but there's no time to write the plans." },
  { id: "N05", at: 24.1, end: 29, ja: "アンケートでも、4 人全員が『市町村に出して終わり』。", en: "In our survey, all 4 said their plans were just handed to the city and that was it." },
  { id: "N06", at: 29.4, end: 35.8, ja: "楽に作れて、災害でも役立つ計画なら、作る意味が出る、そう考えました。", en: "A plan that is easy to make and useful in a disaster is worth making. That was my thought." },
  { id: "N07", at: 36, end: 40.7, ja: "そこでケア72というアプリを作成しました。", en: "So I built an app called Care72." },
  { id: "N08", at: 40.9, end: 48.3, ja: "災害対策計画づくりから訓練、発災時の対応までケア72一つで完結します。", en: "From making the plan to drills and the response in a disaster, Care72 does it all." },
  { id: "N10", at: 48.8, end: 62, ja: "まずは計画。箇条書きや文書、音声で情報を入力、Claude がアプリ内に利用者の情報を記録していきます。抜けている部分は Claude が質問します。", en: "First, the plan. Enter notes, documents or voice, and Claude records the client's information in the app. Claude asks about whatever is missing." },
  { id: "N11", at: 62.2, end: 66.6, ja: "項目分けされアプリ内に見やすく記録されます。", en: "It is sorted into fields and kept clearly in the app." },
  { id: "N12", at: 66.8, end: 75.3, ja: "記録から自治体の形式の個別避難計画、本人保管書類、災害時医療班用の要約を作成できます。", en: "From the record: the city's plan form, a sheet for the client to keep, and a summary for the disaster medical team." },
  { id: "N15", at: 75.8, end: 85.4, ja: "次は訓練。Opus が災害状況を細かくシミュレーションし Haiku が利用者一人一人になりきり行動します。", en: "Next, the drill. Opus simulates the disaster in detail, and Haiku plays each client." },
  { id: "N17", at: 85.6, end: 93.9, ja: "72 時間のシミュレーション訓練の間に停電や断水、電波不良になることがあります。", en: "During the 72-hour drill, there can be power cuts, water outages and bad signal." },
  { id: "N18", at: 99.9, end: 108, ja: "ケアマネジャーは本番と同じように電話したり、避難や電源の手配を行ったりできます。", en: "Just like the real thing, the care manager can call, and arrange evacuation or power." },
  { id: "N19", at: 108.2, end: 121.2, ja: "終わると Opus がケアマネジャーの対応を詳しく講評、今回は山田ハナさんの酸素供給装置への対応が遅れたことを出典付きで指摘しました。", en: "At the end, Opus reviews the response in detail. This time, citing sources, it pointed out the late response to Hana Yamada's oxygen device." },
  { id: "N20", at: 121.7, end: 127.6, ja: "そして実際の発災時。地震が発生し災害モードに切り替えました。", en: "Then a real disaster. An earthquake hits, and disaster mode is on." },
  { id: "N21", at: 127.8, end: 132.9, ja: "利用者またはその家族はスマホで安否確認ができます。", en: "Clients or their families can check in from their phones." },
  { id: "N22", at: 133.1, end: 140.3, ja: "本人がボタンを押さない場合は AI 音声で質問して録音と状況把握に努めます。", en: "If the client doesn't press a button, an AI voice asks, and the app records to understand the situation." },
  { id: "N24", at: 140.5, end: 147.1, ja: "Haiku が録音内容をまとめます。最終決定はケアマネジャーが行います。", en: "Haiku summarizes the recording. The care manager makes the final call." },
  { id: "N23", at: 147.3, end: 152.6, ja: "AI ではなくルールの表によって連絡順などを決定します。", en: "The order is set not by AI but by a rule table." },
  { id: "N25", at: 152.8, end: 160, ja: "ケアマネジャーと医療班の情報共有も QR コードなどを用いて簡単にできます。", en: "Sharing with the medical team is easy too, with QR codes and more." },
  { id: "N30", at: 163.7, end: 177, ja: "普及や実用化への課題はあります。それでも災害時計画を計画だけで終わらせない大きなポテンシャルを持ったアプリを開発できたと思います。", en: "There are hurdles to real-world use. Still, I believe we built an app with real potential to make disaster plans more than just plans." },
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
  R15: "本人のページ",
  R20: "worktree と merge の線",
  R21: "見直し役",
  R22: "フックが配信を止める",
  R23: "MCP の check_leaks",
  R24: "テストの件数",
};
