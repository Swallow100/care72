// 評価の台（docs/tasks/T108.md）の乱数。種（文字）から決まる数の並び。台の選び方と偽の client の返事は全部ここから引く
// （同じ種なら同じ回を作り直せる。本物の Claude の返事は同じにならない）。

/** 文字の種 → 32 bit（FNV-1a） */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (const ch of seed) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export type Rng = {
  /** 0 以上 1 未満 */
  next(): number;
  /** lo 以上 hi 以下の整数 */
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(xs: ReadonlyArray<T>): T;
  /** 重み付きで 1 つ（重みが全部 0 なら先頭） */
  weighted<T>(xs: ReadonlyArray<readonly [T, number]>): T;
  shuffle<T>(xs: ReadonlyArray<T>): T[];
  /** 同じ種から枝分かれした別の並び（名前ごとに決まる） */
  fork(name: string): Rng;
};

/** mulberry32。種の文字から作る */
export function rngOf(seed: string): Rng {
  let a = hashSeed(seed);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (xs) => xs[Math.floor(next() * xs.length)],
    weighted: (xs) => {
      const total = xs.reduce((s, [, w]) => s + Math.max(0, w), 0);
      if (total <= 0) return xs[0][0];
      let r = next() * total;
      for (const [v, w] of xs) {
        r -= Math.max(0, w);
        if (r < 0) return v;
      }
      return xs[xs.length - 1][0];
    },
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    fork: (name) => rngOf(`${seed}/${name}`),
  };
  return rng;
}

/** 新しい種（回すたびに変える。記録して --seed で作り直す） */
export function freshSeed(): string {
  return crypto.randomUUID().slice(0, 8);
}
