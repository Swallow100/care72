// 確認用の事業所（T144、lib/auth/demo.ts の CHECK_OFFICE_ID）の種。デモ事業所の種を写す仕組みだけを持ち、中身は持たない。
// 10 人の中身は seed/people.ts（SEED_PEOPLE のデモ事業所の人）が正で、ここはそれを id だけ替えて写す。種の 10 人の台帳を直せば、
// 確認用の事業所の 10 人も同じに直る（次の戻しから）。
//
// id の替え方: デモ事業所の種の id（人・連絡先・時計・事業所・ケアマネ 2 人）に頭 chk- を付ける（checkSeedId）。行の中の値と
// 台帳などの JSON の中の値は、この表にある id とちょうど同じ文字だけを替える（名前や町名は替わらない）。表に無い行の id（経過・事業所の経過）も
// 頭を付けて重ならないようにする。録音の R2 の鍵は替えない（確認用の山田の赤も、作者が置いた種の同じ録音を指す。lib/list/recording.ts は
// 信号の本人の壁だけを見て鍵を読む）。
//
// ここは D1・R2・node のファイルに触らない（手元の seed/sql.ts と Worker の lib/seed/reset.ts の両方が読む）。

import {
  CHECK_OFFICE_ID,
  checkSeedId,
  DEMO_CARE_MANAGER_ID,
  DEMO_OFFICE_ID,
  DEMO_SECOND_CARE_MANAGER_ID,
} from "../auth/demo.ts";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";

/** デモ事業所の種の人（写す元） */
export function demoSeedPeople(): SeedPerson[] {
  return SEED_PEOPLE.filter((p) => p.person.office_id === DEMO_OFFICE_ID);
}

/** デモ事業所の種の id → 確認用の事業所の id（人・連絡先・時計・事業所・ケアマネ 2 人）。extra は呼ぶ側の決まった id（山田の赤の信号など） */
export function checkIdMap(extra: Readonly<Record<string, string>> = {}): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  const put = (id: string) => m.set(id, checkSeedId(id));
  m.set(DEMO_OFFICE_ID, CHECK_OFFICE_ID);
  put(DEMO_CARE_MANAGER_ID);
  put(DEMO_SECOND_CARE_MANAGER_ID);
  for (const p of demoSeedPeople()) {
    put(p.person.id);
    for (const c of p.contacts) put(c.id);
    for (const k of p.clocks) put(k.id);
  }
  for (const [from, to] of Object.entries(extra)) m.set(from, to);
  return m;
}

/** 値を深く写す: 文字は表にちょうど同じ物があれば替える。配列・物は中を写す（物の鍵は替えない） */
export function remapValue<T>(v: T, map: ReadonlyMap<string, string>): T {
  if (typeof v === "string") return (map.get(v) ?? v) as T;
  if (Array.isArray(v)) return v.map((x) => remapValue(x, map)) as T;
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, remapValue(x, map)])) as T;
  }
  return v;
}

/** JSON の文字（台帳・payload・町の一覧）なら中を写して文字に戻す。JSON でなければ null */
function remapJson(text: string, map: ReadonlyMap<string, string>): string | null {
  const t = text.trimStart();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    return JSON.stringify(remapValue(JSON.parse(text) as unknown, map));
  } catch {
    return null;
  }
}

type Cell = string | number | boolean | null | undefined;

/**
 * 表の 1 行を写す。id の列は表にあればその id、無ければ頭を付ける（経過などの決まった id が重ならないように）。
 * ほかの文字の列は、JSON なら中を、そうでなければ値そのものを表で替える
 */
export function remapRow<R extends Record<string, Cell>>(row: R, map: ReadonlyMap<string, string>): R {
  const out: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== "string") {
      out[k] = v;
    } else if (k === "id") {
      out[k] = map.get(v) ?? checkSeedId(v);
    } else {
      out[k] = remapJson(v, map) ?? map.get(v) ?? v;
    }
  }
  return out as R;
}

/** 確認用の事業所の 10 人（SeedPerson の形。配役の確かめと、台帳から町を引く所に） */
export function checkSeedPeople(): SeedPerson[] {
  const map = checkIdMap();
  return demoSeedPeople().map((p) => remapValue(p, map));
}
