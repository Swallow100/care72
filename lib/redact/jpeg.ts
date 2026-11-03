// JPEG の付け足し（EXIF の位置・端末の名前・XMP・コメント）を見つける・外す（T52）。
// 黒塗りした画像は canvas から JPEG にするので本来は付かないが、ブラウザによっては付けうるので、送る前にブラウザで外し（stripJpegMetadata）、
// サーバーは付け足しのある物を断る（hasJpegMetadata）。2 重にして、元の写真の位置や端末が Claude に渡らない形にする。
//
// 見る区切り: APP1〜APP15（FF E1〜FF EF。EXIF・XMP・ICC など）とコメント（FF FE）。APP0（JFIF）と画像の中身の区切りは残す。

export type JpegSegment = { marker: number; start: number; end: number };

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

const isMeta = (marker: number) => (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;

/**
 * 頭（SOI）から走査の頭（SOS）までの区切り。SOS のあとは圧縮の中身なので 1 つの区切り（end は終わりまで）にする。
 * 形が壊れていれば null
 */
export function jpegSegments(bytes: Uint8Array): JpegSegment[] | null {
  if (!isJpeg(bytes)) return null;
  const out: JpegSegment[] = [{ marker: 0xd8, start: 0, end: 2 }];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // 埋め草の FF を飛ばす
    let m = i + 1;
    while (m < bytes.length && bytes[m] === 0xff) m++;
    if (m >= bytes.length) return null;
    const marker = bytes[m];
    // 長さの無い区切り（RST・TEM）。SOS の前には来ないが、来たら 2 バイトで進む
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      out.push({ marker, start: i, end: m + 1 });
      i = m + 1;
      continue;
    }
    if (marker === 0xd9) {
      out.push({ marker, start: i, end: m + 1 });
      return out;
    }
    if (m + 2 >= bytes.length) return null;
    const len = (bytes[m + 1] << 8) | bytes[m + 2];
    const end = m + 1 + len;
    if (len < 2 || end > bytes.length) return null;
    if (marker === 0xda) {
      // 走査の中身は終わりまで（中の FF 00・RST・EOI ごと残す）
      out.push({ marker, start: i, end: bytes.length });
      return out;
    }
    out.push({ marker, start: i, end });
    i = end;
  }
  return out;
}

/** 付け足しがあるか。形が壊れていれば「ある」と見る（通さない側に倒す） */
export function hasJpegMetadata(bytes: Uint8Array): boolean {
  const segs = jpegSegments(bytes);
  if (!segs) return true;
  return segs.some((s) => isMeta(s.marker));
}

/** 付け足しを外した写し。形が壊れていれば同じ物を返す（サーバーが断る） */
export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  const segs = jpegSegments(bytes);
  if (!segs || !segs.some((s) => isMeta(s.marker))) return bytes;
  const keep = segs.filter((s) => !isMeta(s.marker));
  const out = new Uint8Array(keep.reduce((n, s) => n + (s.end - s.start), 0));
  let at = 0;
  for (const s of keep) {
    out.set(bytes.subarray(s.start, s.end), at);
    at += s.end - s.start;
  }
  return out;
}
