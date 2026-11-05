// 対応表の確かめの画面で先に見る欄（T122）。評価の 2 回目（docs/progress/eval-r2-forms-findings.md の 2）で、実在の様式の欄の当たりが 76% で、
// 対応表は様式に 1 つなので 1 欄の読み違いが全部の紙で同じ空きになった。読み違いの多かった欄の種類と、自信の低い欄・台帳の項目なしの欄を
// 「要確認」として先に並べて目立たせ、確かめるまで紙に使わない形（FormMapping.holdRisky）を選べるようにする。
//
// 要確認の訳（重い順）:
// - rejected 項目不明: 台帳に無い項目名を返した
// - pick 要選択: 項目なしで人が選ぶ欄（同意・候補あり。T120 の needsPick）
// - multi 複数選択: □ ごとに分けて読んだ複数選択の並びの一部（評価で 自宅のリスク・支援の内容・既往症・予防接種の 4 つ。2 つ目からの □ が項目なしで紙が空いた）
// - kind 種類欄: 機器・薬の種類の □ を項目なしにした（在宅酸素療法の □）
// - era 元号: 元号の選択肢だけの欄（日付の欄と別に読んだ。生年月日の欄の取りこぼしになった）
// - low 自信低: 項目を当てたが自信 low
// - none 項目なし: 台帳の項目なし（手書きの欄・外した欄は除く）
// 色と順（lib/triage）とは関係ない。紙の差し込み（lib/forms/mapped-sheet.ts）が holdRisky のとき、確認していない要確認の欄を対応なしとして扱う。

import { DEVICE_LABELS, MEDICATION_CATEGORY_LABELS } from "../labels.ts";
import { needsPick, type FormMapping, type LedgerItemKey, type MappingField } from "./mapping.ts";

export const FIELD_RISKS = ["rejected", "pick", "multi", "kind", "era", "low", "none"] as const;
export type FieldRisk = (typeof FIELD_RISKS)[number];

export const FIELD_RISK_LABELS: Record<FieldRisk, string> = {
  rejected: "項目不明",
  pick: "要選択",
  multi: "複数選択",
  kind: "種類欄",
  era: "元号",
  low: "自信低",
  none: "項目なし",
};

/** 種類の並ぶ項目（複数選択の □ の並びが当たる物） */
const LIST_ITEMS: ReadonlySet<LedgerItemKey> = new Set<LedgerItemKey>([
  "evacuation.hazards",
  "evacuation.support",
  "medical.history",
  "medical.vaccinations",
  "medical.allergies",
  "evacuation.carryItems",
]);
const MULTI_WORDS = /複数|あてはまる|当てはまる|すべて|全て/;
const ERAS = ["明治", "大正", "昭和", "平成", "令和"];
const KIND_WORDS = [...Object.values(DEVICE_LABELS), ...Object.values(MEDICATION_CATEGORY_LABELS)].filter((w) => w !== "その他");

const norm = (s: string) => s.normalize("NFKC").replace(/[\s（）()]/g, "");
const sameBlock = (a: MappingField, b: MappingField) => a.page === b.page && a.section === b.section;

/** 欄の要確認の訳（要確認でなければ null）。fields は同じ対応表の欄の全部（複数選択の並びを見る） */
export function fieldRisk(f: MappingField, fields: readonly MappingField[]): FieldRisk | null {
  if (f.removed || f.shape === "handwrite") return null;
  if (f.ai?.rejected) return "rejected";
  if (needsPick(f)) return "pick";
  if (f.shape === "check") {
    const inMultiBlock = MULTI_WORDS.test(`${f.section} ${f.label}`);
    const siblingList = fields.some((g) => g !== f && !g.removed && g.shape === "check" && sameBlock(f, g) && g.item !== null && LIST_ITEMS.has(g.item));
    if ((f.item !== null && LIST_ITEMS.has(f.item)) || (f.item === null && (inMultiBlock || siblingList))) return "multi";
    if (f.item === null && KIND_WORDS.some((w) => norm(f.label).includes(norm(w)))) return "kind";
  }
  if (f.shape === "choice" && f.options.filter((o) => ERAS.some((e) => o.includes(e))).length >= 2) return "era";
  if (f.item !== null && f.ai?.confidence === "low") return "low";
  if (f.item === null) return "none";
  return null;
}

/** 要確認の欄（id → 訳）。人が確認した欄（confirmed）も入る */
export function fieldRisks(fields: readonly MappingField[]): Map<string, FieldRisk> {
  const out = new Map<string, FieldRisk>();
  for (const f of fields) {
    const r = fieldRisk(f, fields);
    if (r) out.set(f.id, r);
  }
  return out;
}

/** 確かめの画面の並び（要確認順）: 要確認の重い順、同じ訳は様式の順。要確認でない欄は後ろに様式の順 */
export function riskOrder(fields: readonly MappingField[]): MappingField[] {
  const risks = fieldRisks(fields);
  const rank = (f: MappingField) => {
    const r = risks.get(f.id);
    // 確認した欄は要確認でない欄と同じ所へ
    return r && !f.confirmed ? FIELD_RISKS.indexOf(r) : FIELD_RISKS.length;
  };
  return fields.map((f, i) => ({ f, i, r: rank(f) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.f);
}

/** まだ確認していない要確認の欄の数 */
export function openRisks(m: Pick<FormMapping, "fields">): number {
  const risks = fieldRisks(m.fields);
  return m.fields.filter((f) => risks.has(f.id) && !f.confirmed).length;
}

/**
 * 紙に使わない欄（holdRisky のとき、確認していない要確認の欄で、項目を当てた物）。項目なしの欄はもとから未確認なので入れない
 */
export function heldFields(m: Pick<FormMapping, "fields" | "holdRisky">): Set<string> {
  if (!m.holdRisky) return new Set();
  const risks = fieldRisks(m.fields);
  return new Set(m.fields.filter((f) => risks.has(f.id) && !f.confirmed && f.item !== null).map((f) => f.id));
}
