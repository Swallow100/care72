// 訓練の行の詳細の連絡先の行から選ぶ手（docs/tasks/T132.md）。連絡の区分の手（手の表 lib/drill/action-catalog.ts の group "contact"）のうち、
// その連絡先の区分を相手に取る手を手の表の順に見て、手の可否の決まり（lib/drill/action-terms.ts の結果）で押せる最初の手を選ぶ。
// 押せる手が無ければ最初の手と押せない理由（行は押せない）。連絡の手で相手に取れない区分（酸素業者・病院など）は null（文字のまま）。
// 決まりを選ばなかった訓練（terms が null）は全部押せる（対応の欄と同じ）。決まりの中身はここで変えない。色と連絡順には使わない。
// 本人の行は本人電話（相手は選ばない）、ほかは相手にその連絡先。

import type { ContactKind, DrillAction } from "../db/types.ts";
import { ACTION_CATALOG } from "./action-catalog.ts";
import type { ActionTerm } from "./action-terms.ts";

export type ContactAct = {
  kind: DrillAction;
  /** 対応の欄の相手（連絡先の id）。本人電話は null（本人を自動で選ぶ手） */
  target: string | null;
  /** 手の言葉（「連絡先電話」） */
  label: string;
  /** 押せない理由（2〜4 字）。押せれば null */
  block: string | null;
};

/** 連絡の手のうち、相手にその区分を取る手（手の表の順） */
function contactActions(kind: ContactKind) {
  // メッセージ（伝言。T125）は電話の行の手ではない（データの道。電話が押せない時に代わりにならない: 電波不通なら両方とも届かない）
  return ACTION_CATALOG.filter((r) => r.group === "contact" && r.needsPerson && r.targetKinds.includes(kind) && r.id !== "message");
}

/** 連絡先の行から選ぶ手。terms はその本人の手の可否（無ければ全部押せる） */
export function contactAct(
  c: { id: string; kind: ContactKind },
  terms: Readonly<Partial<Record<DrillAction, ActionTerm>>> | null,
): ContactAct | null {
  const rows = contactActions(c.kind);
  if (rows.length === 0) return null;
  const options = rows.map((r) => {
    const t = terms?.[r.id] ?? null;
    return {
      kind: r.id,
      target: r.id === "call_person" ? null : c.id,
      label: r.label,
      block: t ? (t.block ?? t.targets[c.kind] ?? null) : null,
    };
  });
  return options.find((o) => o.block === null) ?? options[0];
}
