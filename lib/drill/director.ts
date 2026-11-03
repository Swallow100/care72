// 訓練の監督（docs/tasks/T19.md）。世界の状態（道路・停電・電話の不通・職員の空き・避難所の様子・本人ごとの印）と、
// 刻みごとの差し込み。形は「決まった流れ＋判断点 1 つ」（Building Effective Agents の workflow）:
// - 決まった流れ: 想定の表（lib/drill/scenarios.ts）の出来事と固定の差し込みを順に当てる（Claude を呼ばない。engine の step）
// - 判断点 1 つ: この刻みで、この事業所の台帳の弱点（空欄・支援者なし・残り時間の短さ）に合わせて差し込む状況を 0〜2 個。
//   Opus に 1 刻み 1 回だけ、決まった JSON で { events: [{ target, kind, text, reason, basis }] }
//
// 守ること:
// - Claude に渡すのは lib/pseudonym を通した物だけ。本人は仮名（A さん）、渡すのは世界の様子と台帳の弱点の要約だけ
//   （氏名・住所・電話・町名・避難先の名前を渡さない。色・順位も渡さない）
// - 監督に色・順位を決めさせない。差し込みは種類（表の 6 つ）と相手を選ぶだけで、世界の変化はコード（injectChange）が組み、
//   色と順位は安否と台帳の時計を lib/triage の表に流して決まる
// - 種類は表の 6 つだけ。表の外・その人に当てはまらない種類（栄養剤は経管栄養の人だけ、など）・知らない仮名は捨てる
// - 失敗（鍵なし・上限・断られた・形の違い・呼び出しの失敗・伏せきれない・台帳を読めない）は差し込みなし（表の固定の状況だけで進む）
// - ケアマネの手（T20）への世界の返事は、確率をこの表で先に決め、Opus は文だけ（worldReply。本物の文は T20）

import * as z from "zod";
import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import type { CheckStatus, ClockCategory, ContactKind, DependsOn, DrillAction } from "../db/types.ts";
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
import {
  DIRECTOR_MAX,
  type DirectorEvent,
  type DirectorHook,
  type DirectorInput,
  type DirectorResult,
  type PersonState,
  type ReplyAsk,
  type ReplyWords,
} from "./engine.ts";
import { CALL_STATUS_LABELS, PHONE_LABELS, SHELTER_LABELS, TSUNAMI_LABELS, WATER_LABELS } from "./labels.ts";
import { nightLine } from "./night.ts";
import { cleanWords, isPersonaFailure, reportersOf } from "./persona.ts";
import {
  INJECT_KINDS,
  INJECT_TEXTS,
  isInjectKind,
  phoneOf,
  scenarioOf,
  type InjectKind,
  type PersonMarks,
  type PhoneState,
  type WorldState,
} from "./scenarios.ts";

// ---------- 世界 → ルールの表の入力 ----------

/** 世界の状態が書き換える時計の欄（台帳の時計の行と同じ名前） */
export type ClockForWorld = {
  person_id: string;
  category: ClockCategory;
  depends_on: DependsOn | null;
  depends_check: CheckStatus | null;
};

/** 頼り先ごとの時計の区分（頼り先が書かれていない時計にも当てる） */
const DEPENDS_CATEGORY: Readonly<Partial<Record<DependsOn, ClockCategory>>> = { dialysis_center: "dialysis" };

/**
 * 訓練の世界で、台帳の時計の頼り先を書き換えた写し（ルールの表に渡す前。台帳そのものは変えない）。
 * - 栄養剤の持ち出し忘れの印: その人の栄養剤（経管栄養）の時計は配達に頼り、未確認（避難先で栄養剤を届けてもらう必要がある）
 * - 頼り先のある施設の休止（透析施設の浸水）: その人のその頼り先の時計は未確認に戻る（次の受け入れ先を確かめる）
 * 色はルールの表の「外の物に頼る時計の確認が未確認」の行で決まる（案 1）。監督は色を決めない
 */
export function drillClocks<T extends ClockForWorld>(clocks: ReadonlyArray<T>, world: WorldState): T[] {
  const closed = world.facilities.filter((f) => !f.open && f.person && f.depends);
  return clocks.map((k) => {
    if (k.category === "tube_feeding" && world.marks[k.person_id]?.supplyLeft !== undefined) {
      return { ...k, depends_on: "delivery", depends_check: "unconfirmed" };
    }
    const hit = closed.find(
      (f) => f.person === k.person_id && (k.depends_on === f.depends || (k.depends_on === null && DEPENDS_CATEGORY[f.depends!] === k.category)),
    );
    return hit ? { ...k, depends_on: hit.depends, depends_check: "unconfirmed" } : k;
  });
}

// ---------- 差し込める種類（台帳と世界から。コードで決める） ----------

/**
 * この本人に差し込める種類。その人に当てはまり、まだ起きていない物だけ。
 * 栄養剤は経管栄養の時計がある人、透析施設は透析の時計がある人、訪問看護は訪問看護の連絡先がある人、
 * 家に帰ろうとするのは家の外（避難所・その他）にいると連絡のあった人
 */
export function eligibleKinds(
  source: Pick<PseudonymInput, "clocks" | "contacts">,
  person: string,
  world: WorldState,
  state: PersonState | null,
): InjectKind[] {
  const own: PersonMarks = world.marks[person] ?? {};
  const has = (c: ClockCategory) => source.clocks.some((k) => k.category === c);
  const out: InjectKind[] = [];
  if (has("tube_feeding") && own.supplyLeft === undefined) out.push("supply_left");
  if (has("dialysis") && !world.facilities.some((f) => f.person === person && !f.open)) out.push("dialysis_flooded");
  if (!world.roads.some((r) => r.person === person && !r.open)) out.push("road_blocked");
  if (phoneOf(world, person) !== "down") out.push("line_down");
  if (source.contacts.some((c) => c.kind === "visiting_nurse") && own.nurseAway === undefined) out.push("nurse_away");
  if ((state?.whereNow === "shelter" || state?.whereNow === "other") && own.goingHome === undefined) out.push("going_home");
  return out;
}

// ---------- 想定の文と弱点の要約（Claude に渡す前に pseudonymizeText で伏せる） ----------

/** 種類の中身（指示の文。画面の言葉ではない） */
const KIND_WORDS: Readonly<Record<InjectKind, string>> = {
  supply_left: "家族・本人が栄養剤を持ち出し忘れた（経管栄養の人）",
  dialysis_flooded: "通う透析施設が浸水して休止（透析の人）",
  road_blocked: "家の前の道が通れない（冠水・土砂・倒木）",
  line_down: "家の電話が不通",
  nurse_away: "訪問看護が来られない（訪問看護を使う人）",
  going_home: "本人が避難先から家に帰ろうとする（家の外にいる人）",
};

const MARK_WORDS: Readonly<Record<keyof PersonMarks, string>> = {
  supplyLeft: "栄養剤の持ち出し忘れ",
  nurseAway: "訪問看護が来られない",
  goingHome: "家に帰ろうとしている",
  lineDown: "家の電話が不通",
  flooded: "家の辺りが浸水",
  waterOut: "家の辺りが断水",
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
    now.push(o.restoredAt != null ? `停電 復旧（${o.restoredAt} 時間）` : `停電中（${o.since} 時間から、${area}）`);
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
  const kind = scenarioOf(input.scenario).kind;
  return [
    `想定: ${SCENE_WORDS[kind]}`,
    `時刻: 発災から ${input.hour} 時間（${last} 時間まで）`,
    // 夜間発災（T59）だけ。時刻の 1 行
    ...(input.night ? [nightLine(input.hour)] : []),
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
  return `${s.at} 時間に${SOURCE_WORDS[s.source]}が${COLOR_WORDS[s.color]}${where}`;
}

export type WeakEntry = {
  person: string;
  claude: ClaudePerson;
  source: PseudonymInput;
  state: PersonState | null;
  kinds: ReadonlyArray<InjectKind>;
};

/** 本人ごとの台帳の弱点の要約（仮名・年齢・介護度・医療・残り時間・空欄・支援者・押せる人・今の安否・差し込める種類） */
export function weaknessText(entries: ReadonlyArray<WeakEntry>, world: WorldState, hour: number): string {
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
      `  差し込める種類: ${e.kinds.length > 0 ? e.kinds.join("、") : "なし"}`,
    ].join("\n");
  });
  return ["本人ごとの弱点:", ...lines].join("\n");
}

// ---------- 指示と返事の形 ----------

/** 監督が根拠に引ける出典（登録簿の id）。返事の basis はこの中か「根拠なし」 */
export const DIRECTOR_SOURCES = [
  "cao-shishin-2021",
  "mhlw-bcp-2020",
  "nanbyo-shishin-2017",
  "jadp-dialysis-2023",
  "mhlw-dementia-2018",
] as const satisfies ReadonlyArray<SourceId>;

export const DIRECTOR_SYSTEM = [
  "災害の訓練（発災から 72 時間）の監督。ケアマネが担当する在宅の高齢者（人は全部架空）の訓練で、想定の表の状況に加えて、",
  "この事業所の台帳の弱点を突く小さな状況を差し込む。差し込みはケアマネの対応を試すためで、ケアマネが動けば確かめられる・防げる大きさにする。",
  "入力は JSON。「想定」は今の時刻・世界の様子・この刻みの状況、「弱点」は本人ごとの台帳の弱点の要約と、その人に差し込める種類。",
  "",
  "返す JSON:",
  "- events: 差し込む状況の配列。0〜2 個。差し込まない刻みがあってよい。",
  "  - target: 本人の仮名（「A さん」）。「弱点」にある人だけ。",
  "  - kind: 種類の英字。その本人の「差し込める種類」にある物だけ。",
  "  - text: 画面に出す 1 行（25 字まで）。「家族が栄養剤を持ち出し忘れた」の形。仮名・名前・場所の名前を書かない（画面が名前を添える）。",
  "  - reason: その本人とその種類を選んだ理由。突いた弱点（空欄・支援者なし・残り時間の短さ・連絡なし）を書く（80 字まで）。",
  `  - basis: 根拠の出典の id。当てはまる物が無ければ「${NO_BASIS}」。`,
  "",
  "種類（kind）はこの 6 つだけ。表に無い状況は作らない:",
  ...INJECT_KINDS.map((k) => `- ${k}: ${KIND_WORDS[k]}`),
  "",
  "決まり:",
  "1. 弱点に合わせる。弱点の無い人、もう同じ状況が起きている人には差し込まない。",
  "2. 1 刻みに多くて 2 つ。同じ人に 2 つ差し込まない。この刻みの状況と同じ事を重ねない。",
  "3. 人の生き死にを決める状況（亡くなる・意識がない・火事）を作らない。けがや体の具合は書かない（本人役が演じる）。",
  "4. 色・順位・優先・助言を書かない。診断・病名・薬の量を書かない。",
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

/** 手の言い方（指示の文。画面の言葉ではない） */
const REPLY_ACTION_WORDS: Readonly<Record<DrillAction, string>> = {
  call_person: "本人に電話",
  call_contact: "連絡先に電話",
  visit: "ケアマネが家に向かった",
  dispatch: "訪問看護・介護の人に行ってもらうよう頼んだ",
  request_welfare_shelter: "福祉避難所に受け入れを頼んだ",
  report_city: "市役所に報告",
  evacuate_self: "ケアマネが自分も避難",
};

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
 * Opus の返事を差し込みにする。表の外の種類・知らない仮名・その人に差し込めない種類・同じ人に 2 つ目・人の生き死にの文は捨てる。
 * 文は本人役と同じ掃除（仮名は「本人」、使わない言葉・元の情報が残る物は捨てる）で、使えなければ種類の固定の文（選んだのは AI のまま）。
 * 理由は仮名を氏名に戻して訓練記録に残す（サーバーの中だけ。採点 T22 が Claude に渡すときはまた伏せる）
 */
export function directorEvents(
  answer: DirectorAnswer,
  ctx: { key: PseudonymKey; eligible: ReadonlyMap<string, ReadonlyArray<InjectKind>> },
): DirectorEvent[] {
  const out: DirectorEvent[] = [];
  for (const e of answer.events) {
    if (out.length >= DIRECTOR_MAX) break;
    const kind = e.kind.trim();
    if (!isInjectKind(kind)) continue;
    const person = personOfAlias(e.target, ctx.key);
    if (!person || out.some((x) => x.person === person)) continue;
    if (!(ctx.eligible.get(person) ?? []).includes(kind)) continue;
    if (DANGER.test(e.text)) continue;
    const text = cleanWords(e.text, ctx.key, INJECT_TEXT_MAX) ?? INJECT_TEXTS[kind];
    const reason = Array.from(restoreText(e.reason.replace(/\s+/g, " ").trim(), ctx.key)).slice(0, REASON_MAX).join("");
    const basis = e.basis.trim();
    out.push({
      inject: kind,
      person,
      text,
      ...(reason ? { reason } : {}),
      ...(isDirectorSource(basis) ? { basis } : {}),
      ai: true,
    });
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
      const asked = input.replies ?? [];
      if (![...eligible.values()].some((k) => k.length > 0) && asked.length === 0) return none;

      const { payload, key } = pseudonymize(list, deps.on ? { on: deps.on } : {});
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
      const weak = pseudonymizeText(weaknessText(entries, input.world, input.hour), key);
      const replies = asked.length > 0 ? pseudonymizeText(replyText(asked, aliasOf), key) : undefined;
      const r = await askJson(buildDirectorRequest(scene, weak, replies), deps.ai);
      return { events: directorEvents(r.value, { key, eligible }), words: directorWords(r.value, { key, asked }) };
    } catch (e) {
      if (!isPersonaFailure(e)) console.error("監督の 1 刻みに失敗", e instanceof Error ? e.name : typeof e);
      return none;
    }
  };
}

// ---------- ケアマネの手への世界の返事（T20 が呼ぶ口） ----------
// 本人・家族・支援者の電話に「出るか」は本人役（lib/drill/persona.ts の decideCallPickup・personaCallReply）。
// ここは世界が答える所: 電話の線がつながるか、事業所・市役所につながるか、出向いて着けるか、出向いてもらえるか、福祉避難所が受けるか。
// 確率はこの表で先に決める（roll は 0 以上 1 未満。Math.random など）。文は固定で、Opus の言い換え（T20）があればそれ。

/** 確率の表 */
export const WORLD_ODDS = {
  /** 事業所・市役所への電話がつながる（電話の様子ごと） */
  connect: { ok: 0.9, busy: 0.5, down: 0 } satisfies Record<PhoneState, number>,
  /** 自分が出向いて着ける。警戒の中（警戒レベル 4 以上・津波の避難・浸水）は下がる。家の前の道が通行止なら着けない */
  reach: { clear: 0.95, warning: 0.7 },
  /** 訪問看護・介護の人に出向いてもらえる（頼む電話の様子ごと）。職員の空きなし・訪問看護が来られない・通行止なら出せない */
  dispatch: { ok: 0.8, busy: 0.5, down: 0 } satisfies Record<PhoneState, number>,
  /** 福祉避難所が受け入れる（発災からの時間ごと。始めは開いていないことが多い）。電話が不通なら頼めない */
  accept: [
    { until: 24, odds: 0.3 },
    { until: 48, odds: 0.6 },
    { until: Infinity, odds: 0.8 },
  ],
  /** 市役所に報告できる（電話の様子ごと） */
  report: { ok: 0.9, busy: 0.6, down: 0 } satisfies Record<PhoneState, number>,
} as const;

/** 返事の状態（2〜4 字） */
export const WORLD_REPLY_LABELS = {
  ringing: "呼出",
  connected: "通話",
  noLine: "不通",
  closed: "休止",
  arrived: "到着",
  blocked: "通行止",
  turnedBack: "到着不可",
  dispatched: "手配済",
  noDispatch: "手配不可",
  accepted: "受入",
  refused: "受入不可",
  reported: "報告済",
  evacuated: "避難済",
} as const;
export type WorldReplyStatus = keyof typeof WORLD_REPLY_LABELS;

/** 固定の文（T20 で Opus が言い換えるまでの物。画面の 1 文） */
export const WORLD_REPLY_TEXTS: Readonly<Record<WorldReplyStatus, string>> = {
  ringing: "呼び出している",
  connected: "つながった",
  noLine: "電話がつながらない",
  closed: "休止していて受けられない",
  arrived: "家に着いた",
  blocked: "道が通れず近づけない",
  turnedBack: "途中で引き返した",
  dispatched: "向かってもらえる",
  noDispatch: "向かえる人がいない",
  accepted: "受け入れてもらえる",
  refused: "受け入れられない",
  reported: "報告した",
  evacuated: "避難した",
};

/** 本人・家族・支援者の区分（電話に出るかは本人役が決める相手） */
const PERSON_CALLEES: ReadonlySet<ContactKind> = new Set(["self", "family", "supporter", "welfare_commissioner"]);

export type WorldAsk = {
  action: DrillAction;
  /** 相手の本人（台帳の id）。市役所への報告・自分の避難は null */
  person: string | null;
  /**
   * 相手の区分。電話（call_contact）の相手、出向いてもらう人（dispatch: visiting_nurse か care_service。無ければ事業所の職員）。
   * call_person は本人（self）
   */
  callee?: ContactKind | null;
  world: WorldState;
  /** 手を打った時刻（発災からの時間） */
  hour: number;
};

export type WorldReply = {
  action: DrillAction;
  ok: boolean;
  status: WorldReplyStatus;
  /** そうなった世界の事実（表から組む。「家の前の道 通行止」）。確率で外れたときは null */
  because: string | null;
  /** 画面の 1 文。固定の文か、Opus の言い換え（ai: true） */
  text: string;
  ai: boolean;
};

function reply(action: DrillAction, ok: boolean, status: WorldReplyStatus, because: string | null = null): WorldReply {
  return { action, ok, status, because, text: WORLD_REPLY_TEXTS[status], ai: false };
}

const closedRoad = (w: WorldState, person: string | null) => (person ? w.roads.find((r) => r.person === person && !r.open) ?? null : null);

/** 電話の線の様子。本人の家にかけるときは家の電話（不通の印）、ほかは世界の電話 */
export function callLine(w: WorldState, person: string | null, callee: ContactKind | null | undefined): PhoneState {
  return callee === "self" || callee == null ? phoneOf(w, person) : w.phone;
}

/** 福祉避難所が受け入れる確率（時間ごと） */
export function acceptOdds(hour: number): number {
  return WORLD_ODDS.accept.find((x) => hour < x.until)?.odds ?? 0;
}

/**
 * ケアマネの手 1 つへの世界の返事（固定の文）。確率は WORLD_ODDS、世界の事実（通行止・不通・休止・職員の空き・訪問看護）は先に見る。
 * 本人・家族・支援者への電話は線がつながるか（呼出・不通）だけ返す。出るか・何を言うかは本人役（T18）
 */
export function decideWorldReply(ask: WorldAsk, roll: number): WorldReply {
  const { action, person, world: w } = ask;
  const callee = action === "call_person" ? "self" : (ask.callee ?? null);
  switch (action) {
    case "call_person":
    case "call_contact": {
      const line = callLine(w, person, callee);
      if (line === "down") return reply(action, false, "noLine", w.phone === "down" ? "電話 不通" : "家の電話 不通");
      if (callee === null || PERSON_CALLEES.has(callee)) return reply(action, true, "ringing");
      if (callee === "dialysis_center" && person) {
        const f = w.facilities.find((x) => x.person === person && !x.open && x.depends === "dialysis_center");
        if (f) return reply(action, false, "closed", `${f.label} 休止`);
      }
      return roll < WORLD_ODDS.connect[line] ? reply(action, true, "connected") : reply(action, false, "noLine");
    }
    case "visit": {
      const road = closedRoad(w, person);
      if (road) return reply(action, false, "blocked", `${road.label} 通行止`);
      const warning = (w.alertLevel ?? 0) >= 4 || w.tsunami === "evacuate" || w.flood;
      const odds = warning ? WORLD_ODDS.reach.warning : WORLD_ODDS.reach.clear;
      return roll < odds ? reply(action, true, "arrived") : reply(action, false, "turnedBack");
    }
    case "dispatch": {
      if (callee === "visiting_nurse" && person && w.marks[person]?.nurseAway !== undefined) {
        return reply(action, false, "noDispatch", "訪問看護 来られない");
      }
      if (callee !== "visiting_nurse" && w.staff <= 0) return reply(action, false, "noDispatch", "職員の空き なし");
      const road = closedRoad(w, person);
      if (road) return reply(action, false, "blocked", `${road.label} 通行止`);
      if (w.phone === "down") return reply(action, false, "noDispatch", "電話 不通");
      return roll < WORLD_ODDS.dispatch[w.phone] ? reply(action, true, "dispatched") : reply(action, false, "noDispatch");
    }
    case "request_welfare_shelter": {
      if (w.phone === "down") return reply(action, false, "noLine", "電話 不通");
      return roll < acceptOdds(ask.hour) ? reply(action, true, "accepted") : reply(action, false, "refused");
    }
    case "report_city": {
      if (w.phone === "down") return reply(action, false, "noLine", "電話 不通");
      return roll < WORLD_ODDS.report[w.phone] ? reply(action, true, "reported") : reply(action, false, "noLine");
    }
    case "evacuate_self":
      return reply(action, true, "evacuated");
  }
}

/** 返事の文を言い換える口（T20 で Opus。文だけ返す。決まった ok・status・because は変えない）。失敗・空は固定の文 */
export type WorldReplyWords = (reply: WorldReply, ask: WorldAsk) => Promise<string | null>;

/** 世界の返事。確率と事実は表で先に決め、words があれば文だけ言い換える（失敗は固定の文、AI の印なし） */
export async function worldReply(ask: WorldAsk, roll: number, words?: WorldReplyWords): Promise<WorldReply> {
  const fixed = decideWorldReply(ask, roll);
  if (!words) return fixed;
  try {
    const t = (await words(fixed, ask))?.trim();
    return t ? { ...fixed, text: t, ai: true } : fixed;
  } catch {
    return fixed;
  }
}
