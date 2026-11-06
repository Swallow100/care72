// 全画面の地図（T46）のピンのまとめ。引いて名前の印が重なるときは、近いピンを 1 つにまとめて数で出す。
// まとめの顔は描く順（MapPin.layer）が一番後ろの人 = 発災時は連絡の順が先の人。顔の印は顔の人の状態と姓のまま
// （まとめた全員の色を混ぜた色は作らない）で、そこに「他 N 人」と、発災時は中の人の状態ごとの数（要確認 1・無事 2。T40）を添える。押すとまとめた人が入るまで拡大する。

import { COLOR_LABELS } from "../labels.ts";
import type { StateTone } from "../person.ts";

/** 枠の中に置いたピン（px）。ピンは点が (x, y) で、名前の印はその上に横幅 w・高さ h（既定 LABEL_H）で出る */
export type PlacedPin = { id: string; x: number; y: number; layer: number; w: number; h?: number };

/** まとめ 1 つ。ids は顔（head）が先で、残りは描く順の逆（連絡の順） */
export type PinGroup = { head: string; ids: string[]; x: number; y: number; layer: number };

/** まとめの「他 N 人」の印の横幅の見積もり（px） */
export const COUNT_W = 44;

/** 名前の印の高さ（px。印 16px と点の 2px の間の余白）。縦にこれより近いと重なる */
export const LABEL_H = 18;

/**
 * 名前の印の大きさ（T169）。淡色地図は寄るほど地図の字が大きくなり（ズーム 18 で町名が 20px ほど）、11px のままの名前は地図の字に負けて
 * 見えなかった。寄るほど字を大きく、縁を濃くする。赤にしない（赤は至急の意味。平時の名前は本文色の字に白の面）。発災時の状態の塗りはそのまま
 */
export type PinSize = { font: number; h: number; strong: boolean };
export function pinSize(tz: number): PinSize {
  if (tz >= 17) return { font: 16, h: 26, strong: true };
  if (tz >= 15) return { font: 14, h: 22, strong: true };
  return { font: 11, h: LABEL_H, strong: false };
}

/**
 * 名前の印の横幅の見積もり（px）。11px の太字で 1 字 11px、印の左右の余白 4px ずつ。
 * 状態の言葉（至急）があれば別の塗りの印なので、その分の余白も足す
 */
export function labelWidth(pin: { label: string; state: string | null }, font = 11): number {
  const chars = pin.label.length + (pin.state?.length ?? 0);
  return chars * font + (pin.state ? 16 : 8);
}

/** 2 つの名前の印が重なるか（点の位置と横幅から。間に 2px の隙間を求める） */
export function overlaps(a: PlacedPin, b: PlacedPin): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 2 && Math.abs(a.y - b.y) < Math.max(a.h ?? LABEL_H, b.h ?? LABEL_H) + 2;
}

/** 状態の並び（至急・要確認・不明・無事） */
export const STATE_ORDER: readonly StateTone[] = ["urgent", "check", "unknown", "ok"];

/** 状態の言葉（lib/triage の色の言葉と同じ） */
const STATE_WORDS: Record<StateTone, string> = {
  urgent: COLOR_LABELS.red,
  check: COLOR_LABELS.yellow,
  unknown: COLOR_LABELS.gray,
  ok: COLOR_LABELS.green,
};

export type ToneCount = { tone: StateTone; count: number };

/**
 * まとめの中の、顔の人を除いた人の状態ごとの数（発災時。T40、T46 の問い 2 の答え）。
 * 顔の人の状態は顔の印に出ているので数えない。並びは STATE_ORDER、0 の状態は出さない。平時（色なし）は空
 */
export function memberStates(members: ReadonlyArray<{ tone: StateTone | null }>): ToneCount[] {
  const rest = members.slice(1);
  return STATE_ORDER.map((tone) => ({ tone, count: rest.filter((m) => m.tone === tone).length })).filter((c) => c.count > 0);
}

/** 状態の数の印の横幅の見積もり（px）。1 つは 11px の字・7px の数字・左右 4px の余白・間の 2px */
export function statesWidth(states: ReadonlyArray<ToneCount>, words: Partial<Record<StateTone, string>> = STATE_WORDS): number {
  return states.reduce((s, c) => s + (words[c.tone] ?? STATE_WORDS[c.tone]).length * 11 + String(c.count).length * 7 + 4 * 2 + 2, 0);
}

/**
 * 重なるピンをまとめる。描く順が後ろの人（連絡の順が先）から順に顔にし、顔の印と重なる人をその顔にまとめる。
 * まとめの位置は顔の人の位置（至急の人の位置をずらさない）。返す並びは描く順（後ろほど上に重なる）。
 * extra はまとめたときに印が広がる分（既定は「他 N 人」の分。発災時は状態の数の印の分も足して渡す）
 */
export function groupPins(pins: ReadonlyArray<PlacedPin>, extra: (ids: ReadonlyArray<string>) => number = () => COUNT_W): PinGroup[] {
  const order = [...pins].sort((a, b) => b.layer - a.layer);
  const groups: { head: PlacedPin; ids: string[] }[] = [];
  for (const p of order) {
    const g = groups.find((x) => overlaps(x.head, p));
    if (g) g.ids.push(p.id);
    else groups.push({ head: p, ids: [p.id] });
  }
  // まとめると「他 N 人」の分だけ印が広がるので、広がった印どうしが重なればもう一度まとめる（顔は描く順が後ろの方）
  const wide = (g: { head: PlacedPin; ids: string[] }): PlacedPin =>
    g.ids.length > 1 ? { ...g.head, w: g.head.w + extra(g.ids) } : g.head;
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (overlaps(wide(groups[i]), wide(groups[j]))) {
          groups[i].ids.push(...groups[j].ids);
          groups.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  const layerOf = new Map(pins.map((p) => [p.id, p.layer]));
  return groups
    .map((g) => ({
      head: g.head.id,
      ids: g.ids.sort((a, b) => (layerOf.get(b) ?? 0) - (layerOf.get(a) ?? 0)),
      x: g.head.x,
      y: g.head.y,
      layer: g.head.layer,
    }))
    .sort((a, b) => a.layer - b.layer);
}
