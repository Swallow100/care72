// 評価の台（docs/tasks/T108.md）の偽の Claude と偽の世界の部屋。本物の API を呼ばない。返事は種（rng）から作る。
//
// - 役（本人役・通話・往復・訪問・監督・世界・自由文の読み替え・講評・審査役）は送った system の文で見分け（roles.ts）、
//   入力の文（仮名化した物）を読んで、形の合う返事を作る。見分けられない役は返事の形（JSON Schema）から空の返事
// - 偽の返事の多様さ・token は作り物。比べる基準にしない（数は「偽」と書いて出す）
// - noise（0〜1）は、決まりを破る言葉・壊れた JSON を混ぜる割合（検査が拾うかを確かめるため。既定 0）
// - token は文字数からの推し量り（1 字 ≒ 0.8 token、考える分は effort ごとの固定の数）

import type Anthropic from "@anthropic-ai/sdk";
import type { ClaudeClient } from "../../../lib/claude/client.ts";
import { DIRECTOR_SOURCES, DIRECTOR_SYSTEM } from "../../../lib/drill/director.ts";
import { REVIEW_ACTION_LABELS, REVIEW_KINDS, REVIEW_TOPICS } from "../../../lib/drill/review.ts";
import { ASK_KINDS } from "../../../lib/drill/scenarios.ts";
import { WORLD_TOOL, type RoomClient, type RoomEvent } from "../../../lib/drill/world-room.ts";
import { NO_BASIS } from "../../../lib/sources/prompt.ts";
import { isPersonaBatch, isVirtualPersona, roleOfSystem, systemTexts, type Role } from "./roles.ts";
import type { Rng } from "./rng.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

export type FakeOptions = {
  rng: Rng;
  /** 決まりを破る言葉・壊れた JSON を混ぜる割合（0〜1）。既定 0 */
  noise?: number;
  /**
   * 返事の待ちの縮尺（T123）。役ごとの本物の待ちの目安（LATENCY_MS、評価の 2 回目の平均）にこの数を掛けて待つ（0.01 なら 100 分の 1）。
   * 進める 1 回の待ちの形（監督と本人役が順か並びか・最後の刻みの監督）を偽の回で比べるため。既定 0（待たない）
   */
  latency?: number;
  /**
   * 往復の返事をわざと繰り返す・いる所を揺らす割合（T158、0〜1。既定 0）。当たった往復は、前の返事をそのまま返すか、前の返事と逆のいる所
   * （避難所 ↔ 家）を言う。通話の検査（talk-check.ts）が数えられるか・門（同じ通話の前の返事の文を落とす）が効くかの確かめ
   */
  talkEcho?: number;
};

/** 役ごとの本物の待ちの目安（ミリ秒。評価の 2 回目の訓練の記録の平均。本人役のまとめ呼びは 1 人より長い） */
export const LATENCY_MS: Readonly<Partial<Record<Role | "persona_batch" | "world_room", number>>> = {
  director: 12000,
  persona: 5000,
  persona_batch: 8000,
  persona_call: 4000,
  persona_talk: 5000,
  persona_visit: 5000,
  world: 11000,
  world_room: 7000,
  free: 2600,
  judge: 15000,
  review: 15000,
  // 人ごとの講評（T185。Haiku・medium・1 人分の短い返事の目安）
  review_person: 5000,
};

const pause = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

/** 役の待ち（縮尺つき。揺れは 0.6〜1.8 倍で、本物と同じく遅い物がまれに出る） */
function latencyOf(opts: FakeOptions, rng: Rng, role: keyof typeof LATENCY_MS): number {
  if (!opts.latency) return 0;
  const x = rng.next();
  return Math.round((LATENCY_MS[role] ?? 3000) * opts.latency * (x < 0.85 ? 0.6 + x : 1.8));
}

// ---------- token の推し量り ----------

const THINKING: Readonly<Record<string, number>> = { low: 150, medium: 600, high: 2500, xhigh: 4000, max: 6000 };

export const tokensOf = (text: string): number => Math.ceil(Array.from(text).length * 0.8);

/** 送った文（system と利用者の文） */
export function sentText(params: Pick<Params, "system" | "messages">): string {
  const user = params.messages
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : (m.content ?? []).map((b) => (b.type === "text" ? b.text : `[${b.type}]`)).join("\n"),
    )
    .join("\n");
  return [...systemTexts(params.system), user].join("\n");
}

function message(params: Params, text: string): Message {
  const effort = (params.output_config as { effort?: string } | undefined)?.effort ?? "medium";
  return {
    id: `msg_fake_${Math.random().toString(36).slice(2, 10)}`,
    type: "message",
    role: "assistant",
    model: params.model,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: {
      input_tokens: tokensOf(sentText(params)),
      output_tokens: tokensOf(text) + (THINKING[effort] ?? 600),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Message;
}

// ---------- 入力の読み方 ----------

type Input = Record<string, unknown>;

function inputOf(params: Params): Input {
  const c = params.messages[0]?.content;
  const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b.type === "text" ? b.text : "")).join("") : "";
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Input) : {};
  } catch {
    return {};
  }
}

const textOf = (v: unknown): string => (v && typeof v === "object" && typeof (v as { text?: unknown }).text === "string" ? (v as { text: string }).text : "");

const ALIAS = /([A-Z]{1,2}) さん/g;
const aliasesIn = (text: string): string[] => [...new Set([...text.matchAll(ALIAS)].map((m) => `${m[1]} さん`))];

// ---------- 言葉のかけら（偽の返事の材料。人の名前・町名を書かない） ----------

const SITUATIONS: ReadonlyArray<readonly [RegExp, ReadonlyArray<string>]> = [
  [/停電/, ["電気がつかないんです", "停電したままです", "電気が止まって暗いです", "冷蔵庫も止まっています"]],
  [/浸水|水が来|氾濫/, ["家の前まで水が来ています", "床の下まで水が上がってきました", "外が水につかっています"]],
  [/断水|給水/, ["水が出なくて困っています", "水道が止まりました", "飲み水が少なくなってきました"]],
  [/余震|震度|地震/, ["揺れがこわくて眠れません", "また揺れました", "棚の物が落ちてきました"]],
  [/通行止|土砂/, ["道が通れないそうです", "近くの道がふさがっています"]],
  [/通話|電話/, ["電話がつながりにくいです", "電話がなかなか通じません"]],
  [/避難所|満員|開設/, ["避難所はもう人でいっぱいだそうです", "避難所に行くか迷っています"]],
  // T141: 電池の残りの数・切れた事・家の外（本物の本人役が帳面と食い違えた形。数は帳面と合わない事がある）。検査と門が拾うかの確かめ
  [/内蔵の電池で動いている|予備の残り|予備に替えた/, ["呼吸器の電池があと3時間しかもちません", "予備の電池があと2時間ほどです", "電池が切れました", "予備の電池に替えました"]],
  [/に切れた|切れた。予備は無く|電気で動いている/, ["電池が切れました", "予備も切れました", "電池が切れたままです"]],
  [/いる所: 家/, ["今は家の外にいます", "家で様子を見ています"]],
];
const CALM = ["今のところ家にいます", "特に変わりはありません", "なんとか過ごしています", "落ち着いています"];
const RED_NEEDS = ["誰か来てもらえませんか", "薬が残り少ないんです", "動けなくて困っています", "足を打ってしまいました", "一人では外に出られません", "胸が少し苦しいと言っています"];
const GREEN_NEEDS = ["こちらは大丈夫です", "避難所に着きました", "近所の人が見てくれています", "家族と一緒にいます", "心配いりません"];
const SUBJECTS = ["母は", "父は", "うちの人は", "祖母は", "本人は"];
const OPENINGS = ["", "あの、", "すみません、", "もしもし、", "ケアマネさん、"];
const CONDITIONS = ["横になっている", "椅子に座っている", "落ち着かない様子", "家族と一緒にいる", "暗い部屋で待っている", "荷物をまとめている", "窓の外を見ている"];
const DOINGS = ["家の中で待つ", "懐中電灯を探す", "家族に電話する", "避難の支度をする", "近所の人と話す", "布団で休む", "水をくむ"];

/** 決まりを破る言葉（noise）。検査が拾うかの確かめ */
export const NOISE_WORDS = [
  "重症かもしれません",
  "薬を2錠多めに飲ませました",
  "もう死亡しているかもしれません",
  "090-1234-5678 に電話ください",
  "B さんにも伝えてください",
  // T118: 薬の量（単位・流量）・病名・医療の助言・人の生き死にの言い方
  "インスリンは10単位打ちました",
  "酸素は2L/分にしています",
  "糖尿病があるので心配です",
  "薬を飲んだほうがいいですよ",
  "息を引き取ったかもしれない",
];

function situation(rng: Rng, text: string): string {
  const hits = SITUATIONS.filter(([re]) => re.test(text));
  return hits.length > 0 ? rng.pick(rng.pick(hits)[1]) : rng.pick(CALM);
}

/**
 * 長い言い足し（T139）。本物の本人役の返事は上限を超えることがあった（評価の 4 回目で 88 字ほど）。偽の返事にも時々足して、
 * 上限で文の途中から切れないか（lib/drill/clip.ts）を台で数えられるように
 */
const LONG_TAILS = [
  "電池の残りが少なくなってきているので業者さんか訪問看護の人に早めに来てもらえると本当に助かるのですがどうしたらいいでしょうか",
  "道が通れるかどうかも分からないし家族とも連絡がつながりにくくて、このまま家で待っていればいいのか避難所に行った方がいいのか迷っています",
  "さっきから何度も電話をかけているのですがなかなかつながらなくて、薬の残りも気になるので一度様子を見に来てもらえないでしょうか",
];

function speechOf(rng: Rng, from: string, text: string, red: boolean, call?: string | null): string {
  const self = from === "本人" || from === "";
  // 話す人の本人の呼び方（本人役の説明の「話す人」の行、T121）があればそれで。無ければ決まった言い方から
  const subject = self ? "" : call ? `${call}は` : rng.pick(SUBJECTS);
  const need = red ? rng.pick(RED_NEEDS) : rng.pick(GREEN_NEEDS);
  const base = `${rng.pick(OPENINGS)}${subject}${situation(rng, text)}。${need}`;
  return rng.chance(0.3) ? `${base}。${rng.pick(LONG_TAILS)}` : base;
}

function withNoise(opts: FakeOptions, rng: Rng, speech: string): string {
  return opts.noise && rng.chance(opts.noise) ? `${speech}。${rng.pick(NOISE_WORDS)}` : speech;
}

// ---------- 役ごとの返事 ----------

/** 押せる人の行（「押せる人（…）: 本人、娘」） */
function pressersOf(profile: string): string[] {
  const m = profile.match(/押せる人（[^）]*）: (.+)/);
  if (!m || m[1].trim() === "いない") return [];
  return m[1].split("、").map((x) => x.trim()).filter(Boolean);
}

function personaAnswer(rng: Rng, input: Input, opts: FakeOptions, virtual: boolean) {
  const profile = textOf(input["本人役"]);
  const tick = textOf(input["この刻み"]);
  const pressers = pressersOf(profile);
  const fixed = tick.includes("想定の表のこの刻みの行（この通りに連絡する）");
  const reason = tick.includes("この区切りで起きた事");
  const bad = /停電中|浸水|通行止|断水|余震|震度|通話できない|来られない|休止/.test(tick);
  const contacts = fixed || (pressers.length > 0 && rng.chance(reason ? 0.55 : virtual ? 0.3 : 0.2));
  const from = !contacts ? "" : fixed ? (pressers[0] ?? "本人") : rng.pick(pressers);
  const red = contacts && rng.chance(bad ? 0.4 : 0.12);
  const origin = tick.match(/言う事の元「([^」]*)」/)?.[1];
  const speaker = profile.match(/家族から連絡するのは (\S+?)（本人を「([^」]+)」/);
  const call = speaker && speaker[1] === from ? speaker[2] : null;
  const speech = !contacts ? "" : origin && rng.chance(0.5) ? `${rng.pick(OPENINGS)}${origin}` : speechOf(rng, from, tick, red, call);
  const location = speech.includes("避難所に着き") ? "shelter" : rng.weighted<string>([["home", 6], ["shelter", 2], ["other", 1], ["unknown", 1]]);
  const yn = () => rng.weighted<boolean | null>([[true, 3], [false, 4], [null, 2]]);
  return {
    condition: rng.pick(CONDITIONS),
    location,
    action: rng.pick(DOINGS),
    contactsCaremanager: contacts,
    from,
    pressesRed: red,
    redAnswers: red ? { injured: yn(), atHome: yn(), canMove: yn(), hasMedicine: yn() } : null,
    speech: speech ? withNoise(opts, rng, speech) : "",
  };
}

/** まとめて呼んだ本人役（T121）。番号ごとの文（「本人役:」と「この刻み:」）を分けて、1 人ずつ同じ作り方で答える */
function personaBatchAnswer(rng: Rng, input: Input, opts: FakeOptions, virtual: boolean) {
  const answers = Object.entries(input).map(([id, v]) => {
    const text = textOf(v);
    const at = text.indexOf(TICK_HEAD);
    const profile = at >= 0 ? text.slice(0, at).replace(PROFILE_HEAD, "") : text;
    const tick = at >= 0 ? text.slice(at + TICK_HEAD.length) : "";
    return { id, ...personaAnswer(rng.fork(id), { 本人役: { text: profile }, この刻み: { text: tick } }, opts, virtual) };
  });
  return { answers };
}

/** まとめた本人役の 1 人の文の区切り（lib/drill/persona.ts の createPersonaBatchHook と同じ） */
const TICK_HEAD = "\n\nこの刻み:\n";
const PROFILE_HEAD = /^本人役:\n/;

/** 往復の文の「それまでの話」のうち、電話に出た人の行（T158） */
function priorReplies(call: string): string[] {
  const at = call.indexOf("それまでの話:");
  if (at < 0) return [];
  return call
    .slice(at)
    .split("\n")
    .slice(1)
    .filter((l) => l.startsWith("- ") && !l.startsWith("- ケアマネ:"))
    .map((l) => l.replace(/^- [^:]+: 「/u, "").replace(/」$/u, ""));
}

/** わざと繰り返す・いる所を揺らす返事（T158）。前の返事が無ければ避難所、奇数回目は前のまま、偶数回目は前と逆のいる所 */
const ECHO_SHELTER = "今は避難所にいます。母は横になって休んでいます。";
const ECHO_HOME = "今は家にいます。母と二人でいて、母は横になって休んでいます。";
function echoAnswer(call: string): { speech: string; asks: string[] } {
  const prior = priorReplies(call);
  const last = prior.at(-1);
  if (!last) return { speech: ECHO_SHELTER, asks: [] };
  if (prior.length % 2 === 1) return { speech: last, asks: [] };
  return { speech: last.includes("避難所") ? ECHO_HOME : ECHO_SHELTER, asks: [] };
}

function callAnswer(rng: Rng, input: Input, opts: FakeOptions, talk: boolean) {
  const call = textOf(input["電話"]);
  if (talk && opts.talkEcho && rng.chance(opts.talkEcho)) return echoAnswer(call);
  const red = /伝える様子: 赤/.test(call);
  const who = call.match(/電話に出た人: (.+)/)?.[1]?.trim() ?? "本人";
  const speech = withNoise(opts, rng, speechOf(rng, who, call, red));
  const asks = talk ? rng.shuffle(ASK_KINDS).slice(0, rng.weighted([[0, 5], [1, 3], [2, 1]])) : [];
  return talk ? { speech, asks } : rng.chance(0.5) ? { speech } : { speech, asks: [] };
}

function visitAnswer(rng: Rng, input: Input, opts: FakeOptions) {
  const visit = textOf(input["訪問"]);
  return {
    condition: rng.pick(CONDITIONS),
    location: rng.weighted<string>([["home", 7], ["shelter", 1], ["other", 1]]),
    asks: rng.shuffle(ASK_KINDS).slice(0, rng.weighted([[0, 4], [1, 3], [2, 2], [3, 1]])),
    speech: withNoise(opts, rng, speechOf(rng, rng.pick(["本人", "娘"]), visit, rng.chance(0.3))),
  };
}

/** 監督の種類ごとの after の範囲（指示の文の「- kind（…）: …。after a〜b 時間」） */
const AFTER_RANGES: ReadonlyMap<string, readonly [number, number]> = new Map(
  [...DIRECTOR_SYSTEM.matchAll(/^- ([a-z0-9_]+)（[^）]*）: .*?。after (\d+)〜(\d+) 時間$/gmu)].map((m) => [m[1], [Number(m[2]), Number(m[3])] as const]),
);

const REASONS = ["支援者がいない", "残り時間が短い", "空欄が多い", "連絡がない", "押せる人がいない", "頼み事が残っている", "避難先が決まっていない"];

function directorAnswer(rng: Rng, input: Input, opts: FakeOptions) {
  const scene = textOf(input["想定"]);
  const weak = textOf(input["弱点"]);
  const budget = Number(scene.match(/差し込める数: (\d+)/)?.[1] ?? "2");
  const persons: Array<{ alias: string; kinds: string[] }> = [];
  let area: string[] = [];
  let self: string[] = [];
  for (const line of weak.split("\n")) {
    const p = line.match(/^- ([A-Z]{1,2} さん): /);
    if (p) persons.push({ alias: p[1], kinds: [] });
    const k = line.match(/^\s+差し込める種類: (.+)$/);
    if (k && persons.length > 0) persons[persons.length - 1].kinds = k[1] === "なし" ? [] : k[1].split("、");
    const a = line.match(/^全体に差し込める種類: (.+)$/);
    if (a) area = a[1] === "なし" ? [] : a[1].split("、");
    const s = line.match(/自分に差し込める種類: ([^（]+)/);
    if (s) self = s[1].trim() === "なし" ? [] : s[1].trim().split("、");
  }
  const want = Math.min(budget, rng.weighted([[0, 35], [1, 40], [2, 20], [3, 5]]));
  const events: Array<Record<string, unknown>> = [];
  const used = new Set<string>();
  let areaUsed = false;
  for (let i = 0; i < want; i++) {
    const open = persons.filter((p) => p.kinds.length > 0 && !used.has(p.alias));
    const wide = [...area, ...self];
    const usePerson = open.length > 0 && (areaUsed || wide.length === 0 || rng.chance(0.7));
    let target: string;
    let kind: string;
    if (usePerson) {
      const p = rng.pick(open);
      used.add(p.alias);
      target = p.alias;
      kind = rng.pick(p.kinds);
    } else if (!areaUsed && wide.length > 0) {
      areaUsed = true;
      kind = rng.pick(wide);
      target = self.includes(kind) ? "自分" : "全体";
    } else break;
    const range = AFTER_RANGES.get(kind);
    const text = opts.noise && rng.chance(opts.noise) ? "家の中で亡くなった人がいる" : "";
    events.push({
      target,
      kind,
      text,
      reason: `${rng.pick(REASONS)}ので、${rng.pick(REASONS)}所を確かめる`,
      basis: rng.chance(0.6) ? rng.pick(DIRECTOR_SOURCES) : NO_BASIS,
      ...(range ? { after: rng.int(range[0], range[1]) } : {}),
    });
  }
  const asked = textOf(input["返事"]);
  const replies = [...asked.matchAll(/^- (a\d+): .*?今の文「(.*?)」$/gmu)].map((m) => ({ id: m[1], text: rng.chance(0.5) ? m[2] : `${m[2]}とのこと` }));
  return replies.length > 0 ? { events, replies } : { events };
}

// ---------- 世界（1 回呼びと部屋で同じ） ----------

type Geography = { towns: string[]; roads: string[]; shelters: Array<{ name: string; welfare: boolean }>; facilities: string[]; persons: string[]; disaster: "rain" | "quake" | null };

/** 世界の文から地理を読み、前に読んだ物に足す（最初の刻みだけ地理が届く） */
export function readGeography(text: string, prev: Geography): Geography {
  const towns = new Set(prev.towns);
  const roads = new Set(prev.roads);
  const shelters = new Map(prev.shelters.map((s) => [s.name, s] as const));
  const facilities = new Set(prev.facilities);
  let section = "";
  for (const line of text.split("\n")) {
    if (/^地区（/.test(line)) section = "towns";
    else if (line.startsWith("主な道:")) section = "roads";
    else if (line.startsWith("避難所:")) section = "shelters";
    else if (line.startsWith("施設")) section = "facilities";
    else if (!line.startsWith("- ")) section = "";
    const item = line.match(/^- ([^（:]+?)(?:（(.*)）)?(?::|$)/);
    if (!item || !section) continue;
    const name = item[1].trim();
    if (section === "towns") towns.add(name);
    else if (section === "roads") roads.add(name);
    else if (section === "shelters") shelters.set(name, { name, welfare: (item[2] ?? "").includes("福祉避難所") });
    else if (section === "facilities" && name !== "なし") facilities.add(name);
  }
  for (const m of text.matchAll(/([甲乙丙丁戊己庚辛壬癸]\d*地区)/gu)) towns.add(m[1]);
  const disaster = text.includes("この訓練の災害は大雨") ? "rain" : text.includes("この訓練の災害は地震") ? "quake" : prev.disaster;
  return {
    towns: [...towns],
    roads: [...roads],
    shelters: [...shelters.values()],
    facilities: [...facilities],
    persons: [...new Set([...prev.persons, ...aliasesIn(text)])],
    disaster,
  };
}

export const EMPTY_GEOGRAPHY: Geography = { towns: [], roads: [], shelters: [], facilities: [], persons: [], disaster: null };

const RAIN_KINDS = ["flood", "landslide", "road", "outage", "water", "phone", "shelter", "weather", "welfare_shelter", "water_station", "info"] as const;
const QUAKE_KINDS = ["aftershock", "road", "outage", "water", "phone", "shelter", "facility", "pharmacy", "helper", "vendor", "welfare_shelter", "info"] as const;
const NARRATIONS = {
  rain: ["雨脚が強まり、川の水位が上がっている", "低い地区で道路に水があふれ始めた", "雨は小康状態だが、川はまだ高い", "夜になり、停電の地区が広がっている"],
  quake: ["余震が続き、古い家の壁にひびが見える", "道路の段差で車が通りにくい", "給水所に列ができている", "電話がつながりにくい状態が続く"],
} as const;

function worldAnswer(rng: Rng, text: string, geo: Geography, opts: FakeOptions) {
  const disaster = geo.disaster ?? "rain";
  const town = () => (geo.towns.length > 0 ? rng.pick(geo.towns) : "");
  const n = rng.weighted([[0, 25], [1, 40], [2, 25], [3, 10]]);
  const events: Array<{ kind: string; town: string; target: string; name: string; value: string }> = [];
  for (let i = 0; i < n; i++) {
    const kind = rng.pick(disaster === "rain" ? RAIN_KINDS : QUAKE_KINDS);
    const e = { kind, town: "", target: "", name: "", value: "" };
    switch (kind) {
      case "flood":
        Object.assign(e, { town: town(), value: String(rng.pick([0.3, 0.5, 1, 1.5, 2])) });
        break;
      case "landslide":
      case "water_station":
        e.town = town();
        break;
      case "road":
        Object.assign(e, geo.roads.length > 0 && rng.chance(0.7) ? { name: rng.pick(geo.roads) } : { town: town() }, { value: rng.chance(0.75) ? "通行止" : "開通" });
        break;
      case "outage":
        Object.assign(e, { town: town(), value: rng.chance(0.8) ? "停止" : "復旧" });
        break;
      case "water":
        Object.assign(e, { town: town(), value: rng.chance(0.8) ? "断水" : "解消" });
        break;
      case "phone":
        Object.assign(e, { town: rng.chance(0.4) ? town() : "", value: rng.pick(["busy", "down", "ok"]) });
        break;
      case "shelter":
        if (geo.shelters.length > 0) Object.assign(e, { name: rng.pick(geo.shelters).name, value: rng.pick(["open", "crowded", "full"]) });
        break;
      case "welfare_shelter":
        e.value = "open";
        break;
      case "facility":
        if (geo.facilities.length > 0) Object.assign(e, { name: rng.pick(geo.facilities), value: rng.chance(0.7) ? "休止" : "再開" });
        break;
      case "pharmacy":
        e.value = rng.chance(0.7) ? "休止" : "再開";
        break;
      case "helper":
        e.value = "休止";
        break;
      case "vendor":
        if (geo.persons.length > 0) Object.assign(e, { target: rng.pick(geo.persons), value: String(rng.int(2, 6)) });
        break;
      case "aftershock":
        e.value = rng.pick(["3", "4", "5弱", "5強"]);
        break;
      case "weather":
        e.value = rng.chance(0.6) ? "rain" : "clear";
        break;
    }
    events.push(e);
  }
  const ended = text.match(/もう結末を迎えた人（挙げない）: (.+)/)?.[1] ?? "";
  const over = text.includes("結末: 決めない")
    ? []
    : text
        .split("\n")
        .filter((l) => l.includes("超過"))
        .flatMap(aliasesIn)
        .filter((a) => !ended.includes(a));
  const farewells =
    over.length > 0 && rng.chance(0.15)
      ? [
          {
            target: rng.pick(over),
            text: opts.noise && rng.chance(opts.noise) ? "家で亡くなった" : rng.pick(["この時間までに、手が届かなかった", "助けが着く前に、時間が過ぎた"]),
            reason: rng.pick(["停電が続き、電池が切れた", "道が通れず、誰も着かなかった", "電話が通じず、様子が分からなかった"]),
          },
        ]
      : [];
  return { narration: rng.pick(NARRATIONS[disaster]), events, farewells };
}

/**
 * 自由対応の偽の答え（T129: 状況に合わせる）。候補の一覧の「今」を読んで、不可の手は can false・理由・別の道。
 * 表の手に当たらない文はそのままの手で、事実（電話・今いる所）からできるかと効き目を決める。何もしない文は none
 */
function freeAnswer(rng: Rng, input: Input) {
  const text = textOf(input["文"]);
  const facts = textOf(input["事実"]);
  type Row = { id: string; 名前: string; 中身: string; 今?: string; 相手: Array<{ 区分: string; 今?: string }> };
  const list = (input["手"] as { 一覧?: Row[] } | undefined)?.一覧 ?? [];
  const words = ["電話", "訪問", "薬", "透析", "移送", "電源", "報告", "119", "避難所", "業者"];
  const hit = list.find((c) => words.some((w) => text.includes(w) && (c.名前.includes(w) || c.中身.includes(w))));
  const blank = { way: "", minutes: 0, outcome: "", effect: "none", alt: "", whyNot: "" };
  if (!hit && /記録|何もしない/.test(text)) return { ...blank, kind: "none", callee: "", text: "", reason: "何もしない文", can: true };
  if (!hit) {
    const phoneDown = facts.includes("電話: 通話不可");
    const here = facts.includes("今いる所: 訪問先（対象の本人の家）");
    const way = here ? "desk" : rng.pick(["phone", "visit", "desk"] as const);
    const can = !(way === "phone" && phoneDown);
    return {
      kind: "free",
      callee: "",
      way,
      minutes: rng.int(5, 40),
      can,
      whyNot: can ? "" : "通話不可",
      alt: can ? "" : "訪問して直接様子を確かめる",
      effect: can && (here || way !== "desk") ? rng.pick(["reach", "arrival", "none"] as const) : "none",
      text: "近くの人に声をかけた",
      outcome: can ? "近くの人が様子を見に行くと言った" : "",
      reason: "表の手に当たらないので",
    };
  }
  const can = !(hit.今 ?? "可").startsWith("不可");
  return {
    ...blank,
    kind: hit.id,
    callee: hit.相手.length > 0 ? rng.pick(hit.相手).区分 : "",
    text: `${hit.中身}`.slice(0, 20),
    reason: "文の中身が手に合う",
    can,
    whyNot: can ? "" : (hit.今 ?? "").replace(/^不可（|）$/g, ""),
    alt: can ? "" : "近くの人に様子を見てもらう",
  };
}

function reviewAnswer(rng: Rng, input: Input) {
  const record = textOf(input["記録"]);
  const people = aliasesIn(record);
  return {
    summary: `次の訓練では、${rng.pick(REVIEW_ACTION_LABELS)}を早めに試す。${rng.pick(REVIEW_ACTION_LABELS)}の前に事実を確かめる。`,
    findings: Array.from({ length: rng.int(0, 3) }, () => ({
      person: people.length > 0 && rng.chance(0.7) ? rng.pick(people) : "全体",
      kind: rng.pick(REVIEW_KINDS),
      text: `${rng.pick(REVIEW_ACTION_LABELS)}を先に打つと、届くのが早くなった。`,
      basis: NO_BASIS,
    })),
    // 項目ごとの文と良かった所（T185）
    sections: REVIEW_TOPICS.map((topic) => ({ topic, text: `${rng.pick(REVIEW_ACTION_LABELS)}を早めに打てた。次は${rng.pick(REVIEW_ACTION_LABELS)}も試す。` })),
    good: [`${rng.pick(REVIEW_ACTION_LABELS)}を早めに打てた。`],
  };
}

/** 人ごとの講評（T185）の偽の返事。入力の「## 仮名」の節ごとに 1 人分、手の名前だけで書く */
function personReviewAnswer(rng: Rng, input: Input) {
  const people = [...textOf(input["記録"]).matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  return {
    persons: people.map((person) => ({
      person,
      text: `本人へ${rng.pick(REVIEW_ACTION_LABELS)}を打ち、結果を確かめた。次は${rng.pick(REVIEW_ACTION_LABELS)}を早めに試す。`,
      good: rng.chance(0.7) ? [`${rng.pick(REVIEW_ACTION_LABELS)}を早めに打てた。`] : [],
      next: [`${rng.pick(REVIEW_ACTION_LABELS)}を先に試す。`],
    })),
  };
}

function judgeAnswer(rng: Rng) {
  const s = () => rng.int(2, 4);
  return { realism: s(), difficulty: s(), variety: s(), consistency: s(), learning: s(), notes: ["偽の審査役の返事（形の確かめ）"] };
}

/** 返事の形（JSON Schema）から空の返事（見分けられない役） */
export function emptyOf(schema: unknown): unknown {
  const s = (schema ?? {}) as { type?: unknown; properties?: Record<string, unknown>; anyOf?: unknown[]; items?: unknown };
  if (Array.isArray(s.anyOf)) return s.anyOf.some((x) => (x as { type?: unknown }).type === "null") ? null : emptyOf(s.anyOf[0]);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type;
  if (type === "object") return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, emptyOf(v)]));
  if (type === "array") return [];
  if (type === "string") return "";
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  return null;
}

// ---------- client と部屋 ----------

/** 偽の Claude。1 回の訓練に 1 つ（世界の地理を覚える） */
export function fakeClaude(opts: FakeOptions): ClaudeClient & { roles: Role[] } {
  let geo = EMPTY_GEOGRAPHY;
  const roles: Role[] = [];
  return {
    roles,
    beta: {
      messages: {
        create: async (params) => {
          const role = roleOfSystem(params.system);
          roles.push(role);
          const rng = opts.rng.fork(`${roles.length}:${role}`);
          await pause(latencyOf(opts, rng.fork("wait"), role === "persona" && isPersonaBatch(params.system) ? "persona_batch" : role));
          if (opts.noise && role !== "judge" && rng.chance(opts.noise / 5)) return message(params, "{");
          const input = inputOf(params);
          let value: unknown;
          if (role === "persona" && isPersonaBatch(params.system)) value = personaBatchAnswer(rng, input, opts, isVirtualPersona(params.system));
          else if (role === "persona") value = personaAnswer(rng, input, opts, isVirtualPersona(params.system));
          else if (role === "persona_call") value = callAnswer(rng, input, opts, false);
          else if (role === "persona_talk") value = callAnswer(rng, input, opts, true);
          else if (role === "persona_visit") value = visitAnswer(rng, input, opts);
          else if (role === "director") value = directorAnswer(rng, input, opts);
          else if (role === "world") {
            const text = Object.values(input).map(textOf).join("\n");
            geo = readGeography(text, geo);
            value = worldAnswer(rng, text, geo, opts);
          } else if (role === "free") value = freeAnswer(rng, input);
          else if (role === "review") value = reviewAnswer(rng, input);
          else if (role === "review_person") value = personReviewAnswer(rng, input);
          else if (role === "judge") value = judgeAnswer(rng);
          else value = emptyOf((params.output_config as { format?: { schema?: unknown } } | undefined)?.format?.schema);
          return message(params, JSON.stringify(value));
        },
      },
    },
  };
}

/** 偽の世界の部屋（lib/drill/virtual.test.ts の偽の部屋と同じ流れ。user.message に world_step を 1 回、結果を受けたら idle） */
export function fakeRoom(opts: FakeOptions): RoomClient {
  const events: RoomEvent[] = [];
  let n = 0;
  let sessions = 0;
  let geo = EMPTY_GEOGRAPHY;
  return {
    agents: {
      create: async () => ({ id: "agent_fake", version: 1 }),
      update: async () => ({ id: "agent_fake", version: 2 }),
    },
    environments: { create: async () => ({ id: "env_fake" }) },
    sessions: {
      create: async () => ({ id: `sesn_fake_${++sessions}` }),
      send: async (_id, evs) => {
        const ids: string[] = [];
        for (const e of evs) {
          const id = `ev_${++n}`;
          ids.push(id);
          events.push({ id, type: String(e.type), ...(typeof e.custom_tool_use_id === "string" ? { custom_tool_use_id: e.custom_tool_use_id } : {}) });
          if (e.type === "user.message") {
            const text = ((e.content as Array<{ text?: string }>)[0]?.text ?? "") as string;
            geo = readGeography(text, geo);
            const rng = opts.rng.fork(`room:${n}`);
            await pause(latencyOf(opts, rng.fork("wait"), "world_room"));
            if (opts.noise && rng.chance(opts.noise / 5)) events.push({ id: `ev_${++n}`, type: "session.error" });
            else events.push({ id: `ev_${++n}`, type: "agent.custom_tool_use", name: WORLD_TOOL, input: worldAnswer(rng, text, geo, opts) });
          } else if (e.type === "user.custom_tool_result") {
            events.push({ id: `ev_${++n}`, type: "session.status_idle", stop_reason: { type: "end_turn" } });
          }
        }
        return { ids };
      },
      // 本物は after（送る 5 秒前）より後の出来事だけを返す。本物の刻みは 5 秒より長くあくので、前の刻みの出来事は返らない。
      // 偽の刻みは数 ms なので、最後の user.message からを返して同じにする（1970 年からの読み〔settlePending〕は全部）
      list: async (_id, after) => {
        if (Date.parse(after) < Date.UTC(2000, 0, 1)) return [...events];
        const last = events.map((e) => e.type).lastIndexOf("user.message");
        return events.slice(Math.max(0, last));
      },
    },
  };
}
