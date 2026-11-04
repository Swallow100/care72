// 決まった種から同じ並びを出す乱数（mulberry32）。地図の雨の絵（lib/map/drill-rain.ts の縁と小さな雨）が使う。
// 描くたびに変わるとサーバーと手元の描画が食い違うので、Math.random は使わない。

export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
