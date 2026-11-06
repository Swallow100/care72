// 使う側の模擬の門（docs/tasks/T156.md）。
// - 開くのは手元だけ: base の host は localhost・127.0.0.1・[::1]。本番（care72.app）や他の host は引数で渡されても断る
// - 使う人の AI に渡す頁の文は、手元の種の架空の人だけ: 架空の形（090-0000-00NN）でない電話の形、種でない事業所の名前が
//   上の帯にあれば、その読みは AI に渡さず筋を止める（種の外の人の値が混ざった頁を Claude に送らない）

import type { Snapshot } from "./types.ts";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertLocalBase(base: string): URL {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error(`base が URL でない: ${base.slice(0, 40)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("base は http か https");
  if (!LOCAL_HOSTS.has(u.hostname)) throw new Error(`手元（localhost・127.0.0.1）のほかは開かない: ${u.hostname}`);
  return u;
}

/** 種の事業所の名前（seed/people.ts の SEED_OFFICES）と、新規事業所で作る試用事業所の印 */
export const SEED_OFFICE_NAMES: readonly string[] = ["デモ事業所", "デモ事業所（確認用）"];
const SANDBOX_MARK = "試用";

/** 電話の形（市外局番の形と携帯の形）。架空の形は 090-0000-00NN */
const PHONE = /(?<![\d-])0\d{1,4}-\d{1,4}-\d{3,4}(?![\d-])/g;
const FICTIONAL_PHONE = /^090-0000-00\d\d$/;

export type GateResult = { ok: true } | { ok: false; why: string };

export function screenGate(s: Pick<Snapshot, "header" | "text" | "items" | "headings" | "alerts">): GateResult {
  const all = [s.header, s.text, ...s.headings, ...s.alerts, ...s.items.map((i) => `${i.name} ${i.value ?? ""}`)].join("\n");
  for (const m of all.matchAll(PHONE)) {
    if (!FICTIONAL_PHONE.test(m[0])) return { ok: false, why: "架空の形でない電話" };
  }
  // 上の帯の事業所名（「〇〇事業所」）が種の物か試用事業所か
  const offices = s.header.match(/[^\s|｜・]*事業所[^\s|｜・]*/g) ?? [];
  for (const o of offices) {
    if (o === "事業所") continue; // 画面の切替の「事業所」
    if (SEED_OFFICE_NAMES.includes(o) || o.includes(SANDBOX_MARK)) continue;
    return { ok: false, why: "種でない事業所" };
  }
  return { ok: true };
}
