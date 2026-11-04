// 出来事の表（docs/tasks/T92.md）。監督（Opus、lib/drill/director.ts）が差し込める出来事の種類を 1 行 1 種類で持つ。Claude を呼ばない。
//
// - 種類はこの表だけ（表の外は捨てる）。Opus が選ぶのは種類・相手・文・理由・根拠・何時間後か（after）だけで、
//   世界の変化はこの表の build（コード）が組む。色と連絡の順はここで決めない（ルールの表 lib/triage だけ。
//   出来事が表に届く道は、時計の頼り先の確認の写し〔施設の休止・world.checks → lib/drill/world-clocks.ts の drillClocks〕だけ）
// - 根拠は出典の登録簿（lib/sources）の id だけ。1 つに決まる種類はコードが付け、監督に選ばせない（basis.by が code）。
//   健康の助言の要旨を持つ文書（呼吸・インスリン・血栓）は監督の指示に入れず、コードが付けて画面に出典として添えるだけ
// - 人の体の具合・生き死には出来事にしない（本人役が演じる）。環境の事（冷蔵不可・車中泊・満員）まで
// - 前からの 6 つ（栄養剤・透析施設・道路・電話・訪問看護・帰宅）は前と同じ並び・同じ変化・同じ文
// - 輪にしない: このファイルは scenarios.ts・labels.ts を型だけ読む（scenarios.ts は HEAVY_RAIN を作るときに injectChange を呼ぶ。
//   labels.ts は markLabels をここから読む）

import type { CheckStatus, ClockCategory, ContactKind, Ledger } from "../db/types.ts";
import type { PseudonymInput } from "../pseudonym/index.ts";
import type { SourceId } from "../sources/index.ts";
import type { PersonState } from "./persona-types.ts";
import type {
  ArrivalRole,
  AskKind,
  ExtraMark,
  NoteTopic,
  PersonMarks,
  SupplyKind,
  WorldChange,
  WorldState,
} from "./scenarios.ts";

// ---------- 種類 ----------

/**
 * 監督が差し込める状況の種類。前からの 6 つを先に同じ並びで、T92 の 20 を表の並びで。
 * 表の外は捨てる（自由な出来事は採点が揺れる）
 */
export const INJECT_KINDS = [
  "supply_left", // 栄養剤の持ち出し忘れ
  "dialysis_flooded", // 透析施設の浸水
  "road_blocked", // 道路が通れない
  "line_down", // 電話が不通
  "nurse_away", // 訪問看護が来られない
  "going_home", // 本人が家に帰ろうとする
  // T92
  "outage_eta", // 停電の復旧の見込み
  "outage_spread", // 停電が全域に
  "mobile_down", // 携帯も不通
  "road_reopen", // 家の前の道が通れるように
  "welfare_shelter_open", // 福祉避難所の開設
  "shelter_full", // 避難所が満員
  "water_station", // 給水所
  "pharmacy_closed", // 薬局の休止
  "helper_closed", // 介護事業所の休止
  "nurse_station_closed", // 訪問看護ステーションの休止
  "hospital_closed", // 病院の休止
  "vendor_round", // 酸素業者の巡回
  "family_stranded", // 家族の帰宅困難
  "car_sleep", // 車中泊
  "no_fridge", // 避難所に冷蔵庫なし
  "neighbor_help", // 近所の人の声掛
  "info_confusion", // 情報の混乱
  "aftershock", // 余震
  "landslide_warn", // 土砂の警戒
  "wandering", // 本人が外へ出た
] as const;
export type InjectKind = (typeof INJECT_KINDS)[number];

export function isInjectKind(v: unknown): v is InjectKind {
  return typeof v === "string" && (INJECT_KINDS as readonly string[]).includes(v);
}

// ---------- 表の行の形 ----------

/** person: 本人 1 人を指す。area: 全体（target は「全体」） */
export type EventScope = "person" | "area";

/** 当てはまるかを見る本人の台帳（仮名化の前。サーバーの中だけ）。ledger の無い呼び方（前のテスト）は台帳の欄を見る種類に当たらない */
export type EventSource = Pick<PseudonymInput, "clocks" | "contacts"> & {
  ledger?: Pick<Ledger, "medical" | "care" | "evacuation">;
};

/** 全体の出来事の場所（満員になる避難所）。id と名前は世界にある物だけ（コードが選ぶ） */
export type EventPlace = { id: string; label: string };

/** 変化を組むのに要る本人の事実（コードが台帳から付ける。監督は選ばない） */
export type EventFacts = { dialysis?: boolean };

/** 出来事 1 つの相手。person は本人の種類の相手、persons は全体の種類で印の付く人（訪問看護ステーションの休止） */
export type EventTarget = {
  person: string | null;
  persons?: ReadonlyArray<string>;
  place?: EventPlace | null;
  facts?: EventFacts;
};

/** 出来事 1 つが組む状況 1 行（1 つの出来事が 2 行以上になる種類がある: 携帯不通と回復見込、土砂の警戒と道） */
export type EventPart = { change: WorldChange; text: string; person?: string };

/** 予定の出来事にできる種類の「何時間後」（監督の after）の範囲と、書かれなかったときの値 */
export type AfterRange = { min: number; max: number; default: number };

/**
 * 根拠の付け方。code: コードが付ける（ids の先頭か basisFor）。director: 監督が ids の中から選ぶ（選ばなければ根拠なし）。
 * ids が空なら根拠なし
 */
export type EventBasis = { by: "code" | "director"; ids: ReadonlyArray<SourceId> };

/** 本人役を呼ぶ理由になる人（T90 の touched）。person は相手、persons は印の付いた人、all は参加者の全員、none は誰も */
export type Touches = "person" | "persons" | "all" | "none";

export type EventRow = {
  kind: InjectKind;
  /** 画面の印（2〜4 字。福祉避難所・避難所満員だけ 5 字） */
  label: string;
  scope: EventScope;
  /** 監督の指示に出す中身（画面の言葉ではない） */
  words: string;
  /** その人に当てはまり、まだ起きていないか（全体の種類は、参加者の誰か 1 人で当てはまれば差し込める） */
  eligible: (source: EventSource, person: string, world: WorldState, state: PersonState | null) => boolean;
  /** 世界の変化（コード）。hour は差し込む時刻（発災からの時間）、after は何時間後（予定の種類だけ） */
  build: (target: EventTarget, hour: number, after: number | null) => EventPart[];
  /** 固定の文（Opus の文が使えないとき。ownText の種類はいつもこれ） */
  text: (after: number | null) => string;
  /** 文をコードが書く（何時間後・震度・避難所の名前が入る物。Opus の文と食い違わないように） */
  ownText?: true;
  basis: EventBasis;
  /** 根拠が本人で変わる種類（透析の人は透析の文書）。無ければ ids の先頭 */
  basisFor?: (source: EventSource) => SourceId | null;
  /** 変化を組むのに要る本人の事実（コードが台帳から付ける。病院の休止で透析の人か） */
  factsFor?: (source: EventSource) => EventFacts;
  touches: Touches;
  after?: AfterRange;
  /** 全体の種類で場所が要る物（満員になる避難所）。無ければ差し込めない */
  place?: (world: WorldState) => EventPlace | null;
};

// ---------- 当てはまるかを見る小さな道具（scenarios.ts を値で読まない） ----------

const has = (s: EventSource, c: ClockCategory) => s.clocks.some((k) => k.category === c);
const contact = (s: EventSource, kinds: ReadonlyArray<ContactKind>) => s.contacts.some((c) => kinds.includes(c.kind));
const marked = (w: WorldState, p: string, k: keyof PersonMarks) => w.marks[p]?.[k] !== undefined;
/** 家の外（避難所・その他）にいると連絡のあった人 */
const away = (s: PersonState | null) => s?.whereNow === "shelter" || s?.whereNow === "other";
/** 本人の家の電話（scenarios.ts の phoneOf と同じ。値で読まないので写した） */
const lineOf = (w: WorldState, p: string) => (w.marks[p]?.lineDown !== undefined ? "down" : w.phone);
const closedFacility = (w: WorldState, id: string) => w.facilities.some((f) => f.id === id && !f.open);
const devices = (s: EventSource) => s.ledger?.medical.devices ?? [];
const medications = (s: EventSource) => s.ledger?.medical.medications ?? [];
const oxygenUser = (s: EventSource) =>
  has(s, "oxygen") || has(s, "ventilator") || devices(s).some((d) => d.kind === "oxygen" || d.kind === "ventilator");
const coldMedicine = (s: EventSource) => has(s, "insulin") || medications(s).some((m) => m.needsRefrigeration === true);
const dialysisUser = (s: EventSource) => has(s, "dialysis") || devices(s).some((d) => d.kind === "dialysis");
const one = (change: WorldChange, text: string, person?: string | null): EventPart[] => [{ change, text, ...(person ? { person } : {}) }];
/** 予定の時刻（発災からの分） */
const atMinute = (hour: number, after: number) => Math.round((hour + after) * 60);

/** 満員にできる避難所（混雑の物を先に、無ければ開設の物。後から開いた物を先に） */
function fullable(world: WorldState): EventPlace | null {
  const open = [...world.shelters].reverse();
  const s = open.find((x) => x.state === "crowded") ?? open.find((x) => x.state === "open");
  return s ? { id: s.id, label: s.label } : null;
}

/** 余震の震度（コードが決める。発災から 1 日は 5弱、そのあとは 4） */
export const aftershockIntensity = (hour: number) => (hour < 24 ? "5弱" : "4");

const NONE: EventBasis = { by: "code", ids: [] };
const code = (...ids: SourceId[]): EventBasis => ({ by: "code", ids });
/** 前からの 6 つ: 監督が DIRECTOR_SOURCES の 5 つから選ぶ（前と同じ。lib/drill/director.ts で絞る） */
const ANY: EventBasis = {
  by: "director",
  ids: ["cao-shishin-2021", "mhlw-bcp-2020", "nanbyo-shishin-2017", "jadp-dialysis-2023", "mhlw-dementia-2018"],
};

// ---------- 表 ----------

const ROWS: ReadonlyArray<EventRow> = [
  // ---------- 前からの 6 つ（T19。同じ変化・同じ文） ----------
  {
    kind: "supply_left",
    label: "持ち出し",
    scope: "person",
    words: "家族・本人が栄養剤を持ち出し忘れた（経管栄養の人）",
    eligible: (s, p, w) => has(s, "tube_feeding") && !marked(w, p, "supplyLeft"),
    build: (t) => one({ kind: "supply_left" }, "家族が栄養剤を持ち出し忘れた", t.person),
    text: () => "家族が栄養剤を持ち出し忘れた",
    basis: ANY,
    touches: "person",
  },
  {
    kind: "dialysis_flooded",
    label: "透析休止",
    scope: "person",
    words: "通う透析施設が浸水して休止（透析の人）",
    // 頼り先の透析の施設がもう休止なら当てない（薬局・病院の休止〔T92〕は数えない）
    eligible: (s, p, w) => has(s, "dialysis") && !w.facilities.some((f) => f.person === p && !f.open && f.depends === "dialysis_center"),
    build: (t) =>
      one({ kind: "facility", id: `fc-${t.person}`, label: "透析施設", open: false, depends: "dialysis_center" }, "透析施設 浸水で休止", t.person),
    text: () => "透析施設 浸水で休止",
    basis: ANY,
    touches: "person",
  },
  {
    kind: "road_blocked",
    label: "通行止",
    scope: "person",
    words: "家の前の道が通れない（冠水・土砂・倒木）",
    eligible: (_s, p, w) => !w.roads.some((r) => r.person === p && !r.open),
    build: (t) => one({ kind: "road", id: `rd-${t.person}`, label: "家の前の道", open: false }, "家の前の道 通行止め", t.person),
    text: () => "家の前の道 通行止め",
    basis: ANY,
    touches: "person",
  },
  {
    kind: "line_down",
    label: "電話不通",
    scope: "person",
    words: "家の電話が不通",
    eligible: (_s, p, w) => lineOf(w, p) !== "down",
    build: (t) => one({ kind: "line_down" }, "家の電話 不通", t.person),
    text: () => "家の電話 不通",
    basis: ANY,
    touches: "person",
  },
  {
    kind: "nurse_away",
    label: "訪問不可",
    scope: "person",
    words: "訪問看護が来られない（訪問看護を使う人）",
    eligible: (s, p, w) => contact(s, ["visiting_nurse"]) && !marked(w, p, "nurseAway"),
    build: (t) => one({ kind: "nurse_away" }, "訪問看護 来られない", t.person),
    text: () => "訪問看護 来られない",
    basis: ANY,
    touches: "person",
  },
  {
    kind: "going_home",
    label: "帰宅希望",
    scope: "person",
    words: "本人が避難先から家に帰ろうとする（家の外にいる人）",
    eligible: (_s, p, w, st) => away(st) && !marked(w, p, "goingHome"),
    build: (t) => one({ kind: "going_home" }, "本人が家に帰ろうとする", t.person),
    text: () => "本人が家に帰ろうとする",
    basis: ANY,
    touches: "person",
  },

  // ---------- T92: 全体の出来事 ----------
  {
    kind: "outage_eta",
    label: "復旧見込",
    scope: "area",
    words: "停電の復旧の見込みが出る（停電中。after に何時間後に復旧するか）",
    eligible: (_s, _p, w) =>
      w.outage !== null && w.outage.restoredAt === null && !(w.scheduled ?? []).some((x) => x.change.kind === "outage_restored"),
    build: (_t, hour, after) => {
      const n = after ?? 6;
      return one(
        { kind: "schedule", at: atMinute(hour, n), by: "director", then: { kind: "event", change: { kind: "outage_restored" }, text: "停電 復旧" } },
        `停電 復旧見込 ${n} 時間後`,
      );
    },
    text: (after) => `停電 復旧見込 ${after ?? 6} 時間後`,
    ownText: true,
    basis: { by: "director", ids: ["mhlw-bcp-2020"] },
    touches: "none",
    after: { min: 2, max: 12, default: 6 },
  },
  {
    kind: "outage_spread",
    label: "停電拡大",
    scope: "area",
    words: "地区の停電が全域に広がる（地区の停電中）",
    eligible: (_s, _p, w) => w.outage !== null && w.outage.restoredAt === null && w.outage.area.scope !== "office",
    build: () => one({ kind: "outage", area: { scope: "office" } }, "停電 全域に拡大"),
    text: () => "停電 全域に拡大",
    basis: NONE,
    touches: "all",
  },
  {
    kind: "mobile_down",
    label: "携帯不通",
    scope: "area",
    words: "携帯電話も含めて電話が不通になる（電話が通じている間。after に何時間後に一部回復するか）",
    eligible: (_s, _p, w) => w.phone !== "down",
    build: (_t, hour, after) => {
      const n = after ?? 3;
      return [
        { change: { kind: "phone", state: "down" }, text: "携帯電話も不通" },
        {
          change: { kind: "schedule", at: atMinute(hour, n), by: "director", then: { kind: "event", change: { kind: "phone", state: "busy" }, text: "電話 一部回復" } },
          text: `電話 一部回復見込 ${n} 時間後`,
        },
      ];
    },
    text: () => "携帯電話も不通",
    ownText: true,
    basis: NONE,
    touches: "all",
    after: { min: 1, max: 6, default: 3 },
  },
  {
    kind: "road_reopen",
    label: "道路復旧",
    scope: "person",
    words: "通れなかった家の前の道が通れるようになる（家の前の道が通行止めの人）",
    eligible: (_s, p, w) => w.roads.some((r) => r.id === `rd-${p}` && !r.open),
    build: (t) => one({ kind: "road", id: `rd-${t.person}`, label: "家の前の道", open: true }, "家の前の道 通行再開", t.person),
    text: () => "家の前の道 通行再開",
    basis: NONE,
    touches: "person",
  },
  {
    kind: "welfare_shelter_open",
    label: "福祉避難所",
    scope: "area",
    words: "福祉避難所が開設される（まだ開設なし）",
    eligible: (_s, _p, w) => !w.shelters.some((x) => x.id === WELFARE_SHELTER_ID),
    // 受入依頼の確率は変えない（lib/drill/world-reply.ts の WORLD_ODDS のまま）
    build: () => one({ kind: "shelter", id: WELFARE_SHELTER_ID, label: "福祉避難所", state: "open" }, "福祉避難所 開設"),
    text: () => "福祉避難所 開設",
    basis: code("cao-shishin-2021"),
    touches: "none",
  },
  {
    kind: "shelter_full",
    label: "避難所満員",
    scope: "area",
    words: "開設中の避難所が満員になる",
    eligible: (_s, _p, w) => fullable(w) !== null,
    place: fullable,
    build: (t) => (t.place ? one({ kind: "shelter", id: t.place.id, label: t.place.label, state: "full" }, `${t.place.label} 満員`) : []),
    text: () => "避難所 満員",
    ownText: true,
    basis: code("mhlw-bcp-2020"),
    touches: "none",
  },
  {
    kind: "water_station",
    label: "給水所",
    scope: "area",
    words: "給水所が開設される（断水中。断水は続く）",
    eligible: (_s, _p, w) => w.water === "out" && w.notes?.water_station === undefined,
    build: () => one({ kind: "note", topic: "water_station" }, "給水所 開設"),
    text: () => "給水所 開設",
    basis: NONE,
    touches: "all",
  },
  {
    kind: "nurse_station_closed",
    label: "訪看休止",
    scope: "area",
    words: "訪問看護ステーションが休止し、訪問看護を使う人の全員が来てもらえない",
    eligible: (s, p, w) => contact(s, ["visiting_nurse"]) && !marked(w, p, "nurseAway") && !closedFacility(w, NURSE_STATION_ID),
    build: (t) => [
      { change: { kind: "facility", id: NURSE_STATION_ID, label: "訪問看護ステーション", open: false }, text: "訪問看護ステーション 休止" },
      ...(t.persons ?? []).map((p): EventPart => ({ change: { kind: "nurse_away" }, text: "訪問看護 来られない", person: p })),
    ],
    text: () => "訪問看護ステーション 休止",
    basis: code("mhlw-bcp-2020"),
    touches: "persons",
  },
  {
    kind: "info_confusion",
    label: "情報混乱",
    scope: "area",
    words: "避難の情報が食い違って広まる（訓練に 1 回）",
    eligible: (_s, _p, w) => w.notes?.info_confusion === undefined,
    build: () => one({ kind: "note", topic: "info_confusion" }, "避難の情報が食い違っている"),
    text: () => "避難の情報が食い違っている",
    basis: NONE,
    touches: "all",
  },
  {
    kind: "aftershock",
    label: "余震",
    scope: "area",
    words: "余震（地震が起きている想定）",
    eligible: (_s, _p, w) => w.quake !== null,
    build: (_t, hour) => one({ kind: "quake", intensity: aftershockIntensity(hour) }, `余震 震度 ${aftershockIntensity(hour)}`),
    text: () => "余震",
    ownText: true,
    basis: NONE,
    touches: "all",
  },

  // ---------- T92: 本人ごとの出来事 ----------
  {
    kind: "pharmacy_closed",
    label: "薬局休止",
    scope: "person",
    words: "かかりつけ薬局が休止し、薬の配達が止まる（薬のある人）",
    eligible: (s, p, w) =>
      (medications(s).length > 0 || s.clocks.some((k) => k.kind === "medication") || contact(s, ["pharmacy"])) && !closedFacility(w, `fc-ph-${p}`),
    // 配達に頼る時計は「配達 未確認」（world-clocks.ts の施設の休止の道。ルールの表の入力の形は変えない）
    build: (t) =>
      one({ kind: "facility", id: `fc-ph-${t.person}`, label: "かかりつけ薬局", open: false, depends: "delivery" }, "かかりつけ薬局 休止", t.person),
    text: () => "かかりつけ薬局 休止",
    basis: code("jadec-insulin-2023"),
    basisFor: (s) => (coldMedicine(s) ? "jadec-insulin-2023" : null),
    touches: "person",
  },
  {
    kind: "helper_closed",
    label: "介護休止",
    scope: "person",
    words: "介護事業所が休止し、ヘルパーが来られない（介護事業所を使う人）",
    eligible: (s, p, w) => contact(s, ["care_service"]) && !marked(w, p, "helperAway"),
    build: (t) => one({ kind: "mark", mark: "helperAway" }, "介護事業所 休止", t.person),
    text: () => "介護事業所 休止",
    basis: code("mhlw-bcp-2020"),
    touches: "person",
  },
  {
    kind: "hospital_closed",
    label: "病院休止",
    scope: "person",
    words: "かかりつけの病院が休止（病院・透析施設の連絡先がある人）",
    eligible: (s, p, w) => contact(s, ["hospital", "dialysis_center"]) && !closedFacility(w, `fc-hp-${p}`),
    // 透析の人は透析先が「未確認」に戻る（施設の休止の頼り先。world-clocks.ts）
    build: (t) =>
      t.facts?.dialysis
        ? one({ kind: "facility", id: `fc-hp-${t.person}`, label: "透析の病院", open: false, depends: "dialysis_center" }, "透析の病院 休止", t.person)
        : one({ kind: "facility", id: `fc-hp-${t.person}`, label: "かかりつけ病院", open: false }, "かかりつけ病院 休止", t.person),
    text: () => "かかりつけ病院 休止",
    basis: code("jadp-dialysis-2023", "mhlw-bcp-2020"),
    basisFor: (s) => (dialysisUser(s) ? "jadp-dialysis-2023" : "mhlw-bcp-2020"),
    factsFor: (s) => ({ dialysis: dialysisUser(s) }),
    touches: "person",
  },
  {
    kind: "vendor_round",
    label: "業者巡回",
    scope: "person",
    words: "酸素業者が巡回に来る予定が入る（酸素・呼吸器の人。after に何時間後に着くか）",
    eligible: (s, p, w) => oxygenUser(s) && !(w.arrivals ?? []).some((a) => a.person === p && a.role === "vendor" && !a.arrived),
    // 着いたら settleWorld が supplies.oxygen を書く（T90 の準備の arrivals の道）
    build: (t, hour, after) => {
      const n = after ?? 4;
      return one(
        { kind: "schedule", at: atMinute(hour, n), by: "director", then: { kind: "arrival", role: "vendor" } },
        `酸素業者 巡回予定 ${n} 時間後`,
        t.person,
      );
    },
    text: (after) => `酸素業者 巡回予定 ${after ?? 4} 時間後`,
    ownText: true,
    basis: code("jrs-respiratory-2012", "nanbyo-shishin-2017"),
    basisFor: (s) => (has(s, "oxygen") || devices(s).some((d) => d.kind === "oxygen") ? "jrs-respiratory-2012" : "nanbyo-shishin-2017"),
    touches: "person",
    after: { min: 2, max: 12, default: 4 },
  },
  {
    kind: "family_stranded",
    label: "帰宅困難",
    scope: "person",
    words: "同居でない家族が帰宅困難で来られない（同居でない家族の連絡先がある人）",
    eligible: (s, p, w) => s.contacts.some((c) => c.kind === "family" && c.reach !== null && c.reach !== "together") && !marked(w, p, "familyAway"),
    build: (t) => one({ kind: "mark", mark: "familyAway" }, "家族 帰宅困難", t.person),
    text: () => "家族 帰宅困難",
    basis: NONE,
    touches: "person",
  },
  {
    kind: "car_sleep",
    label: "車中泊",
    scope: "person",
    words: "避難所に入れず車中泊になる（家の外にいる人）",
    eligible: (_s, p, w, st) => away(st) && !marked(w, p, "carSleep"),
    build: (t) => one({ kind: "mark", mark: "carSleep" }, "車中泊", t.person),
    text: () => "車中泊",
    basis: code("mhlw-ecs-2018", "jsth-pe-2020"),
    touches: "person",
  },
  {
    kind: "no_fridge",
    label: "冷蔵不可",
    scope: "person",
    words: "避難所に冷蔵庫がなく薬を冷やせない（冷やす薬のある人で避難所にいる人）",
    eligible: (s, p, w, st) => coldMedicine(s) && st?.whereNow === "shelter" && w.checks?.[p]?.refrigeration === undefined,
    // 冷蔵・保管の頼り先の確認を未確認に（world.checks）。どちらもルールの表の入力の外（TABLE_DEPENDS）なので色は変わらない
    build: (t) => one({ kind: "check", depends: ["refrigeration", "storage"], status: "unconfirmed" satisfies CheckStatus }, "避難所 冷蔵庫なし", t.person),
    text: () => "避難所 冷蔵庫なし",
    basis: code("jadec-insulin-2023"),
    touches: "person",
  },
  {
    kind: "neighbor_help",
    label: "近所声掛",
    scope: "person",
    words: "近所の人が様子を見に来てくれる（支援者の連絡先がない人）",
    eligible: (s, p, w) => !s.contacts.some((c) => c.supporter_order != null) && !marked(w, p, "neighborWatch"),
    build: (t) => one({ kind: "mark", mark: "neighborWatch" }, "近所の人が様子を見に来た", t.person),
    text: () => "近所の人が様子を見に来た",
    basis: code("cao-shishin-2021"),
    touches: "person",
  },
  {
    kind: "landslide_warn",
    label: "土砂警戒",
    scope: "person",
    words: "裏の斜面に土砂の警戒が出て、家の山側の道が通れない（土砂のハザードの人）",
    eligible: (s, p, w) => (s.ledger?.evacuation.hazards ?? []).some((h) => h.kind === "landslide") && !w.roads.some((r) => r.id === `rd-ls-${p}`),
    build: (t) => [
      { change: { kind: "note", topic: "landslide_warn" }, text: "土砂災害 警戒", ...(t.person ? { person: t.person } : {}) },
      {
        change: { kind: "road", id: `rd-ls-${t.person}`, label: "山側の道", open: false },
        text: "山側の道 土砂警戒で通行止め",
        ...(t.person ? { person: t.person } : {}),
      },
    ],
    text: () => "土砂災害 警戒",
    basis: NONE,
    touches: "person",
  },
  {
    kind: "wandering",
    label: "外出",
    scope: "person",
    words: "本人が家の外へ出て行き先が分からない（認知症の人で家にいる人）",
    eligible: (s, p, w, st) => (s.ledger?.care.dementia === true || has(s, "dementia")) && !away(st) && !marked(w, p, "wandering"),
    build: (t) => one({ kind: "mark", mark: "wandering" }, "本人が家の外へ出た", t.person),
    text: () => "本人が家の外へ出た",
    basis: code("mhlw-dementia-2018"),
    touches: "person",
  },
];

/** 福祉避難所（全体の出来事で開く物）と訪問看護ステーション（全体の休止）の id */
export const WELFARE_SHELTER_ID = "sh-welfare";
export const NURSE_STATION_ID = "fc-nurse-station";

/** 出来事の表（種類 → 行） */
export const EVENT_CATALOG: Readonly<Record<InjectKind, EventRow>> = Object.fromEntries(ROWS.map((r) => [r.kind, r])) as Record<
  InjectKind,
  EventRow
>;

// ---------- 前からの名前（lib/drill/scenarios.ts が再び出す） ----------

/** 種類ごとの固定の文（画面の 1 行。Opus の文が使えないときもこれ）。氏名・町名・施設の名前を書かない */
export const INJECT_TEXTS: Readonly<Record<InjectKind, string>> = Object.fromEntries(
  ROWS.map((r) => [r.kind, r.text(r.after?.default ?? null)]),
) as Record<InjectKind, string>;

/**
 * 差し込み 1 つの世界の変化（最初の 1 行）。道路・施設の id は本人ごと（同じ人に 2 度当てても 1 つ）。
 * 前からの 6 つと、場所の要らない種類だけ（満員は場所が要るので directorIncidents が組む）
 */
export function injectChange(kind: InjectKind, person: string, hour = 0): WorldChange {
  const row = EVENT_CATALOG[kind];
  const part = row.build({ person }, hour, row.after?.default ?? null)[0];
  if (!part) throw new Error(`場所の要る種類: ${kind}`);
  return part.change;
}

/** 何時間後（after）を表の範囲で読む。予定の種類でなければ null、書かれなければ既定、範囲の外・数でなければ undefined（捨てる） */
export function afterOf(row: EventRow, raw: unknown): number | null | undefined {
  if (!row.after) return null;
  if (raw === undefined || raw === null) return row.after.default;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.round(raw);
  return n >= row.after.min && n <= row.after.max ? n : undefined;
}

/**
 * 全体の種類のうち差し込める物と、その種類で印の付く人（参加者の並び）。
 * 参加者の誰か 1 人で当てはまれば差し込める（停電・断水など世界だけで決まる種類は、誰でも同じ）
 */
export function eligibleAreaKinds(
  entries: ReadonlyArray<{ person: string; source: EventSource; state: PersonState | null }>,
  world: WorldState,
): Map<InjectKind, string[]> {
  const out = new Map<InjectKind, string[]>();
  for (const row of ROWS) {
    if (row.scope !== "area") continue;
    if (row.place && !row.place(world)) continue;
    const persons = entries.filter((e) => row.eligible(e.source, e.person, world, e.state)).map((e) => e.person);
    if (persons.length > 0) out.set(row.kind, persons);
  }
  return out;
}

/** 状況 1 つで本人役を呼ぶ理由ができた人（T90 の touched が読む）。表の外の状況は person のある物だけ */
export function incidentTouches(e: { inject?: InjectKind; person?: string }, members: ReadonlyArray<string>): string[] {
  const t = e.inject ? EVENT_CATALOG[e.inject].touches : "person";
  if (t === "all") return [...members];
  if (t === "none") return [];
  return e.person && members.includes(e.person) ? [e.person] : [];
}

// ---------- 言葉（画面の印は 2〜4 字。Claude に渡す言い方は別） ----------

/** 種類の画面の印（状況の欄で、世界の様子を変えない変化〔note・mark・check・schedule〕の印に使う） */
export const EVENT_LABELS: Readonly<Record<InjectKind, string>> = Object.fromEntries(ROWS.map((r) => [r.kind, r.label])) as Record<
  InjectKind,
  string
>;

/** note の話題の印 */
export const NOTE_LABELS: Readonly<Record<NoteTopic, string>> = {
  water_station: "給水所",
  info_confusion: "情報混乱",
  landslide_warn: "土砂警戒",
};

/** 本人ごとの印（被害状況の「個別」。lib/drill/labels.ts の MARK_LABELS はこれを読む） */
export const markLabels = {
  supplyLeft: "持ち出し忘れ",
  nurseAway: "訪問不可",
  goingHome: "帰宅希望",
  lineDown: "電話不通",
  flooded: "浸水",
  waterOut: "断水",
  helperAway: "介護休止",
  familyAway: "帰宅困難",
  carSleep: "車中泊",
  neighborWatch: "近所声掛",
  wandering: "外出",
} as const satisfies Record<keyof PersonMarks, string>;

/** 本人ごとの印の言い方（監督の指示の文。lib/drill/director.ts の MARK_WORDS はこれを読む） */
export const markWords: Readonly<Record<keyof PersonMarks, string>> = {
  supplyLeft: "栄養剤の持ち出し忘れ",
  nurseAway: "訪問看護が来られない",
  goingHome: "家に帰ろうとしている",
  lineDown: "家の電話が不通",
  flooded: "家の辺りが浸水",
  waterOut: "家の辺りが断水",
  helperAway: "介護事業所が休止",
  familyAway: "家族が帰宅困難",
  carSleep: "車中泊",
  neighborWatch: "近所の人が様子を見に来た",
  wandering: "本人が家の外へ出た",
};

/** 向かっている人の役の印（被害状況の「到着」） */
export const ARRIVAL_ROLE_LABELS: Readonly<Record<ArrivalRole, string>> = {
  staff: "職員",
  nurse: "訪看",
  supporter: "支援者",
  family: "家族",
  vendor: "業者",
  transport: "移送",
  power: "電源",
  medicine: "薬",
};

/** 届いた物の印（被害状況の「物資」） */
export const SUPPLY_LABELS: Readonly<Record<SupplyKind, string>> = { power: "電源", oxygen: "酸素", medicine: "薬", water: "水" };

/** 被害状況の欄の名前（T92 で足した 3 行） */
export const DAMAGE_EXTRA_LABELS = { scheduled: "予定", arrivals: "到着", supplies: "物資", later: "後" } as const;

/** 世界の様子を変えない変化の印（状況の欄）。それ以外の変化は null（lib/drill/labels.ts の EVENT_KIND_LABELS） */
export function incidentLabel(e: { change: WorldChange; inject?: InjectKind }): string | null {
  const c = e.change;
  if (c.kind !== "note" && c.kind !== "mark" && c.kind !== "check" && c.kind !== "schedule") return null;
  if (e.inject && isInjectKind(e.inject)) return EVENT_LABELS[e.inject];
  if (c.kind === "note") return NOTE_LABELS[c.topic];
  if (c.kind === "mark") return markLabels[c.mark];
  return null;
}

// ---------- 本人役への言葉の口（lib/drill/persona.ts の worldWords の末尾。T93 が読む） ----------

/** 「3 時間 40 分」（lib/drill/labels.ts の clockLabel と同じ形。labels.ts を値で読まないので写した） */
function minuteWords(minute: number): string {
  const m = Math.max(0, Math.round(minute));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} 時間` : `${h} 時間 ${r} 分`;
}

const EXTRA_MARK_WORDS: Readonly<Record<ExtraMark, (h: number) => string>> = {
  helperAway: (h) => `介護事業所が休みで、ヘルパーが来られない（${h} 時間から）`,
  familyAway: (h) => `同居でない家族が帰宅困難で、こちらに来られない（${h} 時間から）`,
  carSleep: (h) => `避難所に入れず、車の中で過ごしている（${h} 時間から）`,
  neighborWatch: (h) => `近所の人が様子を見に来た（${h} 時間）`,
  wandering: (h) => `本人が家の外へ出た。どこにいるか分からない（${h} 時間から）`,
};

const ROLE_WORDS: Readonly<Record<ArrivalRole, string>> = {
  staff: "事業所の職員",
  nurse: "訪問看護",
  supporter: "支援者",
  family: "家族",
  vendor: "酸素業者",
  transport: "移送の車",
  power: "電源を届ける人",
  medicine: "薬の配達",
};

const SUPPLY_WORDS: Readonly<Record<SupplyKind, string>> = { power: "電源", oxygen: "酸素", medicine: "薬", water: "水" };

const ASK_WORDS: Readonly<Record<AskKind, string>> = {
  medicine: "薬",
  water: "水",
  food: "食べ物",
  power: "電源",
  transport: "移動の手段",
  family_contact: "家族への連絡",
  battery: "電池",
  toilet: "トイレ",
  warmth: "寒さ・暑さの対策",
};

const EXTRA_MARKS_ORDER: ReadonlyArray<ExtraMark> = ["helperAway", "familyAway", "carSleep", "neighborWatch", "wandering"];

/**
 * 本人役（Claude）に渡す、T92 の印・予定・向かっている人・届いた物・頼み事の言い方（この人に関わる物だけ）。
 * 氏名・町名・電話を書かない（相手は役の言い方、時刻は発災からの時間）。体の様子は書かない
 */
export function extraWorldWords(world: WorldState, person: string): string[] {
  const out: string[] = [];
  const m = world.marks?.[person] ?? {};
  for (const k of EXTRA_MARKS_ORDER) {
    const h = m[k];
    if (h !== undefined) out.push(EXTRA_MARK_WORDS[k](h));
  }
  for (const s of world.scheduled ?? []) {
    if (!s.person || s.person === person) out.push(`見込み: ${s.text}（${minuteWords(s.at)}ごろ）`);
  }
  for (const a of world.arrivals ?? []) {
    if (a.person !== person) continue;
    out.push(a.arrived ? `${ROLE_WORDS[a.role]}が来た（${minuteWords(a.arrive)}）` : `${ROLE_WORDS[a.role]}が ${minuteWords(a.arrive)}ごろ来る予定`);
  }
  for (const [k, at] of Object.entries(world.supplies?.[person] ?? {}) as Array<[SupplyKind, number | undefined]>) {
    if (at !== undefined) out.push(`${SUPPLY_WORDS[k]}が届いた（${minuteWords(at)}）`);
  }
  for (const a of world.asks?.[person] ?? []) {
    out.push(a.done === null ? `頼んでいる事: ${ASK_WORDS[a.kind]}（まだ）` : `頼んだ事: ${ASK_WORDS[a.kind]}（済んだ）`);
  }
  return out;
}
