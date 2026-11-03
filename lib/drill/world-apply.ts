// 仮想モード（docs/tasks/T50.md）の世界の 1 刻みの返事（world_step）の形と、出来事を人に当てる所。Claude を呼ばない。
//
// 世界の部屋（lib/drill/world-room.ts）も 1 回呼び（world-oneshot.ts）も同じ形（WorldStepSchema）で返す。ここで:
// - 知らない種類・地区・仮名・道・避難所・施設は捨てる。出来事は 1 刻みに 4 つまで
// - 地区の別名（甲地区）→ 台帳の町名 → そこに住む本人、本人の仮名（A さん）→ 本人 → 町、をコードが引く（部屋は町を知らない）
// - 人の体の状態・生き死には出来事に無い（種類に無い）。世界の 1 文と結末の 1 文に禁じる語があれば捨てる
// - 結末（farewells）は、この刻みにコードが「条件に達した」と決めた人（lib/drill/outcome.ts）の分だけ受ける。
//   使えなければ固定の文。部屋が勝手に人の結末を足す道は無い

import * as z from "zod";
import type { ClockCategory, DependsOn } from "../db/types.ts";
import { findLeaks, restoreText, type PseudonymKey } from "../pseudonym/index.ts";
import { aliasOfTown, AREA_ROADS, AREA_TOWNS, facilityOf, roadOf, restoreTowns, shelterOf, townOfAlias } from "./area.ts";
import { personOfAlias } from "./director.ts";
import type { DrillIncident } from "./engine.ts";
import { PHONE_LABELS, SHELTER_LABELS } from "./labels.ts";
import type { PhoneState, ShelterState, Weather, WorldChange, WorldVia } from "./scenarios.ts";

// ---------- 返事の形 ----------

/** 世界の出来事の種類（部屋が選ぶ英字） */
export const WORLD_KINDS = ["flood", "landslide", "road", "outage", "water", "phone", "shelter", "facility", "aftershock", "weather"] as const;
export type WorldKind = (typeof WORLD_KINDS)[number];

/** 種類の言い方（日本語で返ったときも受ける） */
const KIND_ALIASES: Readonly<Record<string, WorldKind>> = {
  浸水: "flood",
  洪水: "flood",
  土砂: "landslide",
  土砂崩れ: "landslide",
  道路: "road",
  停電: "outage",
  断水: "water",
  通信: "phone",
  電話: "phone",
  避難所: "shelter",
  施設: "facility",
  余震: "aftershock",
  地震: "aftershock",
  天候: "weather",
  天気: "weather",
};

/**
 * 1 刻みの世界。文字の欄は空文字で「無し」（構造化出力で省ける欄を作らない。enum にすると外の値 1 つで全部が形の違いになる）。
 * 種類・地区・値の範囲はコード（worldIncidents）で絞る
 */
export const WorldStepSchema = z.object({
  narration: z.string(),
  events: z.array(
    z.object({
      kind: z.string(),
      town: z.string(),
      target: z.string(),
      name: z.string(),
      value: z.string(),
    }),
  ),
  farewells: z.array(z.object({ target: z.string(), text: z.string() })),
});
export type WorldStep = z.output<typeof WorldStepSchema>;

/** 1 刻みの出来事の上限 */
export const WORLD_EVENTS_MAX = 4;
/** 世界の 1 文・結末の 1 文の長さ（字） */
export const NARRATION_MAX = 60;
export const FAREWELL_MAX = 60;

/** 世界の文・結末の文に書かせない語（人の生き死にを言い切る物）。あれば捨てて固定の文に */
export const FORBIDDEN_WORDS = /死亡|亡くな|死ん|関連死|遺体|息を引き取|心肺停止|診断|判定|重症/;

// ---------- 人の側の事実（コードだけが持つ） ----------

/** 本人ごとの、出来事を当てるのに要る事実。部屋には渡さない */
export type PersonFacts = {
  /** 台帳の町名（地理の町。無ければ null） */
  town: string | null;
  /** 時計の頼り先（透析施設・配達…） */
  depends: ReadonlyArray<DependsOn>;
  /** 時計の区分（透析・経管栄養…） */
  categories: ReadonlyArray<ClockCategory>;
  /** 訪問看護の連絡先がある */
  nurse: boolean;
};

export type ApplyContext = {
  /** 仮名の鍵（参加者の並びで A さん・B さん…）。サーバーの中だけ */
  key: PseudonymKey;
  /** 参加者 → 事実 */
  facts: ReadonlyMap<string, PersonFacts>;
  /** 結末の人（もう出来事を当てない） */
  ended: ReadonlySet<string>;
  hour: number;
  via: WorldVia;
};

// ---------- 値を読む ----------

function kindOf(raw: string): WorldKind | null {
  const v = raw.trim();
  const lower = v.toLowerCase();
  return (WORLD_KINDS as readonly string[]).includes(lower) ? (lower as WorldKind) : (KIND_ALIASES[v] ?? null);
}

/** 地区の欄（「甲地区・乙地区」「甲、乙」）→ 町名の一覧。知らない別名は捨てる */
function townsOf(raw: string): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[・、,，\s/]+/u)) {
    const t = townOfAlias(part);
    if (t) out.add(t);
  }
  return [...out];
}

const OPEN_WORDS = /^(open|opened|開通|通行可|再開|稼働|開設|restored|復旧|解消|ok|通常)$/i;
const CLOSE_WORDS = /^(closed?|通行止め?|止|休止|閉鎖|out|start|started|始まり|発生|停止|down|不通)$/i;

function openOf(raw: string): boolean | null {
  const v = raw.trim();
  if (OPEN_WORDS.test(v)) return true;
  if (CLOSE_WORDS.test(v)) return false;
  return null;
}

function phoneStateOf(raw: string): PhoneState | null {
  const v = raw.trim().toLowerCase();
  if (v === "ok" || v === "通常") return "ok";
  if (v === "busy" || v === "不安定" || v === "混雑") return "busy";
  if (v === "down" || v === "不通") return "down";
  return null;
}

function shelterStateOf(raw: string): ShelterState | null {
  const v = raw.trim().toLowerCase();
  const map: Record<string, ShelterState> = { open: "open", 開設: "open", crowded: "crowded", 混雑: "crowded", full: "full", 満員: "full", closed: "closed", 閉鎖: "closed" };
  return map[v] ?? null;
}

function weatherOf(raw: string): Weather | null {
  const v = raw.trim().toLowerCase();
  if (v === "rain" || v === "大雨" || v === "雨") return "rain";
  if (v === "clear" || v === "止む" || v === "やむ" || v === "晴れ") return "clear";
  return null;
}

/** 震度（「4」「5弱」「震度 5強」）。1〜7 だけ */
function intensityOf(raw: string): string | null {
  const m = raw.replace(/震度|\s/g, "").match(/^([1-7])(弱|強)?$/u);
  return m ? `${m[1]}${m[2] ?? ""}` : null;
}

/** 浸水の深さ（m）。0 より大きく 10 以下 */
function depthOf(raw: string): number | null {
  const n = Number(raw.replace(/[mｍメートル\s]/gu, ""));
  return Number.isFinite(n) && n > 0 && n <= 10 ? Math.round(n * 10) / 10 : null;
}

// ---------- 出来事 → 世界の変化 ----------

type Built = { change: WorldChange; text: string; person?: string };

const residents = (ctx: ApplyContext, towns: ReadonlyArray<string>) =>
  [...ctx.facts].filter(([p, f]) => !ctx.ended.has(p) && f.town !== null && towns.includes(f.town)).map(([p]) => p);

/** 本人の仮名 → その人の町（人から町を引く。部屋は町を知らない） */
function townOfTarget(raw: string, ctx: ApplyContext): string | null {
  if (!raw.trim()) return null;
  const p = personOfAlias(raw, ctx.key);
  return p ? (ctx.facts.get(p)?.town ?? null) : null;
}

/** 地区の欄と仮名の欄から町の一覧 */
function placeOf(e: WorldStep["events"][number], ctx: ApplyContext): string[] {
  const towns = townsOf(e.town);
  const t = townOfTarget(e.target, ctx);
  if (t && !towns.includes(t)) towns.push(t);
  return towns;
}

const townWords = (towns: ReadonlyArray<string>) => towns.join("・");

/** 頼り先の施設の休止で時計が揺らぐ人（透析施設は透析の時計の人も） */
function dependents(ctx: ApplyContext, depends: DependsOn | null): string[] {
  if (!depends) return [];
  return [...ctx.facts]
    .filter(([p, f]) => !ctx.ended.has(p) && (f.depends.includes(depends) || (depends === "dialysis_center" && f.categories.includes("dialysis"))))
    .map(([p]) => p);
}

function buildEvent(e: WorldStep["events"][number], ctx: ApplyContext): Built[] {
  const kind = kindOf(e.kind);
  if (!kind) return [];
  switch (kind) {
    case "flood":
    case "landslide": {
      const towns = placeOf(e, ctx);
      if (towns.length === 0) return [];
      return towns.map((town): Built => {
        const persons = residents(ctx, [town]);
        if (kind === "landslide") return { change: { kind: "landslide", town, persons }, text: `${town} 土砂崩れ` };
        const depthM = depthOf(e.value) ?? AREA_TOWNS.find((t) => t.town === town)?.floodM ?? null;
        return { change: { kind: "town_flood", town, depthM, persons }, text: `${town} 浸水${depthM != null ? ` ${depthM} m` : ""}` };
      });
    }
    case "road": {
      const open = openOf(e.value) ?? false;
      const road = roadOf(e.name);
      if (road) {
        const persons = residents(ctx, road.towns);
        return [{ change: { kind: "town_road", road: road.id, label: road.name, open, persons }, text: `${road.name} ${open ? "通行可" : "通行止"}` }];
      }
      const towns = placeOf(e, ctx);
      return towns.map((town): Built => {
        const persons = residents(ctx, [town]);
        const label = `${town}の道`;
        return { change: { kind: "town_road", road: `town-${aliasOfTown(town) ?? town}`, label, open, persons }, text: `${label} ${open ? "通行可" : "通行止"}` };
      });
    }
    case "outage": {
      const open = openOf(e.value);
      if (open === true) return [{ change: { kind: "outage_restored" }, text: "停電 復旧" }];
      const towns = placeOf(e, ctx);
      if (towns.length === 0) return [];
      return [{ change: { kind: "outage", area: { scope: "towns", towns, since: Object.fromEntries(towns.map((t) => [t, ctx.hour])) } }, text: `${townWords(towns)} 停電` }];
    }
    case "water": {
      const towns = placeOf(e, ctx);
      if (towns.length === 0) return [];
      const out = openOf(e.value) !== true;
      return [{ change: { kind: "town_water", towns, out, persons: residents(ctx, towns) }, text: `${townWords(towns)} ${out ? "断水" : "断水 解消"}` }];
    }
    case "phone": {
      const state = phoneStateOf(e.value);
      if (!state) return [];
      const towns = placeOf(e, ctx);
      if (towns.length > 0 && state === "down") {
        return [{ change: { kind: "town_line", towns, persons: residents(ctx, towns) }, text: `${townWords(towns)} 電話 不通` }];
      }
      return [{ change: { kind: "phone", state }, text: `電話 ${PHONE_LABELS[state]}` }];
    }
    case "shelter": {
      const s = shelterOf(e.name);
      const state = shelterStateOf(e.value);
      if (!s || !state) return [];
      return [{ change: { kind: "shelter", id: `sh-${s.id}`, label: s.name, state }, text: `${s.name} ${SHELTER_LABELS[state]}` }];
    }
    case "facility": {
      const f = facilityOf(e.name);
      const open = openOf(e.value);
      if (!f || open === null) return [];
      const out: Built[] = [
        {
          change: { kind: "town_facility", facility: f.id, label: f.name, open, depends: f.depends, persons: dependents(ctx, f.depends) },
          text: `${f.name} ${open ? "再開" : "休止"}`,
        },
      ];
      // 訪問看護の休止は、訪問看護を使う人の「訪問不可」の印（今の差し込みと同じ印）
      if (f.id === "nurse" && !open) {
        for (const [p, x] of ctx.facts) if (x.nurse && !ctx.ended.has(p)) out.push({ change: { kind: "nurse_away" }, text: "訪問看護が来られない", person: p });
      }
      return out;
    }
    case "aftershock": {
      const intensity = intensityOf(e.value);
      return intensity ? [{ change: { kind: "quake", intensity }, text: `余震 震度 ${intensity}` }] : [];
    }
    case "weather": {
      const state = weatherOf(e.value);
      return state ? [{ change: { kind: "weather", state }, text: state === "rain" ? "大雨" : "雨が止む" }] : [];
    }
  }
}

/** 世界の 1 文を画面の文に。禁じる語・元の情報（氏名・電話）が残る物・空は捨てる */
export function cleanNarration(raw: string, key: PseudonymKey): { room: string; text: string } | null {
  const room = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, NARRATION_MAX).join("");
  if (!room || FORBIDDEN_WORDS.test(room) || findLeaks(room, key).length > 0) return null;
  return { room, text: restoreTowns(restoreText(room, key)) };
}

/** 結末の固定の文（部屋の文が使えないとき）。name は氏名（画面の文。サーバーの中だけ） */
export const farewellFixed = (name: string) => `${name}さんには、この時間までに助けが届きませんでした`;

/** 結末の 1 文を検査する。禁じる語・漏れ・空なら null（固定の文にする） */
export function cleanFarewell(raw: string, key: PseudonymKey): string | null {
  const t = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, FAREWELL_MAX).join("");
  if (!t || FORBIDDEN_WORDS.test(t) || findLeaks(t, key).length > 0) return null;
  return restoreTowns(restoreText(t, key));
}

/** この刻みにコードが決めた結末 1 人（lib/drill/outcome.ts） */
export type OutcomeAsk = {
  person: string;
  /** 切れた時計の名前（「酸素の電池 2 時間」） */
  label: string;
  /** 固定の文（氏名入り） */
  fixed: string;
};

/**
 * 返事を状況にする。世界の 1 文（narration）・出来事（4 つまで）・結末（頼んだ人の分だけ）。
 * 結末の文は部屋の物が使えればそれ（AI の印）、使えなければ固定の文（AI の印なし）
 */
export function worldIncidents(answer: WorldStep, ctx: ApplyContext, outcomes: ReadonlyArray<OutcomeAsk> = []): DrillIncident[] {
  const base = { actor: "director" as const, at: ctx.hour };
  const out: DrillIncident[] = [];
  const n = cleanNarration(answer.narration, ctx.key);
  if (n) out.push({ ...base, change: { kind: "narration", room: n.room, via: ctx.via }, text: n.text, ai: true });
  let used = 0;
  for (const e of answer.events) {
    if (used >= WORLD_EVENTS_MAX) break;
    const built = buildEvent(e, ctx);
    if (built.length === 0) continue;
    used += 1;
    for (const b of built) out.push({ ...base, change: b.change, text: b.text, ...(b.person ? { person: b.person } : {}), ai: true });
  }
  for (const o of outcomes) {
    const said = answer.farewells.find((f) => personOfAlias(f.target, ctx.key) === o.person);
    const text = said ? cleanFarewell(said.text, ctx.key) : null;
    out.push({ ...base, change: { kind: "outcome", label: o.label }, text: text ?? o.fixed, person: o.person, ai: text !== null });
  }
  return out;
}

/** 部屋も 1 回呼びも使えなかった刻み: 結末は固定の文、世界は動かさない（記録に「世界 代替」の印） */
export function fallbackIncidents(hour: number, outcomes: ReadonlyArray<OutcomeAsk>, state: "down" | "off"): DrillIncident[] {
  const base = { actor: "director" as const, at: hour };
  return [
    { ...base, change: { kind: "world_note", state }, text: state === "off" ? "世界 停止" : "世界 代替", ai: false },
    ...outcomes.map((o): DrillIncident => ({ ...base, change: { kind: "outcome", label: o.label }, text: o.fixed, person: o.person, ai: false })),
  ];
}

/** 部屋に見せる道・地区の名前の確かめ用（テストと指示の文） */
export const ROAD_NAMES = AREA_ROADS.map((r) => r.name);
