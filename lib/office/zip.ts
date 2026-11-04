// Excel・Word（.xlsx・.docx。中身は zip）を読む所の zip の展開（T119）。ブラウザと Node の両方で動く（DOM も node:zlib も使わない）。
// 展開は Web 標準の DecompressionStream("deflate-raw")（Chrome 103・Safari 16.4・Firefox 113 から。Node 21 から）。
// 中身の目録（central directory）だけを信じ、決まった名前の部品だけを開く。守り:
// - 暗号化・ZIP64・分割・展開の方式が無圧縮と deflate の外の物は断る（Office の .xlsx・.docx はこの形の外を使わない）
// - 展開後の大きさに上限（1 部品・全部）。目録の値を信じず、展開しながら数えて超えたら止める（zip 爆弾）
// - 名前の重なり・絶対の道・.. は見ない（部品は決まった名前で引くだけで、ファイルに書き出さない）

import { isZip } from "./sniff.ts";

export type ZipError = "not_zip" | "encrypted" | "zip64" | "method" | "too_large" | "broken";

export class ZipReadError extends Error {
  readonly code: ZipError;
  constructor(code: ZipError) {
    super(`zip: ${code}`);
    this.name = "ZipReadError";
    this.code = code;
  }
}

/** 展開後の上限（1 部品）。様式のシートの XML は大きくても数 MB */
export const ZIP_ENTRY_MAX_BYTES = 24 * 1024 * 1024;
/** 展開後の上限（開いた部品の合計） */
export const ZIP_TOTAL_MAX_BYTES = 64 * 1024 * 1024;
/** 目録の部品の数の上限 */
export const ZIP_ENTRIES_MAX = 4000;

type Entry = { name: string; method: number; flags: number; compressed: number; size: number; offset: number };

export type ZipArchive = {
  /** 部品の名前（目録の順） */
  names(): string[];
  has(name: string): boolean;
  /** 部品の中身（無ければ null）。展開に失敗・上限を超えたら ZipReadError */
  bytes(name: string): Promise<Uint8Array | null>;
  /** 部品を UTF-8 の文字で（無ければ null） */
  text(name: string): Promise<string | null>;
};

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

/** 頭の 4 バイトが zip（PK\x03\x04）か */
export { isZip };

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  // 書く側の失敗は読む側で受ける（ここで待つと、上限で止めたときに書く側が終わらない）
  void writer.write(data as Uint8Array<ArrayBuffer>).catch(() => undefined);
  void writer.close().catch(() => undefined);
  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new ZipReadError("too_large");
      }
      parts.push(value);
    }
  } catch (e) {
    if (e instanceof ZipReadError) throw e;
    throw new ZipReadError("broken");
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** zip の目録を読む。中身はまだ開かない */
export function readZip(bytes: Uint8Array): ZipArchive {
  if (!isZip(bytes)) throw new ZipReadError("not_zip");
  // 目録の終わり（EOCD）を後ろから探す（注釈は最大 65535 バイト）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipReadError("broken");
  const disk = u16(bytes, eocd + 4);
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (disk !== 0) throw new ZipReadError("broken");
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipReadError("zip64");
  if (count > ZIP_ENTRIES_MAX) throw new ZipReadError("too_large");
  if (cdOffset + cdSize > bytes.length) throw new ZipReadError("broken");

  const entries = new Map<string, Entry>();
  const order: string[] = [];
  const decoder = new TextDecoder("utf-8");
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ZipReadError("broken");
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new ZipReadError("zip64");
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (!entries.has(name)) {
      entries.set(name, { name, method, flags, compressed, size, offset });
      order.push(name);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  let opened = 0;
  const bytesOf = async (name: string): Promise<Uint8Array | null> => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 0x1) throw new ZipReadError("encrypted");
    if (e.method !== 0 && e.method !== 8) throw new ZipReadError("method");
    if (e.size > ZIP_ENTRY_MAX_BYTES) throw new ZipReadError("too_large");
    const lh = e.offset;
    if (lh + 30 > bytes.length || u32(bytes, lh) !== 0x04034b50) throw new ZipReadError("broken");
    const start = lh + 30 + u16(bytes, lh + 26) + u16(bytes, lh + 28);
    const end = start + e.compressed;
    if (end > bytes.length) throw new ZipReadError("broken");
    const raw = bytes.subarray(start, end);
    const limit = Math.min(ZIP_ENTRY_MAX_BYTES, ZIP_TOTAL_MAX_BYTES - opened);
    const out = e.method === 0 ? raw.slice() : await inflateRaw(raw, limit);
    if (out.length > limit) throw new ZipReadError("too_large");
    opened += out.length;
    return out;
  };

  return {
    names: () => [...order],
    has: (name) => entries.has(name),
    bytes: bytesOf,
    text: async (name) => {
      const b = await bytesOf(name);
      return b === null ? null : decoder.decode(b);
    },
  };
}
