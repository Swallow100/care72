// T183: 種の 10 人の避難先を実在の指定避難所（国土地理院のデータの名前と位置）にし、担当一覧の地図に計画の避難先の旗を出す。
// - 種のデータ: 施設の避難先は SEED_DESTINATIONS の名前と位置のまま、家から 5 km の中（経路地図の窓の候補の範囲）
// - 仮名化の門: 実の名前は字が変わらず（担当の人・家族・支援者の姓名と町名を含まない）、漏れの止めにも掛からない
// - 地図: 計画の避難先の旗は 6 本（福音小学校は 2 人）、位置の無い避難先は架空の病院と家族の家の 3 件
// - 毎朝 4 時の戻し（lib/seed/reset.ts）と確認用の事業所の写しで、位置が入り直す
// D1 は node:sqlite に種の全部（seed/full.ts）。

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fullSeedStatements } from "../../seed/full.ts";
import { SEED_DESTINATIONS, SEED_LOCATIONS, SEED_PEOPLE } from "../../seed/people.ts";
import { todayJst } from "../age.ts";
import { CHECK_CARE_MANAGER_ID, CHECK_OFFICE_ID, DEMO_CARE_MANAGER_ID, DEMO_OFFICE_ID } from "../auth/demo.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { officePlaces } from "../drill/area.ts";
import { RETIRED_DEMO_NAMES } from "../drill/area-demo.ts";
import { planPlaces } from "../map/side.ts";
import { distanceM } from "../map/route.ts";
import { cleanName, SHELTER_RADIUS_KM } from "../map/shelters.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { DAILY_RESET_CRON, scheduledReset } from "./cron.ts";
import type { SeedBucket } from "./reset.ts";

const SEED_NOW = "2026-11-06T00:00:00.000Z";
const FACILITIES = Object.values(SEED_DESTINATIONS);
const facilityOf = (name: string | undefined) => FACILITIES.find((f) => f.name === name) ?? null;

describe("種の避難先（施設は国土地理院のデータの名前と位置）", () => {
  it("施設の避難先は名前と位置が表のまま、家から 5 km の中。位置のある避難先は表の施設だけ", () => {
    const placed: string[] = [];
    for (const p of SEED_PEOPLE) {
      const e = p.ledger.evacuation;
      for (const [name, at] of [
        [e.destination1, e.destination1Location],
        [e.destination2, e.destination2Location],
      ] as const) {
        const f = facilityOf(name);
        if (!f) {
          expect(at, `${p.person.id} ${name}`).toBeUndefined();
          continue;
        }
        expect(at, `${p.person.id} ${name}`).toEqual(f.at);
        expect(distanceM(SEED_LOCATIONS[p.person.id], at!), `${p.person.id} ${name}`).toBeLessThanOrEqual(SHELTER_RADIUS_KM * 1000);
        placed.push(`${p.person.id}:${name}`);
      }
    }
    expect(placed).toEqual([
      "p-01:福音小学校",
      "p-03:学校法人松山聖陵学園 松山聖陵高等学校（体育館）",
      "p-06:福音小学校",
      "p-07:湯築小学校",
      "p-08:三津浜公民館",
      "p-10:潮見小学校",
      "p-10:潮見公民館",
    ]);
  });

  it("施設の名前は地図の地理院の名前と同じ形（制御文字・重ねた空白なし）、種の町名・やめた架空の地名を含まない", () => {
    const towns = SEED_PEOPLE.map((p) => p.ledger.basic.address?.town ?? "").filter(Boolean);
    for (const f of FACILITIES) {
      expect(cleanName(f.name)).toBe(f.name);
      for (const t of towns) expect(f.name.includes(t.replace(/(町|台|村)$/u, "")), `${f.name} ${t}`).toBe(false);
      for (const r of RETIRED_DEMO_NAMES) expect(f.name.includes(r), `${f.name} ${r}`).toBe(false);
    }
  });

  it("計画が未作成の 3 人（佐藤・伊藤・渡辺）は避難先を空けたまま", () => {
    for (const id of ["p-04", "p-05", "p-09"]) {
      const e = SEED_PEOPLE.find((p) => p.person.id === id)!.ledger.evacuation;
      expect([e.destination1, e.destination2, e.destination1Location, e.destination2Location], id).toEqual([undefined, undefined, undefined, undefined]);
    }
  });

  it("仮名化の門で実の名前の字が変わらない（氏名・町名の置き換えに掛からず、漏れの止めも出ない）", () => {
    const src = SEED_PEOPLE.map((p) => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks }));
    const places = officePlaces("office-demo", src.map((s) => s.ledger));
    const { payload } = pseudonymize(src, { places });
    payload.forEach((cp, i) => {
      const e = src[i].ledger.evacuation;
      for (const [sent, orig] of [
        [cp.evacuation.destination1, e.destination1],
        [cp.evacuation.destination2, e.destination2],
      ] as const) {
        if (facilityOf(orig ?? undefined)) expect(sent, `${src[i].person.id}`).toBe(orig);
      }
    });
  });
});

let statements: string[];
let sqlite: DatabaseSync;
let db: D1Database;

beforeAll(async () => {
  statements = await fullSeedStatements({ now: SEED_NOW });
}, 60_000);

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const x of statements) sqlite.exec(x);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

function fakeBucket(): SeedBucket {
  return {
    head: async () => null,
    list: async () => ({ objects: [], truncated: false }),
    delete: async () => {},
  };
}

async function places(officeId: string, careManagerId: string) {
  const list = await loadCaseload(db, { officeId, careManagerId }, todayJst(new Date(SEED_NOW)), SEED_NOW);
  if (!list) throw new Error("担当一覧が無い");
  return planPlaces(list.rows);
}

describe("担当一覧の地図の計画の避難先（種を入れた D1）", () => {
  it("旗は 6 本（福音小学校は山田・高橋の 2 人）、位置の無い避難先は 3 件（架空の病院・家族の家 2 つ）", async () => {
    for (const [office, cm] of [
      [DEMO_OFFICE_ID, DEMO_CARE_MANAGER_ID],
      [CHECK_OFFICE_ID, CHECK_CARE_MANAGER_ID],
    ] as const) {
      const p = await places(office, cm);
      expect(p.destinations.map((d) => [d.name, d.people.length]).sort(), office).toEqual(
        [
          ["福音小学校", 2],
          ["学校法人松山聖陵学園 松山聖陵高等学校（体育館）", 1],
          ["湯築小学校", 1],
          ["三津浜公民館", 1],
          ["潮見小学校", 1],
          ["潮見公民館", 1],
        ].sort(),
      );
      expect(p.unplaced, office).toBe(3);
    }
  });

  it("毎朝 4 時の戻しで、消した位置と動かした位置が種の値に戻る（確認用の事業所も）", async () => {
    sqlite.exec(
      `UPDATE people SET ledger = json_remove(ledger, '$.evacuation.destination1Location', '$.evacuation.destination2Location') WHERE office_id IN ('${DEMO_OFFICE_ID}', '${CHECK_OFFICE_ID}')`,
    );
    // 前の種の p-09 の位置（洪水の区域の中）
    sqlite.exec(`UPDATE people SET ledger = json_set(ledger, '$.basic.location', json('{"lat":33.8655,"lng":132.74}')) WHERE id = 'p-09'`);
    expect((await places(DEMO_OFFICE_ID, DEMO_CARE_MANAGER_ID)).destinations).toEqual([]);
    expect((await places(CHECK_OFFICE_ID, CHECK_CARE_MANAGER_ID)).destinations).toEqual([]);
    await scheduledReset({ DB: db, RECORDINGS: fakeBucket() }, DAILY_RESET_CRON, Date.parse(SEED_NOW));
    for (const [office, cm] of [
      [DEMO_OFFICE_ID, DEMO_CARE_MANAGER_ID],
      [CHECK_OFFICE_ID, CHECK_CARE_MANAGER_ID],
    ] as const) {
      const p = await places(office, cm);
      expect(p.destinations.find((d) => d.name === "潮見公民館")?.at, office).toEqual(SEED_DESTINATIONS.shiomiHall.at);
      expect(p.destinations).toHaveLength(6);
    }
    const p09 = sqlite.prepare("SELECT json_extract(ledger, '$.basic.location') AS at FROM people WHERE id = 'p-09'").get() as { at: string };
    expect(JSON.parse(p09.at)).toEqual(SEED_LOCATIONS["p-09"]);
  });
});
