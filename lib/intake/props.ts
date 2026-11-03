// 入れる欄（components/person/Intake.tsx）に渡す物を、本人のページの行から作る。サーバーで使う。

import { parseLedger } from "../db/ledger.ts";
import type { ClockCategory, Ledger } from "../db/types.ts";
import type { PersonPageRows } from "../person.ts";
import { questionQueue, type Question } from "./ask.ts";
import type { EditData } from "./edit.ts";

export type IntakeProps = {
  personId: string;
  /** 台帳の版（保存のときに確かめる） */
  version: number;
  /** Claude の鍵があるか（無ければ「AI 未設定」と手入力） */
  aiReady: boolean;
  /** 次の問いの順の列 */
  queue: Question[];
  /** 今の台帳（手入力の初めの値、印の見せ方） */
  ledger: Ledger;
  /** 今の時計（印を作るかの見せ方。名前と区分だけ） */
  clocks: Array<{ category: ClockCategory; label: string }>;
  /** 本人のページの面の「編集」に要る今の値（T45） */
  edit: EditData;
};

export function intakePropsOf(rows: PersonPageRows, aiReady: boolean): IntakeProps {
  return {
    personId: rows.person.id,
    version: rows.person.version ?? 1,
    aiReady,
    queue: questionQueue(rows),
    ledger: parseLedger(rows.person.ledger),
    clocks: rows.clocks.map((k) => ({ category: k.category, label: k.label })),
    edit: {
      personId: rows.person.id,
      version: rows.person.version ?? 1,
      ledger: parseLedger(rows.person.ledger),
      contacts: rows.contacts.map((c) => ({
        id: c.id,
        kind: c.kind,
        relation: c.relation,
        name: c.name,
        phone: c.phone,
        night_ok: c.night_ok,
        note: c.note,
      })),
      clocks: rows.clocks.map((k) => ({
        id: k.id,
        kind: k.kind,
        category: k.category,
        label: k.label,
        value: k.value,
        unit: k.unit,
        depends_on: k.depends_on,
        depends_check: k.depends_check,
      })),
      consents: rows.consents.map((c) => ({ kind: c.kind, status: c.status })),
    },
  };
}
