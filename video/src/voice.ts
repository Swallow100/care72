// 声と画面の言葉の時刻を合わせる。node（scripts/scan.mjs・check.mjs）からも直接読むので、型を消すだけで動く書き方にし、ほかのファイルを読まない。
//
// 声の切れ目は scripts/scan.mjs が声のファイルから測る（ffmpeg の silencedetect）。声の区切り（話している所）が
// 文の「、」「。」の区切りと同じ数なら 1 つずつ当て、区切りの中は読みの長さの割合で言葉の時刻を出す。
// 数が合わない文（間の取り方が違う声）と声が無い文は、文の秒（at〜end）の中を読みの長さの割合で割る。
// 作者の声に替えたら npm run scan をもう一度流すだけで、画面の言葉の時刻も声に合う。

/** 声の区切り（声のファイルの頭からの秒）。[始まり, 終わり] */
export type Segment = [number, number];

/** 画面に出す言葉と声を照らすときに外す字（台本の文の中の『』「」と空白） */
export function plain(text: string): string {
  return text.replace(/[『』「」\s]/g, "");
}

/** 読みの長さの目安（拍）。漢字 2、かな 1、小さいかな 0、数字 2.5、% 5。区切りの字と空白は 0 */
export function weight(text: string): number {
  let n = 0;
  for (const ch of text) {
    if (/[、。，．・「」『』（）［］()…,!?！？:;\s]/.test(ch)) continue;
    if (/[ゃゅょぁぃぅぇぉゎャュョァィゥェォヮ]/.test(ch)) continue;
    if (/[0-9０-９]/.test(ch)) n += 2.5;
    else if (ch === "%" || ch === "％") n += 5;
    else if (ch === ".") n += 1.5;
    else if (/[A-Za-z]/.test(ch)) n += 0.7;
    else if (/[一-鿿々]/.test(ch)) n += 2;
    else n += 1;
  }
  return n;
}

/** 文を「、」「。」「？」「！」の後ろで区切る（区切りの字は前に付ける）。台本の文の plain の上で */
export function chunks(text: string): { start: number; end: number }[] {
  const t = plain(text);
  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < t.length; i++) {
    if ("、。？！".includes(t[i])) {
      out.push({ start, end: i + 1 });
      start = i + 1;
    }
  }
  if (start < t.length) out.push({ start, end: t.length });
  return out;
}

/**
 * silencedetect の黙っている所から、話している所を出す。短い間（gap 秒未満）はつなぎ、短すぎる音（min 秒未満）は捨てる。
 * silences は [始まり, 終わり] の並び（ファイルの頭からの秒）、length はファイルの長さ（秒）
 */
export function speechSegments(silences: Segment[], length: number, gap = 0.2, min = 0.06): Segment[] {
  const raw: Segment[] = [];
  let at = 0;
  for (const [s, e] of [...silences].sort((a, b) => a[0] - b[0])) {
    if (s > at) raw.push([at, s]);
    at = Math.max(at, e);
  }
  if (length > at) raw.push([at, length]);
  const kept = raw.filter(([s, e]) => e - s >= min);
  const out: Segment[] = [];
  for (const seg of kept) {
    const last = out[out.length - 1];
    if (last && seg[0] - last[1] < gap) last[1] = seg[1];
    else out.push([seg[0], seg[1]]);
  }
  return out;
}

/**
 * 言葉 say が声で言われ始める秒（動画の頭から）。line は台本の文（at・end・ja）、segments はその声の区切り（無ければ undefined）。
 * say が文の中に無ければ null（check.mjs が止める）。edge が "end" なら言い終わる秒
 */
export function sayAt(line: { at: number; end: number; ja: string }, segments: Segment[] | undefined, say: string, edge: "start" | "end" = "start"): number | null {
  const t = plain(line.ja);
  const word = plain(say);
  const index = t.indexOf(word);
  if (index < 0 || word.length === 0) return null;
  const pos = edge === "start" ? index : index + word.length;
  const parts = chunks(line.ja);
  if (segments && segments.length > 0 && segments.length === parts.length) {
    // 区切りが合う: その区切りの声の中を読みの長さで割る
    const k = Math.max(0, parts.findIndex((c) => pos >= c.start && (pos < c.end || (edge === "end" && pos === c.end))));
    const c = parts[k];
    const [s, e] = segments[k];
    const w = weight(t.slice(c.start, c.end));
    const r = w > 0 ? weight(t.slice(c.start, pos)) / w : 0;
    return line.at + s + r * (e - s);
  }
  // 区切りが合わない・声が無い: 話している所の全体（無ければ文の秒）を読みの長さで割る
  const s0 = segments && segments.length > 0 ? line.at + segments[0][0] : line.at;
  const e0 = segments && segments.length > 0 ? line.at + segments[segments.length - 1][1] : line.end;
  const w = weight(t);
  return s0 + (w > 0 ? weight(t.slice(0, pos)) / w : 0) * (e0 - s0);
}
