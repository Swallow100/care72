// アンケートの質問の表（docs/tasks/T65.md の表が正。docs/survey/QUESTIONS.md と README.md の記号の表は、ここの写し）。
// 答えの写し方（docs/survey/README.md）の記号は、並びの上から a・b・c…。
// 並びか言葉を変えるときは QUESTIONS.md・README.md・answers.md の見出しも直す（answers.test.ts が言葉の一致を確かめる）。
// 11/3 23:1x（T65）に 7 問から 9 問＋ご意見＋引用に作り直した。紙（paper.html）は使わない（Web 版に移した）。

export type Choice = { readonly code: string; readonly label: string };

export type ChoiceKey = "role" | "experience" | "q1" | "q2" | "q3" | "q4" | "q6" | "q7" | "q8" | "q9" | "quote";

/** 「その他（記入）」の文の名前（その他を選んだときだけ書ける。60 字まで） */
export type OtherKey = "roleOther" | "q3Other" | "q4Other" | "q6Other";

/** 記入欄の問い（400 字まで） */
export type FreeKey = "q5" | "q9reason" | "comment";

/** 文で答える欄の全部（記入欄の問い＋その他の記入） */
export type TextKey = FreeKey | OtherKey;

/** 記入欄 1 つの上限（字） */
export const FREE_MAX = 400;
/** その他の記入の上限（字） */
export const OTHER_MAX = 60;

export type OtherSpec = {
  readonly key: OtherKey;
  /** この記号を選んだときだけ書ける */
  readonly code: string;
  /** answers.md の表の列の名前 */
  readonly column: string;
};

export type ChoiceQuestion = {
  readonly key: ChoiceKey;
  /** answers.md の表の列の名前 */
  readonly column: string;
  /** 集計の見出し（summary.md） */
  readonly heading: string;
  /** 答えの頁と QUESTIONS.md に出す問いの文（属性は「役」「経験年数」だけ） */
  readonly text: string;
  /** いくつでも選べる問い（問 4・問 6） */
  readonly multi: boolean;
  readonly choices: ReadonlyArray<Choice>;
  readonly other?: OtherSpec;
  /** 選択肢の下の 1 行（問 4 の支援者の説明） */
  readonly note?: string;
};

const c = (code: string, label: string): Choice => ({ code, label });

export const CHOICE_QUESTIONS: ReadonlyArray<ChoiceQuestion> = [
  {
    key: "role",
    column: "役",
    heading: "役",
    text: "役",
    multi: false,
    choices: [c("a", "ケアマネ"), c("b", "保健師・看護師"), c("c", "社会福祉士"), c("d", "その他")],
    other: { key: "roleOther", code: "d", column: "役その他" },
  },
  {
    key: "experience",
    column: "経験",
    heading: "経験年数",
    text: "経験年数",
    multi: false,
    choices: [c("a", "5年未満"), c("b", "5〜10年"), c("c", "10年以上")],
  },
  {
    key: "q1",
    column: "問1",
    heading: "問 1　個別避難計画ができている利用者の割合",
    text: "問1　担当の利用者のうち、個別避難計画ができている人はどれくらいですか",
    multi: false,
    choices: [c("a", "いない"), c("b", "1割未満"), c("c", "1〜2割"), c("d", "3〜5割"), c("e", "6割以上"), c("f", "担当していない")],
  },
  {
    key: "q2",
    column: "問2",
    heading: "問 2　計画 1 件にかかる時間（聞き取りから書き終えるまで）",
    text: "問2　計画1件を作るのに、聞き取りから書き終えるまでどれくらいかかりますか",
    multi: false,
    choices: [
      c("a", "15分以内"),
      c("b", "15〜30分"),
      c("c", "30分〜1時間"),
      c("d", "1〜2時間"),
      c("e", "2〜4時間"),
      c("f", "半日より長い"),
      c("g", "作ったことがない"),
    ],
  },
  {
    key: "q3",
    column: "問3",
    heading: "問 3　個別避難計画づくりをどう感じているか",
    text: "問3　正直なところ、個別避難計画づくりをどう感じていますか",
    multi: false,
    choices: [
      c("a", "必要だと思うし、できている"),
      c("b", "必要だと思うが、面倒で後回しになる"),
      c("c", "正直、形だけになっている"),
      c("d", "あまり必要だと感じない"),
      c("e", "その他"),
    ],
    other: { key: "q3Other", code: "e", column: "問3その他" },
  },
  {
    key: "q4",
    column: "問4",
    heading: "問 4　計画づくりでいやな所・面倒な所（いくつでも）",
    text: "問4　計画を作るとき、いやな所・面倒な所はどこですか",
    multi: true,
    choices: [
      c("a", "様式が分かりにくい"),
      c("b", "書く時間が無い"),
      c("c", "本人や家族に聞きにくい"),
      c("d", "支援者が決まらない"),
      c("e", "市町村とのやり取り"),
      c("f", "作っても使われない"),
      c("g", "その他"),
    ],
    other: { key: "q4Other", code: "g", column: "問4その他" },
    note: "支援者＝避難のとき、迎えに来てくれる人",
  },
  {
    key: "q6",
    column: "問6",
    heading: "問 6　作った計画のその後の使われ方（いくつでも）",
    text: "問6　作った計画は、その後どう使われていますか",
    multi: true,
    choices: [
      c("a", "市町村に出して終わり"),
      c("b", "本人・家族の手元にある"),
      c("c", "事業所で見返している"),
      c("d", "訓練や見直しに使っている"),
      c("e", "使われていない・分からない"),
      c("f", "作ったことがない"),
      c("g", "その他"),
    ],
    other: { key: "q6Other", code: "g", column: "問6その他" },
  },
  {
    key: "q7",
    column: "問7",
    heading: "問 7　避難所の医師・看護師へ、利用者の薬と医療機器をすぐ伝えられるか",
    text: "問7　災害のとき、避難所などの医師や看護師に、担当の利用者の飲んでいる薬や使っている医療機器（酸素・人工呼吸器など）を、すぐ伝えられますか",
    multi: false,
    choices: [c("a", "伝えられる"), c("b", "一部は伝えられる"), c("c", "伝えられない")],
  },
  {
    key: "q8",
    column: "問8",
    heading: "問 8　発災直後、どの方から順に連絡するかが決まっているか",
    text: "問8　災害が起きた直後、担当の利用者のうち、どの方から順に連絡するか（安否の確認の順番）は決まっていますか",
    multi: false,
    choices: [c("a", "決まっている"), c("b", "だいたい決まっている"), c("c", "決まっていない")],
  },
  {
    key: "q9",
    column: "問9",
    heading: "問 9　AI が様式の下書きを作り、直すのは自分、なら計画を作る気になるか",
    text: "問9　利用者のことを、話す・箇条書きで打つ・手元の書類（アセスメントなど）を写真やファイルで読み込ませる、のどれかをするだけで、AI が様式の下書きを作り、直すのは自分、としたら、個別避難計画を作る気になりますか",
    multi: false,
    choices: [c("a", "なる"), c("b", "少しなる"), c("c", "ならない")],
  },
  {
    key: "quote",
    column: "引用",
    heading: "引用してよいか",
    text: "書いていただいた文を、名前を伏せて、作品の説明や動画で引用してもよいですか",
    multi: false,
    choices: [c("a", "よい"), c("b", "よくない（よくない場合、記入欄の文は使いません）")],
  },
];

export function choiceQuestion(key: ChoiceKey): ChoiceQuestion {
  const q = CHOICE_QUESTIONS.find((x) => x.key === key);
  if (!q) throw new Error(`問いの表に無い: ${key}`);
  return q;
}

export type FreeQuestion = {
  readonly key: FreeKey;
  readonly column: string;
  /** 集計の見出し */
  readonly heading: string;
  /** 答えの頁と QUESTIONS.md に出す文 */
  readonly text: string;
  /** AI に渡す問いの言い方。null は AI で分けない（ご意見は型に分けにくいので、summary.md に原文を並べるだけ） */
  readonly ask: string | null;
};

export const FREE_QUESTIONS: ReadonlyArray<FreeQuestion> = [
  {
    key: "q5",
    column: "問5",
    heading: "問 5　いちばん面倒な所",
    text: "問5　いちばん面倒な所を、ひとことで教えてください",
    ask: "個別避難計画を作るとき、いちばん面倒な所をひとことで書いてください。",
  },
  {
    key: "q9reason",
    column: "問9理由",
    heading: "問 9　作る気になるか・ならないかの理由",
    text: "理由",
    ask: "利用者のことを話す・打つ・書類を読み込ませるだけで AI が様式の下書きを作り、直すのは自分、としたら、計画を作る気になりますか。その理由をひとこと。",
  },
  {
    key: "comment",
    column: "ご意見",
    heading: "ご意見",
    text: "ご意見",
    ask: null,
  },
];

/** その他の記入の欄（選択の問いの other から） */
export const OTHER_FIELDS: ReadonlyArray<OtherSpec & { readonly of: ChoiceKey }> = CHOICE_QUESTIONS.flatMap((q) =>
  q.other ? [{ ...q.other, of: q.key }] : [],
);

/** 文で答える欄の全部（列の名前と上限の字数） */
export const TEXT_FIELDS: ReadonlyArray<{ readonly key: TextKey; readonly column: string; readonly max: number }> = [
  ...FREE_QUESTIONS.map((q) => ({ key: q.key, column: q.column, max: FREE_MAX })),
  ...OTHER_FIELDS.map((o) => ({ key: o.key, column: o.column, max: OTHER_MAX })),
];

/** answers.md の表の列（並び。名前が全部そろっていれば、読むときの並びは問わない） */
export const COLUMNS: ReadonlyArray<string> = [
  "番号",
  "役",
  "役その他",
  "経験",
  "問1",
  "問2",
  "問3",
  "問3その他",
  "問4",
  "問4その他",
  "問5",
  "問6",
  "問6その他",
  "問7",
  "問8",
  "問9",
  "問9理由",
  "ご意見",
  "引用",
];

/** 自由記述を分ける型（問 4 の選択肢と同じ 7 つ） */
export const CATEGORIES = ["時間", "様式", "聞き取り", "支援者", "市町村", "使われない", "その他"] as const;
export type Category = (typeof CATEGORIES)[number];

/** 動画・README で 1 文にしやすい合算（問・記号・言い方） */
export type Combined = {
  readonly key: ChoiceKey;
  readonly codes: ReadonlyArray<string>;
  readonly label: string;
  /** この記号を選んだ人は母数に入れない（例: 計画を作ったことがない人） */
  readonly except?: ReadonlyArray<string>;
};
export const COMBINED: ReadonlyArray<Combined> = [
  { key: "q1", codes: ["a", "b", "c"], label: "計画ができている利用者が 2 割以下（担当している人のうち）", except: ["f"] },
  { key: "q2", codes: ["d", "e", "f"], label: "計画 1 件に 1 時間より長くかかる（作ったことがある人のうち）", except: ["g"] },
  { key: "q3", codes: ["b", "c"], label: "必要だと思うが後回し・形だけになっている" },
  { key: "q9", codes: ["a", "b"], label: "話す・打つ・読み込ませるだけで下書きができるなら作る気になる（なる・少しなる）" },
];

/** これ未満の回答数は動画・README に使わない（docs/tasks/T34.md「3 件以上」） */
export const MIN_ANSWERS = 3;

/** AI（summarize.ts）で 7 つの型に分ける記入欄（問 5・問 9 の理由） */
export type AiQuestion = FreeQuestion & { readonly ask: string };
export const AI_QUESTIONS: ReadonlyArray<AiQuestion> = FREE_QUESTIONS.filter((q): q is AiQuestion => q.ask !== null);
