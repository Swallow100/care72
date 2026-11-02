// 第三者提供の記録（docs/SPEC.md「個人情報」: 渡した相手・範囲・時刻）。受け入れ 1 回に 1 行（third_party_provisions）。
//
// 範囲は医療班への提供の同意で決める（docs/SPEC.md「画面 6」: 医療・避難・人の一部。住所は既定で出さない）:
// - 同意あり → 本人確認（氏名・カナ・生年月日・年齢）・医療・避難・人の一部（緊急連絡先と支援者の役割名）。根拠は同意（consent）
// - 同意なし・未確認 → 本人確認だけ。根拠は生命・身体の保護（個人情報保護法 27 条 1 項 2 号、vital）
// 本人のページをこの範囲で出し分けるのは T24（lib/consent/scope.ts）。T24 で範囲の決め方がそこに移ったら、ここはそれを呼ぶ形にする。
// その場で登録した人（via on_site）は、受け持つ人が自分で聞いた物なので提供の記録を作らない。

import type { ConsentStatus, ProvisionBasis } from "../db/types.ts";

/** 渡す区分: 本人確認・医療・避難・人の一部 */
export const PROVISION_SECTIONS = ["identity", "medical", "evacuation", "people_partial"] as const;
export type ProvisionSection = (typeof PROVISION_SECTIONS)[number];

export const PROVISION_SECTION_LABELS: Record<ProvisionSection, string> = {
  identity: "本人確認",
  medical: "医療",
  evacuation: "避難",
  people_partial: "人の一部",
};

export const PROVISION_BASIS_LABELS: Record<ProvisionBasis, string> = {
  consent: "同意",
  vital: "生命保護",
};

export function provisionScope(medicalConsent: ConsentStatus): ProvisionSection[] {
  return medicalConsent === "granted" ? [...PROVISION_SECTIONS] : ["identity"];
}

export function provisionBasis(medicalConsent: ConsentStatus): ProvisionBasis {
  return medicalConsent === "granted" ? "consent" : "vital";
}
