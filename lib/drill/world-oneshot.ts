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
import { actionWords, CATALOG_WORDS } from "./action-catalog.ts";
import { CARE_LEVEL_LABELS, CLOCK_START_LABELS, CLOCK_UNIT_LABELS, DEVICE_LABELS, HOUSEHOLD_LABELS } from "../labels.ts";
import { pseudonymize, pseudonymizeText, type ForClaude, type PseudonymInput, type PseudonymKey } from "../pseudonym/index.ts";
import { aliasOfTown, areaOf, DEMO_AREA, geographyText, placesOf, townOfLedger, type Area } from "./area.ts";
import { DEMO_OFFICE_ID } from "../auth/demo.ts";
import { endingsAllowed } from "./fiction.ts";
import type { ActionRecord, DrillIncident, WorldInput } from "./engine.ts";
import { PHONE_LABELS, SHELTER_LABELS } from "./labels.ts";
import { nightLine } from "./night.ts";
import { hourText, minuteText } from "./time-text.ts";
import type { OutcomeSource } from "./outcome.ts";
import { scaleWords } from "./scale.ts";
import { oddsText, timelineText } from "./time-odds.ts";
import { stateLines } from "./state-rules.ts";
import { EVENT_LABELS } from "./event-catalog.ts";
import { reportersOf } from "./persona.ts";
import { factLines, factsOf, issuedBlock, planLines, planOf, supplyAllowed, type Plan } from "./person-facts.ts";
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
  phone: "電話の様子。value は ok・busy・down。town を書くとその地区だけ通話不可（down のとき）",
  shelter: "避難所。name に避難所の名前。value は open・crowded・full・closed",
  facility: "施設。name に施設の名前。value は closed（休止）か open（再開）",
  aftershock: "余震。value に震度（「4」「5弱」）",
  weather: "天候。value は rain（大雨）か clear（止む）",
  // T92（出来事の表と同じ形。名前は地理にある物だけ）
  welfare_shelter: "福祉避難所の開設。name に地理の福祉避難所の名前（空文字なら地理の福祉避難所）。value は open（開設）・full・closed",
  water_station: "給水所の開設（断水の地区。断水は続く）。town に地区",
  pharmacy: "地理の薬局の休止・再開。value は closed（休止）か open（再開）",
  helper: "介護事業所の休止（介護事業所を使う人のヘルパーが来られない）。value は closed",
  vendor: "酸素業者の巡回。target に酸素・呼吸器を使う人の仮名。value に何時間後に着くか（「4」。2〜12）",
  info: "避難の情報が食い違って広まる。value は空文字",
};

/** 世界の指示（部屋の system と 1 回呼びの system に同じ物を使う） */
export const WORLD_SYSTEM = [
  "災害の訓練（発災から 72 時間）の「世界」。街と、在宅で介護を受ける高齢者たち（人数は訓練ごとに違う。入力の本人たちに並ぶ人だけ）の訓練で、ケアマネが誰から順に連絡するかを試す。",
  "あなたは街の出来事を進め、訓練の架空の人の結末も決める（入力に「結末: 決めない」とある訓練では決めない）。刻みごとに、今の時刻と、前の刻みからケアマネがした事・本人たちの最後の様子・時計の目安が届く。",
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
  "  入力に「結末: 決めない」とある訓練では、誰の結末も決めない。farewells はいつも空の配列にする（時計の目安は街の流れの参考にだけ使う）。",
  "",
  "決まり:",
  "1. 人の体の状態（けが・病状・意識）を events と narration に書かない。書くのは街と物の事実だけ。本人たちの様子は別の役が演じる。",
  "2. 結末を決める訓練でも、結末は 1 刻みに 2 人まで。本人たち（仮名）の中からだけ選ぶ。急がず、流れに沿って決める。",
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
  /** 事業所の地理（T70、lib/drill/area.ts の areaOf。デモ事業所は架空の街、ほかは参加者の台帳の町名から） */
  area: Area;
  /**
   * 結末を決めさせるか（T70 の続き、lib/drill/fiction.ts の endingsAllowed）。デモ事業所だけ true。
   * false なら入力に「結末: 決めない」と書き、返ってきた結末は捨てる（world-apply.ts の ApplyContext.endings）
   */
  endings: boolean;
  /** 本人ごとの計画（T130、lib/drill/person-facts.ts の planOf）。最初の刻みの本人たちの欄と、業者の巡回の門に使う */
  plans?: Map<string, Plan>;
};

/**
 * 参加者の台帳から仮名・事実・台帳の要約・地理を作る。台帳の無い参加者は外す。
 * officeId はデモ事業所か（デモは架空の街のまま）を見る。無ければデモ事業所
 */
export function buildCast(
  participants: ReadonlyArray<string>,
  sources: ReadonlyMap<string, PseudonymInput>,
  outcomeSources: ReadonlyMap<string, OutcomeSource>,
  on?: string,
  officeId: string = DEMO_OFFICE_ID,
): WorldCast {
  const members = participants.filter((p) => sources.has(p));
  const list = members.map((p) => sources.get(p)!);
  const dependsOf = (p: string) => (outcomeSources.get(p)?.clocks ?? []).flatMap((k) => (k.depends_on ? [k.depends_on] : []));
  const nurseOf = (src: PseudonymInput) => src.contacts.some((c) => c.kind === "visiting_nurse");
  const area = areaOf(
    officeId,
    members.map((p, i) => ({ ledger: list[i].ledger, depends: dependsOf(p), nurse: nurseOf(list[i]) })),
  );
  // 町名は地区の別名で渡す（T88。本人たちの欄・これまでの世界・刻みの文に町名が入っても、地理と同じ別名に）
  const { payload, key } = pseudonymize(list, { ...(on ? { on } : {}), places: placesOf(area, list.map((x) => x.ledger)) });
  const facts = new Map<string, PersonFacts>();
  const plans = new Map<string, Plan>();
  const lines: string[] = [];
  members.forEach((p, i) => {
    const src = list[i];
    const plan = planOf(src);
    plans.set(p, plan);
    facts.set(p, {
      town: townOfLedger(src.ledger, area),
      depends: dependsOf(p),
      categories: src.clocks.map((k) => k.category),
      nurse: nurseOf(src),
      helper: src.contacts.some((c) => c.kind === "care_service"),
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
        // T130: 計画（停電のときの予備・避難先の種類と手段・在宅避難・業者の約束）。連絡が取れなくても計画どおりに動く。場所の名前は書かない
        `  計画: ${planLines(plan).join("／")}`,
      ].join("\n"),
    );
  });
  return { key, facts, plans, people: ["本人たち（仮名。どこに住むかは書かない）:", ...lines].join("\n"), area, endings: endingsAllowed(officeId) };
}

const ACTION_WORDS: Readonly<Record<ActionRecord["kind"], string>> = CATALOG_WORDS;

const COLOR_WORDS = { red: "赤（無事じゃない）", green: "緑（無事）", unknown: "連絡（安否は不明）" } as const;

/** 前の刻みからケアマネがした事（仮名）。結果は「届いた」「届かなかった」だけ */
function actionLines(actions: ReadonlyArray<ActionRecord>, from: number, aliasOf: ReadonlyMap<string, string>): string[] {
  return actions
    .filter((a) => a.atMinute >= from * 60)
    .map((a) => {
      const who = a.person ? (aliasOf.get(a.person) ?? null) : null;
      const r = a.result ? (a.result.ok ? "届いた" : "届かなかった") : "途中";
      return `- ${minuteText(a.atMinute)}: ${a.kind === "free" ? actionWords(a) : ACTION_WORDS[a.kind]}${who ? `（${who}）` : ""} → ${r}`;
    });
}

/** 前の刻みからの本人たちの連絡の要約（仮名。言う事は書かない＝本人役の言葉を世界が拾わない） */
function contactLines(input: WorldInput, from: number, aliasOf: ReadonlyMap<string, string>): string[] {
  return Object.entries(input.people)
    .filter(([p, s]) => s.at >= from && aliasOf.has(p))
    .map(([p, s]) => `- ${aliasOf.get(p)}: ${hourText(s.at)}に${COLOR_WORDS[s.color]}`);
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
      return `- ${alias}: ${hourText(s.at)}に${COLOR_WORDS[s.color]}${s.whereNow ? `、${WHERE_WORDS[s.whereNow]}` : ""}`;
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

/** 今の街の様子（地区は別名。道・避難所・施設は地理にある物だけ） */
export function worldNow(w: WorldState, area: Area = DEMO_AREA): string[] {
  const now: string[] = [];
  if (w.weather) now.push(w.weather === "rain" ? "大雨" : "雨は止んだ");
  if (w.quake) now.push(`地震 震度 ${w.quake}`);
  if (w.outage) {
    const o = w.outage;
    const where = o.area.scope === "towns" ? o.area.towns.map((t) => aliasOfTown(t, area) ?? "地区").join("・") : "全域";
    now.push(o.restoredAt != null ? `停電 復旧（${hourText(o.restoredAt)}）` : `停電中（${where}）`);
  }
  now.push(`電話 ${PHONE_LABELS[w.phone]}`);
  const roads = new Map<string, boolean>();
  for (const r of w.roads) if (area.roads.some((x) => x.name === r.label)) roads.set(r.label, r.open);
  for (const [label, open] of roads) now.push(`${label} ${open ? "通行可" : "通行止"}`);
  for (const s of w.shelters) if (area.shelters.some((x) => x.name === s.label)) now.push(`${s.label} ${SHELTER_LABELS[s.state]}`);
  const fac = new Map<string, boolean>();
  for (const f of w.facilities) if (area.facilities.some((x) => x.name === f.label)) fac.set(f.label, f.open);
  for (const [label, open] of fac) now.push(`${label} ${open ? "稼働" : "休止"}`);
  return now;
}

/** 刻みの文（部屋には毎刻みこれだけ。最初の刻みは地理と本人たちを先に足す） */
export function tickText(input: WorldInput, cast: Pick<WorldCast, "key"> & Partial<Pick<WorldCast, "endings" | "facts" | "plans">>, prevHour: number, last: number): string {
  const endings = cast.endings !== false;
  const aliasOf = new Map(cast.key.people.map((p) => [p.personId, p.alias]));
  // 連続の時計の訓練（T90）は前の区切りの時刻（分）から。刻みの道は前の刻みの時刻
  const from = input.since !== undefined ? input.since / 60 : prevHour;
  const acts = actionLines(input.actions, from, aliasOf);
  const contacts = contactLines(input, from, aliasOf);
  const seen = lastLines(input, aliasOf);
  const hints = hintLines(input, aliasOf);
  const ended = Object.keys(input.world.ended ?? {}).flatMap((p) => (aliasOf.has(p) ? [aliasOf.get(p)!] : []));
  return [
    `時刻: 発災から ${hourText(input.hour)}（${last} 時間まで）`,
    // 夜間発災（T59）だけ。時刻の 1 行
    ...(input.night ? [nightLine(input.hour)] : []),
    // 規模（T104、lib/drill/scale.ts）。開始の前に決めた災害と規模（おまかせも開始の時に決まる）。規模の無い前からの訓練は書かない
    ...(input.scale ? [scaleWords(input.scale)] : []),
    // 発災からの時間の帯の目安（T104、lib/drill/time-odds.ts。世界には文だけ）
    timelineText(input.hour, { with: "world" }),
    // 起きやすい物・起きにくい物と、この訓練の傾向（T121。出来事の表の印の言葉で。世界の部屋の指示は変えない）
    ...(input.seed ? [oddsText(input.hour, input.seed, (k) => EVENT_LABELS[k])] : []),
    // 今の状態のいつからと、まだ変わらない時刻（T121、lib/drill/state-rules.ts）。連続の時計の訓練だけ
    ...(input.since !== undefined
      ? [
          [
            "今の状態（いつから・まだ変わらない時刻。決まりに反する出来事は使われない）:",
            ...stateLines(input.world, Math.round(input.hour * 60), (p) => (p && aliasOf.has(p) ? aliasOf.get(p)! : null)).map((x) => `- ${x}`),
          ].join("\n"),
        ]
      : []),
    acts.length > 0 ? ["前の刻みからケアマネがした事:", ...acts].join("\n") : "前の刻みからケアマネがした事: なし",
    contacts.length > 0 ? ["前の刻みからの本人たちの連絡:", ...contacts].join("\n") : "前の刻みからの本人たちの連絡: なし",
    seen.length > 0 ? ["本人たちの最後の様子:", ...seen].join("\n") : "本人たちの最後の様子: なし",
    // T130: 人ごとの事実の帳面（コードが引く。いる所・前に言った事・来た人・声・電気と予備）。街の出来事も結末もこれと食い違わない
    ...personFactBlock(input, cast, aliasOf),
    // もう出した出来事（T130。同じ言い回しを別の人に使わない）
    ...issuedBlock(input.world, (k) => EVENT_LABELS[k as keyof typeof EVENT_LABELS] ?? k, (p) => (p && aliasOf.has(p) ? aliasOf.get(p)! : null)),
    hints.length > 0
      ? [endings ? "時計の目安（コードの計算。結末を迎えるかはあなたが決める）:" : "時計の目安（コードの計算。街の流れの参考）:", ...hints].join("\n")
      : "時計の目安: 走っている時計なし",
    // デモ以外の事業所（T70 の続き）は結末を求めない。デモ事業所の文は前と同じ
    endings ? `もう結末を迎えた人（挙げない）: ${ended.length > 0 ? ended.join("・") : "なし"}` : "結末: 決めない（この訓練では farewells はいつも空の配列）",
    // T130: 結末の理由に医療の言い方を入れない（評価の 3 回目で、機器の名前と状態が理由に入った。世界の指示は変えずに刻みの文で）
    ...(endings ? [REASON_RULE_LINE] : []),
  ].join("\n");
}

/** 結末の理由の決まりの 1 行（刻みの文。WORLD_SYSTEM は変えない） */
export const REASON_RULE_LINE =
  "結末の reason は停電・道・届いた手の事実だけで書く（機器・体・薬の名前と、その状態を書かない。「停電が続き、電源も人も届かなかった」の形）";

/**
 * 本人ごとの帳面の行（T130。仮名で。計画は最初の刻みの本人たちの欄にあるので、ここは今の事実だけ）。停電の地区は本人の町で見る
 */
function personFactBlock(input: WorldInput, cast: Pick<WorldCast, "key"> & Partial<Pick<WorldCast, "facts" | "plans">>, aliasOf: ReadonlyMap<string, string>): string[] {
  const ended = input.world.ended ?? {};
  const o = input.world.outage;
  const lines = [...aliasOf]
    .filter(([p]) => !ended[p])
    .flatMap(([p, alias]) => {
      const town = cast.facts?.get(p)?.town ?? null;
      const inOutage = !!o && (o.area.scope === "office" || (o.area.scope === "towns" && (!town || o.area.towns.includes(town))));
      const f = factsOf({
        person: p,
        world: input.world,
        state: input.people[p] ?? null,
        actions: input.actions.filter((a) => a.person === p),
        now: Math.round(input.hour * 60),
        plan: cast.plans?.get(p) ?? null,
        inOutage,
      });
      const xs = factLines(f).filter((x) => !x.startsWith("来た人・届いた物: まだ無い"));
      return xs.length > 0 ? [`- ${alias}: ${xs.join("／")}`] : [];
    });
  return lines.length > 0 ? [["人ごとの事実（コードの記録。出来事・結末はこれと食い違わない）:", ...lines].join("\n")] : [];
}

/** 最初の刻みの文（地理・本人たち・刻みの文） */
export function openingText(input: WorldInput, cast: WorldCast, last: number): string {
  return [geographyText(cast.area), cast.people, tickText(input, cast, 0, last)].join("\n\n");
}

// ---------- 1 回呼び ----------

/** 1 回呼びの要求。入力は伏せた文だけ。用途は監督（Opus、effort は PURPOSES の director の high で部屋の Agent と同じ）、system は部屋と同じ */
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
    opening: pseudonymizeText([geographyText(cast.area), cast.people].join("\n\n"), cast.key),
    story: pseudonymizeText(story.length > 0 ? story.join("\n") : "まだ無い（最初の刻み）", cast.key),
    now: pseudonymizeText(worldNow(input.world, cast.area).join("\n"), cast.key),
    tick: pseudonymizeText(tickText(input, cast, opts.prevHour, opts.last), cast.key),
  });
  const r = await askJson(req, ai);
  return { step: r.value, incidents: worldIncidents(r.value, applyContext(input, cast, "oneshot"), input.hints.reached) };
}

/** 返事を当てる所に渡す物 */
export function applyContext(input: WorldInput, cast: WorldCast, via: WorldVia): ApplyContext {
  return {
    key: cast.key,
    facts: cast.facts,
    ended: new Set(Object.keys(input.world.ended ?? {})),
    hour: input.hour,
    via,
    area: cast.area,
    endings: cast.endings,
    // T130: 業者の巡回（届く物）は、その人への手か計画（業者の約束）があるときだけ
    supplyOk: (person: string) => supplyAllowed(person, input.actions, cast.plans?.get(person) ?? null),
  };
}
