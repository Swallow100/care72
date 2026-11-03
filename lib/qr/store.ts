// QR の版を D1 で持つ（migrations/0001_init.sql の people.qr_generation・qr_issued_at、0015 の qr_ttl_days）。
// 作る・作り直すは版を 1 つ上げて時刻（と選んだ日数）を書くだけ。本人の行の version・updated_at は変えない（台帳の中身は変わらない）。
// トークンは版と時刻と日数から署名で作り直す（lib/qr/token.ts）。表には持たない。

import type { D1Database } from "@cloudflare/workers-types";
import { isQrTtlDays, QR_TTL_DAYS, qrTimes, signQrToken, verifyQrToken, type QrPayload, type QrTtlDays } from "./token.ts";

/** 本人の行の QR の列。qr_ttl_days は 0015 の列（無ければ既定の 90 日） */
export type QrRow = { qr_generation: number; qr_issued_at: string | null; qr_ttl_days?: number | null };

/** QR の状態: 未作成・有効・期限切れ */
export type QrStatus = "none" | "active" | "expired";

export type QrState = {
  status: QrStatus;
  /** 版（0 はまだ作っていない） */
  generation: number;
  /** 作った時刻（ISO）。期限はここから ttlDays 日 */
  issuedAt: string | null;
  /** 期限（ISO） */
  expiresAt: string | null;
  /** 行の期限の日数（30・90・180）。まだ作っていなくても、次に作るときの既定 */
  ttlDays: QrTtlDays;
};

const DAY_SEC = 24 * 60 * 60;

function issuedSec(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** 行の期限の日数。列が無い・集合の外（CHECK があるので本来は無い）なら既定の 90 */
export function qrTtlOf(row: QrRow): QrTtlDays {
  return isQrTtlDays(row.qr_ttl_days) ? row.qr_ttl_days : QR_TTL_DAYS;
}

/** 版と時刻と日数から状態を作る。now は秒 */
export function qrState(row: QrRow, now: number): QrState {
  const ttlDays = qrTtlOf(row);
  const iat = issuedSec(row.qr_issued_at);
  if (row.qr_generation < 1 || iat === null) {
    return { status: "none", generation: row.qr_generation, issuedAt: null, expiresAt: null, ttlDays };
  }
  const { exp } = qrTimes(iat, ttlDays);
  return {
    status: exp > now ? "active" : "expired",
    generation: row.qr_generation,
    issuedAt: row.qr_issued_at,
    expiresAt: new Date(exp * 1000).toISOString(),
    ttlDays,
  };
}

export async function loadQrRow(db: D1Database, personId: string): Promise<QrRow | null> {
  return db.prepare("SELECT qr_generation, qr_issued_at, qr_ttl_days FROM people WHERE id = ?1").bind(personId).first<QrRow>();
}

/**
 * 作る・作り直す。版を 1 つ上げ、作った時刻を書く。前の版のトークンはこれで通らなくなる。
 * ttlDays を渡せば行の日数をそれに、渡さなければ行の今の日数（既定 90）のまま
 */
export async function issueQr(db: D1Database, personId: string, nowIso: string, ttlDays?: QrTtlDays): Promise<QrRow | null> {
  await db
    .prepare(
      "UPDATE people SET qr_generation = qr_generation + 1, qr_issued_at = ?2, qr_ttl_days = COALESCE(?3, qr_ttl_days) WHERE id = ?1",
    )
    .bind(personId, nowIso, ttlDays ?? null)
    .run();
  return loadQrRow(db, personId);
}

/** 今の版のトークン。まだ作っていなければ null（期限切れでも作る。期限切れかは qrState で見る） */
export async function currentQrToken(personId: string, row: QrRow, secret: string): Promise<string | null> {
  const iat = issuedSec(row.qr_issued_at);
  if (row.qr_generation < 1 || iat === null) return null;
  return signQrToken({ v: 1, p: personId, g: row.qr_generation, ...qrTimes(iat, qrTtlOf(row)) }, secret);
}

/**
 * トークンを確かめる: 署名・形・期限（verifyQrToken）のあとに、本人の行の今の版と作った時刻と日数と比べる。
 * 作り直した前の版・本人の行が無い・時刻が違う・行の日数と期限が合わなければ null。どの失敗も同じ null（どこで落ちたかを頁に出さない）
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
  if (iat === null || iat !== p.iat || p.exp !== iat + qrTtlOf(row) * DAY_SEC) return null;
  return p;
}
