// AI 入力の吹き出しの、保存した中身（T143）。前は保存したあとも「1 項目を見つけました（基本 1）」と数だけだった。
// 保存した変更を 1 件 1 行の「区分 欄 値」（「基本 床ずれに注意」「医療 既往 高血圧・心不全」）にし、SAVED_SHOWN 件まで並べて残りは「他 N 件」。
// 区分は本人のページの区分（lib/labels.ts の SECTION_LABELS）、値は入れる欄の差分と同じ言葉（lib/intake/changes.ts の changeText）。
// 特記・薬・連絡先は値の中に何の物かが入るので欄の名前を付けない。ブラウザ（components/person/Intake.tsx）が読むので D1 に触らない。

import { SECTION_LABELS } from "../labels.ts";
import { changeText, type IntakeChange } from "./changes.ts";
import { intakeField, type IntakeSection } from "./fields.ts";

/** 欄の区分（lib/intake/diff.ts の sectionOfKey と同じ当て方。ブラウザに diff.ts を持ち込まないよう、ここに小さく持つ） */
const PREFIX: Record<string, IntakeSection> = { medical: "medical", clocks: "medical", evacuation: "evacuation", people: "people", local: "people" };
const sectionOfKey = (key: string): IntakeSection => intakeField(key)?.section ?? PREFIX[key.split(".")[0]] ?? "basic";

/** 吹き出しに並べる件数（それより多ければ「他 N 件」） */
export const SAVED_SHOWN = 5;

function sectionOf(c: IntakeChange): IntakeSection {
  switch (c.t) {
    case "field":
      return sectionOfKey(c.key);
    case "pending":
      return sectionOfKey(c.field);
    case "medication":
    case "device":
    case "clock":
    case "clockCheck":
    case "clockSeen":
    case "clockAdd":
    case "clockStart":
      return "medical";
    case "hazard":
    case "evacMap":
      return "evacuation";
    case "contact":
      return c.value.kind === "self" ? "basic" : "people";
    default:
      return "basic";
  }
}

/** 値の前に付ける欄の名前（値だけで何の物か分からない物） */
function nameOf(c: IntakeChange): string | null {
  if (c.t === "field") return intakeField(c.key)?.label ?? null;
  if (c.t === "pending") return intakeField(c.field)?.label ?? null;
  if (c.t === "clock") return "時計";
  return null;
}

/** 保存した変更の 1 行（「医療 既往 高血圧・心不全」）。値の無い物は出さない */
export function savedLine(c: IntakeChange): string | null {
  const value = changeText(c).trim();
  if (value === "") return null;
  return [SECTION_LABELS[sectionOf(c)], nameOf(c), value].filter((x) => x).join(" ");
}

/** 吹き出しの行（SAVED_SHOWN 件まで）と、残りの件数 */
export function savedLines(changes: readonly IntakeChange[]): { lines: string[]; more: number } {
  const all = changes.map(savedLine).filter((x): x is string => x !== null);
  return { lines: all.slice(0, SAVED_SHOWN), more: Math.max(0, all.length - SAVED_SHOWN) };
}
