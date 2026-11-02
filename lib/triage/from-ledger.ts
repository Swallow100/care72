// 台帳（本人の行・連絡先・時計）からルールの表の入力を作る。
// 人が付ける欄（本人の報告を当てにしない印・時計の頼り先の確認）は表の列から読む。台帳の JSON からは読まない。

import type { ClockRow, ContactRow, Ledger, PersonRow, RecordingClass, SignalSource } from "../db/types.ts";
import type { TriagePerson, TriageSignal } from "./index.ts";

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

/** 本人からの信号か（訓練の本人役を含む）。lib/triage の読み方と同じ */
const fromSelf = (source: SignalSource) => source === "self" || source === "agent";

type Carry = { injured: boolean | null; canMove: boolean | null; classes: RecordingClass[] };

/**
 * 同じ出来事の赤を重ねて読む（T10 の問い、docs/PROGRESS.md の T13 の案）。ルールの表（lib/triage）は信号の
 * いちばん新しい物を読むので、けがの赤のあとに答えなしの赤（20 秒で音声に替わった回など）が来ると「けが」が落ちる。
 * ここでは表に渡す前に、赤の信号の答えていない問いと録音の分類を、同じ出どころの前の赤から引き継ぐ:
 * - けが・動けるかは、答えていない（null）ときだけ前の赤の答え（いちばん新しい答え）を使う。答えがあればその答え
 * - 録音の分類は前の赤の分類と合わせる（重ねない）
 * - 緑が来たら出来事は終わり（引き継がない）。本人の報告を当てにしない印の人の本人の緑は、表が使わないので終わりにしない
 * - 引き継ぐのは同じ出どころ（本人・家族…）の赤からだけ（理由の「本人が」「家族が」を取り違えない）
 * 色・並び・理由の言葉は表のまま。信号の数と順は変えず、赤の中身を埋めるだけ（緑・未知はそのまま）
 */
export function foldSignals(
  person: Pick<TriagePerson, "selfReportUnreliable">,
  signals: ReadonlyArray<TriageSignal>,
): TriageSignal[] {
  const order = signals
    .map((sig, i) => ({ sig, i, t: Date.parse(sig.at) }))
    .sort((a, b) => (Number.isNaN(a.t) || Number.isNaN(b.t) ? 0 : a.t - b.t) || a.i - b.i);
  const out: TriageSignal[] = [...signals];
  let carry = new Map<SignalSource, Carry>();
  for (const { sig, i } of order) {
    if (sig.color === "green") {
      if (!(person.selfReportUnreliable && fromSelf(sig.source))) carry = new Map();
      continue;
    }
    if (sig.color !== "red") continue;
    const prev = carry.get(sig.source);
    const injured = sig.injured ?? prev?.injured ?? null;
    const canMove = sig.canMove ?? prev?.canMove ?? null;
    const classes = [...new Set([...(prev?.classes ?? []), ...(sig.classes ?? [])])];
    carry.set(sig.source, { injured, canMove, classes });
    if (!prev) continue;
    out[i] = { ...sig, injured, canMove, ...(classes.length > 0 ? { classes } : {}) };
  }
  return out;
}
