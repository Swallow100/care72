// 訓練の人の「架空」の印と、画面の上の 1 行（T48、アドバイザーの返事）。訓練に出る人（種の 10 人）は作った例で、
// 本人役・家族役は AI（Haiku）が演じる。実在の利用者の記録は使っていない（lib/drill/persona.ts の頭の注）。
// 印は色を持たない地の印（AI の印と同じ形）。人の名前が出る所（左の表・対応・状況・着信・吹き出し）の名前のそばに付ける。

import { FICTION_LABELS } from "@/lib/drill/labels";

/** 名前のそばの印「架空」。読み上げと title は「AI が演じる架空の人」 */
export function FictionalMark() {
  return (
    <span
      className="ml-1 inline-block rounded bg-base px-0.5 align-baseline text-[10px] leading-tight font-bold text-ink"
      title={FICTION_LABELS.title}
      aria-label={FICTION_LABELS.title}
      data-fictional
    >
      {FICTION_LABELS.mark}
    </span>
  );
}

/** 画面の上の 1 行「訓練の人は AI が演じる架空の人」 */
export function FictionalNote() {
  return (
    <p className="text-sm" data-fictional-note>
      <span className="mr-1 rounded bg-panel px-1 py-px text-xs font-bold">{FICTION_LABELS.mark}</span>
      {FICTION_LABELS.note}
    </p>
  );
}
