// 避難先の番号を書類の手がかりで決める（T141）。評価の 2〜5 回目で、写真・手書きの読み取りが、番号の無い避難先（病院）を
// 「避難先2」の欄（と 2 の手段）に入れ続けた（欄の説明が種類〔市の指定避難所・親族の家〕で 1 と 2 を分けていたため）。
//
// - 読み取りの指示（lib/intake/fields.ts の欄の説明と lib/intake/extract.ts の決まり）は番号の手がかりで決めるように直した
// - それでも 2 だけが返り、台帳の避難先1 が空で、入れた文に 2 番目の手がかりが無い時は、コードが避難先1 に直す。写真・PDF は文が無いので、
//   2 だけが返れば直す（返事の中に 2 番目の手がかりの言葉があれば直さない）。2 の手段は 1 の手段の欄が別にあるので落とす（作られた値）
// - Claude を呼ばない。直すのは返事の欄の名前だけ（値は変えない）

import type { Ledger } from "../db/types.ts";
import type { ExtractOutput } from "./schema.ts";

/** 2 番目の避難先の手がかり（第二・2 次・②・ほかに・次に・事前・予備） */
export const SECOND_CUE = /第\s*(?:2|二|２)|(?:2|二|２)\s*次|②|(?:2|二|２)\s*番目|ほかに|他に|次に|もう\s*(?:1|一)\s*つ|事前|予備/;
/** 手がかりが避難先の話か（前後 12 字に避難の言葉） */
const SECOND_DEST = new RegExp(`(?:${SECOND_CUE.source})[^。\\n]{0,12}(?:避難|行き先|逃げ|身を寄せ)|(?:避難|行き先)[^。\\n]{0,12}(?:${SECOND_CUE.source})`);

/** 文に 2 番目の避難先の手がかりがあるか */
export function hasSecondCue(text: string): boolean {
  return SECOND_DEST.test(text.normalize("NFKC"));
}

/**
 * 返事の避難先の番号を直す（T141）。避難先2 だけがあり、避難先1 が無く、台帳の避難先1 が空で、2 番目の手がかりが無ければ、
 * 避難先2 → 避難先1（時間も）。2 の手段は落とす。text は入れた文（写真・PDF は無い）
 */
export function orderDestinations(out: ExtractOutput, ledger: Pick<Ledger, "evacuation">, text?: string | null): ExtractOutput {
  const has = (f: string) => out.items.some((i) => i.field === f && i.value.trim() !== "");
  if (!has("evacuation.destination2") || has("evacuation.destination1")) return out;
  if ((ledger.evacuation?.destination1 ?? "").trim() !== "") return out;
  if (text && hasSecondCue(text)) return out;
  if (out.notes.some(hasSecondCue)) return out;
  const items = out.items.flatMap((i) => {
    if (i.field === "evacuation.destination2") return [{ ...i, field: "evacuation.destination1" as const }];
    if (i.field === "evacuation.destination2Minutes") return has("evacuation.destination1Minutes") ? [] : [{ ...i, field: "evacuation.destination1Minutes" as const }];
    if (i.field === "evacuation.destination2Means") return [];
    return [i];
  });
  return { ...out, items };
}
