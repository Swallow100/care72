// 録音の再生（docs/tasks/T13.md「録音の再生（R2 から）」、T10 の引き継ぎ「録音を再生する GET の道は作っていない」）。
// GET /api/recordings/<信号の id> で、信号の行の recording_key を R2（RECORDINGS）から読んで返す。
//
// 壁: ログインしていなければ 401、read を持たない役（役未選択）は 403。信号の本人が personInScope の範囲に無ければ 404
// （ケアマネは自分の事業所、本人・家族のスマホは自分の本人だけ、行政・医療班は受け持ちができるまで誰も見えない）。
// 訓練の信号（drill_id がある物）は返さない。録音の無い信号・R2 に無い物も 404。
// 音声の要素が飛ばして聞けるように Range（bytes=）を受け、206 で一部を返す。応答は手元に残さない（no-store）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";

/** 信号の id の形（端末で作る UUID）。lib/signals/body.ts の UUID と同じ形 */
const SIGNAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 担当一覧の行の詳細の音声の要素の行き先 */
export function recordingHref(signalId: string): string {
  return `/api/recordings/${encodeURIComponent(signalId)}`;
}

/** R2 の range（offset と length、か末尾から suffix） */
export type ByteRange = { offset: number; length?: number } | { suffix: number };

/** R2 から読む物の形（配信は env.RECORDINGS、テストは偽物） */
export type RecordingObject = {
  /** 本体（R2 は ReadableStream。workers の型と DOM の型が合わないので unknown で受け、そのまま応答に渡す） */
  body: unknown;
  /** 全体の大きさ（range で読んでも全体） */
  size: number;
  httpMetadata?: { contentType?: string };
};

export type RecordingReader = {
  get(key: string, options?: { range?: ByteRange }): Promise<RecordingObject | null>;
  head(key: string): Promise<Pick<RecordingObject, "size" | "httpMetadata"> | null>;
};

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

function refuse(status: 401 | 403 | 404 | 416, label: string): Response {
  return Response.json({ ok: false, label }, { status, headers: HEADERS });
}

/** Range の見出しを読む。1 つの bytes= の範囲だけ。読めない・複数の範囲は null（全体を返す） */
export function parseRange(header: string | null): ByteRange | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  if (m[2] === "") return { offset };
  const end = Number(m[2]);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

/** 範囲を全体の大きさに合わせる。全体の外なら null（416） */
function clampRange(r: ByteRange, size: number): { offset: number; length: number } | null {
  if ("suffix" in r) {
    if (r.suffix <= 0 || size === 0) return null;
    const length = Math.min(r.suffix, size);
    return { offset: size - length, length };
  }
  if (r.offset >= size) return null;
  const length = Math.min(r.length ?? size - r.offset, size - r.offset);
  return { offset: r.offset, length };
}

/**
 * 録音を返す。signalId は URL の 1 つの区切り（形が違えば 404）。range は Range の見出し
 */
export async function recordingGet(
  db: D1Database,
  bucket: RecordingReader,
  p: Principal | null,
  signalId: string,
  rangeHeader: string | null,
): Promise<Response> {
  if (!p) return refuse(401, "ログイン要");
  if (!roleAllows(p.role, "read")) return refuse(403, "権限なし");
  if (!SIGNAL_ID.test(signalId)) return refuse(404, "対象なし");

  const signal = await db
    .prepare("SELECT person_id, recording_key FROM signals WHERE id = ?1 AND drill_id IS NULL")
    .bind(signalId)
    .first<{ person_id: string; recording_key: string | null }>();
  if (!signal?.recording_key) return refuse(404, "対象なし");
  // 本人の壁（事業所・自分の本人）。範囲の外は在っても無くても同じ 404
  if (!(await personInScope(db, p, signal.person_id))) return refuse(404, "対象なし");

  const key = signal.recording_key;
  const wanted = parseRange(rangeHeader);
  if (!wanted) {
    const whole = await bucket.get(key);
    if (!whole) return refuse(404, "対象なし");
    return new Response(whole.body as BodyInit, {
      status: 200,
      headers: { ...headersOf(whole), "Content-Length": String(whole.size) },
    });
  }
  // 範囲は全体の大きさ（head）に合わせてから、その範囲だけを読む
  const meta = await bucket.head(key);
  if (!meta) return refuse(404, "対象なし");
  const r = clampRange(wanted, meta.size);
  if (!r) return new Response(null, { status: 416, headers: { ...HEADERS, "Content-Range": `bytes */${meta.size}` } });
  const part = await bucket.get(key, { range: r });
  if (!part) return refuse(404, "対象なし");
  return new Response(part.body as BodyInit, {
    status: 206,
    headers: {
      ...headersOf(meta),
      "Content-Length": String(r.length),
      "Content-Range": `bytes ${r.offset}-${r.offset + r.length - 1}/${meta.size}`,
    },
  });
}

function headersOf(o: Pick<RecordingObject, "httpMetadata">): Record<string, string> {
  return { ...HEADERS, "Content-Type": o.httpMetadata?.contentType || "application/octet-stream", "Accept-Ranges": "bytes" };
}
