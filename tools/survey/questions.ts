// アンケートの質問の表（docs/survey/QUESTIONS.md と paper.html の選択肢と同じ並び）。
// 答えの写し方（docs/survey/README.md）の記号は、紙の並びの上から・左から a・b・c…。
// 並びか言葉を変えるときは QUESTIONS.md・paper.html・README.md も直す（answers.test.ts が言葉の一致を確かめる）。

export type Choice = { readonly code: string; readonly label: string };

export type ChoiceKey = "role" | "experience" | "q1" | "q2" | "q3" | "q5" | "q6" | "q7" | "quote";

export type ChoiceQuestion = {
  readonly key: ChoiceKey;
  /** answers.md の表の列の名前 */
  readonly column: string;
  /** 集計の見出し */
  readonly heading: string;
  /** いくつでも選べる問い（問 3 だけ） */
  readonly multi: boolean;
  readonly choices: ReadonlyArray<Choice>;
};

const c = (code: string, label: string): Choice => ({ code, label });

export const CHOICE_QUESTIONS: ReadonlyArray<ChoiceQuestion> = [
  { key: "role", column: "役", heading: "役", multi: false, choices: [c("a", "ケアマネ"), c("b", "その他の職員")] },
  {
    key: "experience",
    column: "経験",
    heading: "経験年数",
    multi: false,
    choices: [c("a", "5 年未満"), c("b", "5〜10 年"), c("c", "10 年以上")],
  },
  {
    key: "q1",
    column: "問1",
    heading: "問 1　個別避難計画ができている利用者の割合",
    multi: false,
    choices: [c("a", "できている人はいない"), c("b", "1〜3 割"), c("c", "4〜6 割"), c("d", "7 割以上")],
  },
  {
    key: "q2",
    column: "問2",
    heading: "問 2　計画 1 件にかかる時間（聞き取りから書き終えるまで）",
    multi: false,
    choices: [
      c("a", "30 分以内"),
      c("b", "30 分〜1 時間"),
      c("c", "1 時間〜半日"),
      c("d", "半日より長い"),
      c("e", "作ったことがない"),
    ],
  },
  {
    key: "q3",
    column: "問3",
    heading: "問 3　計画づくりでいやな所・面倒な所（いくつでも）",
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
  },
  {
    key: "q5",
    column: "問5",
    heading: "問 5　避難所の医療者へ、利用者の薬と医療機器の情報をすぐ渡せるか",
    multi: false,
    choices: [c("a", "渡せる"), c("b", "一部は渡せる"), c("c", "渡せない")],
  },
  {
    key: "q6",
    column: "問6",
    heading: "問 6　発災直後、誰に最初に電話するかが決まっているか",
    multi: false,
    choices: [c("a", "決まっている"), c("b", "だいたい決まっている"), c("c", "決まっていない")],
  },
  {
    key: "q7",
    column: "問7",
    heading: "問 7　話すだけで AI が様式の下書きを作るなら、計画を作る気になるか",
    multi: false,
    choices: [c("a", "なる"), c("b", "少しなる"), c("c", "ならない")],
  },
  {
    key: "quote",
    column: "引用",
    heading: "引用してよいか",
    multi: false,
    choices: [c("a", "よい"), c("b", "よくない")],
  },
];

export function choiceQuestion(key: ChoiceKey): ChoiceQuestion {
  const q = CHOICE_QUESTIONS.find((x) => x.key === key);
  if (!q) throw new Error(`問いの表に無い: ${key}`);
  return q;
}

export type FreeKey = "q4" | "q7reason";

export type FreeQuestion = {
  readonly key: FreeKey;
  readonly column: string;
  readonly heading: string;
  /** AI に渡す問いの言い方 */
  readonly ask: string;
};

export const FREE_QUESTIONS: ReadonlyArray<FreeQuestion> = [
  {
    key: "q4",
    column: "問4",
    heading: "問 4　いちばん面倒な所",
    ask: "個別避難計画を作るとき、いちばん面倒な所をひとことで書いてください。",
  },
  {
    key: "q7reason",
    column: "問7理由",
    heading: "問 7　作る気になるか・ならないかの理由",
    ask: "利用者のことを話すだけで AI が様式の下書きを作り、直すのは自分、としたら、計画を作る気になりますか。その理由をひとこと。",
  },
];

/** answers.md の表の列（紙の並び。名前が全部そろっていれば、並びは問わない） */
export const COLUMNS: ReadonlyArray<string> = [
  "番号",
  "役",
  "経験",
  "問1",
  "問2",
  "問3",
  "問4",
  "問5",
  "問6",
  "問7",
  "問7理由",
  "引用",
];

/** 自由記述を分ける型（問 3 の選択肢と同じ 7 つ） */
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
  { key: "q1", codes: ["a", "b"], label: "計画ができている利用者が 3 割以下" },
  { key: "q2", codes: ["c", "d"], label: "計画 1 件に 1 時間より長くかかる（作ったことがある人のうち）", except: ["e"] },
  { key: "q7", codes: ["a", "b"], label: "話すだけで下書きができるなら作る気になる（なる・少しなる）" },
];

/** これ未満の回答数は動画・README に使わない（docs/tasks/T34.md「3 件以上」） */
export const MIN_ANSWERS = 3;
