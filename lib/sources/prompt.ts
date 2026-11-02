// Claude に根拠の一覧を渡す口。lib/claude/call.ts の askJson が sources を受けたときに system に足す。
// 根拠として書いてよいのは渡した id だけ。当てはまる物が無ければ「根拠なし」と書かせる（作った根拠を出させない）。
// 返事の形で縛るときは basisSchema を使う（構造化出力の enum で、一覧の外の id は返せない）。

import * as z from "zod";
import { assertSourceIds, sourceById, type SourceId } from "./index.ts";

/** 根拠が一覧に無いときの言葉 */
export const NO_BASIS = "根拠なし";

/** system に足す 1 ブロック。URL は渡さない（Claude は開かない）。並びは渡した順、重ねない */
export function sourcesSystem(ids: ReadonlyArray<string>): string {
  if (ids.length === 0) throw new Error("根拠の一覧が空。渡さないなら sources を付けない");
  assertSourceIds(ids);
  const unique = [...new Set(ids)];
  return [
    `根拠は次の一覧の id だけを使う。一覧に無い文書・数字・決まりを根拠にしない。当てはまる物が無ければ「${NO_BASIS}」と書く。`,
    "引くときは id を書き、本文を写さない。",
    "一覧（id: 発行元「題名」年。要旨）:",
    ...unique.map((id) => {
      const s = sourceById(id);
      return `- ${s.id}: ${s.publisher}「${s.title}」${s.year}。${s.summary}`;
    }),
  ].join("\n");
}

/** 返事の根拠の欄の形: 渡した id のどれかか「根拠なし」 */
export function basisSchema<const T extends SourceId>(ids: ReadonlyArray<T>) {
  if (ids.length === 0) throw new Error("根拠の一覧が空");
  assertSourceIds(ids);
  const values: [typeof NO_BASIS, ...T[]] = [NO_BASIS, ...new Set(ids)];
  return z.enum(values);
}
