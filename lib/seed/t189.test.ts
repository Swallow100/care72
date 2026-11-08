// T189: 種の町名を実在の松山市の町名に（番地は持たない、人・家は架空のまま）。
// - 町名: 家のピン（SEED_LOCATIONS、T183 のまま）を地理院の逆ジオコーダで引いた町名。デモ事業所は地図の中心の町名まで
// - 連絡先の市内の住所は本人の町か近くの本人の町。前の架空の町名（やめた地名）は種のどこにも残さない（民間の施設の名前は架空のまま）
// - 訓練の地区の分け方（homes）と停電の地区は、前に同じ架空の町にいた人の組を実在の町名の組にしたもの（誰が当たるかは同じ）
// - 最寄りの避難場所は実在の指定避難所の名前（SEED_NEAREST）
// - 仮名化の門: 実在の町名でも Claude への要求に出ない（書類の道は（町名）、訓練の道は地区の別名）

import { describe, expect, it } from "vitest";
import { SEED_LOCATIONS, SEED_NEAREST, SEED_OFFICES, SEED_PEOPLE } from "../../seed/people.ts";
import { officePlaces } from "../drill/area.ts";
import { DEMO_TOWNS, RETIRED_DEMO_NAMES } from "../drill/area-demo.ts";
import { distanceM } from "../map/route.ts";
import { pseudonymize, pseudonymizeText, TOWN_MARK } from "../pseudonym/index.ts";
import { demoOutageTowns } from "./demo.ts";

/** 家のピンを地理院の逆ジオコーダ（LonLatToAddress）で引いた町名（11/8 に引いた。docs/progress/t189.md） */
const REAL_TOWNS: Record<string, string> = {
  "p-01": "市坪西町",
  "p-02": "北井門五丁目",
  "p-03": "久保田町",
  "p-04": "常光寺町",
  "p-05": "北斎院町",
  "p-06": "土居田町",
  "p-07": "祝谷東町",
  "p-08": "大可賀三丁目",
  "p-09": "西長戸町",
  "p-10": "鴨川二丁目",
};
const ALL_REAL = Object.values(REAL_TOWNS);
const CITY_PREFIX = "松山市 ";
/** 前の種の架空の町名（RETIRED_DEMO_NAMES のうち町名の物） */
const OLD_TOWNS = ["かわなぎ町", "みずほし町", "あしなみ町", "くぬぎ谷町", "うみなり町", "そらみ台", "ほたる坂町", "しおかぜ町"];

const src = SEED_PEOPLE.map((p) => ({ person: p.person, ledger: p.ledger, contacts: p.contacts, clocks: p.clocks }));
const byId = (id: string) => src.find((s) => s.person.id === id)!;

describe("種の町名（実在の松山市の町名、番地なし）", () => {
  it("本人の町名はピンを逆ジオコーダで引いた町名、ピンは T183 のまま", () => {
    for (const p of SEED_PEOPLE) {
      expect(p.ledger.basic.address, p.person.id).toEqual({ city: "松山市", town: REAL_TOWNS[p.person.id] });
      expect(p.ledger.basic.location, p.person.id).toEqual(SEED_LOCATIONS[p.person.id]);
    }
    expect(SEED_LOCATIONS["p-01"]).toEqual({ lat: 33.812, lng: 132.7487 });
    expect(SEED_LOCATIONS["p-10"]).toEqual({ lat: 33.8735, lng: 132.7502 });
  });

  it("デモ事業所の所在地は実在の町名まで（番地・電話の実の値なし）", () => {
    const demo = SEED_OFFICES.find((o) => o.id === "office-demo")!;
    expect(demo.address).toBe("愛媛県松山市二番町四丁目");
    expect(demo.address).not.toMatch(/[0-9０-９]+(番地|-)/);
  });

  it("連絡先の市内の住所は種の 10 人の実在の町名だけ。番地は持たない", () => {
    for (const p of SEED_PEOPLE) {
      for (const c of p.contacts) {
        if (!c.address?.startsWith(CITY_PREFIX)) continue;
        const town = c.address.slice(CITY_PREFIX.length);
        expect(ALL_REAL, `${c.id} ${c.address}`).toContain(town);
      }
    }
  });

  it("やめた架空の町名は台帳・連絡先の住所・避難先のどこにも無い", () => {
    const text = JSON.stringify(SEED_PEOPLE.map((p) => [p.ledger.basic, p.ledger.evacuation, p.contacts.map((c) => c.address)]));
    for (const r of OLD_TOWNS) {
      expect(RETIRED_DEMO_NAMES, r).toContain(r);
      expect(text.includes(r), r).toBe(false);
    }
  });

  it("訓練の地区の町名（homes）は種の町名の全部で、前の架空の町の組のまま", () => {
    expect(DEMO_TOWNS.map((t) => t.homes)).toEqual([
      ["市坪西町", "北井門五丁目"],
      ["久保田町", "北斎院町"],
      ["土居田町"],
      ["常光寺町", "祝谷東町"],
      ["大可賀三丁目"],
      ["西長戸町", "鴨川二丁目"],
    ]);
    expect(
      DEMO_TOWNS.flatMap((t) => t.homes ?? [])
        .slice()
        .sort(),
    ).toEqual([...ALL_REAL].sort());
  });

  it("停電の地区は浸水 3 m の 2 人（山田・小林）の町", () => {
    expect([...demoOutageTowns()].sort()).toEqual(["北井門五丁目", "市坪西町"].sort());
  });

  it("最寄りの避難場所は実在の指定避難所の名前（家から 1 km の中、町名・やめた地名を含まない）", () => {
    for (const p of SEED_PEOPLE) {
      const n = SEED_NEAREST[p.person.id as keyof typeof SEED_NEAREST];
      expect(p.ledger.evacuation.nearest, p.person.id).toBe(n.name);
      expect(distanceM(SEED_LOCATIONS[p.person.id], n.at), p.person.id).toBeLessThanOrEqual(1000);
      for (const t of ALL_REAL) expect(n.name.includes(t.replace(/(町|台|村)$/u, "")), `${n.name} ${t}`).toBe(false);
      for (const r of RETIRED_DEMO_NAMES) expect(n.name.includes(r), `${n.name} ${r}`).toBe(false);
    }
  });
});

describe("仮名化の門（実在の町名も伏せる）", () => {
  it("書類の道: Claude に渡す形に実在の町名が無い", () => {
    const { payload } = pseudonymize(src);
    const sent = JSON.stringify(payload);
    for (const t of ALL_REAL) expect(sent.includes(t), t).toBe(false);
  });

  it("訓練の道（地区の別名）: Claude に渡す形に実在の町名が無い", () => {
    const places = officePlaces("office-demo", src.map((s) => s.ledger));
    for (const t of ALL_REAL) expect(places.some((p) => p.town === t), t).toBe(true);
    const { payload } = pseudonymize(src, { places });
    const sent = JSON.stringify(payload);
    for (const t of ALL_REAL) expect(sent.includes(t), t).toBe(false);
  });

  it("自由文の中の実在の町名は（町名）か別名に（本人の町・ほかの人の町・町を外した頭）", () => {
    const { key } = pseudonymize([byId("p-01")]);
    const out = pseudonymizeText("家は市坪西町。市坪西の堤防は通らない", key).text;
    expect(out).not.toContain("市坪西");
    expect(out).toContain(TOWN_MARK);

    const places = officePlaces("office-demo", src.map((s) => s.ledger));
    const all = pseudonymize(src, { places });
    const text = ALL_REAL.map((t) => `${t}で停電`).join("。");
    const masked = pseudonymizeText(text, all.key).text;
    for (const t of ALL_REAL) expect(masked.includes(t), t).toBe(false);
    expect(masked).toContain("甲地区");
  });
});
