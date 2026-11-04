// 訓練の世界 → ルールの表の入力（T19）。lib/drill/director.ts の頭から分けた（T90 の準備）。director.ts は同じ名前を再び出す。
// 訓練の世界が台帳の時計の写しの頼り先の確認（depends_check）を書き換える所。ルールの表（lib/triage）の入力の形は変えない。

import type { CheckStatus, ClockCategory, DependsOn } from "../db/types.ts";
import type { WorldState } from "./scenarios.ts";

/** 世界の状態が書き換える時計の欄（台帳の時計の行と同じ名前） */
export type ClockForWorld = {
  person_id: string;
  category: ClockCategory;
  depends_on: DependsOn | null;
  depends_check: CheckStatus | null;
};

/** 頼り先ごとの時計の区分（頼り先が書かれていない時計にも当てる） */
const DEPENDS_CATEGORY: Readonly<Partial<Record<DependsOn, ClockCategory>>> = { dialysis_center: "dialysis" };

/**
 * 訓練の世界で、台帳の時計の頼り先を書き換えた写し（ルールの表に渡す前。台帳そのものは変えない）。
 * - 栄養剤の持ち出し忘れの印: その人の栄養剤（経管栄養）の時計は配達に頼り、未確認（避難先で栄養剤を届けてもらう必要がある）
 * - 頼り先のある施設の休止（透析施設の浸水）: その人のその頼り先の時計は未確認に戻る（次の受け入れ先を確かめる）
 * - 本人ごとの確認の上書き（world.checks、T90 の準備。手の振替・手配〔T91〕や出来事〔T92〕が書く）: 上の 2 つより後に当てる（両方あればこちら）。
 *   頼り先が書かれていない時計は、施設の休止と同じく頼り先の区分（透析先 → 透析）で当てる
 * 色はルールの表の「外の物に頼る時計の確認が未確認」の行で決まる（案 1）。監督は色を決めない
 */
export function drillClocks<T extends ClockForWorld>(clocks: ReadonlyArray<T>, world: WorldState): T[] {
  const closed = world.facilities.filter((f) => !f.open && f.person && f.depends);
  return clocks.map((k) => withCheck(byWorld(k, world, closed), world));
}

/** 印と施設の休止で書き換える（T19 からの道） */
function byWorld<T extends ClockForWorld>(k: T, world: WorldState, closed: WorldState["facilities"]): T {
  if (k.category === "tube_feeding" && world.marks[k.person_id]?.supplyLeft !== undefined) {
    return { ...k, depends_on: "delivery", depends_check: "unconfirmed" };
  }
  const hit = closed.find(
    (f) => f.person === k.person_id && (k.depends_on === f.depends || (k.depends_on === null && DEPENDS_CATEGORY[f.depends!] === k.category)),
  );
  return hit ? { ...k, depends_on: hit.depends, depends_check: "unconfirmed" } : k;
}

/** 本人ごとの確認の上書き（world.checks）。無ければ同じ物を返す */
function withCheck<T extends ClockForWorld>(k: T, world: WorldState): T {
  const own = world.checks?.[k.person_id];
  if (!own) return k;
  const depends =
    k.depends_on ?? ((Object.keys(own) as DependsOn[]).find((d) => DEPENDS_CATEGORY[d] === k.category) ?? null);
  const check = depends ? own[depends] : undefined;
  return depends && check ? { ...k, depends_on: depends, depends_check: check } : k;
}
