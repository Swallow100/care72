// 想定ごとの表（docs/tasks/T125.md）。訓練の災害の種類ごとに、効くハザード・その条件・起こりうる状況・出来事の種類・地図の既定の層・
// 起きてはいけない言葉を 1 か所に持つ。手の可否と所要（action-terms.ts）・訓練の画面の担当一覧のハザードの列（view.ts）・上の帯・
// 地図の既定の層（lib/map/demo.ts）・監督（director.ts）・世界（world-oneshot.ts）・本人役の状況（persona.ts）・時間ごとの起きやすさ
// （time-odds.ts）・AI の出力の門（gate.ts）・評価の台（tools/eval/drill/checks.ts）が全部ここを読む。Claude を呼ばない。
//
// - 表は全部の災害の種類（DrillKind）を持つ（Record の型で網羅。足して行が無いと型で落ちる）。想定（DrillScenario）から種類への写しも
//   Record で全部持つ。仮想は開始で決めた規模の災害、無ければ世界の出来事、それも無ければ未決（null。両方を許す）
// - 区域のハザード（河川の浸水・津波の浸水・土砂）は、条件（世界の状態）が真の間、区域にいる人（台帳のハザード）と区域の事業所にだけ効く。
//   揺れ・倒壊は区域でなく全体
// - 色と連絡順（lib/triage）には使わない。ここは「想定に合うか」と「誰に効くか」だけ
// - 輪にしない: lib/drill のほかのファイルを型だけ読む（scenarios.ts・event-catalog.ts・world-apply.ts は値で読まない）

import type { DrillScenario, HazardKind } from "../db/types.ts";
import type { InjectKind } from "./event-catalog.ts";
import type { DrillScale } from "./scale.ts";
import type { DrillKind, WorldChange, WorldState } from "./scenarios.ts";
import type { WorldKind } from "./world-apply.ts";

// ---------- ハザード ----------

/** 表のハザード。river_flood 河川の浸水・tsunami_flood 津波の浸水・landslide 土砂・shaking 揺れ・collapse 倒壊 */
export const FIT_HAZARDS = ["river_flood", "tsunami_flood", "landslide", "shaking", "collapse"] as const;
export type FitHazard = (typeof FIT_HAZARDS)[number];

/** Claude（監督・世界）に渡す言い方。画面の言葉ではない */
export const FIT_HAZARD_WORDS: Readonly<Record<FitHazard, string>> = {
  river_flood: "川の氾濫・浸水（洪水の区域の家）",
  tsunami_flood: "津波の浸水（津波の区域の家だけ。津波警報の間）",
  landslide: "土砂崩れ（土砂の区域の家）",
  shaking: "強い揺れ・余震",
  collapse: "家屋の倒壊・家具の転倒・落下物",
};

/** 台帳のハザード（区域の種類）→ 表のハザード。その他は中身が書き足しで種類が分からないので結び付けない */
export const LEDGER_HAZARD: Readonly<Record<HazardKind, FitHazard | null>> = {
  flood: "river_flood",
  tsunami: "tsunami_flood",
  landslide: "landslide",
  other: null,
};

/** 表のハザード → 区域の種類（台帳のハザード）。揺れ・倒壊は区域でなく全体（null） */
export const HAZARD_ZONE: Readonly<Record<FitHazard, Exclude<HazardKind, "other"> | null>> = {
  river_flood: "flood",
  tsunami_flood: "tsunami",
  landslide: "landslide",
  shaking: null,
  collapse: null,
};

/** 浸水の類（手の所要の「浸水」の元） */
export const WATER_HAZARDS: ReadonlyArray<FitHazard> = ["river_flood", "tsunami_flood"];

// ---------- 状況 ----------

/** 起こりうる状況。radio は電波不通（携帯の基地局が止まる。lib/drill/comms.ts） */
export const FIT_SITUATIONS = [
  "outage",
  "water",
  "phone",
  "radio",
  "road",
  "shelter",
  "facility",
  "alert",
  "rain",
  "quake",
  "aftershock",
  "tsunami_warning",
] as const;
export type FitSituation = (typeof FIT_SITUATIONS)[number];

/** 条件を見る世界の状態（要る所だけ） */
export type FitWorld = Pick<WorldState, "flood" | "alertLevel" | "quake" | "tsunami"> & Partial<Pick<WorldState, "notes" | "weather">>;

/** 起きない世界の変化。when があれば、真のときだけ起きない（条件つき）。words は監督・世界に渡す言い方 */
export type ChangeBan = {
  id: string;
  kinds: ReadonlyArray<WorldChange["kind"]>;
  when?: (c: WorldChange, w: FitWorld) => boolean;
  words: string;
};

/** 起きてはいけない言葉（出来事の文・本人役の言葉・自由対応の文・帯）。when があれば、真のときだけ */
export type WordBan = { id: string; re: RegExp; when?: (w: FitWorld) => boolean };

export type FitProfile = {
  kind: DrillKind;
  /** 画面の言葉（2 字） */
  label: string;
  /** 効くハザード（表の並び） */
  hazards: ReadonlyArray<FitHazard>;
  /** ハザードが効く条件（世界の状態）。表に無いハザードは null */
  active: Readonly<Record<FitHazard, ((w: FitWorld) => boolean) | null>>;
  situations: ReadonlyArray<FitSituation>;
  /** 監督の差し込みの種類。banned は差し込ませない、words は指示に出す中身の言い換え */
  injects: { banned: ReadonlyArray<InjectKind>; words: Readonly<Partial<Record<InjectKind, string>>> };
  /** 世界の部屋・1 回呼びの種類。banned は使わせない、only は使う条件（指示の文） */
  worldKinds: { banned: ReadonlyArray<WorldKind>; only: Readonly<Partial<Record<WorldKind, string>>> };
  changes: ReadonlyArray<ChangeBan>;
  words: ReadonlyArray<WordBan>;
  /** 地図の既定の層（台帳のハザードの種類） */
  layers: ReadonlyArray<Exclude<HazardKind, "other">>;
};

const noHazard = { river_flood: null, tsunami_flood: null, landslide: null, shaking: null, collapse: null } as const;

/** 大雨で起きない言葉（地震・津波の類） */
const QUAKE_WORDS = /地震|余震|震度|津波|揺れ/;
/** 地震で起きない言葉（大雨・河川の類） */
const RAIN_WORDS = /大雨|豪雨|雨脚|氾濫|河川|増水|警戒レベル|冠水/;
/** 浸水の言葉（地震では津波警報が出ていないときだけ合わない） */
const FLOOD_WORDS = /浸水|水が来|水につか|床上|床下/;

/** 想定ごとの表（災害の種類ごと） */
export const FIT_PROFILES: Readonly<Record<DrillKind, FitProfile>> = {
  heavy_rain: {
    kind: "heavy_rain",
    label: "大雨",
    hazards: ["river_flood", "landslide"],
    active: {
      ...noHazard,
      river_flood: (w) => w.flood || (w.alertLevel ?? 0) >= 4,
      landslide: (w) => (w.alertLevel ?? 0) >= 4 || w.notes?.landslide_warn !== undefined,
    },
    situations: ["outage", "water", "phone", "radio", "road", "shelter", "facility", "alert", "rain"],
    injects: { banned: ["aftershock"], words: {} },
    worldKinds: { banned: ["aftershock"], only: {} },
    changes: [
      { id: "quake", kinds: ["quake"], words: "地震・余震" },
      { id: "tsunami", kinds: ["tsunami"], words: "津波" },
    ],
    words: [{ id: "quake_word", re: QUAKE_WORDS }],
    layers: ["flood", "landslide"],
  },
  earthquake: {
    kind: "earthquake",
    label: "地震",
    hazards: ["tsunami_flood", "landslide", "shaking", "collapse"],
    active: {
      ...noHazard,
      tsunami_flood: (w) => w.tsunami === "evacuate",
      landslide: (w) => w.quake !== null,
      shaking: (w) => w.quake !== null,
      collapse: (w) => w.quake !== null,
    },
    situations: ["outage", "water", "phone", "radio", "road", "shelter", "facility", "quake", "aftershock", "tsunami_warning"],
    // 透析施設の「浸水で休止」は河川の浸水の文なので差し込ませない（施設の休止は病院の休止の種類で起きる）
    injects: { banned: ["dialysis_flooded"], words: { road_blocked: "家の前の道が通れない（倒壊・落下物・土砂・段差）" } },
    worldKinds: { banned: ["weather"], only: { flood: "津波の浸水だけ（津波警報のあと、海に近い地区）" } },
    changes: [
      { id: "alert", kinds: ["alert"], words: "大雨の警戒レベル" },
      { id: "river_flood", kinds: ["flood"], words: "川の氾濫" },
      { id: "rain", kinds: ["weather"], when: (c) => c.kind === "weather" && c.state === "rain", words: "大雨" },
      { id: "tsunami_flood", kinds: ["town_flood"], when: (_c, w) => w.tsunami === "none", words: "津波警報の出ていない浸水" },
    ],
    words: [
      { id: "rain_word", re: RAIN_WORDS },
      { id: "flood_word", re: FLOOD_WORDS, when: (w) => w.tsunami === "none" },
    ],
    layers: ["tsunami", "landslide"],
  },
};

// ---------- 想定 → 災害の種類 ----------

/** 想定ごとの災害の種類（全部の想定を持つ）。scale は仮想（開始で決めた規模の災害、無ければ世界の出来事から） */
export const SCENARIO_FIT: Readonly<Record<DrillScenario, DrillKind | "scale">> = {
  heavy_rain: "heavy_rain",
  earthquake: "earthquake",
  // 10 分版は大雨の想定を寄せた物（scenarios.ts の condense）
  short: "heavy_rain",
  virtual: "scale",
};

/**
 * 訓練の災害の種類。仮想は規模の災害 → 世界の出来事（地震の震度・津波なら地震、警戒レベル・浸水・大雨なら大雨）→ 未決（null。両方を許す）
 */
export function fitKindOf(
  s: { scenario: DrillScenario; options?: { scale?: DrillScale | null } | null },
  world?: Partial<Pick<WorldState, "quake" | "tsunami" | "alertLevel" | "flood" | "weather">> | null,
): DrillKind | null {
  const k = SCENARIO_FIT[s.scenario];
  if (k !== "scale") return k;
  if (s.options?.scale) return s.options.scale.kind;
  if (world?.quake || (world?.tsunami && world.tsunami !== "none")) return "earthquake";
  if (world?.alertLevel || world?.flood || world?.weather === "rain") return "heavy_rain";
  return null;
}

/** 種類の表（未決なら null） */
export function profileOf(kind: DrillKind | null): FitProfile | null {
  return kind ? FIT_PROFILES[kind] : null;
}

// ---------- 合うか ----------

/** 世界の変化が想定に合わないなら決まりの id（「fit:alert」）。予定の出来事は中身で見る。未決の想定は全部合う */
export function changeMisfit(profile: FitProfile | null, c: WorldChange, w: FitWorld): string | null {
  if (!profile) return null;
  const change = c.kind === "schedule" && c.then.kind === "event" ? c.then.change : c;
  for (const b of profile.changes) {
    if (b.kinds.includes(change.kind) && (!b.when || b.when(change, w))) return `fit:${b.id}`;
  }
  return null;
}

/** 文が想定に合わないなら決まりの id（「fit:quake_word」） */
export function wordMisfit(profile: FitProfile | null, text: string, w: FitWorld): string | null {
  if (!profile || !text) return null;
  const t = text.normalize("NFKC");
  for (const b of profile.words) if (b.re.test(t) && (!b.when || b.when(w))) return `fit:${b.id}`;
  return null;
}

/** 差し込みの種類が想定で使えるか */
export function injectFits(profile: FitProfile | null, kind: InjectKind): boolean {
  return !profile || !profile.injects.banned.includes(kind);
}

/** 監督の指示に出す種類の中身（想定の言い換えがあればそれ） */
export function injectWords(profile: FitProfile | null, kind: InjectKind, words: string): string {
  return profile?.injects.words[kind] ?? words;
}

/** 世界の種類が想定で使えるか */
export function worldKindFits(profile: FitProfile | null, kind: WorldKind): boolean {
  return !profile || !profile.worldKinds.banned.includes(kind);
}

/** 台帳のハザード（区域）が想定に効くか（その他は分からないので出す） */
export function zoneFits(profile: FitProfile | null, zone: HazardKind): boolean {
  if (!profile) return true;
  const h = LEDGER_HAZARD[zone];
  return h === null || profile.hazards.includes(h);
}

/** 担当一覧のハザードの列に出す物（訓練の画面）。想定に効く区域だけ。未決なら全部 */
export function fitLedgerHazards<T extends { kind: HazardKind }>(profile: FitProfile | null, hazards: ReadonlyArray<T>): T[] {
  return hazards.filter((h) => zoneFits(profile, h.kind));
}

/** 区域（台帳のハザード）の出来事が今効いているか（想定に効くハザードで、条件が真） */
export function zoneActive(profile: FitProfile | null, zone: HazardKind, w: FitWorld): boolean {
  if (!profile) return false;
  const h = LEDGER_HAZARD[zone];
  if (!h || !profile.hazards.includes(h)) return false;
  return profile.active[h]?.(w) === true;
}

/** 区域の浸水が今その人（区域の一覧）に効くか（河川の浸水・津波の浸水） */
export function waterActive(profile: FitProfile | null, zones: ReadonlyArray<HazardKind>, w: FitWorld): boolean {
  return zones.some((z) => {
    const h = LEDGER_HAZARD[z];
    return h !== null && WATER_HAZARDS.includes(h) && zoneActive(profile, z, w);
  });
}

// ---------- 指示の文 ----------

/** 監督・世界に渡す想定の行（Claude に渡す文。町名・人を書かない） */
export function fitText(profile: FitProfile | null, opts: { with: "director" | "world" }): string {
  if (!profile) return "";
  const lines = [
    `この訓練の災害は${profile.label}。効くハザード: ${profile.hazards.map((h) => FIT_HAZARD_WORDS[h]).join("、")}`,
    `起きない事（この災害に合わない。出さない）: ${profile.changes.map((b) => b.words).join("、")}`,
  ];
  if (opts.with === "director") {
    if (profile.injects.banned.length > 0) lines.push(`差し込まない種類: ${profile.injects.banned.join("、")}`);
    for (const [k, w] of Object.entries(profile.injects.words)) lines.push(`${k} はこの災害では: ${w}`);
  }
  if (opts.with === "world") {
    if (profile.worldKinds.banned.length > 0) lines.push(`使わない種類: ${profile.worldKinds.banned.join("、")}`);
    for (const [k, w] of Object.entries(profile.worldKinds.only)) lines.push(`${k} は ${w}`);
  }
  return lines.join("\n");
}

// ---------- 評価の台 ----------

/** 想定ごとの「起きてはいけない物」の一覧（評価の台。表から作る） */
export type Forbidden = {
  kind: DrillKind;
  changes: ReadonlyArray<ChangeBan>;
  words: ReadonlyArray<WordBan>;
  injects: ReadonlyArray<InjectKind>;
  worldKinds: ReadonlyArray<WorldKind>;
};

export function forbiddenFor(kind: DrillKind): Forbidden {
  const p = FIT_PROFILES[kind];
  return { kind, changes: p.changes, words: p.words, injects: p.injects.banned, worldKinds: p.worldKinds.banned };
}
