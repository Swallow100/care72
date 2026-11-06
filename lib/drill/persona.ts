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
// ケアマネの手の言い方（Claude に渡す文。画面の言葉ではない）は手の表（T91 の lib/drill/action-catalog.ts）の words。
// 自由対応は読み替えた手の言い方、そのままの手（T110）は AI が伏せた文から作った 1 文
import { actionWords as catalogWordsOf, isOwnFree } from "./action-catalog.ts";
import {
  ASK_MEANINGS,
  asksOf,
  CONDITION_BANNED,
  speechRuleOf,
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
  type ClaudeClock,
  type ClaudePerson,
  type ForClaude,
  type Place,
  type PseudonymInput,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import { officePlaces } from "./area.ts";
import { arrivalRoleWords, extraWorldWords } from "./event-catalog.ts";
import type { ActionRecord, DrillIncident, DrillTurn, HeardSignal, PersonaBatchHook, PersonaHook, PersonaInput, PersonState, StopLog } from "./engine.ts";
import { CALL_STATUS_TEXTS, clockLabel, PHONE_LABELS, SHELTER_LABELS, TSUNAMI_LABELS, WATER_LABELS } from "./labels.ts";
import { nightLine, timeLines } from "./night.ts";
import { ASK_KINDS, eventHour, type AskKind, type DrillKind, type FixedTurn, type OutageArea, type PhoneState, type WorldState } from "./scenarios.ts";
import { fitLedgerHazards, profileOf } from "./fit.ts";
import { homeComms, homeOf, type Home } from "./comms.ts";
import { clockRemaining, formatHours, type Situation, type TriageClock } from "../triage/index.ts";
import { callsFor, speakerSlip, speakersLine, speakersOf, type Speaker, type Speakers } from "./speaker.ts";
import { minuteText } from "./time-text.ts";
import { clipWords } from "./clip.ts";
import {
  dropFactSlips,
  dropRepeats,
  factsBlock,
  factsOf,
  housemates,
  placeOfState,
  planOf,
  screenAsks,
  screenTurn,
  slipContextOf,
  type Facts,
  type GateLog,
  type GateRule,
  type Plan,
} from "./person-facts.ts";

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
  /** 家族・支援者から連絡するときの話し手（T121、lib/drill/speaker.ts）。台帳の連絡先から決め、AI に変えさせない */
  speakers?: Speakers;
  /** 持ちこたえる時間（仮名化の層の時計。刻みの文に今の残りを書く、T121） */
  clocks?: ReadonlyArray<ClaudeClock>;
  /** 本人の性別（通話の相手の本人の呼び方、T121） */
  sex?: ClaudePerson["sex"];
  /** 家の区域と通信（T125、lib/drill/comms.ts。固定電話・携帯）。Claude に渡さない（今の様子の行に「固定電話は停電で使えない」などを書く元） */
  home?: Home;
  /** 訓練の災害の種類（T125。電波不通の区域の表を引く） */
  fit?: DrillKind | null;
  /** 計画（台帳の停電のときの予備・避難先と手段・在宅避難・業者の約束。T130、lib/drill/person-facts.ts の planOf）。Claude に名前は渡さない */
  plan?: Plan;
  /** 同居の人の役割名（T130。あとから「来た」と言わない） */
  together?: ReadonlyArray<string>;
  /** 本人の周りの家族の続柄（T130。いない家族を出さない）。世帯が「家族と」「その他」なら null（見ない） */
  kin?: ReadonlyArray<string> | null;
  /**
   * ケアマネの自由の言葉を Claude に渡せる形に伏せる口（T130。呼び口が事業所の全員の鍵で作る。伏せきれなければ null）。
   * 無ければ帳面の「ケアマネに言われた事」は決まった指示の言葉だけ
   */
  mask?: (text: string) => string | null;
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
  speakers?: Speakers,
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
    // T121: 家族・支援者の話し手と本人の呼び方（台帳の連絡先から）
    speakers ? speakersLine(speakers) : null,
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
}

/**
 * 台帳（仮名化の前）から本人役を作る。説明の文は仮名化の層を通し、氏名・町名・電話が残れば PseudonymLeakError（送らない）。
 * places（事業所の町名 → 地区の別名、lib/drill/area.ts の officePlaces）があれば、説明にも刻みの文にも町名は別名で渡る（T88）
 */
export function buildPersona(source: PseudonymInput, opts: { on?: string; places?: ReadonlyArray<Place>; fit?: DrillKind | null } = {}): Persona {
  const { payload, key } = pseudonymize([source], { ...(opts.on ? { on: opts.on } : {}), ...(opts.places ? { places: opts.places } : {}) });
  // 本人役の説明のハザードは想定に効く区域だけ（T125。地震の訓練に河川の浸水の想定を渡さない）。未決・無ければ全部
  const fitProfile = opts.fit ? profileOf(opts.fit) : null;
  const p = fitProfile ? { ...payload[0], evacuation: { ...payload[0].evacuation, hazards: fitLedgerHazards(fitProfile, payload[0].evacuation.hazards as Array<{ kind: HazardKind; depthM: number | null; note: string | null }>) } } : payload[0];
  const reporters = reportersOf(source);
  const means = source.ledger.basic.contactMeans ?? {};
  const roles = contactRoles(source.contacts);
  const speakers = speakersOf(source.contacts, roles, p.sex);
  const text = profileText(p, reporters, { landline: means.landline === true, mobile: means.mobile === true }, speakers);
  return {
    personId: source.person.id,
    key,
    profile: pseudonymizeText(text, key),
    reporters,
    roles: new Map(source.contacts.map((c, i) => [c.id, roles[i]])),
    hazards: source.ledger.evacuation.hazards.map((x) => ({ kind: x.kind, depthM: x.depthM ?? null })),
    dementia: source.ledger.care.dementia === true,
    town: source.ledger.basic.address?.town?.trim() || null,
    speakers,
    clocks: p.clocks,
    sex: p.sex,
    home: homeOf(source.ledger),
    fit: opts.fit ?? null,
    plan: planOf(source),
    ...housemates(source, roles, p.sex),
  };
}

/** 本人役の帳面（T130）。actions はこの人への手（メモを落とした物）。停電の地区は本人の町名とハザードで見る */
export function personaFacts(
  persona: Pick<Persona, "plan" | "together" | "kin" | "hazards" | "town" | "mask">,
  x: { person: string; world: WorldState; state: PersonState | null; actions?: ReadonlyArray<ActionRecord>; now: number; ahead?: PersonaInput["ahead"] },
): Facts {
  const o = x.world.outage;
  return factsOf({
    person: x.person,
    world: x.world,
    state: x.state,
    actions: x.actions ?? [],
    now: x.now,
    plan: persona.plan ?? null,
    inOutage: o !== null && inOutageArea(o.area, persona.hazards, persona.town ?? null),
    together: persona.together ?? [],
    kin: persona.kin ?? null,
    ahead: x.ahead ?? null,
    ...(persona.mask ? { mask: persona.mask } : {}),
  });
}

/**
 * ケアマネの自由の言葉を伏せる口（T130）。本人を先頭に事業所の全員の鍵で pseudonymizeText を通す（往復の口 createTalkHook と同じ鍵の作り方）。
 * 伏せきれなければ null（その言葉は渡さない）
 */
export function maskWith(source: PseudonymInput, sources: ReadonlyMap<string, PseudonymInput>, opts: { on?: string; places?: ReadonlyArray<Place> } = {}): (text: string) => string | null {
  let key: PseudonymKey | null = null;
  return (text) => {
    try {
      key ??= pseudonymize([source, ...[...sources.values()].filter((s) => s !== source)], opts).key;
      return pseudonymizeText(text, key).text;
    } catch {
      return null;
    }
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
  // 表のする事は画面の記録の言葉（「4 問の途中で止まった」）。言葉にしない（T165。評価の 7 回目で本人役が「質問の途中で止まった」と言った）
  if (f.doing) parts.push(`画面の記録「${f.doing}」（このとおりに振る舞う。記録の言葉そのものは言わない）`);
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
/**
 * 本人役に渡す「無言」の言い方（T165）。画面の言葉（labels.ts の「出たが声がない」）のままだと、家族役が本人の声が出なくなったと読み、
 * 声の印が付いて機器も無く歩ける人が電話で話さなくなった（評価の 7 回目）。電話の出方の事で、本人の体の事ではないと分かる言い方に
 */
const SILENT_WORDS = "電話はつながったが声が届かなかった（電話の具合の事で、本人の体の事とは決めない）";
const RESULT_WORDS: Readonly<Record<NonNullable<ActionRecord["result"]>["status"], string>> = { ...WORLD_REPLY_TEXTS, ...CALL_STATUS_TEXTS, silent: SILENT_WORDS };

/** 手の結果の言葉（「出たが声がない」「向かってもらえる、5 時間ごろ着く」「つながった。2 往復話した」） */
function resultWords(a: ActionRecord): string {
  const r = a.result;
  if (!r) return "返事待ち";
  const parts = [RESULT_WORDS[r.status]];
  // 自由対応のそのままの手（T110）は起きたこと（AI の 1 文。名前・町名の入らない物だけを残している）
  if (isOwnFree(a) && r.ai && r.text) parts.push(r.text);
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
  return `${when}にケアマネが${catalogWordsOf(a)}${target ? `（相手 ${target}）` : ""} → ${resultWords(a)}`;
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
      if (last) out.push(`ケアマネが${catalogWordsOf(last)} → ${resultWords(last)}`);
      for (const a of input.world.arrivals ?? []) {
        if (a.person === input.person && a.arrived && a.arrive > since && a.arrive <= now) out.push(`${arrivalRoleWords(a)}が来た`);
      }
      for (const d of input.world.dispatched ?? []) {
        if (d.person === input.person && d.arrived && d.arrive > since && d.arrive <= now) out.push("頼んだ人が来た");
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

/** 状態が変わった時刻（world.stamps、T121）の「（3 時間 10 分から）」。無ければ空 */
function sinceWords(world: WorldState, key: string): string {
  const h = world.stamps?.[key];
  return typeof h === "number" ? `（${minuteText(h * 60)}から）` : "";
}

/** 時刻の計算だけに使う基準（実際の時刻は渡さない。director.ts の clocksOf と同じ） */
const CLOCK_BASE = Date.UTC(2026, 0, 1);
const clockAt = (minute: number) => new Date(CLOCK_BASE + minute * 60_000).toISOString();

/** 届いた物が足す時計の区分（業者の酸素 → 在宅酸素、薬 → 薬） */
const SUPPLY_CLOCKS: Readonly<Record<string, ReadonlyArray<string>>> = { oxygen: ["oxygen"], medicine: ["medication"] };

/**
 * 持ちこたえる時間の今（T121。本人役が「電池は 3 時間」と言い続けて食い違わないように、コードが計算した残りを渡す）。
 * 停電で減る時計は、停電の始まりから、停電の復旧か電源が届いた時刻まで。物が届いた時計はその時刻を添える。色と順には使わない
 */
export function clockWords(persona: Pick<Persona, "clocks" | "hazards" | "town">, world: WorldState, person: string, now: number): string[] {
  const clocks = (persona.clocks ?? []).filter((k) => k.kind !== "condition" && k.startsOn !== "none");
  if (clocks.length === 0) return [];
  const o = world.outage;
  const inArea = o !== null && inOutageArea(o.area, persona.hazards, persona.town ?? null);
  const power = world.supplies?.[person]?.power;
  const stops = [o?.restoredAt != null ? Math.round(o.restoredAt * 60) : null, typeof power === "number" ? power : null].filter((x): x is number => x !== null);
  const stop = stops.length > 0 ? Math.min(...stops) : null;
  const left = world.marks?.[person]?.supplyLeft;
  return clocks.map((k) => {
    // 栄養剤を家に置いてきた（T158）。手元に無いので、台帳の時間で減る残りを言わない（評価の 6 回目で、置いてきたのに残りが減り続けた）
    if (k.category === "tube_feeding" && typeof left === "number" && Math.round(left * 60) <= now) {
      return `${k.label}: 家に置いてきて手元に無い（${minuteText(Math.round(left * 60))}から）。届くか家から持ってくるまで使えない。残りの時間は言わない`;
    }
    if (k.value == null || k.unit == null) return `${k.label}: 残り 未確認`;
    const end = k.startsOn === "outage" && stop !== null ? Math.min(now, stop) : now;
    const s: Situation = { now: clockAt(end), disasterAt: clockAt(0), outageAt: inArea ? clockAt(Math.round(o!.since * 60)) : null };
    const clock: TriageClock = { kind: k.kind, category: k.category, label: k.label, value: k.value, unit: k.unit, starts_on: k.startsOn };
    const r = clockRemaining(clock, s);
    if (!r) return `${k.label}: 残り 未確認`;
    const got = Object.entries(SUPPLY_CLOCKS).flatMap(([supply, cats]) => {
      const at = world.supplies?.[person]?.[supply as "oxygen" | "medicine"];
      return typeof at === "number" && at <= now && cats.includes(k.category) ? [`。${minuteText(at)}に届いた`] : [];
    });
    // 電源が届いた家は停電が戻ったのではない（T167）
    // 動くのは機器だけ（予備のボンベなどは「減っていない」だけ）
    const stopped =
      k.startsOn === "outage" && stop !== null && stop <= now
        ? `。${minuteText(stop)}から${k.kind === "device" ? `${typeof power === "number" && power === stop ? "届いた電源" : "電気"}で動き` : ""}減っていない`
        : "";
    if (!r.running) return `${k.label}: ${formatHours(r.hours)}（停電で減る。まだ減っていない）${got.join("")}`;
    if (r.over) return `${k.label}: ${formatHours(r.hours)}の分は切れた（${minuteText(Math.round(r.hours * 60) + (k.startsOn === "outage" && o ? Math.round(o.since * 60) : 0))}ごろ）${stopped}${got.join("")}`;
    return `${k.label}: 残り ${formatHours(r.remaining)}${stopped}${got.join("")}`;
  });
}

/** この家の通信の今（固定電話・携帯の電波・通話の規制）。家の分からない本人役（前からのテスト）は書かない */
export function commsWords(world: WorldState, person: string, persona: Pick<Persona, "home" | "fit">, now: number): string[] {
  if (!persona.home) return [];
  const c = homeComms(world, profileOf(persona.fit ?? null), person, persona.home, now);
  const out: string[] = [];
  if (c.landline === "out" && world.marks?.[person]?.lineDown === undefined) out.push("この家の固定電話は停電で使えない");
  if (c.mobile === "down") out.push("携帯の電波が不通（メッセージ・安否のボタンも届かない）");
  else if (world.phone === "down") out.push(c.mobile === "ok" ? "電話は規制でつながりにくい（メッセージ・安否のボタンは届く）" : "電話は規制でつながりにくい");
  // T139: 不安定の間も電話はつながりにくい（半分ほどはつながらず、メッセージで届く）
  else if (world.phone === "busy") out.push(c.mobile === "ok" ? "電話は不安定でつながりにくい（つながらない時はメッセージ・安否のボタン）" : "電話は不安定でつながりにくい");
  return out;
}

/** 世界の今の様子のうち、この人に関わる物 */
function worldWords(world: WorldState, person: string, persona: Persona, now: number): string[] {
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
  // T121: 道・電話・施設はいつからその状態か（world.stamps）。短い間に入れ替わったように言わないため
  out.push(`電話 ${PHONE_LABELS[world.phone]}${sinceWords(world, "phone")}`);
  // 通信の段（T125、lib/drill/comms.ts）。本人役が通じない道で連絡したと言わないため
  out.push(...commsWords(world, person, persona, now));
  if (world.water !== "none") out.push(`断水 ${WATER_LABELS[world.water]}`);
  for (const r of world.roads.filter((x) => !x.person || x.person === person)) {
    out.push(`${r.label} ${r.open ? "通行可" : "通行止"}${r.person === person ? "（家の近くの道）" : ""}${sinceWords(world, `road:${r.id}`)}`);
  }
  for (const s of world.shelters.filter((x) => !x.person || x.person === person)) {
    out.push(`${s.label} ${SHELTER_LABELS[s.state]}`);
  }
  for (const f of world.facilities.filter((x) => !x.person || x.person === person)) {
    out.push(`${f.label} ${f.open ? "稼働" : "休止"}${f.person === person ? "（この人が通う所）" : ""}${sinceWords(world, `facility:${f.id}`)}`);
  }
  // 監督の差し込み（T19）で付いたこの人の印
  const m = world.marks?.[person] ?? {};
  if (m.supplyLeft !== undefined) out.push(`栄養剤を家に置いてきた（${m.supplyLeft} 時間から）`);
  if (m.nurseAway !== undefined) out.push(`訪問看護が来られない（${m.nurseAway} 時間から）`);
  if (m.goingHome !== undefined) out.push(`本人が家に帰ろうとしている（${m.goingHome} 時間から）`);
  if (m.lineDown !== undefined) out.push(`この家の電話で通話できない（${m.lineDown} 時間から）`);
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

/** 持ちこたえる時間の今の段（時計が無ければ空） */
function clockLines(persona: Persona, world: WorldState, person: string, now: number): string[] {
  const xs = clockWords(persona, world, person, now);
  return xs.length > 0 ? [["持ちこたえる時間の今（計算した値。言葉はこれと食い違わない）:", ...xs.map((x) => `- ${x}`)].join("\n")] : [];
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
    ...timeLines(input.hour, input),
    ...(reason ? [reason] : []),
    incidents.length > 0 ? ["この刻みの状況:", ...incidents.map((e) => `- ${e.text}`)].join("\n") : "この刻みの状況: 新しい事はない",
    ["今の様子:", ...[...worldWords(input.world, input.person, persona, now), ...advisedWords(input.world, input.person)].map((x) => `- ${x}`)].join("\n"),
    // T121: 持ちこたえる時間の今（コードの計算）。言葉はこれと食い違わない
    ...clockLines(persona, input.world, input.person, now),
    // T130: 人ごとの事実の帳面と計画（コードが引く。いる所・前に言った事・来た人・声・同居・電気と予備）
    factsBlock(personaFacts(persona, { person: input.person, world: input.world, state: input.state, actions: input.actions ?? [], now })),
    `前の連絡: ${stateWords(input.state)}`,
    acts.length > 0 ? ["ケアマネがした事:", ...acts.map((a) => `- ${actionWords(a, persona)}`)].join("\n") : "ケアマネがした事: なし",
    input.fixed.length > 0
      ? ["想定の表のこの刻みの行（この通りに連絡する）:", ...input.fixed.map(fixedWords)].join("\n")
      : "想定の表のこの刻みの行: なし（連絡するかは自分で決める）",
  ].join("\n");
}

// ---------- 指示と返事の形 ----------

/**
 * 言う事の長さ（T139）。SPEECH_ASK は指示に書く字数（1〜2 文の話し言葉。声で 5〜10 秒ほど）、SPEECH_MAX は画面と記録に出す上限で、
 * 超えた時は文の切れ目で切る（lib/drill/clip.ts）。評価の 4 回目で、上限 60 字のまま文の途中で切れた（生の返事は 88 字ほどまで）ので、
 * 指示で短くさせ、上限は指示より広く取って切らずに済む形に
 */
export const SPEECH_ASK = 50;
export const SPEECH_MAX = 80;

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
  `- speech: ケアマネに届く言葉（録音や書いた文に当たる）。${SPEECH_ASK} 字まで（文の途中で終えない）。連絡しない時は空文字。`,
  "",
  "決まり:",
  "1. 想定の表の行がある時は、その行のとおりに連絡する（誰が・赤か緑か・4 問・いる所）。speech は行の「言う事の元」を、その人が言いそうな言い方に言い換える。元が無ければその人らしい短い言葉。",
  "2. 想定の表の行が無い時は、状況と前の連絡から自分で決める。連絡するのは、状況が変わってケアマネに伝えたい事がある時だけ。前と同じなら連絡しない。",
  "3. 押せるのは「押せる人」に書いた人だけ。押せる人がいなければ連絡しない。遠くに住む家族は本人の様子が分からなければ押さない。",
  "4. 本人の言葉はやさしい短い話し言葉で 1〜2 文。認知症の本人は話が噛み合わないことがある。",
  "5. 家族・支援者から連絡するのは「話す人」に書いた人で、途中で替えない。家族はその続柄の口調、支援者は近所の人の口調。本人のことは「話す人」に書いた呼び方で言う。",
  "6. 名前・住所・電話番号を言わない。「A さん」とも言わない。",
  "7. 「診断」「判定」「重症」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。",
  "8. ケアマネの手が届いたあとの最初の連絡は、その手の結果を受けた様子を言う（来た人がいる・物が届いた・移った）。頼んだ事が済んでいなければ、また頼んでよい。",
  "9. 119 を勧められたら、かけるか・かけないかを言葉で言う（かけたかどうかは自分で決める）。救急が来た先の事は言わない。「死亡」と言わない。",
  "10. 「今の様子」「持ちこたえる時間の今」と食い違う事を言わない（来た人・届いた物・復旧した物を、まだと言わない。切れた分を、まだ残ると言わない。いつからの状態かも合わせる）。",
  "11. 「人ごとの事実」と食い違う事を言わない（いる所、前に言った動けない・けが、同居の人、声が無いと伝えた事、電気と予備）。「計画」にある事は連絡が取れなくても計画どおりにする（予備に替える・決めた避難先へ移る）。計画に無い事で、手も人も無いのに良くならない。",
  "12. 「ケアマネに言われた事」は覚えて従う（待つと言われたら待つ・119 を勧められたらかけるか決める）。従えない時は理由を言う（道が通れない・動けない など）。",
  "13. 「前の連絡」で言った文・言い回しをくり返さない。変わった事を先に言い、変わらない事は言わないか「〜のまま」と短く。前に伝えた事（着いた・切れた・置いてきた）を新しい事のように言わない。",
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

/** する事の長さの上限（字）。言う事は SPEECH_MAX（上の指示の所） */
export const DOING_MAX = 40;

/** 監督・自由文の読み替えの言葉に書かせない言葉（CLAUDE.md: 画面に「診断」「判定」「病気がわかる」「重症」と書かない） */
const BANNED = /診断|判定|重症|病気がわかる|病気が分かる/;
const ALIAS = /(?<![A-Za-z])[A-Z]{1,3}[ 　]?さん/g;

/**
 * 監督の言い換え・差し込みと自由文の読み替えの言葉（Opus）を画面に出せる形に。仮名（A さん）は「本人」に、禁じた言葉・
 * 元の情報（台帳の名前・電話）が残る物は捨てる、長さで切る。作った名前・住所の形（「隣の佐藤さん」）は捨てずに伏せ字に
 * （T74 の続き。lib/pseudonym の maskReply）。本人役（Haiku）の言葉は cleanPersonaWords
 */
export function cleanWords(raw: string, key: PseudonymKey, max: number): string | null {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  t = t.replace(ALIAS, "本人");
  if (BANNED.test(t)) return null;
  const masked = maskReply(t, key);
  if (masked === null) return null;
  // 地区の別名（甲地区）は画面では町名に（T88。訓練の入力は町名を別名で渡す）
  return clipWords(restorePlaces(masked, key), max);
}

/** 文の区切り（句点・感嘆・疑問）。区切りの字は前の文に付ける */
const sentencesOf = (t: string): string[] => t.split(/(?<=[。！？!?])/u).filter((x) => x.trim() !== "");

/**
 * 本人役（Haiku）の言葉を画面に出せる形に（刻みの言う事・する事・様子、通話の最初の言葉、往復、訪問の言う事・様子の全部の道。T118）。
 * 仮名（A さん）は「本人」に、本人役の決まり（lib/drill/dialogue.ts の SPEECH_RULES: 診断・人の生き死に・薬の量・病名・医療の助言。
 * extra は様子の欄の決まり CONDITION_BANNED）に当たる文と、元の情報（台帳の名前・生年月日・電話）が残る文は落とし、残りの文を使う。
 * 全部落ちれば null。長さで切る。作った名前・住所の形（「隣の佐藤さん」）は捨てずに伏せ字に（cleanWords と同じ）。
 * 落としたことは決まりの名前だけをログに残す（言葉の中身は書かない）
 */
export function cleanPersonaWords(raw: string, key: PseudonymKey, max: number, extra?: RegExp): string | null {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return null;
  t = t.replace(ALIAS, "本人");
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const s of sentencesOf(t)) {
    const rule = speechRuleOf(s, extra);
    const masked = rule ? null : maskReply(s, key);
    if (masked === null) dropped.push(rule ?? "personal");
    else kept.push(masked);
  }
  if (dropped.length > 0) console.warn("言葉の掃除で文を落とした", dropped.join("・"));
  const joined = kept.join("").trim();
  if (!joined) return null;
  // 地区の別名（甲地区）は画面では町名に（T88。訓練の入力は町名を別名で渡す）
  return clipWords(restorePlaces(joined, key), max);
}

/** 話した人の話し手（家族・支援者の話し手。本人は null） */
function speakerOf(persona: Pick<Persona, "speakers">, source: FixedTurn["source"]): Speaker | null {
  if (source === "family") return persona.speakers?.family ?? null;
  if (source === "supporter") return persona.speakers?.supporter ?? null;
  return null;
}

/** 呼び方が役割名のときの話し手（通話の相手。家族・支援者の役割名なら、その人の続柄で） */
function calleeSpeaker(persona: Pick<Persona, "reporters" | "speakers">, callee: string, sex: ClaudePerson["sex"] | null): Speaker | null {
  const r = persona.reporters.find((x) => x.role === callee);
  if (!r || r.source === "agent") return null;
  const s = r.source === "family" ? persona.speakers?.family : persona.speakers?.supporter;
  if (s && s.role === callee) return s;
  return { role: callee, source: r.source, calls: callsFor(callee, r.source, sex) };
}

/**
 * 話し手の続柄に合わない文を落とす（lib/drill/speaker.ts の speakerSlip）。落としたことは名前だけログに（言葉の中身は書かない）
 */
export function dropSlips(raw: string, speaker: Speaker | null, persona: Pick<Persona, "roles">): string {
  if (!speaker || !raw.trim()) return raw;
  const others = [...persona.roles.values()];
  const kept: string[] = [];
  let dropped = 0;
  for (const s of sentencesOf(raw.replace(/\s+/g, " ").trim())) {
    if (speakerSlip(s, speaker, others)) dropped += 1;
    else kept.push(s);
  }
  if (dropped > 0) console.warn("話し手に合わない文を落とした", dropped);
  return kept.join("");
}

function doingOf(answer: PersonaAnswer, key: PseudonymKey): string | null {
  const action = cleanPersonaWords(answer.action, key, DOING_MAX);
  const condition = cleanPersonaWords(answer.condition, key, DOING_MAX, CONDITION_BANNED);
  const joined = [action, condition && condition !== action ? condition : null].filter(Boolean).join("。");
  return joined ? clipWords(joined, DOING_MAX) : null;
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
export function personaTurns(input: PersonaInput, persona: Persona, answer: PersonaAnswer, onDrop?: (rule: GateRule) => void): DrillTurn[] {
  // T130: 帳面（前の連絡・手・到着・台帳の計画から引く）。帳面と食い違う文を落とし、表の行の無い答えは帳面の門を通す
  const facts = personaFacts(persona, { person: input.person, world: input.world, state: input.state, actions: input.actions ?? [], now: nowMinuteOf(input), ahead: input.ahead ?? null });
  // 家族の話し手は自分の家族のことも話すので、いない家族の確かめは本人と支援者の言葉だけ
  const slipCtx = (source: FixedTurn["source"], place: WhereNow | null) => ({ ...slipContextOf(facts, place), ...(source === "family" ? { kin: null } : {}) });
  const factText = (raw: string | null, source: FixedTurn["source"], place: WhereNow | null): string | null => {
    if (!raw) return raw;
    const t = dropFactSlips(raw, slipCtx(source, place), onDrop).trim();
    return t ? t : null;
  };
  const doing = doingOf(answer, persona.key);
  // 話し手に合わない文（夫・妻が本人を「母」と呼ぶ、話し手でない続柄で名乗る）を落としてから掃除する（T121）
  // 前の連絡とほぼ同じ文を落とす（T158。全部同じなら元のまま。刻みの連絡は表の行の骨があるので空にしない）
  const fresh = (t: string | null): string | null => (t ? dropRepeats(t, [input.state?.saying], { keepAll: true, ...(onDrop ? { onDrop } : {}) }) : t);
  const speechBy = (source: FixedTurn["source"]) => fresh(cleanPersonaWords(dropSlips(answer.speech, speakerOf(persona, source), persona), persona.key, SPEECH_MAX));

  if (input.fixed.length > 0) {
    const fixed = [...input.fixed].sort((a, b) => eventHour(a, input.hour) - eventHour(b, input.hour));
    const lastRow = fixed[fixed.length - 1];
    // 表の行は骨（色・4 問・いる所は表のまま）。言葉だけ帳面と表の行のいる所で見る
    const rowPlace = placeOfState({ color: lastRow.color, whereNow: lastRow.whereNow ?? null, atHome: lastRow.atHome ?? null }) ?? facts.place?.where ?? null;
    const speech = factText(speechBy(lastRow.source), lastRow.source, rowPlace);
    const doingOk = factText(doing, lastRow.source, rowPlace);
    return fixed.map((f, i) => {
      const last = i === fixed.length - 1;
      const aiSaying = last ? speech : null;
      // 表のする事（「4 問の途中で止まった」「避難を渋る」）は骨なので残し、表に無ければ Haiku のする事
      const aiDoing = last && f.doing == null ? doingOk : null;
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
  const speech = speechBy(reporter.source);
  const turn = screenTurn(
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
    facts,
    onDrop,
  );
  if (!turn) return [];
  // いる所を言わない連絡（赤で家にいるかに答えない・色の分からない）は帳面のいる所で見る（T167。台の検査と同じ。前は門を抜け、避難所の人のする事に家にいる言い方が残った）
  const place = placeOfState({ color: turn.color, whereNow: turn.whereNow, atHome: turn.atHome }) ?? facts.place?.where ?? null;
  return [{ ...turn, saying: factText(turn.saying, turn.source, place), doing: factText(turn.doing, turn.source, place) }];
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
  /** 帳面の門で落とした・直した物を書き留める所（T130。engine が世界の gated に足す） */
  gates?: GateLog;
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
      const opts = { ...(deps.on ? { on: deps.on } : {}), places: personaPlaces(deps.ai, sources) };
      // T130: ケアマネに言われた事の自由の言葉は事業所の全員の鍵で伏せてから帳面に。T125: 想定に効くハザードと通信の段
      const persona: Persona = { ...buildPersona(source, { ...opts, fit: input.fit }), mask: maskWith(source, sources, opts) };
      if (input.fixed.length === 0 && !persona.reporters.some((r) => r.canPress)) return [];
      const tick = pseudonymizeText(tickText(input, persona), persona.key);
      const r = await askJson(buildPersonaRequest(persona.profile, tick, input.virtual === true), deps.ai);
      return personaTurns(input, persona, r.value, deps.gates?.hit);
    } catch (e) {
      if (e instanceof AiLimitReached) deps.stops?.hit("persona");
      // AI の層の失敗と伏せきれないは想定どおり。それ以外（台帳を読めないなど）は名前だけログに残す（中身は書かない）
      if (!isPersonaFailure(e)) console.error("本人役の 1 刻みに失敗", e instanceof Error ? e.name : typeof e);
      return fixedTurns(input);
    }
  };
}

// ---------- まとめて呼ぶ（T121） ----------
// 評価の 1 回目で、本人役は 1 区切りに 1 人 1 回を呼び、10 人・72 時間で 1 訓練の上限の大半を使った。連続の時計の区切りで呼ぶ人を
// 1 回にまとめる（lib/drill/clock.ts の PERSONA_BATCH_MAX 人まで）。人ごとの説明と刻みの文は今までどおり人ごとに仮名化して並べ、
// 返事は人ごとに今までと同じ形（PersonaSchema）で受けて、同じ personaTurns で安否にする。色と順位は今までどおり表（lib/triage）

/** まとめて呼ぶときに先に付ける指示（PERSONA_SYSTEM の前）。評価の台はこの頭で役を見分ける */
export const PERSONA_BATCH_HEAD = [
  "この呼び出しは、番号ごとに別の本人（と周りの人）をまとめて演じる。番号ごとに入力は「本人役」と「この刻み」。",
  "番号ごとに、下の決まりで 1 つずつ答え、answers に番号（id）を付けて並べる。人どうしの事を混ぜない（ほかの番号の人・出来事・言葉を使わない）。",
  "どの番号も同じ「A さん」と書かれることがあるが、それぞれ別の人。",
].join("\n");

export const PERSONA_BATCH_SYSTEM = `${PERSONA_BATCH_HEAD}\n\n${PERSONA_SYSTEM}`;

export const PersonaBatchSchema = z.object({ answers: z.array(PersonaSchema.extend({ id: z.string() })) });

/** まとめて呼ぶ要求。items は番号と、その人の説明と刻みを人ごとの鍵で伏せた文 */
export function buildPersonaBatchRequest(
  items: ReadonlyArray<{ id: string; text: ForClaude<{ text: string }> }>,
  virtual = false,
): AskJsonRequest<typeof PersonaBatchSchema> {
  const system = virtual ? `${PERSONA_BATCH_SYSTEM}\n\n${PERSONA_VIRTUAL}` : PERSONA_BATCH_SYSTEM;
  return { purpose: "persona", system, input: Object.fromEntries(items.map((x) => [x.id, x.text])), schema: PersonaBatchSchema };
}

/**
 * engine の PersonaBatchHook を作る（1 要求ごと）。入力の人ごとに、本人役の 1 刻みと同じ決め（押せる人も表の行も無い人は呼ばずに連絡なし）
 * をして、残りを 1 回の Haiku にまとめる。答えが無い・使えない人は表の固定の安否（無ければ連絡なし）。失敗は全員を同じ戻り先に
 */
export function createPersonaBatchHook(deps: PersonaDeps): PersonaBatchHook {
  let loaded: Promise<ReadonlyMap<string, PseudonymInput>> | null = null;
  return async (inputs) => {
    const out: DrillTurn[][] = inputs.map(() => []);
    const asked: Array<{ i: number; id: string; persona: Persona; text: ForClaude<{ text: string }> }> = [];
    try {
      const sources = await (loaded ??= deps.load());
      const places = personaPlaces(deps.ai, sources);
      inputs.forEach((input, i) => {
        const source = sources.get(input.person);
        if (!source) {
          out[i] = fixedTurns(input);
          return;
        }
        try {
          const opts = { ...(deps.on ? { on: deps.on } : {}), places };
          // T130: ケアマネに言われた事の自由の言葉は事業所の全員の鍵で伏せてから帳面に
          const persona: Persona = { ...buildPersona(source, { ...opts, fit: input.fit }), mask: maskWith(source, sources, opts) };
          if (input.fixed.length === 0 && !persona.reporters.some((r) => r.canPress)) return;
          const text = pseudonymizeText(`本人役:\n${persona.profile.text}\n\nこの刻み:\n${tickText(input, persona)}`, persona.key);
          asked.push({ i, id: String(asked.length + 1), persona, text });
        } catch (e) {
          if (!isPersonaFailure(e)) console.error("本人役の 1 刻みに失敗", e instanceof Error ? e.name : typeof e);
          out[i] = fixedTurns(input);
        }
      });
      if (asked.length === 0) return out;
      const virtual = asked.some((x) => inputs[x.i].virtual === true);
      const r = await askJson(buildPersonaBatchRequest(asked, virtual), deps.ai);
      const byId = new Map(r.value.answers.map((a) => [a.id.trim(), a] as const));
      for (const x of asked) {
        const a = byId.get(x.id);
        out[x.i] = a ? personaTurns(inputs[x.i], x.persona, a, deps.gates?.hit) : fixedTurns(inputs[x.i]);
      }
      return out;
    } catch (e) {
      if (e instanceof AiLimitReached) deps.stops?.hit("persona");
      if (!isPersonaFailure(e)) console.error("本人役のまとめた呼び出しに失敗", e instanceof Error ? e.name : typeof e);
      return inputs.map((input, i) => (out[i].length > 0 ? out[i] : fixedTurns(input)));
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
  // 規制（T125）: かけ直せば時々つながる。全部は止めない
  down: { answers: 0.3, background: 0.1 },
};

/** メッセージ（T125）の返信・既読の割合（通話の様子によらない。電波不通・携帯なしは届かない） */
export const MESSAGE_READ_ODDS = { replied: 0.5, read: 0.25 } as const;

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
  /** この人への手（メモを落とした物、T158）。あれば帳面を刻みの道と同じに引く（通話の往復が渡す） */
  actions?: ReadonlyArray<ActionRecord>;
};

/** 伝える様子の文（Claude に渡す文。画面の言葉ではない） */
function tellWords(t: NonNullable<PersonaCall["tell"]>): string {
  if (t.color === "red") return `${COLOR_WORDS.red}。${answersWords(t)}`;
  return t.whereNow ? `${COLOR_WORDS.green}。いる所 ${WHERE_WORDS[t.whereNow]}` : COLOR_WORDS.green;
}

/**
 * 通話・往復・訪問の決まり（T123）。刻みの決まり 10 と同じ筋を、通話と訪問の道にも。評価の 2 回目で、通話の道だけ時計の段とこの決まりが無く、
 * 切れたあとも同じ調子で話す・前に動けないと言った本人が手も人も無いまま動けると言う、が残った
 */
export const PATH_RULE =
  "「今の様子」「持ちこたえる時間の今」「前の連絡」と食い違う事を言わない（来た人・届いた物・復旧した物を、まだと言わない。切れた分を、まだ残ると言わない。前の連絡で動けない・けがと言った本人が、人が来た・手が届いたのでなければ、急に動ける・無事と言わない）。「人ごとの事実」（いる所・同居の人・声・電気と予備）と「計画」とも食い違わない。「ケアマネに言われた事」は覚えて従い、従えない時は理由を言う。";

export const CALL_SYSTEM = [
  "災害の訓練で、ケアマネからの電話に出た人を演じる。人は全部架空。",
  "入力は JSON。「本人役」は本人と周りの人の説明、「電話」は今の時刻・状況・前の連絡・電話に出た人。",
  `電話に出た人が言う事を speech に 1〜2 文・${SPEECH_ASK} 字までで返す（文の途中で終えない）。ケアマネは「大丈夫ですか。今どこにいますか」と聞いている。`,
  "「伝える様子」があれば、その様子と食い違わない事を言う（無事なのにけがをしたと言わない、けがなのに無事と言わない）。",
  PATH_RULE,
  "本人はやさしい短い話し言葉。認知症の本人は話が噛み合わないことがある。家族・支援者はその人の口調。",
  "名前・住所・電話番号を言わない。「A さん」とも言わない。「診断」「判定」「重症」「死亡」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。",
].join("\n");

/**
 * 電話に出た人の返事の形（T93 で頼み事を足した）。asks は頼み事の種類の英字（ASK_KINDS の閉じた一覧。外の値はコードが捨てる）。
 * 最初の言葉（act の通話）は言葉だけを使い、頼み事は往復と訪問から積む。省略可（言葉だけの返事も通す）
 */
export const CallSchema = z.object({ speech: z.string(), asks: z.array(z.string()).optional() });

/** 電話に出た人の本人の呼び方（「（本人を「母」と呼ぶ）」）。本人・分からない人は空（T121） */
function calleeCalls(persona: Persona, callee: string): string {
  const s = calleeSpeaker(persona, callee, persona.sex ?? null);
  return s && !(s.calls.length === 1 && s.calls[0] === "本人") ? `（本人を「${s.calls.join("」「")}」と呼ぶ）` : "";
}

export function callText(call: PersonaCall, persona: Persona): string {
  const now = Math.round(call.hour * 60);
  return [
    `時刻: 発災から ${clockLabel(now)}`,
    ...(call.night ? [nightLine(call.hour)] : []),
    ["今の様子:", ...[...worldWords(call.world, call.person, persona, now), ...advisedWords(call.world, call.person)].map((x) => `- ${x}`)].join("\n"),
    // T123: 通話（最初の言葉・往復）にも持ちこたえる時間の今。評価の 2 回目で、通話の道だけ時計の段が無く、切れたあとも同じ調子で話した
    ...clockLines(persona, call.world, call.person, now),
    // T130: 帳面と計画（刻みの道と同じ）
    factsBlock(personaFacts(persona, { person: call.person, world: call.world, state: call.state, actions: call.actions ?? [], now })),
    `この刻みの状況: ${ownIncidents(call.incidents, call.person).map((e) => e.text).join("、") || "新しい事はない"}`,
    `前の連絡: ${stateWords(call.state)}`,
    `電話に出た人: ${call.callee}${calleeCalls(persona, call.callee)}`,
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
  // T130: 家族・支援者が本人の声が無いと伝えたあと、人が来るまで本人は電話で話さない（物音だけ。Claude を呼ばない）
  const facts = personaFacts(persona, { person: call.person, world: call.world, state: call.state, now: Math.round(call.hour * 60) });
  if (call.callee === "本人" && facts.voiceLost) return { pickup: "background_only", speech: null, ai: false };
  try {
    const text = pseudonymizeText(callText(call, persona), persona.key);
    const r = await askJson(buildPersonaCallRequest(persona.profile, text), ctx);
    // 電話に出た人の続柄に合わない文を落とす（T121）。帳面と食い違う文も（T130）
    const speaker = calleeSpeaker(persona, call.callee, persona.sex ?? null);
    const said = dropFactSlips(dropSlips(r.value.speech, speaker, persona), { ...slipContextOf(facts), ...(speaker?.source === "family" ? { kin: null } : {}) });
    const speech = cleanPersonaWords(said, persona.key, SPEECH_MAX);
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
  `- speech: 電話に出た人が言う事。1〜2 文・${SPEECH_ASK} 字まで（文の途中で終えない。電話の 1 回の返事なので短く）。それまでの話と食い違わない。`,
  `- asks: 頼み事。次の一覧から 0〜${TALK_ASKS_MAX} つの英字。${ASK_LIST}。言葉で頼んだ事と合わせる。無ければ空の配列。`,
  "「伝える様子」があれば、その様子と食い違わない事を言う（無事なのにけがをしたと言わない、けがなのに無事と言わない）。",
  PATH_RULE,
  "119 に電話するよう勧められたら、かけるか・かけないかを言葉で言う（どちらにするかは自分で決める）。救急が来た先の事は言わない。",
  "この電話でもう言った事（頼み事・いる所・残りの数・する事）はくり返さない。同じ事をまた聞かれたら、短く別の言い方で答える。頼み事はこの電話で 1 回だけ（済んでいなければ、次の電話でまた頼んでよい）。",
  "ケアマネの言葉が相づち（「はい」）・待ってほしい・聞き取れない・話と関係ない時は、1 文だけで短く返す（待つ・聞き返す・分からないと言う）。前の返事をくり返さない。",
  "いる所は「人ごとの事実」のいる所のまま。この電話で言ったいる所・する事（119 にかける など）と食い違わない。",
  "ケアマネが後で電話すると言ったら、短く返して終える。",
  "「電話の向き」が「相手から」のときは、電話に出た人がケアマネに掛けた電話の続き。最初に言った事は、その人が掛けて言った事。",
  "本人はやさしい短い話し言葉。認知症の本人は話が噛み合わないことがある。家族・支援者はその人の口調。",
  "名前・住所・電話番号を言わない。「A さん」とも言わない。「診断」「判定」「重症」「死亡」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。",
].join("\n");

/**
 * 往復の 1 回に渡す物。first は最初の言葉、lines はそれまでの往復、said はケアマネの今の言葉（決まった問いの言葉か、伏せる前の自由の文）。
 * incoming は相手から掛けてきた電話（T127。着信の往復）
 */
export type PersonaTalk = PersonaCall & { first: string | null; lines: ReadonlyArray<TalkLine>; said: string; incoming?: boolean };

/** この電話でもう頼んだ事の種類（T158。電話に出た人の行の asks。並びは頼んだ順） */
export function talkAsked(lines: ReadonlyArray<TalkLine>): AskKind[] {
  const out: AskKind[] = [];
  for (const l of lines) if (l.who === "them") for (const k of l.asks ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

/** 前の返事と同じ事しか言わなかった時の短い返事（T158。この電話でまだ言っていない物から） */
export const TALK_REPEAT_ACKS = ["はい、さっきお話しした通りです。", "はい、先ほどと同じです。", "はい、そのままです。"] as const;

/**
 * この電話の前の返事（電話に出た人の AI の返事。T158 の繰り返しの門が見る）。最初の言葉は入れない（「今どこですか」と聞かれて最初に言ったいる所を
 * 答えるのは繰り返しではない。評価の台の数え方と同じ）
 */
export function talkPrior(lines: ReadonlyArray<TalkLine>): string[] {
  return lines.filter((l) => l.who === "them" && l.ai).map((l) => l.text);
}

/** 往復の文（Claude に渡す前。呼ぶ側が仮名化の門を通す） */
export function talkText(talk: PersonaTalk, persona: Persona): string {
  const who = (l: TalkLine) => (l.who === "cm" ? "ケアマネ" : talk.callee);
  return [
    callText(talk, persona),
    ...(talk.incoming ? ["電話の向き: 相手から（電話に出た人がケアマネに掛けた）"] : []),
    `最初に言った事: ${talk.first ? `「${talk.first}」` : "なし"}`,
    talk.lines.length > 0 ? ["それまでの話:", ...talk.lines.map((l) => `- ${who(l)}: 「${l.text}」`)].join("\n") : "それまでの話: なし",
    // T158: この電話でもう頼んだ事（くり返さない）
    ...(talkAsked(talk.lines).length > 0 ? [`この電話でもう頼んだ事（くり返さない）: ${talkAsked(talk.lines).map((k) => ASK_MEANINGS[k]).join("・")}`] : []),
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

/**
 * 往復の 1 回（Haiku × 1 回）。talk は伏せた文（呼ぶ側が事業所の全員の鍵で pseudonymizeText を通した物）。key はその鍵
 * （返事の掃除と町名の戻し）。失敗は言葉なし（呼ぶ側が固定の言葉に）
 */
export async function personaTalkReply(
  persona: Persona,
  talk: ForClaude<{ text: string }>,
  key: PseudonymKey,
  ctx: AskJsonContext,
  /** 帳面（T130）。あれば帳面と食い違う文と、電気が戻ったあとの電池・電源の頼み事を落とす */
  facts?: Facts,
  /**
   * この電話の前の言葉と頼み事（T158、talkPrior・talkAsked）。あれば前の返事とほぼ同じ文と、もう頼んだ頼み事を落とす。全部が前の返事と同じなら
   * 短い返事（TALK_REPEAT_ACKS のうちまだ言っていない物）に。Claude をもう一度呼ばない
   */
  prior?: { said: ReadonlyArray<string>; asked: ReadonlyArray<AskKind> },
): Promise<TalkReplyWords> {
  try {
    const r = await askJson(buildPersonaTalkRequest(persona.profile, talk), ctx);
    const raw = facts ? dropFactSlips(r.value.speech, { ...slipContextOf(facts), kin: null }) : r.value.speech;
    let speech = cleanPersonaWords(raw, key, SPEECH_MAX);
    if (speech !== null && prior && prior.said.length > 0) {
      const fresh = dropRepeats(speech, prior.said).trim();
      speech = fresh || (TALK_REPEAT_ACKS.find((a) => !prior.said.includes(a)) ?? TALK_REPEAT_ACKS[0]);
    }
    const asks = asksOf(r.value.asks, TALK_ASKS_MAX).filter((k) => !(prior?.asked ?? []).includes(k));
    return speech === null ? { speech: null, asks: [], ai: false } : { speech, asks: facts ? screenAsks(asks, facts) : asks, ai: true };
  } catch (e) {
    if (isPersonaFailure(e)) return { speech: null, asks: [], ai: false };
    throw e;
  }
}

// ---------- 訪問の様子（T93。lib/drill/hooks.ts の visit の口） ----------

export const VISIT_SYSTEM = [
  "災害の訓練で、ケアマネが本人のいる所を訪ねて着いたときの、本人と周りの人の様子を演じる。人は全部架空。",
  "入力は JSON。「本人役」は本人と周りの人の説明、「訪問」は今の時刻・状況・前の連絡。",
  "返す物:",
  `- condition: 着いたケアマネが見て分かる本人の様子（${VISIT_CONDITION_MAX} 字まで）。どこで何をしているか・部屋や周りの様子。体の具合や病名を言い切らない。`,
  "- location: 本人がいる所。home（家）・shelter（避難所）・other（その他）・unknown のどれか 1 つの英字。",
  `- asks: 本人か家族の頼み事。次の一覧から 0〜${VISIT_ASKS_MAX} つの英字。${ASK_LIST}。無ければ空の配列。`,
  `- speech: 本人か家族がケアマネに言う事。1〜2 文・${SPEECH_ASK} 字まで（文の途中で終えない）。`,
  PATH_RULE,
  "本人はやさしい短い話し言葉。認知症の本人は話が噛み合わないことがある。家族・支援者はその人の口調。",
  "名前・住所・電話番号を言わない。「A さん」とも言わない。「診断」「判定」「重症」「死亡」と言わない。病名を言い切らない。薬の量を言わない。助言をしない。",
].join("\n");

/** 訪問の返事の形。location は本人役の今の様子と並べて読むだけで、聞いた安否（色・いる所）はコードが決める */
export const VisitSchema = z.object({ condition: z.string(), location: z.string(), asks: z.array(z.string()), speech: z.string() });

export type PersonaVisit = Pick<PersonaInput, "person" | "hour" | "world" | "incidents" | "state" | "night">;

export function visitText(v: PersonaVisit, persona: Persona): string {
  const now = Math.round(v.hour * 60);
  return [
    `時刻: 発災から ${clockLabel(now)}`,
    ...(v.night ? [nightLine(v.hour)] : []),
    ["今の様子:", ...[...worldWords(v.world, v.person, persona, now), ...advisedWords(v.world, v.person)].map((x) => `- ${x}`)].join("\n"),
    // T123: 訪問にも持ちこたえる時間の今（通話と同じ）
    ...clockLines(persona, v.world, v.person, now),
    // T130: 帳面と計画（刻みの道と同じ）
    factsBlock(personaFacts(persona, { person: v.person, world: v.world, state: v.state, now })),
    `この刻みの状況: ${ownIncidents(v.incidents, v.person).map((e) => e.text).join("、") || "新しい事はない"}`,
    `前の連絡: ${stateWords(v.state)}`,
    `ケアマネが${visitPlaceWords(personaFacts(persona, { person: v.person, world: v.world, state: v.state, now }))}に着いた。`,
  ].join("\n");
}

/**
 * 訪問で着いた所（T167）。帳面のいる所へ行く。評価の 8 回目で、避難所へ移った人の訪問がいつも「家に着いた」で、本人が家にいない様子のあとに会えた話が続いた。行き先の分からない人は家に着く（本人はいない）。名前を書かない
 */
function visitPlaceWords(f: Facts): string {
  const p = f.place;
  if (!p || p.where === "home") return "家";
  if (p.by === "wandering") return "家（本人は家にいない）";
  if (p.where === "shelter") return "本人のいる避難所";
  return (p.by === "plan" || p.by === "transport") && f.plan?.destination === "hospital" ? "本人のいる病院" : "本人のいる所";
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
    // T130: 帳面と食い違う文と、電気が戻ったあとの電池・電源の頼み事を落とす（訪問は本人のいる所へ。T167 で帳面のいる所に。分からなければ家）
    const facts = personaFacts(persona, { person: visit.person, world: visit.world, state: visit.state, now: Math.round(visit.hour * 60) });
    const slip = { ...slipContextOf(facts, facts.place?.where ?? "home"), kin: null };
    const condition = cleanPersonaWords(dropFactSlips(r.value.condition, slip), persona.key, VISIT_CONDITION_MAX, CONDITION_BANNED);
    const speech = cleanPersonaWords(dropFactSlips(r.value.speech, slip), persona.key, SPEECH_MAX);
    const asks = screenAsks(asksOf(r.value.asks, VISIT_ASKS_MAX), facts);
    if (condition === null && speech === null && asks.length === 0) return null;
    return { condition, asks, speech, ai: true };
  } catch (e) {
    if (isPersonaFailure(e)) return null;
    throw e;
  }
}
