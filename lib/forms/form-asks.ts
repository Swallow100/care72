// 計画書の未確認の欄のうち、問いで埋められる物（T117）。本人のページの「問い 残り N 問」と同じ問いの列（lib/intake/ask.ts の
// questionQueue）を、欄の元の表（lib/forms/form-inputs.ts）に当てる。紙の帯・書類の一覧・テストが同じ物を使う（同じ元から数える）。
// 定型の計算で、Claude は呼ばない。

import { questionQueue } from "../intake/ask.ts";
import type { PersonPageRows } from "../person.ts";
import { matsuyamaAskable } from "./form-inputs.ts";
import type { MatsuyamaKey } from "./matsuyama.ts";

export function matsuyamaAskableOf(rows: PersonPageRows): Set<MatsuyamaKey> {
  return matsuyamaAskable(
    questionQueue(rows).map((q) => q.key),
    rows.contacts,
  );
}
