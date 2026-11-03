// 全画面の地図（T46）のピンのまとめ。引いて名前の印が重なるときは、近いピンを 1 つにまとめて数で出す。
// まとめの顔は描く順（MapPin.layer）が一番後ろの人 = 発災時は連絡の順が先の人。顔の印は顔の人の状態と姓のまま
// （まとめた全員の色を混ぜた色は作らない）で、そこに「他 N 人」を添える。押すとまとめた人が入るまで拡大する。

/** 枠の中に置いたピン（px）。ピンは点が (x, y) で、名前の印はその上に横幅 w で出る */
export type PlacedPin = { id: string; x: number; y: number; layer: number; w: number };

/** まとめ 1 つ。ids は顔（head）が先で、残りは描く順の逆（連絡の順） */
export type PinGroup = { head: string; ids: string[]; x: number; y: number; layer: number };

/** まとめの「他 N 人」の印の横幅の見積もり（px） */
export const COUNT_W = 44;

/** 名前の印の高さ（px。印 16px と点の 2px の間の余白）。縦にこれより近いと重なる */
export const LABEL_H = 18;

/**
 * 名前の印の横幅の見積もり（px）。11px の太字で 1 字 11px、印の左右の余白 4px ずつ。
 * 状態の言葉（至急）があれば別の塗りの印なので、その分の余白も足す
 */
export function labelWidth(pin: { label: string; state: string | null }): number {
  const chars = pin.label.length + (pin.state?.length ?? 0);
  return chars * 11 + (pin.state ? 16 : 8);
}

/** 2 つの名前の印が重なるか（点の位置と横幅から。間に 2px の隙間を求める） */
export function overlaps(a: PlacedPin, b: PlacedPin): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 2 && Math.abs(a.y - b.y) < LABEL_H + 2;
}

/**
 * 重なるピンをまとめる。描く順が後ろの人（連絡の順が先）から順に顔にし、顔の印と重なる人をその顔にまとめる。
 * まとめの位置は顔の人の位置（至急の人の位置をずらさない）。返す並びは描く順（後ろほど上に重なる）
 */
export function groupPins(pins: ReadonlyArray<PlacedPin>): PinGroup[] {
  const order = [...pins].sort((a, b) => b.layer - a.layer);
  const groups: { head: PlacedPin; ids: string[] }[] = [];
  for (const p of order) {
    const g = groups.find((x) => overlaps(x.head, p));
    if (g) g.ids.push(p.id);
    else groups.push({ head: p, ids: [p.id] });
  }
  // まとめると「他 N 人」の分だけ印が広がるので、広がった印どうしが重なればもう一度まとめる（顔は描く順が後ろの方）
  const wide = (g: { head: PlacedPin; ids: string[] }): PlacedPin =>
    g.ids.length > 1 ? { ...g.head, w: g.head.w + COUNT_W } : g.head;
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
