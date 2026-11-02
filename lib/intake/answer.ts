// 問いへの人の答え（ボタン・数字・文字）を、保存の変更にする。Claude を通らない（手の入力）。ブラウザで使う。

import type { PendingStatus } from "../db/types.ts";
import type { Question } from "./ask.ts";
import type { IntakeChange } from "./changes.ts";
import { intakeField, normalizeValue } from "./fields.ts";

/** 答えの入力。choice は選んだ値（複数なら全部）、value は文字・数字の欄、night は選んだ連絡先 */
export type AnswerInput =
  | { kind: "choice"; values: string[] }
  | { kind: "value"; value: string }
  | { kind: "night"; contactIds: string[] }
  | { kind: "pending"; status: PendingStatus };

/** 答えを変更にする。形に合わない答え（空・数字でない）は null */
export function answerChanges(q: Question, input: AnswerInput): IntakeChange[] | null {
  if (input.kind === "pending") return [{ t: "pending", field: q.key, status: input.status }];
  const a = q.answer;
  switch (a.kind) {
    case "choice": {
      if (input.kind !== "choice" || input.values.length === 0) return null;
      const f = intakeField(a.field);
      const value = f ? normalizeValue(f, a.multi ? input.values : input.values[0]) : null;
      return value === null ? null : [{ t: "field", key: a.field, value }];
    }
    case "text":
    case "list":
    case "int": {
      if (input.kind !== "value") return null;
      const f = intakeField(a.field);
      const value = f ? normalizeValue(f, input.value) : null;
      return value === null ? null : [{ t: "field", key: a.field, value }];
    }
    case "clock": {
      if (input.kind !== "value") return null;
      const n = Number(input.value.trim().replace(/[０-９．]/g, (d) => (d === "．" ? "." : String(d.charCodeAt(0) - 0xff10))));
      if (!Number.isFinite(n) || n < 0 || n > 10000 || input.value.trim() === "") return null;
      return [{ t: "clock", clockId: a.clockId, medIndex: a.medIndex, label: a.clockLabel, value: n, unit: a.unit }];
    }
    case "medtext": {
      if (input.kind !== "value" || input.value.trim() === "") return null;
      return [{ t: "medication", index: a.medIndex, value: { name: a.name, category: a.category, [a.part]: input.value.trim().slice(0, 200) } }];
    }
    case "night": {
      if (input.kind !== "night") return null;
      // 選んだ人は夜間可。誰も選ばなければ「なし」で、聞いた相手は全員 夜間不可
      if (input.contactIds.length > 0) {
        return a.contacts
          .filter((c) => input.contactIds.includes(c.id))
          .map((c): IntakeChange => ({ t: "contact", id: c.id, value: { kind: c.kind, nightOk: true } }));
      }
      if (a.contacts.length === 0) return null;
      return a.contacts.map((c): IntakeChange => ({ t: "contact", id: c.id, value: { kind: c.kind, nightOk: false } }));
    }
    case "free":
      return null;
  }
}
