// 紙の上でその場で入れる（T135）の欄の一覧を作る（サーバー）。紙の欄ごとに、押す所・入れ方・行き先（台帳か様式だけ）・今の値・
// 手で入れた印・この欄を埋める問いを決める。画面（components/forms/PaperFill.tsx）が紙の上に重ねて描く。
//
// 決まり:
// - 台帳の項目に当たる欄は台帳へ。元が台帳の 1 か所（入れる欄の表の欄 1 つ・連絡先の所 1 つ）ならその場で、何か所かにまたがれば入力の窓（T117）
// - 台帳に項目の無い欄（様式だけの欄）は、その人のその様式の手入れ（lib/forms/form-entries.ts）。手書きの欄（署名・受付印・医師が書く欄）は押せない
// - 同意が無くて省く欄・確かめていない要確認の欄（T122 の保留）・台帳の別の値から作る欄（作成日・年齢・計画作成者など）は押せない
// - 選ぶ欄は、様式の選択肢と台帳の選択肢の言葉が合う物だけ押せる（合わなければ窓）
// 定型の計算で、Claude は呼ばない。

import { inputAsks, MATSUYAMA_INPUTS, type FormInput } from "./form-inputs.ts";
import { formOnlyField, MATSUYAMA_FORM_ONLY, parseFieldValue, type FormEntry } from "./form-entries.ts";
export { MATSUYAMA_FORM_ONLY };
import { heldFields } from "./field-risk.ts";
import { ITEM_INPUTS } from "./item-inputs.ts";
import { PART_SHAPES, type FieldBox, type FormMapping, type MappingField } from "./mapping.ts";
import { wordMatches, type MappedSheet } from "./mapped-sheet.ts";
import { MATSUYAMA_FIELDS, type MatsuyamaKey, type MatsuyamaSheet } from "./matsuyama.ts";
import { cellLines, FONT_MAX_PT, insetBox, FILL_INSET_MM, type OverlaySheet } from "./overlay-sheet.ts";
import type { InkBlob } from "./ink.ts";
import { inkIn } from "./place.ts";
import { resolveInputs, type PaperInput } from "./paper-edit.ts";
import type { PaperSlot, SlotInput, SlotOption, SlotValue } from "./paper-fill.ts";
import { isUnconfirmedCell, matsuyamaFieldName } from "./unconfirmed.ts";
import type { Frame, MmBox } from "./frame-sheet.ts";
import { intakeField, type IntakeField } from "../intake/fields.ts";
import type { Question } from "../intake/ask.ts";
import type { PersonPageRows } from "../person.ts";
import type { Cell } from "./matsuyama.ts";

/** あり・なしの選択肢の言葉（台帳の真偽に当てる） */
const YES = ["あり", "有", "はい", "する", "済"];
const NO = ["なし", "無", "いいえ", "しない", "未"];

/** 様式の選択肢を、台帳の欄の選択肢の値に当てる。当たらない選択肢は value が空（押せない） */
function mapOptions(labels: readonly string[], f: IntakeField): Array<{ label: string; value: string }> {
  return labels.map((label) => {
    if (f.shape.type === "bool") {
      const v = YES.some((w) => label.trim() === w) ? "true" : NO.some((w) => label.trim() === w) ? "false" : "";
      return { label, value: v };
    }
    if (f.shape.type === "enum" || f.shape.type === "enumList") {
      const hit = f.shape.options.find((o) => wordMatches(label, [o.label]));
      return { label, value: hit?.value ?? "" };
    }
    return { label, value: "" };
  });
}

/** 台帳の欄の今の値を、その場の入力の値に（字の欄は字、選ぶ欄は値の配列、□ は真偽） */
function ledgerSlotValue(input: Exclude<PaperInput, { kind: "page" }>, kind: SlotInput["kind"]): SlotValue {
  const v = input.value;
  if (kind === "check") return v === true;
  if (kind === "choice") {
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === "boolean") return [String(v)];
    return typeof v === "string" && v !== "" ? [v] : [];
  }
  if (Array.isArray(v)) return v.map(String).join("・");
  if (v === null || v === undefined) return "";
  return String(v);
}

/** 欄の入れ方を、様式の欄の形（字・選ぶ・□）と台帳の元（1 か所の欄・連絡先の所）から決める。その場で入れられなければ null（窓） */
function inlineInput(
  form: { shape: "text" | "choice" | "check"; options: readonly string[]; optionBoxes: ReadonlyArray<FieldBox | null>; multiline: boolean; tel: boolean; parts?: Array<{ sep: string; box: FieldBox }> },
  input: Exclude<PaperInput, { kind: "page" }>,
): SlotInput | null {
  if (input.kind === "contact") {
    if (form.shape !== "text") return null;
    const tel = input.part === "phone" || input.part === "mobile";
    return { kind: "text", multiline: false, tel, max: input.part === "address" ? 60 : input.part === "kana" ? 40 : 20, ...(form.parts ? { parts: form.parts } : {}) };
  }
  const f = intakeField(input.key);
  if (!f) return null;
  switch (f.shape.type) {
    case "text":
    case "int":
    case "list":
      if (form.shape !== "text") return null;
      return {
        kind: "text",
        multiline: form.multiline || f.shape.type === "list",
        tel: f.tel === true || form.tel,
        max: f.shape.type === "text" ? (f.shape.max ?? 200) : 200,
        ...(f.shape.type === "int" && f.shape.unit ? { unit: f.shape.unit } : {}),
        ...(form.parts && f.shape.type !== "list" ? { parts: form.parts } : {}),
      };
    case "bool":
      if (form.shape === "check") return { kind: "check" };
    // fallthrough（あり・なしの選択肢）
    case "enum":
    case "enumList": {
      if (form.shape !== "choice") return null;
      const mapped = mapOptions(form.options, f);
      const options: SlotOption[] = mapped.flatMap((o, i) => (o.value !== "" ? [{ label: o.label, value: o.value, box: form.optionBoxes[i] ?? null }] : []));
      if (options.length === 0 || options.some((o) => o.box === null)) return null;
      return { kind: "choice", multi: f.shape.type === "enumList", options };
    }
  }
}

/** 欄の元の問い（問いの列のうち、欄の元に当たる物の鍵） */
function asksOf(inputs: readonly FormInput[] | undefined, queue: readonly Question[], rows: PersonPageRows): string[] {
  if (!inputs) return [];
  return queue.filter((q) => inputs.some((i) => inputAsks(i, q.key, rows.contacts))).map((q) => q.key);
}

/** 手で入れた印（台帳の印か、様式だけの欄の手入れ） */
function handOf(entries: readonly FormEntry[], key: string): PaperSlot["hand"] {
  const e = entries.find((x) => (x.kind === "ledger" || x.kind === "field") && x.fieldKey === key);
  return e ? { by: e.by, at: e.at } : undefined;
}

/** 台帳の欄か窓の欄を作る（欄の元を解いて、その場か窓か） */
function ledgerSlot(
  base: Omit<PaperSlot, "dest" | "input" | "value">,
  rows: PersonPageRows,
  raw: readonly FormInput[] | undefined,
  form: Parameters<typeof inlineInput>[0],
): PaperSlot | null {
  const inputs = resolveInputs(rows, raw);
  if (inputs.length === 0) return null;
  const writable = inputs.filter((i): i is Exclude<PaperInput, { kind: "page" }> => i.kind !== "page");
  if (inputs.length === 1 && writable.length === 1) {
    const input = inlineInput(form, writable[0]);
    if (input) return { ...base, dest: "ledger", input, value: ledgerSlotValue(writable[0], input.kind), ledger: writable[0] };
  }
  return { ...base, dest: "ledger", input: { kind: "window" }, value: "", target: { key: base.key as MatsuyamaKey, label: base.label, inputs } };
}

// ---------- 添付の様式（T86 の対応表の紙） ----------

const nameOf = (f: MappingField) => (f.section ? `${f.section} ${f.label}` : f.label);

/** 区切りの空き（年・月・日、− −）。区切りと空きが全部そろう欄だけ */
function partsOfField(f: MappingField): Array<{ sep: string; box: FieldBox }> | undefined {
  if (!PART_SHAPES.includes(f.shape) || f.options.length === 0) return undefined;
  const boxes = f.optionBoxes ?? [];
  if (boxes.length !== f.options.length || boxes.some((b) => !b)) return undefined;
  return f.options.map((sep, i) => ({ sep, box: boxes[i]! }));
}

/**
 * 添付の様式の紙の欄（場所があり、頁の画像のある欄）。overlay は buildOverlaySheet の紙（頁の画像の大きさ）、mapped は手入れを効かせた差し込みの紙面
 */
export function mappedSlots(
  rows: PersonPageRows,
  mapping: FormMapping,
  overlay: OverlaySheet,
  mapped: MappedSheet,
  entries: readonly FormEntry[],
  queue: readonly Question[],
  inks: ReadonlyMap<number, InkBlob[] | null> = new Map(),
): PaperSlot[] {
  const cells = new Map<string, Cell>(mapped.pages.flatMap((p) => p.sections.flatMap((s) => s.rows.map((r) => [r.field.id, r.cell] as const))));
  // 空いた訳（T133 の黄の塗り 2 つ）。ask は台帳に無い、fix は台帳に値があるのに置けなかった
  const gaps = new Map<string, "ask" | "fix">();
  for (const pg of overlay.pages) for (const fill of pg.fills) for (const k of fill.keys) gaps.set(k, fill.kind ?? "ask");
  const held = heldFields(mapping);
  const out: PaperSlot[] = [];
  for (const f of mapping.fields) {
    if (f.removed || !f.box || f.shape === "handwrite" || held.has(f.id)) continue;
    const page = overlay.pages.find((p) => p.page === f.page);
    if (!page) continue;
    const cell = cells.get(f.id);
    if (!cell || cell.kind === "withheld") continue;
    const parts = partsOfField(f);
    const gap = gaps.get(f.id);
    const shape = f.shape === "check" ? "check" : f.shape === "choice" && f.options.length > 0 ? "choice" : "text";
    const base = {
      key: f.id,
      label: nameOf(f),
      page: f.page,
      box: f.box,
      mm: { w: f.box.w * page.image.w, h: f.box.h * page.image.h },
      maxPt: FONT_MAX_PT,
      empty: gap !== undefined || isUnconfirmedCell(cell),
      ...(gap ? { gap } : {}),
      ...(shape === "text" ? { place: placeOf(f, mapping.fields, inks.get(f.page) ?? null) } : {}),
      hand: handOf(entries, f.id),
    };
    const entry = entries.find((e) => e.kind === "field" && e.fieldKey === f.id);
    // 様式だけの欄と、台帳に値があるのに置けなかった欄（T133 の fix）・この様式の手入れのある欄は、この人のこの様式の手入れ
    if (formOnlyField(f) || (f.item !== null && (gap === "fix" || entry))) {
      const v = entry ? parseFieldValue(entry.value) : null;
      let input: SlotInput;
      let value: SlotValue;
      if (shape === "check") {
        input = { kind: "check" };
        value = v === true;
      } else if (shape === "choice") {
        const options = f.options.map((label, i) => ({ label, value: label, box: f.optionBoxes?.[i] ?? null }));
        // □ の場所の無い選択肢があれば字で書く（選んだ言葉を欄に）
        input = options.every((o) => o.box) ? { kind: "choice", multi: /複数/.test(`${f.section}${f.label}`), options } : { kind: "text", multiline: false, tel: false, max: 60 };
        value = input.kind === "choice" ? (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []) : typeof v === "string" ? v : Array.isArray(v) ? v.join("・") : "";
      } else {
        input = { kind: "text", multiline: f.shape === "lines", tel: f.shape === "phone", max: 200, ...(parts ? { parts } : {}) };
        // 置けなかった値は、台帳の字を初めの値に（この様式に合う形に書き直す）
        value = typeof v === "string" ? v : f.item !== null ? cellLines(cell).join(" ") : "";
      }
      out.push({ ...base, dest: "form", input, value, ...(entry ? { entryId: entry.id } : {}) });
      continue;
    }
    if (f.item === null) continue;
    const raw = ITEM_INPUTS[f.item];
    const slot = ledgerSlot(base, rows, raw, {
      shape,
      options: f.options,
      optionBoxes: f.optionBoxes ?? [],
      multiline: f.shape === "lines",
      tel: f.shape === "phone",
      ...(parts ? { parts } : {}),
    });
    if (!slot) continue;
    const asks = asksOf(raw, queue, rows);
    out.push(asks.length > 0 ? { ...slot, asks } : slot);
  }
  return out;
}

/**
 * 紙に置くときの避ける物（T133 の placeText と同じ）: 欄の枠の中の印刷の字と、枠に掛かるほかの欄の枠。
 * buildOverlaySheet が渡す物（頁の全部の印刷の字と全部の欄の枠）から、この欄の置き方に効く物だけを選ぶ
 */
function placeOf(f: MappingField, fields: readonly MappingField[], ink: readonly InkBlob[] | null): NonNullable<PaperSlot["place"]> {
  const box = f.box!;
  const hits = (b: FieldBox) => b.x < box.x + box.w && box.x < b.x + b.w && b.y < box.y + box.h && box.y < b.y + b.h;
  return {
    ink: ink ? inkIn(box, ink) : [],
    others: fields
      .filter((o) => !o.removed && o.box && o.page === f.page && hits(o.box))
      .map((o) => ({ id: o.id, box: o.box!, free: o.item === null && (o.shape === "text" || o.shape === "lines") })),
  };
}

// ---------- 計画書（松山市の原本の枠の紙、T101） ----------


const ratio = (b: MmBox, p: { w: number; h: number }): FieldBox => ({ x: b.x / p.w, y: b.y / p.h, w: b.w / p.w, h: b.h / p.h });

/**
 * 計画書の原本の枠の紙の欄。欄の矩形（frame.areas）ごとに 1 つ。字を書く矩形は、その欄だけの字の所（take の無い 1 つ）があればそこ、
 * 無ければ（氏名の氏と名・年月日のように分けて書く欄）窓。選ぶ欄は □ の所
 */
export function frameSlots(
  rows: PersonPageRows,
  frame: Frame<MatsuyamaKey>,
  sheet: Pick<MatsuyamaSheet, "cells">,
  pages: readonly number[],
  entries: readonly FormEntry[],
  queue: readonly Question[],
): PaperSlot[] {
  const handwrite = new Set<MatsuyamaKey>(MATSUYAMA_FIELDS.filter((f) => f.shape === "handwrite").map((f) => f.key));
  const def = new Map(MATSUYAMA_FIELDS.map((f) => [f.key, f]));
  const out: PaperSlot[] = [];
  for (const area of frame.areas) {
    if (!pages.includes(area.page)) continue;
    const size = frame.pages.find((p) => p.page === area.page)!;
    const keys = area.keys.filter((k) => !handwrite.has(k));
    if (keys.length === 0) continue;
    const areaBox = insetBox(ratio(area.box, size), size, FILL_INSET_MM) ?? ratio(area.box, size);
    const key = keys.find((k) => MATSUYAMA_INPUTS[k] || MATSUYAMA_FORM_ONLY.has(k)) ?? null;
    if (!key) continue;
    const marks = frame.slots.filter((s): s is Extract<(typeof frame.slots)[number], { kind: "mark" }> => s.kind === "mark" && s.key === key && !s.option.startsWith("=") && s.option !== "*");
    const texts = frame.slots.filter((s): s is Extract<(typeof frame.slots)[number], { kind: "text" }> => s.kind === "text" && s.keys.includes(key));
    const one = texts.length === 1 && texts[0].keys.length === 1 && !texts[0].take && !texts[0].labels && !texts[0].prefix ? texts[0] : null;
    const box = one ? ratio(one.box, size) : areaBox;
    const fieldDef = def.get(key);
    const cell = sheet.cells[key];
    const base = {
      key,
      ...(keys.length > 1 ? { keys: [...keys] } : {}),
      label: keys.length > 1 ? keys.map((k) => (def.get(k) ? matsuyamaFieldName(def.get(k)!) : k)).join("・") : fieldDef ? matsuyamaFieldName(fieldDef) : key,
      page: area.page,
      box,
      area: areaBox,
      mm: one ? { w: one.box.w, h: one.box.h } : { w: areaBox.w * size.w, h: areaBox.h * size.h },
      maxPt: frame.maxPt,
      empty: keys.some((k) => sheet.cells[k] && isUnconfirmedCell(sheet.cells[k])),
      // 原本の枠の紙は印刷の字の位置を持たない（T133）ので、空いた欄は全部「台帳に無い」
      ...(keys.some((k) => sheet.cells[k] && isUnconfirmedCell(sheet.cells[k])) ? { gap: "ask" as const } : {}),
      hand: handOf(entries, key),
    };
    if (MATSUYAMA_FORM_ONLY.has(key)) {
      const options = marks.map((m) => ({ label: m.option, value: m.option, box: ratio(m.box, size) }));
      if (options.length === 0) continue;
      const entry = entries.find((e) => e.kind === "field" && e.fieldKey === key);
      const v = entry ? parseFieldValue(entry.value) : null;
      out.push({ ...base, dest: "form", input: { kind: "choice", multi: false, options }, value: Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [], ...(entry ? { entryId: entry.id } : {}) });
      continue;
    }
    // 1 つの書く所に 2 つの欄（かかりつけ医・薬局と医薬品情報）は、両方の元を 1 つの窓に
    const shape = keys.length > 1 ? "window" : marks.length > 0 ? "choice" : one ? "text" : "window";
    const raw = keys.length > 1 ? keys.flatMap((k) => MATSUYAMA_INPUTS[k] ?? []) : MATSUYAMA_INPUTS[key];
    const slot =
      shape === "window"
        ? (() => {
            const inputs = resolveInputs(rows, raw);
            return inputs.length > 0
              ? ({ ...base, dest: "ledger", input: { kind: "window" }, value: "", target: { key, label: base.label, inputs } } satisfies PaperSlot)
              : null;
          })()
        : ledgerSlot(base, rows, raw, {
            shape,
            options: marks.map((m) => m.option),
            optionBoxes: marks.map((m) => ratio(m.box, size)),
            multiline: fieldDef?.shape === "lines",
            tel: false,
          });
    if (!slot || (cell && cell.kind === "withheld")) continue;
    const asks = asksOf(raw, queue, rows);
    out.push(asks.length > 0 ? { ...slot, asks } : slot);
  }
  return out;
}

// ---------- 紙から質問 ----------

/**
 * 紙から聞く問い（T135）。問いの列（lib/intake/ask.ts の questionQueue。本人のページの「問い 残り N 問」と同じ物）のうち、
 * この紙の台帳に無い欄（T133 の黄の塗りの ask）で台帳に項目のある欄の元に当たる物だけ（列の順のまま）。文で答えて AI が分ける問い（free）は紙では聞かない
 */
export function paperQuestions(queue: readonly Question[], slots: readonly PaperSlot[]): Question[] {
  // 台帳に無い（T133 の ask）欄だけ。置けなかった欄（fix）は台帳に値があるので聞かない（その場で、この様式の手入れとして入れる）
  const keys = new Set(slots.filter((s) => s.gap === "ask" && s.dest === "ledger").flatMap((s) => s.asks ?? []));
  return queue.filter((q) => keys.has(q.key) && q.answer.kind !== "free");
}
