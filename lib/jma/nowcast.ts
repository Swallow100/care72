// 雨雲（降水ナウキャスト）の画像を加工せずに地図に重ねる（T72 の 4）。旗 JMA_NOWCAST が "on" のときだけ動く（既定は off）。
// 気象庁の bosai/ の JSON とタイルは名指しの文書が無く、仕様は非公開で予告なく変わりうる（jma-terms）。作者が本物で確かめてから on にする。
// - ブラウザは気象庁を直接読まない: 時刻の一覧（targetTimes_N1.json）とタイルは Workers の route（app/api/jma/nowc）が取り、Cache API で写して配る
//   （時刻 2 分・タイル 5 分）。キャッシュの鍵は気象庁の URL そのもの
// - 出すのは時刻の一覧の一番新しい実況（basetime と validtime が同じ物）の 1 枚だけ。補間・延長・動画・予報の時刻にしない
// - タイルのズームは 5〜10、時刻は一覧にある物だけ（それ以外は 404）。ログインしていなければ 401、旗が off なら何もせず 404
// - 凡例は地図の右下の小さな色の帯（lib/map/rain-scale.ts の 8 段、components/map/RainScaleLegend.tsx）。気象庁の凡例の画像は読まない
//   （T151。前は画像をそのまま出し、時刻と出典の 1 文と合わせた白い四角が小さな地図の半分ほどを隠した）。出典は地図の下の出典の行
// 雨量から危険度を作らない。色と連絡順には使わない。

/** 時刻の一覧（実況。basetime・validtime は UTC の YYYYMMDDhhmmss、要素 hrpns） */
export const NOWC_TIMES_URL = "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json";
/** 重ねる要素（降水強度） */
export const NOWC_ELEMENT = "hrpns";
/** タイルのズームの範囲（地図がこれより寄ると、段 10 のタイルを引き伸ばして並べる） */
export const NOWC_ZOOM = { minZ: 5, maxZ: 10 } as const;
/** Cache API で写す秒数 */
export const NOWC_TIMES_TTL = 120;
export const NOWC_TILE_TTL = 300;
/** 出典（jma-terms の「出典の書き方の例」から、推計震度を出さないので雨雲だけ）。地図の下の出典の行に出す（T151 で右下の凡例から移した） */
export const NOWC_SOURCE = {
  text: "雨雲：気象庁ホームページ（https://www.jma.go.jp/bosai/nowc/）／背景：地理院タイル",
  href: "https://www.jma.go.jp/bosai/nowc/",
} as const;

/** 画面の route（ブラウザが読む所） */
export const NOWC_TIMES_PATH = "/api/jma/nowc/times";
export const nowcTilePath = (t: NowcTime, z: number, x: number, y: number) => `/api/jma/nowc/tile/${t.basetime}/${t.validtime}/${z}/${x}/${y}`;

/** 気象庁のタイルの URL */
export function nowcTileUpstream(t: NowcTime, z: number, x: number, y: number): string {
  return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${t.basetime}/none/${t.validtime}/surf/${NOWC_ELEMENT}/${z}/${x}/${y}.png`;
}

export type NowcTime = { basetime: string; validtime: string };

const STAMP = /^\d{14}$/;

export function isNowcTime(v: unknown): v is NowcTime {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.basetime === "string" && typeof o.validtime === "string" && STAMP.test(o.basetime) && STAMP.test(o.validtime);
}

/** 時刻の一覧を読む（降水強度の要素を持つ物だけ）。形が違えば空 */
export function parseTimes(json: unknown): NowcTime[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((e) => {
    if (!isNowcTime(e)) return [];
    const elements = (e as { elements?: unknown }).elements;
    if (Array.isArray(elements) && !elements.includes(NOWC_ELEMENT)) return [];
    return [{ basetime: e.basetime, validtime: e.validtime }];
  });
}

/** 一番新しい実況（basetime と validtime が同じ物）。無ければ null（予報の時刻は使わない） */
export function latestTime(times: ReadonlyArray<NowcTime>): NowcTime | null {
  const obs = times.filter((t) => t.basetime === t.validtime).sort((a, b) => b.basetime.localeCompare(a.basetime));
  return obs[0] ?? null;
}

/** 時刻（UTC の YYYYMMDDhhmmss）を日本の時刻の HH:MM に */
export function stampHm(stamp: string): string {
  if (!STAMP.test(stamp)) return stamp;
  const t = Date.UTC(+stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8), +stamp.slice(8, 10), +stamp.slice(10, 12)) + 9 * 3_600_000;
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** 旗（wrangler.jsonc の vars に書かず、ダッシュボードで入れる。手元は .dev.vars） */
export function nowcastOn(env: { JMA_NOWCAST?: string } | null | undefined): boolean {
  return env?.JMA_NOWCAST === "on";
}

export type TileParams = NowcTime & { z: number; x: number; y: number };

/** タイルの route の値を確かめる（時刻は 14 桁、ズームは 5〜10、x・y はその段の範囲の整数）。違えば null */
export function tileParams(p: Record<string, string | undefined>): TileParams | null {
  const { basetime, validtime } = p;
  if (!basetime || !validtime || !STAMP.test(basetime) || !STAMP.test(validtime)) return null;
  const int = (s: string | undefined) => (s !== undefined && /^\d{1,7}$/.test(s) ? Number(s) : NaN);
  const z = int(p.z);
  const x = int(p.x);
  const y = int(p.y);
  if (!(z >= NOWC_ZOOM.minZ && z <= NOWC_ZOOM.maxZ)) return null;
  const n = 2 ** z;
  if (!(x >= 0 && x < n && y >= 0 && y < n)) return null;
  return { basetime, validtime, z, x, y };
}

// ---------- route の中身（テストは偽の fetch と偽の Cache を渡す） ----------

/** Cache API のうち使う所（配信は caches.default。手元の next dev では無いので null） */
export type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

export type NowcFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type NowcContext = { on: boolean; authed: boolean; fetcher: NowcFetcher; cache: CacheLike | null };

/** Workers の caches.default（無ければ null） */
export function defaultCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches;
  return c?.default ?? null;
}

/** 写しがあればそれ、無ければ取って写す。取れなければ null */
async function cached(url: string, ttl: number, type: string, ctx: NowcContext): Promise<Response | null> {
  const key = new Request(url);
  const hit = await ctx.cache?.match(key);
  if (hit) return hit;
  let res: Response;
  try {
    res = await ctx.fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = await res.arrayBuffer();
  const out = new Response(body, { headers: { "Content-Type": type, "Cache-Control": `public, max-age=${ttl}` } });
  await ctx.cache?.put(key, out.clone());
  return out;
}

/** 時刻の一覧（2 分写す） */
export async function loadTimes(ctx: NowcContext): Promise<NowcTime[]> {
  const res = await cached(NOWC_TIMES_URL, NOWC_TIMES_TTL, "application/json", ctx);
  if (!res) return [];
  try {
    return parseTimes(JSON.parse(await res.text()));
  } catch {
    return [];
  }
}

const gate = (ctx: NowcContext): Response | null => {
  if (!ctx.on) return new Response("", { status: 404 });
  if (!ctx.authed) return new Response("", { status: 401 });
  return null;
};

/** GET /api/jma/nowc/times: 一番新しい実況の 1 つ（{ basetime, validtime }） */
export async function timesResponse(ctx: NowcContext): Promise<Response> {
  const shut = gate(ctx);
  if (shut) return shut;
  const latest = latestTime(await loadTimes(ctx));
  if (!latest) return new Response("", { status: 503 });
  return Response.json(latest, { headers: { "Cache-Control": "private, max-age=60" } });
}

/** GET /api/jma/nowc/tile/[basetime]/[validtime]/[z]/[x]/[y]: タイルの PNG（5 分写す）。時刻は一覧にある物だけ */
export async function tileResponse(params: Record<string, string | undefined>, ctx: NowcContext): Promise<Response> {
  const shut = gate(ctx);
  if (shut) return shut;
  const p = tileParams(params);
  if (!p) return new Response("", { status: 404 });
  const times = await loadTimes(ctx);
  if (!times.some((t) => t.basetime === p.basetime && t.validtime === p.validtime)) return new Response("", { status: 404 });
  const res = await cached(nowcTileUpstream(p, p.z, p.x, p.y), NOWC_TILE_TTL, "image/png", ctx);
  if (!res) return new Response("", { status: 404 });
  return new Response(res.body, { headers: { "Content-Type": "image/png", "Cache-Control": `private, max-age=${NOWC_TILE_TTL}` } });
}
