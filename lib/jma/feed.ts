// 防災情報 XML の PULL 型のフィード（Atom）を読む・取る（T72）。cron（lib/jma/cron.ts）が 5 分ごとに 1 か所で呼ぶ。
// - entry ごとに id・title・updated・link（電文の URL）を出す。電文の種類は URL の中の文字（…_VPWW54_380000.xml）で見分ける
// - 取るときは If-Modified-Since（前回の Last-Modified）を付け、304 なら何もしない
// - 取りに行くのは気象庁の置き場（https の data.jma.go.jp・xml.kishou.go.jp とその下）だけ。フィードに載った電文の URL も同じ所だけ
//   （見直しの安全 低）。移り（3xx）は fetch に任せず redirect: "manual" で受け、移った先も同じ決まりで確かめて MAX_REDIRECTS 回まで
//   たどる（"error" は Workers で毎回投げる。"follow" だと気象庁の外へ移っても取りに行く）。待つのは 1 回の取得で 10 秒まで
// - 本文は MAX_BODY_BYTES（2MB）まで。Content-Length が上限を超えれば読まず、無い・偽る物も読みながら数えて超えたら切る
// 本物の気象庁に繋ぐのは配信の cron だけ。テストは偽の fetch、手元の画面は fixtures（npm run jma:fetch-local）。

import { priorityOf } from "./labels.ts";
import { attr, children, childText, isoOf, parseXml } from "./xml.ts";

/**
 * 1 回の取得（2 つのフィード合わせて）で取る電文の上限。上限を超えた分は次の回に。
 * Workers の無料の枠は外への要求が 1 回 50 まで（フィード 2 つ＋電文）なので、電文は 40 に抑える（docs/progress/t72.md）
 */
export const MAX_ENTRIES_PER_RUN = 40;

/** 外へ取りに行くときの待ちの上限（ミリ秒） */
export const FETCH_TIMEOUT_MS = 10_000;

/** 取りに行ってよい所（このホストと、その下のホスト。https だけ）。フィードと電文は www.data.jma.go.jp に置かれる */
export const JMA_HOSTS = ["data.jma.go.jp", "xml.kishou.go.jp"] as const;

/** フィード・電文の本文の大きさの上限（バイト）。今の電文は大きくても数百 KB */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** 移り（3xx）をたどる回数の上限 */
export const MAX_REDIRECTS = 3;

/** 取りに行ってよい URL か: https・気象庁の置き場のホスト・ポートと利用者名の無い物 */
export function jmaUrlAllowed(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.port !== "" || u.username !== "" || u.password !== "") return false;
  const host = u.hostname.toLowerCase();
  return JMA_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

export type FeedEntry = {
  /** Atom の entry の id（電文の URL と同じ） */
  id: string;
  title: string;
  /** updated を UTC の ISO にした物 */
  updated: string;
  /** 電文の URL（link の href） */
  url: string;
  /** 電文の種類（VPWW54・VXSE53 など）。URL から読めなければ null */
  typeCode: string | null;
};

/** 電文の URL から種類を読む（「…/20261104010000_0_VPWW54_380000.xml」→「VPWW54」） */
export function typeCodeOf(url: string): string | null {
  const m = /_([A-Z]{4}\d{2})_[^/_]*\.xml$/.exec(url);
  return m ? m[1] : null;
}

/** Atom のフィードを読む。壊れていれば投げる。id・updated・link の無い entry は飛ばす */
export function parseFeed(xml: string): FeedEntry[] {
  const doc = parseXml(xml);
  const feed = children(doc, "feed")[0];
  if (!feed) throw new Error("Atom の feed が無い");
  return children(feed, "entry").flatMap((e) => {
    const id = childText(e, "id");
    const updated = isoOf(childText(e, "updated"));
    const links = children(e, "link");
    const link = links.find((l) => attr(l, "type") === "application/xml") ?? links[0];
    const url = attr(link, "href") ?? id;
    if (!id || !updated || !url) return [];
    return [{ id, title: childText(e, "title"), updated, url, typeCode: typeCodeOf(url) }];
  });
}

/**
 * 取る電文を選ぶ: 種類が対象（警報・注意報と地震。labels の priorityOf）で、まだ取っていない物を、
 * 種類の順 → 古い順に並べて budget 件まで。残り（次の回に回す数）も返す
 */
export function pickNew(
  entries: ReadonlyArray<FeedEntry>,
  known: ReadonlySet<string>,
  budget: number,
): { take: FeedEntry[]; deferred: number } {
  const wanted = entries
    // 気象庁の置き場でない URL の entry は取らない（数えもしない。次の回にも残さない）
    .filter((e) => priorityOf(e.typeCode) !== null && !known.has(e.id) && jmaUrlAllowed(e.url))
    .sort((a, b) => priorityOf(a.typeCode)! - priorityOf(b.typeCode)! || a.updated.localeCompare(b.updated) || a.id.localeCompare(b.id));
  // 同じ id が 2 度載っていても 1 回だけ
  const seen = new Set<string>();
  const unique = wanted.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  const n = Math.max(0, budget);
  return { take: unique.slice(0, n), deferred: Math.max(0, unique.length - n) };
}

/** fetch の形（配信は globalThis.fetch、テストは偽物） */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type FeedFetch =
  | { kind: "not_modified" }
  | { kind: "ok"; text: string; lastModified: string | null }
  | { kind: "error"; note: string };

/** 失敗の理由の言葉（URL や中身は入れない） */
export const FETCH_NOTES = {
  host: "気象庁の外の URL",
  redirects: "移りが多い",
  large: "本文が大きすぎる",
} as const;

/**
 * 気象庁の置き場だけを取りに行く。移り（3xx。304 は除く）は Location を同じ決まりで確かめてから MAX_REDIRECTS 回までたどる。
 * 決まりの外なら取りに行かずに理由
 */
async function fetchJmaUrl(url: string, headers: Record<string, string>, fetcher: Fetcher): Promise<{ ok: true; res: Response } | { ok: false; note: string }> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let at = url;
  for (let hop = 0; ; hop++) {
    if (!jmaUrlAllowed(at)) return { ok: false, note: FETCH_NOTES.host };
    const res = await fetcher(at, { headers, redirect: "manual", signal });
    const location = res.status >= 300 && res.status < 400 && res.status !== 304 ? res.headers.get("Location") : null;
    if (location === null) return { ok: true, res };
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) return { ok: false, note: FETCH_NOTES.redirects };
    at = new URL(location, at).href;
  }
}

/** 本文を上限まで読む。Content-Length が上限を超えれば読まない。読みながら数えて超えたら切る */
export async function readCapped(res: Response, max: number = MAX_BODY_BYTES): Promise<{ ok: true; text: string } | { ok: false; note: string }> {
  const declared = Number(res.headers.get("Content-Length") ?? "");
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    return { ok: false, note: FETCH_NOTES.large };
  }
  if (!res.body) return { ok: true, text: "" };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, note: FETCH_NOTES.large };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(all) };
}

/** フィードを取る。前回の Last-Modified があれば If-Modified-Since を付ける */
export async function fetchFeed(url: string, lastModified: string | null, fetcher: Fetcher): Promise<FeedFetch> {
  const headers: Record<string, string> = {};
  if (lastModified) headers["If-Modified-Since"] = lastModified;
  try {
    const got = await fetchJmaUrl(url, headers, fetcher);
    if (!got.ok) return { kind: "error", note: got.note };
    const res = got.res;
    if (res.status === 304) return { kind: "not_modified" };
    if (!res.ok) return { kind: "error", note: `HTTP ${res.status}` };
    const body = await readCapped(res);
    if (!body.ok) return { kind: "error", note: body.note };
    return { kind: "ok", text: body.text, lastModified: res.headers.get("Last-Modified") };
  } catch (e) {
    return { kind: "error", note: errorNote(e) };
  }
}

/** 電文を取る。取れなければ理由（次の回にまた取る） */
export async function fetchText(url: string, fetcher: Fetcher): Promise<{ ok: true; text: string } | { ok: false; note: string }> {
  try {
    const got = await fetchJmaUrl(url, {}, fetcher);
    if (!got.ok) return got;
    const res = got.res;
    if (!res.ok) return { ok: false, note: `HTTP ${res.status}` };
    return await readCapped(res);
  } catch (e) {
    return { ok: false, note: errorNote(e) };
  }
}

/** 失敗の理由（短く。URL や中身は入れない） */
export function errorNote(e: unknown): string {
  const name = e instanceof Error ? e.name : "Error";
  const msg = e instanceof Error ? e.message : String(e);
  return `${name}: ${msg}`.slice(0, 160);
}
