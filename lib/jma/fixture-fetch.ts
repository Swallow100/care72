// fixtures の XML を返す偽の fetch（T72）。テストと手元の道具（tools/jma/local.ts）が、本物の気象庁の代わりに使う。配信のコードからは使わない。
// - 作った見本は lib/jma/fixtures/sample/（頭に「作った見本。本物の電文ではない」）。テストはこちらを使う
// - 作者が tools/jma/fetch-fixtures.mjs で取った本物は lib/jma/fixtures/real/（あれば手元の道具はこちらを使う）
// フィードの URL → <dir>/extra.xml・eqvol.xml、電文の URL → <dir>/data/<ファイル名>、雨雲の時刻 → <dir>/targetTimes_N1.json。ほかは 404。

import { existsSync, readFileSync } from "node:fs";
import type { Fetcher } from "./feed.ts";
import { JMA_FEED_URLS } from "./labels.ts";

export const SAMPLE_DIR = new URL("./fixtures/sample/", import.meta.url);
export const REAL_DIR = new URL("./fixtures/real/", import.meta.url);

/** 本物の写しがあればそれ、無ければ作った見本 */
export function fixtureDir(): URL {
  return existsSync(new URL("./extra.xml", REAL_DIR)) ? REAL_DIR : SAMPLE_DIR;
}

/** fixtures のファイルの中身（無ければ null） */
export function fixtureText(dir: URL, name: string): string | null {
  const file = new URL(name, dir);
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

export type FixtureFetchOptions = {
  /** フィードに付ける Last-Modified（If-Modified-Since が同じなら 304） */
  lastModified?: string;
  /** 呼ばれた URL を覚える */
  calls?: string[];
  /** URL ごとに中身を差し替える（壊れた電文など） */
  override?: (url: string) => Response | null;
};

/** fixtures を返す偽の fetch */
export function fixtureFetcher(dir: URL, opts: FixtureFetchOptions = {}): Fetcher {
  return async (url, init) => {
    opts.calls?.push(url);
    const o = opts.override?.(url);
    if (o) return o;
    const feed = (Object.entries(JMA_FEED_URLS) as Array<[string, string]>).find(([, u]) => u === url)?.[0];
    if (feed) {
      const since = new Headers(init?.headers).get("If-Modified-Since");
      if (opts.lastModified && since === opts.lastModified) return new Response(null, { status: 304 });
      const body = fixtureText(dir, `${feed}.xml`);
      if (body === null) return new Response("", { status: 404 });
      return new Response(body, { status: 200, headers: opts.lastModified ? { "Last-Modified": opts.lastModified } : {} });
    }
    const name = url.split("/").pop() ?? "";
    const isTimes = name === "targetTimes_N1.json";
    const body = fixtureText(dir, isTimes ? name : `data/${name}`);
    if (body === null) return new Response("", { status: 404 });
    return new Response(body, { status: 200, headers: { "Content-Type": isTimes ? "application/json" : "application/xml" } });
  };
}
