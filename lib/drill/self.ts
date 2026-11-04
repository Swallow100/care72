// 訓練する人（ケアマネ自身）の住む所と身の回り（T104）。Claude を呼ばない。
//
// - 住む所は開始の前に地区（事業所の地理の町）を選ぶか、既定の「事業所の近く」。地図の点は持たない（町に境の形が無く、点から地区に写せない）
// - 持つのはサーバーの中だけ（DrillOptions.home に町名）。Claude（監督）に渡すのは地区の別名と地形の一言だけ（homeWords）。
//   町名・位置は渡さない。地区が今の参加者の地理に無ければ「担当の地区の外」とだけ書く
// - 自分の出来事（出来事の表の self_*）は連続の時計の大雨想定・地震想定の監督だけが差し込む（10 分版・仮想は差し込まない）

import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import type { Ledger } from "../db/types.ts";
import { AREA_TOWNS, areaTown, NO_TOWN, type Area } from "./area.ts";
import type { SelfFacts } from "./event-catalog.ts";

/** 監督に渡す自分の事（DirectorInput.self）。home は住む所の町名、null は事業所の近く */
export type SelfInput = { home: string | null };

/** 町名の長さの上限（字。開始の選択の検査） */
export const HOME_TOWN_MAX = 40;

/** 開始の画面で選べる地区（町名）。デモ事業所は架空の街の町、ほかの事業所は担当一覧の人の台帳の町名（よみの順でなく字の順） */
export function homeTowns(officeId: string, ledgers: ReadonlyArray<Pick<Ledger, "basic">>): string[] {
  if (officeId === DEMO_OFFICE_ID) return AREA_TOWNS.map((t) => t.town);
  const towns = new Set(ledgers.map((l) => l.basic.address?.town?.trim()).filter((t): t is string => !!t && t !== NO_TOWN));
  return [...towns].sort((a, b) => a.localeCompare(b, "ja"));
}

/** 住む所の地理（自分の出来事を決める事実）。事業所の近く・地理に無い町は null（地区の停電に入らない） */
export function homeFacts(self: SelfInput, area: Area): SelfFacts["home"] {
  const t = self.home ? areaTown(self.home, area) : null;
  return t ? { floodM: t.floodM, landslide: t.landslide } : null;
}

/** 監督に渡す住む所の言い方（別名と地形の一言だけ。町名は書かない） */
export function homeWords(self: SelfInput, area: Area): string {
  if (!self.home) return "事業所の近く";
  const t = areaTown(self.home, area);
  return t ? `${t.alias}（${t.terrain}）` : "担当の地区の外";
}
