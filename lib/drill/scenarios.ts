// 訓練の想定の表（docs/tasks/T17.md）。大雨と地震の 2 本と、大雨を 4 刻みにした 10 分版。
// 10 分版は T124 で開始の画面と開始の API から外した。表は前からある 10 分版の記録（一覧・紙・講評・再生・再開）を読むためだけに残す。
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

import type { CheckStatus, DependsOn, DrillScenario, HazardKind, SignalColor, SignalSource, WhereNow } from "../db/types.ts";
import { INJECT_TEXTS, injectChange, ROAD_BOUND_ROLES, type InjectKind } from "./event-catalog.ts";
import { hourText } from "./time-text.ts";
import type { SourceId } from "../sources/index.ts";
import type { CastPick } from "./cast.ts";
import type { RadioState } from "./comms.ts";

/** 12 の刻み（発災からの時間） */
export const DRILL_HOURS = [0, 1, 3, 6, 9, 12, 18, 24, 36, 48, 60, 72] as const;

/** 10 分版の 4 刻み（DRILL_HOURS の中から）。大雨の想定の出来事を、次の刻みに寄せる。前からある記録を読むためだけ（T124） */
export const SHORT_HOURS = [0, 3, 12, 72] as const;

/** 想定の災害の種類（事業所の災害モードと同じ言葉） */
export type DrillKind = "heavy_rain" | "earthquake";

/** 断水: なし・断水中・解消（停電の 停電中・復旧 と同じ並び） */
export const WATER_STATES = ["none", "out", "restored"] as const;
export type WaterState = (typeof WATER_STATES)[number];

/** 電話: 通常・不安定・通話不可（T105 で「不通」から） */
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
  // places は画面の言葉（ピンで区画に入れる地理の区画の言葉。T170）。towns は台帳の町名の突き合わせ。無ければ towns を画面に出す
  | { scope: "towns"; towns: string[]; since?: Record<string, number>; places?: string[] };

/** 道路・避難所・施設。label は場所の名前を書かない一般の言い方（川沿いの市道・指定避難所） */
export type Road = { id: string; label: string; open: boolean; person: string | null };
export type Shelter = { id: string; label: string; state: ShelterState; person: string | null };
/** depends は台帳の時計の頼り先（透析先など）。休止すると、その人のその頼り先の時計を「未確認」に戻す（lib/drill/world-clocks.ts の drillClocks） */
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
  // T92: 出来事の表（lib/drill/event-catalog.ts）の印。付けるのは WorldChange の mark だけ
  /** 介護事業所の休止（訪問の手配の相手を介護事業所にすると来られない） */
  helperAway?: number;
  /** 同居でない家族が帰宅困難で来られない */
  familyAway?: number;
  /** 車中泊（避難所の外の車の中で過ごす） */
  carSleep?: number;
  /** 近所の人が様子を見に来た（支援者の連絡先の無い人） */
  neighborWatch?: number;
  /** 本人が家の外へ出た（行き先が分からない） */
  wandering?: number;
  /**
   * 行き先の分からなかった本人が見つかり家に戻った（T141。家の外へ出た印のあと、世界が決まった時間のうちに付ける。lib/drill/lost.ts）。
   * 家の外へ出た印より後の時刻なら、帳面のいる所は家
   */
  found?: number;
};

/** T92 の印（WorldChange の mark が付ける物。前からの印は種類ごとの WorldChange が付ける） */
export const EXTRA_MARKS = ["helperAway", "familyAway", "carSleep", "neighborWatch", "wandering", "found"] as const;
export type ExtraMark = (typeof EXTRA_MARKS)[number];

/**
 * 世界の状態を変えない出来事の話題（T92、WorldChange の note）。状況の欄と本人役への文に出るだけ。
 * 給水所・情報の混乱・土砂の警戒
 */
export const NOTE_TOPICS = [
  "water_station",
  "info_confusion",
  "landslide_warn",
  // T104: 訓練する人（自分）の身の回り（lib/drill/event-catalog.ts の self_*）。家族の無事の確認は予定の出来事から
  "self_outage",
  "self_family",
  "self_family_ok",
  "self_late",
  "self_battery",
] as const;
export type NoteTopic = (typeof NOTE_TOPICS)[number];

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
  /**
   * 電波（携帯の基地局、T125）。down は監督の差し込みの全域の不通。停電が長引いた区域の家の不通は lib/drill/comms.ts の radioDownAt が
   * 停電と想定の表から決める（ここには書かない）。無ければ通常
   */
  radio?: RadioState;
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
  // ---------- T90 の準備で足した共有の欄。どれも省略可で、無ければ今までと同じ（drills.world の JSON に入る。migration は要らない） ----------
  /**
   * 本人ごとの時計の頼り先の確認の上書き（透析先・配達・冷蔵）。lib/drill/world-clocks.ts の drillClocks が最後に当てる
   * （施設の休止・栄養剤の持ち出し忘れの書き換えより後。両方あればこちら）。ルールの表の入力の形は変えない
   */
  checks?: Record<string, Partial<Record<DependsOn, CheckStatus>>>;
  /**
   * 本人の所へ向かっている人（dispatched の一般形）。settleWorld が arrive を過ぎたら arrived にして CLEARED_ON_ARRIVAL の印を消し、
   * 届く物（ARRIVAL_SUPPLIES）を supplies に書き、職員（role staff）は back を過ぎたら職員の空きを 1 戻す。着いた物も記録として残す
   */
  arrivals?: Arrival[];
  /** 本人の所へ届いた物（台帳の id → 物 → 届いた時刻、発災からの分）。settleWorld が arrivals の到着から書く */
  supplies?: Record<string, Partial<Record<SupplyKind, number>>>;
  /** 本人・家族からの頼み事（台帳の id → 頼み事の一覧） */
  asks?: Record<string, Ask[]>;
  /** 予定の出来事。lib/drill/schedule.ts の fireScheduled が時刻の来た物を取り出して状況にする */
  scheduled?: Scheduled[];
  /** 119 への連絡を勧めた時刻（台帳の id → 発災からの分）。勧めるまでで、自動の 119 はしない */
  advised?: Record<string, number>;
  /** 本人役を最後に呼んだ時刻（台帳の id → 発災からの分） */
  lastCalled?: Record<string, number>;
  /** 本人役を呼ぶ理由ができた時刻（台帳の id → 発災からの分）。呼べなかった人を次の進めに持ち越す */
  touched?: Record<string, number>;
  /** この訓練の AI の呼び出しの数（1 訓練の上限に使う） */
  counts?: DrillCounts;
  /**
   * 起きた note の話題と最初の時刻（T92。発災からの時間）。note は世界の様子を変えないが、同じ話題を 2 度差し込まないために覚える
   */
  notes?: Partial<Record<NoteTopic, number>>;
  /**
   * 状態が最後に変わった時刻（T121。発災からの時間）。鍵は phone・outage・water・weather・road:<id>・facility:<id>・shelter:<id>。
   * applyEvent が変わったときだけ書く（表の出来事も AI の出来事も同じ所を通るので、再生でも同じ値になる）。
   * 変わるのに時間が要る状態の決まり（lib/drill/state-rules.ts）と、本人役・監督に渡す「いつから」の元
   */
  stamps?: Record<string, number>;
  /**
   * 門で落とした・直した数（1 つの数え。評価の台が数える）。AI の出力の門（T125、lib/drill/gate.ts）は「出どころ:決まり」の鍵
   * （director:fit:alert・persona:fit:quake_word・world:dwell:road など）、人ごとの事実の帳面（T130、lib/drill/person-facts.ts）の門は
   * 決まりの名前の鍵。世界を変えない。帳面そのものは保存しない（前の連絡・手・到着・台帳から毎回引く）
   */
  gated?: Record<string, number>;
  /** 監督・世界が出した人ごとの出来事（T130。同じ種類・同じ言い回しを別の人にくり返さないために覚える。新しい 40 件まで） */
  issued?: Array<{ kind: string; person: string | null; text: string; at: number }>;
  /**
   * 掛かってきた電話の往復でケアマネが言った事（T130、lib/drill/person-facts.ts の pushTold。台帳の id → 行。人ごとに新しい 8 つまで）。
   * 本人役の帳面の「ケアマネに言われた事」に入る（外へ掛けた電話の往復は手の返事の talk から引く）
   */
  told?: Record<string, Array<{ minute: number; text: string; ask?: string }>>;
};

/** 向かっている人の役。staff 事業所の職員・nurse 訪問看護・supporter 支援者・family 家族・vendor 業者・transport 移送・power 電源・medicine 薬 */
export const ARRIVAL_ROLES = ["staff", "nurse", "supporter", "family", "vendor", "transport", "power", "medicine"] as const;
export type ArrivalRole = (typeof ARRIVAL_ROLES)[number];

/**
 * 本人の所へ向かっている 1 件。時刻は発災からの分。back は戻る時刻（職員の空きを戻すのは role staff だけ。戻ったら null）。
 * from は向かうきっかけになった手の番号（a1…）。出来事の表の業者の巡回（T92、WorldChange の schedule）は "director" か "world"
 */
export type Arrival = {
  person: string;
  role: ArrivalRole;
  arrive: number;
  back: number | null;
  arrived: boolean;
  from: string;
  /**
   * 着いたら届く物（無ければ役の物、ARRIVAL_SUPPLIES）。業者の巡回は、酸素の人は酸素、呼吸器だけの人は電源（医療機器の業者の予備の電池。T123。
   * 評価の 2 回目で、呼吸器の人に「酸素業者」が来て酸素が届いたと話した）
   */
  supply?: SupplyKind;
};

/** 届く物の種類 */
export const SUPPLY_KINDS = ["power", "oxygen", "medicine", "water"] as const;
export type SupplyKind = (typeof SUPPLY_KINDS)[number];

/** 着いたら届く物（役 → 物）。ほかの役は物を届けない */
export const ARRIVAL_SUPPLIES: Readonly<Partial<Record<ArrivalRole, SupplyKind>>> = {
  power: "power",
  vendor: "oxygen",
  medicine: "medicine",
};

/** 頼み事の種類（閉じた一覧） */
export const ASK_KINDS = ["medicine", "water", "food", "power", "transport", "family_contact", "battery", "toilet", "warmth"] as const;
export type AskKind = (typeof ASK_KINDS)[number];

/** 頼み事 1 つ。at は頼まれた時刻、done は済んだ時刻（発災からの分。まだなら null） */
export type Ask = { kind: AskKind; at: number; done: number | null };

/**
 * 予定の出来事 1 つ。at は起きる時刻（発災からの分）。text は起きたときの画面の 1 行（氏名・町名・施設の名前を書かない）。
 * by は積んだ所（監督・世界・ケアマネの手）
 */
export type Scheduled = {
  at: number;
  change: WorldChange;
  text: string;
  person?: string;
  basis?: SourceId;
  by: "director" | "world" | "action";
  /** AI が書いた文か（区切りの終わりから次へ回した監督の出来事。T178）。無ければ AI の印なし */
  ai?: boolean;
  /** 差し込みの種類（同じ出来事。T178） */
  inject?: WorldEvent["inject"];
};

/** この訓練の AI の呼び出しの数（監督・本人役・通話の相手・自由に書く手） */
export type DrillCounts = { director: number; persona: number; call: number; free: number };

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
  // 電波（T125）。監督の「携帯の基地局の停止」と、その見込みの回復
  | { kind: "radio"; state: RadioState }
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
  // AI の 1 日の上限（lib/claude/usage.ts）で本人役・監督・世界が呼べなかった刻みの印（T70。世界を変えない。記録に残す）
  | { kind: "ai_stop"; stopped: AiStop[] }
  // 進行中のまま 24 時間たった訓練を読むときに中断した印（T70。最後の刻みに 1 行。世界を変えない）
  | { kind: "auto_abandon"; hours: number }
  // 本人ごとの印（監督の差し込み。person が要る）
  | { kind: "supply_left" }
  | { kind: "nurse_away" }
  | { kind: "going_home" }
  | { kind: "line_down" }
  // ---------- T92: 出来事の表（lib/drill/event-catalog.ts）が組む変化。足すのはこの 4 つだけ ----------
  // 世界の様子を変えない出来事（給水所・情報の混乱・土砂の警戒）。notes に話題と時刻を覚えるだけ
  | { kind: "note"; topic: NoteTopic }
  // T92 の印（person が要る）
  | { kind: "mark"; mark: ExtraMark }
  // 本人の時計の頼り先の確認の上書き（world.checks。person が要る）。ルールの表の入力の形は変えない（lib/drill/world-clocks.ts）
  | { kind: "check"; depends: DependsOn[]; status: CheckStatus }
  // 予定を積む。at は起きる・着く時刻（発災からの分）。then が event なら world.scheduled（時刻が来たら lib/drill/schedule.ts の
  // fireScheduled が状況にする）、arrival なら world.arrivals（着いたら settleWorld）。by は積んだ所
  | { kind: "schedule"; at: number; by: "director" | "world"; then: ScheduledThen };

/** 予定の中身（T92）。event は時刻が来たら当てる変化と画面の文、arrival は向かってくる人の役 */
export type ScheduledThen = { kind: "event"; change: WorldChange; text: string } | { kind: "arrival"; role: ArrivalRole; supply?: SupplyKind };

export type WorldEventKind = WorldChange["kind"];

/** 上限で止まった AI の役（本人役・監督・世界）。印の並びもこの順 */
export const AI_STOPS = ["persona", "director", "world"] as const;
export type AiStop = (typeof AI_STOPS)[number];

/** 世界の 1 刻みを作った所。room は Managed Agents の部屋、oneshot は Messages API の 1 回呼び（部屋が使えないときの代替） */
export type WorldVia = "room" | "oneshot";

// ---------- 監督の差し込みの種類（T19・T92） ----------
// 種類・固定の文・世界の変化は出来事の表（lib/drill/event-catalog.ts）が持つ。前からの import を壊さないよう、ここからも出す。
// event-catalog.ts はこのファイルを型だけ読む（HEAVY_RAIN を作るときに injectChange を呼ぶので、輪にしない）

export { INJECT_KINDS, INJECT_TEXTS, injectChange, isInjectKind, ROAD_BOUND_ROLES, type InjectKind } from "./event-catalog.ts";

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
        // 小林の夫の電話（動画で必ず出すため表で固定）。停電と同時に呼吸器が内蔵電池（3 時間）に替わる
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
        // 通話は規制（かけ直せば時々つながる。T125 で「通話不可」から。全部は止めない）。固定電話は停電の家で使えない（lib/drill/comms.ts）
        { change: { kind: "phone", state: "down" }, text: "電話 規制 つながりにくい" },
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

/**
 * 始められる想定の並び（開始のボタンの順。先頭が主の操作）。10 分版（short）は T124 で外した。
 * 前からある 10 分版の記録は SCENARIOS から読めるが、開始の API（lib/drill/http.ts の startPost）は断る
 */
export const SCENARIO_ORDER: ReadonlyArray<DrillScenario> = ["earthquake", "heavy_rain", "virtual"];

/** 新しく始められる想定か（開始の API の門。10 分版は前からある記録だけ） */
export function isStartScenario(id: DrillScenario): boolean {
  return SCENARIO_ORDER.includes(id);
}

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

/** 出来事 1 つを世界に当てる（新しい世界を返す。元は変えない）。状態が変わったら変わった時刻を stamps に書く（T121） */
export function applyEvent(world: WorldState, e: WorldEvent, hour: number): WorldState {
  return stampChanges(world, applyChange(world, e, hour), hour);
}

/** 状態の鍵と今の値（stamps の比べ方）。道・施設・避難所は id ごと */
function stateValues(w: WorldState): Map<string, string> {
  const out = new Map<string, string>([
    ["phone", w.phone],
    ["radio", w.radio ?? "ok"],
    ["outage", w.outage ? `${w.outage.since}|${w.outage.restoredAt ?? ""}` : ""],
    ["water", w.water],
    ["weather", w.weather ?? ""],
  ]);
  for (const r of w.roads) out.set(`road:${r.id}`, r.open ? "open" : "closed");
  for (const f of w.facilities) out.set(`facility:${f.id}`, f.open ? "open" : "closed");
  for (const s of w.shelters) out.set(`shelter:${s.id}`, s.state);
  return out;
}

/** 前と後の世界を比べ、変わった状態の時刻を stamps に書く（変わらなければ後の世界をそのまま返す） */
export function stampChanges(before: WorldState, after: WorldState, hour: number): WorldState {
  if (before === after) return after;
  const a = stateValues(before);
  const b = stateValues(after);
  const changed: string[] = [];
  for (const [k, v] of b) if (a.get(k) !== v) changed.push(k);
  if (changed.length === 0) return after;
  const stamps = { ...(after.stamps ?? {}) };
  for (const k of changed) stamps[k] = hour;
  return { ...after, stamps };
}

function applyChange(world: WorldState, e: WorldEvent, hour: number): WorldState {
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
        const places = o.area.places || c.area.places ? [...new Set([...(o.area.places ?? []), ...(c.area.places ?? [])])] : undefined;
        return { ...world, outage: { ...o, area: { scope: "towns", towns, since, ...(places ? { places } : {}) } } };
      }
      // 続いている停電が全域に広がる（T92 の outage_spread）: 始まりは最初の時刻のまま。今の時刻にすると、ルールの表の停電の始まり
      // （outageAt）が後ろにずれ、もう走っている機器の電池の時計が戻る
      if (o && o.restoredAt === null && c.area.scope === "office") {
        return { ...world, outage: { ...o, area: { scope: "office" } } };
      }
      return { ...world, outage: { area: c.area, since: hour, restoredAt: null } };
    }
    case "outage_restored":
      return world.outage ? { ...world, outage: { ...world.outage, restoredAt: hour } } : world;
    case "phone":
      return { ...world, phone: c.state };
    case "radio":
      return c.state === "down" ? { ...world, radio: "down" } : (({ radio: _r, ...rest }) => rest)(world);
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
      return c.persons.reduce((w, p) => {
        const roads = upsert(w.roads, { id: `rd-${c.road}-${p}`, label: c.label, open: c.open, person: p });
        // 地区の道が開いたら、同じ人の土砂の道も開く（T174。評価の 9 回目で、世界が「土砂がよけられて通れる」と書いたあとも土砂の道だけ閉じたままで、
        // 本人役に通行可と通行止の 2 本が渡り、家族が「道は通ったが水で」と別の訳を作った）。名前のある道（橋・トンネル）の開通では開けない
        return { ...w, roads: c.open && c.road.startsWith("town-") ? roads.map((r) => (r.person === p && r.id.startsWith("rd-ls-") ? { ...r, open: true } : r)) : roads };
      }, world);
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
      return { ...world, story: [...(world.story ?? []), `${hourText(hour)}: ${c.room}`].slice(-STORY_MAX) };
    case "world_note":
    case "ai_stop":
    case "auto_abandon":
      return world;
    case "outcome": {
      if (!person || world.ended?.[person]) return world;
      return { ...world, ended: { ...(world.ended ?? {}), [person]: { at: hour, label: c.label, reason: c.reason ?? null } } };
    }
    // ---------- T92 の出来事の表の変化 ----------
    case "note":
      return world.notes?.[c.topic] !== undefined ? world : { ...world, notes: { ...(world.notes ?? {}), [c.topic]: hour } };
    case "mark":
      return mark(world, person, c.mark, hour);
    case "check": {
      if (!person || c.depends.length === 0) return world;
      const own = { ...(world.checks?.[person] ?? {}) };
      for (const d of c.depends) own[d] = c.status;
      return { ...world, checks: { ...(world.checks ?? {}), [person]: own } };
    }
    case "schedule": {
      const t = c.then;
      if (t.kind === "arrival") {
        if (!person) return world;
        const a: Arrival = { person, role: t.role, arrive: c.at, back: null, arrived: false, from: c.by, ...(t.supply ? { supply: t.supply } : {}) };
        return { ...world, arrivals: [...(world.arrivals ?? []), a] };
      }
      const s: Scheduled = {
        at: c.at,
        change: t.change,
        text: t.text,
        ...(person ? { person } : {}),
        ...(e.basis ? { basis: e.basis } : {}),
        by: c.by,
      };
      return { ...world, scheduled: [...(world.scheduled ?? []), s] };
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
 * 向かっている人（arrivals、T90 の準備）も同じ動きで、着いたら届く物を supplies に書く。
 * 同じ時刻で何度呼んでも同じ（刻みでも手でも呼ぶ）。進める物が無ければ同じ世界を返す
 */
export function settleWorld(world: WorldState, minute: number): WorldState {
  return settleArrivals(settleDispatched(world, minute), minute);
}

/** 道の状態が最後に変わった時刻（分）。変わっていなければ null（始めからその状態） */
function roadStampOf(world: WorldState, id: string): number | null {
  const h = world.stamps?.[`road:${id}`];
  return typeof h === "number" ? Math.round(h * 60) : null;
}

/**
 * 家へ向かう人が、着く時刻（arrive）に家の前の道を通れなかったか（T123）。今通行止で、通行止になったのが着く時刻より前（変わった時刻が
 * 無ければ始めから）。評価の 2 回目で、通行止の道の先に業者が着き物が届いた（世界の決まりの道の外だった）
 */
export function roadHeld(world: Pick<WorldState, "roads" | "stamps">, person: string, arrive: number): boolean {
  return world.roads.some((r) => r.person === person && !r.open && (roadStampOf(world as WorldState, r.id) ?? 0) <= arrive);
}

/** 着く時刻より後に家の前の道が通れるようになっていれば、その時刻に着く（通行止で待っていた人） */
function reachTime(world: WorldState, person: string, arrive: number): number {
  let at = arrive;
  for (const r of world.roads) {
    if (r.person !== person || !r.open) continue;
    const s = roadStampOf(world, r.id);
    if (s !== null && s > at) at = s;
  }
  return at;
}

/** 着ける時刻（分）。道で待つ人は null（まだ着かない）。待っていた道が通れるようになれば、その時刻 */
function landAt(world: WorldState, person: string, arrive: number, roadBound: boolean): number | null {
  if (!roadBound) return arrive;
  if (roadHeld(world, person, arrive)) return null;
  return reachTime(world, person, arrive);
}

/** 出向いてもらった人（dispatched、T20） */
function settleDispatched(world: WorldState, minute: number): WorldState {
  const list = world.dispatched ?? [];
  if (!list.some((d) => (!d.arrived && d.arrive <= minute) || (d.back !== null && d.back <= minute))) return world;
  let w: WorldState = world;
  const rest: Dispatched[] = [];
  for (const d of list) {
    let x = d;
    // 事業所の職員は車で行く。家の前の道が通れない間は着かない（T123）
    const at = !x.arrived && x.arrive <= minute ? landAt(w, x.person, x.arrive, true) : null;
    if (at !== null && at <= minute) {
      w = clearMarks(w, x.person, CLEARED_ON_ARRIVAL).world;
      x = { ...x, arrive: at, arrived: true };
    }
    if (x.back !== null && x.back <= minute) {
      w = { ...w, staff: w.staff + 1 };
      x = { ...x, back: null };
    }
    if (!x.arrived || x.back !== null) rest.push(x);
  }
  return { ...w, dispatched: rest };
}

/**
 * 向かっている人（arrivals、T90 の準備）。着いたら印を消し、届く物を supplies に書き（届いた時刻は arrive。前より後なら書き直す）、
 * 職員（role staff）は戻ったら職員の空きを 1 戻す。dispatched と違い、着いた・戻った物も一覧に残す（採点・本人役が読む）
 */
function settleArrivals(world: WorldState, minute: number): WorldState {
  const list = world.arrivals;
  if (!list || !list.some((a) => (!a.arrived && a.arrive <= minute) || (a.back !== null && a.back <= minute))) return world;
  let w: WorldState = world;
  const next = list.map((a) => {
    let x = a;
    // 車で来る役は、家の前の道が通れない間は着かず、通れるようになった時刻に着く（T123）
    const at = !x.arrived && x.arrive <= minute ? landAt(w, x.person, x.arrive, ROAD_BOUND_ROLES.has(x.role)) : null;
    if (at !== null && at <= minute) {
      w = clearMarks(w, x.person, CLEARED_ON_ARRIVAL).world;
      const kind = x.supply ?? ARRIVAL_SUPPLIES[x.role];
      if (kind) w = supplied(w, x.person, kind, at);
      x = { ...x, arrive: at, arrived: true };
    }
    if (x.back !== null && x.back <= minute) {
      if (x.role === "staff") w = { ...w, staff: w.staff + 1 };
      x = { ...x, back: null };
    }
    return x;
  });
  return { ...w, arrivals: next };
}

/** 届いた物を書く（前に届いた時刻より後なら書き直す） */
function supplied(world: WorldState, person: string, kind: SupplyKind, at: number): WorldState {
  const own = world.supplies?.[person] ?? {};
  const prev = own[kind];
  if (prev !== undefined && prev >= at) return world;
  return { ...world, supplies: { ...(world.supplies ?? {}), [person]: { ...own, [kind]: at } } };
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
