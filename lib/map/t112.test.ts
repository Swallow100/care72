// T112 のテスト: 避難経路の直し（避難先の候補・家と避難先の印・徒歩の見込み・手段の選ぶ欄・冠水注意・key の警告）。
// 候補のデータ（国土地理院の指定緊急避難場所・指定避難所）は本物を読まない。偽の fetch と架空の GeoJSON だけ。
// 本物の openrouteservice も呼ばない。保存は node:sqlite の D1 で往復する。
import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { RouteEditor, RouteMapPanel } from "../../components/map/RouteMap.tsx";
import { RouteSceneSvg } from "../../components/map/RouteSceneSvg.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { parseLedger } from "../db/ledger.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { TRANSPORT_KINDS, type GeoPoint, type Ledger, type RouteMap } from "../db/types.ts";
import { questionQueue } from "../intake/ask.ts";
import { editChanges, editDraft, type EditData } from "../intake/edit.ts";
import { INTAKE_FIELDS } from "../intake/fields.ts";
import { intakePropsOf } from "../intake/props.ts";
import { saveIntake, SaveRequestSchema } from "../intake/save.ts";
import { loadPersonPage, toPersonView, type PersonPageRows } from "../person.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { sourceById } from "../sources/index.ts";
import { modeOf, orsRequest } from "./route.ts";
import { destNameChanges, frameOf, pickCandidate, pickPoint, pointInFrame, routeChange, routeDraft, routeSummary } from "./route-edit.ts";
import { markPath, ROUTE_FRAME, routeScene, sceneSvg } from "./route-image.ts";
import {
  candidateKinds,
  cleanName,
  fetchShelters,
  parseShelterTile,
  shelterCandidates,
  shelterLayers,
  shelterTiles,
  shelterUrl,
  snapCandidate,
  SHELTER_CREDIT,
  SHELTER_MAX,
  SHELTER_ZOOM,
  type ShelterLayer,
} from "./shelters.ts";
import { floodCar, kindFromText, routeModeOf, transportKindOf, transportText, walkMinutes, walkSpeedOf, WALK_SPEEDS } from "./transport.ts";

const NOW = new Date("2026-11-05T03:00:00.000Z");
const PID = "p-01";

const yamamoto: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});

async function rowsOf(id = PID): Promise<PersonPageRows> {
  return (await loadPersonPage(db, yamamoto, id))!;
}
async function editData(id = PID): Promise<EditData> {
  return intakePropsOf(await rowsOf(id), false).edit;
}
const ledgerOf = async (id = PID) => parseLedger((await rowsOf(id)).person.ledger);

/** 家（p-01 の種の位置） */
const HOME: GeoPoint = { lat: 33.812, lng: 132.7487 };

/** 架空の施設（名前は架空、位置は家のまわり） */
const SCHOOL: GeoPoint = { lat: 33.8085, lng: 132.7521 };
const HALL: GeoPoint = { lat: 33.8158, lng: 132.7455 };
const FAR: GeoPoint = { lat: 33.9, lng: 132.9 };

/** 地理院タイルの GeoJSON の形（地理院タイル一覧の属性: name・address・remarks・disaster1〜8・accept） */
function tile(features: Array<{ name: unknown; at: GeoPoint | null; props?: Record<string, unknown> }>) {
  return {
    type: "FeatureCollection",
    features: features.map((f) => ({
      type: "Feature",
      geometry: f.at ? { type: "Point", coordinates: [f.at.lng, f.at.lat] } : null,
      properties: { name: f.name, address: "架空市架空町", remarks: "", ...f.props },
    })),
  };
}

/** 呼ばれた要求を覚える偽の fetch。url → 返事（無い url は 404） */
function fakeFetch(answers: Record<string, { status: number; body?: unknown } | "throw">) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const a = answers[String(url)];
    if (a === "throw") throw new TypeError("network");
    if (!a) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(a.body ?? null), { status: a.status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const SIH: ShelterLayer = { id: "sih", kind: "shelter" };
const SFH: ShelterLayer = { id: "sfh", kind: "welfare" };
const QUAKE: ShelterLayer = { id: "skhb04", kind: "emergency", disaster: "quake" };
const FLOOD: ShelterLayer = { id: "skhb01", kind: "emergency", disaster: "flood" };

describe("避難先の候補: 外へ出る物（T112 の 4）", () => {
  it("要求は地理院の層とズーム 10 のタイルの z/x/y だけ（家の座標・名前・見出し・本文は無い）", async () => {
    const tiles = shelterTiles(HOME);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
    const { f, calls } = fakeFetch({});
    const r = await fetchShelters({ home: HOME, layers: [SIH, QUAKE], fetch: f });
    expect(r).toEqual({ ok: true, candidates: [] });
    expect(calls.length).toBe(2 * tiles.length);
    for (const c of calls) {
      expect(c.url).toMatch(/^https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/(skhb0[1-8]|sih|sfh)\/10\/\d+\/\d+\.geojson$/);
      expect(c.url).not.toContain(String(HOME.lat));
      expect(c.url).not.toContain(String(HOME.lng));
      expect(c.init.method).toBe("GET");
      expect(c.init.body).toBeUndefined();
      expect(c.init.headers).toBeUndefined();
    }
    expect(shelterUrl("skhb04", { x: 893, y: 410 })).toBe(`https://cyberjapandata.gsi.go.jp/xyz/skhb04/${SHELTER_ZOOM}/893/410.geojson`);
  });

  it("タイルは家のまわり 5 km を覆う（家を含むタイルがある）", () => {
    const z = SHELTER_ZOOM;
    const n = 2 ** z;
    const x = Math.floor(((HOME.lng + 180) / 360) * n);
    const latR = (HOME.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
    expect(shelterTiles(HOME)).toContainEqual({ x, y });
  });

  it("読む層: 指定避難所（一般・福祉）と地震、台帳のハザードに合う種類だけ", () => {
    const base: Pick<Ledger, "evacuation"> = { evacuation: { hazards: [] } };
    expect(shelterLayers(base).map((l) => l.id)).toEqual(["sih", "sfh", "skhb04"]);
    expect(shelterLayers({ evacuation: { hazards: [{ kind: "flood", depthM: 3 }] } }).map((l) => l.id)).toEqual(["sih", "sfh", "skhb01", "skhb04", "skhb07"]);
    expect(shelterLayers({ evacuation: { hazards: [{ kind: "landslide" }, { kind: "tsunami" }] } }).map((l) => l.id)).toEqual([
      "sih",
      "sfh",
      "skhb02",
      "skhb04",
      "skhb05",
    ]);
  });

  it("openrouteservice へ送る物は増えない（2 点の座標と instructions だけ。手段は選ぶ欄から）", () => {
    const { init, url } = orsRequest(HOME, SCHOOL, routeModeOf({ transportKind: "pickup" }), "k");
    expect(url).toContain("/driving-car/");
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(["coordinates", "instructions"]);
  });
});

describe("避難先の候補: 読み方（T112 の 1・4）", () => {
  it("GeoJSON の点から名前・位置・災害の種類。形の違う物・位置や名前の無い物は落とす", () => {
    const raws = parseShelterTile(
      QUAKE,
      tile([
        { name: "架空第一小学校", at: SCHOOL, props: { disaster1: "1", disaster4: "1" } },
        { name: "  架空\n公民館  ", at: HALL, props: { disaster4: 1 } },
        { name: "", at: HALL },
        { name: "位置なし", at: null },
        { name: 12, at: HALL },
      ]),
    );
    expect(raws).toEqual([
      { name: "架空第一小学校", at: SCHOOL, disasters: ["flood", "quake"], shelter: false, welfare: false },
      { name: "架空 公民館", at: HALL, disasters: ["quake"], shelter: false, welfare: false },
    ]);
    expect(parseShelterTile(QUAKE, { nope: true })).toEqual([]);
    expect(parseShelterTile(QUAKE, null)).toEqual([]);
    expect(cleanName("あ".repeat(80))).toHaveLength(60);
  });

  it("同じ施設（同じ名前で 50 m の中）は層をまとめ、家から 5 km の中を近い順に上限まで", () => {
    const raws = [
      ...parseShelterTile(SIH, tile([{ name: "架空第一小学校", at: SCHOOL }])),
      ...parseShelterTile(QUAKE, tile([{ name: "架空第一小学校", at: { lat: SCHOOL.lat + 0.0002, lng: SCHOOL.lng } }, { name: "遠い所", at: FAR }])),
      ...parseShelterTile(SFH, tile([{ name: "架空ケアホーム", at: HALL }])),
    ];
    const c = shelterCandidates(raws, HOME);
    expect(c.map((x) => x.name)).toEqual(["架空第一小学校", "架空ケアホーム"]);
    expect(c[0]).toMatchObject({ shelter: true, welfare: false, disasters: ["quake"], at: SCHOOL });
    expect(c[1].welfare).toBe(true);
    expect(c[0].distanceM).toBeLessThan(c[1].distanceM);
    expect(candidateKinds(c[0], { emergency: "緊急避難", shelter: "避難所", welfare: "福祉" })).toBe("避難所・緊急避難 地震");
    expect(candidateKinds(c[1], { emergency: "緊急避難", shelter: "避難所", welfare: "福祉" })).toBe("福祉");
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `架空${i}`, at: { lat: HOME.lat + i * 0.0005, lng: HOME.lng }, disasters: [], shelter: true, welfare: false }));
    expect(shelterCandidates(many, HOME)).toHaveLength(SHELTER_MAX);
  });

  it("404 は空（その所にデータが無い）、一部が失敗しても読めた分を出す、全部失敗なら失敗", async () => {
    const [t] = shelterTiles(HOME);
    const ok = fakeFetch({ [shelterUrl("sih", t)]: { status: 200, body: tile([{ name: "架空第一小学校", at: SCHOOL }]) }, [shelterUrl("skhb04", t)]: "throw" });
    const r = await fetchShelters({ home: HOME, layers: [SIH, QUAKE], fetch: ok.f });
    expect(r.ok && r.candidates.map((c) => c.name)).toEqual(["架空第一小学校"]);
    const all = Object.fromEntries(shelterTiles(HOME).flatMap((x) => [SIH, QUAKE].map((l) => [shelterUrl(l.id, x), { status: 500 }])));
    expect(await fetchShelters({ home: HOME, layers: [SIH, QUAKE], fetch: fakeFetch(all).f })).toEqual({ ok: false });
  });

  it("出典と注意: 国土地理院の出典と加工した旨、注意の頁へのリンク", () => {
    expect(SHELTER_CREDIT.text).toContain("国土地理院");
    expect(SHELTER_CREDIT.text).toContain("加工");
    expect(SHELTER_CREDIT.noticeHref).toBe("https://www.gsi.go.jp/bousaichiri/hinanbasho-menseki.html");
    expect(SHELTER_CREDIT.notice).toContain("市町村に確認");
  });
});

describe("候補から選んだ避難先の保存（T112 の 4）", () => {
  it("候補を選ぶと名前と位置が今の避難先に入り、経路地図と避難先の文字を 1 回で保存して読み戻す", async () => {
    const data = await editData();
    const before = data.ledger.evacuation.destination1;
    const cand = shelterCandidates(parseShelterTile(SIH, tile([{ name: "架空第一小学校", at: SCHOOL }])), HOME)[0];
    const d = pickCandidate(routeDraft(data.ledger, HOME), cand);
    expect(d.dest[1]).toEqual(SCHOOL);
    expect(d.names?.[1]).toBe("架空第一小学校");
    expect(d.tool).toBe("via");
    const names = destNameChanges(data.ledger, d);
    expect(names).toEqual([{ t: "field", key: "evacuation.destination1", value: "架空第一小学校", overwrite: true }]);
    const changes = [routeChange(data.ledger, d)!, ...names];
    const r = await saveIntake(db, yamamoto, SaveRequestSchema.parse({ personId: PID, version: data.version, ai: null, edit: true, changes }), NOW);
    expect(r).toMatchObject({ ok: true, version: data.version + 1 });
    const l = await ledgerOf();
    expect(l.evacuation.destination1).toBe("架空第一小学校");
    expect(l.evacuation.destination1).not.toBe(before);
    expect(l.evacuation.destination1Location).toEqual(SCHOOL);
    // 読み戻すと同じ。そのままなら送る物は無い
    const back = await editData();
    const d2 = routeDraft(back.ledger, HOME);
    expect(d2.names?.[1]).toBe("架空第一小学校");
    expect(routeChange(back.ledger, d2)).toBeNull();
    expect(destNameChanges(back.ledger, d2)).toEqual([]);
  });

  it("手で置くと名前は変えない。候補の近く（40 m の中）なら候補に寄せる", async () => {
    const data = await editData();
    const d = routeDraft(data.ledger, HOME);
    const hand = pickPoint({ ...d, tool: "dest" }, { lat: 33.81, lng: 132.751 });
    expect(destNameChanges(data.ledger, hand)).toEqual([]);
    const cands = shelterCandidates(parseShelterTile(SIH, tile([{ name: "架空第一小学校", at: SCHOOL }])), HOME);
    expect(snapCandidate(cands, { lat: SCHOOL.lat + 0.0002, lng: SCHOOL.lng }, 40)?.name).toBe("架空第一小学校");
    expect(snapCandidate(cands, { lat: SCHOOL.lat + 0.002, lng: SCHOOL.lng }, 40)).toBeNull();
  });

  it("候補の位置は枠の中の比に戻せる（地図の上の印の位置。pointInFrame の逆）", () => {
    const view = { center: HOME, z: 15 };
    const p = pointInFrame(view, 0.3, 0.7);
    const f = frameOf(view, p);
    expect(f.fx).toBeCloseTo(0.3, 2);
    expect(f.fy).toBeCloseTo(0.7, 2);
  });

  it("候補の名前・位置は Claude に渡す形に増えない（位置は無い）", async () => {
    const data = await editData();
    const d = pickCandidate(routeDraft(data.ledger, HOME), { name: "架空第一小学校", at: SCHOOL });
    await saveIntake(
      db,
      yamamoto,
      SaveRequestSchema.parse({ personId: PID, version: data.version, ai: null, edit: true, changes: [routeChange(data.ledger, d)!, ...destNameChanges(data.ledger, d)] }),
      NOW,
    );
    const rows = await rowsOf();
    const l = parseLedger(rows.person.ledger);
    expect(l.evacuation.destination1Location).toEqual(SCHOOL);
    const { payload } = pseudonymize([{ person: rows.person, ledger: l, contacts: [...rows.contacts], clocks: [...rows.clocks] }]);
    const out = JSON.stringify(payload);
    expect(out).not.toContain(String(SCHOOL.lat));
    expect(out).not.toContain(String(SCHOOL.lng));
    expect(out).not.toContain("destination1Location");
  });
});

describe("徒歩の見込み（T112 の 問い 2）", () => {
  const base = (care: Partial<Ledger["care"]>, e: Partial<Ledger["evacuation"]> = {}): Pick<Ledger, "care" | "evacuation"> => ({
    care,
    evacuation: { hazards: [], ...e },
  });

  it("歩行 問題なし 1.0・一部 0.8・困難 0.5 m/秒。未確認・寝たきり・車いすは 0.5（出典 fdma-tsunami-2013）", () => {
    expect(WALK_SPEEDS).toEqual({ ok: 1.0, some: 0.8, hard: 0.5 });
    expect(walkSpeedOf(base({ walking: "ok" }))).toBe(1.0);
    expect(walkSpeedOf(base({ walking: "some" }))).toBe(0.8);
    expect(walkSpeedOf(base({ walking: "hard" }))).toBe(0.5);
    expect(walkSpeedOf(base({}))).toBe(0.5);
    expect(walkSpeedOf(base({ walking: "ok", bedridden: true }))).toBe(0.5);
    expect(walkSpeedOf(base({ walking: "ok" }, { transportKind: "wheelchair" }))).toBe(0.5);
    expect(sourceById("fdma-tsunami-2013").summary).toContain("1.0 m/秒");
  });

  it("見込みの分は切り上げ（822 m を 0.8 m/秒で 18 分）。徒歩の要約は「約 N 分 目安」、大人の速さの時間は出さない", () => {
    expect(walkMinutes(822, 0.8)).toBe(18);
    expect(walkMinutes(10, 1)).toBe(1);
    const foot = { mode: "foot" as const, source: "ors" as const, distanceM: 822, durationS: 592 };
    expect(routeSummary(foot, 0.8)).toBe("徒歩 822 m 約 18 分 目安 自動");
    expect(routeSummary(foot)).toBe("徒歩 822 m 自動");
    expect(routeSummary({ ...foot, source: "hand" }, 0.5)).toBe("徒歩 822 m 約 28 分 目安 手入力");
    // 車は openrouteservice の時間のまま
    expect(routeSummary({ mode: "car", source: "ors", distanceM: 957, durationS: 120 }, 0.8)).toBe("車 957 m 約 2 分 自動");
  });

  it("経路地図の行: 歩行が一部の人（p-01）の徒歩の経路は 0.8 m/秒の見込み", async () => {
    const data = await editData();
    const map: RouteMap = { to: 1, mode: "foot", source: "ors", line: [HOME, SCHOOL], via: [], distanceM: 1235, durationS: 988, view: { center: HOME, z: 15 } };
    const ledger: Ledger = { ...data.ledger, evacuation: { ...data.ledger.evacuation, destination1Location: SCHOOL, routeMap: map } };
    const html = renderToStaticMarkup(createElement(RouteMapPanel, { data: { ...data, ledger } }));
    expect(html).toContain("徒歩 1.2 km 約 26 分 目安 自動");
    expect(html).not.toContain("約 16 分");
  });
});

describe("手段の選ぶ欄（T112 の 問い 3）", () => {
  it("前の文字は modeOf と同じ決まりで読み替え（経路の手段は変わらない）", () => {
    const texts = ["娘の車", "長男の車", "訪問看護と夫", "徒歩", "車いす", "車椅子で娘が押す", "施設の送迎車", "送迎", "タクシー", "", "家族の車"];
    for (const t of texts) expect(routeModeOf({ transport: t }), t).toBe(modeOf(t));
    expect(kindFromText("娘の車")).toBe("family_car");
    expect(kindFromText("訪問看護と夫")).toBe("other");
    expect(kindFromText("徒歩")).toBe("foot");
    expect(kindFromText("車いす")).toBe("wheelchair");
    expect(kindFromText("施設の送迎車")).toBe("pickup");
    expect(kindFromText("  ")).toBeNull();
  });

  it("選ぶ欄から経路の手段: 徒歩・車いすは徒歩、家族の車・送迎は車、その他は補記の文字", () => {
    expect(routeModeOf({ transportKind: "foot", transport: "娘の車" })).toBe("foot");
    expect(routeModeOf({ transportKind: "wheelchair" })).toBe("foot");
    expect(routeModeOf({ transportKind: "family_car" })).toBe("car");
    expect(routeModeOf({ transportKind: "pickup" })).toBe("car");
    expect(routeModeOf({ transportKind: "other", transport: "近所の人の車" })).toBe("car");
    expect(routeModeOf({ transportKind: "other", transport: "リヤカー" })).toBe("foot");
    expect(transportKindOf({ transportKind: "pickup", transport: "娘の車" })).toBe("pickup");
  });

  it("手段の文字は 1 つの形（選ぶ欄と補記、補記が同じ言葉なら 1 つ、古い台帳は文字のまま）", () => {
    expect(transportText({ transportKind: "family_car", transport: "娘の車" })).toBe("家族の車（娘の車）");
    expect(transportText({ transportKind: "foot" })).toBe("徒歩");
    expect(transportText({ transportKind: "foot", transport: "徒歩" })).toBe("徒歩");
    expect(transportText({ transport: "娘の車" })).toBe("娘の車");
    expect(transportText({})).toBeUndefined();
  });

  it("入れる欄: 手段は選ぶ欄（5 つ）と補記。編集の下書きは前の文字から選んでおき、触らなければ変更にしない", async () => {
    const kind = INTAKE_FIELDS.find((f) => f.key === "evacuation.transportKind")!;
    expect(kind.label).toBe("手段");
    expect(kind.shape.type === "enum" && kind.shape.options.map((o) => o.value)).toEqual([...TRANSPORT_KINDS]);
    expect(kind.shape.type === "enum" && kind.shape.options.map((o) => o.label)).toEqual(["徒歩", "車いす", "家族の車", "送迎", "その他"]);
    expect(INTAKE_FIELDS.find((f) => f.key === "evacuation.transport")?.label).toBe("手段補記");
    const data = await editData();
    const draft = editDraft(data);
    expect(draft.values["evacuation.transportKind"]).toBe("family_car");
    expect(draft.values["evacuation.transport"]).toBe("娘の車");
    expect(editChanges("evacuation", data, draft)).toEqual([]);
    const changed = { ...draft, values: { ...draft.values, "evacuation.transportKind": "pickup" } };
    expect(editChanges("evacuation", data, changed)).toEqual([{ t: "field", key: "evacuation.transportKind", value: "pickup", overwrite: true }]);
    const r = await saveIntake(
      db,
      yamamoto,
      SaveRequestSchema.parse({ personId: PID, version: data.version, ai: null, edit: true, changes: editChanges("evacuation", data, changed) }),
      NOW,
    );
    expect(r).toMatchObject({ ok: true });
    const l = await ledgerOf();
    expect(l.evacuation.transportKind).toBe("pickup");
    expect(l.evacuation.transport).toBe("娘の車");
    expect(routeDraft(l, HOME).mode).toBe("car");
  });

  it("本人のページの「手段」の行は選ぶ欄と補記", async () => {
    const view = toPersonView(await rowsOf(), { today: "2026-11-05" });
    const html = JSON.stringify(view);
    expect(html).toContain("家族の車");
    expect(html).toContain("娘の車");
  });

  it("問い: 前の文字がある人には手段を聞かない。空の人には選ぶ欄で聞き、「分からない」は前と同じ場所（evacuation.transport）に残す", async () => {
    const rows = await rowsOf();
    expect(questionQueue(rows).some((q) => q.label === "手段")).toBe(false);
    const empty = { ...rows, person: { ...rows.person, ledger: JSON.stringify({ ...parseLedger(rows.person.ledger), evacuation: { hazards: [] } }) } };
    const q = questionQueue(empty).find((x) => x.label === "手段")!;
    expect(q.key).toBe("evacuation.transport");
    expect(q.answer).toMatchObject({ kind: "choice", field: "evacuation.transportKind" });
    expect(questionQueue(empty).some((x) => x.key === "evacuation.transportKind" || x.label === "手段補記")).toBe(false);
  });
});

describe("冠水注意（T112 の 問い 4）", () => {
  it("浸水のハザードがあり手段が車のときだけ。色と連絡の順の表（lib/triage）は読まない", () => {
    const flood: Pick<Ledger, "evacuation"> = { evacuation: { hazards: [{ kind: "flood", depthM: 3 }] } };
    expect(floodCar(flood, "car")).toBe(true);
    expect(floodCar(flood, "foot")).toBe(false);
    expect(floodCar({ evacuation: { hazards: [{ kind: "landslide" }] } }, "car")).toBe(false);
    expect(sourceById("mlit-kansui-2019").url).toMatch(/^https:\/\/www\.mlit\.go\.jp\//);
  });

  it("窓: 浸水 3 m・手段が娘の車（p-01）は「冠水注意」と根拠。徒歩の人（p-10、ハザードなし）は出ない", async () => {
    const html = renderToStaticMarkup(createElement(RouteEditor, { data: await editData(), onClose: () => {} }));
    expect(html).toContain("冠水注意");
    expect(html).toContain('data-basis="mlit-kansui-2019"');
    const p10 = renderToStaticMarkup(createElement(RouteEditor, { data: await editData("p-10"), onClose: () => {} }));
    expect(p10).not.toContain("冠水注意");
  });
});

describe("家と避難先の印（T112 の 2）", () => {
  it("家は家の形、避難先は旗の形。画面の絵と紙が同じ形（同じ path）", () => {
    const map: RouteMap = { to: 1, mode: "foot", source: "hand", line: [HOME, SCHOOL], via: [], distanceM: 500, view: { center: HOME, z: 15 } };
    const scene = routeScene({ map, home: HOME, dest: SCHOOL, size: ROUTE_FRAME });
    const paper = sceneSvg(scene, ROUTE_FRAME, "px");
    const screen = renderToStaticMarkup(createElement(RouteSceneSvg, { scene, label: "避難経路" }));
    const dOf = (svg: string, pin: string) => svg.match(new RegExp(`data-route-pin="${pin}"><path d="([^"]+)"`))?.[1];
    for (const pin of ["home", "dest"]) {
      expect(dOf(paper, pin), pin).toBeTruthy();
      expect(dOf(screen, pin), pin).toBe(dOf(paper, pin));
    }
    expect(dOf(paper, "home")).not.toBe(dOf(paper, "dest"));
    expect(markPath("home", 0, 0, 1)).not.toBe(markPath("dest", 0, 0, 1));
    // 丸と四角の印は使わない（経由点の白丸だけ）
    expect(paper).not.toMatch(/data-route-pin="(home|dest)"><(circle|rect)/);
  });

  it("旗は竿の根元が位置（印の下の端が位置の高さ）、家の形は位置が真ん中", () => {
    const nums = (d: string) => [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    const flag = nums(markPath("dest", 100, 100, 10));
    expect(Math.max(...flag.map((p) => p.y))).toBe(100);
    const house = nums(markPath("home", 100, 100, 10));
    expect(Math.max(...house.map((p) => p.y))).toBeGreaterThan(100);
    expect(Math.min(...house.map((p) => p.y))).toBeLessThan(100);
  });
});

describe("経路地図の窓の key の警告（T112 の 3）", () => {
  it("窓を描いても React の key の警告が出ない", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      renderToStaticMarkup(createElement(RouteEditor, { data: await editData(), onClose: () => {} }));
      const keyWarnings = spy.mock.calls.filter((c) => c.some((x) => typeof x === "string" && x.includes('unique "key"')));
      expect(keyWarnings).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
