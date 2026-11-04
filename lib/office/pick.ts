// Excel・Word の頁のうち、既定で送る頁（T119）。黒塗りの画面（components/person/RedactSheet.tsx）と評価の台（tools/eval/forms）が同じ決まりを使う。
// 送れるのは 3 頁まで（PDF と同じ上限）。4 頁以上あれば、記入例・記載例のシートを外して頭から 3 頁。全部が記入例なら頭から 3 頁。

import { PDF_PAGES_MAX } from "../intake/read-form.ts";

/** 既定で送らない頁の id */
export function defaultExcluded(pages: ReadonlyArray<{ id: string; example: boolean }>, max = PDF_PAGES_MAX): Set<string> {
  if (pages.length <= max) return new Set();
  const plain = pages.filter((p) => !p.example);
  const keep = new Set((plain.length > 0 ? plain : pages).slice(0, max).map((p) => p.id));
  return new Set(pages.filter((p) => !keep.has(p.id)).map((p) => p.id));
}
