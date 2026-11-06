// 使う側の模擬（docs/tasks/T156.md）の型。画面の読み（Snapshot）・使う人の 1 手（Move）・1 手の記録（StepRecord）。

/** 頁の押せる物 1 つ。ref はその読みの中だけの番号（読み直すと振り直す） */
export type Item = {
  ref: number;
  /** link・button・textbox・checkbox・radio・combobox など */
  role: string;
  name: string;
  href?: string;
  /** 入力の欄の今の値（パスワードの欄は持たない） */
  value?: string;
  checked?: boolean;
  /** 今入力している欄（T166） */
  focused?: boolean;
  disabled?: boolean;
  /** 選ぶ欄の選択肢（先頭から 12 まで） */
  options?: string[];
  /** どこにある物か（画面の切替・窓・見出しの下など。短い名前） */
  zone?: string;
};

/** 頁の 1 回の読み */
export type Snapshot = {
  url: string;
  /** URL の道（/people/p-01 など。query は付ける） */
  path: string;
  title: string;
  /** h1〜h3 と role=heading（上から 20 まで） */
  headings: string[];
  items: Item[];
  /** 警告・知らせの文（role=alert・status、窓の文）と、閉じた確かめの窓の文 */
  alerts: string[];
  /** 頁の上の帯の字（事業所名・今の役。門で種の事業所かを見る） */
  header: string;
  /** 本文の見える字の頭（上限あり） */
  text: string;
  /** 本文の見える字の全部（上限 30,000 字）。達成の印と門だけが見る（AI には text だけを渡す） */
  body: string;
  /** 印刷の画面を開いた（window.print を押した）か */
  printed: boolean;
  /** 前の読みからの HTTP の失敗（4xx・5xx）と頁の例外 */
  errors: string[];
  /** 見た目の指紋（道・見出し・押せる物の名前と値から作る。同じ所を回ったかを見る） */
  hash: string;
  /** 本文と上の帯の字の指紋（押して何も変わらなかったかを見る。時刻が入るので回ったかには使わない） */
  look: string;
};

export const MOVE_ACTIONS = ["click", "type", "select", "back", "done", "give_up"] as const;
export type MoveAction = (typeof MOVE_ACTIONS)[number];

/** 使う人の次の 1 手 */
export type Move = {
  action: MoveAction;
  ref: number | null;
  /** 書く字（type）・選ぶ選択肢（select）。パスワードは {{password}} と書く */
  text: string | null;
  /** その時に思ったこと */
  thought: string;
  /** 押したあとに思う結果 */
  expect: string;
  /** 前の手の結果が思ったのと違ったか */
  surprised: boolean;
};

/** 手を打った結果 */
export type ActResult = { ok: boolean; error?: string };

/** 迷いの種類 */
export const LOST_KINDS = ["not_found", "misread", "dead_end", "back", "error", "timeout"] as const;
export type LostKind = (typeof LOST_KINDS)[number];

export const LOST_LABELS: Readonly<Record<LostKind, string>> = {
  not_found: "見つからない",
  misread: "読み違い",
  dead_end: "行き止まり",
  back: "戻り",
  error: "エラー",
  timeout: "時間切れ",
};

export type LostEvent = {
  kind: LostKind;
  /** 何手目か（1 から） */
  step: number;
  goal: string;
  path: string;
  /** 押した物の名前（あれば） */
  target: string | null;
  thought: string | null;
  /** 台が見た理由（短い） */
  note: string;
};

/** 1 手の記録 */
export type StepRecord = {
  n: number;
  goal: string;
  before: { path: string; hash: string; look: string; title: string; alerts: string[] };
  move: Move;
  /** 押した物（ref から引いた名前・役） */
  target: { name: string; role: string; zone?: string } | null;
  result: ActResult;
  after: { path: string; hash: string; look: string; title: string; alerts: string[]; errors: string[] };
  /** この手で達した目標 */
  reached: string[];
  shot: string | null;
  ms: number;
};
