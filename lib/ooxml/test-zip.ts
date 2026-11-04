// テストだけで使う: 架空の zip（Excel・Word の入れ物）を作る（T119）。配信のコードからは使わない。

import { deflateRawSync } from "node:zlib";

export type Entry = { name: string; data: string | Uint8Array; deflate?: boolean; flags?: number };

function u16(n: number) {
  return [n & 0xff, (n >> 8) & 0xff];
}
function u32(n: number) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

export function makeZip(entries: Entry[]): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  for (const e of entries) {
    const raw = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const body = e.deflate === false ? raw : new Uint8Array(deflateRawSync(raw));
    const method = e.deflate === false ? 0 : 8;
    const name = enc.encode(e.name);
    const offset = local.length;
    const head = [...u32(0x04034b50), ...u16(20), ...u16(e.flags ?? 0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(raw.length), ...u16(name.length), ...u16(0)];
    local.push(...head, ...name, ...body);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(e.flags ?? 0), ...u16(method), ...u16(0), ...u16(0), ...u32(0), ...u32(body.length), ...u32(raw.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    );
  }
  const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(local.length), ...u16(0)];
  return new Uint8Array([...local, ...central, ...eocd]);
}

