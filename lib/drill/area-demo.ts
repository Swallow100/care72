// デモ事業所の実の区画（T170）。種の 10 人のピンの周りの松山市の実の地理で、確かめた事だけを書く。出どころと確かめた値は docs/progress/t170.md。
//
// - 区画の言葉（市坪・井門付近…）: 地理院タイルの注記（experimental_anno）の町字名（ピンから 0.5 km の中）。部屋には渡さない（別名だけ）
// - 川・橋・トンネル・山・港の名前: 同じ注記。「近くの川」は注記の点がピンから 2 km の中の物
// - 標高: 地理院の標高 API（ピンの点）
// - ハザード: 重ねるハザードマップのタイル（洪水 想定最大規模・土砂災害警戒区域・津波浸水想定）のピンの画素と、凡例の色
// - 送電の区分は確かめようが無いので持たない（前は架空の「東系統」）
// - 施設は種の架空の名前のまま（透析先などの実在の施設に出来事を当てない）。置き場の区画だけ実の区画に
//
// ブラウザからも読まれうる（lib/office/region.ts → area.ts）ので、ここは定数だけ。

import type { AreaFacility, AreaRoad, AreaTown } from "./area.ts";

/** 地域（種の事業所の市） */
export const DEMO_REGION = "松山市";

/** 地域の川（注記に名前のある、種のピンの周りの川） */
export const DEMO_RIVERS: ReadonlyArray<string> = ["重信川", "石手川", "宮前川", "大川"];

/**
 * homes は種の台帳の町名（人の区画はピンで決める。これはピンの無い人の引き先と、文の中の町名の伏せ字）。T189 から実在の町名
 * （本人の家のピンを地理院の逆ジオコーダで引いた物）。前の架空の町の組を、そこにいた人の実在の町名の組にした（誰が当たるかは同じ）
 */
export const DEMO_TOWNS: ReadonlyArray<AreaTown> = [
  {
    town: "市坪・井門付近",
    alias: "甲地区",
    at: { lat: 33.8071, lng: 132.7576 },
    terrain: "標高 14〜18 m。近くの川 石手川",
    floodM: 5,
    landslide: false,
    tsunami: false,
    hazardWords: "洪水 3〜10 m の想定（国管理河川の層）",
    homes: ["市坪西町", "北井門五丁目"],
  },
  {
    town: "余戸・南斎院付近",
    alias: "乙地区",
    at: { lat: 33.8286, lng: 132.725 },
    terrain: "標高 5〜10 m。近くの川 宮前川・重信川",
    floodM: 0.5,
    landslide: false,
    tsunami: false,
    hazardWords: "洪水 0.5〜3 m の想定（国管理河川の層）",
    homes: ["久保田町", "北斎院町"],
  },
  {
    town: "和泉北付近",
    alias: "丙地区",
    at: { lat: 33.8243, lng: 132.7543 },
    terrain: "標高約 15 m。近くの川 石手川",
    floodM: 0.5,
    landslide: false,
    tsunami: false,
    hazardWords: "洪水 0.5〜3 m の想定（国管理河川の層）",
    homes: ["土居田町"],
  },
  {
    town: "石手・祝谷付近",
    alias: "丁地区",
    at: { lat: 33.8555, lng: 132.7902 },
    terrain: "標高 70〜85 m。近くの山 御幸寺山・菊ヶ森",
    floodM: null,
    landslide: true,
    tsunami: false,
    hazardWords: "土砂災害の警戒区域（土石流）。洪水の想定なし",
    homes: ["常光寺町", "祝谷東町"],
  },
  {
    town: "大可賀付近",
    alias: "戊地区",
    at: { lat: 33.854, lng: 132.7105 },
    terrain: "標高約 3 m。海岸通の近く。近くの川 宮前川。近くの港 松山港",
    floodM: 0.5,
    landslide: false,
    tsunami: true,
    hazardWords: "津波 0.5〜1 m の想定。洪水 0.5 m 未満の想定",
    homes: ["大可賀三丁目"],
  },
  {
    town: "西長戸・鴨川付近",
    alias: "己地区",
    at: { lat: 33.8695, lng: 132.7451 },
    terrain: "標高 10〜11 m。近くの川 大川",
    floodM: 0.5,
    landslide: false,
    tsunami: false,
    hazardWords: "洪水 一部 0.5〜3 m の想定",
    homes: ["西長戸町", "鴨川二丁目"],
  },
];

const key = (i: number) => DEMO_TOWNS[i].town;

/** 主な道: 実の橋とトンネル（注記の名前と位置）と、区画ごとの一般の言い方。実の道の名前で確かめられない物は書かない */
export const DEMO_ROADS: ReadonlyArray<AreaRoad> = [
  { id: "nakagawara", name: "中川原橋", towns: [key(0)], at: { lat: 33.8043, lng: 132.7578 } },
  { id: "deai", name: "出合大橋", towns: [key(1)], at: { lat: 33.806, lng: 132.7298 } },
  { id: "izumi", name: "和泉大橋", towns: [key(2)], at: { lat: 33.8213, lng: 132.7593 } },
  { id: "iwakoyama", name: "岩子山トンネル", towns: [key(1)], at: { lat: 33.8383, lng: 132.7315 } },
  { id: "bentenyama", name: "弁天山トンネル", towns: [key(4), key(1)], at: { lat: 33.8378, lng: 132.7146 } },
  ...DEMO_TOWNS.map((t, i): AreaRoad => ({ id: `town-${i + 1}`, name: `${t.alias}の道`, towns: [t.town], ...(t.at ? { at: t.at } : {}) })),
];

/** 施設は種の架空の名前のまま（置き場の区画だけ実の区画） */
export const DEMO_FACILITIES: ReadonlyArray<AreaFacility> = [
  { id: "dialysis", name: "河口の透析クリニック", town: key(4), depends: "dialysis_center", kind: "透析施設" },
  { id: "nurse", name: "訪問看護ステーション", town: key(5), depends: null, kind: "訪問看護" },
  { id: "pharmacy", name: "薬局の配達", town: key(1), depends: "delivery", kind: "配達" },
  { id: "hospital", name: "川沿いの病院", town: key(0), depends: null, kind: "病院" },
];

/**
 * やめた架空の地名（前の種。世界の文に出ないことを台の check とテストで見る）。種の台帳の町名も T189 で実在の町名に替えた。
 * 施設（医院・薬局など民間の連絡先）の名前は種の架空の名前のまま
 */
export const RETIRED_DEMO_NAMES: ReadonlyArray<string> = [
  "白波川",
  "かわなぎ町",
  "みずほし町",
  "あしなみ町",
  "くぬぎ谷町",
  "うみなり町",
  "そらみ台",
  "ほたる坂町",
  "しおかぜ町",
  "川沿いの市道",
  "谷の県道",
  "海沿いの国道",
  "高台への坂道",
  "高台の小学校",
  "谷の集会所",
  "坂の公民館",
];
