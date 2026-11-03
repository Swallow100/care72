// 気象庁のフィードを取って D1 に写す 1 回（T72）。cron（lib/jma/cron.ts）が 5 分ごとに呼ぶ。手元の道具（tools/jma/local.ts）は
// fixtures の XML を返す偽の fetch を渡して、同じ道で手元の D1 に写す（本物には繋がない）。
// 1. 7 日より古い電文を消す
// 2. 地震（eqvol）→ 警報など（extra）の順に、フィードを If-Modified-Since つきで取る（304 なら何もしない）
// 3. 対象の電文（警報・注意報と地震）のうち、まだ取っていない物を上限まで取って読み、事業所と利用者の市に当たる行だけ写す
// 読めない電文は記録に 1 行（note）残して捨てる（次の回も取らない）。取れなかった電文は記録せず、次の回にまた取る。
// 残りがあるときは Last-Modified を前のまま残す（304 で残りを取りこぼさない）。Claude は呼ばない。色と連絡順には使わない。

import type { D1Database } from "@cloudflare/workers-types";
import type { JmaEntryRow, JmaFeed } from "../db/types.ts";
import { errorNote, fetchFeed, fetchText, MAX_ENTRIES_PER_RUN, parseFeed, pickNew, type FeedEntry, type Fetcher } from "./feed.ts";
import { isQuakeCode, isWarningCode, JMA_FEED_URLS, priorityOf } from "./labels.ts";
import { cityOf } from "./match.ts";
import { parseQuake } from "./quake.ts";
import { knownIds, loadFetchState, pruneOld, relevantCities, saveFetchState, storeEntries, type StoredEntry } from "./store.ts";
import { parseWarning } from "./warning.ts";

/** 取る順（地震を先に。電文の上限を 2 つのフィードで分ける） */
export const FEED_ORDER: readonly JmaFeed[] = ["eqvol", "extra"];

/** 同時に取る電文の数 */
const PARALLEL = 6;

export type FeedRun = {
  feed: JmaFeed;
  status: "ok" | "not_modified" | "error";
  /** 写した電文（読めなかった物も含む） */
  stored: number;
  /** 読めなかった電文 */
  unreadable: number;
  /** 取れなかった電文（次の回に） */
  failed: number;
  /** 上限で次の回に回した電文 */
  deferred: number;
  note: string | null;
};

/** 電文 1 通を読んで、写す形にする。読めなければ note を付けた記録だけ */
export function toStored(feed: JmaFeed, e: FeedEntry, xml: string, now: string, cities: ReadonlyArray<string>): StoredEntry {
  const code = e.typeCode ?? "";
  const entry: JmaEntryRow = { id: e.id, feed, type_code: code, title: e.title, updated_at: e.updated, fetched_at: now, note: null };
  const only = (note: string): StoredEntry => ({ entry: { ...entry, note }, warnings: [], quake: null, points: [] });
  try {
    if (isWarningCode(code)) {
      const r = parseWarning(xml);
      if (r.status !== "通常") return only(`${r.status || "不明"}の電文`);
      if (r.infoType === "取消") return only("取消");
      const warnings = r.items
        .filter((i) => cityOf(cities, i.areaName) !== null)
        .map((i) => ({
          entry_id: e.id,
          type_code: code,
          area_code: i.areaCode,
          area_name: i.areaName,
          kind: i.kind,
          status: i.status,
          issued_at: r.issuedAt,
          office_name: r.officeName,
          sort: i.sort,
        }));
      return { entry, warnings, quake: null, points: [] };
    }
    if (isQuakeCode(code)) {
      const q = parseQuake(xml);
      if (q.status !== "通常") return only(`${q.status || "不明"}の電文`);
      return {
        entry,
        warnings: [],
        quake: {
          entry_id: e.id,
          type_code: code,
          event_id: q.eventId,
          info_type: q.infoType,
          report_at: q.reportAt,
          origin_at: q.originAt,
          hypocenter: q.hypocenter,
          magnitude: q.magnitude,
          max_intensity: q.maxIntensity,
        },
        points: q.points
          .filter((p) => cityOf(cities, p.areaName) !== null)
          .map((p) => ({ entry_id: e.id, area_name: p.areaName, point_name: p.pointName, intensity: p.intensity })),
      };
    }
    return only("対象外の種類");
  } catch (err) {
    const note = errorNote(err);
    console.log("気象庁の電文が読めない", code, e.id, note);
    return only(`読めない: ${note}`);
  }
}

async function runFeed(db: D1Database, feed: JmaFeed, fetcher: Fetcher, now: string, cities: ReadonlyArray<string>, budget: number): Promise<FeedRun> {
  const prev = await loadFetchState(db, feed);
  const base: FeedRun = { feed, status: "ok", stored: 0, unreadable: 0, failed: 0, deferred: 0, note: null };
  const fail = async (note: string): Promise<FeedRun> => {
    await saveFetchState(db, { feed, last_modified: prev?.last_modified ?? null, fetched_at: now, ok: 0, ok_at: prev?.ok_at ?? null, note });
    return { ...base, status: "error", note };
  };

  const got = await fetchFeed(JMA_FEED_URLS[feed], prev?.last_modified ?? null, fetcher);
  if (got.kind === "error") return fail(got.note);
  if (got.kind === "not_modified") {
    await saveFetchState(db, { feed, last_modified: prev?.last_modified ?? null, fetched_at: now, ok: 1, ok_at: now, note: null });
    return { ...base, status: "not_modified" };
  }

  let entries: FeedEntry[];
  try {
    entries = parseFeed(got.text);
  } catch (e) {
    return fail(`フィードが読めない: ${errorNote(e)}`);
  }
  const known = await knownIds(
    db,
    entries.filter((e) => priorityOf(e.typeCode) !== null).map((e) => e.id),
  );
  const { take, deferred } = pickNew(entries, known, budget);

  const stored: StoredEntry[] = [];
  let failed = 0;
  for (let i = 0; i < take.length; i += PARALLEL) {
    const part = take.slice(i, i + PARALLEL);
    const texts = await Promise.all(part.map((e) => fetchText(e.url, fetcher)));
    texts.forEach((t, j) => {
      if (t.ok) stored.push(toStored(feed, part[j], t.text, now, cities));
      else failed++;
    });
  }
  await storeEntries(db, stored);

  const left = deferred + failed;
  await saveFetchState(db, {
    feed,
    // 残りがあれば前の Last-Modified のまま（次の回もフィードを全部受け取って残りを取る）
    last_modified: left === 0 ? got.lastModified : (prev?.last_modified ?? null),
    fetched_at: now,
    ok: 1,
    ok_at: now,
    note: left === 0 ? null : `残り ${left} 件`,
  });
  return {
    ...base,
    stored: stored.length,
    unreadable: stored.filter((s) => s.entry.note !== null).length,
    failed,
    deferred,
    note: left === 0 ? null : `残り ${left} 件`,
  };
}

/** 取る 1 回。2 つのフィードの結果 */
export async function fetchJma(db: D1Database, fetcher: Fetcher, now: string): Promise<FeedRun[]> {
  await pruneOld(db, now);
  const cities = await relevantCities(db);
  let budget = MAX_ENTRIES_PER_RUN;
  const out: FeedRun[] = [];
  for (const feed of FEED_ORDER) {
    const r = await runFeed(db, feed, fetcher, now, cities, budget);
    budget -= r.stored + r.failed;
    out.push(r);
  }
  return out;
}
