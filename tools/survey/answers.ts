// docs/survey/answers.md（紙の答えを写した表）を読み、選択の問いを数え、自由記述に個人の情報が混ざっていないかを調べる。
// ここは機械の仕事だけ（Claude を呼ばない）。呼ぶのは summarize.ts。表の形は docs/survey/README.md。

import {
  CHOICE_QUESTIONS,
  COLUMNS,
  FREE_QUESTIONS,
  choiceQuestion,
  type ChoiceKey,
  type Combined,
  type FreeKey,
} from "./questions.ts";

export type Respondent = {
  /** 紙に振った通し番号（名前ではない） */
  id: string;
  /** 選んだ記号。答えなしは空、問 3 だけ複数 */
  choices: Record<ChoiceKey, string[]>;
  /** 自由記述の文。答えなしは null */
  free: Record<FreeKey, string | null>;
};

export class AnswersError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`answers.md を読めない（${problems.length} 件）:\n- ${problems.join("\n- ")}`);
    this.name = "AnswersError";
    this.problems = problems;
  }
}

/** 区切り・空白・全角を取り除いた記号の列 */
function normalizeCodes(cell: string): string {
  return cell
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s,、，・/／;；]/g, "");
}

const BLANKS = new Set(["", "-", "－", "ー", "なし", "無"]);

function splitRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * answers.md の最初の表を読む。1 行が 1 人。列の名前は questions.ts の COLUMNS（並びは問わない）。
 * 読めない所は全部まとめて AnswersError にする（直してからもう一度流す）。
 */
export function parseAnswers(markdown: string): Respondent[] {
  const problems: string[] = [];
  const lines = markdown.split(/\r?\n/);
  let header: string[] | null = null;
  const respondents: Respondent[] = [];
  const seen = new Set<string>();

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line.startsWith("|")) return;
    const cells = splitRow(line);
    if (isSeparator(cells)) return;
    const at = `${index + 1} 行目`;

    if (!header) {
      const dup = cells.filter((c, i) => cells.indexOf(c) !== i);
      const missing = COLUMNS.filter((c) => !cells.includes(c));
      const unknown = cells.filter((c) => !COLUMNS.includes(c));
      if (dup.length) problems.push(`${at}: 列の名前が重なっている（${[...new Set(dup)].join("・")}）`);
      if (missing.length) problems.push(`${at}: 列が足りない（${missing.join("・")}）`);
      if (unknown.length) problems.push(`${at}: 知らない列がある（${unknown.join("・")}）`);
      header = cells;
      return;
    }

    if (cells.length !== header.length) {
      problems.push(`${at}: 列の数が合わない（表の見出しは ${header.length}、この行は ${cells.length}）。記入欄の文に「|」を入れていないか`);
      return;
    }
    const cell = (name: string): string => cells[header!.indexOf(name)] ?? "";

    const id = cell("番号");
    if (!id) {
      problems.push(`${at}: 番号が空`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${at}: 番号 ${id} が重なっている`);
      return;
    }
    seen.add(id);

    const choices = {} as Record<ChoiceKey, string[]>;
    for (const q of CHOICE_QUESTIONS) {
      const raw = cell(q.column);
      const norm = normalizeCodes(raw);
      if (BLANKS.has(norm)) {
        choices[q.key] = [];
        continue;
      }
      const codes = [...new Set(norm.split(""))];
      const allowed = q.choices.map((x) => x.code);
      const bad = codes.filter((x) => !allowed.includes(x));
      if (bad.length) {
        problems.push(`${at}（番号 ${id}）: ${q.column} の記号が合わない（使える記号は ${allowed.join("・")}）`);
        choices[q.key] = [];
        continue;
      }
      if (!q.multi && codes.length > 1) {
        problems.push(`${at}（番号 ${id}）: ${q.column} は 1 つだけ（${codes.length} 個ある）`);
        choices[q.key] = [];
        continue;
      }
      choices[q.key] = codes;
    }

    const free = {} as Record<FreeKey, string | null>;
    for (const q of FREE_QUESTIONS) {
      const text = cell(q.column);
      free[q.key] = BLANKS.has(text) ? null : text;
    }
    respondents.push({ id, choices, free });
  });

  if (!header) problems.push("表が見つからない（| で始まる見出しの行がある）");
  if (problems.length) throw new AnswersError(problems);
  return respondents;
}

// ---------- 選択の問いの集計 ----------

export type TallyRow = { code: string; label: string; n: number };
export type Tally = {
  key: ChoiceKey;
  /** その問いに答えた人（問 3 は 1 つ以上選んだ人） */
  answered: number;
  /** 答えなしの人 */
  blank: number;
  rows: TallyRow[];
};

export function tallyChoice(respondents: ReadonlyArray<Respondent>, key: ChoiceKey): Tally {
  const q = choiceQuestion(key);
  const answeredBy = respondents.filter((r) => r.choices[key].length > 0);
  return {
    key,
    answered: answeredBy.length,
    blank: respondents.length - answeredBy.length,
    rows: q.choices.map((choice) => ({
      code: choice.code,
      label: choice.label,
      n: answeredBy.filter((r) => r.choices[key].includes(choice.code)).length,
    })),
  };
}

/** 合算（例: 問 2 で「1 時間〜半日」か「半日より長い」を選んだ人）。母数は答えた人（except の記号を選んだ人は除く） */
export function combinedCount(
  respondents: ReadonlyArray<Respondent>,
  combined: Combined,
): { answered: number; n: number } {
  const answeredBy = respondents.filter(
    (r) =>
      r.choices[combined.key].length > 0 && !r.choices[combined.key].some((code) => combined.except?.includes(code)),
  );
  return {
    answered: answeredBy.length,
    n: answeredBy.filter((r) => r.choices[combined.key].some((code) => combined.codes.includes(code))).length,
  };
}

/** 「N 人中 M 人」 */
export function ratio(m: number, n: number): string {
  return `${n} 人中 ${m} 人`;
}

// ---------- 個人の情報が混ざっていないかの見張り ----------

const DASH = "-‐‑–—−ー";
const PHONE = new RegExp(`(?<![0-9])0[0-9]{1,4}[${DASH}\\s]?[0-9]{1,4}[${DASH}\\s]?[0-9]{3,4}(?![0-9])`);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const URL_LIKE = /https?:\/\/|www\./i;
/** 人名らしい「〇〇さん・様・氏・先生」。様式・氏名の「様」「氏」は除く */
const HONORIFIC = /([一-龥々ァ-ヴー]{1,8})(?:さん|様(?!式)|氏(?!名)|先生|ちゃん)/g;
/** 敬称の前が役割名・一般の言葉なら人名ではない */
const GENERIC_STEMS = [
  "皆",
  "本人",
  "利用者",
  "家族",
  "患者",
  "職員",
  "担当",
  "相手",
  "先方",
  "関係者",
  "ケアマネ",
  "医師",
  "看護師",
  "主治医",
  "ヘルパー",
  "管理者",
  "上司",
  "同僚",
  "行政",
  "役所",
  "民生委員",
];

/**
 * 自由記述に、名前・電話・メール・リンクの疑いがあるか。見つけた種類だけを返す（疑った文字そのものは返さない）。
 * 読み落としはあるので、写すときの作者の確かめの代わりにはならない。
 */
export function findRisks(text: string): string[] {
  const t = text.normalize("NFKC");
  const found: string[] = [];
  if (PHONE.test(t)) found.push("電話番号らしい並び");
  if (EMAIL.test(t)) found.push("メールアドレスらしい並び");
  if (URL_LIKE.test(t)) found.push("リンク");
  for (const m of t.matchAll(HONORIFIC)) {
    if (!GENERIC_STEMS.some((g) => m[1].endsWith(g))) {
      found.push("人名らしい「〇〇さん・様」");
      break;
    }
  }
  return found;
}

// ---------- 自由記述 ----------

export type FreeItem = {
  /** 例 問4-003。AI に渡すキーにもなる */
  ref: string;
  respondent: string;
  key: FreeKey;
  text: string;
};

export type HeldItem = { ref: string; reasons: string[] };

export const refOf = (key: FreeKey, respondentId: string): string => `${key === "q4" ? "問4" : "問7理由"}-${respondentId}`;

/**
 * 自由記述を、AI に渡してよい物と、手で確かめる物に分ける。
 * - 引用が「よい」でない人の記入欄は、写さない決まり（紙で「よくない」なら使わない）。写してあれば止める。
 * - 名前・電話などの疑いがある物は止める。直して（answers.md）もう一度流す。
 */
export function collectFreeItems(respondents: ReadonlyArray<Respondent>): { items: FreeItem[]; held: HeldItem[] } {
  const items: FreeItem[] = [];
  const held: HeldItem[] = [];
  for (const r of respondents) {
    const quoteOk = r.choices.quote.includes("a");
    for (const q of FREE_QUESTIONS) {
      const text = r.free[q.key];
      if (text === null) continue;
      const ref = refOf(q.key, r.id);
      const reasons: string[] = [];
      if (!quoteOk) reasons.push("引用が「よい」でないのに記入欄の文が写されている（写さない決まり）");
      reasons.push(...findRisks(text));
      if (reasons.length > 0) held.push({ ref, reasons });
      else items.push({ ref, respondent: r.id, key: q.key, text });
    }
  }
  return { items, held };
}
