// T170: 仮想モードの地理を実の物に。架空の町・川・道の種をやめ、出来事はピンの位置で人に当て、Claude には別名か仮名で渡す。
// 本物の API を呼ばない（偽の fetch と手で組んだ返事だけ）。

import { describe, expect, it } from "vitest";
import { GUARDS } from "../../tools/eval/guards.ts";
import { metaOf } from "../../tools/eval/drill/findings.ts";
import { worldPlaceHits } from "../../tools/eval/drill/checks.ts";
import type { RunOutcome } from "../../tools/eval/drill/drive.ts";
import type { Ledger } from "../db/types.ts";
import { findLeaks, pseudonymize, pseudonymizeText, restoreText } from "../pseudonym/index.ts";
import { formLeaks } from "../pseudonym/forms.ts";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { areaOf, DEMO_AREA, geographyText, placesOf, RETIRED_DEMO_NAMES, townOfLedger, townOfPin } from "./area.ts";
import { VIRTUAL_LABELS } from "./labels.ts";
import { annoTiles, annoUrl, hasRealGeo, loadRealGeo, parseAnnoRivers } from "./real-geo.ts";
import { applyRealGeo, type RealGeo } from "./real-geo-apply.ts";
import { applyEvent, EMPTY_WORLD } from "./scenarios.ts";
import { homeFacts, homeTowns, homeWords } from "./self.ts";
import { pinNotes, residentsOf, worldMapMarks, worldPlaces, worldSlots } from "./world-marks.ts";
import { worldIncidents, type ApplyContext, type PersonFacts, type WorldStep } from "./world-apply.ts";
import { inOutageArea } from "./persona.ts";
import { WORLD_SYSTEM, worldNow } from "./world-oneshot.ts";
import { WORLD_AGENT_VERSION } from "./world-room.ts";

const SOURCES = SEED_PEOPLE.map((p) => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks }));
const LEDGERS = SOURCES.map((s) => s.ledger);

function ctxOf(area = DEMO_AREA, ledgers: ReadonlyArray<Pick<Ledger, "basic">> = LEDGERS): ApplyContext {
  const { key } = pseudonymize(SOURCES, { on: "2026-11-07", places: placesOf(area, LEDGERS) });
  const facts = new Map<string, PersonFacts>(
    SOURCES.map((s, i) => [
      s.person.id,
      {
        town: townOfLedger(ledgers[i], area),
        homeTown: ledgers[i].basic.address?.town ?? null,
        depends: [],
        categories: s.clocks.map((k) => k.category),
        nurse: false,
      },
    ]),
  );
  return { key, facts, ended: new Set(), hour: 6, via: "room", area };
}

describe("実の地理（デモ事業所）", () => {
  it("部屋への文に架空の町・川・道の種が無く、実の川と標高とハザードがある", () => {
    const text = geographyText();
    for (const name of RETIRED_DEMO_NAMES) expect(text).not.toContain(name);
    for (const w of ["松山市", "重信川", "石手川", "標高 14〜18 m", "洪水 3〜10 m の想定", "土石流", "津波 0.5〜1 m", "中川原橋"]) expect(text).toContain(w);
    expect(text).not.toContain("系統");
    expect(WORLD_SYSTEM).not.toContain("白波川");
    expect(WORLD_SYSTEM).toContain("人は架空");
    expect(WORLD_AGENT_VERSION).toBeGreaterThanOrEqual(7);
  });

  it("施設は種の架空の名前のまま", () => {
    expect(DEMO_AREA.facilities.map((f) => f.name)).toEqual(["河口の透析クリニック", "訪問看護ステーション", "薬局の配達", "川沿いの病院"]);
  });

  it("種の 10 人のピンは全員どこかの区画に入り、町名の表と同じ組になる", () => {
    const groups = new Map<string, string[]>();
    for (const s of SOURCES) {
      const t = townOfLedger(s.ledger);
      expect(t).not.toBeNull();
      groups.set(t!, [...(groups.get(t!) ?? []), s.person.id]);
    }
    expect(Object.fromEntries(groups)).toEqual({
      "市坪・井門付近": ["p-01", "p-02"],
      "余戸・南斎院付近": ["p-03", "p-05"],
      "石手・祝谷付近": ["p-04", "p-07"],
      "和泉北付近": ["p-06"],
      "大可賀付近": ["p-08"],
      "西長戸・鴨川付近": ["p-09", "p-10"],
    });
  });

  it("台帳の町名でなくピンの位置で人に当たる（ピンを動かすと出来事の相手が変わる。町名は変えない）", () => {
    const moved = SOURCES.map((s) => (s.person.id === "p-01" ? { ...s.ledger, basic: { ...s.ledger.basic, location: { lat: 33.87, lng: 132.745 } } } : s.ledger));
    expect(moved[0].basic.address?.town).toBe("かわなぎ町");
    expect(townOfLedger(moved[0])).toBe("西長戸・鴨川付近");
    const ctx = ctxOf(DEMO_AREA, moved);
    const flood = (town: string) =>
      worldIncidents({ narration: "", events: [{ kind: "flood", town, target: "", name: "", value: "1" }], farewells: [] }, ctx)[0].change as { persons: string[]; town: string };
    expect(flood("己地区").persons.sort()).toEqual(["p-01", "p-09", "p-10"]);
    expect(flood("甲地区").persons).toEqual(["p-02"]);
    expect(flood("己地区").town).toBe("西長戸・鴨川付近");
  });

  it("ピンの無い人は台帳の町名で区画に入り、遠すぎるピンは区画に入れない", () => {
    const base = SOURCES[0].ledger;
    const noPin = { ...base, basic: { ...base.basic, location: undefined } };
    expect(townOfLedger(noPin)).toBe("市坪・井門付近");
    expect(townOfPin({ lat: 35.68, lng: 139.76 }, DEMO_AREA)).toBeNull();
    const far = { ...base, basic: { ...base.basic, location: { lat: 35.68, lng: 139.76 } } };
    expect(townOfLedger(far)).toBe("市坪・井門付近");
  });

  it("門: 区画の実の言葉も種の町名も別名になり、画面では実の言葉に戻る（種の町名に戻さない）", () => {
    const { key } = pseudonymize(SOURCES, { on: "2026-11-07", places: placesOf(DEMO_AREA, LEDGERS) });
    const sent = pseudonymizeText("市坪・井門付近の道 通行止。かわなぎ町の家。みずほし町 停電", key).text;
    expect(sent).toBe("甲地区の道 通行止。甲地区の家。乙地区 停電");
    expect(findLeaks(sent, key)).toEqual([]);
    expect(restoreText("甲地区で停電", key)).toBe("市坪・井門付近で停電");
    // 地理の文は門を通っても川・橋の名前が残り、漏れ無し
    const opened = pseudonymizeText(geographyText(), key).text;
    expect(opened).toContain("重信川");
    expect(findLeaks(opened, key)).toEqual([]);
  });

  it("世界の返事: 別名 → 実の言葉の画面の文。架空の地名が出ない", () => {
    const ctx = ctxOf();
    const step: WorldStep = {
      narration: "甲地区で石手川が増水している",
      events: [
        { kind: "flood", town: "甲地区", target: "", name: "", value: "" },
        { kind: "outage", town: "乙地区", target: "", name: "", value: "start" },
        { kind: "road", town: "", target: "", name: "中川原橋", value: "closed" },
        { kind: "road", town: "", target: "", name: "丙地区の道", value: "closed" },
      ],
      farewells: [],
    };
    const out = worldIncidents(step, ctx);
    const texts = out.map((e) => e.text);
    expect(texts).toEqual(["市坪・井門付近で石手川が増水している", "市坪・井門付近 浸水 5 m", "余戸・南斎院付近 停電", "中川原橋 通行止", "和泉北付近の道 通行止"]);
    for (const name of RETIRED_DEMO_NAMES) expect(texts.join()).not.toContain(name);
    expect(out[3].change).toMatchObject({ kind: "town_road", label: "中川原橋", persons: ["p-01", "p-02"] });
    // 部屋へ返す 1 文は別名のまま
    expect(out[0].change).toMatchObject({ kind: "narration", room: "甲地区で石手川が増水している" });
  });

  it("停電: 本人役・表は台帳の町名で突き合わせ、画面は実の言葉、部屋は別名", () => {
    const ctx = ctxOf();
    const out = worldIncidents({ narration: "", events: [{ kind: "outage", town: "乙地区", target: "", name: "", value: "start" }], farewells: [] }, ctx);
    const change = out[0].change as Extract<(typeof out)[0]["change"], { kind: "outage" }>;
    expect(change.area).toEqual({ scope: "towns", towns: ["みずほし町"], since: { みずほし町: 6 }, places: ["余戸・南斎院付近"] });
    expect(inOutageArea(change.area, [], "みずほし町")).toBe(true);
    expect(inOutageArea(change.area, [], "かわなぎ町")).toBe(false);
    let w = applyEvent(EMPTY_WORLD, out[0], 6);
    expect(worldNow(w).join()).toContain("停電中（乙地区）");
    const more = worldIncidents({ narration: "", events: [{ kind: "outage", town: "甲地区", target: "", name: "", value: "start" }], farewells: [] }, { ...ctx, hour: 9 });
    w = applyEvent(w, more[0], 9);
    expect(w.outage?.area).toMatchObject({ towns: ["みずほし町", "かわなぎ町"], places: ["余戸・南斎院付近", "市坪・井門付近"], since: { みずほし町: 6, かわなぎ町: 9 } });
  });

  it("訓練する人の住む所: 種の町名で選び、言い方は別名と実の地形（固定の筋の訓練。T104）", () => {
    expect(homeTowns("office-demo", [])).toContain("かわなぎ町");
    expect(homeWords({ home: "かわなぎ町" }, DEMO_AREA)).toBe("甲地区（標高 14〜18 m。近くの川 石手川）");
    expect(homeFacts({ home: "くぬぎ谷町" }, DEMO_AREA)).toEqual({ floodM: null, landslide: true });
  });
});

const GEO: RealGeo = {
  at: "2026-11-07T00:00:00.000Z",
  region: "松山市",
  rivers: [
    { name: "石手川", at: { lat: 33.81, lng: 132.75 } },
    { name: "あおば川", at: { lat: 33.81, lng: 132.75 } },
    { name: "遠い川", at: { lat: 34.5, lng: 133.5 } },
  ],
  shelters: [
    { name: "椿小学校", at: { lat: 33.8075, lng: 132.758 }, welfare: false },
    { name: "椿中学校", at: { lat: 33.8078, lng: 132.757 }, welfare: false },
    { name: "古川ふれあいセンター", at: { lat: 33.806, lng: 132.758 }, welfare: false },
    { name: "久枝小学校", at: { lat: 33.87, lng: 132.746 }, welfare: false },
    { name: "特別養護老人ホームみどり", at: { lat: 33.82, lng: 132.75 }, welfare: true },
  ],
};

describe("実の避難所と川（開始の時に読んだ公的なデータ）", () => {
  it("デモ: 実の避難所を近い区画に 2 つまで。無ければ一般の言い方で実在の名前を作らない", () => {
    const a = areaOf("office-demo", [], GEO);
    expect(a.shelters.filter((s) => !s.welfare).map((s) => [s.name, s.town])).toEqual([
      ["椿小学校", "市坪・井門付近"],
      ["椿中学校", "市坪・井門付近"],
      ["久枝小学校", "西長戸・鴨川付近"],
    ]);
    expect(a.shelters.filter((s) => s.welfare).map((s) => s.name)).toEqual(["特別養護老人ホームみどり"]);
    expect(a.realShelters).toBe(true);
    expect(geographyText(a)).toContain("椿小学校（甲地区）");
    // 読めなかった: 一般の言い方。出典を出さない
    expect(areaOf("office-demo", [], null)).toBe(DEMO_AREA);
    expect(DEMO_AREA.realShelters).toBeUndefined();
    expect(DEMO_AREA.shelters.map((s) => s.name)).toContain("甲地区の避難所");
    expect(applyRealGeo(DEMO_AREA, { ...GEO, shelters: [] }, []).shelters).toBe(DEMO_AREA.shelters);
  });

  it("世界の出来事に実の避難所の名前を使える。地理に無い名前は捨てる", () => {
    const area = areaOf("office-demo", [], GEO);
    const ctx = ctxOf(area);
    const out = worldIncidents(
      {
        narration: "",
        events: [
          { kind: "shelter", town: "", target: "", name: "椿小学校", value: "crowded" },
          { kind: "shelter", town: "", target: "", name: "作った小学校", value: "open" },
        ],
        farewells: [],
      },
      ctx,
    );
    expect(out.map((e) => e.text)).toEqual(["椿小学校 混雑"]);
  });

  it("ほかの事業所: 台帳の町名の形のまま、ピンがあれば実の川と避難所を足す。台帳の町名を含む名前は使わない", () => {
    const ledger = (town: string, location?: { lat: number; lng: number }) =>
      ({ basic: { address: { city: "松山市", town }, ...(location ? { location } : {}) }, evacuation: { hazards: [] } }) as unknown as Pick<Ledger, "basic" | "evacuation">;
    const people = [{ ledger: ledger("あおば町", { lat: 33.8075, lng: 132.757 }) }, { ledger: ledger("もみじ台") }];
    const plain = areaOf("office-x", people);
    expect(plain.towns.map((t) => t.town)).toEqual(["あおば町", "もみじ台", "高台"]);
    expect(plain.shelters.map((s) => s.name)).toEqual(["高台の避難所", "福祉避難所"]);
    expect(plain.rivers).toEqual([]);
    expect(plain.byPin).toBeUndefined();
    const real = areaOf("office-x", people, GEO);
    expect(real.region).toBe("松山市");
    // 「あおば川」は台帳の町名を含むので使わない
    expect(real.rivers).toEqual(["石手川", "遠い川"]);
    expect(real.towns[0].terrain).toContain("近くの川 石手川");
    expect(real.towns[0].terrain).not.toContain("遠い川");
    expect(real.shelters.map((s) => s.name)).toContain("椿小学校");
    // 人は台帳の町名で区画に（ピンで動かさない）
    expect(townOfLedger(people[0].ledger, real)).toBe("あおば町");
    expect(placesOf(real, [people[0].ledger, people[1].ledger])).toEqual([
      { town: "あおば町", alias: "甲地区" },
      { town: "もみじ台", alias: "乙地区" },
    ]);
    expect(geographyText(real)).not.toContain("あおば");
  });

  it("読み方: 外へ出るのはタイルの z/x/y だけ。形の違う物・法人の名前・門に掛かる名前は外す。読めなくても投げない", async () => {
    const urls: string[] = [];
    const fake = (async (u: RequestInfo | URL) => {
      const url = String(u);
      urls.push(url);
      if (url.includes("/sih/")) {
        return Response.json({
          features: [
            { geometry: { type: "Point", coordinates: [132.758, 33.8075] }, properties: { name: "椿小学校" } },
            { geometry: { type: "Point", coordinates: [132.76, 33.81] }, properties: { name: "田中さん宅" } },
            { geometry: null, properties: { name: "位置なし" } },
          ],
        });
      }
      if (url.includes("/sfh/")) {
        return Response.json({
          features: [
            { geometry: { type: "Point", coordinates: [132.76, 33.81] }, properties: { name: "社会福祉法人 例 特別養護老人ホーム" } },
            { geometry: { type: "Point", coordinates: [132.76, 33.811] }, properties: { name: "特別養護老人ホームみどり" } },
          ],
        });
      }
      if (url.includes("experimental_anno")) {
        return Response.json({
          features: [
            { geometry: { type: "Point", coordinates: [132.75, 33.81] }, properties: { annoCtg: "河川、湖沼（河川、用水等）", knj: "石手川" } },
            { geometry: { type: "Point", coordinates: [132.75, 33.81] }, properties: { annoCtg: "居住地名（町字名）", knj: "市坪" } },
          ],
        });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const at = { lat: 33.8075123, lng: 132.7570456 };
    const g = await loadRealGeo({ points: [at], region: "松山市", rivers: true, now: "2026-11-07T00:00:00.000Z", fetch: fake });
    expect(g.shelters.map((s) => s.name)).toEqual(["椿小学校", "特別養護老人ホームみどり"]);
    expect(g.rivers.map((r) => r.name)).toContain("石手川");
    expect(g.rivers.map((r) => r.name)).not.toContain("市坪");
    expect(hasRealGeo(g)).toBe(true);
    expect(urls.length).toBeLessThanOrEqual(20);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/(sih|sfh)\/10\/\d+\/\d+\.geojson$|^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/experimental_anno\/15\/\d+\/\d+\.geojson$/);
      expect(u).not.toContain("33.8");
      expect(u).not.toContain("132.7");
    }
    // デモは川を読まない
    urls.length = 0;
    await loadRealGeo({ points: [at], region: null, rivers: false, now: "x", fetch: fake });
    expect(urls.some((u) => u.includes("experimental_anno"))).toBe(false);
    // 全部失敗しても投げず、空
    const down = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    const empty = await loadRealGeo({ points: [at], region: null, rivers: true, now: "x", fetch: down });
    expect(hasRealGeo(empty)).toBe(false);
  });

  it("注記の読み方と上限", () => {
    expect(parseAnnoRivers(null)).toEqual([]);
    expect(parseAnnoRivers({ features: [{ nope: 1 }] })).toEqual([]);
    expect(annoTiles([{ lat: 33.81, lng: 132.75 }]).length).toBe(9);
    expect(annoTiles(SOURCES.flatMap((s) => (s.ledger.basic.location ? [s.ledger.basic.location] : []))).length).toBe(16);
    expect(annoUrl({ x: 1, y: 2 })).toContain("/experimental_anno/15/1/2.geojson");
    expect(formLeaks("椿小学校")).toEqual([]);
  });
});

describe("場所ごとの出来事（地図の印と一覧）", () => {
  const area = DEMO_AREA;
  const people = SOURCES.map((s) => ({ id: s.person.id, ledger: s.ledger }));
  const residents = residentsOf(area, people);
  const ticksOf = (step: WorldStep, ctx = ctxOf()) => [{ incidents: worldIncidents(step, ctx) }];

  it("区画の出来事は実の場所の印に、通行可・解消・復旧で消える", () => {
    const first = ticksOf({
      narration: "",
      events: [
        { kind: "flood", town: "甲地区", target: "", name: "", value: "3" },
        { kind: "outage", town: "甲地区", target: "", name: "", value: "start" },
        { kind: "road", town: "", target: "", name: "和泉大橋", value: "closed" },
        { kind: "facility", town: "", target: "", name: "河口の透析クリニック", value: "closed" },
      ],
      farewells: [],
    });
    const slots = worldSlots(first, area, residents);
    const places = worldPlaces(slots);
    const koh = places.find((p) => p.place === "市坪・井門付近")!;
    expect(koh.words).toEqual(["浸水 3 m", "停電"]);
    expect(koh.at).toEqual({ lat: 33.8071, lng: 132.7576 });
    expect(koh.persons).toEqual(["p-01", "p-02"]);
    expect(places.find((p) => p.place === "和泉大橋")).toMatchObject({ words: ["通行止"], at: { lat: 33.8213, lng: 132.7593 } });
    // 施設は種の架空の名前で位置が無いので一覧だけ
    expect(places.find((p) => p.place === "河口の透析クリニック")).toMatchObject({ at: null, words: ["休止"] });
    const marks = worldMapMarks(places);
    expect(marks.map((m) => m.id)).not.toContain("河口の透析クリニック");
    expect(marks.find((m) => m.id === "市坪・井門付近")).toMatchObject({ short: "浸水 3 m・停電", label: "市坪・井門付近 浸水 3 m・停電" });
    expect(pinNotes(slots)).toMatchObject({ "p-01": "浸水", "p-02": "浸水" });

    const later = [
      ...first,
      ...ticksOf({
        narration: "",
        events: [
          { kind: "road", town: "", target: "", name: "和泉大橋", value: "open" },
          { kind: "outage", town: "", target: "", name: "", value: "restored" },
        ],
        farewells: [],
      }),
    ];
    const after = worldPlaces(worldSlots(later, area, residents));
    expect(after.find((p) => p.place === "和泉大橋")).toBeUndefined();
    expect(after.find((p) => p.place === "市坪・井門付近")!.words).toEqual(["浸水 3 m"]);
  });

  it("画面の 1 行: 人は架空・地理は実在・出来事は想定", () => {
    for (const note of [VIRTUAL_LABELS.note, VIRTUAL_LABELS.noteRole]) {
      expect(note).toContain("実在");
      expect(note).toContain("訓練の想定");
      expect(note).not.toContain("街");
    }
    expect(VIRTUAL_LABELS.note).toContain("架空の人");
  });
});

describe("守り", () => {
  it("世界の文に架空の地名が出たら check に掛かり、守りが見る。地理に無い実在らしい名前は目安", () => {
    const outcome = {
      plan: { scenario: "virtual" },
      replay: {
        ticks: [
          {
            hour: 6,
            incidents: [
              { at: 6, change: { kind: "narration" }, text: "かわなぎ町で白波川が増水している", ai: true },
              { at: 6, change: { kind: "narration" }, text: "市坪・井門付近で石手川が増水している", ai: true },
              { at: 6, change: { kind: "narration" }, text: "道後町の堀之内川があふれた", ai: true },
            ],
          },
        ],
      },
    } as unknown as RunOutcome;
    const hits = worldPlaceHits(outcome);
    expect(hits.filter((h) => h.rule.startsWith("retired:")).map((h) => h.rule)).toEqual(["retired:白波川", "retired:かわなぎ町"]);
    expect(hits.filter((h) => h.rule === "off_table").length).toBeGreaterThan(0);
    expect(hits.some((h) => h.evidence.includes("石手川") && h.rule === "off_table")).toBe(false);
    expect(metaOf(hits[0])?.cause).toBe("drill:world_place:retired");
    expect(GUARDS.find((g) => g.id === "drill-world-retired-place")).toMatchObject({ bench: "drill", item: "count:drill:world_place:retired", value: 0 });
    // 固定の筋の訓練は見ない（筋書きの表は一般の言い方）
    expect(worldPlaceHits({ ...outcome, plan: { scenario: "heavy_rain" } } as unknown as RunOutcome)).toEqual([]);
  });
});
