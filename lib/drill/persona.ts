// 訓練の本人役（ペルソナ、docs/tasks/T18.md）。利用者 1 人に Haiku 1 体。刻みごとに「する事・言う事・ケアマネに連絡するか・赤を押すか」を
// 決まった JSON で返させ、ケアマネに届く物だけを安否（DrillTurn）にする。本人 1 人ずつ呼ぶ（engine が Promise.all で並べる）。
//
// 守ること:
// - Claude に渡すのは lib/pseudonym を通した物だけ。本人役の説明も刻みの文も pseudonymizeText で伏せ、印を付けてから入力に入れる
//   （氏名・カナ・生年月日・住所・電話・町名を渡さない。本人は「A さん」、周りの人は役割名「娘」「支援者 1」）
// - 色と順位を Haiku に出させない。Haiku が選ぶのは「赤か緑を押すか」と 4 問の答え（人がボタンを押すのと同じ）だけで、
//   色と順位は安否を lib/triage の表に流して決まる
// - 想定の表（lib/drill/scenarios.ts）の行がある刻みは、表が骨: 誰から・赤か緑か・4 問・どこに は表のまま、言う事とする事だけ Haiku の言葉
//   （審査員の回でも形は同じで言葉だけ変わる）。表の行が無い刻みだけ、Haiku が連絡するかを決める
// - スマホで赤緑を押せるのは、本人なら台帳の連絡手段が「使える」の人、家族・支援者ならスマホのある人だけ（表の行が無い刻み）
// - 失敗（鍵なし・上限・断られた・形の違い・呼び出しの失敗・伏せきれない・台帳を読めない）は、想定の表の行があれば表の固定の安否
//   （ai: false、AI の印なし）、無ければ「連絡なし」（空の配列）
// - 通話（T20）の相手も同じ本人役で答える。出る・出ない・背景の音だけは先に表の割合で決め、Haiku は言葉だけ（personaCallReply）
// - 本人役の元の記録（種の 10 人、seed/people.ts の台帳）は作った例で、実在の利用者の記録ではない。画面では人の名前のそばに
//   「架空」の印（AI が演じる架空の人。components/drill/Fictional.tsx、T48）

import type { D1Database } from "@cloudflare/workers-types";
import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { CATALOG_WORDS, effectiveKind } from "./action-catalog.ts";
import {
  ASK_MEANINGS,
  asksOf,
  CONDITION_BANNED,
  SPEECH_DANGER,
  TALK_ASK_WORDS,
  TALK_ASKS_MAX,
  talkRounds,
  VISIT_ASKS_MAX,
  VISIT_CONDITION_MAX,
  type TalkLine,
  type VisitReport,
} from "./dialogue.ts";
import { WORLD_REPLY_TEXTS } from "./world-reply.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import { parseLedger } from "../db/ledger.ts";
import {
  ABILITIES,
  DEVICE_KINDS,
  HAZARD_KINDS,
  MEDICATION_CATEGORIES,
  WHERE_NOW,
  type Ability,
  type ContactRow,
  type DrillAction,
  type HazardKind,
  type PersonRow,
  type SignalColor,
  type WhereNow,
} from "../db/types.ts";
import {
  ABILITY_ITEM_LABELS,
  ABILITY_LABELS,
  CARE_LEVEL_LABELS,
  CLOCK_START_LABELS,
  CLOCK_UNIT_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_REACH_LABELS,
  DEVICE_LABELS,
  HAZARD_LABELS,
  HOUSEHOLD_LABELS,
  MEDICATION_CATEGORY_LABELS,
  SEX_LABELS,
  STRUCTURE_LABELS,
} from "../labels.ts";
import {
  contactRoles,
  maskReply,
  pseudonymize,
  PseudonymLeakError,
  pseudonymizeText,
  restorePlaces,
  type ClaudePerson,
  type ForClaude,
  type Place,
  type PseudonymInput,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import { officePlaces } from "./area.ts";
import { extraWorldWords } from "./event-catalog.ts";
import type { ActionRecord, DrillIncident, DrillTurn, HeardSignal, PersonaHook, PersonaInput, PersonState, StopLog } from "./engine.ts";
import { CALL_STATUS_TEXTS, clockLabel, PHONE_LABELS, SHELTER_LABELS, TSUNAMI_LABELS, WATER_LABELS } from "./labels.ts";
import { nightLine } from "./night.ts";
import { ASK_KINDS, eventHour, type AskKind, type FixedTurn, type OutageArea, type PhoneState, type WorldState } from "./scenarios.ts";

// ---------- 本人役 ----------

/** ケアマネに連絡しうる人。赤緑を押せるかは台帳の連絡手段（本人）とスマホの有無（家族・支援者）で決まる */
export type Reporter = {
  /** 呼び方（本人・娘・夫・支援者 1・民生委員）。lib/pseudonym の役割名と同じ */
  role: string;
  source: FixedTurn["source"];
  /** スマホで赤緑を押せる */
  canPress: boolean;
};

export type Persona = {
  personId: string;
  /** 元に戻す鍵（Claude に渡さない）。言葉の漏れの確かめに使う */
  key: PseudonymKey;
  /** 本人役の説明（仮名化の層を通した文） */
  profile: ForClaude<{ text: string }>;
  reporters: Reporter[];
  /** 連絡先の id → 役割名（ケアマネの手の相手を言い換える） */
  roles: ReadonlyMap<string, string>;
  hazards: ReadonlyArray<{ kind: HazardKind; depthM: number | null }>;
  dementia: boolean;
  /** 台帳の町名（停電の町の一覧を見るだけ。Claude に渡さない） */
  town?: string | null;
};

/** 連絡しうる人の区分 → 安否の出どころ。訪問看護・施設などの事業所は連絡しない（監督 T19・対応 T20 の相手） */
const REPORTER_SOURCE: Partial<Record<ContactRow["kind"], FixedTurn["source"]>> = {
  family: "family",
  supporter: "supporter",
  welfare_commissioner: "supporter",
};

/** 本人と周りの人のうち、ケアマネに連絡しうる人 */
export function reportersOf(source: Pick<PseudonymInput, "ledger" | "contacts">): Reporter[] {
  const roles = contactRoles(source.contacts);
  const out: Reporter[] = [
    { role: "本人", source: "agent", canPress: source.ledger.basic.contactMeans?.smartphone === "uses" },
  ];
  source.contacts.forEach((c, i) => {
    const s = REPORTER_SOURCE[c.kind];
    if (s) out.push({ role: roles[i], source: s, canPress: c.has_smartphone === 1 });
  });
  return out;
}

const pick = <T extends string>(list: readonly T[], v: string): T | null => ((list as readonly string[]).includes(v) ? (v as T) : null);

function line(label: string, parts: ReadonlyArray<string | null | undefined | false>): string | null {
  const xs = parts.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return xs.length > 0 ? `${label}: ${xs.join("、")}` : null;
}

/**
 * 本人役の説明の文。仮名化の層が作った ClaudePerson（氏名・住所・電話は無い）から、年齢・介護度・医療依存・住まい・
 * 周りの人の役割名・スマホを使えるか・特記を書く。避難先の名前は書かない（場所の名前を渡さない）
 */
export function profileText(
  p: ClaudePerson,
  reporters: ReadonlyArray<Reporter>,
  means: { landline: boolean; mobile: boolean },
): string {
  const h = p.housing;
  const house =
    h.floors === 1
      ? `${h.structure ? STRUCTURE_LABELS[h.structure as keyof typeof STRUCTURE_LABELS] ?? "" : ""}平屋`
      : h.floors || h.floor
        ? `${h.structure ? STRUCTURE_LABELS[h.structure as keyof typeof STRUCTURE_LABELS] ?? "" : ""}${h.floors ? `${h.floors} 階建て` : ""}${h.floor ? `の ${h.floor} 階` : ""}`
        : null;
  const abilities = (Object.keys(ABILITY_ITEM_LABELS) as Array<keyof typeof ABILITY_ITEM_LABELS>)
    .map((k) => {
      const v = p.care[k];
      return v && pick<Ability>(ABILITIES, v) ? `${ABILITY_ITEM_LABELS[k]} ${ABILITY_LABELS[v]}` : null;
    })
    .filter((x): x is string => x !== null);
  const devices = p.medical.devices.map((d) => {
    const kind = pick(DEVICE_KINDS, d.kind);
    return `${kind ? DEVICE_LABELS[kind] : d.kind}${d.detail ? `（${d.detail}）` : ""}${d.schedule ? ` ${d.schedule}` : ""}`;
  });
  const meds = p.medical.medications.map((m) => {
    const cat = pick(MEDICATION_CATEGORIES, m.category);
    const marks = [cat && cat !== "other" ? MEDICATION_CATEGORY_LABELS[cat] : null, m.interruptionRisk ? "中断注意" : null, m.needsRefrigeration ? "要冷蔵" : null]
      .filter(Boolean)
      .join("、");
    return `${m.name}${marks ? `（${marks}）` : ""}${m.schedule ? ` ${m.schedule}` : ""}`;
  });
  const clocks = p.clocks
    .filter((k) => k.kind !== "condition")
    .map((k) => {
      const len = k.value != null && k.unit ? `${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : "残り 未確認";
      const start = k.startsOn === "none" ? "" : `（${CLOCK_START_LABELS[k.startsOn]}から減る）`;
      return `${k.label} ${len}${start}`;
    });
  const hazards = p.evacuation.hazards.map((x) => {
    const kind = pick<HazardKind>(HAZARD_KINDS, x.kind);
    return `${kind ? HAZARD_LABELS[kind] : x.kind}${x.depthM != null ? ` ${x.depthM} m` : ""}`;
  });
  const smartphone = { uses: "使える", views: "見るだけ", none: "持たない" } as const;
  const people = p.contacts.map((c) => {
    const parts = [
      c.kind === "family" ? "家族" : CONTACT_KIND_LABELS[c.kind],
      c.relation,
      c.reach ? CONTACT_REACH_LABELS[c.reach] : null,
      c.hasCar === true ? "車あり" : null,
      c.hasSmartphone === true ? "スマホあり" : c.hasSmartphone === false ? "スマホなし" : null,
      c.nightOk === true ? "夜も来られる" : null,
      c.note,
    ].filter((x): x is string => typeof x === "string" && x.trim() !== "");
    return `- ${c.role}: ${parts.join("、")}`;
  });
  const pressers = reporters.filter((r) => r.canPress).map((r) => r.role);

  return [
    line("本人", [
      p.age != null ? `${p.age} 歳` : null,
      p.sex ? SEX_LABELS[p.sex] : null,
      p.care.careLevel ? CARE_LEVEL_LABELS[p.care.careLevel] : null,
      p.household ? HOUSEHOLD_LABELS[p.household] : null,
    ]),
    line("住まい", [house, h.bedroom ? `寝室 ${h.bedroom}` : null]),
    line("体", [...abilities, p.care.bedridden ? "寝たきり" : null, p.care.dementia ? "認知症あり（話が噛み合わないことがある）" : null]),
    line("医療機器", devices),
    line("薬", meds),
    line("持ちこたえる時間", clocks),
    line("ハザード", hazards.length > 0 ? hazards : ["なし"]),
    line("避難", [p.evacuation.transport ? `手段 ${p.evacuation.transport}` : null, p.evacuation.carryItems.length > 0 ? `持ち物 ${p.evacuation.carryItems.join("・")}` : null]),
    line("連絡手段", [
      means.landline ? "固定電話あり" : null,
      means.mobile ? "携帯電話あり" : null,
      `スマホ ${p.smartphone ? smartphone[p.smartphone] : "未確認"}`,
    ]),
    people.length > 0 ? ["周りの人:", ...people].join("\n") : "周りの人: なし",
    line("特記", p.notes),
    `押せる人（スマホで赤・緑を押してケアマネに連絡できる人）: ${pressers.length > 0 ? pressers.join("、") : "いない"}`,
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
}

/**
 * 台帳（仮名化の前）から本人役を作る。説明の文は仮名化の層を通し、氏名・町名・電話が残れば PseudonymLeakError（送らない）。
 * places（事業所の町名 → 地区の別名、lib/drill/area.ts の officePlaces）があれば、説明にも刻みの文にも町名は別名で渡る（T88）
 */
export function buildPersona(source: PseudonymInput, opts: { on?: string; places?: ReadonlyArray<Place> } = {}): Persona {
  const { payload, key } = pseudonymize([source], { ...(opts.on ? { on: opts.on } : {}), ...(opts.places ? { places: opts.places } : {}) });
  const p = payload[0];
  const reporters = reportersOf(source);
  const means = source.ledger.basic.contactMeans ?? {};
  const text = profileText(p, reporters, { landline: means.landline === true, mobile: means.mobile === true });
  const roles = contactRoles(source.contacts);
  return {
    personId: source.person.id,
    key,
    profile: pseudonymizeText(text, key),
    reporters,
    roles: new Map(source.contacts.map((c, i) => [c.id, roles[i]])),
    hazards: source.ledger.evacuation.hazards.map((x) => ({ kind: x.kind, depthM: x.depthM ?? null })),
    dementia: source.ledger.care.dementia === true,
    town: source.ledger.basic.address?.town?.trim() || null,
  };
}

// ---------- 刻みの文 ----------

/** 停電の地区にこの家が入るか。町の一覧（仮想、T50）は本人の町名で見る（町名の無い人は外さない。lib/disaster/state.ts と同じ） */
export function inOutageArea(area: OutageArea, hazards: Persona["hazards"], town: string | null = null): boolean {
  if (area.scope === "office") return true;
  if (area.scope === "towns") return !town || area.towns.includes(town);
  return hazards.some((h) => h.kind === area.hazard && (h.depthM ?? 0) >= area.minDepthM);
}

const SOURCE_WORDS: Record<FixedTurn["source"], string> = { agent: "本人", family: "家族", supporter: "支援者" };
const WHERE_WORDS: Record<WhereNow, string> = { home: "家", shelter: "避難所", other: "その他" };
const COLOR_WORDS: Record<SignalColor, string> = { red: "赤（無事じゃない）", green: "緑（無事）", unknown: "連絡（安否は不明）" };

/** ケアマネの手の言い方（Claude に渡す文。画面の言葉ではない）。手の表（T91 の lib/drill/action-catalog.ts）の words */
const ACTION_WORDS: Record<DrillAction, string> = CATALOG_WORDS;

function answersWords(x: { injured?: boolean | null; atHome?: boolean | null; canMove?: boolean | null; hasMedicine?: boolean | null }): string {
  const yn = (v: boolean | undefined | null, yes: string, no: string) => (v == null ? null : v ? yes : no);
  const parts = [
    yn(x.injured, "けが あり", "けが なし"),
    yn(x.atHome, "家にいる", "家にいない"),
    yn(x.canMove, "動ける", "動けない"),
    yn(x.hasMedicine, "薬 あり", "薬 なし"),
  ].filter((v): v is string => v !== null);
  return parts.length > 0 ? `4 問の答え ${parts.join("・")}（ほかは答えない）` : "4 問は答えない";
}

function fixedWords(f: FixedTurn): string {
  const parts = [`${SOURCE_WORDS[f.source]}が${COLOR_WORDS[f.color]}を押す`];
  if (f.color === "red") parts.push(answersWords(f));
  if (f.color === "green" && f.whereNow) parts.push(`いる所 ${WHERE_WORDS[f.whereNow]}`);
  if (f.saying) parts.push(`言う事の元「${f.saying}」`);
  if (f.doing) parts.push(`する事「${f.doing}」`);
  return `- ${parts.join("。")}`;
}

function stateWords(s: PersonState | null): string {
  if (!s) return "まだケアマネに連絡していない";
  const where = s.whereNow ? `（${WHERE_WORDS[s.whereNow]}）` : "";
  return [
    `${s.at} 時間に${SOURCE_WORDS[s.source]}が${COLOR_WORDS[s.color]}${where}`,
    s.saying ? `「${s.saying}」` : null,
    s.doing ? `する事 ${s.doing}` : null,
  ]
    .filter(Boolean)
    .join("。");
}

/** 手の返事の言い方（Claude に渡す文。lib/drill/actions.ts の ACTION_STATUS_TEXTS と同じ。actions.ts は persona.ts を読むので写す） */
const RESULT_WORDS: Readonly<Record<NonNullable<ActionRecord["result"]>["status"], string>> = { ...WORLD_REPLY_TEXTS, ...CALL_STATUS_TEXTS };

/** 手の結果の言葉（「出たが声がない」「向かってもらえる、5 時間ごろ着く」「つながった。2 往復話した」） */
function resultWords(a: ActionRecord): string {
  const r = a.result;
  if (!r) return "返事待ち";
  const parts = [RESULT_WORDS[r.status]];
  if (typeof r.arriveAt === "number") parts.push(`${clockLabel(r.arriveAt)}ごろ着く`);
  const rounds = talkRounds(r);
  if (rounds > 0) parts.push(`${rounds} 往復話した`);
  if (r.visit) parts.push("会って様子を見た");
  return parts.join("、");
}

function actionWords(a: ActionRecord | null, persona: Persona): string {
  if (!a) return "なし";
  const target = a.target ? persona.roles.get(a.target) : null;
  // 時刻は発災からの「N 時間 M 分」（手の時刻は分まで。小数の時間を書かない）
  const when = typeof a.atMinute === "number" ? clockLabel(a.atMinute) : `${a.at} 時間`;
  // 自由に書く手（T91）は読み替えた手の言い方（文は渡さない）。結果の言葉つき（T93）
  return `${when}にケアマネが${ACTION_WORDS[effectiveKind(a)]}${target ? `（相手 ${target}）` : ""} → ${resultWords(a)}`;
}

/** 1 回の本人役の文に書く手の数（新しい物から） */
const ACTIONS_IN_TICK = 6;

/**
 * 前の呼びから（T93）のケアマネの手。連続の時計（since がある）は返事か打った時刻が since より後の物、
 * 刻みの道は前の刻みから打った物。手の一覧（actions）が無ければ直前の 1 つ（今までの形）
 */
function actionsSince(input: PersonaInput): ActionRecord[] {
  const all = input.actions;
  if (!all) return input.lastAction ? [input.lastAction] : [];
  const since = input.since;
  const own = all.filter((a) => a.person === input.person);
  const picked =
    since === undefined
      ? own.filter((a) => a.step >= input.step - 1)
      : own.filter((a) => a.atMinute >= since || (a.result !== null && a.result.atMinute > since));
  return picked.slice(-ACTIONS_IN_TICK);
}

/** 本人役の今の時刻（発災からの分）。連続の時計（T90）は区切りの終わり、刻みの道は刻みの時刻 */
function nowMinuteOf(input: Pick<PersonaInput, "hour" | "toMinute">): number {
  return input.toMinute ?? Math.round(input.hour * 60);
}

/** 向かっている人・来た人の言い方（呼ばれた理由の 1 行。lib/drill/event-catalog.ts の言い方と同じ） */
const ARRIVAL_WORDS: Readonly<Record<string, string>> = {
  staff: "事業所の職員",
  nurse: "訪問看護",
  supporter: "支援者",
  family: "家族",
  vendor: "酸素業者",
  transport: "移送の車",
  power: "電源を届ける人",
  medicine: "薬の配達",
};

/**
 * 呼ばれた理由（T90 の reasons）の 1 行「この区切りで起きた事: …」。table は書かない。
 * incident は状況の文、action はケアマネの手の結果と着いた人、clock は持ちこたえる時間、round は前の連絡からの時間
 */
function reasonLine(input: PersonaInput, incidents: ReadonlyArray<DrillIncident>, acts: ReadonlyArray<ActionRecord>, now: number): string | null {
  const reasons = (input.reasons ?? []).filter((r) => r !== "table");
  if (reasons.length === 0) return null;
  const since = input.since ?? -1;
  const out: string[] = [];
  for (const r of reasons) {
    if (r === "incident") {
      const texts = incidents.map((e) => e.text).filter(Boolean).slice(0, 2);
      out.push(texts.length > 0 ? texts.join("。") : "身の回りの状況が変わった");
    } else if (r === "action") {
      const last = acts.at(-1);
      if (last) out.push(`ケアマネが${ACTION_WORDS[effectiveKind(last)]} → ${resultWords(last)}`);
      for (const a of input.world.arrivals ?? []) {
        if (a.person === input.person && a.arrived && a.arrive > since && a.arrive <= now) out.push(`${ARRIVAL_WORDS[a.role] ?? a.role}が来た`);
      }
      for (const d of input.world.dispatched ?? []) {
        if (d.person === input.person && d.arrive > since && d.arrive <= now) out.push("頼んだ人が来た");
      }
    } else if (r === "clock") {
      out.push("持ちこたえる時間が半分を過ぎた（または切れた）");
    } else if (r === "round") {
      const from = input.state ? Math.round(input.state.at * 60) : Math.max(0, since);
      out.push(`前の連絡から ${clockLabel(Math.max(0, now - from))}たった`);
    }
  }
  return out.length > 0 ? `この区切りで起きた事: ${[...new Set(out)].join("。")}` : null;
}

/** 119 を勧められた（T91 の advised、T93）。勧めるまでで、かけたかは本人役が決める */
function advisedWords(world: WorldState, person: string): string[] {
  const at = world.advised?.[person];
  return at === undefined ? [] : [`ケアマネから 119 への連絡を勧められた（${clockLabel(at)}）`];
}

/** 世界の今の様子のうち、この人に関わる物 */
function worldWords(world: WorldState, person: string, persona: Persona): string[] {
  const out: string[] = [];
  if (world.alertLevel) out.push(`警戒レベル ${world.alertLevel}`);
  if (world.quake) out.push(`地震 震度 ${world.quake}`);
  if (world.tsunami !== "none") out.push(`津波 ${TSUNAMI_LABELS[world.tsunami]}`);
  if (world.flood) out.push("川が氾濫（浸水 3 m の想定の地区で浸水）");
  if (world.outage) {
    const o = world.outage;
    if (o.restoredAt != null) out.push(`停電 復旧（${o.restoredAt} 時間）`);
    else out.push(inOutageArea(o.area, persona.hazards, persona.town ?? null) ? `この家は停電中（${o.since} 時間から）` : "この家は停電していない");
  }
  out.push(`電話 ${PHONE_LABELS[world.phone]}`);
  if (world.water !== "none") out.push(`断水 ${WATER_LABELS[world.water]}`);
  for (const r of world.roads.filter((x) => !x.person || x.person === person)) {
    out.push(`${r.label} ${r.open ? "通行可" : "通行止"}${r.person === person ? "（家の近くの道）" : ""}`);
  }
  for (const s of world.shelters.filter((x) => !x.person || x.person === person)) {
    out.push(`${s.label} ${SHELTER_LABELS[s.state]}`);
  }
  for (const f of world.facilities.filter((x) => !x.person || x.person === person)) {
    out.push(`${f.label} ${f.open ? "稼働" : "休止"}${f.person === person ? "（この人が通う所）" : ""}`);
  }
  // 監督の差し込み（T19）で付いたこの人の印
  const m = world.marks?.[person] ?? {};
  if (m.supplyLeft !== undefined) out.push(`栄養剤を家に置いてきた（${m.supplyLeft} 時間から）`);
  if (m.nurseAway !== undefined) out.push(`訪問看護が来られない（${m.nurseAway} 時間から）`);
  if (m.goingHome !== undefined) out.push(`本人が家に帰ろうとしている（${m.goingHome} 時間から）`);
  if (m.lineDown !== undefined) out.push(`この家の電話が不通（${m.lineDown} 時間から）`);
  // 仮想モード（T50）の町の出来事
  if (m.flooded !== undefined) {
    const d = world.floods?.[person];
    out.push(`家の辺りが浸水${d != null ? `（${d} m）` : ""}（${m.flooded} 時間から）`);
  }
  if (m.waterOut !== undefined) out.push(`家の辺りが断水（${m.waterOut} 時間から）`);
  if (world.weather) out.push(world.weather === "rain" ? "大雨が続いている" : "雨は止んだ");
  out.push(...extraWorldWords(world, person)); // T92: 出来事の表の印・予定・向かっている人・届いた物・頼み事
  return out;
}

/** この人に関わる状況（ほかの人の道路・施設は外す） */
function ownIncidents(incidents: ReadonlyArray<DrillIncident>, person: string): DrillIncident[] {
  return incidents.filter((e) => !e.person || e.person === person);
}

/** 刻みの文（時刻・呼ばれた理由・状況・世界・前の様子・ケアマネの手と結果・想定の表の行） */
export function tickText(input: PersonaInput, persona: Persona): string {
  const incidents = ownIncidents(input.incidents, input.person);
  const now = nowMinuteOf(input);
  const acts = actionsSince(input);
  const reason = reasonLine(input, incidents, acts, now);
  return [
    // 発災からの「N 時間 M 分」（連続の時計の時刻は小数になるので分まで。T93）
    `時刻: 発災から ${clockLabel(now)}`,
    // 夜間発災（T59）だけ。時刻の 1 行
    ...(input.night ? [nightLine(input.hour)] : []),
    ...(reason ? [reason] : []),
    incidents.length > 0 ? ["この刻みの状況:", ...incidents.map((e) => `- ${e.text}`)].join("\n") : "この刻みの状況: 新しい事はない",
    ["今の様子:", ...[...worldWords(input.world, input.person, persona), ...advisedWords(input.world, input.person)].map((x) => `- ${x}`)].join("\n"),
    `前の連絡: ${stateWords(input.state)}`,
    acts.length > 0 ? ["ケアマネがした事:", ...acts.map((a) => `- ${actionWords(a, persona)}`)].join("\n") : "ケアマネがした事: なし",
    input.fixed.length > 0
      ? ["想定の表のこの刻みの行（この通りに連絡する）:", ...input.fixed.map(fixedWords)].join("\n")
      : "想定の表のこの刻みの行: なし（連絡するかは自分で決める）",
  ].join("\n");
}

// ---------- 指示と返事の形 ----------

export const PERSONA_SYSTEM = [
  "災害の訓練（発災から 72 時間）で、在宅で介護を受ける高齢者とその周りの人（家族・支援者）を演じる。人は全部架空。",
  "入力は JSON。「本人役」は本人と周りの人の説明、「この刻み」は今の時刻・状況・前の連絡・ケアマネがした事・想定の表の行。",
  "この刻みで本人と周りの人がどうするかを、決まった JSON で 1 つ返す。",
  "",
  "欄:",
  "- condition: 本人の今の様子。見て分かる事だけを短く（20 字まで）。",
  "- location: 本人が今いる所。home（家）・shelter（避難所）・other（その他）・unknown（連絡する人にも分からない）のどれか 1 つの英字。",
  "- action: 本人と周りの人がこの刻みでする事（20 字まで）。",
  "- contactsCaremanager: スマホで赤か緑を押してケアマネに連絡するか。",
  "- from: 押す人の呼び方。「押せる人」に書いた呼び方（本人・娘・夫・支援者 1 など）をそのまま。連絡しない時は空文字。",
  "- pressesRed: 赤（無事じゃない）を押すか。緑（無事）なら false。",
  "- redAnswers: 赤の時だけ、4 問（injured けが・atHome 家にいるか・canMove 動けるか・hasMedicine 薬があるか）の答え。答えない問いは null。赤でない時は null。",
  "- speech: ケアマネに届く言葉（録音や書いた文に当たる）。連絡しない時は空文字。",
  "",
  "決まり:",
  "1. 想定の表の行がある時は、その行のとおりに連絡する（誰が・赤か緑か・4 問・いる所）。speech は行の「言う事の元」を、その人が言いそうな言い方に言い換える。元が無ければその人らしい短い言葉。",
  "2. 想定の表の行が無い時は、状況と前の連絡から自分で決める。連絡するのは、状況が変わってケアマネに伝えたい事がある時だけ。前と同じなら連絡しない。",
  "3. 押せるのは「押せる人」に書いた人だけ。押せる人がいなければ連絡しない。遠くに住む家族は本人の様子が分からなければ押さない。",
  "4. 本人の言葉はやさしい短い話し言葉で 1〜2 文。認知症の本人は話が噛み合わないことがある。",
  "5. 家族は娘・息子・夫・妻の口調、支援者は近所の人の口調。本人のことは「母」「父」「うちの人」「おばあちゃん」などと言う。",
  "6. 名前・住所・電話番号を言わない。「A さん」とも言わない。",
  "7. 「診断」「判定」「重症」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。",
  "8. ケアマネの手が届いたあとの最初の連絡は、その手の結果を受けた様子を言う（来た人がいる・物が届いた・移った）。頼んだ事が済んでいなければ、また頼んでよい。",
  "9. 119 を勧められたら、かけるか・かけないかを言葉で言う（かけたかどうかは自分で決める）。救急が来た先の事は言わない。「死亡」と言わない。",
].join("\n");

/**
 * 仮想モード（T50）だけ足す決まり。想定の表の行が無く、自分の家の辺りの状況と持ちこたえる時間から自由に動く。
 * 決まり 7（診断・判定・重症・病名・薬の量・助言を言わない）はそのまま
 */
export const PERSONA_VIRTUAL = [
  "仮想モード: 想定の表は無い。家の辺りの状況（浸水・停電・断水・道・余震・天候）と持ちこたえる時間から、この人がしそうな事を自分で決める。",
  "speech には、いる場所（家のどこ・何階）、閉じ込められている・挟まれている（何に）、体の訴え（本人の言葉で。「胸が少し痛い」「足を打った」）を入れてよい。",
  "体の訴えは本人や家族が言う言葉にとどめ、病名・重さを言い切らない。",
].join("\n");

/**
 * 返事の形。enum・範囲は SDK が JSON Schema の説明文に回し、文法では縛らない（lib/claude の T00 の記録）。
 * location を enum にすると外の値（「自宅」など）1 つで返事全部が形の違いになり、表の行の安否まで消えるので文字にし、
 * 値の範囲と押せる人の門はコード（personaTurns）で直す
 */
export const PersonaSchema = z.object({
  condition: z.string(),
  location: z.string(),
  action: z.string(),
  contactsCaremanager: z.boolean(),
  from: z.string(),
  pressesRed: z.boolean(),
  redAnswers: z
    .object({
      injured: z.boolean().nullable(),
      atHome: z.boolean().nullable(),
      canMove: z.boolean().nullable(),
      hasMedicine: z.boolean().nullable(),
    })
    .nullable(),
  speech: z.string(),
});

export type PersonaAnswer = z.output<typeof PersonaSchema>;

/** Claude に渡す要求。入力は伏せた文だけ（型で縛る）。モデルと考える深さは用途 persona の既定（Haiku・low） */
export function buildPersonaRequest(
  profile: ForClaude<{ text: string }>,
  tick: ForClaude<{ text: string }>,
  virtual = false,
): AskJsonRequest<typeof PersonaSchema> {
  const system = virtual ? `${PERSONA_SYSTEM}\n\n${PERSONA_VIRTUAL}` : PERSONA_SYSTEM;
  return { purpose: "persona", system, input: { 本人役: profile, この刻み: tick }, schema: PersonaSchema };
}

// ---------- 返事 → 安否 ----------

/** 言う事・する事の長さの上限（字） */
export const SPEECH_MAX = 60;
export const DOING_MAX = 40;

/** 本人役に言わせない言葉（CLAUDE.md: 画面に「診断」「判定」「病気がわかる」「重症」と書かない） */
const BANNED = /診断|判定|重症|病気がわかる|病気が分かる/;
const ALIAS = /(?<![A-Za-z])[A-Z]{1,3}[ 　]?さん/g;

/**
 * Haiku の言葉を画面に出せる形に。仮名（A さん）は「本人」に、禁じた言葉・元の情報（台帳の名前・電話）が残る物は捨てる、長さで切る。
 * 作った名前・住所の形（「隣の佐藤さん」）は捨てずに伏せ字に（T74 の続き。lib/pseudonym の maskReply）
 */
export function cleanWords(raw: string, key: PseudonymKey, max: number): string | null {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  t = t.replace(ALIAS, "本人");
  if (BANNED.test(t)) return null;
  const masked = maskReply(t, key);
  if (masked === null) return null;
  // 地区の別名（甲地区）は画面では町名に（T88。訓練の入力は町名を別名で渡す）
  return Array.from(restorePlaces(masked, key)).slice(0, max).join("");
}

function doingOf(answer: PersonaAnswer, key: PseudonymKey): string | null {
  const action = cleanWords(answer.action, key, DOING_MAX);
  const condition = cleanWords(answer.condition, key, DOING_MAX);
  const joined = [action, condition && condition !== action ? condition : null].filter(Boolean).join("。");
  return joined ? Array.from(joined).slice(0, DOING_MAX).join("") : null;
}

const WHERE_ALIASES: Readonly<Record<string, WhereNow>> = { 家: "home", 自宅: "home", 避難所: "shelter", その他: "other" };

/** いる所の値を揃える（英字の 3 つ。日本語で返ったときの言い方も受ける）。分からなければ null */
export function whereOf(raw: string): WhereNow | null {
  const v = raw.trim();
  return pick(WHERE_NOW, v.toLowerCase()) ?? WHERE_ALIASES[v] ?? null;
}

/** 押す人の呼び方を役割名に揃える（「娘さん」「夫です」→ 娘・夫） */
export function fromRole(raw: string): string {
  return raw
    .replace(/[\s　。、]+$/u, "")
    .replace(/(さん|さま|様|です)$/u, "")
    .trim();
}

/** 表の行の形（色・出どころ・4 問・いる所）は表のまま。engine の fixedToTurn と同じ読み方 */
function turnOfFixed(f: FixedTurn, hour: number): Omit<DrillTurn, "saying" | "doing" | "ai"> {
  return {
    person: f.person,
    color: f.color,
    source: f.source,
    whereNow: f.color === "green" ? (f.whereNow ?? null) : null,
    injured: f.color === "red" ? (f.injured ?? null) : null,
    atHome: f.color === "red" ? (f.atHome ?? null) : null,
    canMove: f.color === "red" ? (f.canMove ?? null) : null,
    hasMedicine: f.color === "red" ? (f.hasMedicine ?? null) : null,
    at: eventHour(f, hour),
  };
}

/** 想定の表の行をそのまま安否に（Haiku が失敗したときの戻り先。表の言葉で、AI の印なし）。engine の fixedToTurn と同じ形 */
export function fixedTurns(input: Pick<PersonaInput, "fixed" | "hour">): DrillTurn[] {
  return input.fixed.map((f) => ({ ...turnOfFixed(f, input.hour), saying: f.saying ?? null, doing: f.doing ?? null, ai: false }));
}

/**
 * Haiku の返事を安否にする。
 * - 想定の表の行がある: 行ごとに 1 つ。形は表のまま、いちばん遅い行の言う事・する事を Haiku の言葉に（使えなければ表の言葉、ai: false）
 * - 表の行が無い: 連絡するときだけ 1 つ。押す人が「押せる人」でなければ連絡なし。赤は 4 問、緑はいる所、いる所が分からなければ安否不明
 */
export function personaTurns(input: PersonaInput, persona: Persona, answer: PersonaAnswer): DrillTurn[] {
  const speech = cleanWords(answer.speech, persona.key, SPEECH_MAX);
  const doing = doingOf(answer, persona.key);

  if (input.fixed.length > 0) {
    const fixed = [...input.fixed].sort((a, b) => eventHour(a, input.hour) - eventHour(b, input.hour));
    return fixed.map((f, i) => {
      const last = i === fixed.length - 1;
      const aiSaying = last ? speech : null;
      // 表のする事（「4 問の途中で止まった」「避難を渋る」）は骨なので残し、表に無ければ Haiku のする事
      const aiDoing = last && f.doing == null ? doing : null;
      return {
        ...turnOfFixed(f, input.hour),
        saying: aiSaying ?? f.saying ?? null,
        doing: f.doing ?? aiDoing,
        ai: aiSaying !== null || aiDoing !== null,
      };
    });
  }

  if (!answer.contactsCaremanager) return [];
  const from = fromRole(answer.from);
  const reporter = persona.reporters.find((r) => r.role === from && r.canPress);
  if (!reporter) return [];
  const red = answer.pressesRed;
  const where = whereOf(answer.location);
  const color: SignalColor = red ? "red" : where ? "green" : "unknown";
  const a = red ? answer.redAnswers : null;
  return [
    {
      person: input.person,
      color,
      source: reporter.source,
      whereNow: color === "green" ? where : null,
      injured: a?.injured ?? null,
      atHome: a?.atHome ?? null,
      canMove: a?.canMove ?? null,
      hasMedicine: a?.hasMedicine ?? null,
      saying: speech,
      doing,
      ai: true,
      at: input.hour,
    },
  ];
}

/** 本人役の失敗のうち「連絡なし」にする物（AI の層の失敗と伏せきれない）。知らない例外は false で、投げ直す */
export function isPersonaFailure(e: unknown): boolean {
  return (
    e instanceof AiNotConfigured ||
    e instanceof AiLimitReached ||
    e instanceof AiRefused ||
    e instanceof AiBadOutput ||
    e instanceof AiCallFailed ||
    e instanceof PseudonymLeakError
  );
}

// ---------- 台帳を読む・呼び口 ----------

type PersonSourceRow = Pick<PersonRow, "id" | "name" | "kana" | "birth_date" | "ledger">;
type ContactSourceRow = PseudonymInput["contacts"][number] & { person_id: string };
type ClockSourceRow = PseudonymInput["clocks"][number] & { person_id: string };

/**
 * 事業所の本人の台帳・連絡先・時計を 1 回の batch で読む（仮名化の前。サーバーの中だけで持つ）。
 * 連絡先と時計の並びは本人のページと同じ（役割名の番号「支援者 1・2」が揃う）
 */
export async function loadPersonaSources(db: D1Database, officeId: string): Promise<Map<string, PseudonymInput>> {
  const inOffice = "SELECT id FROM people WHERE office_id = ?1";
  const [people, contacts, clocks] = await db.batch([
    db.prepare("SELECT id, name, kana, birth_date, ledger FROM people WHERE office_id = ?1 ORDER BY id").bind(officeId),
    db
      .prepare(
        `SELECT id, person_id, kind, relation, name, phone, reach, emergency_order, supporter_order,
                night_ok, has_car, has_smartphone, note
           FROM contacts WHERE person_id IN (${inOffice}) ORDER BY person_id, sort, id`,
      )
      .bind(officeId),
    db
      .prepare(
        `SELECT person_id, kind, category, label, value, unit, starts_on, source, note
           FROM clocks WHERE person_id IN (${inOffice}) ORDER BY person_id, sort, id`,
      )
      .bind(officeId),
  ]);
  const byPerson = <T extends { person_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.person_id, [...(m.get(r.person_id) ?? []), r]);
    return m;
  };
  const contactMap = byPerson(contacts.results as unknown as ContactSourceRow[]);
  const clockMap = byPerson(clocks.results as unknown as ClockSourceRow[]);
  const out = new Map<string, PseudonymInput>();
  for (const p of people.results as unknown as PersonSourceRow[]) {
    out.set(p.id, {
      person: { id: p.id, name: p.name, kana: p.kana, birth_date: p.birth_date },
      ledger: parseLedger(p.ledger),
      contacts: contactMap.get(p.id) ?? [],
      clocks: clockMap.get(p.id) ?? [],
    });
  }
  return out;
}

/**
 * 本人役・通話の入力の町名 → 地区の別名（T88）。事業所の本人たち全部の台帳の町名から作る（本人役は参加者の一覧を持たない）。
 * 入力の町名はこの別名で渡し、言葉の別名は町名に戻すので、世界の別名と番号が違っても本人役の中では食い違わない
 */
export function personaPlaces(ai: Pick<AskJsonContext, "office">, sources: ReadonlyMap<string, PseudonymInput>): Place[] {
  return officePlaces(
    ai.office.id,
    [...sources.values()].map((s) => s.ledger),
  );
}

export type PersonaDeps = {
  /** 本人の台帳（仮名化の前）。最初の呼び出しで 1 回だけ読む */
  load: () => Promise<ReadonlyMap<string, PseudonymInput>>;
  ai: AskJsonContext;
  /** 年齢を数える日（JST、YYYY-MM-DD）。無ければ今日 */
  on?: string;
  /** 上限で落ちたときに「本人役 停止」を書き留める所（T70）。返す物は変わらない（表の固定の安否か連絡なし） */
  stops?: StopLog;
};

/**
 * engine の PersonaHook を作る（1 要求ごと）。本人 1 人の 1 刻みに Haiku を 1 回。
 * 押せる人も表の行も無い本人は呼ばずに連絡なし。
 * 失敗（Haiku の失敗・台帳を読めない・台帳に無い本人）は、想定の表の行があれば表の固定の安否（ai: false、AI の印なし）、
 * 無ければ連絡なし（docs/progress/t18.md の問い 2 の答え）
 */
export function createPersonaHook(deps: PersonaDeps): PersonaHook {
  let loaded: Promise<ReadonlyMap<string, PseudonymInput>> | null = null;
  return async (input) => {
    try {
      const sources = await (loaded ??= deps.load());
      const source = sources.get(input.person);
      if (!source) return fixedTurns(input);
      const persona = buildPersona(source, { ...(deps.on ? { on: deps.on } : {}), places: personaPlaces(deps.ai, sources) });
      if (input.fixed.length === 0 && !persona.reporters.some((r) => r.canPress)) return [];
      const tick = pseudonymizeText(tickText(input, persona), persona.key);
      const r = await askJson(buildPersonaRequest(persona.profile, tick, input.virtual === true), deps.ai);
      return personaTurns(input, persona, r.value);
    } catch (e) {
      if (e instanceof AiLimitReached) deps.stops?.hit("persona");
      // AI の層の失敗と伏せきれないは想定どおり。それ以外（台帳を読めないなど）は名前だけログに残す（中身は書かない）
      if (!isPersonaFailure(e)) console.error("本人役の 1 刻みに失敗", e instanceof Error ? e.name : typeof e);
      return fixedTurns(input);
    }
  };
}

// ---------- 通話の相手（T20 が使う口） ----------

export const CALL_PICKUPS = ["answers", "no_answer", "background_only"] as const;
/** 出る・出ない・背景の音だけ */
export type CallPickup = (typeof CALL_PICKUPS)[number];

/**
 * 電話の様子ごとの「出る」「背景の音だけ」の割合（残りは出ない）。Claude を呼ぶ前に決める（Haiku は言葉だけ）。
 * 想定の表（lib/drill/scenarios.ts）に移すかは T20 で決める
 */
export const CALL_PICKUP_ODDS: Readonly<Record<PhoneState, { answers: number; background: number }>> = {
  ok: { answers: 0.85, background: 0.05 },
  busy: { answers: 0.5, background: 0.2 },
  down: { answers: 0, background: 0 },
};

/** 出るか。roll は 0 以上 1 未満（Math.random など）。電話の手段が無ければ出ない */
export function decideCallPickup(phone: PhoneState, roll: number, reachable = true): CallPickup {
  if (!reachable) return "no_answer";
  const o = CALL_PICKUP_ODDS[phone];
  if (roll < o.answers) return "answers";
  if (roll < o.answers + o.background) return "background_only";
  return "no_answer";
}

export type PersonaCall = Pick<PersonaInput, "person" | "hour" | "world" | "incidents" | "state" | "night"> & {
  /** 電話に出る人の呼び方（本人・娘・支援者 1 など。本人役の周りの人の役割名） */
  callee: string;
  /**
   * 電話で伝える様子（T21）。ケアマネが聞いた安否として左の表に入る物（色と 4 問は本人役の今の様子からコードが決める）。
   * 言葉がこれと食い違わないように渡す
   */
  tell?: Pick<HeardSignal, "color" | "whereNow" | "injured" | "atHome" | "canMove" | "hasMedicine">;
};

/** 伝える様子の文（Claude に渡す文。画面の言葉ではない） */
function tellWords(t: NonNullable<PersonaCall["tell"]>): string {
  if (t.color === "red") return `${COLOR_WORDS.red}。${answersWords(t)}`;
  return t.whereNow ? `${COLOR_WORDS.green}。いる所 ${WHERE_WORDS[t.whereNow]}` : COLOR_WORDS.green;
}

export const CALL_SYSTEM = [
  "災害の訓練で、ケアマネからの電話に出た人を演じる。人は全部架空。",
  "入力は JSON。「本人役」は本人と周りの人の説明、「電話」は今の時刻・状況・前の連絡・電話に出た人。",
  "電話に出た人が言う事を speech に 1〜3 文で返す。ケアマネは「大丈夫ですか。今どこにいますか」と聞いている。",
  "「伝える様子」があれば、その様子と食い違わない事を言う（無事なのにけがをしたと言わない、けがなのに無事と言わない）。",
  "本人はやさしい短い話し言葉。認知症の本人は話が噛み合わないことがある。家族・支援者はその人の口調。",
  "名前・住所・電話番号を言わない。「A さん」とも言わない。「診断」「判定」「重症」と言わない。病名を言い切らない。薬の量を言わない。",
].join("\n");

/**
 * 電話に出た人の返事の形（T93 で頼み事を足した）。asks は頼み事の種類の英字（ASK_KINDS の閉じた一覧。外の値はコードが捨てる）。
 * 最初の言葉（act の通話）は言葉だけを使い、頼み事は往復と訪問から積む。省略可（言葉だけの返事も通す）
 */
export const CallSchema = z.object({ speech: z.string(), asks: z.array(z.string()).optional() });

export function callText(call: PersonaCall, persona: Persona): string {
  return [
    `時刻: 発災から ${clockLabel(Math.round(call.hour * 60))}`,
    ...(call.night ? [nightLine(call.hour)] : []),
    ["今の様子:", ...[...worldWords(call.world, call.person, persona), ...advisedWords(call.world, call.person)].map((x) => `- ${x}`)].join("\n"),
    `この刻みの状況: ${ownIncidents(call.incidents, call.person).map((e) => e.text).join("、") || "新しい事はない"}`,
    `前の連絡: ${stateWords(call.state)}`,
    `電話に出た人: ${call.callee}`,
    ...(call.tell ? [`伝える様子: ${tellWords(call.tell)}`] : []),
  ].join("\n");
}

export function buildPersonaCallRequest(
  profile: ForClaude<{ text: string }>,
  call: ForClaude<{ text: string }>,
): AskJsonRequest<typeof CallSchema> {
  return { purpose: "persona", system: CALL_SYSTEM, input: { 本人役: profile, 電話: call }, schema: CallSchema };
}

export type CallReply = { pickup: CallPickup; speech: string | null; ai: boolean };

/**
 * ケアマネの電話への返事。出る・出ない・背景の音だけは呼ぶ側が先に決めて渡す（decideCallPickup）。出るときだけ Haiku が言葉を作る。
 * 本人役の周りにいない相手は出ない。失敗は言葉なし（ai: false）
 */
export async function personaCallReply(
  persona: Persona,
  call: PersonaCall,
  pickup: CallPickup,
  ctx: AskJsonContext,
): Promise<CallReply> {
  if (pickup !== "answers") return { pickup, speech: null, ai: false };
  if (!persona.reporters.some((r) => r.role === call.callee)) return { pickup: "no_answer", speech: null, ai: false };
  try {
    const text = pseudonymizeText(callText(call, persona), persona.key);
    const r = await askJson(buildPersonaCallRequest(persona.profile, text), ctx);
    const speech = cleanWords(r.value.speech, persona.key, SPEECH_MAX);
    return { pickup, speech, ai: speech !== null };
  } catch (e) {
    if (isPersonaFailure(e)) return { pickup, speech: null, ai: false };
    throw e;
  }
}

// ---------- 通話の往復（T93。lib/drill/talk.ts が使う口） ----------

const ASK_LIST = ASK_KINDS.map((k) => `${k}（${ASK_MEANINGS[k]}）`).join("・");

/**
 * 往復の指示。最初の言葉（CALL_SYSTEM）のあと、ケアマネの問い 1 つに電話に出た人として答える。返すのは言葉と頼み事だけ
 * （色・4 問・聞いた安否はコードが本人役の今の様子から決める）
 */
export const TALK_SYSTEM = [
  "災害の訓練で、ケアマネからの電話に出た人を演じる。人は全部架空。電話の続きで、ケアマネの今の言葉に答える。",
  "入力は JSON。「本人役」は本人と周りの人の説明、「電話」は今の時刻・状況・前の連絡・電話に出た人・それまでの話・ケアマネの今の言葉。",
  "返す物:",
  "- speech: 電話に出た人が言う事。1〜3 文。それまでの話と食い違わない。",
  `- asks: 頼み事。次の一覧から 0〜${TALK_ASKS_MAX} つの英字。${ASK_LIST}。言葉で頼んだ事と合わせる。無ければ空の配列。`,
  "「伝える様子」があれば、その様子と食い違わない事を言う（無事なのにけがをしたと言わない、けがなのに無事と言わない）。",
  "119 に電話するよう勧められたら、かけるか・かけないかを言葉で言う（どちらにするかは自分で決める）。救急が来た先の事は言わない。",
  "頼んだ事が済んでいなければ、また頼んでよい。ケアマネが後で電話すると言ったら、短く返して終える。",
  "本人はやさしい短い話し言葉。認知症の本人は話が噛み合わないことがある。家族・支援者はその人の口調。",
  "名前・住所・電話番号を言わない。「A さん」とも言わない。「診断」「判定」「重症」「死亡」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。",
].join("\n");

/** 往復の 1 回に渡す物。first は最初の言葉、lines はそれまでの往復、said はケアマネの今の言葉（決まった問いの言葉か、伏せる前の自由の文） */
export type PersonaTalk = PersonaCall & { first: string | null; lines: ReadonlyArray<TalkLine>; said: string };

/** 往復の文（Claude に渡す前。呼ぶ側が仮名化の門を通す） */
export function talkText(talk: PersonaTalk, persona: Persona): string {
  const who = (l: TalkLine) => (l.who === "cm" ? "ケアマネ" : talk.callee);
  return [
    callText(talk, persona),
    `最初に言った事: ${talk.first ? `「${talk.first}」` : "なし"}`,
    talk.lines.length > 0 ? ["それまでの話:", ...talk.lines.map((l) => `- ${who(l)}: 「${l.text}」`)].join("\n") : "それまでの話: なし",
    `ケアマネの今の言葉: 「${talk.said}」`,
  ].join("\n");
}

export function buildPersonaTalkRequest(
  profile: ForClaude<{ text: string }>,
  talk: ForClaude<{ text: string }>,
): AskJsonRequest<typeof CallSchema> {
  return { purpose: "persona", system: TALK_SYSTEM, input: { 本人役: profile, 電話: talk }, schema: CallSchema };
}

/** 往復の返事。言葉が使えなければ null（頼み事も積まない） */
export type TalkReplyWords = { speech: string | null; asks: AskKind[]; ai: boolean };

/** 往復と訪問の言葉の掃除（本人役と同じ掃除に、人の生き死に・救急の結果の語を足す） */
function cleanTalkWords(raw: string, key: PseudonymKey, max: number): string | null {
  if (SPEECH_DANGER.test(raw)) return null;
  return cleanWords(raw, key, max);
}

/**
 * 往復の 1 回（Haiku × 1 回）。talk は伏せた文（呼ぶ側が事業所の全員の鍵で pseudonymizeText を通した物）。key はその鍵
 * （返事の掃除と町名の戻し）。失敗は言葉なし（呼ぶ側が固定の言葉に）
 */
export async function personaTalkReply(
  persona: Persona,
  talk: ForClaude<{ text: string }>,
  key: PseudonymKey,
  ctx: AskJsonContext,
): Promise<TalkReplyWords> {
  try {
    const r = await askJson(buildPersonaTalkRequest(persona.profile, talk), ctx);
    const speech = cleanTalkWords(r.value.speech, key, SPEECH_MAX);
    return speech === null ? { speech: null, asks: [], ai: false } : { speech, asks: asksOf(r.value.asks, TALK_ASKS_MAX), ai: true };
  } catch (e) {
    if (isPersonaFailure(e)) return { speech: null, asks: [], ai: false };
    throw e;
  }
}

// ---------- 訪問の様子（T93。lib/drill/hooks.ts の visit の口） ----------

export const VISIT_SYSTEM = [
  "災害の訓練で、ケアマネが家を訪ねて着いたときの、本人と周りの人の様子を演じる。人は全部架空。",
  "入力は JSON。「本人役」は本人と周りの人の説明、「訪問」は今の時刻・状況・前の連絡。",
  "返す物:",
  `- condition: 着いたケアマネが見て分かる本人の様子（${VISIT_CONDITION_MAX} 字まで）。どこで何をしているか・部屋や周りの様子。体の具合や病名を言い切らない。`,
  "- location: 本人がいる所。home（家）・shelter（避難所）・other（その他）・unknown のどれか 1 つの英字。",
  `- asks: 本人か家族の頼み事。次の一覧から 0〜${VISIT_ASKS_MAX} つの英字。${ASK_LIST}。無ければ空の配列。`,
  "- speech: 本人か家族がケアマネに言う事。1〜2 文。",
  "本人はやさしい短い話し言葉。認知症の本人は話が噛み合わないことがある。家族・支援者はその人の口調。",
  "名前・住所・電話番号を言わない。「A さん」とも言わない。「診断」「判定」「重症」「死亡」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。",
].join("\n");

/** 訪問の返事の形。location は本人役の今の様子と並べて読むだけで、聞いた安否（色・いる所）はコードが決める */
export const VisitSchema = z.object({ condition: z.string(), location: z.string(), asks: z.array(z.string()), speech: z.string() });

export type PersonaVisit = Pick<PersonaInput, "person" | "hour" | "world" | "incidents" | "state" | "night">;

export function visitText(v: PersonaVisit, persona: Persona): string {
  return [
    `時刻: 発災から ${clockLabel(Math.round(v.hour * 60))}`,
    ...(v.night ? [nightLine(v.hour)] : []),
    ["今の様子:", ...[...worldWords(v.world, v.person, persona), ...advisedWords(v.world, v.person)].map((x) => `- ${x}`)].join("\n"),
    `この刻みの状況: ${ownIncidents(v.incidents, v.person).map((e) => e.text).join("、") || "新しい事はない"}`,
    `前の連絡: ${stateWords(v.state)}`,
    "ケアマネが家に着いた。",
  ].join("\n");
}

export function buildPersonaVisitRequest(
  profile: ForClaude<{ text: string }>,
  visit: ForClaude<{ text: string }>,
): AskJsonRequest<typeof VisitSchema> {
  return { purpose: "persona", system: VISIT_SYSTEM, input: { 本人役: profile, 訪問: visit }, schema: VisitSchema };
}

/**
 * 訪問で着いたときの様子と頼み事（Haiku × 1 回）。様子は見て分かる事だけ（体の具合の言い切り・人の生き死にの語は様子ごと捨てる）、
 * 頼み事は閉じた一覧の 3 つまで。使える物が何も無ければ・失敗は null（手の返事に様子を載せない）
 */
export async function personaVisitReport(persona: Persona, visit: PersonaVisit, ctx: AskJsonContext): Promise<VisitReport | null> {
  try {
    const text = pseudonymizeText(visitText(visit, persona), persona.key);
    const r = await askJson(buildPersonaVisitRequest(persona.profile, text), ctx);
    const raw = r.value.condition;
    const condition = CONDITION_BANNED.test(raw) ? null : cleanTalkWords(raw, persona.key, VISIT_CONDITION_MAX);
    const speech = cleanTalkWords(r.value.speech, persona.key, SPEECH_MAX);
    const asks = asksOf(r.value.asks, VISIT_ASKS_MAX);
    if (condition === null && speech === null && asks.length === 0) return null;
    return { condition, asks, speech, ai: true };
  } catch (e) {
    if (isPersonaFailure(e)) return null;
    throw e;
  }
}
