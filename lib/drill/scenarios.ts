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

import type { DrillScenario, HazardKind, SignalColor, SignalSource, WhereNow } from "../db/types.ts";

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

/** 避難所: 開設・混雑・満員 */
export const SHELTER_STATES = ["open", "crowded", "full"] as const;
export type ShelterState = (typeof SHELTER_STATES)[number];

/**
 * 停電の範囲。office は事業所の全員、hazard はハザードの地区（浸水 3 m 以上の人の住む町）。
 * 町名は表に持たず、実行のときに参加者の台帳から引く（lib/drill/engine.ts の outageTownsOf）
 */
export type OutageArea = { scope: "office" } | { scope: "hazard"; hazard: HazardKind; minDepthM: number };

/** 道路・避難所・施設。label は場所の名前を書かない一般の言い方（川沿いの市道・指定避難所） */
export type Road = { id: string; label: string; open: boolean; person: string | null };
export type Shelter = { id: string; label: string; state: ShelterState; person: string | null };
export type Facility = { id: string; label: string; open: boolean; person: string | null };

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
};

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
  | { kind: "facility"; id: string; label: string; open: boolean };

export type WorldEventKind = WorldChange["kind"];

/** 世界の出来事（状況）1 つ。text は画面の 1 行（氏名・町名・施設の名前を書かない） */
export type WorldEvent = {
  change: WorldChange;
  text: string;
  /** 関わる本人（台帳の id）。道路・施設がその人の所の物など */
  person?: string;
  /** 起きた時刻（発災からの時間）。無ければ刻みの時刻。10 分版で寄せた出来事は元の時刻を持つ */
  at?: number;
};

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
};

export type ScenarioTick = { hour: number; events: WorldEvent[]; turns: FixedTurn[] };

export type Scenario = {
  id: DrillScenario;
  kind: DrillKind;
  /** 刻みの時刻。ticks と同じ順 */
  hours: readonly number[];
  ticks: ScenarioTick[];
};

// ---------- 大雨 ----------
// 警戒レベル 3 → 4 → 浸水 3 m の地区。1 山田・2 小林が主役、3 田中の透析先、5 伊藤の道路。
// 色の動き（ルールの表で）: 山田は 3 時間で赤（けが）。小林は連絡なしのまま人工呼吸器の電池で 3 時間に黄、6 時間に赤。
// 田中は家族の緑でも透析先 未確認で黄、48 時間に家族の赤。佐藤（スマホを持たない）は不明のまま → 6 時間に民生委員が見に行って緑。

const FLOOD_AREA: OutageArea = { scope: "hazard", hazard: "flood", minDepthM: 3 };

const HEAVY_RAIN: Scenario = {
  id: "heavy_rain",
  kind: "heavy_rain",
  hours: DRILL_HOURS,
  ticks: [
    {
      hour: 0,
      events: [
        { change: { kind: "alert", level: 3 }, text: "警戒レベル 3 高齢者等避難" },
        { change: { kind: "shelter", id: "sh-1", label: "指定避難所", state: "open" }, text: "指定避難所 開設" },
      ],
      turns: [
        { person: "p-03", color: "green", source: "family", whereNow: "home", saying: "2 階にいます" },
        { person: "p-06", color: "green", source: "family", whereNow: "home", saying: "家にいます。様子を見ます" },
        { person: "p-10", color: "green", source: "family", whereNow: "home" },
      ],
    },
    {
      hour: 1,
      events: [
        { change: { kind: "alert", level: 4 }, text: "警戒レベル 4 避難指示" },
        { change: { kind: "outage", area: FLOOD_AREA }, text: "浸水 3 m の地区で停電" },
      ],
      turns: [
        { person: "p-07", color: "green", source: "agent", whereNow: "home", saying: "家にいる。まだ大丈夫" },
        { person: "p-08", color: "green", source: "agent", whereNow: "home" },
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
          person: "p-05",
        },
      ],
      turns: [
        { person: "p-01", color: "red", source: "agent", injured: true, saying: "いたい、うごけない", doing: "4 問の途中で止まった" },
        { person: "p-06", color: "green", source: "family", whereNow: "shelter", saying: "避難所に着きました" },
      ],
    },
    {
      hour: 6,
      events: [
        { change: { kind: "shelter", id: "sh-1", label: "指定避難所", state: "crowded" }, text: "指定避難所 混雑" },
      ],
      turns: [
        { person: "p-04", color: "green", source: "supporter", whereNow: "home", saying: "見に行きました。家にいます" },
      ],
    },
    {
      hour: 9,
      events: [
        {
          change: { kind: "road", id: "rd-2", label: "山すその道", open: false },
          text: "山すその道 土砂で通行止め",
          person: "p-07",
        },
      ],
      turns: [
        { person: "p-07", color: "green", source: "agent", whereNow: "home", saying: "避難所には行かん", doing: "避難を渋る" },
      ],
    },
    {
      hour: 12,
      events: [
        {
          change: { kind: "facility", id: "fc-1", label: "透析施設", open: false },
          text: "透析施設 浸水で休止",
          person: "p-03",
        },
      ],
      turns: [],
    },
    {
      hour: 18,
      events: [{ change: { kind: "water", out: true }, text: "断水" }],
      turns: [
        { person: "p-03", color: "green", source: "family", whereNow: "home", saying: "透析の病院に電話がつながらない" },
      ],
    },
    {
      hour: 24,
      events: [
        { change: { kind: "alert", level: 3 }, text: "警戒レベル 3 に引き下げ" },
        { change: { kind: "phone", state: "ok" }, text: "電話 回復" },
      ],
      turns: [{ person: "p-08", color: "green", source: "agent", whereNow: "home" }],
    },
    {
      hour: 36,
      events: [
        {
          change: { kind: "road", id: "rd-1", label: "川沿いの市道", open: true },
          text: "川沿いの市道 通行再開",
          person: "p-05",
        },
      ],
      turns: [{ person: "p-06", color: "green", source: "family", whereNow: "shelter" }],
    },
    {
      hour: 48,
      events: [{ change: { kind: "outage_restored" }, text: "停電 復旧" }],
      turns: [{ person: "p-03", color: "red", source: "family", saying: "透析に行けていない。次が決まらない" }],
    },
    {
      hour: 60,
      events: [{ change: { kind: "water", out: false }, text: "断水 解消" }],
      turns: [{ person: "p-10", color: "green", source: "family", whereNow: "home" }],
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
// 井上は高台の集会所で緑、冷蔵が無くインスリンの時計が走り 60 時間に黄。

const EARTHQUAKE: Scenario = {
  id: "earthquake",
  kind: "earthquake",
  hours: DRILL_HOURS,
  ticks: [
    {
      hour: 0,
      events: [
        { change: { kind: "quake", intensity: "6強" }, text: "南海トラフ 震度 6強" },
        { change: { kind: "tsunami", state: "evacuate" }, text: "津波警報、沿岸に避難指示" },
        { change: { kind: "outage", area: { scope: "office" } }, text: "停電 全域" },
        { change: { kind: "phone", state: "down" }, text: "電話 不通" },
      ],
      turns: [{ person: "p-07", color: "green", source: "agent", whereNow: "home", saying: "家は大丈夫" }],
    },
    {
      hour: 1,
      events: [
        {
          change: { kind: "shelter", id: "sh-2", label: "高台の集会所", state: "open" },
          text: "高台の集会所 受入開始",
          person: "p-08",
        },
      ],
      turns: [
        { person: "p-08", color: "green", source: "agent", whereNow: "shelter", saying: "高台の集会所に来た" },
        { person: "p-03", color: "green", source: "family", whereNow: "home" },
        { person: "p-06", color: "green", source: "family", whereNow: "home" },
        { person: "p-09", color: "green", source: "agent", whereNow: "home", saying: "大丈夫" },
        { person: "p-10", color: "green", source: "family", whereNow: "home" },
      ],
    },
    {
      hour: 3,
      events: [
        {
          change: { kind: "road", id: "rd-3", label: "沿岸の道", open: false },
          text: "沿岸の道 津波で通行止め",
          person: "p-08",
        },
      ],
      turns: [],
    },
    {
      hour: 6,
      events: [{ change: { kind: "tsunami", state: "lifted" }, text: "津波警報 解除" }],
      turns: [
        {
          person: "p-02",
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
          person: "p-08",
        },
      ],
      turns: [{ person: "p-04", color: "green", source: "supporter", whereNow: "home", saying: "見に行きました。家にいます" }],
    },
    {
      hour: 12,
      events: [{ change: { kind: "phone", state: "busy" }, text: "電話 一部回復 不安定" }],
      turns: [{ person: "p-01", color: "red", source: "family", saying: "母の家に来た。酸素ボンベが残り少ない" }],
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
        { person: "p-08", color: "green", source: "agent", whereNow: "shelter", saying: "インスリンは持ってきたけど、冷やせない" },
      ],
    },
    {
      hour: 36,
      events: [
        {
          change: { kind: "facility", id: "fc-1", label: "透析施設", open: false },
          text: "透析施設 断水で休止",
          person: "p-03",
        },
      ],
      turns: [],
    },
    {
      hour: 48,
      events: [{ change: { kind: "outage_restored" }, text: "停電 復旧" }],
      turns: [{ person: "p-08", color: "green", source: "agent", whereNow: "shelter" }],
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
  return { id, kind: base.kind, hours, ticks };
}

const SHORT = condense(HEAVY_RAIN, "short", SHORT_HOURS);

export const SCENARIOS: Readonly<Record<DrillScenario, Scenario>> = {
  heavy_rain: HEAVY_RAIN,
  earthquake: EARTHQUAKE,
  short: SHORT,
};

/** 想定の並び（開始のボタンの順） */
export const SCENARIO_ORDER: ReadonlyArray<DrillScenario> = ["heavy_rain", "earthquake", "short"];

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
    case "outage":
      return { ...world, outage: { area: c.area, since: hour, restoredAt: null } };
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
      return { ...world, facilities: upsert(world.facilities, { id: c.id, label: c.label, open: c.open, person }) };
  }
}

/** 出来事を順に当てる */
export function applyEvents(world: WorldState, events: ReadonlyArray<WorldEvent>, tickHour: number): WorldState {
  return events.reduce((w, e) => applyEvent(w, e, eventHour(e, tickHour)), world);
}
