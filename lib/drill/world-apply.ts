// 仮想モード（docs/tasks/T50.md）の世界の 1 刻みの返事（world_step）の形と、出来事を人に当てる所。Claude を呼ばない。
//
// 世界の部屋（lib/drill/world-room.ts）も 1 回呼び（world-oneshot.ts）も同じ形（WorldStepSchema）で返す。ここで:
// - 知らない種類・地区・仮名・道・避難所・施設は捨てる。出来事は 1 刻みに 4 つまで
// - 地区の別名（甲地区）→ 台帳の町名 → そこに住む本人、本人の仮名（A さん）→ 本人 → 町、をコードが引く（部屋は町を知らない）
// - 人の体の状態・生き死には出来事に無い（種類に無い）。世界の 1 文と結末の 1 文に禁じる語があれば捨てる
// - 結末（farewells）は世界（部屋・1 回呼び）が決める（T53。訓練の仮想モードの架空の人だけ）。コードは守りだけ:
//   知らない仮名・参加者でない人・もう結末の人・同じ刻みの 2 回目は捨て、1 刻み FAREWELL_PER_TICK_MAX 人まで。
//   文に禁じる語・漏れがあれば固定の文、理由に禁じる語・医療の語・漏れがあれば理由なし。結末の行はいつも AI の印（決めたのが AI）。
//   時計の計算（lib/drill/outcome.ts）は世界へのヒントと講評の数で、ここでは結末を決めない

import * as z from "zod";
import type { ClockCategory, DependsOn } from "../db/types.ts";
import { maskReply, restoreText, type PseudonymKey } from "../pseudonym/index.ts";
import { aliasOfTown, AREA_ROADS, DEMO_AREA, facilityOf, roadOf, restoreTowns, shelterOf, townOfAlias, type Area } from "./area.ts";
import { personOfAlias } from "./director.ts";
import type { DrillIncident } from "./engine.ts";
import { afterOf, EVENT_CATALOG, vendorText } from "./event-catalog.ts";
import { PHONE_LABELS, SHELTER_LABELS } from "./labels.ts";
import type { PhoneState, ShelterState, Weather, WorldChange, WorldVia } from "./scenarios.ts";

// ---------- 返事の形 ----------

/**
 * 世界の出来事の種類（部屋が選ぶ英字）。T92 で福祉避難所・給水所・薬局・介護事業所・業者の巡回・情報の混乱を足した
 * （世界の変化は監督の出来事の表 lib/drill/event-catalog.ts と同じ形。返事の欄は増やさない）
 */
export const WORLD_KINDS = [
  "flood",
  "landslide",
  "road",
  "outage",
  "water",
  "phone",
  "shelter",
  "facility",
  "aftershock",
  "weather",
  "welfare_shelter",
  "water_station",
  "pharmacy",
  "helper",
  "vendor",
  "info",
] as const;
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
  福祉避難所: "welfare_shelter",
  給水所: "water_station",
  給水: "water_station",
  薬局: "pharmacy",
  介護事業所: "helper",
  介護: "helper",
  業者: "vendor",
  巡回: "vendor",
  情報: "info",
  情報混乱: "info",
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
  farewells: z.array(z.object({ target: z.string(), text: z.string(), reason: z.string() })),
});
export type WorldStep = z.output<typeof WorldStepSchema>;

/** 1 刻みの出来事の上限 */
export const WORLD_EVENTS_MAX = 4;
/** 世界の 1 文・結末の 1 文の長さ（字） */
export const NARRATION_MAX = 60;
export const FAREWELL_MAX = 60;
/** 結末の理由（世界の事実）の長さ（字） */
export const FAREWELL_REASON_MAX = 80;
/** 1 刻みに結末を迎える人の上限 */
export const FAREWELL_PER_TICK_MAX = 2;

/** 世界の文・結末の文に書かせない語（人の生き死にを言い切る物）。あれば捨てて固定の文に */
export const FORBIDDEN_WORDS = /死亡|亡くな|死ん|関連死|遺体|息を引き取|心肺停止|診断|判定|重症/;

/**
 * 結末の理由に書かせない医療の語（病名・状態・薬の量・医療の助言）。理由は街と物の事実だけ（「停電が 6 時間続き、電池が切れた」）。
 * あれば理由を出さない（結末の 1 文は残す）
 */
export const REASON_MEDICAL_WORDS =
  /病名|症状|容体|容態|急変|悪化|発作|意識|呼吸|低血糖|高血糖|脱水|熱中症|低体温|肺炎|感染|血栓|塞栓|心停止|投与|処方|用量|服用|服薬|増量|減量|mg|ミリグラム|錠|受診|注射|点滴|血糖値|血圧|安静/i;

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
  /** 介護事業所の連絡先がある（T92 の helper。無ければ無い物として読む） */
  helper?: boolean;
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
  /** 事業所の地理（T70、lib/drill/area.ts の areaOf）。無ければデモ事業所の架空の街 */
  area?: Area;
  /**
   * 結末を当てるか（T70 の続き）。false（デモ以外の事業所）なら、返ってきた結末（farewells）は全部捨てる。
   * 実在の人の仮名に結末を付けないため。無ければ当てる（デモ事業所）
   */
  endings?: boolean;
  /**
   * 業者の巡回（届く物）を当ててよいか（T130、lib/drill/person-facts.ts の supplyAllowed: その人への手か計画の業者の約束）。
   * 無ければ前と同じ（当てる）
   */
  supplyOk?: (person: string) => boolean;
};

// ---------- 値を読む ----------

function kindOf(raw: string): WorldKind | null {
  const v = raw.trim();
  const lower = v.toLowerCase();
  return (WORLD_KINDS as readonly string[]).includes(lower) ? (lower as WorldKind) : (KIND_ALIASES[v] ?? null);
}

/** 地区の欄（「甲地区・乙地区」「甲、乙」）→ 町名の一覧。知らない別名は捨てる */
function townsOf(raw: string, area: Area): string[] {
  const out = new Set<string>();
  for (const part of raw.split(/[・、,，\s/]+/u)) {
    const t = townOfAlias(part, area);
    if (t) out.add(t);
  }
  return [...out];
}

const OPEN_WORDS = /^(open|opened|開通|通行可|再開|稼働|開設|restored|復旧|解消|ok|通常)$/i;
const CLOSE_WORDS = /^(closed?|通行止め?|止|休止|閉鎖|out|start|started|始まり|発生|停止|down|不通|通話不可)$/i;

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
  if (v === "down" || v === "不通" || v === "通話不可") return "down";
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
  const towns = townsOf(e.town, ctx.area ?? DEMO_AREA);
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
  const area = ctx.area ?? DEMO_AREA;
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
        const depthM = depthOf(e.value) ?? area.towns.find((t) => t.town === town)?.floodM ?? null;
        return { change: { kind: "town_flood", town, depthM, persons }, text: `${town} 浸水${depthM != null ? ` ${depthM} m` : ""}` };
      });
    }
    case "road": {
      const open = openOf(e.value) ?? false;
      const road = roadOf(e.name, area);
      if (road) {
        const persons = residents(ctx, road.towns);
        // 道の名前は部屋に見せる別名のまま世界に持ち（今の街の文に使う）、画面の文だけ町名に戻す（台帳から作った地理の「甲地区の道」）
        return [
          {
            change: { kind: "town_road", road: road.id, label: road.name, open, persons },
            text: restoreTowns(`${road.name} ${open ? "通行可" : "通行止"}`, area),
          },
        ];
      }
      const towns = placeOf(e, ctx);
      return towns.map((town): Built => {
        const persons = residents(ctx, [town]);
        const label = `${town}の道`;
        return { change: { kind: "town_road", road: `town-${aliasOfTown(town, area) ?? town}`, label, open, persons }, text: `${label} ${open ? "通行可" : "通行止"}` };
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
        return [{ change: { kind: "town_line", towns, persons: residents(ctx, towns) }, text: `${townWords(towns)} 電話 ${PHONE_LABELS.down}` }];
      }
      return [{ change: { kind: "phone", state }, text: `電話 ${PHONE_LABELS[state]}` }];
    }
    case "shelter": {
      const s = shelterOf(e.name, area);
      const state = shelterStateOf(e.value);
      if (!s || !state) return [];
      return [{ change: { kind: "shelter", id: `sh-${s.id}`, label: s.name, state }, text: `${s.name} ${SHELTER_LABELS[state]}` }];
    }
    case "facility": {
      const f = facilityOf(e.name, area);
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
    // ---------- T92（出来事の表と同じ形の変化） ----------
    case "welfare_shelter": {
      // 名前が無ければ地理の福祉避難所。福祉避難所でない避難所は捨てる。値が無ければ開設
      const s = (e.name.trim() ? shelterOf(e.name, area) : area.shelters.find((x) => x.welfare)) ?? null;
      const state = e.value.trim() ? shelterStateOf(e.value) : "open";
      if (!s || !s.welfare || !state) return [];
      return [{ change: { kind: "shelter", id: `sh-${s.id}`, label: s.name, state }, text: `${s.name} ${SHELTER_LABELS[state]}` }];
    }
    case "water_station": {
      // 給水所（世界の様子は変えない。断水の印は消さない）
      const towns = placeOf(e, ctx);
      return [{ change: { kind: "note", topic: "water_station" }, text: towns.length > 0 ? `${townWords(towns)} 給水所 開設` : "給水所 開設" }];
    }
    case "pharmacy": {
      // 地理の薬局（AREA_FACILITIES の pharmacy）だけ。休止で頼る人の時計の頼り先が未確認（施設の休止と同じ道）
      const f = area.facilities.find((x) => x.id === "pharmacy");
      const open = e.value.trim() ? openOf(e.value) : false;
      if (!f || open === null) return [];
      return [
        {
          change: { kind: "town_facility", facility: f.id, label: f.name, open, depends: f.depends, persons: dependents(ctx, f.depends) },
          text: `${f.name} ${open ? "再開" : "休止"}`,
        },
      ];
    }
    case "helper": {
      // 介護事業所の休止だけ（介護事業所を使う人に「介護休止」の印）。再開は受けない
      const open = e.value.trim() ? openOf(e.value) : false;
      if (open !== false) return [];
      return [...ctx.facts]
        .filter(([p, f]) => f.helper === true && !ctx.ended.has(p))
        .map(([p]): Built => ({ change: { kind: "mark", mark: "helperAway" }, text: "介護事業所 休止", person: p }));
    }
    case "vendor": {
      // 酸素業者の巡回: target の人（酸素・呼吸器の時計のある人）に、value 時間後に業者が着く（着いたら settleWorld が酸素を届いた物に）
      const p = e.target.trim() ? personOfAlias(e.target, ctx.key) : null;
      const f = p ? ctx.facts.get(p) : undefined;
      if (!p || !f || ctx.ended.has(p) || !(f.categories.includes("oxygen") || f.categories.includes("ventilator"))) return [];
      // 手も計画も無い人に、業者が自然に来て酸素・電池が届く形にしない（T130。評価の 3 回目の審査役の根拠）
      if (ctx.supplyOk && !ctx.supplyOk(p)) return [];
      const raw = e.value.replace(/[^\d.]/g, "");
      const after = afterOf(EVENT_CATALOG.vendor_round, raw ? Number(raw) : undefined);
      if (after == null) return [];
      // 呼吸器だけの人は医療機器の業者で、届くのは電源（予備の電池。T123）
      const oxygen = f.categories.includes("oxygen");
      return [
        {
          change: {
            kind: "schedule",
            at: Math.round((ctx.hour + after) * 60),
            by: "world",
            then: { kind: "arrival", role: "vendor", ...(oxygen ? {} : { supply: "power" as const }) },
          },
          text: vendorText(oxygen, after),
          person: p,
        },
      ];
    }
    case "info":
      return [{ change: { kind: "note", topic: "info_confusion" }, text: "避難の情報が食い違っている" }];
  }
}

/**
 * 世界の 1 文を画面の文に。禁じる語・元の情報（台帳の氏名・電話）が残る物・空は捨てる。
 * 作った名前・住所の形は捨てずに伏せ字に（T74 の続き。room も伏せ字のまま部屋の記録に戻す）
 */
export function cleanNarration(raw: string, key: PseudonymKey, area: Area = DEMO_AREA): { room: string; text: string } | null {
  const cut = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, NARRATION_MAX).join("");
  if (!cut || FORBIDDEN_WORDS.test(cut)) return null;
  const room = maskReply(cut, key);
  if (!room) return null;
  return { room, text: restoreTowns(restoreText(room, key), area) };
}

/** 結末の固定の文（世界の 1 文に禁じる語・漏れがあるとき）。name は氏名（画面の文。サーバーの中だけ） */
export const farewellFixed = (name: string) => `${name}さんには、この時間までに助けが届きませんでした`;

/** 結末の 1 文を検査する。禁じる語・漏れ（台帳の氏名・電話）・空なら null（固定の文にする）。作った名前・住所の形は伏せ字に */
export function cleanFarewell(raw: string, key: PseudonymKey, area: Area = DEMO_AREA): string | null {
  const t = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, FAREWELL_MAX).join("");
  if (!t || FORBIDDEN_WORDS.test(t)) return null;
  const masked = maskReply(t, key);
  return masked ? restoreTowns(restoreText(masked, key), area) : null;
}

/** 結末の理由（世界の事実）を検査する。禁じる語・医療の語・漏れ（台帳の氏名・電話）・空なら null（理由なし）。作った名前・住所の形は伏せ字に */
export function cleanReason(raw: string, key: PseudonymKey, area: Area = DEMO_AREA): string | null {
  const t = Array.from(raw.replace(/\s+/g, " ").trim()).slice(0, FAREWELL_REASON_MAX).join("");
  if (!t || FORBIDDEN_WORDS.test(t) || REASON_MEDICAL_WORDS.test(t.normalize("NFKC"))) return null;
  const masked = maskReply(t, key);
  return masked ? restoreTowns(restoreText(masked, key), area) : null;
}

/**
 * 時計の計算（lib/drill/outcome.ts）で、この刻みまでに条件に達した人（まだ結末でない人）。世界へのヒント（「時計の目安」）で、
 * 結末は決めない。世界がこの人に結末を決めたときは、結末の行の label（切れた時計の名前）にも使う
 */
export type OutcomeAsk = {
  person: string;
  /** 切れた時計の名前（「酸素の電池 2時間を超過」） */
  label: string;
};

/** 世界が決めた結末を状況にする（守りはファイルの頭の注）。hints は時計の計算で条件に達した人（label を引くだけ） */
export function farewellIncidents(farewells: WorldStep["farewells"], ctx: ApplyContext, hints: ReadonlyArray<OutcomeAsk> = []): DrillIncident[] {
  const out: DrillIncident[] = [];
  if (ctx.endings === false) return out;
  for (const f of farewells) {
    if (out.length >= FAREWELL_PER_TICK_MAX) break;
    const person = personOfAlias(f.target, ctx.key);
    if (!person || !ctx.facts.has(person) || ctx.ended.has(person) || out.some((e) => e.person === person)) continue;
    const name = ctx.key.people.find((p) => p.personId === person)?.name ?? "";
    const text = cleanFarewell(f.text, ctx.key, ctx.area) ?? farewellFixed(name);
    const reason = cleanReason(f.reason, ctx.key, ctx.area);
    const label = hints.find((h) => h.person === person)?.label ?? "";
    out.push({ actor: "director", at: ctx.hour, change: { kind: "outcome", label, reason }, text, person, ai: true });
  }
  return out;
}

/**
 * 返事を状況にする。世界の 1 文（narration）・出来事（4 つまで）・結末（世界が決めた人。1 刻み 2 人まで、いつも AI の印）。
 * hints は時計の計算で条件に達した人（結末の label に使うだけ。結末は決めない）
 */
export function worldIncidents(answer: WorldStep, ctx: ApplyContext, hints: ReadonlyArray<OutcomeAsk> = []): DrillIncident[] {
  const base = { actor: "director" as const, at: ctx.hour };
  const out: DrillIncident[] = [];
  const n = cleanNarration(answer.narration, ctx.key, ctx.area);
  if (n) out.push({ ...base, change: { kind: "narration", room: n.room, via: ctx.via }, text: n.text, ai: true });
  let used = 0;
  for (const e of answer.events) {
    if (used >= WORLD_EVENTS_MAX) break;
    const built = buildEvent(e, ctx);
    if (built.length === 0) continue;
    used += 1;
    for (const b of built) out.push({ ...base, change: b.change, text: b.text, ...(b.person ? { person: b.person } : {}), ai: true });
  }
  return ctx.endings === false ? out : [...out, ...farewellIncidents(answer.farewells, ctx, hints)];
}

/**
 * 部屋も 1 回呼びも使えなかった刻み: 世界は動かさず、結末も出さない（コードで代わりに決めない。T53）。
 * 記録に「世界 代替」（落ちた）か「世界 停止」（鍵なし・DRILL_WORLD=off）の印
 */
export function fallbackIncidents(hour: number, state: "down" | "off"): DrillIncident[] {
  return [{ actor: "director", at: hour, change: { kind: "world_note", state }, text: state === "off" ? "停止" : "代替", ai: false }];
}

/** 部屋に見せる道・地区の名前の確かめ用（テストと指示の文） */
export const ROAD_NAMES = AREA_ROADS.map((r) => r.name);
