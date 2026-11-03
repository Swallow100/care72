// public/sw.js の <core> の間を lib/offline/sw-core.js から作る（docs/tasks/T71.md「importScripts は使わない」）。
// 写すのは tools/offline/build-sw.ts、同じであることを見るのは lib/offline/sw.test.ts。文字だけを扱う（ファイルは読まない）。

export const CORE_START = "// <core>";
export const CORE_END = "// </core>";

const lf = (s: string) => s.replace(/\r\n/g, "\n");

function between(src: string, what: string): { head: string; body: string; tail: string } {
  const s = lf(src);
  const i = s.indexOf(CORE_START);
  const j = s.indexOf(CORE_END);
  if (i < 0 || j < i) throw new Error(`${what} に ${CORE_START} と ${CORE_END} の印が無い`);
  return { head: s.slice(0, i + CORE_START.length), body: s.slice(i + CORE_START.length, j), tail: s.slice(j) };
}

/** sw-core.js の <core> の間から、行の頭の `export ` を外した物（sw.js は module でないので export を書けない） */
export function coreBlock(coreSrc: string): string {
  return between(coreSrc, "sw-core.js").body.replace(/^export /gm, "");
}

/** sw.js の <core> の間を sw-core.js の中身に替えた物。改行は LF */
export function embedCore(coreSrc: string, swSrc: string): string {
  const { head, tail } = between(swSrc, "sw.js");
  return head + coreBlock(coreSrc) + tail;
}
