// 台帳（本人の行・連絡先・時計）からルールの表の入力を作る。

import type { ClockRow, ContactRow, Ledger, PersonRow } from "../db/types.ts";
import type { TriagePerson } from "./index.ts";

export type LedgerForTriage = {
  person: Pick<PersonRow, "id">;
  ledger: Ledger;
  contacts: ReadonlyArray<Pick<ContactRow, "supporter_order">>;
  clocks: ReadonlyArray<Pick<ClockRow, "kind" | "category" | "label" | "value" | "unit" | "starts_on">>;
};

export function toTriagePerson(src: LedgerForTriage): TriagePerson {
  const { care, basic } = src.ledger;
  return {
    id: src.person.id,
    clocks: src.clocks.map((k) => ({ ...k })),
    livesAlone: basic.household === "alone",
    bedridden: care.bedridden === true || care.walking === "hard",
    hasSupporter: src.contacts.some((c) => c.supporter_order != null),
    dementia: care.dementia === true || src.clocks.some((k) => k.category === "dementia"),
  };
}
