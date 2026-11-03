// 訓練の想定の表（docs/tasks/T17.md）。大雨と地震の 2 本と、大雨を 4 刻みにした 10 分版。
// 出来事の骨はこの表で固定する（docs/SPEC.md「作り」: 審査員の回でも形は同じで、言葉だけ変わる）。
// 刻みは 12（0・1・3・6・9・12・18・24・36・48・60・72 時間）。刻みごとに、世界の出来事（停電・道路・電話・避難所…）と、
// 本人ごとの固定の安否（ペルソナ T18 が来るまでの仮。赤・緑・不明と 4 問の答え、言う事）を持つ。
//
// 守ること:
// - 本人は台帳の id（種の p-01〜p-10）で指す。表の文に氏名・町名・電話・施設の名前を書かない（T18・T19 で Claude に渡るため。
//   画面では id から氏名を引いて並べる）
// - 停電の地区は町名でなく「浸水 3 m 以上の人の住む地区」の形で持ち、町名は本人の台帳から実行のときに引く（lib/drill/engine.ts）
// - 色と順位はここで決めない。安否を表（lib/triage）に流すだけ
// - 画面の言葉: 筋書き → 「想定」、出来事 → 「状況」、刻み → 画面に出さない（「経過 6 時間」）。言葉は lib/drill/labels.ts

import type { DependsOn, DrillScenario, HazardKind, SignalColor, SignalSource, WhereNow } from "../db/types.ts";
import type { SourceId } from "../sources/index.ts";
import type { CastPick } from "./cast.ts";

/** 12 の刻み（発災からの時間） */
export const DRILL_HOURS = [0, 1, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72] as const;

/** 10 分版の 4 刻み（DRILL_HOURS の中から）。大雨の想定の出来事を、次の刻みに寄せる */
export const SHORT_HOURS = [0, 3, 12, 72] as const;

/** 想定の災害の種類（事業所の災害モードと同じ言葉） */
export type DrillKind = "heavy_rain" | "earthquake";

/** 断水: なし・断水中・解消（停電の 停電中・復旧 と同じ並び） */
export const WATER_STATES = ["none", "out", "restored"] as const;
export type WaterState = (typeof WATER_STATES)[number];

/** 電話: 通常・不安定・不通 */
export const PHONE_STATES = ["ok", "busy", "down"] as const;
export type PhoneState = (typeof PHONE_STATES)[number];

/** 津波: なし・避難（津波警報）・解除 */
export const TSUNAMI_STATES = ["none", "evacuate", "lifted"] as const;
export type TsunamiState = (typeof TSUNAMI_STATES)[number];

/** 避難所: 開設・混雑・満員・閉鎖（閉鎖は仮想モードの世界の部屋だけが出す。T50） */
export const SHELTER_STATES = ["open", "crowded", "full", "closed"] as const;
export type ShelterState = (typeof SHELTER_STATES)[number];

/**
 * 停電の範囲。office は事業所の全員、hazard はハザードの地区（浸水 3 m 以上の人の住む町）。
 * 町名は表に持たず、実行のときに参加者の台帳から引く（lib/drill/engine.ts の outageTownsOf）
 */
export type OutageArea =
  | { scope: "office" }
  | { scope: "hazard"; hazard: HazardKind; minDepthM: number }
  // 仮想モード（T50）: 町名の一覧（世界の部屋が町を選ぶ。lib/drill/area.ts の町）
  // since は町ごとの停電の始まり（発災からの時間。無い町は停電の since）
  | { scope: "towns"; towns: string[]; since?: Record<string, number> };

/** 道路・避難所・施設。label は場所の名前を書かない一般の言い方（川沿いの市道・指定避難所） */
export type Road = { id: string; label: string; open: boolean; person: string | null };
export type Shelter = { id: string; label: string; state: ShelterState; person: string | null };
/** depends は台帳の時計の頼り先（透析先など）。休止すると、その人のその頼り先の時計を「未確認」に戻す（lib/drill/director.ts の drillClocks） */
export type Facility = { id: string; label: string; open: boolean; person: string | null; depends: DependsOn | null };

/**
 * 本人ごとの印（監督の差し込みで付く）。値は付いた時刻（発災からの時間）。
 * supplyLeft 栄養剤の持ち出し忘れ・nurseAway 訪問看護が来られない・goingHome 本人が家に帰ろうとする・lineDown 家の電話が不通。
 * flooded 家の辺りが浸水・waterOut 家の辺りが断水（仮想モードの町の出来事、T50。lib/drill/world-apply.ts が町の人に付ける）
 */
export type PersonMarks = {
  supplyLeft?: number;
  nurseAway?: number;
  goingHome?: number;
  lineDown?: number;
  flooded?: number;
  waterOut?: number;
};

/**
 * 結末（仮想モード、T50・T53）。世界（部屋・1 回呼び）が決めた架空の人の結末（lib/drill/world-apply.ts の farewellIncidents）。
 * at は決まった刻みの時刻（発災からの時間）、label は時計の計算で切れていた時計の名前（無ければ空）、reason は世界の事実（AI。無ければ null）。
 * 以後その人の本人役は呼ばない
 */
export type Ended = { at: number; label: string; reason?: string | null };

/** 世界の状態（被害状況）。監督（T19）が持つ。固定の部分はこの表の出来事を順に当てて作る */
export type WorldState = {
  /** 警戒レベル（大雨）。解除・無しは null */
  alertLevel: 3 | 4 | 5 | null;
  /** 震度（地震）。「6強」 */
  quake: string | null;
  tsunami: TsunamiState;
  /** 浸水（大雨の川の氾濫） */
  flood: boolean;
  /** 停電。始まり・復旧は発災からの時間 */
  outage: { area: OutageArea; since: number; restoredAt: number | null } | null;
  phone: PhoneState;
  /** 断水 */
  water: WaterState;
  roads: Road[];
  shelters: Shelter[];
  facilities: Facility[];
  /** 職員の空き（出向ける職員の人数）。始めは想定の表の staff。減らすのはケアマネの手（T20） */
  staff: number;
  /** 本人ごとの印（台帳の id → 印） */
  marks: Record<string, PersonMarks>;
  /**
   * 出向いてもらった人（ケアマネの手「訪問依頼」、T20）。着く時刻（arrive）を過ぎたら本人の印を消し、
   * 事業所の職員なら戻る時刻（back）を過ぎたら職員の空きを 1 戻す。時刻は発災からの分
   */
  dispatched: Dispatched[];
  /** 仮想モード（T50）: 浸水の深さ（台帳の id → m。分からなければ null）。本人役の状況に使う */
  floods?: Record<string, number | null>;
  /** 仮想モード: 天候（大雨・止む） */
  weather?: Weather | null;
  /** 仮想モード: 結末の人（台帳の id → 結末）。固定の筋には無い */
  ended?: Record<string, Ended>;
  /** 仮想モード: 世界の 1 文の履歴（部屋の文。地区は別名、人は仮名のまま。STORY_MAX まで） */
  story?: string[];
  /** 仮想モード: 世界の部屋（Managed Agents）の session の ID。drills.world_session_id にも写す */
  session?: string | null;
};

/** 世界の履歴に残す文の数 */
export const STORY_MAX = 24;

export const WEATHERS = ["rain", "clear"] as const;
export type Weather = (typeof WEATHERS)[number];

/** 出向いてもらった 1 件。back は事業所の職員のときだけ（訪問看護は事業所の職員でない） */
export type Dispatched = { person: string; arrive: number; back: number | null; arrived: boolean };

export const EMPTY_WORLD: WorldState = {
  alertLevel: null,
  quake: null,
  tsunami: "none",
  flood: false,
  outage: null,
  phone: "ok",
  water: "none",
  roads: [],
  shelters: [],
  facilities: [],
  staff: 0,
  marks: {},
  dispatched: [],
};

/** 世界の変化 1 つ。出来事（状況）の種類はこの kind */
export type WorldChange =
  | { kind: "alert"; level: 3 | 4 | 5 | null }
  | { kind: "quake"; intensity: string }
  | { kind: "tsunami"; state: TsunamiState }
  | { kind: "flood" }
  | { kind: "outage"; area: OutageArea }
  | { kind: "outage_restored" }
  | { kind: "phone"; state: PhoneState }
  | { kind: "water"; out: boolean }
  | { kind: "road"; id: string; label: string; open: boolean }
  | { kind: "shelter"; id: string; label: string; state: ShelterState }
  | { kind: "facility"; id: string; label: string; open: boolean; depends?: DependsOn }
  // 仮想モード（T50）の町の出来事。persons はその町に住む本人（コードが町名から引く。部屋は知らない）
  | { kind: "town_flood"; town: string; depthM: number | null; persons: string[] }
  | { kind: "landslide"; town: string; persons: string[] }
  | { kind: "town_road"; road: string; label: string; open: boolean; persons: string[] }
  | { kind: "town_water"; towns: string[]; out: boolean; persons: string[] }
  | { kind: "town_line"; towns: string[]; persons: string[] }
  | { kind: "town_facility"; facility: string; label: string; open: boolean; depends: DependsOn | null; persons: string[] }
  | { kind: "weather"; state: Weather }
  // 世界の部屋の 1 文（room は部屋が書いたままの別名の文。本人役に渡す。text は町名に戻した画面の文）。via は部屋か 1 回呼びか
  | { kind: "narration"; room: string; via: WorldVia }
  // 部屋も 1 回呼びも使えなかった刻み（差し込みなしで進んだ印。記録に残す）
  | { kind: "world_note"; state: "down" | "off" }
  // 結末（person が要る。世界が決める、lib/drill/world-apply.ts。T50 の記録には reason が無い）
  | { kind: "outcome"; label: string; reason?: string | null }
  // 本人ごとの印（監督の差し込み。person が要る）
  | { kind: "supply_left" }
  | { kind: "nurse_away" }
  | { kind: "going_home" }
  | { kind: "line_down" };

export type WorldEventKind = WorldChange["kind"];

/** 世界の 1 刻みを作った所。room は Managed Agents の部屋、oneshot は Messages API の 1 回呼び（部屋が使えないときの代替） */
export type WorldVia = "room" | "oneshot";

// ---------- 監督の差し込みの種類（T19） ----------

/**
 * 監督（Opus）が差し込める状況の種類。この 6 つだけ（表の外は捨てる。自由な出来事は採点が揺れる）。
 * どれも本人 1 人を指し、世界の変化はコード（injectChange）が組む。Opus が選ぶのは種類・相手・文・理由・根拠だけ
 */
export const INJECT_KINDS = [
  "supply_left", // 栄養剤の持ち出し忘れ
  "dialysis_flooded", // 透析施設の浸水
  "road_blocked", // 道路が通れない
  "line_down", // 電話が不通
  "nurse_away", // 訪問看護が来られない
  "going_home", // 本人が家に帰ろうとする
] as const;
export type InjectKind = (typeof INJECT_KINDS)[number];

export function isInjectKind(v: unknown): v is InjectKind {
  return typeof v === "string" && (INJECT_KINDS as readonly string[]).includes(v);
}

/** 種類ごとの固定の文（画面の 1 行。Opus の文が使えないときもこれ）。氏名・町名・施設の名前を書かない */
export const INJECT_TEXTS: Readonly<Record<InjectKind, string>> = {
  supply_left: "家族が栄養剤を持ち出し忘れた",
  dialysis_flooded: "透析施設 浸水で休止",
  road_blocked: "家の前の道 通行止め",
  line_down: "家の電話 不通",
  nurse_away: "訪問看護 来られない",
  going_home: "本人が家に帰ろうとする",
};

/** 差し込み 1 つの世界の変化。道路・施設の id は本人ごと（同じ人に 2 度当てても 1 つ） */
export function injectChange(kind: InjectKind, person: string): WorldChange {
  switch (kind) {
    case "supply_left":
      return { kind: "supply_left" };
    case "dialysis_flooded":
      return { kind: "facility", id: `fc-${person}`, label: "透析施設", open: false, depends: "dialysis_center" };
    case "road_blocked":
      return { kind: "road", id: `rd-${person}`, label: "家の前の道", open: false };
    case "line_down":
      return { kind: "line_down" };
    case "nurse_away":
      return { kind: "nurse_away" };
    case "going_home":
      return { kind: "going_home" };
  }
}

/** 世界の出来事（状況）1 つ。text は画面の 1 行（氏名・町名・施設の名前を書かない） */
export type WorldEvent = {
  change: WorldChange;
  text: string;
  /** 関わる本人（台帳の id）。道路・施設がその人の所の物など */
  person?: string;
  /**
   * person が事業所にいないときに代わりに当てる人の選び方（T70、lib/drill/cast.ts）。デモ事業所の 10 人の行は person のまま、
   * 新しい事業所では台帳の中身で選んだ参加者に当たる。状況の保存には入れない（engine が外す）
   */
  who?: CastPick;
  /** 起きた時刻（発災からの時間）。無ければ刻みの時刻。10 分版で寄せた出来事は元の時刻を持つ */
  at?: number;
  /** 監督の固定の差し込み（想定の表に書いた状況付与）。無ければ世界の出来事 */
  by?: "director";
  /** 差し込みの種類（監督の物だけ） */
  inject?: InjectKind;
  /** 監督の判断の理由（採点 T22 が読む。画面に出さない） */
  reason?: string;
  /** 根拠の出典（登録簿の id。画面に出す） */
  basis?: SourceId;
};

/** 想定の表の固定の差し込み 1 つ（監督の表。Claude を呼ばない） */
function fixedInject(kind: InjectKind, person: string, reason: string, basis: SourceId | undefined, who: CastPick): WorldEvent {
  return {
    change: injectChange(kind, person),
    text: INJECT_TEXTS[kind],
    person,
    who,
    by: "director",
    inject: kind,
    reason,
    ...(basis ? { basis } : {}),
  };
}

/**
 * 本人ごとの固定の 1 刻み（ペルソナ T18 が来るまでの仮）。安否 1 つと、する事・言う事。
 * source: agent は本人役（ルールの表では本人と同じ）、family・supporter は家族・支援者の役
 */
export type FixedTurn = {
  person: string;
  color: SignalColor;
  source: Extract<SignalSource, "agent" | "family" | "supporter">;
  /** 緑の 1 問（どこにいますか） */
  whereNow?: WhereNow;
  /** 赤の 4 問（けが・家・動けるか・薬）。書かない問いは答えていない */
  injured?: boolean;
  atHome?: boolean;
  canMove?: boolean;
  hasMedicine?: boolean;
  /** 言う事（文字起こしの欄に入る）。氏名・住所・電話を入れない */
  saying?: string;
  /** する事 */
  doing?: string;
  at?: number;
  /** person が事業所にいないときの代わりの人の選び方（T70、WorldEvent の who と同じ） */
  who?: CastPick;
};

export type ScenarioTick = { hour: number; events: WorldEvent[]; turns: FixedTurn[] };

export type Scenario = {
  id: DrillScenario;
  kind: DrillKind;
  /** 刻みの時刻。ticks と同じ順 */
  hours: readonly number[];
  /** 職員の空き（始め）。地震は職員も被災するので少ない */
  staff: number;
  ticks: ScenarioTick[];
};

// ---------- 大雨 ----------
// 警戒レベル 3 → 4 → 浸水 3 m の地区。1 山田・2 小林が主役、3 田中の透析先、5 伊藤の道路。
// 色の動き（ルールの表で）: 山田は 3 時間で赤（けが）。小林は 1 時間に夫の電話（緑）、人工呼吸器の電池の半分を過ぎて 3 時間に黄、
// 緑の報告のあとに電池が切れて 6 時間に赤。
// 田中は家族の緑でも透析先 未確認で黄、48 時間に家族の赤。佐藤（スマホを持たない）は不明のまま → 6 時間に民生委員が見に行って緑。
// 監督の固定の差し込み（T19）: 6 時間に 6 高橋の家族が栄養剤を持ち出し忘れる（避難所で栄養剤の配達 未確認 → 黄）、
// 12 時間に 3 田中の透析施設が浸水で休止（透析先 未確認のまま）。

const FLOOD_AREA: OutageArea = { scope: "hazard", hazard: "flood", minDepthM: 3 };

/**
 * 10 人の行の「どんな人の行か」（T70。新しい事業所で代わりの人を選ぶ。lib/drill/cast.ts）。行の言う事が言い切る物で選ぶ:
 * 1 山田 大雨は独居・けが、地震は酸素。2 小林 人工呼吸器。3 田中 透析。4 佐藤 本人も周りもスマホで押せない。5 伊藤 浸水の想定（川沿いの道）。
 * 6 高橋 経管栄養。7 加藤 大雨は土砂の想定（山すその道）、地震は誰でも。8 井上 インスリン。9 渡辺・10 中村 誰でも。
 * 同じ人の行は想定の中で同じ who（cast.ts が 1 人にまとめて配る）
 */
const WHO = {
  alone: { household: "alone" },
  oxygen: { device: "oxygen" },
  ventilator: { device: "ventilator" },
  dialysis: { clock: "dialysis" },
  noPress: { smartphone: "none" },
  flood: { hazard: "flood" },
  tubeFeeding: { device: "tube_feeding" },
  landslide: { hazard: "landslide" },
  insulin: { clock: "insulin" },
  any: { any: true },
} as const satisfies Record<string, CastPick>;

const HEAVY_RAIN: Scenario = {
  id: "heavy_rain",
  kind: "heavy_rain",
  hours: DRILL_HOURS,
  staff: 3,
  ticks: [
    {
      hour: 0,
      events: [
        { change: { kind: "alert", level: 3 }, text: "警戒レベル 3 高齢者等避難" },
        { change: { kind: "shelter", id: "sh-1", label: "指定避難所", state: "open" }, text: "指定避難所 開設" },
      ],
      turns: [
        { person: "p-03", who: WHO.dialysis, color: "green", source: "family", whereNow: "home", saying: "2 階にいます" },
        { person: "p-06", who: WHO.tubeFeeding, color: "green", source: "family", whereNow: "home", saying: "家にいます。様子を見ます" },
        { person: "p-10", who: WHO.any, color: "green", source: "family", whereNow: "home" },
      ],
    },
    {
      hour: 1,
      events: [
        { change: { kind: "alert", level: 4 }, text: "警戒レベル 4 避難指示" },
        { change: { kind: "outage", area: FLOOD_AREA }, text: "浸水 3 m の地区で停電" },
      ],
      turns: [
        // 小林の夫の電話（動画で必ず出すため表で固定。11/3 07:0x の確定 3）。停電と同時に呼吸器が内蔵電池（3 時間）に替わる
        {
          person: "p-02", who: WHO.ventilator,
          color: "green",
          source: "family",
          whereNow: "home",
          saying: "停電した。呼吸器が電池に切り替わった。3 時間しかもたない",
        },
        { person: "p-07", who: WHO.landslide, color: "green", source: "agent", whereNow: "home", saying: "家にいる。まだ大丈夫" },
        { person: "p-08", who: WHO.insulin, color: "green", source: "agent", whereNow: "home" },
      ],
    },
    {
      hour: 3,
      events: [
        { change: { kind: "flood" }, text: "川が氾濫 浸水 3 m の地区で浸水" },
        { change: { kind: "phone", state: "busy" }, text: "電話 不安定" },
        {
          change: { kind: "road", id: "rd-1", label: "川沿いの市道", open: false },
          text: "川沿いの市道 冠水で通行止め",
          person: "p-05", who: WHO.flood,
        },
      ],
      turns: [
        { person: "p-01", who: WHO.alone, color: "red", source: "agent", injured: true, saying: "いたい、うごけない", doing: "4 問の途中で止まった" },
        { person: "p-06", who: WHO.tubeFeeding, color: "green", source: "family", whereNow: "shelter", saying: "避難所に着きました" },
      ],
    },
    {
      hour: 6,
      events: [
        { change: { kind: "shelter", id: "sh-1", label: "指定避難所", state: "crowded" }, text: "指定避難所 混雑" },
        fixedInject("supply_left", "p-06", "経管栄養で、避難の持ち物に栄養剤。家族と避難所に移ったあと", "nanbyo-shishin-2017", WHO.tubeFeeding),
      ],
      turns: [
        { person: "p-04", who: WHO.noPress, color: "green", source: "supporter", whereNow: "home", saying: "見に行きました。家にいます" },
      ],
    },
    {
      hour: 9,
      events: [
        {
          change: { kind: "road", id: "rd-2", label: "山すその道", open: false },
          text: "山すその道 土砂で通行止め",
          person: "p-07", who: WHO.landslide,
        },
      ],
      turns: [
        { person: "p-07", who: WHO.landslide, color: "green", source: "agent", whereNow: "home", saying: "避難所には行かん", doing: "避難を渋る" },
      ],
    },
    {
      hour: 12,
      events: [fixedInject("dialysis_flooded", "p-03", "透析の人で、透析先 未確認。次の受け入れ先を探す筋", "jadp-dialysis-2023", WHO.dialysis)],
      turns: [],
    },
    {
      hour: 18,
      events: [{ change: { kind: "water", out: true }, text: "断水" }],
      turns: [
        { person: "p-03", who: WHO.dialysis, color: "green", source: "family", whereNow: "home", saying: "透析の病院に電話がつながらない" },
      ],
    },
    {
      hour: 24,
      events: [
        { change: { kind: "alert", level: 3 }, text: "警戒レベル 3 に引き下げ" },
        { change: { kind: "phone", state: "ok" }, text: "電話 回復" },
      ],
      turns: [{ person: "p-08", who: WHO.insulin, color: "green", source: "agent", whereNow: "home" }],
    },
    {
      hour: 36,
      events: [
        {
          change: { kind: "road", id: "rd-1", label: "川沿いの市道", open: true },
          text: "川沿いの市道 通行再開",
          person: "p-05", who: WHO.flood,
        },
      ],
      turns: [{ person: "p-06", who: WHO.tubeFeeding, color: "green", source: "family", whereNow: "shelter" }],
    },
    {
      hour: 48,
      events: [{ change: { kind: "outage_restored" }, text: "停電 復旧" }],
      turns: [{ person: "p-03", who: WHO.dialysis, color: "red", source: "family", saying: "透析に行けていない。次が決まらない" }],
    },
    {
      hour: 60,
      events: [{ change: { kind: "water", out: false }, text: "断水 解消" }],
      turns: [{ person: "p-10", who: WHO.any, color: "green", source: "family", whereNow: "home" }],
    },
    {
      hour: 72,
      events: [{ change: { kind: "alert", level: null }, text: "警戒レベル 解除" }],
      turns: [],
    },
  ],
};

// ---------- 地震 ----------
// 南海トラフ、震度 6 強、沿岸の津波、停電 2 日。8 井上が主役、1 山田・2 小林の電池。
// 色の動き: 山田は連絡なしのまま酸素の内蔵電池で 3 時間に赤。小林は 3 時間に黄、6 時間に夫の緑（電池が切れたあと）で黄のまま。
// 井上は高台の集会所で緑、インスリンの残り（手元の日数。発災から走る。冷蔵の時計は無く、保管は確認の欄）で 60 時間に黄。

const EARTHQUAKE: Scenario = {
  id: "earthquake",
  kind: "earthquake",
  hours: DRILL_HOURS,
  staff: 2,
  ticks: [
    {
      hour: 0,
      events: [
        { change: { kind: "quake", intensity: "6強" }, text: "南海トラフ 震度 6強" },
        { change: { kind: "tsunami", state: "evacuate" }, text: "津波警報、沿岸に避難指示" },
        { change: { kind: "outage", area: { scope: "office" } }, text: "停電 全域" },
        { change: { kind: "phone", state: "down" }, text: "電話 不通" },
      ],
      turns: [{ person: "p-07", who: WHO.any, color: "green", source: "agent", whereNow: "home", saying: "家は大丈夫" }],
    },
    {
      hour: 1,
      events: [
        {
          change: { kind: "shelter", id: "sh-2", label: "高台の集会所", state: "open" },
          text: "高台の集会所 受入開始",
          person: "p-08", who: WHO.insulin,
        },
      ],
      turns: [
        { person: "p-08", who: WHO.insulin, color: "green", source: "agent", whereNow: "shelter", saying: "高台の集会所に来た" },
        { person: "p-03", who: WHO.dialysis, color: "green", source: "family", whereNow: "home" },
        { person: "p-06", who: WHO.tubeFeeding, color: "green", source: "family", whereNow: "home" },
        { person: "p-09", who: WHO.any, color: "green", source: "agent", whereNow: "home", saying: "大丈夫" },
        { person: "p-10", who: WHO.any, color: "green", source: "family", whereNow: "home" },
      ],
    },
    {
      hour: 3,
      events: [
        {
          change: { kind: "road", id: "rd-3", label: "沿岸の道", open: false },
          text: "沿岸の道 津波で通行止め",
          person: "p-08", who: WHO.insulin,
        },
      ],
      turns: [],
    },
    {
      hour: 6,
      events: [{ change: { kind: "tsunami", state: "lifted" }, text: "津波警報 解除" }],
      turns: [
        {
          person: "p-02", who: WHO.ventilator,
          color: "green",
          source: "family",
          whereNow: "home",
          saying: "呼吸器は予備のバッテリーに替えた。残りが心配",
        },
      ],
    },
    {
      hour: 9,
      events: [
        {
          change: { kind: "shelter", id: "sh-2", label: "高台の集会所", state: "crowded" },
          text: "高台の集会所 混雑 冷蔵庫なし",
          person: "p-08", who: WHO.insulin,
        },
      ],
      turns: [{ person: "p-04", who: WHO.noPress, color: "green", source: "supporter", whereNow: "home", saying: "見に行きました。家にいます" }],
    },
    {
      hour: 12,
      events: [{ change: { kind: "phone", state: "busy" }, text: "電話 一部回復 不安定" }],
      turns: [{ person: "p-01", who: WHO.oxygen, color: "red", source: "family", saying: "母の家に来た。酸素ボンベが残り少ない" }],
    },
    {
      hour: 18,
      events: [{ change: { kind: "water", out: true }, text: "断水" }],
      turns: [],
    },
    {
      hour: 24,
      events: [],
      turns: [
        { person: "p-08", who: WHO.insulin, color: "green", source: "agent", whereNow: "shelter", saying: "インスリンは持ってきたけど、冷やせない" },
      ],
    },
    {
      hour: 36,
      events: [
        {
          change: { kind: "facility", id: "fc-1", label: "透析施設", open: false, depends: "dialysis_center" },
          text: "透析施設 断水で休止",
          person: "p-03", who: WHO.dialysis,
        },
      ],
      turns: [],
    },
    {
      hour: 48,
      events: [{ change: { kind: "outage_restored" }, text: "停電 復旧" }],
      turns: [{ person: "p-08", who: WHO.insulin, color: "green", source: "agent", whereNow: "shelter" }],
    },
    {
      hour: 60,
      events: [],
      turns: [],
    },
    {
      hour: 72,
      events: [
        { change: { kind: "water", out: false }, text: "断水 解消" },
        { change: { kind: "phone", state: "ok" }, text: "電話 回復" },
      ],
      turns: [],
    },
  ],
};

/**
 * 想定を少ない刻みに寄せる（10 分版）。残す刻みの間の出来事と安否は、次に残す刻みに寄せ、元の時刻（at）を持たせる。
 * 寄せた出来事は元の順のまま（世界の状態は同じ順に当てる）
 */
export function condense(base: Scenario, id: DrillScenario, hours: readonly number[]): Scenario {
  const ticks: ScenarioTick[] = hours.map((hour) => ({ hour, events: [], turns: [] }));
  for (const t of base.ticks) {
    const i = hours.findIndex((h) => h >= t.hour);
    if (i < 0) continue;
    ticks[i].events.push(...t.events.map((e) => ({ ...e, at: e.at ?? t.hour })));
    ticks[i].turns.push(...t.turns.map((x) => ({ ...x, at: x.at ?? t.hour })));
  }
  return { id, kind: base.kind, hours, staff: base.staff, ticks };
}

const SHORT = condense(HEAVY_RAIN, "short", SHORT_HOURS);

// ---------- 仮想（T50） ----------
// 表の出来事も本人の行も持たない（12 の刻みだけ）。街の出来事は世界の部屋（lib/drill/world-room.ts、落ちたら world-oneshot.ts）が
// 刻みごとに決め、本人役は毎刻み自分で動く。kind は被害状況の欄・地図の場面の種にだけ使う（大雨の形。余震は本人役への状況）

const VIRTUAL: Scenario = {
  id: "virtual",
  kind: "heavy_rain",
  hours: DRILL_HOURS,
  staff: 3,
  ticks: DRILL_HOURS.map((hour) => ({ hour, events: [], turns: [] })),
};

export const SCENARIOS: Readonly<Record<DrillScenario, Scenario>> = {
  heavy_rain: HEAVY_RAIN,
  earthquake: EARTHQUAKE,
  short: SHORT,
  virtual: VIRTUAL,
};

/** 想定の並び（開始のボタンの順。10 分版は画面が先頭に出す） */
export const SCENARIO_ORDER: ReadonlyArray<DrillScenario> = ["heavy_rain", "earthquake", "short", "virtual"];

/** 仮想モード（世界の部屋が街を進める）か */
export function isVirtual(id: DrillScenario): boolean {
  return id === "virtual";
}

/** 被害状況の欄・地図の場面の種類。仮想は地震（震度）が起きていれば地震、ほかは大雨の形 */
export function drillKindOf(id: DrillScenario, world: Pick<WorldState, "quake">): DrillKind {
  if (isVirtual(id)) return world.quake ? "earthquake" : "heavy_rain";
  return scenarioOf(id).kind;
}

export function scenarioOf(id: DrillScenario): Scenario {
  return SCENARIOS[id];
}

/** 想定の最後の時刻（72） */
export function lastHour(s: Scenario): number {
  return s.hours[s.hours.length - 1];
}

/** 出来事の時刻（無ければ刻みの時刻） */
export function eventHour(e: { at?: number }, tickHour: number): number {
  return e.at ?? tickHour;
}

// ---------- 世界の状態を当てる ----------

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
}

/** 本人の印を付ける（最初に付いた時刻を残す）。本人の無い出来事は世界を変えない */
function mark(world: WorldState, person: string | null, key: keyof PersonMarks, hour: number): WorldState {
  if (!person) return world;
  const own = world.marks[person] ?? {};
  if (own[key] !== undefined) return world;
  return { ...world, marks: { ...world.marks, [person]: { ...own, [key]: hour } } };
}

/** 出来事 1 つを世界に当てる（新しい世界を返す。元は変えない） */
export function applyEvent(world: WorldState, e: WorldEvent, hour: number): WorldState {
  const c = e.change;
  const person = e.person ?? null;
  switch (c.kind) {
    case "alert":
      return { ...world, alertLevel: c.level };
    case "quake":
      return { ...world, quake: c.intensity };
    case "tsunami":
      return { ...world, tsunami: c.state };
    case "flood":
      return { ...world, flood: true };
    case "outage": {
      // 町の停電が広がる（仮想）: 続いている町の停電に町を足す。停電の始まり（since）は最初の時刻のまま（ルールの表の停電の始まりは 1 つ）、
      // 町ごとの始まりは area.since に持ち、時計の走り方（score.ts の clockRuns、結末 outcome.ts）は町の始まりから数える
      const o = world.outage;
      if (o && o.restoredAt === null && o.area.scope === "towns" && c.area.scope === "towns") {
        const towns = [...new Set([...o.area.towns, ...c.area.towns])];
        const since = { ...(c.area.since ?? {}), ...(o.area.since ?? {}) };
        return { ...world, outage: { ...o, area: { scope: "towns", towns, since } } };
      }
      return { ...world, outage: { area: c.area, since: hour, restoredAt: null } };
    }
    case "outage_restored":
      return world.outage ? { ...world, outage: { ...world.outage, restoredAt: hour } } : world;
    case "phone":
      return { ...world, phone: c.state };
    case "water":
      return { ...world, water: c.out ? "out" : world.water === "out" ? "restored" : world.water };
    case "road":
      return { ...world, roads: upsert(world.roads, { id: c.id, label: c.label, open: c.open, person }) };
    case "shelter":
      return { ...world, shelters: upsert(world.shelters, { id: c.id, label: c.label, state: c.state, person }) };
    case "facility":
      return {
        ...world,
        facilities: upsert(world.facilities, { id: c.id, label: c.label, open: c.open, person, depends: c.depends ?? null }),
      };
    case "supply_left":
      return mark(world, person, "supplyLeft", hour);
    case "nurse_away":
      return mark(world, person, "nurseAway", hour);
    case "going_home":
      return mark(world, person, "goingHome", hour);
    case "line_down":
      return mark(world, person, "lineDown", hour);
    // ---------- 仮想（T50）の町の出来事。町の人ごとに印・道・施設を当てる ----------
    case "town_flood": {
      let w = c.persons.reduce((x, p) => mark(x, p, "flooded", hour), world);
      const floods = { ...(w.floods ?? {}) };
      for (const p of c.persons) floods[p] = c.depthM ?? floods[p] ?? null;
      w = { ...w, floods };
      return w;
    }
    case "landslide":
      return c.persons.reduce(
        (w, p) => ({ ...w, roads: upsert(w.roads, { id: `rd-ls-${c.town}-${p}`, label: "土砂の道", open: false, person: p }) }),
        world,
      );
    case "town_road":
      return c.persons.reduce(
        (w, p) => ({ ...w, roads: upsert(w.roads, { id: `rd-${c.road}-${p}`, label: c.label, open: c.open, person: p }) }),
        world,
      );
    case "town_water":
      return c.out ? c.persons.reduce((w, p) => mark(w, p, "waterOut", hour), world) : clearAll(world, c.persons, "waterOut");
    case "town_line":
      return c.persons.reduce((w, p) => mark(w, p, "lineDown", hour), world);
    case "town_facility":
      return c.persons.reduce(
        (w, p) => ({
          ...w,
          facilities: upsert(w.facilities, { id: `fc-${c.facility}-${p}`, label: c.label, open: c.open, person: p, depends: c.depends }),
        }),
        world,
      );
    case "weather":
      return { ...world, weather: c.state };
    case "narration":
      // 部屋の文（別名のまま）を世界の履歴に残す。1 回呼び（world-oneshot.ts）が履歴の要約として送る
      return { ...world, story: [...(world.story ?? []), `${hour} 時間: ${c.room}`].slice(-STORY_MAX) };
    case "world_note":
      return world;
    case "outcome": {
      if (!person || world.ended?.[person]) return world;
      return { ...world, ended: { ...(world.ended ?? {}), [person]: { at: hour, label: c.label, reason: c.reason ?? null } } };
    }
  }
}

/** 人ごとの印を 1 つ消す（断水の解消など） */
function clearAll(world: WorldState, persons: ReadonlyArray<string>, key: keyof PersonMarks): WorldState {
  return persons.reduce((w, p) => clearMarks(w, p, [key]).world, world);
}

// ---------- ケアマネの手が世界を変える所（T20） ----------

/**
 * 人が着いたら消す本人の印。ケアマネが出向いた・出向いてもらった人が着いた・福祉避難所が受けた、のどれか（lib/drill/actions.ts）。
 * 栄養剤の持ち出し忘れ（届けた）と家に帰ろうとする（話して留めた・移った）だけ。家の電話の不通・訪問看護が来られないは人が着いても消えない
 */
export const CLEARED_ON_ARRIVAL: ReadonlyArray<keyof PersonMarks> = ["supplyLeft", "goingHome"];

/** 本人の印を消す。消した鍵を返す（無かった物は返さない） */
export function clearMarks(
  world: WorldState,
  person: string,
  keys: ReadonlyArray<keyof PersonMarks>,
): { world: WorldState; cleared: Array<keyof PersonMarks> } {
  const own = world.marks[person];
  if (!own) return { world, cleared: [] };
  const cleared = keys.filter((k) => own[k] !== undefined);
  if (cleared.length === 0) return { world, cleared };
  const rest: PersonMarks = { ...own };
  for (const k of cleared) delete rest[k];
  const marks = { ...world.marks };
  if (Object.keys(rest).length === 0) delete marks[person];
  else marks[person] = rest;
  return { world: { ...world, marks }, cleared };
}

/**
 * 世界を時刻（発災からの分）まで進める。出向いてもらった人が着いたら印を消し、事業所の職員が戻ったら職員の空きを 1 戻す。
 * 同じ時刻で何度呼んでも同じ（刻みでも手でも呼ぶ）
 */
export function settleWorld(world: WorldState, minute: number): WorldState {
  const list = world.dispatched ?? [];
  if (!list.some((d) => (!d.arrived && d.arrive <= minute) || (d.back !== null && d.back <= minute))) return world;
  let w: WorldState = world;
  const rest: Dispatched[] = [];
  for (const d of list) {
    let x = d;
    if (!x.arrived && x.arrive <= minute) {
      w = clearMarks(w, x.person, CLEARED_ON_ARRIVAL).world;
      x = { ...x, arrived: true };
    }
    if (x.back !== null && x.back <= minute) {
      w = { ...w, staff: w.staff + 1 };
      x = { ...x, back: null };
    }
    if (!x.arrived || x.back !== null) rest.push(x);
  }
  return { ...w, dispatched: rest };
}

/** 本人の家の電話の様子（家の電話が不通の印があれば不通。無ければ世界の電話） */
export function phoneOf(world: WorldState, person: string | null): PhoneState {
  if (person && world.marks[person]?.lineDown !== undefined) return "down";
  return world.phone;
}

/** 出来事を順に当てる */
export function applyEvents(world: WorldState, events: ReadonlyArray<WorldEvent>, tickHour: number): WorldState {
  return events.reduce((w, e) => applyEvent(w, e, eventHour(e, tickHour)), world);
}
