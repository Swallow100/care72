// 紙に直接書く（T117）。計画書（松山市）の紙の画面で欄を押すと、その欄の元（lib/forms/form-inputs.ts の MATSUYAMA_INPUTS）の入力が開き、
// 保存で台帳のその場所に入る（/api/intake/save の edit。経過は「ケアマネが直した」。本人のページの面の編集と同じ保存）。
// - paperEditData（サーバー）: 欄ごとの入力と今の値。入れ子の値（薬・連絡先の人・同意・住所など）は本人のページへの道だけ
// - paperChanges（ブラウザ）: 窓で入れた値から変更を作る（面の編集と同じ決まり。lib/intake/edit.ts の fieldEditChanges）
// 押せる印は画面だけ（紙には刷らない）。Claude は通らない（フリガナ・住所・電話も、ここから入れられる。docs/progress/t117.md の問い 5）。

import { parseLedger } from "../db/ledger.ts";
import type { ContactKind, Ledger } from "../db/types.ts";
import { CONTACT_KIND_LABELS, CONTACT_PART_LABELS, SECTION_LABELS } from "../labels.ts";
import type { IntakeChange } from "../intake/changes.ts";
import { contactPartValue, type ContactPart } from "../intake/contact-parts.ts";
import { editValueOf, fieldEditChanges } from "../intake/edit.ts";
import { intakeField, normalizeValue, withLedgerValue } from "../intake/fields.ts";
import type { PersonPageRows } from "../person.ts";
import { formContactOf, MATSUYAMA_INPUTS, MATSUYAMA_TEXT_SHAPES, type FormContactRole, type FormInput } from "./form-inputs.ts";
import type { FormEntry } from "./form-entries.ts";
import { MATSUYAMA_FIELDS, type Cell, type MatsuyamaKey } from "./matsuyama.ts";
import { cellLines } from "./overlay-sheet.ts";
import { matsuyamaFieldName } from "./unconfirmed.ts";

/** 窓の 1 つの入力。field は欄の表の欄、contact は連絡先の所、page は本人のページの面へ */
export type PaperInput =
  | { kind: "field"; key: string; label: string; value: unknown }
  | { kind: "contact"; contactId: string; contactKind: ContactKind; part: ContactPart | "phone"; label: string; value: string }
  | { kind: "page"; label: string; href: string };

/**
 * 押せる欄 1 つ（key は計画書の欄の鍵、label は帯と同じ欄の名前）。
 * text は台帳の 1 か所に書けない字の欄（元が本人のページの面への道だけ。T147）の今の紙の字で、窓の中で打って様式のみの値として残す。
 * entryId はその欄の様式のみの値の手入れの id（消すとき）
 */
export type PaperTarget = { key: MatsuyamaKey; label: string; inputs: PaperInput[]; text?: string; entryId?: string };

export type PaperEditData = { personId: string; version: number; targets: PaperTarget[] };

const ROLE_LABELS: Record<FormContactRole, string> = { kin: "近親者", kin2: "緊急連絡先2", supporter1: "支援者1", supporter2: "支援者2" };

/**
 * 欄ごとの入力と今の値（サーバーで作る。ケアマネの役の画面にだけ渡す）。
 * paper は紙面の今の値（様式のみの値を効かせた後）と様式のみの値の手入れ。渡せば、台帳の 1 か所に書けない字の欄に text（T147）
 */
export function paperEditData(rows: PersonPageRows, paper?: { cells: Partial<Record<MatsuyamaKey, Cell>>; entries: readonly FormEntry[] }): PaperEditData {
  const targets: PaperTarget[] = [];
  for (const def of MATSUYAMA_FIELDS) {
    const out = resolveInputs(rows, MATSUYAMA_INPUTS[def.key]);
    if (out.length === 0) continue;
    const t: PaperTarget = { key: def.key, label: matsuyamaFieldName(def), inputs: out };
    const cell = paper?.cells[def.key];
    if (paper && out.every((i) => i.kind === "page") && MATSUYAMA_TEXT_SHAPES.has(def.shape) && cell && cell.kind !== "withheld" && cell.kind !== "handwrite") {
      t.text = cellLines(cell).join(def.shape === "lines" ? "\n" : " ");
      const entry = paper.entries.find((e) => e.kind === "field" && e.fieldKey === def.key);
      if (entry) t.entryId = entry.id;
    }
    targets.push(t);
  }
  return { personId: rows.person.id, version: rows.person.version ?? 1, targets };
}

/**
 * 欄の元（lib/forms/form-inputs.ts の FormInput）を、窓とその場の入力（T135）の入力と今の値に。連絡先の人がいなければ本人のページへの道。
 * 計画書（MATSUYAMA_INPUTS）と添付の様式（lib/forms/item-inputs.ts の ITEM_INPUTS）で同じ
 */
export function resolveInputs(rows: PersonPageRows, inputs: readonly FormInput[] | undefined): PaperInput[] {
  const ledger: Ledger = parseLedger(rows.person.ledger);
  const href = `/people/${encodeURIComponent(rows.person.id)}`;
  const out: PaperInput[] = [];
  const pageOnce = (label: string) => {
    if (!out.some((x) => x.kind === "page" && x.label === label)) out.push({ kind: "page", label, href });
  };
  for (const input of inputs ?? []) {
    switch (input.kind) {
      case "field": {
        const f = intakeField(input.key);
        if (f) out.push({ kind: "field", key: input.key, label: f.label, value: editValueOf(ledger, input.key) ?? null });
        break;
      }
      case "contact": {
        const who = formContactOf(rows.contacts, input.role);
        // 人がいなければ書けない（連絡先を足すのは本人のページの関係者の面）
        if (!who) {
          pageOnce(`${SECTION_LABELS.people}（${ROLE_LABELS[input.role]} なし）`);
          break;
        }
        const name = who.relation ?? CONTACT_KIND_LABELS[who.kind];
        const raw = input.part === "phone" ? who.phone : who[input.part];
        out.push({
          kind: "contact",
          contactId: who.id,
          contactKind: who.kind,
          part: input.part,
          label: `${name} ${CONTACT_PART_LABELS[input.part]}`,
          value: raw ?? "",
        });
        break;
      }
      case "page":
        pageOnce(SECTION_LABELS[input.section]);
        break;
    }
  }
  return out;
}

/** 電話の形（lib/intake/save.ts の連絡先の phone と同じ） */
const PHONE = /^[0-9+\-() ]{0,20}$/;

export type PaperDraft = Readonly<Record<string, unknown>>;

/** 窓の入力の下書きの鍵（欄は欄の鍵、連絡先は contacts.<id>.<所>） */
export const draftKey = (i: Exclude<PaperInput, { kind: "page" }>): string => (i.kind === "field" ? i.key : `contacts.${i.contactId}.${i.part}`);

/**
 * 窓で入れた値から変更を作る（ブラウザ）。欄は面の編集と同じ決まり（空にしたら外す、形の合わない値は送らない）、
 * 連絡先の所は手で直す形（overwrite。空にしたら消す）。形の合わない値があれば bad に欄の名前
 */
export function paperChanges(target: PaperTarget, draft: PaperDraft): { changes: IntakeChange[]; bad: string[] } {
  const bad: string[] = [];
  const fields = target.inputs.flatMap((i) => (i.kind === "field" ? [i] : []));
  // 今の値は窓に渡した値（サーバーが台帳から読んだ物）。台帳の形に戻して、面の編集と同じ決まりで比べる
  let ledger = parseLedger("{}");
  for (const i of fields) if (i.value !== null && i.value !== undefined) ledger = withLedgerValue(ledger, i.key, i.value);
  const changes = fieldEditChanges(
    fields.map((i) => i.key),
    ledger,
    draft,
  );
  for (const i of target.inputs) {
    if (i.kind === "field") {
      // 形の合わない値（数字の欄に字など）は送らずに知らせる
      const raw = draft[i.key];
      const f = intakeField(i.key);
      if (f && typeof raw === "string" && raw.trim() !== "" && normalizeValue(f, raw) === null) bad.push(i.label);
      continue;
    }
    if (i.kind !== "contact") continue;
    const raw = draft[draftKey(i)];
    if (typeof raw !== "string") continue;
    const next = raw.trim();
    if (next === i.value.trim()) continue;
    let value: string;
    if (next === "") value = "";
    else if (i.part === "phone") {
      if (!PHONE.test(next)) {
        bad.push(i.label);
        continue;
      }
      value = next;
    } else {
      const v = contactPartValue(i.part, next);
      if (v === null) {
        bad.push(i.label);
        continue;
      }
      value = v;
    }
    changes.push({ t: "contact", id: i.contactId, value: { kind: i.contactKind, [i.part]: value }, overwrite: true });
  }
  return { changes, bad };
}

