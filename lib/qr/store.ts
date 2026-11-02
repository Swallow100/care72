// QR の版を D1 で持つ（migrations/0002_qr.sql の people.qr_generation・qr_issued_at）。
// 作る・作り直すは版を 1 つ上げて時刻を書くだけ。本人の行の version・updated_at は変えない（台帳の中身は変わらない）。
// トークンは版と時刻から署名で作り直す（lib/qr/token.ts）。表には持たない。

import type { D1Database } from "@cloudflare/workers-types";
import { QR_TTL_SEC, qrTimes, signQrToken, verifyQrToken, type QrPayload } from "./token.ts";

/** 本人の行の QR の列 */
export type QrRow = { qr_generation: number; qr_issued_at: string | null };

/** QR の状態: 未作成・有効・期限切れ */
export type QrStatus = "none" | "active" | "expired";

export type QrState = {
  status: QrStatus;
  /** 版（0 はまだ作っていない） */
  generation: number;
  /** 作った時刻（ISO）。期限はここから 90 日 */
  issuedAt: string | null;
  /** 期限（ISO） */
  expiresAt: string | null;
};

function issuedSec(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** 版と時刻から状態を作る。now は秒 */
export function qrState(row: QrRow, now: number): QrState {
  const iat = issuedSec(row.qr_issued_at);
  if (row.qr_generation < 1 || iat === null) {
    return { status: "none", generation: row.qr_generation, issuedAt: null, expiresAt: null };
  }
  const { exp } = qrTimes(iat);
  return {
    status: exp > now ? "active" : "expired",
    generation: row.qr_generation,
    issuedAt: row.qr_issued_at,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export async function loadQrRow(db: D1Database, personId: string): Promise<QrRow | null> {
  return db.prepare("SELECT qr_generation, qr_issued_at FROM people WHERE id = ?1").bind(personId).first<QrRow>();
}

/** 作る・作り直す。版を 1 つ上げ、作った時刻を書く。前の版のトークンはこれで通らなくなる */
export async function issueQr(db: D1Database, personId: string, nowIso: string): Promise<QrRow | null> {
  await db
    .prepare("UPDATE people SET qr_generation = qr_generation + 1, qr_issued_at = ?2 WHERE id = ?1")
    .bind(personId, nowIso)
    .run();
  return loadQrRow(db, personId);
}

/** 今の版のトークン。まだ作っていなければ null（期限切れでも作る。期限切れかは qrState で見る） */
export async function currentQrToken(personId: string, row: QrRow, secret: string): Promise<string | null> {
  const iat = issuedSec(row.qr_issued_at);
  if (row.qr_generation < 1 || iat === null) return null;
  return signQrToken({ v: 1, p: personId, g: row.qr_generation, ...qrTimes(iat) }, secret);
}

/**
 * トークンを確かめる: 署名・形・期限（verifyQrToken）のあとに、本人の行の今の版と作った時刻と比べる。
 * 作り直した前の版・本人の行が無い・時刻が違えば null。どの失敗も同じ null（どこで落ちたかを頁に出さない）
 */
export async function resolveQrToken(
  db: D1Database,
  secret: string,
  token: string | null | undefined,
  now: number,
): Promise<QrPayload | null> {
  const p = await verifyQrToken(token, secret, now);
  if (!p) return null;
  const row = await loadQrRow(db, p.p);
  if (!row || row.qr_generation !== p.g) return null;
  const iat = issuedSec(row.qr_issued_at);
  if (iat === null || iat !== p.iat || p.exp !== iat + QR_TTL_SEC) return null;
  return p;
}
