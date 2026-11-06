// 事業所の画面（/office）の気象庁の欄の中身（T72 の 2）。D1 の写し（lib/jma/store.ts）だけを読む（気象庁には繋がない）。
// T154: どの市町村等の発表を読むかは、全国の市区町村の表の団体コードから気象庁の市町村等のコード（電文の Area の Code）で決める
// （lib/office/area.ts の officeAreaOf。名前の文字の突き合わせは、表に当たらない市〔前の形の文字・表に無い住所〕だけに残す）。
// - 警報・注意報: 事業所の地域の市（主な市 → 周りの市。T148、lib/office/region.ts）と、利用者の住所の市に今出ている物を、
//   名前・市町村・状態・発表時刻・発表官署のまま。
//   今の状態は (市町村, 電文の種類) ごとに一番新しい発表の行。同じ市町村に新しい体系（VPWW55〜61）があればそれだけ、無ければ VPWW54、
//   無ければ VPWW53（経過措置の電文と同じ発表を 2 つの呼び方で並べない。docs/progress/t72.md の問い）。解除と発表なしは出さない
// - 該当: 住所の市がその市町村に当たる利用者の数（名前は出さない。一覧から外した人は数えない）
// - 地震: 直近 24 時間の地震で、事業所と利用者の市の観測点の震度があれば、震源・規模・市ごとの最大の観測点（名前を添える）
// - 取得: 2 つのフィードが最後に取れた時刻。どちらかが失敗・20 分より古い・一度も無いなら未取得
// 警報・震度を色と連絡順の入力にしない。災害モードは切り替えない（画面が「切替」を勧めるだけ）。

import type { D1Database } from "@cloudflare/workers-types";
import { JMA_FEEDS, type JmaFetchStateRow, type JmaQuakePointRow, type JmaQuakeRow, type JmaWarningRow } from "../db/types.ts";
import { isWarningKind, WARNING_CODES_NEW } from "./labels.ts";
import { sameCity, uniqueCities } from "./match.ts";
import { loadFetchStates } from "./store.ts";
import { municipalityGeo } from "../municipality/geo.ts";
import { OFFICE_AREA_COLUMNS, officeAreaOf, peopleCitiesOf, peopleCounts, type OfficeAreaRow } from "../office/area.ts";

/** 取得がこれより古ければ未取得（cron は 5 分ごと。3 回続けて取れていない） */
export const STALE_MINUTES = 20;
/** 地震を出す時間（発生から） */
export const QUAKE_HOURS = 24;
/** 地震を出す数（新しい順） */
export const QUAKE_MAX = 3;

export type JmaAlertRow = {
  /** 種類の名前（電文のまま） */
  kind: string;
  /** 発表・継続など（電文のまま） */
  status: string;
  areaName: string;
  areaCode: string;
  /** 発表時刻（UTC の ISO） */
  issuedAt: string;
  officeName: string;
  typeCode: string;
  /** 住所の市がこの市町村に当たる利用者の数 */
  people: number;
  /** 警報（注意報でない物） */
  warning: boolean;
};

export type JmaQuakeCity = { city: string; intensity: string; point: string };

export type JmaQuakeLine = {
  eventId: string;
  /** 発生時刻（無ければ発表時刻） */
  at: string;
  hypocenter: string | null;
  magnitude: string | null;
  /** 市ごとの最大の観測点（事業所の市が先） */
  cities: JmaQuakeCity[];
};

export type JmaAlertsData = {
  /** 2 つのフィードが新しく取れているか、最後に取れた時刻（古い方。一度も無ければ null） */
  fetch: { ok: boolean; at: string | null };
  rows: JmaAlertRow[];
  quakes: JmaQuakeLine[];
  /** 住所の市が入っていない利用者の数（突き合わせに入らない） */
  noCity: number;
};

/** 空の欄（読めないとき） */
export const EMPTY_ALERTS: JmaAlertsData = { fetch: { ok: false, at: null }, rows: [], quakes: [], noCity: 0 };

/** 取得の状態（2 つのフィードの古い方） */
export function fetchStatus(states: ReadonlyArray<Pick<JmaFetchStateRow, "feed" | "ok" | "ok_at">>, now: string): JmaAlertsData["fetch"] {
  const byFeed = new Map(states.map((s) => [s.feed, s]));
  const at = JMA_FEEDS.flatMap((f) => byFeed.get(f)?.ok_at ?? []).sort()[0] ?? null;
  const fresh = (t: string | null) => t !== null && Date.parse(now) - Date.parse(t) <= STALE_MINUTES * 60_000;
  const ok = JMA_FEEDS.every((f) => byFeed.get(f)?.ok === 1 && fresh(byFeed.get(f)?.ok_at ?? null));
  return { ok, at };
}

type WarningWithEntry = JmaWarningRow & { entry_updated: string };

/** 電文の種類の組（新しい体系 0、VPWW54 1、VPWW53 2）。同じ市町村では小さい組だけ使う */
function schemeOf(code: string): number {
  return WARNING_CODES_NEW.includes(code) ? 0 : code === "VPWW54" ? 1 : 2;
}

/**
 * 今の警報・注意報（市の順 → 電文の種類 → 電文の中の並び）。codes は気象庁の市町村等のコード（事業所の地域が先。T154）、
 * cities は表に当たらない市の名前（名前で突き合わせる）。どちらかに当たる行だけ。
 * (市町村, 電文の種類) ごとに一番新しい発表（発表時刻 → 電文の時刻 → id）の行だけを使い、市町村ごとに一番新しい体系の組だけを残す
 */
export function currentWarnings(rows: ReadonlyArray<WarningWithEntry>, cities: ReadonlyArray<string>, codes: ReadonlyArray<string> = []): WarningWithEntry[] {
  const latest = new Map<string, { key: string; rows: WarningWithEntry[] }>();
  for (const r of rows) {
    if (!codes.includes(r.area_code) && !cities.some((c) => sameCity(c, r.area_name))) continue;
    const group = `${r.area_code}\u0000${r.type_code}`;
    const key = `${r.issued_at}\u0000${r.entry_updated}\u0000${r.entry_id}`;
    const cur = latest.get(group);
    if (!cur || key > cur.key) latest.set(group, { key, rows: [r] });
    else if (key === cur.key) cur.rows.push(r);
  }
  const byArea = new Map<string, WarningWithEntry[]>();
  for (const { rows: rs } of latest.values()) {
    const area = rs[0].area_code;
    byArea.set(area, [...(byArea.get(area) ?? []), ...rs]);
  }
  const out: WarningWithEntry[] = [];
  for (const rs of byArea.values()) {
    const best = Math.min(...rs.map((r) => schemeOf(r.type_code)));
    out.push(...rs.filter((r) => schemeOf(r.type_code) === best && r.kind !== "" && r.status !== "解除"));
  }
  const cityRank = (w: WarningWithEntry) => {
    const k = codes.indexOf(w.area_code);
    if (k >= 0) return k;
    const i = cities.findIndex((c) => sameCity(c, w.area_name));
    return codes.length + (i < 0 ? cities.length : i);
  };
  return out.sort(
    (a, b) =>
      cityRank(a) - cityRank(b) ||
      a.area_name.localeCompare(b.area_name, "ja") ||
      a.type_code.localeCompare(b.type_code) ||
      a.sort - b.sort,
  );
}

/** 震度の強さの順（電文の文字） */
const INTENSITY_ORDER = ["1", "2", "3", "4", "5-", "5+", "6-", "6+", "7"];
const intensityRank = (v: string) => INTENSITY_ORDER.indexOf(v);

/** 直近の地震のうち、市の観測点の震度がある物（新しい順に QUAKE_MAX まで）。取消の地震は出さない */
export function quakeLines(
  quakes: ReadonlyArray<JmaQuakeRow>,
  points: ReadonlyArray<JmaQuakePointRow>,
  cities: ReadonlyArray<string>,
  now: string,
): JmaQuakeLine[] {
  const cutoff = Date.parse(now) - QUAKE_HOURS * 3_600_000;
  const byEvent = new Map<string, JmaQuakeRow[]>();
  for (const q of quakes) byEvent.set(q.event_id, [...(byEvent.get(q.event_id) ?? []), q]);
  const out: JmaQuakeLine[] = [];
  for (const [eventId, reports] of byEvent) {
    const sorted = [...reports].sort((a, b) => b.report_at.localeCompare(a.report_at) || b.entry_id.localeCompare(a.entry_id));
    if (sorted[0].info_type === "取消") continue;
    const live = sorted.filter((r) => r.info_type !== "取消");
    const at = live.find((r) => r.origin_at)?.origin_at ?? live[live.length - 1].report_at;
    if (Date.parse(at) < cutoff) continue;
    const withPoints = live.find((r) => points.some((p) => p.entry_id === r.entry_id));
    if (!withPoints) continue;
    const mine = points.filter((p) => p.entry_id === withPoints.entry_id);
    const found: JmaQuakeCity[] = [];
    for (const city of cities) {
      const hit = mine.filter((p) => sameCity(city, p.area_name)).sort((a, b) => intensityRank(b.intensity) - intensityRank(a.intensity));
      if (hit.length > 0) found.push({ city, intensity: hit[0].intensity, point: hit[0].point_name });
    }
    if (found.length === 0) continue;
    const hypo = live.find((r) => r.hypocenter);
    out.push({ eventId, at, hypocenter: hypo?.hypocenter ?? null, magnitude: hypo?.magnitude ?? null, cities: found });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, QUAKE_MAX);
}

/** 事業所の地域と利用者の住所の市から、読む市町村等のコード・名前で突き合わせる市・地震の市・利用者の数え方を決める（T154） */
export function alertTargets(row: OfficeAreaRow | undefined, people: ReadonlyArray<{ city: string; count: number }>) {
  const area = row ? officeAreaOf(row) : null;
  const ps = peopleCitiesOf({ pref: area?.pref ?? null }, people);
  const personCodes = (p: (typeof ps)[number]) => (p.municipality ? (municipalityGeo(p.municipality.code)?.jmaCodes ?? []) : []);
  // 気象庁の市町村等のコード: 事業所の地域（主な市 → 周りの市）が先、次に利用者の住所の市
  const codes = [...new Set([...(area?.jmaCodes ?? []), ...ps.flatMap(personCodes)])];
  // 名前で突き合わせるのは表に当たらない市だけ（同じ名前の別の県の市を拾わない）
  const names = uniqueCities([
    ...(area && !area.main ? [area.mainText] : []),
    ...(area?.unmatched ?? []),
    ...ps.filter((p) => !p.municipality).map((p) => p.city),
  ]);
  // 地震の観測点（市の名前の電文）と表示の市: 地域の市 → 利用者の市
  const cities = uniqueCities([...(area?.cities ?? []), ...ps.map((p) => p.city)]);
  const peopleIn = (areaCode: string, areaName: string) =>
    ps.filter((p) => (p.municipality ? personCodes(p).includes(areaCode) : sameCity(p.city, areaName))).reduce((n, p) => n + p.count, 0);
  return { codes, names, cities, peopleIn };
}

const PEOPLE_CITIES_SQL =
  "SELECT json_extract(ledger, '$.basic.address.city') AS city, count(*) AS n FROM people WHERE office_id = ?1 AND unlisted_at IS NULL GROUP BY 1";

/** 事業所の気象庁の欄を読む */
export async function loadJmaAlerts(db: D1Database, officeId: string, now: string): Promise<JmaAlertsData> {
  const [office, people] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${OFFICE_AREA_COLUMNS} FROM offices WHERE id = ?1`).bind(officeId),
    db.prepare(PEOPLE_CITIES_SQL).bind(officeId),
  ]);
  const counts = peopleCounts(people.results).map((c) => ({ ...c, city: c.city.trim() }));
  const noCity = counts.filter((c) => c.city === "").reduce((n, c) => n + c.count, 0);
  const t = alertTargets(office.results[0] as OfficeAreaRow | undefined, counts);
  if (t.codes.length === 0 && t.cities.length === 0) return { ...EMPTY_ALERTS, noCity };

  const cutoff = new Date(Date.parse(now) - QUAKE_HOURS * 3_600_000).toISOString();
  const [warnings, quakes, points] = await db.batch<Record<string, unknown>>([
    // 市町村等のコードが当たる行と、表に当たらない市の名前と同じか、市の名前で始まり区で終わる市町村（細かい当てはめは sameCity）
    db
      .prepare(
        `SELECT w.*, e.updated_at AS entry_updated FROM jma_warnings w JOIN jma_entries e ON e.id = w.entry_id
          WHERE w.area_code IN (SELECT value FROM json_each(?1))
             OR EXISTS (SELECT 1 FROM json_each(?2) c
                         WHERE w.area_name = c.value OR (substr(w.area_name, 1, length(c.value)) = c.value AND w.area_name LIKE '%区'))`,
      )
      .bind(JSON.stringify(t.codes), JSON.stringify(t.names)),
    db.prepare("SELECT * FROM jma_quakes WHERE COALESCE(origin_at, report_at) >= ?1").bind(cutoff),
    db.prepare("SELECT p.* FROM jma_quake_points p JOIN jma_quakes q ON q.entry_id = p.entry_id WHERE COALESCE(q.origin_at, q.report_at) >= ?1").bind(cutoff),
  ]);
  const states = await loadFetchStates(db);

  const rows = currentWarnings(warnings.results as unknown as WarningWithEntry[], t.names, t.codes).map(
    (w): JmaAlertRow => ({
      kind: w.kind,
      status: w.status,
      areaName: w.area_name,
      areaCode: w.area_code,
      issuedAt: w.issued_at,
      officeName: w.office_name,
      typeCode: w.type_code,
      people: t.peopleIn(w.area_code, w.area_name),
      warning: isWarningKind(w.kind),
    }),
  );
  return {
    fetch: fetchStatus(states, now),
    rows,
    quakes: quakeLines(quakes.results as unknown as JmaQuakeRow[], points.results as unknown as JmaQuakePointRow[], t.cities, now),
    noCity,
  };
}

/** 上の帯の警報（地域の市と利用者の市に今出ている警報。注意報は数えない）。kinds は種類の名前（重ねない、出た順） */
export type RegionWarnings = { count: number; kinds: string[] };

export const NO_REGION_WARNINGS: RegionWarnings = { count: 0, kinds: [] };

/**
 * 上の帯の 1 回の往復のための、写しの行のあらい絞り込み（?1 は事業所）: 事業所の団体コードの都道府県の行と、事業所の市・周りの市・
 * 利用者の住所の市の名前で始まる市町村の行（区のある市・浜松市南部のような分かれた市も入る）。細かい当てはめは alertTargets と currentWarnings
 */
const ROUGH_SQL = `substr(w.area_code, 1, 2) IN (
      SELECT substr(o.city_code, 1, 2) FROM offices o WHERE o.id = ?1 AND o.city_code IS NOT NULL
      UNION SELECT substr(j.value, 1, 2) FROM offices o, json_each(CASE WHEN json_valid(o.region_city_codes) THEN o.region_city_codes ELSE '[]' END) j WHERE o.id = ?1)
    OR EXISTS (SELECT 1 FROM (SELECT trim(c) AS c FROM (
        SELECT o.city AS c FROM offices o WHERE o.id = ?1
        UNION ALL SELECT j.value FROM offices o, json_each(CASE WHEN json_valid(o.region_cities) THEN o.region_cities ELSE '[]' END) j WHERE o.id = ?1
        UNION ALL SELECT json_extract(p.ledger, '$.basic.address.city') FROM people p WHERE p.office_id = ?1 AND p.unlisted_at IS NULL
      ) WHERE typeof(c) = 'text' AND trim(c) <> '') x
      WHERE substr(w.area_name, 1, length(x.c)) = x.c)`;

/**
 * 上の帯（components/AppHeader.tsx）に添える警報の数（T148）。気象庁の欄（loadJmaAlerts）と同じ所（alertTargets: 地域の市 → 利用者の市の
 * 市町村等のコード、表に当たらない市は名前）・同じ今の状態の決め方（currentWarnings）で、警報（注意報でない物）の行だけを数える。
 * D1 は 1 回の往復（batch）。表示だけで、災害モード・色・連絡順には使わない。取得の新しさは見ない（写しにある今の状態。欄の「未取得」と同じ物を見る）
 */
export async function loadRegionWarnings(db: D1Database, officeId: string): Promise<RegionWarnings> {
  const [office, people, warnings] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${OFFICE_AREA_COLUMNS} FROM offices WHERE id = ?1`).bind(officeId),
    db.prepare(PEOPLE_CITIES_SQL).bind(officeId),
    db.prepare(`SELECT w.*, e.updated_at AS entry_updated FROM jma_warnings w JOIN jma_entries e ON e.id = w.entry_id WHERE ${ROUGH_SQL}`).bind(officeId),
  ]);
  const o = office.results[0] as OfficeAreaRow | undefined;
  if (!o) return NO_REGION_WARNINGS;
  const t = alertTargets(o, peopleCounts(people.results));
  const rows = currentWarnings(warnings.results as unknown as WarningWithEntry[], t.names, t.codes).filter((w) => isWarningKind(w.kind));
  return { count: rows.length, kinds: uniqueCities(rows.map((r) => r.kind)) };
}
