// 一覧の公式の様式を取る受け口（T134、lib/forms/municipal-forms.ts）。サーバーだけ。T101 の原本の受け口（originals-http.ts）と同じ形。
//
// GET /api/forms/municipal/<id>/source: 一覧の url（ここ以外から取らない。要求から URL を受けない）から取り、版のハッシュを確かめて返す
//   （ブラウザから市の頁へは CORS で取れないため）。転送は https で一覧のホストの中だけ、3 回まで。大きさは 20MB まで。
//   - 版が一覧と違えば 409「版違い」（今の版のハッシュを添える）。?accept=1 なら今の版を返す（読み取りからやり直す）
//   - 取った版を事業所の R2（forms/<事業所>/municipal/<id>.json）に記録する。読み取り（lib/forms/read-post.ts）は
//     この記録の版で共有の対応表を引く（ブラウザの言う版を信じない）。ファイル本体は置かない（頁の絵はいつもの読み取りの道で置く）
// 壁: ケアマネの役で事業所のある人（formsScope）。ログインなし 401、役の外 403、無い様式 404、取り込めない様式（旧形式・許諾要・内蔵）403。
// Claude は呼ばない。

import type { Principal } from "../auth/principal.ts";
import { formsScope } from "./mapping-db.ts";
import {
  availability,
  BLOCK_LABELS,
  FORMAT_MIME,
  MUNICIPAL_CITIES,
  MUNICIPAL_LABELS,
  municipalEntry,
  type MunicipalFormat,
} from "./municipal-forms.ts";
import { sha256Hex } from "./originals.ts";
import { pageImagePrefix } from "./page-images.ts";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/** 公式のファイルの大きさの上限（一覧の最大は 2MB ほど） */
export const MUNICIPAL_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
/** 転送をたどる回数の上限 */
export const MUNICIPAL_REDIRECTS_MAX = 3;
/** 取った記録を読み取りに使える時間（取ってから黒塗りの画面で送るまで） */
export const MUNICIPAL_FETCH_TTL_MS = 6 * 60 * 60 * 1000;

/** 応答の頭（ブラウザが版を読む） */
export const MUNICIPAL_SHA_HEADER = "X-Care72-Sha256";
export const MUNICIPAL_VERSION_HEADER = "X-Care72-Version";

export type MunicipalError = "login_required" | "forbidden" | "not_found" | "unavailable" | "version" | "source_failed" | "store_failed";

const LABELS: Record<Exclude<MunicipalError, "unavailable">, string> = {
  login_required: "ログイン要",
  forbidden: "権限なし",
  not_found: "該当なし",
  version: MUNICIPAL_LABELS.versionChanged,
  source_failed: "取得失敗",
  store_failed: "保存失敗",
};
const STATUS: Record<MunicipalError, number> = {
  login_required: 401,
  forbidden: 403,
  not_found: 404,
  unavailable: 403,
  version: 409,
  source_failed: 502,
  store_failed: 500,
};

function fail(e: MunicipalError, extra: Record<string, unknown> = {}, label?: string): Response {
  return Response.json(
    { ok: false, error: e, label: label ?? (e === "unavailable" ? "取込不可" : LABELS[e]), ...extra },
    { status: STATUS[e], headers: HEADERS },
  );
}

/** 一覧に出てくるホスト（取り込みの元と公式の頁）。転送の先はこの中だけ */
const CATALOG_HOSTS: ReadonlySet<string> = new Set(
  MUNICIPAL_CITIES.flatMap((c) => [c.pageUrl, ...c.forms.map((f) => f.url)]).map((u) => new URL(u).hostname.toLowerCase()),
);

/** 転送の先に使えるか（https、一覧のホスト、利用者名・ポートなし） */
export function allowedRedirect(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && !u.username && !u.password && u.port === "" && CATALOG_HOSTS.has(u.hostname.toLowerCase());
}

/** 公式の URL から取る道（配信は fetch の redirect: "manual"、テストは偽物） */
export type MunicipalFetch = (url: string) => Promise<Response>;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** 一覧の url から取る。転送は allowedRedirect の先だけたどる。取れなければ null */
export async function fetchOfficial(fetcher: MunicipalFetch, url: string): Promise<Uint8Array | null> {
  let current = url;
  for (let hop = 0; hop <= MUNICIPAL_REDIRECTS_MAX; hop++) {
    if (!allowedRedirect(current)) return null;
    const res = await fetcher(current);
    if (REDIRECTS.has(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      let next: string;
      try {
        next = new URL(loc, current).href;
      } catch {
        return null;
      }
      current = next;
      continue;
    }
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? "0");
    if (length > MUNICIPAL_SOURCE_MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > 0 && bytes.length <= MUNICIPAL_SOURCE_MAX_BYTES ? bytes : null;
  }
  return null;
}

/** 中身が一覧の形式どおりか（PDF は %PDF-、Excel・Word は zip の頭）。市の頁が様式の代わりに頁の HTML を返したときに断る */
export function looksLikeFormat(format: MunicipalFormat, bytes: Uint8Array): boolean {
  if (format === "pdf") return bytes.length > 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
  if (format === "xlsx" || format === "docx") return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  return false;
}

// ---------- 取った記録 ----------

export type MunicipalFetchRecord = { id: string; sha256: string; bytes: number; at: string; matches: boolean };

export const municipalFetchKey = (officeId: string, id: string) => `${pageImagePrefix(officeId)}municipal/${id}.json`;

/** 記録を読む。形が違う・古い（MUNICIPAL_FETCH_TTL_MS を過ぎた）・未来の物は null */
export function parseFetchRecord(id: string, json: string | null | undefined, now: Date): MunicipalFetchRecord | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.id !== id || typeof r.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.sha256)) return null;
  if (typeof r.bytes !== "number" || !Number.isInteger(r.bytes) || r.bytes < 1 || typeof r.at !== "string" || typeof r.matches !== "boolean") return null;
  const at = Date.parse(r.at);
  if (!Number.isFinite(at)) return null;
  const age = now.getTime() - at;
  if (age < -60_000 || age > MUNICIPAL_FETCH_TTL_MS) return null;
  return { id, sha256: r.sha256, bytes: r.bytes, at: r.at, matches: r.matches };
}

/** R2 のうち使う所（配信は env.RECORDINGS、テストは偽物） */
export type MunicipalBucket = {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: unknown } | null>;
};

/** 読み取りの前に取った記録を読む（読めなければ null） */
export async function loadFetchRecord(bucket: Pick<MunicipalBucket, "get">, officeId: string, id: string, now: Date): Promise<MunicipalFetchRecord | null> {
  try {
    const obj = await bucket.get(municipalFetchKey(officeId, id));
    if (!obj) return null;
    return parseFetchRecord(id, await new Response(obj.body as BodyInit).text(), now);
  } catch (e) {
    console.error("様式の取った記録を読めない", e instanceof Error ? e.name : typeof e);
    return null;
  }
}

// ---------- GET ----------

export type MunicipalSourceDeps = { fetch: MunicipalFetch; bucket: Pick<MunicipalBucket, "put">; now?: () => Date };

export async function municipalSourceGet(deps: MunicipalSourceDeps, p: Principal | null, idRaw: string, accept: boolean): Promise<Response> {
  if (!p) return fail("login_required");
  const scope = formsScope(p);
  if (!scope) return fail("forbidden");
  const entry = municipalEntry(idRaw);
  if (!entry) return fail("not_found");
  const can = availability(entry);
  if (!can.ok) return fail("unavailable", { reason: can.reason }, BLOCK_LABELS[can.reason]);

  let bytes: Uint8Array | null;
  try {
    bytes = await fetchOfficial(deps.fetch, entry.form.url);
  } catch (e) {
    console.error("公式の様式を取れない", e instanceof Error ? e.name : typeof e);
    bytes = null;
  }
  if (!bytes || !looksLikeFormat(entry.form.format, bytes)) return fail("source_failed");
  const sha256 = await sha256Hex(bytes);
  const matches = sha256 === entry.form.sha256;
  if (!matches && !accept) return fail("version", { sha256 });

  const record: MunicipalFetchRecord = { id: entry.form.id, sha256, bytes: bytes.length, at: (deps.now?.() ?? new Date()).toISOString(), matches };
  try {
    await deps.bucket.put(municipalFetchKey(scope.officeId, entry.form.id), JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    console.error("様式の取った記録を置けない", e instanceof Error ? e.name : typeof e);
    return fail("store_failed");
  }
  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      ...HEADERS,
      "Content-Type": FORMAT_MIME[entry.form.format],
      [MUNICIPAL_SHA_HEADER]: sha256,
      [MUNICIPAL_VERSION_HEADER]: matches ? "same" : "changed",
    },
  });
}
