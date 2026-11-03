// 仮想モード（docs/tasks/T50.md）の世界の 1 刻みを Messages API の 1 回呼び（askJson、Opus）で作る所と、
// 世界の部屋（lib/drill/world-room.ts）と共有する指示の文・入力の文。部屋が使えないとき（DRILL_WORLD=messages・部屋が落ちた）の道。
//
// 守ること:
// - Claude に渡すのは lib/pseudonym を通した文だけ（pseudonymizeText）。本人は仮名（A さん）、地区は別名（甲地区）。
//   町名・氏名・住所・電話と、人と地区の結び付き（誰がどこに住むか・その人のハザード）を渡さない
// - 世界が決めるのは街と物の出来事と言葉と、訓練の架空の人の結末（T53。結末を迎えた人・1 文・理由）。
//   時計の計算（lib/drill/outcome.ts）は目安として渡すだけで、誰が結末かは世界が決める。体の状態・診断・薬の量は書かせない
// - 返事の形は部屋の custom tool と同じ WorldStepSchema（lib/drill/world-apply.ts）

import { askJson, type AskJsonContext, type AskJsonRequest } from "../claude/call.ts";
import { CARE_LEVEL_LABELS, CLOCK_START_LABELS, CLOCK_UNIT_LABELS, DEVICE_LABELS, HOUSEHOLD_LABELS } from "../labels.ts";
import { pseudonymize, pseudonymizeText, type ForClaude, type PseudonymInput, type PseudonymKey } from "../pseudonym/index.ts";
import { aliasOfTown, AREA_FACILITIES, AREA_ROADS, AREA_SHELTERS, geographyText } from "./area.ts";
import type { ActionRecord, DrillIncident, WorldInput } from "./engine.ts";
import { PHONE_LABELS, SHELTER_LABELS } from "./labels.ts";
import type { OutcomeSource } from "./outcome.ts";
import { reportersOf } from "./persona.ts";
import type { WorldState, WorldVia } from "./scenarios.ts";
import {
  FAREWELL_MAX,
  FAREWELL_PER_TICK_MAX,
  FAREWELL_REASON_MAX,
  NARRATION_MAX,
  WORLD_EVENTS_MAX,
  WORLD_KINDS,
  WorldStepSchema,
  worldIncidents,
  type ApplyContext,
  type PersonFacts,
  type WorldStep,
} from "./world-apply.ts";

// ---------- 指示 ----------

const KIND_WORDS: Readonly<Record<(typeof WORLD_KINDS)[number], string>> = {
  flood: "浸水。town に地区（「甲地区」）か target に仮名。value に深さ m（「1.5」）",
  landslide: "土砂崩れ。town か target",
  road: "道路。name に主な道の名前（無ければ town に地区）。value は closed（通行止）か open（開通）",
  outage: "停電。town に地区（「甲地区・乙地区」で複数）。value は start（始まり）か restored（全域の復旧）",
  water: "断水。town に地区。value は out か restored",
  phone: "電話の様子。value は ok・busy・down。town を書くとその地区だけ不通（down のとき）",
  shelter: "避難所。name に避難所の名前。value は open・crowded・full・closed",
  facility: "施設。name に施設の名前。value は closed（休止）か open（再開）",
  aftershock: "余震。value に震度（「4」「5弱」）",
  weather: "天候。value は rain（大雨）か clear（止む）",
};

/** 世界の指示（部屋の system と 1 回呼びの system に同じ物を使う） */
export const WORLD_SYSTEM = [
  "災害の訓練（発災から 72 時間）の「世界」。架空の街と、在宅で介護を受ける架空の高齢者 10 人の訓練で、ケアマネが誰から順に連絡するかを試す。",
  "あなたは街の出来事を進め、訓練の架空の人の結末も決める。刻みごとに、今の時刻と、前の刻みからケアマネがした事・本人たちの最後の様子・時計の目安が届く。",
  "最初の刻みに街の地理（地区・道・避難所・施設）と本人ごとの台帳の要約が届く。前の刻みの出来事は覚えておき、矛盾しない流れにする。",
  "最初の刻みで災害の種類（大雨か地震）を決め、narration に書く。以後 72 時間、その災害で起きやすい流れにする（大雨なら増水 → 浸水 → 停電・断水 → 復旧、地震なら停電・断水・道路の寸断・余震）。",
  "固定の筋は無い。街の事情は刻みごとに変わってよいが、ケアマネが動けば確かめられる・防げる大きさの事を多めにする。",
  "",
  "返す物（world_step）:",
  `- narration: 今の街の様子の 1 文（${NARRATION_MAX} 字まで）。ケアマネの画面の「状況」に AI の印で出る。地区は別名で書く。仮名・名前を書かない。`,
  `- events: この刻みの出来事。0〜${WORLD_EVENTS_MAX} 個。起きない刻みがあってよい。各欄は kind・town・target・name・value。使わない欄は空文字。`,
  "  kind はこの英字だけ:",
  ...WORLD_KINDS.map((k) => `  - ${k}: ${KIND_WORDS[k]}`),
  "  地区・道・避難所・施設の名前は、地理にある物だけをそのまま書く。target は本人の仮名（「A さん」）で、「その人の住む所」の意味（どこに住むかはあなたは知らない）。",
  `- farewells: この刻みで結末を迎えた人（0〜${FAREWELL_PER_TICK_MAX} 人）。人ごとに { target: 仮名, text: 1 文（${FAREWELL_MAX} 字まで）, reason: なぜそうなったか（${FAREWELL_REASON_MAX} 字まで）}。いなければ空の配列。`,
  "  結末を迎えるかは、あなたが世界の流れで決める。入力の「時計の目安」（持ちこたえる時間の残り・超過、届いた手の有無）、ケアマネがした事、本人たちの最後の様子、街の出来事を見て決める。",
  "  目安で時計を超えた人でも、届いた手・家族・近所・避難所などで持ちこたえていてよい。目安に無い人でも、街の出来事（浸水・土砂・道の寸断）で結末を迎えてよい。ケアマネの手が届いた人は持ちこたえやすくする。",
  "  結末は訓練の中の架空の人の、シナリオの上の事実。text は言い切らず、やわらかく包んだ言い方にする（「〇〇の時間までに、手が届かなかった」の形）。",
  "  reason は街と物の事実だけで書く（「停電が 6 時間続き、電池が切れた」「道が通れず、誰も着かなかった」）。体の様子・病名・薬の量・医療の助言を書かない。",
  "  使わない語: 死亡・亡くなる・死ぬ・関連死・遺体・息を引き取る・心肺停止。体の様子を細かく書かない。一度結末を迎えた人は以後挙げない。",
  "",
  "決まり:",
  "1. 人の体の状態（けが・病状・意識）を events と narration に書かない。書くのは街と物の事実だけ。本人たちの様子は別の役が演じる。",
  "2. 結末は 1 刻みに 2 人まで。本人たち（仮名）の中からだけ選ぶ。急がず、流れに沿って決める。",
  "3. 色・順位・優先・助言を書かない。診断・病名・薬の量を書かない。",
  "4. 地区・道・施設の名前を作らない。地理に無い名前は使わない。",
].join("\n");

/** world_step の形を JSON Schema で（部屋の custom tool の input_schema）。構造化出力の 1 回呼びは zod から作る */
export const WORLD_STEP_JSON_SCHEMA = {
  type: "object",
  properties: {
    narration: { type: "string", description: `今の街の様子の 1 文（${NARRATION_MAX} 字まで）` },
    events: {
      type: "array",
      description: `この刻みの出来事（0〜${WORLD_EVENTS_MAX} 個）`,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", description: WORLD_KINDS.join("・") },
          town: { type: "string", description: "地区の別名（甲地区）。無ければ空文字" },
          target: { type: "string", description: "本人の仮名（A さん）。無ければ空文字" },
          name: { type: "string", description: "道・避難所・施設の名前。無ければ空文字" },
          value: { type: "string", description: "種類ごとの値" },
        },
        required: ["kind", "town", "target", "name", "value"],
      },
    },
    farewells: {
      type: "array",
      description: `この刻みで結末を迎えた人（0〜${FAREWELL_PER_TICK_MAX} 人）。いなければ空の配列`,
      items: {
        type: "object",
        properties: {
          target: { type: "string", description: "本人の仮名（A さん）" },
          text: { type: "string", description: `やわらかく包んだ 1 文（${FAREWELL_MAX} 字まで）` },
          reason: { type: "string", description: `なぜそうなったかの街と物の事実（${FAREWELL_REASON_MAX} 字まで）` },
        },
        required: ["target", "text", "reason"],
      },
    },
  },
  required: ["narration", "events", "farewells"],
} as const;

// ---------- 入力の文 ----------

/** 世界に渡す本人の集まり。参加者の並びで仮名を振る（刻みが変わっても同じ仮名） */
export type WorldCast = {
  key: PseudonymKey;
  facts: Map<string, PersonFacts>;
  /** 本人ごとの台帳の要約（仮名化の前の文。送る前に pseudonymizeText） */
  people: string;
};

/** 参加者の台帳から仮名・事実・台帳の要約を作る。台帳の無い参加者は外す */
export function buildCast(
  participants: ReadonlyArray<string>,
  sources: ReadonlyMap<string, PseudonymInput>,
  outcomeSources: ReadonlyMap<string, OutcomeSource>,
  on?: string,
): WorldCast {
  const members = participants.filter((p) => sources.has(p));
  const list = members.map((p) => sources.get(p)!);
  const { payload, key } = pseudonymize(list, on ? { on } : {});
  const facts = new Map<string, PersonFacts>();
  const lines: string[] = [];
  members.forEach((p, i) => {
    const src = list[i];
    const clocks = outcomeSources.get(p)?.clocks ?? [];
    facts.set(p, {
      town: aliasOfTown(src.ledger.basic.address?.town) ? (src.ledger.basic.address?.town ?? null) : null,
      depends: clocks.flatMap((k) => (k.depends_on ? [k.depends_on] : [])),
      categories: src.clocks.map((k) => k.category),
      nurse: src.contacts.some((c) => c.kind === "visiting_nurse"),
    });
    const c = payload[i];
    const head = [
      c.age != null ? `${c.age} 歳` : null,
      c.care.careLevel ? CARE_LEVEL_LABELS[c.care.careLevel] : null,
      c.household ? HOUSEHOLD_LABELS[c.household] : null,
      c.care.bedridden ? "寝たきり" : null,
      c.care.dementia ? "認知症" : null,
    ].filter(Boolean);
    const devices = c.medical.devices.map((d) => DEVICE_LABELS[d.kind as keyof typeof DEVICE_LABELS] ?? d.kind);
    const runs = c.clocks
      .filter((k) => k.kind !== "condition" && k.startsOn !== "none")
      .map((k) => `${k.label}${k.value != null && k.unit ? ` ${k.value} ${CLOCK_UNIT_LABELS[k.unit]}` : ""}（${CLOCK_START_LABELS[k.startsOn]}から減る）`);
    const supporters = c.contacts.filter((x) => x.supporterOrder != null).length;
    const pressers = reportersOf(src).filter((r) => r.canPress).map((r) => r.role);
    // ハザード・避難先・住所は書かない（どの地区に住むかが分かるので）
    lines.push(
      [
        `- ${c.alias}: ${head.join("、") || "（基本の欄なし）"}`,
        `  医療機器: ${devices.length > 0 ? devices.join("、") : "なし"}`,
        `  持ちこたえる時間: ${runs.length > 0 ? runs.join("、") : "なし"}`,
        `  支援者: ${supporters > 0 ? `${supporters} 人` : "なし"}。スマホで連絡できる人: ${pressers.length > 0 ? pressers.join("、") : "いない"}`,
      ].join("\n"),
    );
  });
  return { key, facts, people: ["本人たち（仮名。どこに住むかは書かない）:", ...lines].join("\n") };
}

const ACTION_WORDS: Readonly<Record<ActionRecord["kind"], string>> = {
  call_person: "本人に電話",
  call_contact: "家族・支援者に電話",
  visit: "家に向かった",
  dispatch: "訪問看護・介護の人に行ってもらうよう頼んだ",
  request_welfare_shelter: "福祉避難所に受け入れを頼んだ",
  report_city: "市役所に報告",
  evacuate_self: "自分も避難",
};

const COLOR_WORDS = { red: "赤（無事じゃない）", green: "緑（無事）", unknown: "連絡（安否は不明）" } as const;

/** 前の刻みからケアマネがした事（仮名）。結果は「届いた」「届かなかった」だけ */
function actionLines(actions: ReadonlyArray<ActionRecord>, from: number, aliasOf: ReadonlyMap<string, string>): string[] {
  return actions
    .filter((a) => a.atMinute >= from * 60)
    .map((a) => {
      const who = a.person ? (aliasOf.get(a.person) ?? null) : null;
      const r = a.result ? (a.result.ok ? "届いた" : "届かなかった") : "途中";
      return `- ${Math.floor(a.atMinute / 60)} 時間 ${a.atMinute % 60} 分: ${ACTION_WORDS[a.kind]}${who ? `（${who}）` : ""} → ${r}`;
    });
}

/** 前の刻みからの本人たちの連絡の要約（仮名。言う事は書かない＝本人役の言葉を世界が拾わない） */
function contactLines(input: WorldInput, from: number, aliasOf: ReadonlyMap<string, string>): string[] {
  return Object.entries(input.people)
    .filter(([p, s]) => s.at >= from && aliasOf.has(p))
    .map(([p, s]) => `- ${aliasOf.get(p)}: ${s.at} 時間に${COLOR_WORDS[s.color]}`);
}

const WHERE_WORDS = { home: "家", shelter: "避難所", other: "家の外" } as const;

/** 本人たちの最後の様子（仮名。色と場所だけ。言う事は書かない＝本人役の言葉を世界が拾わない）。まだ連絡の無い人は「連絡なし」 */
function lastLines(input: WorldInput, aliasOf: ReadonlyMap<string, string>): string[] {
  const ended = input.world.ended ?? {};
  return [...aliasOf]
    .filter(([p]) => !ended[p])
    .map(([p, alias]) => {
      const s = input.people[p];
      if (!s) return `- ${alias}: 連絡なし`;
      return `- ${alias}: ${s.at} 時間に${COLOR_WORDS[s.color]}${s.whereNow ? `、${WHERE_WORDS[s.whereNow]}` : ""}`;
    });
}

/** 時計の目安（時計の計算。結末を決めるのは世界）。走っている時計の残り・超過と、条件に達した人 */
function hintLines(input: WorldInput, aliasOf: ReadonlyMap<string, string>): string[] {
  const reached = new Set(input.hints.reached.map((r) => r.person));
  return input.hints.clocks
    .filter((c) => aliasOf.has(c.person))
    .map((c) => {
      const h = Math.round((Math.abs(c.leftMinutes) / 60) * 10) / 10;
      const left = c.leftMinutes >= 0 ? `残り ${h} 時間` : `${h} 時間超過`;
      const note = reached.has(c.person) ? "。切れるまでに届いた手なし" : c.leftMinutes < 0 ? "。切れる前に手が届いた" : "";
      return `- ${aliasOf.get(c.person)}: ${c.label}、${left}${note}`;
    });
}

/** 今の街の様子（地区は別名） */
export function worldNow(w: WorldState): string[] {
  const now: string[] = [];
  if (w.weather) now.push(w.weather === "rain" ? "大雨" : "雨は止んだ");
  if (w.quake) now.push(`地震 震度 ${w.quake}`);
  if (w.outage) {
    const o = w.outage;
    const area = o.area.scope === "towns" ? o.area.towns.map((t) => aliasOfTown(t) ?? "地区").join("・") : "全域";
    now.push(o.restoredAt != null ? `停電 復旧（${o.restoredAt} 時間）` : `停電中（${area}）`);
  }
  now.push(`電話 ${PHONE_LABELS[w.phone]}`);
  const roads = new Map<string, boolean>();
  for (const r of w.roads) if (AREA_ROADS.some((x) => x.name === r.label)) roads.set(r.label, r.open);
  for (const [label, open] of roads) now.push(`${label} ${open ? "通行可" : "通行止"}`);
  for (const s of w.shelters) if (AREA_SHELTERS.some((x) => x.name === s.label)) now.push(`${s.label} ${SHELTER_LABELS[s.state]}`);
  const fac = new Map<string, boolean>();
  for (const f of w.facilities) if (AREA_FACILITIES.some((x) => x.name === f.label)) fac.set(f.label, f.open);
  for (const [label, open] of fac) now.push(`${label} ${open ? "稼働" : "休止"}`);
  return now;
}

/** 刻みの文（部屋には毎刻みこれだけ。最初の刻みは地理と本人たちを先に足す） */
export function tickText(input: WorldInput, cast: Pick<WorldCast, "key">, prevHour: number, last: number): string {
  const aliasOf = new Map(cast.key.people.map((p) => [p.personId, p.alias]));
  const acts = actionLines(input.actions, prevHour, aliasOf);
  const contacts = contactLines(input, prevHour, aliasOf);
  const seen = lastLines(input, aliasOf);
  const hints = hintLines(input, aliasOf);
  const ended = Object.keys(input.world.ended ?? {}).flatMap((p) => (aliasOf.has(p) ? [aliasOf.get(p)!] : []));
  return [
    `時刻: 発災から ${input.hour} 時間（${last} 時間まで）`,
    acts.length > 0 ? ["前の刻みからケアマネがした事:", ...acts].join("\n") : "前の刻みからケアマネがした事: なし",
    contacts.length > 0 ? ["前の刻みからの本人たちの連絡:", ...contacts].join("\n") : "前の刻みからの本人たちの連絡: なし",
    seen.length > 0 ? ["本人たちの最後の様子:", ...seen].join("\n") : "本人たちの最後の様子: なし",
    hints.length > 0 ? ["時計の目安（コードの計算。結末を迎えるかはあなたが決める）:", ...hints].join("\n") : "時計の目安: 走っている時計なし",
    `もう結末を迎えた人（挙げない）: ${ended.length > 0 ? ended.join("・") : "なし"}`,
  ].join("\n");
}

/** 最初の刻みの文（地理・本人たち・刻みの文） */
export function openingText(input: WorldInput, cast: WorldCast, last: number): string {
  return [geographyText(), cast.people, tickText(input, cast, 0, last)].join("\n\n");
}

// ---------- 1 回呼び ----------

/** 1 回呼びの要求。入力は伏せた文だけ。用途は監督（Opus）、system は部屋と同じ */
export function buildWorldRequest(parts: {
  opening: ForClaude<{ text: string }>;
  story: ForClaude<{ text: string }>;
  now: ForClaude<{ text: string }>;
  tick: ForClaude<{ text: string }>;
}): AskJsonRequest<typeof WorldStepSchema> {
  return {
    purpose: "director",
    system: WORLD_SYSTEM,
    input: { 地理と本人たち: parts.opening, これまでの世界: parts.story, 今の街: parts.now, この刻み: parts.tick },
    schema: WorldStepSchema,
  };
}

/**
 * 1 回呼びで世界の 1 刻み。部屋と違って前の刻みを覚えていないので、毎回、地理・本人たち・世界の履歴（world.story）・今の街を足す。
 * 失敗は投げる（呼ぶ側が差し込みなしに落とす）
 */
export async function worldOneshot(
  input: WorldInput,
  cast: WorldCast,
  ai: AskJsonContext,
  opts: { prevHour: number; last: number },
): Promise<{ step: WorldStep; incidents: DrillIncident[] }> {
  const story = input.world.story ?? [];
  const req = buildWorldRequest({
    opening: pseudonymizeText([geographyText(), cast.people].join("\n\n"), cast.key),
    story: pseudonymizeText(story.length > 0 ? story.join("\n") : "まだ無い（最初の刻み）", cast.key),
    now: pseudonymizeText(worldNow(input.world).join("\n"), cast.key),
    tick: pseudonymizeText(tickText(input, cast, opts.prevHour, opts.last), cast.key),
  });
  const r = await askJson(req, ai);
  return { step: r.value, incidents: worldIncidents(r.value, applyContext(input, cast, "oneshot"), input.hints.reached) };
}

/** 返事を当てる所に渡す物 */
export function applyContext(input: WorldInput, cast: WorldCast, via: WorldVia): ApplyContext {
  return { key: cast.key, facts: cast.facts, ended: new Set(Object.keys(input.world.ended ?? {})), hour: input.hour, via };
}
