// 受入の入り方（T152）。受入一覧の最初に並べる 3 つ（QR 読取・氏名検索・新規登録）と、その流れで使う小さな道具。
// D1 に触らない（画面の部品も読む）。
//
// - QR 読取: 本人の 1 枚の裏の QR は /q/<token> の URL（lib/qr/url.ts）。端末のカメラで読む・URL を貼る・見本の QR を開く
//   のどれからでも、トークンだけを取り出して QR の頁へ移る（受入はその頁の「受入」。同意の無い人の出し方は QR の頁のまま）
// - 受け入れたあとは受入一覧（?received=<受け持ちの id>）。その人の行を表の上に出す。並びの番号（ルールの表の順）は変えない

import { RECEIVED_PARAM } from "./paths.ts";

export const ENTRY_KINDS = ["qr", "search", "register"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * トークンの形（lib/qr/token.ts の signQrToken: 中身の base64url と HMAC-SHA256 の署名の base64url を「.」でつなぐ）。
 * 署名は 32 バイトなので 43 字。中身は本人の id・版・時刻だけ
 */
const TOKEN = /^[A-Za-z0-9_-]{16,460}\.[A-Za-z0-9_-]{43}$/;
/** 長すぎる文字は読まない（トークンの上限 512 字と URL の頭） */
const MAX_TEXT = 1024;

/**
 * QR から読んだ文字・貼った文字からトークン。URL（どの元でもよい。道の /q/<token> だけを読む）・頁の道・トークンだけ、のどれか。
 * 形の合わない物は null（署名・期限・版は QR の頁が確かめる）
 */
export function qrTokenFrom(text: string | null | undefined): string | null {
  const s = (text ?? "").trim();
  if (!s || s.length > MAX_TEXT) return null;
  if (TOKEN.test(s)) return s;
  const m = /(?:^|\/)q\/([^/?#\s]+)/.exec(s);
  if (!m) return null;
  let t: string;
  try {
    t = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  return TOKEN.test(t) ? t : null;
}

/** 受け持ちの行の id（lib/custody/store.ts の cu-<uuid>、種の cu-…）。形の違う物は null */
const CUSTODY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** URL の ?received=（Next の searchParams の形。2 つ以上・形の違う物は無かったことに） */
export function parseReceived(q: { [RECEIVED_PARAM]?: unknown }): string | null {
  const v = q[RECEIVED_PARAM];
  return typeof v === "string" && CUSTODY_ID.test(v) ? v : null;
}

/**
 * 受け入れたばかりの人の行を表の先頭に（画面だけ）。絞込で見えない人は動かさない。並びの番号（rank）はそのまま。
 * CSV（lib/custody/staff-view.ts の staffViewRows）は通さない
 */
export function pinReceived<T extends { custodyId: string }>(rows: readonly T[], custodyId: string | null): T[] {
  if (!custodyId) return [...rows];
  const i = rows.findIndex((r) => r.custodyId === custodyId);
  if (i <= 0) return [...rows];
  return [rows[i], ...rows.slice(0, i), ...rows.slice(i + 1)];
}
