// 開始の時に読んだ公的なデータ（lib/drill/real-geo.ts）を地理に足す所（T170）。ブラウザからも読まれうる（area.ts）ので fetch も仮名化も読まない。
// - 実の川の名前は地域の行に、町の真ん中から 2 km の中に注記のある川は「近くの川」に
// - 実の避難所（国土地理院の指定避難所データ）は町ごとに近い順に 2 つ、全部で 10 まで。読めなければ今の一般の言い方のまま。福祉避難所はいつも一般の言い方
// - 台帳の町名を含む名前は使わない（門が別名に置き換えて名前が合わなくなり、町と結び付くので）

import type { GeoPoint } from "../db/types.ts";
import type { Area, AreaShelter, AreaTown } from "./area.ts";

/** 読んだ物（drills.world の写し。開始の時に 1 回だけ読む。部屋には名前だけが届く） */
export type RealGeo = {
  /** 読んだ時刻（ISO） */
  at: string;
  /** 事業所の市（offices.city）。無ければ null */
  region: string | null;
  /** 川の注記（名前と位置） */
  rivers: ReadonlyArray<{ name: string; at: GeoPoint }>;
  /** 指定避難所（一般。福祉避難所は読まない） */
  shelters: ReadonlyArray<{ name: string; at: GeoPoint }>;
};

/** 町ごとの実の避難所の数と、全部の上限 */
export const SHELTERS_PER_TOWN = 2;
export const SHELTERS_MAX = 10;
/** 「近くの川」にする注記までの長さ（km） */
export const RIVER_NEAR_KM = 2;

function km(a: GeoPoint, b: GeoPoint): number {
  const x = (b.lng - a.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  const y = (b.lat - a.lat) * 111.32;
  return Math.hypot(x, y);
}

/** 名前に台帳の町名（町・台を外した頭も）が入るか */
function hasOwnTown(name: string, own: ReadonlyArray<string>): boolean {
  return own.some((t) => {
    const stem = t.replace(/(町|台|村)$/u, "");
    return name.includes(t) || (stem.length >= 2 && name.includes(stem));
  });
}

export function applyRealGeo(area: Area, geo: RealGeo | null | undefined, own: ReadonlyArray<string>): Area {
  if (!geo) return area;
  const placed = area.towns.filter((t): t is AreaTown & { at: GeoPoint } => !!t.at);
  const nearest = (at: GeoPoint) => {
    let best: (AreaTown & { at: GeoPoint }) | null = null;
    let bestKm = Number.POSITIVE_INFINITY;
    for (const t of placed) {
      const d = km(at, t.at);
      if (d < bestKm) {
        best = t;
        bestKm = d;
      }
    }
    return best ? { town: best, km: bestKm } : null;
  };

  // 実の避難所を近い町に。町ごとに近い順に SHELTERS_PER_TOWN まで
  const real = geo.shelters
    .filter((s) => !hasOwnTown(s.name, own))
    .flatMap((s) => {
      const n = nearest(s.at);
      return n ? [{ ...s, town: n.town.town, km: n.km }] : [];
    })
    .sort((a, b) => a.km - b.km || a.name.localeCompare(b.name, "ja"));
  const taken = new Map<string, number>();
  const usable: AreaShelter[] = [];
  for (const s of real) {
    const n = taken.get(s.town) ?? 0;
    if (n >= SHELTERS_PER_TOWN || usable.length >= SHELTERS_MAX || usable.some((u) => u.name === s.name)) continue;
    taken.set(s.town, n + 1);
    usable.push({ id: `real-${usable.length + 1}`, name: s.name, town: s.town, welfare: false, at: s.at });
  }
  const shelters = usable.length > 0 ? [...usable, ...area.shelters.filter((s) => s.welfare)] : area.shelters;

  // 実の川。デモの地形は確かめて書いた物なので足さない
  const rivers = area.byPin ? area.rivers : [...new Set(geo.rivers.map((r) => r.name))].filter((n) => !hasOwnTown(n, own));
  const towns = area.byPin
    ? area.towns
    : area.towns.map((t) => {
        if (!t.at) return t;
        const at = t.at;
        const near = [...new Set(geo.rivers.filter((r) => km(at, r.at) <= RIVER_NEAR_KM && rivers.includes(r.name)).map((r) => r.name))];
        return near.length > 0 ? { ...t, terrain: `${t.terrain}。近くの川 ${near.join("・")}` } : t;
      });

  return {
    ...area,
    ...(geo.region && !area.region ? { region: geo.region } : {}),
    rivers,
    towns,
    shelters,
    ...(usable.length > 0 ? { realShelters: true as const } : {}),
  };
}
