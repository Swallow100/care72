// 台帳（本人の行・連絡先・時計）からルールの表の入力を作る。
// 人が付ける欄（本人の報告を当てにしない印・時計の頼り先の確認）は表の列から読む。台帳の JSON からは読まない。

import type { ClockRow, ContactRow, Ledger, PersonRow } from "../db/types.ts";
import type { TriagePerson } from "./index.ts";

export type LedgerForTriage = {
  person: Pick<PersonRow, "id" | "self_report_unreliable">;
  ledger: Ledger;
  contacts: ReadonlyArray<Pick<ContactRow, "supporter_order">>;
  clocks: ReadonlyArray<
    Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on" | "depends_on" | "depends_check">
  >;
};

export function toTriagePerson(src: LedgerForTriage): TriagePerson {
  const { care, basic } = src.ledger;
  return {
    id: src.person.id,
    clocks: src.clocks.map((k) => ({
      kind: k.kind,
      category: k.category,
      label: k.label,
      value: k.value,
      unit: k.unit,
      starts_on: k.starts_on,
      depends_on: k.depends_on,
      depends_check: k.depends_check,
    })),
    livesAlone: basic.household === "alone",
    bedridden: care.bedridden === true || care.walking === "hard",
    hasSupporter: src.contacts.some((c) => c.supporter_order != null),
    dementia: care.dementia === true || src.clocks.some((k) => k.category === "dementia"),
    selfReportUnreliable: src.person.self_report_unreliable === 1,
  };
}
