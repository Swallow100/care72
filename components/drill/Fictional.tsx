// 訓練の人の「架空」の印と、画面の上の 1 行（T48、アドバイザーの返事）。訓練に出る人（種の 10 人）は作った例で、
// 本人役・家族役は AI（Haiku）が演じる。実在の利用者の記録は使っていない（lib/drill/persona.ts の頭の注）。
// 印は色を持たない地の印（AI の印と同じ形）。人の名前が出る所（左の表・対応・状況・着信・吹き出し）の名前のそばに付ける。
// デモ以外の事業所（T70）は本人役を利用者の台帳から作るので、印は「本人役」（AI が演じる訓練の本人役。lib/drill/fiction.ts）

import type { FictionKind } from "@/lib/drill/fiction";
import { fictionLabels } from "@/lib/drill/labels";

/** 名前のそばの印「架空」（デモ以外は「本人役」）。読み上げと title は「AI が演じる架空の人」（「AI が演じる訓練の本人役」） */
export function FictionalMark({ kind = "fictional" }: { kind?: FictionKind }) {
  const l = fictionLabels(kind);
  return (
    <span
      className="ml-1 inline-block rounded bg-base px-0.5 align-baseline text-[10px] leading-tight font-bold text-ink"
      title={l.title}
      aria-label={l.title}
      data-fictional={kind}
    >
      {l.mark}
    </span>
  );
}

/** 画面の上の 1 行「訓練の人は AI が演じる架空の人」（デモ以外は「訓練の本人・家族の言葉は AI が演じる本人役」） */
export function FictionalNote({ kind = "fictional" }: { kind?: FictionKind }) {
  const l = fictionLabels(kind);
  return (
    <p className="text-sm" data-fictional-note={kind}>
      <span className="mr-1 rounded bg-panel px-1 py-px text-xs font-bold">{l.mark}</span>
      {l.note}
    </p>
  );
}
