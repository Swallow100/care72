// 仮想モードの世界の出来事を、場所ごとにまとめる（T170）。訓練の画面の地図の印と「場所別」の一覧が読む。Claude を呼ばない。D1 を読まない。
//
// - 元は見ている刻みまでの出来事（ticks の incidents）。最後の状態だけ残す（通行可・断水の解消・停電の復旧で消える。避難所は開設も残す）
// - 場所は地理の区画・実の橋と避難所。位置の無い物（施設）は一覧だけ
// - 区画に誰がいるかはコードが決める（lib/drill/area.ts の townOfLedger）。画面はケアマネの物なので氏名を出してよく、Claude には渡らない
// - 色と連絡順には使わない

import type { GeoPoint, Ledger } from "../db/types.ts";
import type { MapMark } from "../map/marks.ts";
import { areaTown, townOfLedger, type Area } from "./area.ts";
import type { Tick } from "./engine.ts";
import { PHONE_LABELS, SHELTER_LABELS } from "./labels.ts";

/** 場所ごとの今の出来事 1 つ */
export type WorldSlot = { key: string; place: string; at: GeoPoint | null; word: string; persons: string[]; hour: number };

/** 場所 1 つ（一覧の行）。words は今の出来事、persons はその場所に関わる人 */
export type WorldPlace = { place: string; at: GeoPoint | null; words: string[]; persons: string[]; hour: number };

/** 区画ごとの住む人（コードだけが決める。部屋に渡さない） */
export function residentsOf(area: Area, people: ReadonlyArray<{ id: string; ledger: Pick<Ledger, "basic"> }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of people) {
    const t = townOfLedger(p.ledger, area);
    if (t) (out[t] ??= []).push(p.id);
  }
  return out;
}

const FLOOD_WORD = "浸水";
const SLIDE_WORD = "土砂崩れ";
const OUTAGE_WORD = "停電";
const WATER_WORD = "断水";
const ROAD_WORD = "通行止";
const FACILITY_WORD = "休止";

/** 見ている刻みまでの出来事 → 今残っている出来事（場所ごと） */
export function worldSlots(ticks: ReadonlyArray<Pick<Tick, "incidents">>, area: Area, residents: Readonly<Record<string, string[]>>): WorldSlot[] {
  const slots = new Map<string, WorldSlot>();
  const townAt = (town: string) => areaTown(town, area)?.at ?? null;
  const set = (key: string, s: Omit<WorldSlot, "key">) => slots.set(key, { key, ...s });
  for (const t of ticks) {
    for (const e of t.incidents) {
      const c = e.change;
      const hour = e.at;
      switch (c.kind) {
        case "town_flood":
          set(`flood:${c.town}`, { place: c.town, at: townAt(c.town), word: c.depthM != null ? `${FLOOD_WORD} ${c.depthM} m` : FLOOD_WORD, persons: c.persons, hour });
          break;
        case "landslide":
          set(`slide:${c.town}`, { place: c.town, at: townAt(c.town), word: SLIDE_WORD, persons: c.persons, hour });
          break;
        case "outage":
          if (c.area.scope === "towns") {
            for (const place of c.area.places ?? c.area.towns) {
              const key = areaTown(place, area)?.town ?? place;
              set(`outage:${key}`, { place: key, at: townAt(key), word: OUTAGE_WORD, persons: residents[key] ?? [], hour });
            }
          }
          break;
        case "outage_restored":
          for (const k of [...slots.keys()]) if (k.startsWith("outage:")) slots.delete(k);
          break;
        case "town_water":
          for (const town of c.towns) {
            if (c.out) set(`water:${town}`, { place: town, at: townAt(town), word: WATER_WORD, persons: residents[town] ?? [], hour });
            else slots.delete(`water:${town}`);
          }
          break;
        case "town_line":
          for (const town of c.towns) set(`line:${town}`, { place: town, at: townAt(town), word: PHONE_LABELS.down, persons: residents[town] ?? [], hour });
          break;
        case "town_road": {
          const road = area.roads.find((r) => r.id === c.road);
          const at = road?.at ?? (road?.towns[0] ? townAt(road.towns[0]) : null);
          if (c.open) slots.delete(`road:${c.road}`);
          else set(`road:${c.road}`, { place: c.label, at, word: ROAD_WORD, persons: c.persons, hour });
          break;
        }
        case "town_facility":
          if (c.open) slots.delete(`facility:${c.facility}`);
          else set(`facility:${c.facility}`, { place: c.label, at: null, word: FACILITY_WORD, persons: c.persons, hour });
          break;
        case "shelter": {
          const s = area.shelters.find((x) => `sh-${x.id}` === c.id);
          set(`shelter:${c.id}`, { place: c.label, at: s?.at ?? (s ? townAt(s.town) : null), word: SHELTER_LABELS[c.state], persons: [], hour });
          break;
        }
        default:
          break;
      }
    }
  }
  return [...slots.values()];
}

/** 場所ごとにまとめる（一覧）。新しい出来事の場所が先 */
export function worldPlaces(slots: ReadonlyArray<WorldSlot>): WorldPlace[] {
  const by = new Map<string, WorldPlace>();
  for (const s of slots) {
    const p = by.get(s.place);
    if (p) {
      if (!p.words.includes(s.word)) p.words.push(s.word);
      for (const x of s.persons) if (!p.persons.includes(x)) p.persons.push(x);
      p.hour = Math.max(p.hour, s.hour);
    } else {
      by.set(s.place, { place: s.place, at: s.at, words: [s.word], persons: [...s.persons], hour: s.hour });
    }
  }
  return [...by.values()].sort((a, b) => b.hour - a.hour || a.place.localeCompare(b.place, "ja"));
}

/** 地図の印に出す出来事の数（小さな地図で長くしない） */
const MARK_WORDS = 2;

/** 地図の印（位置のある場所だけ）。label は全画面の言葉、short は小さな地図の言葉 */
export function worldMapMarks(places: ReadonlyArray<WorldPlace>): MapMark[] {
  return places.flatMap((p) => {
    if (!p.at) return [];
    const words = p.words.slice(0, MARK_WORDS).join("・");
    const rest = p.words.length - MARK_WORDS;
    const short = rest > 0 ? `${words} 他 ${rest}` : words;
    return [{ id: p.place, at: p.at, label: `${p.place} ${p.words.join("・")}`, short, title: `${p.place} ${p.words.join("・")}` }];
  });
}

/** 人ごとの地図のピンの言葉（その人の区画の最初の出来事）。無い人は入れない */
export function pinNotes(slots: ReadonlyArray<WorldSlot>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of [...slots].sort((a, b) => b.hour - a.hour)) {
    const word = s.word.split(" ")[0];
    for (const p of s.persons) out[p] ??= word;
  }
  return out;
}
