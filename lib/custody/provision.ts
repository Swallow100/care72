// 第三者提供の記録（docs/SPEC.md「個人情報」: 渡した相手・範囲・時刻）。受け入れ 1 回に 1 行（third_party_provisions）。
//
// 範囲と根拠の決め方は lib/consent/scope.ts の 1 か所（T24）。本人のページ・書類・受け持ちの一覧の出し分けと同じ範囲を記録する:
// - 医療班への提供に同意あり → 本人確認・医療・避難・人の一部（緊急連絡先と支援者の役割名）。住所は同意の範囲にあるときだけ。根拠は同意
// - 同意なし・未確認 → 本人確認だけ。根拠は生命・身体の保護（個人情報保護法 27 条 1 項 2 号、vital）
// - その場で登録した人（via on_site）は、受け持つ人が自分で聞いた物なので、登録した人には提供の記録を作らない
//   （別のアカウントが受け入れたときは、同意ありと同じ区分を根拠 生命保護で残す。scope.ts の on_site）
// ここは scope.ts を呼ぶ薄い形（T23 の名前を残す）。

import type { ProvisionBasis } from "../db/types.ts";
import { PROVISION_BASIS_LABELS, PROVISION_SECTION_LABELS } from "../consent/labels.ts";
import { PROVISION_SECTIONS, viewScope, type ProvisionSection, type ScopeInput } from "../consent/scope.ts";

export { PROVISION_BASIS_LABELS, PROVISION_SECTION_LABELS, PROVISION_SECTIONS, type ProvisionSection };

/** 医療班・行政に渡す区分と根拠（受け入れたときの記録）。医療班と行政は同じ範囲 */
export function provisionOf(input: ScopeInput): { basis: ProvisionBasis; sections: ProvisionSection[] } {
  const p = viewScope("medical", input).provision;
  if (!p) throw new Error("医療班の範囲に提供の記録が無い");
  return p;
}
