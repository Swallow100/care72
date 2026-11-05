// 選ぶ欄の選択肢のうち、言い換えの表（lib/forms/option-values.ts）で台帳の値に当たらない物を、様式の読み取りの時に AI に当てさせる（T140）。
//
// - 渡すのは様式に刷ってある字（欄の名前・選択肢）と、台帳の項目の値の名前（列挙。「問題なし」「一部」「困難」）だけ。人の値は渡さない。
//   仮名化の門（askJson と sealItemCatalog。電話番号らしい並びがあれば止める）を通す
// - 答えは決まった形（欄の id・選択肢の番号・値のコードの並び）に縛り、項目の値に無いコード・知らない欄・範囲外の番号は捨てる
// - 当たる値が無い選択肢は空の並び（どの値にも当てない）。決められない選択肢は null（人が紙の上で選ぶ）
// - 当てた物は対応表の欄の optionValues に AI の印（ai の番号）つきで残す。確かめの画面で人が直せる。共有の対応表にもこのまま入る
// - 呼ぶのは 1 つの様式に 1 回（当たらない選択肢のある欄をまとめて）。用途は form_read（書類の AI として数える。T136 の照合と同じ形）、
//   呼び方は lib/claude/models.ts の FORM_OPTIONS（Sonnet・low。字の言い換えだけで考えることが少ない）。失敗しても読み取りは止めない
// 色と連絡順（lib/triage）には関わらない。医療の判断はしない（選択肢の字と値の名前の対応だけ）。

import * as z from "zod";
import { askJson, type AskJsonContext } from "../claude/call.ts";
import { FORM_OPTIONS } from "../claude/models.ts";
import { sealItemCatalog } from "../pseudonym/index.ts";
import { clean, LIMITS, ledgerItem, type MappingField } from "./mapping.ts";
import { codeOfOption, codesOf, ITEM_CODES, NONE_CODE, OTHER_CODE, unmatchedOptions } from "./option-values.ts";

export const OPTION_AI_SYSTEM = [
  "入力の fields は、日本の市町村の個別避難計画などの様式の「選ぶ欄」（□ の並び）。欄ごとに、様式に刷ってある欄の名前（欄）、台帳の項目の名前（項目）、",
  "まだ台帳の値に当てていない選択肢（選択肢。番号つき）、台帳のその項目の値の一覧（値。code と名前）がある。値は人の値でなく、項目が取りうる値の種類の一覧。",
  "1. 選択肢ごとに、その □ に印を付けるべき台帳の値の code を values から選んで並べる。1 つの選択肢に当たる値が 2 つ以上なら全部。",
  "2. どの値の人にも当たらない選択肢（様式だけの区分・台帳に無い事実を問う選択肢）は空の並び []。",
  "3. 値の一覧から決められない（どちらとも取れる・台帳の値だけでは分からない）選択肢は null（ケアマネが確かめて選ぶ）。推し量って当てない。",
  "4. 「その他」の選択肢は code の \"*other\"、「なし」は \"*none\"。値の一覧に無い code を作らない。",
  "5. 本人の状態を決めつけない。医療の判断・助言をしない。字の言い換えとして当てるだけ。",
].join("\n");

const AnswerSchema = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      options: z.array(z.object({ no: z.number(), codes: z.array(z.string()).nullable() })),
    }),
  ),
});

/** AI に当てさせる欄の一覧（当たらない選択肢のある選ぶ欄。外した欄は除く） */
export function optionTargets(fields: readonly MappingField[]): Array<{ field: MappingField; open: number[] }> {
  return fields.flatMap((f) => {
    if (f.removed) return [];
    const open = unmatchedOptions(f);
    return open.length > 0 ? [{ field: f, open }] : [];
  });
}

/** AI に渡す形（様式の字と値の名前だけ） */
export function optionRequestInput(targets: ReadonlyArray<{ field: MappingField; open: number[] }>) {
  return {
    fields: targets.map(({ field, open }) => ({
      id: field.id,
      欄: clean(field.section ? `${field.section} ${field.label}` : field.label, LIMITS.label),
      項目: ledgerItem(field.item!).label,
      選択肢: open.map((i) => ({ no: i, 字: clean(field.options[i], LIMITS.option) })),
      値: [...(ITEM_CODES[field.item!] ?? []).map((c) => ({ code: c.code, 名前: c.label })), { code: NONE_CODE, 名前: "なし" }, { code: OTHER_CODE, 名前: "その他" }],
    })),
  };
}

/**
 * 当たらない選択肢を AI に当てさせ、欄の optionValues に入れた欄の並びを返す（当てない欄はそのまま）。
 * 当てる欄が無ければ呼ばない。呼び出しの失敗は投げる（呼ぶ側が受けて、言い換えの表だけで続ける）
 */
export async function assignOptionValues(fields: readonly MappingField[], ctx: AskJsonContext): Promise<MappingField[]> {
  const targets = optionTargets(fields);
  if (targets.length === 0) return [...fields];
  const r = await askJson(
    { purpose: "form_read", spec: FORM_OPTIONS, system: OPTION_AI_SYSTEM, input: sealItemCatalog(optionRequestInput(targets)), schema: AnswerSchema },
    ctx,
  );
  const byId = new Map(r.value.fields.map((f) => [f.id, f]));
  return fields.map((f) => {
    const t = targets.find((x) => x.field.id === f.id);
    const got = byId.get(f.id);
    if (!t || !got || !f.item) return f;
    const known = new Set(codesOf(f.item));
    const values: Array<string[] | null> = f.options.map((o, i) => codeOfOption(f.item!, o, f) ?? f.optionValues?.values[i] ?? null);
    const ai: number[] = [];
    for (const o of got.options) {
      if (!t.open.includes(o.no) || o.codes === null) continue;
      const codes = [...new Set(o.codes.filter((c) => known.has(c)))];
      // 値の一覧に無い code だけの答えは捨てる（空の並びの答えは「どの値にも当たらない」として受ける）
      if (o.codes.length > 0 && codes.length === 0) continue;
      values[o.no] = codes;
      ai.push(o.no);
    }
    if (ai.length === 0) return f;
    // 言い換えの表で当たる選択肢は表のまま（optionTable がいつもコードで引く）。残すのは AI の当てた物と前の当て
    return { ...f, optionValues: { item: f.item, values: values.map((v, i) => (codeOfOption(f.item!, f.options[i], f) === null ? v : null)), ai: ai.sort((a, b) => a - b) } };
  });
}
