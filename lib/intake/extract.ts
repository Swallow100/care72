// 入れる欄の分け方（T03）。ケアマネが話した・貼った文（ケアプランの写しのこともある）を、Claude（Sonnet）が台帳の欄に分ける。
// 1 要求 1 回の呼び出し（lib/claude/call.ts の askJson、用途 ledger_input）。サーバーだけで使う。
//
// - Claude に渡すのは lib/pseudonym を通した物だけ: 今の台帳（A さん・役割名）と、名前・町名・電話を伏せた文
// - 返った分け方は lib/intake/diff.ts で今の台帳と並べた差分にする。決めるのはケアマネ（画面で外す・直す・選ぶ）
// - 医療依存の印・優先・緊急度は Claude に決めさせない（出す欄が無い。保存のあとに lib/intake/marks.ts が機械的に付ける）

import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import type { PersonPageRows } from "../person.ts";
import { parseLedger } from "../db/ledger.ts";
import {
  inputTexts,
  maskedCount,
  pseudonymize,
  pseudonymizeText,
  sourceRestorer,
  type ClaudePerson,
  type ForClaude,
  type PseudonymInput,
} from "../pseudonym/index.ts";
import { buildDiff, restoreNote, type DiffItem } from "./diff.ts";
import { INTAKE_FIELDS } from "./fields.ts";
import { ExtractSchema } from "./schema.ts";

/** 入力の文の長さの上限（字）。ケアプラン 1 枚の写しが入る長さ。長い処理を 1 要求で回さない */
export const INTAKE_TEXT_MAX = 4000;

/** 欄の一覧（system に載せる）。表から作るので、欄を足せば Claude にも伝わる */
export function fieldGuide(): string {
  return INTAKE_FIELDS.map((f) => {
    const values =
      f.shape.type === "enum" || f.shape.type === "enumList"
        ? ` 値: ${f.shape.options.map((o) => `${o.value}（${o.label}）`).join("・")}`
        : f.shape.type === "bool"
          ? " 値: true・false"
          : f.shape.type === "int"
            ? " 値: 整数の数字"
            : f.shape.type === "list"
              ? " 値: 1 つずつ別の行"
              : "";
    const many = f.shape.type === "enumList" ? "（1 つずつ別の行）" : "";
    return `- ${f.key}: ${f.label}${f.hint ? `（${f.hint}）` : ""}${values}${many}`;
  }).join("\n");
}

/** 分け方の決まりと欄の一覧（文の分け方と、写真・PDF の読み取り lib/intake/read.ts で同じ物） */
export const EXTRACT_RULES = [
  "決まり:",
  "1. 入力の文に書かれていることだけを出す。推し量らない。書かれていない欄は出さない。",
  "2. 今の台帳の値は変えない前提で、入力に書かれた欄は、今の値と同じでも違っても書かれたとおりに出す（並べて見せ、変えるかは人が決める）。",
  "3. 本人の言葉を言い換えない。どの欄にも入らない事柄（暮らしぶり・本人の言葉・支援の様子・回数）は notes に、入力の 1 文をそのまま写す。要約しない。文を切らない。",
  "4. 値の形が決まっている欄は、下の一覧の値（英字）だけを使う。合う値が無ければ出さない。",
  "5. 文字の欄（避難先・保管・用量など）は入力の言葉のまま短く写す。",
  "6. 薬の区分は、名前か入力から分かるときだけ選び、分からなければ other。薬の量や飲み方を足さない、直さない。",
  "7. 医療依存の度合い・優先・緊急度・本人の状態は決めない（出す欄も無い）。",
  "8. 伏せ字（（氏名）（町名）（電話））と役割名（民生委員・娘・支援者 1・みまもり員）はそのまま写す。「A さん」は本人のこと。",
  "9. 家族・支援者・民生委員・訪問看護などが書かれていれば contacts に。名前は書かない。夜間に来られるかが書かれていれば night を yes か no、無ければ unknown。",
  "10. 「分からない」「答えない」と書かれた欄は unknowns に（分からないは unknown、答えない・聞けないは declined）。",
  "11. 書かれていない物は空の配列、文字の値が無い所は空文字にする。",
  "",
  "欄の一覧（items の field と値）:",
  fieldGuide(),
  "",
  "薬（medications）: name 名前、category 区分、schedule 回数、amount 用量、storage 保管場所。",
  "機器（devices）: kind 種類（oxygen 在宅酸素・ventilator 人工呼吸器・suction 吸引・tube_feeding 経管栄養・dialysis 透析）、detail 中身、schedule 回数。",
  "ハザード（hazards）: kind 種類（flood 浸水・landslide 土砂・tsunami 津波）、depth_m 浸水の深さ（m の数字。無ければ空文字）。",
].join("\n");

export const EXTRACT_SYSTEM = [
  "ケアマネが本人について話した・貼った文を、個別避難計画の台帳の欄に分ける。",
  "入力は JSON。「本人」は今の台帳（仮名化済み）、「入力」はケアマネの文（ケアプランの写しのこともある）。",
  "",
  EXTRACT_RULES,
].join("\n");

/** Claude に渡す要求。入力は仮名化の層を通った物だけ（型で止まる） */
export function buildExtractRequest(
  person: ForClaude<ClaudePerson[]>,
  text: ForClaude<{ text: string }>,
  focus: string | null,
): AskJsonRequest<typeof ExtractSchema> {
  return {
    purpose: "ledger_input",
    system: focus ? `${EXTRACT_SYSTEM}\n\n今の問い: ${focus}。入力はこの問いへの答えのことがある。` : EXTRACT_SYSTEM,
    input: { 本人: person, 入力: text },
    schema: ExtractSchema,
  };
}

/** 本人のページの行から、仮名化の層に入れる形 */
export function pseudonymInputOf(rows: PersonPageRows): PseudonymInput {
  return {
    person: rows.person,
    ledger: parseLedger(rows.person.ledger),
    contacts: [...rows.contacts],
    clocks: [...rows.clocks],
    consents: rows.consents.map((c) => ({ kind: c.kind, status: c.status })),
  };
}

export type IntakeProposal = {
  /** 「AI」の印（答えたモデル） */
  ai: { model: string };
  items: DiffItem[];
  /** 欄の形に合わずに捨てた数 */
  dropped: number;
  /**
   * 送った文のうち伏せた所の数（台帳の名前・町名・電話と、敬称つきの名前・住所・郵便番号・メールの形。T74）。
   * 画面は「伏せ字 N」とだけ出す（何を伏せたかは返さない）。文を送らない写真・PDF の読み取りには無い
   */
  masked?: number;
};

export type ExtractOptions = {
  /** 年齢を数える日（JST、YYYY-MM-DD） */
  today: string;
  /** 今の問い（コードの定数の言葉。台帳の値・名前を入れない） */
  focus?: string | null;
};

/**
 * 自由文を台帳の欄に分け、今の台帳と並べた差分にする。
 * 失敗: AiNotConfigured・AiLimitReached・AiCallFailed・AiRefused・AiBadOutput（lib/claude/errors.ts）、
 * PseudonymLeakError（伏せたあとに元の情報が残った。送らない）
 */
export async function extractIntake(
  rows: PersonPageRows,
  text: string,
  ctx: AskJsonContext,
  opts: ExtractOptions,
): Promise<IntakeProposal> {
  const input = pseudonymInputOf(rows);
  const { payload, key } = pseudonymize([input], { on: opts.today });
  const sealed = pseudonymizeText(text, key);
  const r = await askJson(buildExtractRequest(payload, sealed, opts.focus ?? null), ctx);
  // 写した値の伏せ字は、入れた文と今の台帳の元の言葉に戻す（「（町名）小学校」→「かわなぎ小学校」。役割名は戻さない。T88）
  const restore = sourceRestorer([text, ...inputTexts(input)], key);
  const { items, dropped } = buildDiff({ ledger: input.ledger, contacts: rows.contacts }, r.value, {
    text: restore,
    note: (s) => restore(restoreNote(s, text, sealed.text)),
  });
  return { ai: { model: r.model }, items, dropped, masked: maskedCount(text, key) };
}
