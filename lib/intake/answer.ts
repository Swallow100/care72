// 問いへの人の答え（ボタン・数字・文字）を、保存の変更にする。Claude を通らない（手の入力）。ブラウザで使う。

import type { PendingStatus } from "../db/types.ts";
import type { Question } from "./ask.ts";
import type { IntakeChange } from "./changes.ts";
import { contactPartValue } from "./contact-parts.ts";
import { intakeField, normalizeValue } from "./fields.ts";

/**
 * 答えの入力。choice は選んだ値（複数なら全部）、value は文字・数字の欄、night は選んだ連絡先。
 * note は選ぶ問いに打った補足（T150。「その他」の中身・「一部」の様子など）。選んだ値と両方台帳に入る
 */
export type AnswerInput =
  | { kind: "choice"; values: string[]; note?: string }
  | { kind: "value"; value: string }
  | { kind: "night"; contactIds: string[]; note?: string }
  | { kind: "pending"; status: PendingStatus };

/** 補足の長さの上限（特記に入れるとき。書き足しの欄はその欄の上限で切る） */
export const NOTE_MAX = 200;

/**
 * 補足の変更（T150）。書き足しの欄（noteKey、空のときだけ ask.ts が渡す）があればそこへ、無ければ特記へ欄の名前を頭に付けて
 * （「歩行: 杖で家の中は歩ける」。特記は本人のページ・紙で欄から離れて読まれるので、何の補足かを残す）。空なら何もしない
 */
export function noteChange(label: string, noteKey: string | null, raw: string | undefined): IntakeChange | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return null;
  const f = noteKey ? intakeField(noteKey) : undefined;
  if (f) {
    const value = normalizeValue(f, text);
    if (value !== null) return { t: "field", key: f.key, value };
  }
  return { t: "note", value: `${label}: ${text}`.slice(0, NOTE_MAX) };
}

/** 答えを変更にする。形に合わない答え（空・数字でない）は null */
export function answerChanges(q: Question, input: AnswerInput): IntakeChange[] | null {
  if (input.kind === "pending") return [{ t: "pending", field: q.key, status: input.status }];
  const a = q.answer;
  switch (a.kind) {
    case "choice": {
      // 補足だけ（何も選ばない）は保存しない。選んだ値があるときだけ、補足を一緒に
      if (input.kind !== "choice" || input.values.length === 0) return null;
      const f = intakeField(a.field);
      const value = f ? normalizeValue(f, a.multi ? input.values : input.values[0]) : null;
      if (value === null) return null;
      const note = noteChange(q.label, a.note, input.note);
      return [{ t: "field", key: a.field, value }, ...(note ? [note] : [])];
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
      // 補足（連絡先に無い人・来られる時間など）は特記へ（夜間支援に書き足しの欄は無い。T150）
      const note = noteChange(q.label, null, input.note);
      const withNote = (cs: IntakeChange[]) => (note ? [...cs, note] : cs);
      // 選んだ人は夜間可。誰も選ばなければ「なし」で、聞いた相手は全員 夜間不可
      if (input.contactIds.length > 0) {
        return withNote(
          a.contacts
            .filter((c) => input.contactIds.includes(c.id))
            .map((c): IntakeChange => ({ t: "contact", id: c.id, value: { kind: c.kind, nightOk: true } })),
        );
      }
      if (a.contacts.length === 0) return null;
      return withNote(a.contacts.map((c): IntakeChange => ({ t: "contact", id: c.id, value: { kind: c.kind, nightOk: false } })));
    }
    case "contact": {
      // 連絡先のフリガナ・住所・携帯（T117）。その連絡先の空いた所に入る（保存は上書きしない）
      if (input.kind !== "value") return null;
      const v = contactPartValue(a.part, input.value);
      return v === null ? null : [{ t: "contact", id: a.contactId, value: { kind: a.contactKind, [a.part]: v } }];
    }
    case "free":
      return null;
  }
}
