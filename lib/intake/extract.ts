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
import { AI_INTAKE_FIELDS } from "./fields.ts";
import { ExtractSchema, type ExtractOutput } from "./schema.ts";
import { orderDestinations } from "./destination-order.ts";

/** 1 回の呼び出しに渡す文の長さの上限（字）。ケアプラン 1 枚の写しが入る長さ */
export const INTAKE_CHUNK_MAX = 4000;
/**
 * 入力の文の長さの上限（字。T120）。長い書き起こし（評価の 1 回目で 4,000 字を超えて断られた）は、文の切れ目で
 * INTAKE_CHUNK_MAX ごとに分けて読み（3 回まで）、分け方をまとめてから差分にする（splitIntakeText・mergeExtractOutputs）
 */
export const INTAKE_TEXT_MAX = INTAKE_CHUNK_MAX * 3;

/**
 * 欄の一覧（system に載せる）。表から作るので、欄を足せば Claude にも伝わる。
 * AI で埋めない欄（ai: false の電話。T117 の問い 5）は載せない（連絡先のフリガナ・住所・携帯は分け方の形 contacts にも無い）
 */
export function fieldGuide(): string {
  return AI_INTAKE_FIELDS.map((f) => {
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
  "3. 本人の言葉を言い換えない。どの欄にも入らない事柄のうち、避難と支援に関わる事（暮らしぶり・本人の言葉・支援の様子・回数）は notes に、入力の 1 文をそのまま写す。要約しない。文を切らない。",
  "   notes に入れるのは避難と支援に関わる事だけ。店・テレビ・天気・世間話のような、避難と支援に関わらない雑談は notes にもどの欄にも入れない。",
  "   絵文字・顔文字・「笑」「（笑）」「w」は、notes にもどの欄にも写さない（その字だけ外し、ほかの字は変えない）。",
  "   欄に入れた事（介護の状態・続柄・機器・薬など）は notes に重ねない。",
  "4. 値の形が決まっている欄は、下の一覧の値（英字）だけを使う。合う値が無ければ出さない。",
  "5. 文字の欄（避難先・保管・用量など）は入力の言葉のまま短く写す。",
  "6. 薬の区分は、名前か入力から分かるときだけ選び、分からなければ other。薬の量や飲み方を足さない、直さない。",
  "   storage（保管場所）は、その薬の保管と書かれているときだけ。どの薬か書かれていない薬全体の置き場（「薬は 2 階の箪笥」）は、薬に足さず notes に 1 文のまま写す（どの薬か推し量らない）。",
  "7. 医療依存の度合い・優先・緊急度・本人の状態の重さは決めない（出す欄も無い）。介護の状態は、書かれた事を 12 の care.* の欄に当てる（重さを決めるのではなく、書かれた事を欄に写す）。",
  "8. 伏せ字（（氏名）（町名）（電話））と役割名（民生委員・娘・支援者 1・みまもり員）はそのまま写す。「A さん」は本人のこと。",
  "9. 家族・支援者・民生委員・訪問看護などが書かれていれば contacts に。名前は書かない。夜間に来られるかが書かれていれば night を yes か no、無ければ unknown。",
  "   note は連絡先の補足（車あり・合鍵・連絡は夕方など）だけ。名前・電話・伏せ字（（氏名）（電話））・役割名（支援者 1）・種類の言葉（機器の業者・訪問看護。kind で分かる）・夜間に来られるか（night に）・移動手段（evacuation.transport に）を note に書かない。補足が無ければ空文字。",
  "   relation（続柄）は家族（family）と支援者（supporter）だけに書く。民生委員・訪問看護・病院・透析・業者などの種類の言葉は relation に書かない（kind で分かる。空文字）。役割名の「支援者 1」は名前の代わりで、続柄ではない。",
  "   relation（続柄）は、本人（A さん）から見た続柄にする。入力が家族の書いた文（メッセージなど）で、書き手から見た続柄なら、本人から見た続柄に言い直す（本人の息子が書いた「妹」は本人の娘）。誰から見た続柄か分からなければ relation は空文字にする。",
  "10. 「分からない」「答えない」と書かれた欄は unknowns に（分からないは unknown、答えない・聞けないは declined）。",
  "11. 書かれていない物は空の配列、文字の値が無い所は空文字にする。",
  "12. 介護の状態は care.* の欄に入れ、notes に流さない: 立ち上がり・移乗・歩行は care.walking、寝たきり（「ほぼ寝たきり」も true）は care.bedridden、聞こえは care.hearing、見えは care.vision、言葉の理解は care.understanding、危ないことの判断は care.judgment、人や場所の見分け（見当識）は care.orientation、要介護度は care.careLevel。",
  "   認知症と書かれていれば（「認知がある」「認知が進んだ」も認知症の意味）care.dementia を true。物忘れだけなら、理解・判断・見当識のどれかに当てられるときだけ当てる。",
  "   値は書かれた事から選ぶ（介助なしでできる ok、見守り・杖・一部の介助でできる some、できない・全介助 hard）。値を選べない書き方なら、その 1 文を notes に写す。",
  "13. 避難先の番号（evacuation.destination1・2）は書類の手がかりで決める: 「第1」「1次」「一次」「①」は 1、「第2」「2次」「二次」「②」「ほかに」「次に」「事前に行く所」は 2。番号も手がかりも無い避難先が 1 つだけなら 1。種類（病院・施設・親族の家）だけで 2 にしない。2 の手段・時間は 2 があるときだけ。",
  "",
  "欄の一覧（items の field と値）:",
  fieldGuide(),
  "",
  "薬（medications）: name 名前、category 区分、schedule 回数、amount 用量、storage 保管場所。",
  "機器（devices）: kind 種類（oxygen 在宅酸素・ventilator 人工呼吸器・suction 吸引・tube_feeding 経管栄養・dialysis 透析）、detail 中身、schedule 回数。detail に種類の名前（在宅酸素・人工呼吸器・吸引など）を重ねず、種類のほかの中身（酸素濃縮器 1L/分・気管切開）だけ。無ければ空文字。",
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
  /** 長い文を分けて読むとき、同時に呼ぶ数（無ければ全部。評価の台は 1） */
  concurrency?: number;
};

// ---------- 長い文を分けて読む（T120） ----------

/**
 * 文を max 字までの塊に分ける。段落（空の行）→ 行 → 文（。！？）の切れ目で切り、どこにも切れ目が無いときだけ字で切る。
 * 名前・電話は文の途中にあるので、文の切れ目で切れば伏せる所が 2 つの塊に分かれない
 */
export function splitIntakeText(text: string, max = INTAKE_CHUNK_MAX): string[] {
  const t = text.trim();
  if (t.length <= max) return t ? [t] : [];
  // 切れ目の後ろで分けた小さな切れ（区切りの字は前の切れに残す）
  const pieces = t.split(/(?<=\n|[。！？!?])/u);
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  for (const p of pieces) {
    if (p.length > max) {
      flush();
      for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max).trim());
      continue;
    }
    if (cur.length + p.length > max) flush();
    cur += p;
  }
  flush();
  return out.filter((x) => x !== "");
}

const keyOf = (x: unknown) => JSON.stringify(x);

/**
 * 塊ごとの分け方を 1 つに。同じ物は 1 つに、機器は種類・薬は名前・連絡先は種類と続柄でまとめ、空いた所を後の塊で埋める
 * （夜間は yes・no を unknown より先に）
 */
export function mergeExtractOutputs(outs: readonly ExtractOutput[]): ExtractOutput {
  const uniq = <T>(xs: T[], key: (x: T) => string = keyOf): T[] => {
    const seen = new Set<string>();
    return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
  };
  const fillBy = <T extends Record<string, string>>(xs: T[], key: (x: T) => string, better?: (a: T, b: T) => T): T[] => {
    const by = new Map<string, T>();
    for (const x of xs) {
      const k = key(x);
      const cur = by.get(k);
      if (!cur) {
        by.set(k, { ...x });
        continue;
      }
      const next = { ...cur } as Record<string, string>;
      for (const [f, v] of Object.entries(x)) if (!next[f] && v) next[f] = v;
      by.set(k, better ? better(next as T, x) : (next as T));
    }
    return [...by.values()];
  };
  const all = <K extends keyof ExtractOutput>(k: K) => outs.flatMap((o) => o[k] as readonly unknown[]) as unknown as ExtractOutput[K];
  return {
    items: uniq(all("items"), (i) => `${i.field}\u0000${i.value.trim()}`),
    medications: fillBy(all("medications"), (m) => m.name.normalize("NFKC").replace(/\s+/g, "")),
    devices: fillBy(all("devices"), (d) => d.kind),
    hazards: fillBy(all("hazards"), (h) => h.kind),
    contacts: fillBy(all("contacts"), (c) => `${c.kind}\u0000${c.relation.trim()}`, (a, b) => (a.night === "unknown" && b.night !== "unknown" ? { ...a, night: b.night } : a)),
    notes: uniq(all("notes").map((n) => n.trim()).filter((n) => n !== ""), (n) => n),
    unknowns: uniq(all("unknowns"), (u) => u.field),
  };
}

/** 並べて回す（同時に limit 個まで）。順は入力のまま */
async function pool<T, R>(items: readonly T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

/**
 * 自由文を台帳の欄に分け、今の台帳と並べた差分にする。INTAKE_CHUNK_MAX を超える文は文の切れ目で分けて読み（1 塊 1 回）、
 * 分け方をまとめてから差分にする（T120）。どれかの塊が失敗すれば失敗（読めた所だけで差分にしない）。
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
  // 塊ごとに仮名化の門を通す（伏せた後に元の情報が残れば、どの塊でも送らずに止まる）
  const chunks = splitIntakeText(text).map((chunk) => ({ chunk, sealed: pseudonymizeText(chunk, key) }));
  const answers = await pool(chunks, opts.concurrency ?? chunks.length, (c) => askJson(buildExtractRequest(payload, c.sealed, opts.focus ?? null), ctx));
  // 避難先の番号は書類の手がかりで（T141、lib/intake/destination-order.ts。番号の無い 1 つだけの避難先を 2 に入れない）
  const value = orderDestinations(answers.length === 1 ? answers[0].value : mergeExtractOutputs(answers.map((a) => a.value)), input.ledger, text);
  // 写した値の伏せ字は、入れた文と今の台帳の元の言葉に戻す（「（町名）小学校」→「かわなぎ小学校」。役割名は戻さない。T88）
  const restore = sourceRestorer([text, ...inputTexts(input)], key);
  // 特記は、写した文の入った塊の元の文に戻す
  const noteBack = (s: string) => {
    for (const c of chunks) {
      const back = restoreNote(s, c.chunk, c.sealed.text);
      if (back !== s) return back;
    }
    return s;
  };
  const { items, dropped } = buildDiff({ ledger: input.ledger, contacts: rows.contacts }, value, {
    text: restore,
    note: (s) => restore(noteBack(s)),
  });
  return { ai: { model: answers[0].model }, items, dropped, masked: maskedCount(text, key) };
}
