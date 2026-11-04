// 訓練の監督（docs/tasks/T19.md）。世界の状態（道路・停電・電話の不通・職員の空き・避難所の様子・本人ごとの印）と、
// 刻みごとの差し込み。形は「決まった流れ＋判断点 1 つ」（Building Effective Agents の workflow）:
// - 決まった流れ: 想定の表（lib/drill/scenarios.ts）の出来事と固定の差し込みを順に当てる（Claude を呼ばない。engine の step）
// - 判断点 1 つ: この刻みで、この事業所の台帳の弱点（空欄・支援者なし・残り時間の短さ）に合わせて差し込む状況を 0〜差し込める数
//   （DirectorInput.budget、無ければ 2）。Opus に 1 刻み 1 回だけ、決まった JSON で { events: [{ target, kind, text, reason, basis, after }] }
//
// 守ること:
// - Claude に渡すのは lib/pseudonym を通した物だけ。本人は仮名（A さん）、渡すのは世界の様子と台帳の弱点の要約だけ
//   （氏名・住所・電話・町名・避難先の名前を渡さない。色・順位も渡さない）
// - 監督に色・順位を決めさせない。差し込みは種類（出来事の表 lib/drill/event-catalog.ts）と相手を選ぶだけで、
//   世界の変化は表の build（コード）が組み、色と順位は安否と台帳の時計を lib/triage の表に流して決まる
// - 種類は表の物だけ（T92 で 6 → 26）。表の外・その人に当てはまらない種類（栄養剤は経管栄養の人だけ、など）・知らない仮名は捨てる。
//   全体の種類（停電の見込み・余震など）は target が「全体」、予定の種類は after（何時間後、表の範囲）
// - 根拠は表が 1 つに決める種類はコードが付ける（監督に選ばせない）。監督が選ぶのは DIRECTOR_SOURCES（前からの 5 つと、T104 の時間の目安の 5 つ）の中で表の行が許す物か根拠なし
// - 失敗（鍵なし・上限・断られた・形の違い・呼び出しの失敗・伏せきれない・台帳を読めない）は差し込みなし（表の固定の状況だけで進む）
// - ケアマネの手（T20）への世界の返事は、確率をこの表で先に決め、Opus は文だけ（worldReply。本物の文は T20）

import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { AiLimitReached } from "../claude/errors.ts";
import type { DrillAction } from "../db/types.ts";
import { EXTRA_PENDING_LABELS, intakeField } from "../intake/fields.ts";
import { CARE_LEVEL_LABELS, CONTACT_KIND_LABELS, DEVICE_LABELS, HOUSEHOLD_LABELS, MEDICATION_CATEGORY_LABELS } from "../labels.ts";
import {
  pseudonymize,
  pseudonymizeText,
  restoreText,
  type ClaudePerson,
  type ForClaude,
  type PseudonymInput,
  type PseudonymKey,
} from "../pseudonym/index.ts";
import { isSourceId, type SourceId } from "../sources/index.ts";
import { NO_BASIS } from "../sources/prompt.ts";
import { clockRemaining, formatHours, type Situation, type TriageClock } from "../triage/index.ts";
// world-reply.ts は engine.ts より先に読む（engine → outcome → score → actions → director の輪で、actions.ts が
// 世界の返事の言葉を読むときに初期化済みにしておく）
import { WORLD_REPLY_LABELS } from "./world-reply.ts";
import { CATALOG_WORDS } from "./action-catalog.ts";
import {
  DIRECTOR_MAX,
  type DirectorEvent,
  type DirectorHook,
  type DirectorInput,
  type DirectorResult,
  type PersonState,
  type ReplyAsk,
  type ReplyWords,
  type StopLog,
} from "./engine.ts";
import { CALL_STATUS_LABELS, PHONE_LABELS, SHELTER_LABELS, TSUNAMI_LABELS, WATER_LABELS } from "./labels.ts";
import { nightLine } from "./night.ts";
import { hourText, minuteText as minuteWords } from "./time-text.ts";
import { areaOf, placesOf } from "./area.ts";
import { cleanWords, isPersonaFailure, reportersOf } from "./persona.ts";
import {
  afterOf,
  ARRIVAL_ROLE_LABELS,
  EVENT_CATALOG,
  eligibleAreaKinds,
  eligibleSelfKinds,
  SELF_DRILL_MAX,
  INJECT_KINDS,
  isInjectKind,
  markWords,
  SUPPLY_LABELS,
  type EventSource,
  type InjectKind,
} from "./event-catalog.ts";
import { scenarioOf, type AskKind, type PersonMarks, type WorldState } from "./scenarios.ts";
import { homeFacts, homeWords } from "./self.ts";
import { timelineText } from "./timeline.ts";

// ---------- 世界 → ルールの表の入力 ----------
// lib/drill/world-clocks.ts へ移した（T90 の準備）。前からの import を壊さないよう、同じ名前をここからも出す

export { drillClocks, type ClockForWorld } from "./world-clocks.ts";

// ---------- 差し込める種類（台帳と世界から。コードで決める） ----------

/**
 * この本人に差し込める本人の種類（出来事の表 lib/drill/event-catalog.ts の eligible。表の並び）。その人に当てはまり、まだ起きていない物だけ。
 * 栄養剤は経管栄養の時計がある人、透析施設は透析の時計がある人、訪問看護は訪問看護の連絡先がある人、
 * 家に帰ろうとするのは家の外（避難所・その他）にいると連絡のあった人、ほかは表の行の注。
 * 全体の種類（停電の見込み・余震など）はここに入れない（eligibleAreaKinds）
 */
export function eligibleKinds(source: EventSource, person: string, world: WorldState, state: PersonState | null): InjectKind[] {
  return INJECT_KINDS.filter((k) => {
    const row = EVENT_CATALOG[k];
    return row.scope === "person" && row.eligible(source, person, world, state);
  });
}

// ---------- 想定の文と弱点の要約（Claude に渡す前に pseudonymizeText で伏せる） ----------

/** 本人ごとの印の言い方（指示の文。出来事の表の markWords） */
const MARK_WORDS: Readonly<Record<keyof PersonMarks, string>> = markWords;

/** 頼み事の言い方（指示の文） */
const ASK_WORDS: Readonly<Record<AskKind, string>> = {
  medicine: "薬",
  water: "水",
  food: "食事",
  power: "電源",
  transport: "移送",
  family_contact: "家族連絡",
  battery: "電池",
  toilet: "便所",
  warmth: "保温",
};

const SCENE_WORDS = { heavy_rain: "大雨（警戒レベル 3 → 4 → 浸水）", earthquake: "地震（南海トラフ 震度 6強・津波・停電）" } as const;

const SOURCE_WORDS = { agent: "本人", family: "家族", supporter: "支援者" } as const;
const COLOR_WORDS = { red: "赤（無事じゃない）", green: "緑（無事）", unknown: "連絡（安否は不明）" } as const;
const WHERE_WORDS = { home: "家", shelter: "避難所", other: "その他" } as const;

/** 世界の様子と、この刻みの状況。本人に関わる物は仮名で書く（aliasOf: 台帳の id → 仮名） */
export function sceneText(input: DirectorInput, aliasOf: ReadonlyMap<string, string>, last: number): string {
  const w = input.world;
  const who = (p: string | null | undefined) => (p && aliasOf.has(p) ? aliasOf.get(p)! : null);
  const now: string[] = [];
  if (w.alertLevel) now.push(`警戒レベル ${w.alertLevel}`);
  if (w.quake) now.push(`地震 震度 ${w.quake}`);
  if (w.tsunami !== "none") now.push(`津波 ${TSUNAMI_LABELS[w.tsunami]}`);
  if (w.flood) now.push("川が氾濫（浸水 3 m の想定の地区で浸水）");
  if (w.outage) {
    const o = w.outage;
    const area = o.area.scope === "office" ? "全域" : "浸水 3 m の想定の地区";
    now.push(o.restoredAt != null ? `停電 復旧（${hourText(o.restoredAt)}）` : `停電中（${hourText(o.since)}から、${area}）`);
  }
  now.push(`電話 ${PHONE_LABELS[w.phone]}`);
  if (w.water !== "none") now.push(`断水 ${WATER_LABELS[w.water]}`);
  for (const r of w.roads) now.push(`${r.label} ${r.open ? "通行可" : "通行止"}${who(r.person) ? `（${who(r.person)}の家の近く）` : ""}`);
  for (const s of w.shelters) now.push(`${s.label} ${SHELTER_LABELS[s.state]}`);
  for (const f of w.facilities) now.push(`${f.label} ${f.open ? "稼働" : "休止"}${who(f.person) ? `（${who(f.person)}が通う所）` : ""}`);
  now.push(`職員の空き ${w.staff} 人`);
  for (const [person, marks] of Object.entries(w.marks)) {
    const a = who(person);
    if (!a) continue;
    for (const [k, at] of Object.entries(marks) as Array<[keyof PersonMarks, number | undefined]>) {
      if (at !== undefined) now.push(`${a}: ${MARK_WORDS[k]}（${at} 時間から）`);
    }
  }
  // 予定の出来事（T92。停電の復旧の見込み・電話の回復の見込み）。同じ見込みを重ねて差し込まないために見せる
  for (const s of w.scheduled ?? []) now.push(`予定: ${s.text}（${minuteWords(s.at)}${who(s.person) ? `、${who(s.person)}` : ""}）`);
  const kind = scenarioOf(input.scenario).kind;
  return [
    `想定: ${SCENE_WORDS[kind]}`,
    `時刻: 発災から ${minuteWords(input.hour * 60)}（${last} 時間まで）`,
    `差し込める数: ${budgetOf(input)}`,
    // 夜間発災（T59）だけ。時刻の 1 行
    ...(input.night ? [nightLine(input.hour)] : []),
    // 発災からの時間の帯の目安（T104、lib/drill/timeline.ts）。種類と出典の id を添える
    timelineText(input.hour, { with: "director" }),
    ["今の様子:", ...now.map((x) => `- ${x}`)].join("\n"),
    input.incidents.length > 0
      ? ["この刻みの状況:", ...input.incidents.map((e) => `- ${e.text}${who(e.person) ? `（${who(e.person)}）` : ""}`)].join("\n")
      : "この刻みの状況: 新しい事はない",
  ].join("\n");
}

const pick = <T extends string>(labels: Readonly<Record<T, string>>, v: string | null | undefined): string | null =>
  v != null && Object.prototype.hasOwnProperty.call(labels, v) ? labels[v as T] : null;

/** 空欄の欄の名前（台帳の pending と、避難の大事な欄の空き）。分からない欄は区分の名前 */
function blanksOf(p: ClaudePerson): string[] {
  const out = new Set<string>();
  for (const x of p.pending) {
    const label = intakeField(x.field)?.label ?? pick(EXTRA_PENDING_LABELS, x.field);
    if (label) out.add(label);
    else if (x.field.startsWith("medical")) out.add("医療の欄");
    else if (x.field.startsWith("evacuation")) out.add("避難の欄");
    else if (x.field.startsWith("people")) out.add("人の欄");
    else out.add("ほかの欄");
  }
  if (!p.evacuation.destination1) out.add("避難先");
  if (!p.evacuation.transport) out.add("避難の手段");
  if (p.evacuation.carryItems.length === 0) out.add("持ち出す物");
  return [...out];
}

/** 時刻の計算だけに使う基準（実際の時刻は渡さない） */
const BASE = Date.UTC(2026, 0, 1);
const at = (h: number) => new Date(BASE + h * 3_600_000).toISOString();

/** この本人の時計の残り（停電の地区に入るかは本人のハザードで見る） */
function clocksOf(p: ClaudePerson, world: WorldState, hour: number): string[] {
  const o = world.outage;
  const inArea =
    o !== null &&
    (o.area.scope === "office" ||
      p.evacuation.hazards.some((h) => o.area.scope === "hazard" && h.kind === o.area.hazard && (h.depthM ?? 0) >= o.area.minDepthM));
  const s: Situation = { now: at(hour), disasterAt: at(0), outageAt: inArea ? at(o!.since) : null };
  return p.clocks.flatMap((k): string[] => {
    if (k.kind === "condition" || k.startsOn === "none") return [];
    if (k.value == null || k.unit == null) return [`${k.label} 残り 未確認`];
    const clock: TriageClock = { kind: k.kind, category: k.category, label: k.label, value: k.value, unit: k.unit, starts_on: k.startsOn };
    const r = clockRemaining(clock, s);
    if (!r) return [];
    if (!r.running) return [`${k.label} ${formatHours(r.hours)}（停電で減る。まだ減っていない）`];
    return [r.over ? `${k.label} ${formatHours(r.hours)}を超過` : `${k.label} 残り ${formatHours(r.remaining)}`];
  });
}

function stateWords(s: PersonState | null): string {
  if (!s) return "連絡なし";
  const where = s.whereNow ? `（${WHERE_WORDS[s.whereNow]}）` : "";
  return `${hourText(s.at)}に${SOURCE_WORDS[s.source]}が${COLOR_WORDS[s.color]}${where}`;
}

export type WeakEntry = {
  person: string;
  claude: ClaudePerson;
  source: PseudonymInput;
  state: PersonState | null;
  kinds: ReadonlyArray<InjectKind>;
};

const DEPENDS_WORDS = { dialysis_center: "透析先", refrigeration: "冷蔵", delivery: "配達", storage: "保管" } as const;
const CHECK_WORDS = { confirmed: "確認済", unconfirmed: "未確認" } as const;

/**
 * 本人ごとの T90 の準備の欄（頼み事の未対応・届いた物・向かっている人・確認の上書き）。無い欄は書かない。
 * 本人の体の様子は書かない（世界と手の事実だけ）
 */
function sharedLines(world: WorldState, person: string): string[] {
  const out: string[] = [];
  const open = (world.asks?.[person] ?? []).filter((a) => a.done === null).map((a) => ASK_WORDS[a.kind]);
  if (open.length > 0) out.push(`  頼み事（未対応）: ${[...new Set(open)].join("、")}`);
  const got = Object.entries(world.supplies?.[person] ?? {}).flatMap(([k, at]) =>
    typeof at === "number" ? [`${SUPPLY_LABELS[k as keyof typeof SUPPLY_LABELS]}（${minuteWords(at)}）`] : [],
  );
  if (got.length > 0) out.push(`  届いた物: ${got.join("、")}`);
  const coming = (world.arrivals ?? [])
    .filter((a) => a.person === person && !a.arrived)
    .map((a) => `${ARRIVAL_ROLE_LABELS[a.role]}（${minuteWords(a.arrive)}ごろ）`);
  if (coming.length > 0) out.push(`  向かっている人: ${coming.join("、")}`);
  const checks = Object.entries(world.checks?.[person] ?? {}).flatMap(([d, c]) =>
    c ? [`${DEPENDS_WORDS[d as keyof typeof DEPENDS_WORDS]} ${CHECK_WORDS[c]}`] : [],
  );
  if (checks.length > 0) out.push(`  確認: ${checks.join("、")}`);
  return out;
}

/**
 * 本人ごとの台帳の弱点の要約（仮名・年齢・介護度・医療・残り時間・空欄・支援者・押せる人・今の安否・頼み事・届いた物・向かっている人・
 * 確認・差し込める種類）と、全体に差し込める種類（T92。area が無ければ書かない）
 */
export function weaknessText(
  entries: ReadonlyArray<WeakEntry>,
  world: WorldState,
  hour: number,
  area?: ReadonlyArray<InjectKind>,
  self?: SelfLine,
): string {
  const lines = entries.map((e) => {
    const p = e.claude;
    const head = [
      p.age != null ? `${p.age} 歳` : null,
      pick(CARE_LEVEL_LABELS, p.care.careLevel),
      pick(HOUSEHOLD_LABELS, p.household),
      p.care.bedridden ? "寝たきり" : null,
      p.care.dementia ? "認知症" : null,
    ].filter(Boolean);
    const medical = [
      ...p.medical.devices.map((d) => pick(DEVICE_LABELS, d.kind) ?? d.kind),
      ...p.medical.medications.flatMap((m) => {
        const c = pick(MEDICATION_CATEGORY_LABELS, m.category);
        return c && m.category !== "other" ? [c] : [];
      }),
    ];
    const supporters = p.contacts.filter((c) => c.supporterOrder != null).length;
    const pressers = reportersOf(e.source)
      .filter((r) => r.canPress)
      .map((r) => r.role);
    const blanks = blanksOf(p);
    const clocks = clocksOf(p, world, hour);
    return [
      `- ${p.alias}: ${head.join("、") || "（基本の欄なし）"}`,
      `  医療: ${medical.length > 0 ? [...new Set(medical)].join("、") : "なし"}`,
      `  残り時間: ${clocks.length > 0 ? clocks.join("、") : "なし"}`,
      `  空欄: ${blanks.length > 0 ? blanks.join("、") : "なし"}`,
      `  支援者: ${supporters > 0 ? `${supporters} 人` : "なし"}`,
      `  スマホで押せる人: ${pressers.length > 0 ? pressers.join("、") : "いない"}`,
      `  今の安否: ${stateWords(e.state)}`,
      ...sharedLines(world, e.person),
      `  差し込める種類: ${e.kinds.length > 0 ? e.kinds.join("、") : "なし"}`,
    ].join("\n");
  });
  return [
    "本人ごとの弱点:",
    ...lines,
    ...(area ? [`全体に差し込める種類: ${area.length > 0 ? area.join("、") : "なし"}`] : []),
    // 訓練する人（自分）の事（T104）。連続の時計の大雨想定・地震想定だけ（self が無ければ書かない）
    ...(self
      ? [
          `訓練する人（自分）: 住む所 ${self.home}。自分に差し込める種類: ${self.kinds.length > 0 ? self.kinds.join("、") : "なし"}（訓練に多くて ${SELF_DRILL_MAX} つ）`,
        ]
      : []),
  ].join("\n");
}

/** 弱点の文の自分の行（T104）。home は別名と地形の一言（lib/drill/self.ts の homeWords）、kinds は今差し込める自分の種類 */
export type SelfLine = { home: string; kinds: ReadonlyArray<InjectKind> };

/** この区切りで差し込んでよい数（T90 の budget。0〜3。無ければ DIRECTOR_MAX） */
export function budgetOf(input: Pick<DirectorInput, "budget">): number {
  const b = input.budget;
  return typeof b === "number" && Number.isFinite(b) ? Math.max(0, Math.min(3, Math.floor(b))) : DIRECTOR_MAX;
}

// ---------- 指示と返事の形 ----------

/**
 * 監督が根拠に引ける出典（登録簿の id）。返事の basis はこの中か「根拠なし」。
 * 前からの 5 つに、発災からの時間の目安（T104、lib/drill/timeline.ts）の文書を足した（停電・通信・水道・避難所。健康の助言の文書は入れない）
 */
export const DIRECTOR_SOURCES = [
  "cao-shishin-2021",
  "mhlw-bcp-2020",
  "nanbyo-shishin-2017",
  "jadp-dialysis-2023",
  "mhlw-dementia-2018",
  // T104
  "soumu-iburi-2019",
  "soumu-tsushin-2026",
  "mhlw-water-2016",
  "cao-hinanjo-2016",
  "cao-fukushi-2021",
] as const satisfies ReadonlyArray<SourceId>;

/** 指示の種類の 1 行（出来事の表から。本人か全体か自分か、予定の種類は after の範囲） */
function kindLine(k: InjectKind): string {
  const r = EVENT_CATALOG[k];
  const after = r.after ? `。after ${r.after.min}〜${r.after.max} 時間` : "";
  return `- ${k}（${r.self ? "自分" : r.scope === "area" ? "全体" : "本人"}）: ${r.words}${after}`;
}

/** 監督の指示を出来事の表から作る（種類の数・中身・何時間後の範囲は表のまま） */
export const DIRECTOR_SYSTEM = [
  "災害の訓練（発災から 72 時間）の監督。ケアマネが担当する在宅の高齢者（人は全部架空）の訓練で、想定の表の状況に加えて、",
  "この事業所の台帳の弱点を突く小さな状況を差し込む。差し込みはケアマネの対応を試すためで、ケアマネが動けば確かめられる・防げる大きさにする。",
  "入力は JSON。「想定」は今の時刻・この刻みに差し込める数・この時間帯に起きやすい事（公的な資料の目安）・世界の様子・この刻みの状況、",
  "「弱点」は本人ごとの台帳の弱点の要約と、その人に差し込める種類と、全体に差し込める種類（あれば訓練する人〔自分〕に差し込める種類）。",
  "",
  "返す JSON:",
  "- events: 差し込む状況の配列。0 個から「想定」の「差し込める数」まで。差し込まない刻みがあってよい。",
  "  - target: 本人の種類は本人の仮名（「A さん」。「弱点」にある人だけ）。全体の種類は「全体」。自分の種類は「自分」。",
  "  - kind: 種類の英字。本人の種類はその本人の「差し込める種類」、全体の種類は「全体に差し込める種類」、自分の種類は「自分に差し込める種類」にある物だけ。",
  "  - text: 画面に出す 1 行（25 字まで）。「家族が栄養剤を持ち出し忘れた」の形。仮名・名前・場所の名前を書かない（画面が名前を添える）。",
  "  - reason: その本人とその種類を選んだ理由。突いた弱点（空欄・支援者なし・残り時間の短さ・連絡なし）を書く（80 字まで）。",
  `  - basis: 根拠の出典の id。当てはまる物が無ければ「${NO_BASIS}」。`,
  "  - after: 予定の種類（after の範囲が書いてある種類）だけ、何時間後かの整数。ほかの種類は省く。",
  "",
  `種類（kind）はこの ${INJECT_KINDS.length} だけ。表に無い状況は作らない（本人は本人 1 人の所の事、全体は事業所の全体の事、自分は訓練するケアマネ自身の身の回りの事）:`,
  ...INJECT_KINDS.map(kindLine),
  "",
  "決まり:",
  "1. 弱点に合わせる。弱点の無い人、もう同じ状況が起きている人には差し込まない。",
  "2. 1 刻みに多くて「差し込める数」まで。同じ人に 2 つ差し込まない。全体の種類は 1 刻みに 1 つまで。この刻みの状況と同じ事を重ねない。",
  "3. 人の生き死にを決める状況（亡くなる・意識がない・火事）を作らない。けがや体の具合は書かない（本人役が演じる）。",
  "4. 色・順位・優先・助言を書かない。診断・病名・薬の量を書かない。",
  "5. 全体の種類は target に「全体」と書く。予定の種類は after に何時間後かを書く（範囲は種類ごと。範囲の外は使われない）。",
  "6. 「この時間帯に起きやすい事」は公的な資料からの目安。種類と時刻を選ぶ参考にし、決めつけない（目安に無い種類を選んでもよく、時刻は前後してよい）。",
  "7. 自分の種類は、訓練するケアマネ自身の身の回り（自宅・家族・出勤・携帯）。訓練の主役は担当の人なので、まれにだけ使う（全体の種類と合わせて 1 刻みに 1 つ）。",
  "",
  "入力に「返事」があるときだけ、replies も返す（無ければ空の配列か省く）。ケアマネの手（電話・訪問・手配・依頼・報告）に世界が返した結果の言い換え:",
  "- replies: 返事の id ごとに 1 つ。",
  "  - id: 返事の id（「a3」の形）。",
  "  - text: 現場で聞こえる言い方の 1 文（30 字まで）。結果と事実を変えない・足さない（着いた・着けない・受けた・断られたを逆にしない）。",
  "    けが・体の具合・人の様子を足さない。仮名・名前・場所の名前を書かない。",
].join("\n");

/**
 * 返事の形。kind・basis は文字にし、表の 6 つと出典の一覧はコードで絞る
 * （enum にすると外の値 1 つで返事全部が形の違いになる。T18 と同じ）
 */
export const DirectorSchema = z.object({
  events: z.array(
    z.object({
      target: z.string(),
      kind: z.string(),
      text: z.string(),
      reason: z.string(),
      basis: z.string(),
      // 予定の種類（T92）の何時間後。ほかの種類は省く（T19 の形の返事も受ける）
      after: z.number().nullish(),
    }),
  ),
  // 世界の返事の言い換え（T20）。「返事」を渡したときだけ。省いてよい（T19 の形の返事も受ける）
  replies: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
});

export type DirectorAnswer = z.output<typeof DirectorSchema>;

/** Claude に渡す要求。入力は伏せた文だけ（型で縛る）。モデルと考える深さは用途 director の既定（Opus）。返事は言い換えを頼むときだけ */
export function buildDirectorRequest(
  scene: ForClaude<{ text: string }>,
  weak: ForClaude<{ text: string }>,
  replies?: ForClaude<{ text: string }>,
): AskJsonRequest<typeof DirectorSchema> {
  return {
    purpose: "director",
    system: DIRECTOR_SYSTEM,
    input: { 想定: scene, 弱点: weak, ...(replies ? { 返事: replies } : {}) },
    schema: DirectorSchema,
    sources: DIRECTOR_SOURCES,
  };
}

// ---------- 世界の返事の言い換え（T20。監督の 1 回に相乗り） ----------

/** 言い換えの文の長さの上限（字） */
export const REPLY_TEXT_MAX = 30;

/** 手の言い方（指示の文。画面の言葉ではない）。手の表（T91 の lib/drill/action-catalog.ts）の words */
const REPLY_ACTION_WORDS: Readonly<Record<DrillAction, string>> = CATALOG_WORDS;

const statusWords = (s: string): string =>
  (WORLD_REPLY_LABELS as Readonly<Record<string, string>>)[s] ?? (CALL_STATUS_LABELS as Readonly<Record<string, string>>)[s] ?? s;

/** 言い換える返事の文。本人は仮名（aliasOf）、相手は区分の言い方（訪問看護・透析施設）。名前・番号は無い */
export function replyText(replies: ReadonlyArray<ReplyAsk>, aliasOf: ReadonlyMap<string, string>): string {
  return [
    "ケアマネの手への世界の返事（言い換える物）:",
    ...replies.map((r) => {
      const who = r.person && aliasOf.has(r.person) ? `${aliasOf.get(r.person)}` : null;
      const callee = r.callee ? CONTACT_KIND_LABELS[r.callee] : null;
      const about = [who, callee].filter(Boolean).join("・");
      return [
        `- ${r.id}: ${REPLY_ACTION_WORDS[r.action]}${about ? `（${about}）` : ""} → ${statusWords(r.status)}。`,
        r.because ? `事実: ${r.because}。` : "",
        `今の文「${r.text}」`,
      ].join("");
    }),
  ].join("\n");
}

/** 言い換えの返事を検査する。頼んだ id の物だけ、文は本人役と同じ掃除（仮名は「本人」、使わない言葉・元の情報が残る物は捨てる） */
export function directorWords(answer: DirectorAnswer, ctx: { key: PseudonymKey; asked: ReadonlyArray<ReplyAsk> }): ReplyWords[] {
  const asked = new Set(ctx.asked.map((r) => r.id));
  const out: ReplyWords[] = [];
  for (const r of answer.replies ?? []) {
    const id = r.id.trim();
    if (!asked.has(id) || out.some((x) => x.id === id)) continue;
    if (DANGER.test(r.text)) continue;
    const text = cleanWords(r.text, ctx.key, REPLY_TEXT_MAX);
    if (text) out.push({ id, text });
  }
  return out;
}

// ---------- 返事 → 差し込み ----------

/** 画面の 1 行の長さの上限（字） */
export const INJECT_TEXT_MAX = 30;
/** 判断の理由の長さの上限（字。訓練記録に残す） */
export const REASON_MAX = 160;

/** 差し込みに書かせない状況（人の生き死にを決める物） */
const DANGER = /亡くな|死亡|死ん|心肺停止|意識が(?:ない|無い)|火事|火災/;

/** 仮名（「A さん」「Aさん」「A」）→ 台帳の id */
export function personOfAlias(raw: string, key: PseudonymKey): string | null {
  const letters = raw.trim().replace(/[ 　]*(?:さん|様)$/u, "");
  const hit = key.people.find((p) => p.alias.replace(/ さん$/, "") === letters);
  return hit?.personId ?? null;
}

const isDirectorSource = (v: string): v is (typeof DIRECTOR_SOURCES)[number] =>
  isSourceId(v) && (DIRECTOR_SOURCES as readonly string[]).includes(v);

/**
 * 根拠（出典の登録簿の id）。表の basis が code の種類はコードが付け（監督の値は見ない。本人で変わる物は basisFor）、
 * director の種類は監督の値が表の一覧と DIRECTOR_SOURCES の両方にあるときだけ受ける。一覧が空なら根拠なし（監督の値は捨てる）
 */
export function basisOf(kind: InjectKind, raw: string, source?: EventSource): SourceId | null {
  const row = EVENT_CATALOG[kind];
  const ids = row.basis.ids;
  if (ids.length === 0) return null;
  if (row.basis.by === "code") return row.basisFor ? (source ? row.basisFor(source) : null) : ids[0];
  const v = raw.trim();
  return isDirectorSource(v) && (ids as readonly string[]).includes(v) ? v : null;
}

export type DirectorEventsContext = {
  key: PseudonymKey;
  /** 本人 → その人に差し込める本人の種類 */
  eligible: ReadonlyMap<string, ReadonlyArray<InjectKind>>;
  /** 全体に差し込める種類 → 印の付く人（eligibleAreaKinds）。無ければ全体の種類は捨てる */
  area?: ReadonlyMap<InjectKind, ReadonlyArray<string>>;
  /** 差し込める数（budgetOf）。無ければ DIRECTOR_MAX */
  max?: number;
  /** 本人の台帳（根拠と事実をコードが付けるのに使う） */
  sources?: ReadonlyMap<string, EventSource>;
  /** 今の世界（満員になる避難所を選ぶ） */
  world?: WorldState;
};

/**
 * Opus の返事を差し込みにする。表の外の種類・知らない仮名・その人に差し込めない種類・同じ人に 2 つ目・全体の 2 つ目・
 * 範囲の外の何時間後・人の生き死にの文は捨てる。
 * 文は本人役と同じ掃除（仮名は「本人」、使わない言葉・元の情報が残る物は捨てる）で、使えなければ種類の固定の文（選んだのは AI のまま）。
 * 何時間後・震度・避難所の名前の入る種類は、文をコードが書く（Opus の文と食い違わないように）。
 * 理由は仮名を氏名に戻して訓練記録に残す（サーバーの中だけ。採点 T22 が Claude に渡すときはまた伏せる）
 */
export function directorEvents(answer: DirectorAnswer, ctx: DirectorEventsContext): DirectorEvent[] {
  const max = ctx.max ?? DIRECTOR_MAX;
  const out: DirectorEvent[] = [];
  let areaUsed = false;
  for (const e of answer.events) {
    if (out.length >= max) break;
    const kind = e.kind.trim();
    if (!isInjectKind(kind)) continue;
    const row = EVENT_CATALOG[kind];
    if (DANGER.test(e.text)) continue;
    const after = afterOf(row, e.after ?? undefined);
    if (after === undefined) continue;
    let person: string | null = null;
    if (row.scope === "person") {
      person = personOfAlias(e.target, ctx.key);
      if (!person || out.some((x) => x.person === person)) continue;
      if (!(ctx.eligible.get(person) ?? []).includes(kind)) continue;
    } else if (areaUsed || !ctx.area?.has(kind)) {
      continue;
    }
    const place = row.place ? (ctx.world ? row.place(ctx.world) : null) : null;
    if (row.place && !place) continue;
    const source = person ? ctx.sources?.get(person) : undefined;
    const text = row.ownText ? row.text(after) : (cleanWords(e.text, ctx.key, INJECT_TEXT_MAX) ?? row.text(after));
    const reason = Array.from(restoreText(e.reason.replace(/\s+/g, " ").trim(), ctx.key)).slice(0, REASON_MAX).join("");
    const basis = basisOf(kind, e.basis, source);
    out.push({
      inject: kind,
      ...(person ? { person } : {}),
      text,
      ...(reason ? { reason } : {}),
      ...(basis ? { basis } : {}),
      ai: true,
      ...(row.after && after !== null ? { after } : {}),
      ...(row.touches === "persons" ? { persons: [...(ctx.area?.get(kind) ?? [])] } : {}),
      ...(place ? { place } : {}),
      ...(row.factsFor && source ? { facts: row.factsFor(source) } : {}),
    });
    if (!person) areaUsed = true;
  }
  return out;
}

// ---------- 呼び口 ----------

export type DirectorDeps = {
  /** 事業所の本人の台帳（仮名化の前）。最初の呼び出しで 1 回だけ読む（本人役と同じ物を共有してよい） */
  load: () => Promise<ReadonlyMap<string, PseudonymInput>>;
  ai: AskJsonContext;
  /** 年齢を数える日（JST、YYYY-MM-DD）。無ければ今日 */
  on?: string;
  /** 上限で落ちたときに「監督 停止」を書き留める所（T70）。返す物は変わらない */
  stops?: StopLog;
};

/**
 * engine の DirectorHook を作る（1 要求ごと）。1 刻みに Opus を 1 回。
 * 参加者を並びの順に A さん・B さん…と伏せ、世界の様子と台帳の弱点の要約だけを渡す。差し込める人がいなければ呼ばない
 * （ケアマネの手の返事の言い換え〔T20〕を頼まれていれば、差し込める人がいなくても 1 回呼ぶ）。
 * 失敗は差し込みなし・言い換えなし（AI の層の失敗でない物は名前だけログに残す）
 */
export function createDirectorHook(deps: DirectorDeps): DirectorHook {
  let loaded: Promise<ReadonlyMap<string, PseudonymInput>> | null = null;
  const none: DirectorResult = { events: [], words: [] };
  return async (input): Promise<DirectorResult> => {
    try {
      const sources = await (loaded ??= deps.load());
      const members = input.participants.filter((p) => sources.has(p));
      if (members.length === 0) return none;
      const list = members.map((p) => sources.get(p)!);
      const eligible = new Map(members.map((p) => [p, eligibleKinds(sources.get(p)!, p, input.world, input.people[p] ?? null)]));
      // 全体の種類（T92）。参加者の誰か 1 人で当てはまれば差し込める
      const area = eligibleAreaKinds(
        members.map((p) => ({ person: p, source: sources.get(p)!, state: input.people[p] ?? null })),
        input.world,
      );
      // 地理（町名の別名と、訓練する人の住む所の地形）。参加者の台帳の町名から、世界の地理と同じ作り方（T88）
      const ledgers = list.map((x) => x.ledger);
      const geo = areaOf(deps.ai.office.id, ledgers.map((ledger) => ({ ledger })));
      // 訓練する人（自分）の種類（T104）。self のある訓練（連続の時計の大雨・地震）だけ。全体の種類と同じ枠で受ける（印の付く人なし）
      const selfKinds = input.self
        ? eligibleSelfKinds({ world: input.world, hour: input.hour, night: input.night === true, home: homeFacts(input.self, geo) })
        : [];
      for (const k of selfKinds) area.set(k, []);
      const asked = input.replies ?? [];
      const max = budgetOf(input);
      if ((max === 0 || (![...eligible.values()].some((k) => k.length > 0) && area.size === 0)) && asked.length === 0) return none;

      // 町名は地区の別名で渡す（T88）
      const places = placesOf(geo, ledgers);
      const { payload, key } = pseudonymize(list, { ...(deps.on ? { on: deps.on } : {}), places });
      const aliasOf = new Map(key.people.map((p) => [p.personId, p.alias]));
      const last = scenarioOf(input.scenario).hours.at(-1) ?? 72;
      const entries: WeakEntry[] = members.map((p, i) => ({
        person: p,
        claude: payload[i],
        source: list[i],
        state: input.people[p] ?? null,
        kinds: eligible.get(p) ?? [],
      }));
      const scene = pseudonymizeText(sceneText(input, aliasOf, last), key);
      const areaKinds = [...area.keys()].filter((k) => !selfKinds.includes(k));
      const selfLine: SelfLine | undefined = input.self ? { home: homeWords(input.self, geo), kinds: selfKinds } : undefined;
      const weak = pseudonymizeText(weaknessText(entries, input.world, input.hour, areaKinds, selfLine), key);
      const replies = asked.length > 0 ? pseudonymizeText(replyText(asked, aliasOf), key) : undefined;
      const r = await askJson(buildDirectorRequest(scene, weak, replies), deps.ai);
      return {
        events: directorEvents(r.value, { key, eligible, area, max, sources, world: input.world }),
        words: directorWords(r.value, { key, asked }),
      };
    } catch (e) {
      if (e instanceof AiLimitReached) deps.stops?.hit("director");
      if (!isPersonaFailure(e)) console.error("監督の 1 刻みに失敗", e instanceof Error ? e.name : typeof e);
      return none;
    }
  };
}

// ---------- ケアマネの手への世界の返事（T20 が呼ぶ口） ----------
// lib/drill/world-reply.ts へ移した（T90 の準備）。前からの import を壊さないよう、同じ名前をここからも出す

export {
  acceptOdds,
  callLine,
  decideWorldReply,
  WORLD_ODDS,
  WORLD_REPLY_LABELS,
  WORLD_REPLY_TEXTS,
  worldReply,
  type WorldAsk,
  type WorldReply,
  type WorldReplyStatus,
  type WorldReplyWords,
} from "./world-reply.ts";
