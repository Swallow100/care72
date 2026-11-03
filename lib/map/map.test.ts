// T14 担当一覧の右の面（地図・ハザード・デモの雨雲と震度）のテスト。
// ピンの色が lib/triage と一致する、出典が出る、緯度経度の形、ハザードの人数、デモの印、位置が Claude に渡らない。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidePane } from "../../components/list/SidePane.tsx";
import { SEED_LOCATIONS, SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { sortCaseload, toCaseloadRows } from "../caseload.ts";
import { HAZARD_KINDS } from "../db/types.ts";
import { INTAKE_FIELDS } from "../intake/fields.ts";
import { HAZARD_LABELS } from "../labels.ts";
import { COLOR_TONES } from "../person.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { rank, type TriageSignal } from "../triage/index.ts";
import { bandRing, demoOverlay } from "./demo.ts";
import {
  fitView,
  inView,
  isGeoPoint,
  PIN_PADDING,
  place,
  project,
  tilesFor,
  tileUrl,
  unproject,
  VIEW_H,
  VIEW_W,
} from "./geo.ts";
import { BASE_LAYER, HAZARD_LAYERS, HAZARD_PORTAL } from "./layers.ts";
import { buildSidePane, destinationCounts, hazardCounts, mapPins, sideDisasterOf, surname } from "./side.ts";

// ---------- 種の 10 人の行と、大雨の筋（lib/triage/heavy-rain.test.ts と同じ信号）の結果 ----------

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");

const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const SIGNALS: Record<string, TriageSignal[]> = {
  "p-01": [{ color: "red", source: "self", at: at(0.5), injured: null, canMove: null, classes: ["unknown"] }],
  "p-03": [{ color: "green", source: "family", at: at(-1) }],
  "p-04": [
    { color: "green", source: "self", at: at(0.5) },
    { color: "green", source: "supporter", at: at(4) },
  ],
  "p-06": [{ color: "green", source: "family", at: at(-1) }],
  "p-08": [{ color: "green", source: "self", at: at(0.5) }],
  "p-10": [{ color: "green", source: "family", at: at(-1.5) }],
};
const ENTRIES = SEED_PEOPLE.map((p) => ({ person: toTriagePerson(p), signals: SIGNALS[p.person.id] ?? [] }));
/** 停電から 3 時間（小林の呼吸器の電池 3 時間を過ぎる前後で色が分かれる時刻） */
const results = rank(ENTRIES, { now: at(3.5), disasterAt: at(-2), outageAt: at(0) });

const render = (data: ReturnType<typeof buildSidePane>) => renderToStaticMarkup(createElement(SidePane, { data }));

/** 描いた HTML のピン（data-pin と data-tone） */
function pinsIn(html: string): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const m of html.matchAll(/<a [^>]*data-pin="([^"]+)"[^>]*>/g)) {
    const tone = m[0].match(/data-tone="([^"]+)"/);
    out.set(m[1], tone ? tone[1] : null);
  }
  return out;
}

// ---------- 地図の計算 ----------

describe("地図の計算（ウェブメルカトル）", () => {
  it("緯度経度 → 世界座標 → 緯度経度で元に戻る", () => {
    for (const p of Object.values(SEED_LOCATIONS)) {
      const back = unproject(project(p, 15), 15);
      expect(back.lat).toBeCloseTo(p.lat, 9);
      expect(back.lng).toBeCloseTo(p.lng, 9);
    }
  });

  it("ズーム 0 の世界は 256 px で、経度 0・緯度 0 が真ん中", () => {
    expect(project({ lat: 0, lng: 0 }, 0)).toEqual({ x: 128, y: 128 });
    expect(project({ lat: 0, lng: 180 }, 1).x).toBe(512);
  });

  it("10 人のピンが全部、札の余白を残して枠に入るいちばん大きいズーム", () => {
    const pts = Object.values(SEED_LOCATIONS);
    const view = fitView(pts, { minZ: 11, maxZ: 15, fallback: pts[0] });
    for (const p of pts) {
      const at = place(view, p);
      expect(inView(at)).toBe(true);
      expect((at.left / 100) * VIEW_W).toBeGreaterThanOrEqual(PIN_PADDING.left - 0.5);
      expect((at.left / 100) * VIEW_W).toBeLessThanOrEqual(VIEW_W - PIN_PADDING.right + 0.5);
      expect((at.top / 100) * VIEW_H).toBeGreaterThanOrEqual(PIN_PADDING.top - 0.5);
      expect((at.top / 100) * VIEW_H).toBeLessThanOrEqual(VIEW_H - PIN_PADDING.bottom + 0.5);
    }
    // 1 つ上のズームでは入らない
    const closer = fitView(pts, { minZ: view.z + 1, maxZ: view.z + 1, fallback: pts[0] });
    expect(pts.every((p) => inView(place(closer, p)))).toBe(view.z === 15);
    expect(view.z).toBe(12);
  });

  it("ピンが無ければ fallback を真ん中に一番引いたズーム", () => {
    const fb = { lat: 33.84, lng: 132.765 };
    const view = fitView([], { minZ: 11, maxZ: 15, fallback: fb });
    expect(view.z).toBe(11);
    expect(place(view, fb)).toEqual({ left: 50, top: 50 });
  });

  it("タイルは枠を隙間なく覆い、URL は {z}/{x}/{y} を埋める", () => {
    const view = fitView(Object.values(SEED_LOCATIONS), { minZ: 11, maxZ: 15, fallback: SEED_LOCATIONS["p-01"] });
    const tiles = tilesFor(view);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.width))).toBeGreaterThanOrEqual(100);
    expect(Math.max(...tiles.map((t) => t.top + t.height))).toBeGreaterThanOrEqual(100);
    expect(tileUrl(BASE_LAYER.url, { z: 12, x: 3558, y: 1636 })).toBe(
      "https://cyberjapandata.gsi.go.jp/xyz/pale/12/3558/1636.png",
    );
  });
});

// ---------- 台帳の緯度経度 ----------

describe("台帳の緯度経度（架空の位置）", () => {
  it("種の 10 人全員が数の緯度・経度を持ち、松山市の市街の中で、重ならない", () => {
    expect(Object.keys(SEED_LOCATIONS).sort()).toEqual(SEED_PEOPLE.map((p) => p.person.id).sort());
    for (const p of SEED_PEOPLE) {
      const loc = p.ledger.basic.location;
      expect(isGeoPoint(loc), p.person.id).toBe(true);
      expect(Object.keys(loc!).sort()).toEqual(["lat", "lng"]);
      expect(loc!.lat).toBeGreaterThan(33.78);
      expect(loc!.lat).toBeLessThan(33.9);
      expect(loc!.lng).toBeGreaterThan(132.69);
      expect(loc!.lng).toBeLessThan(132.82);
    }
    const keys = SEED_PEOPLE.map((p) => `${p.ledger.basic.location!.lat},${p.ledger.basic.location!.lng}`);
    expect(new Set(keys).size).toBe(10);
  });

  it("形の検査: 数でない・範囲の外・欠けは位置にしない", () => {
    expect(isGeoPoint({ lat: 33.8, lng: 132.7 })).toBe(true);
    expect(isGeoPoint({ lat: "33.8", lng: 132.7 })).toBe(false);
    expect(isGeoPoint({ lat: 33.8 })).toBe(false);
    expect(isGeoPoint({ lat: Number.NaN, lng: 132.7 })).toBe(false);
    expect(isGeoPoint({ lat: 91, lng: 132.7 })).toBe(false);
    expect(isGeoPoint(null)).toBe(false);
    const broken = toCaseloadRows(
      [{ ...people[0], ledger: JSON.stringify({ ...SEED_PEOPLE[0].ledger, basic: { location: { lat: "x" } } }) }],
      [],
      [],
      "2026-11-02",
    );
    expect(broken[0].location).toBeNull();
  });

  it("担当一覧の行に位置・ハザードの種類・避難先 1 が乗る", () => {
    const yamada = rows.find((r) => r.id === "p-01")!;
    expect(yamada.location).toEqual(SEED_LOCATIONS["p-01"]);
    expect(yamada.hazardKinds).toEqual([{ kind: "flood", depthM: 3 }]);
    expect(yamada.destination).toBe("かわなぎ小学校");
    expect(yamada.pendingFields).toHaveLength(3);
  });

  it("位置は Claude に渡らない（仮名化の層の出力に無く、入れる欄にも無い）", () => {
    const inputs = SEED_PEOPLE.map((p) => ({
      person: p.person,
      ledger: p.ledger,
      contacts: p.contacts,
      clocks: p.clocks,
      consents: seedConsents(p),
    }));
    const { payload } = pseudonymize(inputs, { on: "2026-11-02" });
    const text = JSON.stringify(payload);
    expect(text).not.toMatch(/location|"lat"|"lng"/);
    for (const loc of Object.values(SEED_LOCATIONS)) {
      expect(text).not.toContain(String(loc.lat));
      expect(text).not.toContain(String(loc.lng));
    }
    expect(INTAKE_FIELDS.some((f) => f.key.startsWith("basic.location"))).toBe(false);
  });
});

// ---------- 層と出典 ----------

describe("層と出典", () => {
  it("下の地図は地理院タイル（淡色地図）で、出典は地理院タイル一覧へリンク", () => {
    expect(BASE_LAYER.url).toBe("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png");
    expect(BASE_LAYER.attribution).toEqual({ text: "地理院タイル", href: "https://maps.gsi.go.jp/development/ichiran.html" });
  });

  it("重ねる層は浸水・土砂・津波で、言葉は HAZARD_LABELS と同じ、タイルはハザードマップポータルの配信", () => {
    expect(HAZARD_LAYERS.map((l) => l.id)).toEqual(HAZARD_KINDS.filter((k) => k !== "other")); // その他（T57）は地図の層を持たない
    for (const l of HAZARD_LAYERS) {
      expect(l.label).toBe(HAZARD_LABELS[l.id]);
      for (const u of l.urls) expect(u).toMatch(/^https:\/\/disaportaldata\.gsi\.go\.jp\/raster\/[0-9a-z_]+\/\{z\}\/\{x\}\/\{y\}\.png$/);
      expect(l.origin.length).toBeGreaterThan(0);
    }
    expect(HAZARD_LAYERS.find((l) => l.id === "landslide")!.urls).toHaveLength(3);
    expect(HAZARD_LAYERS.find((l) => l.id === "landslide")!.origin).toBe(
      "国土交通省政策統括官付地理空間情報課「国土数値情報（令和７年度土砂災害警戒区域）」をもとに国土地理院が加工",
    );
    expect(HAZARD_PORTAL.text).toBe("ハザードマップポータルサイト");
  });

  it("平時の地図: 地理院タイルの出典と、重ねた浸水の層の出典が出る。土砂・津波は重ねていないので出ない", () => {
    const html = render(buildSidePane(rows, { sort: "tier" }));
    expect(html).toContain('href="https://maps.gsi.go.jp/development/ichiran.html"');
    expect(html).toContain(">地理院タイル</a>");
    expect(html).toContain(">ハザードマップポータルサイト</a>");
    expect(html).toContain("洪水浸水想定区域（想定最大規模） 国土交通省各地方整備局等・都道府県");
    expect(html).not.toContain("土砂災害警戒区域 ");
    expect(html).toContain("位置は架空");
    expect(html).toContain("disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/12/");
    expect(html).not.toContain("05_dosekiryukeikaikuiki");
  });

  it("大雨のデモでは浸水と土砂を重ね、土砂の加工の表記も出る", () => {
    const html = render(buildSidePane(rows, { sort: "tier", disaster: { results, scene: { kind: "heavy_rain", level: 4 } } }));
    expect(html).toContain("をもとに国土地理院が加工");
    expect(html).toContain("05_kyukeishakeikaikuiki");
  });
});

// ---------- ピンの色 ----------

describe("ピン", () => {
  it("発災時はピンの色が lib/triage の色（COLOR_TONES）と 1 人ずつ一致し、状態の言葉を添える", () => {
    const data = buildSidePane(rows, { sort: "tier", disaster: { results, scene: { kind: "heavy_rain", level: 4 } } });
    const html = render(data);
    const pins = pinsIn(html);
    expect(pins.size).toBe(10);
    for (const r of results) {
      expect(pins.get(r.personId), r.personId).toBe(COLOR_TONES[r.color]);
      const pin = data.pins.find((p) => p.id === r.personId)!;
      expect(pin.state).toBe({ red: "至急", yellow: "要確認", gray: "不明", green: "無事" }[r.color]);
      expect(pin.title).toContain(r.reason);
    }
    // 筋のとおり色が分かれている（赤・黄・灰・緑がそろう）
    expect(new Set(pins.values())).toEqual(new Set(["urgent", "check", "unknown", "ok"]));
  });

  it("発災時は連絡の順が先の人ほど上に重なる", () => {
    const pins = mapPins(rows, "tier", results);
    const top = pins[pins.length - 1];
    expect(top.id).toBe(results[0].personId);
    expect(pins.map((p) => p.layer)).toEqual([...pins.map((p) => p.layer)].sort((a, b) => a - b));
  });

  it("平時のピンは色を持たず、姓だけ。押すと本人のページ", () => {
    const html = render(buildSidePane(rows, { sort: "tier" }));
    const pins = pinsIn(html);
    expect(pins.size).toBe(10);
    for (const tone of pins.values()) expect(tone).toBeNull();
    const yamada = mapPins(rows, "tier").find((p) => p.id === "p-01")!;
    expect(yamada).toMatchObject({ label: "山田", href: "/?open=p-01", tone: null, state: null });
    expect(surname("小林 トシ")).toBe("小林");
  });

  it("位置の無い人はピンにせず「位置なし」で数える", () => {
    const missing = rows.map((r) => (r.id === "p-09" ? { ...r, location: null } : r));
    const data = buildSidePane(missing, { sort: "tier" });
    expect(data.pins).toHaveLength(9);
    expect(data.unplaced).toBe(1);
    expect(render(data)).toContain("位置なし 1 人");
  });
});

// ---------- 人数 ----------

describe("ハザードと避難先の人数", () => {
  it("台帳のハザードから: 浸水 3 m 2 人・1 m 1 人・0.5 m 2 人、土砂 2 人、津波 1 人、なし 2 人", () => {
    expect(hazardCounts(rows).map((h) => [h.label, h.count])).toEqual([
      ["浸水 3 m", 2],
      ["浸水 1 m", 1],
      ["浸水 0.5 m", 2],
      ["土砂", 2],
      ["津波", 1],
      ["なし", 2],
    ]);
  });

  it("2 つのハザードを持つ人は両方に数え、深さの無い浸水は深さのある浸水の後", () => {
    const extra = rows.map((r) =>
      r.id === "p-09" ? { ...r, hazardKinds: [{ kind: "flood" as const, depthM: null }, { kind: "landslide" as const, depthM: null }] } : r,
    );
    const counts = hazardCounts(extra).map((h) => [h.label, h.count]);
    expect(counts).toEqual([
      ["浸水 3 m", 2],
      ["浸水 1 m", 1],
      ["浸水 0.5 m", 2],
      ["浸水", 1],
      ["土砂", 3],
      ["津波", 1],
      ["なし", 1],
    ]);
  });

  it("発災時はハザードごとに状態の内訳（lib/triage の色の数）", () => {
    const color = new Map(results.map((r) => [r.personId, r.color]));
    const counts = hazardCounts(rows, (id) => color.get(id));
    for (const h of counts) {
      const sum = h.states.reduce((s, x) => s + x.count, 0);
      expect(sum, h.label).toBe(h.count);
    }
    const deep = counts.find((h) => h.label === "浸水 3 m")!;
    const expected = ["p-01", "p-02"].map((id) => color.get(id)!);
    expect(deep.states.map((s) => s.color).sort()).toEqual([...new Set(expected)].sort());
  });

  it("避難先 1 の内訳は多い順、無い人は「未確認」で最後", () => {
    const d = destinationCounts(rows);
    expect(d[d.length - 1]).toEqual({ label: "未確認", count: 3, unset: true });
    expect(d.reduce((s, x) => s + x.count, 0)).toBe(10);
    expect(d.find((x) => x.label === "かわなぎ小学校")?.count).toBe(1);
  });

  it("発災時の状態の人数は lib/triage の結果と同じ", () => {
    const data = buildSidePane(rows, { sort: "tier", disaster: { results, scene: { kind: "heavy_rain", level: 4 } } });
    for (const s of data.states!) expect(s.count, s.label).toBe(results.filter((r) => r.color === s.color).length);
    expect(data.states!.reduce((s, x) => s + x.count, 0)).toBe(10);
  });
});

// ---------- 平時の面 ----------

describe("平時の右の面", () => {
  const data = buildSidePane(rows, { sort: "tier" });

  it("今週の見直しは計画が下書きで未確認のある人（山田 3・加藤 1）、何が未確認かを添える", () => {
    expect(data.review.map((r) => [r.id, r.pending])).toEqual([
      ["p-01", 3],
      ["p-07", 1],
    ]);
    expect(data.review[0].labels).toEqual(["薬", "夜間支援", "避難先2"]);
  });

  it("計画の状態の内訳: 未作成 3・下書き 2・同意済 3・訓練済 2", () => {
    expect(data.plan.map((p) => [p.label, p.count])).toEqual([
      ["未作成", 3],
      ["下書き", 2],
      ["同意済", 3],
      ["訓練済", 2],
    ]);
  });

  it("平時は計画が先で地図が後、デモの印は出さない", () => {
    const html = render(data);
    expect(html.indexOf('data-section="plan"')).toBeLessThan(html.indexOf('data-section="map"'));
    expect(html).not.toContain('data-demo="label"');
    expect(html).not.toContain("デモ");
  });
});

// ---------- 発災時のデモの雨雲・震度 ----------

describe("デモの雨雲と震度", () => {
  it("大雨: 地図が一番上、「デモ」の印、雨雲の斜線、状態の人数", () => {
    const html = render(buildSidePane(rows, { sort: "tier", disaster: { results, scene: { kind: "heavy_rain", level: 4 } } }));
    expect(html.indexOf('data-section="map"')).toBeLessThan(html.indexOf('data-section="review"'));
    expect(html).toContain('data-demo="label"');
    expect(html).toMatch(/data-demo="label"[^>]*><span class="font-bold">デモ<\/span><span[^>]*>大雨 レベル 4<\/span>/);
    expect(html).toContain('data-demo="rain"');
    expect(html).toContain("想定値");
    expect(html).toContain("data-states");
  });

  it("地震: 震度 6強（筋書き）をデモの印の中に出し、雨雲は描かない。津波の層を重ねる", () => {
    const html = render(buildSidePane(rows, { sort: "tier", disaster: { results, scene: { kind: "earthquake" } } }));
    expect(html).toMatch(/data-demo="quake"[^>]*>震度 <span[^>]*>6強<\/span>/);
    expect(html).not.toContain('data-demo="rain"');
    expect(html).toContain("04_tsunami_newlegend_data");
  });

  it("本物の警報と見間違える言葉を使わない", () => {
    for (const scene of [{ kind: "heavy_rain", level: 5 } as const, { kind: "earthquake" } as const]) {
      const html = render(buildSidePane(rows, { sort: "tier", disaster: { results, scene } }));
      for (const w of ["警報", "注意報", "速報", "気象庁"]) expect(html, w).not.toContain(w);
    }
  });

  it("雨雲の帯はレベルが上がるほど強い帯が増え、強い帯ほど細い", () => {
    expect(demoOverlay({ kind: "heavy_rain", level: 3 }).rain.map((b) => b.strength)).toEqual([1]);
    expect(demoOverlay({ kind: "heavy_rain", level: 5 }).rain.map((b) => b.strength)).toEqual([1, 2, 3]);
    const a = { lat: 33.8, lng: 132.7 };
    const b = { lat: 33.9, lng: 132.8 };
    const wide = bandRing(a, b, 5);
    const thin = bandRing(a, b, 1);
    const width = (r: typeof wide) => Math.hypot(r[0].lat - r[3].lat, r[0].lng - r[3].lng);
    expect(width(wide)).toBeGreaterThan(width(thin));
    expect(wide).toHaveLength(4);
  });

  it("警戒レベルを入れていない大雨は「大雨」だけで、雨雲は弱の帯", () => {
    const d = demoOverlay({ kind: "heavy_rain", level: null });
    expect(d.title).toBe("大雨");
    expect(d.rain.map((b) => b.strength)).toEqual([1]);
    expect(d.layers).toEqual(["flood", "landslide"]);
  });
});

// ---------- 災害モード（T09）から右の面へ ----------

describe("災害モード（T09）の担当一覧の行から右の面の発災時へ", () => {
  // 担当一覧（lib/caseload.ts）が災害モードで作る行と同じ: 停電は事業所全体、信号は大雨の筋
  const situation = { now: at(3.5), disasterAt: at(-2), outageAt: at(0), outageTowns: null };
  const signals = new Map(Object.entries(SIGNALS));
  const disasterRows = toCaseloadRows(people, clocks, contacts, "2026-11-02", { situation, signals });

  it("平時の状態か、結果の無い行があれば null（平時の面）", () => {
    expect(sideDisasterOf(disasterRows, { kind: "normal", alertLevel: null })).toBeNull();
    expect(sideDisasterOf(rows, { kind: "heavy_rain", alertLevel: 4 })).toBeNull();
  });

  it("結果はルールの表の並び（一覧を氏名の順に並べ替えても変わらない）で、ピンの色は行の lib/triage の色", () => {
    const byKana = sortCaseload(disasterRows, "kana");
    const side = sideDisasterOf(byKana, { kind: "heavy_rain", alertLevel: 4 })!;
    expect(side.results.map((r) => r.personId)).toEqual(results.map((r) => r.personId));
    expect(side.results.map((r) => r.color)).toEqual(results.map((r) => r.color));
    const data = buildSidePane(byKana, { sort: "kana", disaster: side });
    expect(data.mode).toBe("disaster");
    const pins = pinsIn(render(data));
    for (const r of disasterRows) expect(pins.get(r.id), r.id).toBe(COLOR_TONES[r.triage!.color]);
    // 連絡の順が先頭の人がいちばん上に重なる
    expect(data.pins[data.pins.length - 1].id).toBe(results[0].personId);
  });

  it("場面は災害の種類と警戒レベルから（大雨 レベル 4・レベルなし・地震）", () => {
    const rain = buildSidePane(disasterRows, { sort: "tier", disaster: sideDisasterOf(disasterRows, { kind: "heavy_rain", alertLevel: 4 }) });
    expect(rain.demo?.title).toBe("大雨 レベル 4");
    const noLevel = buildSidePane(disasterRows, { sort: "tier", disaster: sideDisasterOf(disasterRows, { kind: "heavy_rain", alertLevel: null }) });
    expect(noLevel.demo?.title).toBe("大雨");
    const quake = buildSidePane(disasterRows, { sort: "tier", disaster: sideDisasterOf(disasterRows, { kind: "earthquake", alertLevel: null }) });
    expect(quake.demo?.title).toBe("地震 南海トラフ");
    expect(quake.demo?.quake?.intensity).toBe("6強");
  });
});
