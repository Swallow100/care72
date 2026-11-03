// 防災情報 XML の PULL 型のフィード（Atom）を読む・取る（T72）。cron（lib/jma/cron.ts）が 5 分ごとに 1 か所で呼ぶ。
// - entry ごとに id・title・updated・link（電文の URL）を出す。電文の種類は URL の中の文字（…_VPWW54_380000.xml）で見分ける
// - 取るときは If-Modified-Since（前回の Last-Modified）を付け、304 なら何もしない
// - fetch は redirect: "follow"（"error" は Workers で毎回投げる）。待つのは 10 秒まで
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
    .filter((e) => priorityOf(e.typeCode) !== null && !known.has(e.id))
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

/** フィードを取る。前回の Last-Modified があれば If-Modified-Since を付ける */
export async function fetchFeed(url: string, lastModified: string | null, fetcher: Fetcher): Promise<FeedFetch> {
  const headers: Record<string, string> = {};
  if (lastModified) headers["If-Modified-Since"] = lastModified;
  try {
    const res = await fetcher(url, { headers, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.status === 304) return { kind: "not_modified" };
    if (!res.ok) return { kind: "error", note: `HTTP ${res.status}` };
    return { kind: "ok", text: await res.text(), lastModified: res.headers.get("Last-Modified") };
  } catch (e) {
    return { kind: "error", note: errorNote(e) };
  }
}

/** 電文を取る。取れなければ理由（次の回にまた取る） */
export async function fetchText(url: string, fetcher: Fetcher): Promise<{ ok: true; text: string } | { ok: false; note: string }> {
  try {
    const res = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, note: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
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
