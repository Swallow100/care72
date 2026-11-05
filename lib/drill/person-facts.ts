// 人ごとの事実の帳面（T130）。筋の事実はコードが持ち、AI（本人役・監督・世界）はそれに沿って言葉を作る。
// 評価の 3 回目で、審査役の「人ごとの筋」が 3 回とも 2/5 のまま残った。本人役が前に言った事・いる所・機器の電池の扱い・話せるかが
// どこにも事実として無く、次の呼び出しの本人役は食い違っても気づけず、コードも止められなかった。
//
// - 帳面は保存しない。今ある物（前の連絡 PersonState・手の記録・世界の到着と届いた物・停電・台帳）から毎回コードが引く読み取りの形
//   （保存した刻みから作り直しても同じ物になる。T121 の stamps と同じ考え）。保存するのは門で落とした数（world.gated）だけ
// - 計画（台帳。停電のときの予備・外の電源・避難先と移る手段・在宅避難・業者の約束）も帳面に入れる。連絡が取れなくても計画どおりに動き
//   （内蔵の電池が切れたら予備に替える・決めた避難先へ移る）、計画に無い事は勝手に良い方へ動かさない（計画が無い人ほど手が要る）
// - 門: 帳面に反する答え（手も到着も無い赤 → 緑・帳面と違ういる所・同居の家族が「来た」・いない家族・予備の無い人の予備・
//   電気が戻ったあとの電池の頼み事・止まった機器のまま落ち着いている・声が無いと伝えられた本人が話す）は使わない（落とすか、帳面に直す）
// - Claude を呼ばない。色と連絡の順（lib/triage）は決めない・動かさない（安否の入力を使うか使わないかと、いる所を帳面に直すだけ）
// - Claude に渡す文は名前・場所の名前を書かない（避難先は種類だけ。呼ぶ側が仮名化の門を通す）

import type { ContactKind, ContactReach, Ledger, Sex, WhereNow } from "../db/types.ts";
import { isSpouse, relationOf } from "./speaker.ts";
import { TALK_ASK_WORDS, type TalkAsk } from "./dialogue.ts";
import type { ActionRecord } from "./action-types.ts";
import type { DrillTurn, PersonState } from "./persona-types.ts";
import type { AskKind, WorldState } from "./scenarios.ts";
import { minuteText } from "./time-text.ts";

// ---------- 計画（台帳から） ----------

/** 計画を読む台帳（仮名化の前。サーバーの中だけ）。採点（lib/drill/record.ts）の行の形でも通るよう、要る欄だけ */
export type PlanSource = {
  ledger: {
    basic?: Partial<Pick<Ledger["basic"], "household" | "householdNote">>;
    care?: Partial<Pick<Ledger["care"], "walking" | "bedridden">>;
    medical?: { devices?: ReadonlyArray<{ detail?: string }> };
    evacuation?: Partial<Pick<Ledger["evacuation"], "hazards" | "destination1" | "destination2" | "transport" | "transportKind" | "carryItems" | "stayHome">>;
    notes?: ReadonlyArray<string>;
  };
  clocks: ReadonlyArray<{ kind: string; category: string; label: string; value: number | null; unit: string | null; starts_on: string }>;
  contacts: ReadonlyArray<{ kind: ContactKind; relation?: string | null; reach?: ContactReach | null; has_car?: number | null }>;
};

/** 停電で減る機器の予備 1 つ。hours は予備の持つ時間（分からなければ null） */
export type PlanSpare = { category: string; label: string; hours: number | null };

/** 避難先の種類（名前は持たない。Claude に渡さない） */
export type PlanPlace = "hospital" | "shelter" | "other";

export type Plan = {
  /** 停電で減る機器（内蔵の電池）。予備の有無は spares */
  devices: Array<{ category: string; label: string; hours: number | null }>;
  /** 予備（予備の時計・持ち物の予備の電池やボンベ）。機器の区分ごとに 1 つ */
  spares: PlanSpare[];
  /** 外の電源（発電機・蓄電池・ポータブル電源） */
  power: boolean;
  /** 避難先の種類。在宅避難・決めていなければ null */
  destination: PlanPlace | null;
  /** 避難先へ移る手段がある（手段の欄・車のある近くの家族・自分で歩ける） */
  move: boolean;
  /** 移るのを手伝う人か乗り物がある（手段の欄・車のある近くの家族）。動けない人も計画で移れる */
  helper: boolean;
  /** 在宅避難の計画（住まいが安全で家に留まると決めた） */
  stayHome: boolean;
  /** 機器を届けてくれる業者の連絡先（酸素業者）がある */
  vendor: boolean;
  /** 台帳にハザード（浸水・土砂・津波の区域）がある */
  zone: boolean;
};

const HOURS_OF: Readonly<Record<string, number>> = { minute: 1 / 60, hour: 1, day: 24, week: 168 };
const hoursOf = (value: number | null, unit: string | null): number | null =>
  value != null && unit && HOURS_OF[unit] !== undefined ? value * HOURS_OF[unit] : null;

/** 持ち物の予備（電池・バッテリー・ボンベ） */
const SPARE_ITEM = /バッテリー|電池|ボンベ/;
/** 外の電源 */
const POWER_ITEM = /発電機|蓄電池|ポータブル電源|非常用電源|UPS|車の電源|シガー/i;
const HOSPITAL = /病院|医院|クリニック|診療所/;
const SHELTER = /学校|公民館|集会所|体育館|会館|センター|避難所|ホール|施設/;

/** 避難先の名前 → 種類（名前は返さない） */
export function placeKindOf(name: string | null | undefined): PlanPlace | null {
  const t = name?.trim();
  if (!t) return null;
  if (HOSPITAL.test(t)) return "hospital";
  if (SHELTER.test(t)) return "shelter";
  return "other";
}

/** 台帳から計画を読む（コードの決め。Claude を呼ばない） */
export function planOf(src: PlanSource): Plan {
  const l = src.ledger;
  const devices = src.clocks
    .filter((k) => k.kind === "device" && k.starts_on === "outage")
    .map((k) => ({ category: k.category, label: k.label, hours: hoursOf(k.value, k.unit) }));
  const spares: PlanSpare[] = [];
  for (const k of src.clocks) {
    if (k.kind !== "supply" || k.starts_on !== "outage") continue;
    if (!devices.some((d) => d.category === k.category) || spares.some((s) => s.category === k.category)) continue;
    spares.push({ category: k.category, label: k.label, hours: hoursOf(k.value, k.unit) });
  }
  const items = [...(l.evacuation?.carryItems ?? [])];
  const item = items.find((x) => SPARE_ITEM.test(x));
  if (item) for (const d of devices) if (!spares.some((s) => s.category === d.category)) spares.push({ category: d.category, label: item, hours: null });
  const texts = [...items, ...(l.notes ?? []), ...(l.medical?.devices ?? []).map((d) => d.detail ?? ""), l.basic?.householdNote ?? ""];
  const e = l.evacuation ?? {};
  const stayHome = e.stayHome === true;
  const destination = stayHome ? null : (placeKindOf(e.destination1) ?? placeKindOf(e.destination2));
  const helperCar = src.contacts.some((c) => (c.reach === "together" || c.reach === "nearby") && c.has_car === 1);
  const means = !!(e.transport?.trim() || e.transportKind);
  const walks = l.care?.walking === "ok" && l.care?.bedridden !== true;
  return {
    devices,
    spares,
    power: texts.some((t) => POWER_ITEM.test(t)),
    destination,
    move: destination !== null && (means || helperCar || walks),
    helper: means || helperCar,
    stayHome,
    vendor: src.contacts.some((c) => c.kind === "oxygen_supplier"),
    zone: (e.hazards ?? []).length > 0,
  };
}

const PLACE_WORDS: Readonly<Record<PlanPlace, string>> = { hospital: "病院", shelter: "避難所", other: "決めた所" };

/**
 * 計画の文（Claude に渡す前。名前・場所の名前を書かない）。連絡が取れなくても計画どおりに動き、計画に無い事は自分で良くしない
 */
export function planLines(plan: Plan): string[] {
  const out: string[] = [];
  for (const d of plan.devices) {
    const s = plan.spares.find((x) => x.category === d.category);
    out.push(
      s
        ? `停電で${d.label}が切れたら、${s.label}に替える（計画。${s.hours != null ? `予備 ${s.hours} 時間` : "予備の時間は未確認"}）`
        : `${d.label}の予備は計画に無い（切れたら、電源が届くか停電が戻るまで戻らない）`,
    );
  }
  if (plan.power) out.push("外の電源（発電機・蓄電池など）が計画にある");
  if (plan.stayHome) out.push("在宅避難（計画で家に留まる）");
  else if (plan.destination) out.push(`避難先: ${PLACE_WORDS[plan.destination]}（計画）。移る手段 ${plan.move ? "あり" : "計画に無い（自分では移れない）"}`);
  else out.push("避難先は計画に無い（自分では移らない）");
  if (plan.vendor) out.push("機器の業者に届けてもらう約束がある（台帳の連絡先）");
  return out;
}

/** 夫・妻の続柄（本人の性別から。分からなければ両方） */
const spouseOf = (sex: Sex | null | undefined): string[] => (sex === "female" ? ["夫"] : sex === "male" ? ["妻"] : ["夫", "妻"]);

/**
 * 同居の人と周りの家族の続柄（T130。台帳の連絡先の「同居」と世帯から）。同居の人は「来た」と言わない、台帳に無い続柄の家族は出さない。
 * 世帯が「家族と」「その他」「施設」の人は周りの家族を確かめられないので kin は null
 */
export function housemates(
  source: { ledger: { basic: Pick<Ledger["basic"], "household"> }; contacts: ReadonlyArray<{ kind: ContactKind; reach?: ContactReach | null }> },
  roles: ReadonlyArray<string>,
  sex: Sex | null | undefined,
): { together: string[]; kin: string[] | null } {
  const together = source.contacts.flatMap((c, i) => (c.reach === "together" && c.kind !== "self" ? [roles[i]] : []));
  const household = source.ledger.basic.household ?? null;
  if (household === "with_spouse" && !together.some(isSpouse)) together.push(spouseOf(sex)[0]);
  const family = source.contacts.flatMap((c, i) => (c.kind === "family" ? [relationOf(roles[i])] : []));
  if (household === "with_spouse") family.push(...spouseOf(sex));
  const kin = household === "with_family" || household === "other" || household === "facility" ? null : [...new Set(family)];
  return { together: [...new Set(together)], kin };
}

// ---------- 帳面（今ある物から引く） ----------

/** ケアマネの行 1 つ（外へ掛けた電話・掛かってきた電話の往復）。text は保存した言葉（自由の言葉は名前に戻してある。Claude に渡すときは伏せる） */
export type ToldLine = { minute: number; text: string; ask?: string };

/** 帳面に書くケアマネに言われた事 1 つ */
export type Told = { at: number; words: string; via: "out" | "in" };

/** 帳面に書くケアマネに言われた事の数（新しい物から） */
export const TOLD_MAX = 4;

/**
 * 決まった問いのうち、言われた事として覚える物（指示と、後で連絡の約束。安否・けが・所在などの問いは聞いただけなので覚えない）。
 * 掛かってきた電話の待機（T127 の stay）も、名前があれば同じに読む
 */
const TOLD_ASKS: ReadonlySet<string> = new Set(["advise_119", "will_call_back", "stay", "shelter", "can_evacuate", "contact_family"]);

/**
 * 掛かってきた電話の往復のケアマネの行を世界に積む（T127 の着信の往復。往復を足す口と、作り直しの applyCallTalk の両方が呼ぶ）。
 * ケアマネの行だけ、人ごとに新しい 8 つまで
 */
export function pushTold(world: WorldState, person: string, lines: ReadonlyArray<{ who: string; text: string; minute: number; ask?: string }>): WorldState {
  const add = lines.filter((l) => l.who === "cm" && l.text.trim()).map((l): ToldLine => ({ minute: l.minute, text: l.text, ...(l.ask ? { ask: l.ask } : {}) }));
  if (add.length === 0) return world;
  const told = { ...(world.told ?? {}) };
  told[person] = [...(told[person] ?? []), ...add].slice(-8);
  return { ...world, told };
}

/** ケアマネに言われた事を引く（外へ掛けた電話の往復と、世界に積んだ掛かってきた電話の往復）。自由の言葉は mask で伏せた物だけ */
function toldOf(input: FactsInput): Told[] {
  const lines: Array<ToldLine & { via: Told["via"] }> = [];
  for (const a of input.actions) {
    if (a.person !== input.person) continue;
    for (const l of a.result?.talk ?? []) if (l.who === "cm") lines.push({ minute: l.minute, text: l.text, ...(l.ask ? { ask: l.ask } : {}), via: "out" });
  }
  for (const l of input.world.told?.[input.person] ?? []) lines.push({ ...l, via: "in" });
  const out: Told[] = [];
  for (const l of lines.filter((x) => x.minute <= input.now).sort((a, b) => a.minute - b.minute)) {
    let words: string | null = null;
    if (l.ask) words = TOLD_ASKS.has(l.ask) ? (TALK_ASK_WORDS[l.ask as TalkAsk] ?? null) : null;
    else words = input.mask ? input.mask(l.text) : null;
    if (words) out.push({ at: l.minute, words: Array.from(words).slice(0, 60).join(""), via: l.via });
  }
  return out.slice(-TOLD_MAX);
}

/** 帳面を引く元 */
export type FactsInput = {
  person: string;
  world: WorldState;
  /** 前の連絡（いちばん新しい安否）。まだ無ければ null */
  state: PersonState | null;
  /** この人への手（メモと自由の文を落とした物） */
  actions: ReadonlyArray<ActionRecord>;
  /** 今（発災からの分） */
  now: number;
  plan: Plan | null;
  /** この家が今の停電の地区か（停電が無ければ false） */
  inOutage: boolean;
  /** 同居の人の役割名（連絡先の「同居」と、世帯の夫・妻） */
  together?: ReadonlyArray<string>;
  /** 本人の周りの家族の続柄（いない家族を出さない。null は見ない） */
  kin?: ReadonlyArray<string> | null;
  /**
   * ケアマネの自由の言葉を Claude に渡せる形に伏せる口（呼ぶ側が事業所の全員の鍵で。伏せきれなければ null で渡さない）。
   * 無ければ自由の言葉は帳面の文に書かない（決まった問い・指示の言葉だけ）
   */
  mask?: (text: string) => string | null;
};

/** 来た人・届いた物・会えた手 1 つ（発災からの分） */
export type Help = { at: number; what: string };

/** 機器 1 つの今（停電で減る物） */
export type DeviceNow = {
  label: string;
  category: string;
  /** 内蔵が切れた時刻（まだ・停電の外なら null） */
  outAt: number | null;
  /** 計画どおり予備に替えた（時刻と誰が）。予備が切れた時刻（分からなければ null） */
  spare: { label: string; at: number; by: string; outAt: number | null } | null;
  /** 今、止まっていて戻っていない（予備も無い・切れた、電気も電源も来ていない） */
  down: boolean;
};

export type Facts = {
  person: string;
  now: number;
  plan: Plan | null;
  /** 前の連絡のいる所（緑はいる所、赤は「家にいるか」）と時刻 */
  place: { where: WhereNow; at: number } | null;
  /** 前の連絡が赤で、動けない・けがと言った（時刻） */
  hurt: { at: number; canMove: boolean | null; injured: boolean | null } | null;
  /** 前の連絡から今までに来た人・届いた物・会えた手（いちばん新しい物） */
  help: Help | null;
  /** 届いた物・来た人の全部（帳面の文） */
  got: Help[];
  /** 家族・支援者が「本人の声が無い」と伝えた（時刻）。そのあと手も人も来ていない */
  voiceLost: { at: number } | null;
  /** 停電と電気 */
  power: { outage: "none" | "on" | "restored"; since: number | null; restoredAt: number | null; supplied: number | null };
  devices: DeviceNow[];
  together: ReadonlyArray<string>;
  kin: ReadonlyArray<string> | null;
  /**
   * ケアマネに言われた事（外へ掛けた電話の往復〔T93、手の返事の talk〕と、掛かってきた電話の往復〔T127、world.told〕のケアマネの行）。
   * 新しい物から TOLD_MAX まで、古い順。本人役は覚えて従い、従えない時は理由を言う
   */
  told: Told[];
  /** 印（家の外へ出た・車中泊・帰ろうとする）。いる所の変わり目に使う */
  away: boolean;
};

const ARRIVAL_WORDS: Readonly<Record<string, string>> = {
  staff: "事業所の職員",
  nurse: "訪問看護",
  supporter: "支援者",
  family: "家族",
  vendor: "機器の業者",
  transport: "移送の車",
  power: "電源",
  medicine: "薬",
};

/** 家族・支援者が本人の声が無いと伝える言い方（台が足した目安。体の具合の言い切りではない言葉だけ） */
export const NO_VOICE =
  /声が(?:ない|無い|出ない|出ません|しない|しません|聞こえない|聞こえません|ありません)|返事が(?:ない|無い|ありません)|呼(?:び)?かけ[^。]{0,8}(?:答えない|答えません|応えない|反応(?:が)?(?:ない|無い|ありません))|反応が(?:ない|無い|ありません)|物音だけ/;

/** 前の連絡のいる所（緑はいる所、赤は「家にいるか」）。分からなければ null */
export function placeOfState(s: Pick<PersonState, "color" | "whereNow" | "atHome"> | null): WhereNow | null {
  if (!s) return null;
  if (s.color === "green") return s.whereNow ?? null;
  if (s.color === "red" && typeof s.atHome === "boolean") return s.atHome ? "home" : "other";
  return null;
}

/** 安否 1 つのいる所（緑はいる所、赤は「家にいるか」） */
function placeOfTurn(t: Pick<DrillTurn, "color" | "whereNow" | "atHome">): WhereNow | null {
  return placeOfState({ color: t.color, whereNow: t.whereNow, atHome: t.atHome });
}

/** (from, to] 分に来た人・届いた物・会えた手（到着・出向いてもらった人・訪問で着いた・近所の人の声掛） */
export function helpsBetween(world: WorldState, actions: ReadonlyArray<ActionRecord>, person: string, from: number, to: number): Help[] {
  const out: Help[] = [];
  const inside = (m: number) => m > from && m <= to;
  for (const a of world.arrivals ?? []) if (a.person === person && a.arrived && inside(a.arrive)) out.push({ at: a.arrive, what: ARRIVAL_WORDS[a.role] ?? a.role });
  for (const d of world.dispatched ?? []) if (d.person === person && d.arrived && inside(d.arrive)) out.push({ at: d.arrive, what: "頼んだ人" });
  for (const a of actions) {
    const r = a.result;
    if (a.person === person && r && (r.status === "arrived" || r.visit !== undefined) && inside(r.atMinute)) out.push({ at: r.atMinute, what: "ケアマネの訪問" });
  }
  const watch = world.marks?.[person]?.neighborWatch;
  if (typeof watch === "number" && inside(Math.round(watch * 60))) out.push({ at: Math.round(watch * 60), what: "近所の人" });
  return out.sort((a, b) => a.at - b.at);
}

/** 帳面を引く（コードの計算。Claude を呼ばない） */
export function factsOf(input: FactsInput): Facts {
  const { person, world, state, actions, now, plan } = input;
  const prevAt = state ? Math.round(state.at * 60) : -1;
  const where = placeOfState(state);
  const hurt = state && state.color === "red" && (state.injured === true || state.canMove === false) ? { at: prevAt, canMove: state.canMove ?? null, injured: state.injured ?? null } : null;
  const helps = helpsBetween(world, actions, person, prevAt, now);
  const got = helpsBetween(world, actions, person, -1, now);
  const voice = state && state.source !== "agent" && state.saying && NO_VOICE.test(state.saying) && helps.length === 0 ? { at: prevAt } : null;
  const o = world.outage;
  const since = o && input.inOutage ? Math.round(o.since * 60) : null;
  const restoredAt = o && o.restoredAt != null && input.inOutage ? Math.round(o.restoredAt * 60) : null;
  const sup = world.supplies?.[person]?.power;
  const supplied = typeof sup === "number" && sup <= now ? sup : null;
  const stops = [restoredAt, supplied].filter((x): x is number => x !== null && x <= now);
  const stop = stops.length > 0 ? Math.min(...stops) : null;
  const by = input.together?.[0] ?? "本人";
  const devices: DeviceNow[] = (plan?.devices ?? []).map((d) => {
    const raw = since !== null && d.hours !== null ? since + Math.round(d.hours * 60) : null;
    const outAt = raw !== null && raw <= now && (stop === null || stop > raw) ? raw : null;
    const s = plan?.spares.find((x) => x.category === d.category) ?? null;
    const spare = outAt !== null && s ? { label: s.label, at: outAt, by, outAt: s.hours !== null ? outAt + Math.round(s.hours * 60) : null } : null;
    const spareRunning = spare !== null && (spare.outAt === null || spare.outAt > now);
    return { label: d.label, category: d.category, outAt, spare, down: outAt !== null && stop === null && !spareRunning && !plan?.power };
  });
  const m = world.marks?.[person] ?? {};
  return {
    person,
    now,
    plan,
    place: where && state ? { where, at: prevAt } : null,
    hurt,
    help: helps.at(-1) ?? null,
    got,
    voiceLost: voice,
    power: { outage: since === null ? "none" : restoredAt !== null && restoredAt <= now ? "restored" : "on", since, restoredAt, supplied },
    devices,
    together: input.together ?? [],
    kin: input.kin ?? null,
    away: m.wandering !== undefined || m.carSleep !== undefined || m.goingHome !== undefined,
    told: toldOf(input),
  };
}

/** 電気が戻った・電源が届いた（電池・電源を頼まない） */
export const powerBack = (f: Facts): boolean => f.power.outage === "restored" || f.power.supplied !== null;

const WHERE_WORDS: Readonly<Record<WhereNow, string>> = { home: "家", shelter: "避難所", other: "家の外" };

/**
 * 帳面の文（Claude に渡す前。呼ぶ側が仮名化の門を通す）。言った事は決まった印の言い方だけ（本人役の言葉そのものは書かない）
 */
export function factLines(f: Facts): string[] {
  const out: string[] = [];
  if (f.place) out.push(`いる所: ${WHERE_WORDS[f.place.where]}（${minuteText(f.place.at)}の連絡）`);
  if (f.hurt) {
    const what = [f.hurt.canMove === false ? "動けない" : null, f.hurt.injured === true ? "けが" : null].filter(Boolean).join("・");
    out.push(`前に言った事: ${what}（${minuteText(f.hurt.at)}）。${f.help ? `そのあと ${f.help.what}が来た（${minuteText(f.help.at)}）` : "そのあと誰も来ていない・手も届いていない"}`);
  }
  out.push(`来た人・届いた物: ${f.got.length > 0 ? f.got.map((h) => `${h.what}（${minuteText(h.at)}）`).join("、") : "まだ無い"}`);
  if (f.voiceLost) out.push(`本人の声: 家族・支援者が「声が無い・返事が無い」と伝えた（${minuteText(f.voiceLost.at)}）。人が来るまで本人は話さない`);
  if (f.told.length > 0) {
    out.push(`ケアマネに言われた事（覚えて従う。従えない時は理由を言う）: ${f.told.map((t) => `${minuteText(t.at)}「${t.words}」`).join("、")}`);
  }
  if (f.together.length > 0) out.push(`同居の人（もう家にいる。あとから「来た」と言わない）: ${f.together.join("・")}`);
  if (f.power.outage === "on") out.push(`電気: 停電中（${minuteText(f.power.since ?? 0)}から）${f.power.supplied !== null ? `。電源が届いた（${minuteText(f.power.supplied)}）` : ""}`);
  else if (f.power.outage === "restored") out.push(`電気: 戻った（${minuteText(f.power.restoredAt ?? 0)}）。電池・電源を頼まない`);
  for (const d of f.devices) {
    if (d.outAt === null) continue;
    if (d.spare) {
      const spareOut = d.spare.outAt !== null && d.spare.outAt <= f.now;
      out.push(
        `${d.label}: ${minuteText(d.outAt)}に切れ、計画どおり${d.spare.label}に替えた（替えたのは ${d.spare.by}）${spareOut ? `。予備も ${minuteText(d.spare.outAt!)}に切れた` : ""}`,
      );
    } else if (d.down) {
      out.push(`${d.label}: ${minuteText(d.outAt)}に切れた。予備は無く、電源が届くか停電が戻るまで戻らない（落ち着いたままとは言わない）`);
    }
  }
  return out;
}

/** 帳面と計画の段（本人役の刻み・通話・訪問の文に足す）。計画の無い人も「計画に無い」を書く */
export function factsBlock(f: Facts): string {
  const plan = f.plan ? planLines(f.plan) : [];
  return [
    ["人ごとの事実（コードの記録。言葉・様子・いる所はこれと食い違わない）:", ...factLines(f).map((x) => `- ${x}`)].join("\n"),
    ...(plan.length > 0
      ? [["計画（台帳。ケアマネと連絡が取れなくても計画どおりに動く。計画に無い事は自分で良くしない）:", ...plan.map((x) => `- ${x}`)].join("\n")]
      : []),
  ].join("\n");
}

// ---------- 門（帳面に反する答えを使わない） ----------

/** 門の決まりの名前（ログと世界の数え world.gated・評価の台の数え。中身は書かない） */
export const GATE_RULES = [
  "hurt_to_safe", // 動けない・けがの赤から、手も到着も計画も無いまま緑
  "place_flip", // いる所が手も計画も無く変わった（帳面のいる所に直した）
  "voice_lost", // 声が無いと伝えられた本人が話す
  "place_text", // いる所と食い違う言葉（避難所にいるのに家で過ごす）
  "with_arrived", // 同居の人が「来た」
  "absent_kin", // いない続柄の家族が出る
  "ask_after_power", // 電気が戻った・電源が届いたあとの電池・電源の頼み事
  "spare_without_plan", // 予備の無い人が予備に替える・切れた電池が戻る
  "calm_while_down", // 機器が止まったまま落ち着いている
  "supply_without_hand", // 手も表の行も計画も無い業者の巡回・届く物
  "repeat_kind", // 同じ種類の出来事を訓練の中で何度も
  "repeat_text", // 同じ言い回しの出来事を別の人に
  "reason_medical", // 結末の理由に医療の言い方
] as const;
export type GateRule = (typeof GATE_RULES)[number];

/** 門で落とした数を書き留める所（本人役・監督の口から engine へ。StopLog と同じ形） */
export type GateLog = { hit(rule: GateRule): void; take(): Partial<Record<GateRule, number>> };

export function gateLog(): GateLog {
  let hits: Partial<Record<GateRule, number>> = {};
  return {
    hit(rule) {
      hits[rule] = (hits[rule] ?? 0) + 1;
    },
    take() {
      const out = hits;
      hits = {};
      return out;
    },
  };
}

/** 世界の数え（world.gated）に足す */
export function addGated(world: WorldState, add: Partial<Record<GateRule, number>> | undefined): WorldState {
  const keys = Object.keys(add ?? {}) as GateRule[];
  if (keys.length === 0) return world;
  const gated = { ...(world.gated ?? {}) };
  for (const k of keys) gated[k] = (gated[k] ?? 0) + (add![k] ?? 0);
  return { ...world, gated };
}

/** 帳面と食い違う文の言い方（台が足した目安。どれも本人役の言葉の形で、体の具合の言い切りの形ではない）。打ち消しの形（「過ごせません」「いません」「じゃない」）は見ない */
const HOME_STAY = /(?:家|自宅|うち)で(?:過ご(?!せ)|休ん|休み|待っ|待ち|寝て|様子を見)|(?:家|自宅|うち)に(?:い|居)(?:ます|る|て)|家から出ていない|家に残っ/;
const AT_SHELTER = /避難所(?:に|へ)(?:着(?!け)|い(?!ない|ません)|居(?!ない|ません)|来(?!られ|れ)|移(?!れ))|避難所で(?:過ご(?!せ)|休|待)/;
const RETURNED = /帰宅|(?:家|自宅|うち)に戻|帰って(?:き|来)|戻ってき/;
const ARRIVED_VERB = "(?:が|も)(?:今|さっき|やっと|ようやく)?(?:来|帰って|帰宅|戻って|駆けつけ|着い|到着)";
/** 家族の続柄の主語の形（「娘が」「息子さんも」） */
const KIN_WORDS = ["夫", "妻", "娘", "息子", "長男", "長女", "次男", "次女", "孫", "嫁", "婿", "甥", "姪", "弟", "妹", "兄", "姉"] as const;
/** 予備に替えた言い方（計画に予備の無い人は言わない。「替えられない」は見ない） */
const SWAP = /予備(?:の)?(?:電池|バッテリー|ボンベ)?(?:に|へ|を)(?:替え|換え|交換|切り替え|つない|使)(?!られ|ない|ません|ず)|(?:電池|バッテリー|ボンベ)を(?:替え|換え|交換|取り替え)(?!られ|ない|ません|ず)/;
/** 切れた電池が戻った言い方（止まった機器のまま言わない。「充電できない」は見ない） */
const BATTERY_BACK = /充電(?:でき(?!ない|ません|ず)|した|して(?!い?ない|いません))|(?:電池|バッテリー)が(?:戻(?!らな|りませ)|回復|復活|もっ|持っ|まだ(?:ある|あり|もつ|持つ|残))/;
const ASK_POWER = /(?:電池|電源|バッテリー|充電|発電機)[^。]{0,14}(?:ほしい|欲しい|お願い|頼|届け|足りな|持って(?:き|来)|来て|ください|ないか|ありません)/;
/** 落ち着いたままの言い方（「大丈夫じゃない」「落ち着いていません」「問題なのは」は見ない） */
const CALM =
  /落ち着い(?!て(?:い)?(?:ない|ません|られ))|穏やか(?!で(?:は)?(?:ない|ありません)|じゃ)|いつも通り(?!で(?:は)?(?:ない|ありません)|じゃ)|普段通り(?!で(?:は)?(?:ない|ありません)|じゃ)|変わりな|問題な(?=い|く|し)|安定し(?!て(?:い)?(?:ない|ません))|大丈夫(?!(?:です|でしょう)?か|じゃ|では|で(?:は)?(?:ない|ありません)|そうじゃ)/;

/** 文の帳面と食い違いを見る物 */
export type SlipContext = {
  /** 今いる所（帳面と、この答えを直したあと）。null は見ない */
  place: WhereNow | null;
  together: ReadonlyArray<string>;
  kin: ReadonlyArray<string> | null;
  powerBack: boolean;
  /** 停電で減る機器があり、計画の予備も外の電源も無い */
  noSpare: boolean;
  /** 機器が止まって戻っていない */
  down: boolean;
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const relOf = (role: string) => role.replace(/[ 　]*\d+$/u, "").trim();

export function slipContextOf(f: Facts, place: WhereNow | null = f.place?.where ?? null): SlipContext {
  const plan = f.plan;
  return {
    place,
    together: f.together,
    kin: f.kin,
    powerBack: powerBack(f),
    noSpare: !!plan && plan.devices.length > 0 && plan.spares.length === 0 && !plan.power,
    down: f.devices.some((d) => d.down),
  };
}

/** 1 文が帳面と食い違うか（食い違う決まりの名前。無ければ null） */
export function sentenceSlip(s: string, ctx: SlipContext): GateRule | null {
  const t = s.normalize("NFKC");
  if ((ctx.place === "shelter" || ctx.place === "other") && HOME_STAY.test(t) && !RETURNED.test(t)) return "place_text";
  if (ctx.place === "home" && AT_SHELTER.test(t)) return "place_text";
  for (const r of ctx.together) {
    const rel = relOf(r);
    if (rel && new RegExp(`${esc(rel)}(?:さん)?${ARRIVED_VERB}`, "u").test(t)) return "with_arrived";
  }
  if (ctx.kin) {
    const have = new Set(ctx.kin.map(relOf));
    for (const k of KIN_WORDS) {
      if (have.has(k)) continue;
      // 主語の形だけ（「娘が」「息子さんは」）。前が漢字（孫娘）や「お」（お兄さん）なら見ない
      if (new RegExp(`(?<![\\p{Script=Han}お])${k}(?:さん)?(?:が|は|も|と)`, "u").test(t)) return "absent_kin";
    }
  }
  if (ctx.powerBack && ASK_POWER.test(t)) return "ask_after_power";
  if (ctx.noSpare && SWAP.test(t)) return "spare_without_plan";
  if (ctx.down && BATTERY_BACK.test(t)) return "spare_without_plan";
  if (ctx.down && CALM.test(t)) return "calm_while_down";
  return null;
}

/** 文の区切り（句点・感嘆・疑問）。区切りの字は前の文に付ける */
const sentencesOf = (t: string): string[] => t.split(/(?<=[。！？!?])/u).filter((x) => x.trim() !== "");

/** 帳面と食い違う文を落とした言葉（全部落ちれば空文字）。落とした決まりを onDrop に */
export function dropFactSlips(raw: string, ctx: SlipContext, onDrop?: (rule: GateRule) => void): string {
  if (!raw.trim()) return raw;
  const kept: string[] = [];
  for (const s of sentencesOf(raw.replace(/\s+/g, " ").trim())) {
    const rule = sentenceSlip(s, ctx);
    if (rule) onDrop?.(rule);
    else kept.push(s);
  }
  return kept.join("");
}

/** 頼み事のうち、電気が戻った・電源が届いたあとの電池・電源を外す */
export function screenAsks(asks: ReadonlyArray<AskKind>, f: Facts, onDrop?: (rule: GateRule) => void): AskKind[] {
  if (!powerBack(f)) return [...asks];
  const out = asks.filter((a) => a !== "power" && a !== "battery");
  if (out.length < asks.length) onDrop?.("ask_after_power");
  return out;
}

/** いる所が家と家の外（避難所・その他）で入れ替わったか。家の外どうし（避難所 → 家にいない）は入れ替わりにしない */
export const placeFlipped = (prev: WhereNow, next: WhereNow): boolean => (prev === "home") !== (next === "home");

/**
 * 表の行の無い本人役の安否 1 つを帳面で見る（使えなければ null）。
 * - 赤（動けない・けが）→ 緑は、前の連絡から来た人・届いた手か、計画で移った（避難先と手段があり、同居の人と、家の外へ）ときだけ
 * - 声が無いと伝えられた本人が自分で連絡するのは、人が来るまで使わない
 * - いる所が、手も計画も印も無く変わったら帳面のいる所に直す（家 → 外は計画で移れる人と手のあった人、外 → 家は戻った言葉か手のあった人）
 * 色と 4 問は表（lib/triage）に渡す入力のまま。直すのはいる所だけ
 */
export function screenTurn(turn: DrillTurn, f: Facts, onDrop?: (rule: GateRule) => void): DrillTurn | null {
  const words = `${turn.saying ?? ""}${turn.doing ?? ""}`;
  const next = placeOfTurn(turn);
  // 計画で移った（避難先と手段。動けない人は手伝う人か乗り物）。移った先は家の外
  const planMoved = !!f.plan?.move && (next === "shelter" || next === "other") && (!f.hurt || f.plan.helper);
  if (f.hurt && turn.color === "green" && !f.help && !planMoved) {
    onDrop?.("hurt_to_safe");
    return null;
  }
  if (f.voiceLost && turn.source === "agent") {
    onDrop?.("voice_lost");
    return null;
  }
  const prev = f.place?.where ?? null;
  // 見るのは家と家の外の入れ替わりだけ（赤の「家にいない」は避難所とも食い違わない）
  if (prev && next && placeFlipped(prev, next) && !f.help && !f.away) {
    const leaving = prev === "home";
    const back = RETURNED.test(words.normalize("NFKC"));
    const ok = leaving ? !!f.plan?.move && (!f.hurt || f.plan.helper) : back;
    if (!ok) {
      onDrop?.("place_flip");
      if (turn.color === "green") return { ...turn, whereNow: prev };
      if (turn.color === "red") return { ...turn, atHome: prev === "home" };
    }
  }
  return turn;
}

// ---------- 監督・世界の出来事（業者の巡回と、同じ出来事の重なり） ----------

/** 届く物を運ぶ到着の役（業者・電源・薬）。手か表の行か計画（業者の約束）が無ければ AI に起こさせない */
export const SUPPLY_ROLES: ReadonlySet<string> = new Set(["vendor", "power", "medicine"]);

/** その人に、業者・電源・薬を届けてよい手があるか（業者に連絡・電源手配・薬手配、か計画の業者の約束） */
export function supplyAllowed(person: string, actions: ReadonlyArray<Pick<ActionRecord, "person" | "kind" | "as">>, plan: Plan | null): boolean {
  if (plan?.vendor) return true;
  return actions.some((a) => a.person === person && ["call_vendor", "arrange_power", "arrange_medicine"].includes(String(a.kind === "free" ? a.as : a.kind)));
}

/** 訓練の中で同じ種類の人ごとの出来事（監督の差し込み）を AI に出させる回数の上限 */
export const KIND_REPEAT_MAX = 2;

/** 出した出来事の 1 件の言い回しの元（仮名・数字・空白を外す） */
export const textKey = (t: string): string =>
  t
    .normalize("NFKC")
    .replace(/[A-Z]{1,3}\s?さん|本人/g, "")
    .replace(/[0-9０-９]+/g, "")
    .replace(/[\s、。・「」]/g, "");

/** 言い回しがほぼ同じか（文字の 2 つ組の重なり。短い文は同じ物だけ） */
export function sameWording(a: string, b: string): boolean {
  const x = textKey(a);
  const y = textKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) < 6) return false;
  const grams = (s: string) => new Set(Array.from(s).slice(0, -1).map((c, i) => c + Array.from(s)[i + 1]));
  const gx = grams(x);
  const gy = grams(y);
  let both = 0;
  for (const g of gx) if (gy.has(g)) both += 1;
  return both / Math.max(1, Math.min(gx.size, gy.size)) >= 0.8;
}

/** 監督・世界が出した人ごとの出来事 1 件（world.issued。applyEvent の前に engine の foldTick が足す） */
export type Issued = { kind: string; person: string | null; text: string; at: number };

/** 出した出来事を数える（AI の人ごとの出来事だけ。表と印・結末は数えない）。多すぎないよう新しい 40 件まで */
export function noteIssued(world: WorldState, incidents: ReadonlyArray<{ ai?: boolean; actor?: string; inject?: string; person?: string; text?: string; at?: number; change?: { kind?: string } }>): WorldState {
  const add: Issued[] = [];
  for (const e of incidents) {
    if (!e.ai || typeof e.inject !== "string" || !e.text) continue;
    add.push({ kind: e.inject, person: e.person ?? null, text: Array.from(e.text).slice(0, 30).join(""), at: Math.round((e.at ?? 0) * 60) });
  }
  if (add.length === 0) return world;
  return { ...world, issued: [...(world.issued ?? []), ...add].slice(-40) };
}

/** その種類はもう上限まで出したか */
export const kindSpent = (world: WorldState, kind: string): boolean => (world.issued ?? []).filter((x) => x.kind === kind).length >= KIND_REPEAT_MAX;

/** 同じ言い回しを、ほかの人にもう出したか */
export function wordingUsed(world: WorldState, text: string, person: string | null): boolean {
  return (world.issued ?? []).some((x) => x.person !== person && sameWording(x.text, text));
}

/** 監督・世界に渡す「もう出した物」の行（種類ごとの数と人と言い回し）。who は本人の id → 仮名 */
export function issuedLines(world: WorldState, label: (kind: string) => string, who: (p: string | null) => string | null): string[] {
  const byKind = new Map<string, Issued[]>();
  for (const x of world.issued ?? []) byKind.set(x.kind, [...(byKind.get(x.kind) ?? []), x]);
  return [...byKind].map(([kind, xs]) => {
    const people = [...new Set(xs.map((x) => who(x.person)).filter((x): x is string => !!x))];
    const texts = [...new Set(xs.map((x) => x.text))].slice(0, 2);
    return `${label(kind)} ${xs.length} 回${people.length > 0 ? `（${people.join("・")}）` : ""}${kindSpentCount(xs.length) && xs.some((x) => x.person !== null) ? "。もう出さない" : ""}: 「${texts.join("」「")}」`;
  });
}

const kindSpentCount = (n: number) => n >= KIND_REPEAT_MAX;

/** 「もう出した物」の段（監督・世界の入力）。無ければ空 */
export function issuedBlock(world: WorldState, label: (kind: string) => string, who: (p: string | null) => string | null): string[] {
  const lines = issuedLines(world, label, who);
  return lines.length > 0
    ? [[`もう出した出来事（同じ言い回しを別の人に使わない。人ごとの同じ種類は訓練に ${KIND_REPEAT_MAX} 回まで。違う種類・違う言い方で）:`, ...lines.map((x) => `- ${x}`)].join("\n")]
    : [];
}

// ---------- 採点・講評の記録（計画で動けた人と、計画が無く手が要った人） ----------

/** 計画で動けた事。spare 予備に替えた・evacuate 計画の避難先へ移った・stay 計画どおり在宅避難 */
export const PLAN_ACTS = ["spare", "evacuate", "stay"] as const;
export type PlanAct = (typeof PLAN_ACTS)[number];
/** 計画が無く手が要った事。power 停電で止まる機器に予備も外の電源も無い・move 区域にいて避難先か移る手段が計画に無い */
export const PLAN_NEEDS = ["power", "move"] as const;
export type PlanNeed = (typeof PLAN_NEEDS)[number];

export type PlanRow = { person: string; acted: PlanAct[]; needed: PlanNeed[] };
/** 訓練の記録に残す物（drills.score。画面は読まない）。rows は動けた事か要った事のある人だけ */
export type PlanScore = { acted: number; needed: number; rows: PlanRow[] };

export const PLAN_ACT_WORDS: Readonly<Record<PlanAct, string>> = { spare: "予備に替えた", evacuate: "計画の避難先へ移った", stay: "計画どおり在宅避難" };
export const PLAN_NEED_WORDS: Readonly<Record<PlanNeed, string>> = { power: "停電の機器の予備・電源", move: "避難先か移る手段" };

/** 停電の地区にこの家が入るか（lib/drill/persona.ts の inOutageArea と同じ決め） */
export function inOutageOf(
  area: NonNullable<WorldState["outage"]>["area"],
  hazards: ReadonlyArray<{ kind: string; depthM?: number | null }>,
  town: string | null,
): boolean {
  if (area.scope === "office") return true;
  if (area.scope === "towns") return !town || area.towns.includes(town);
  return hazards.some((h) => h.kind === area.hazard && (h.depthM ?? 0) >= area.minDepthM);
}

/**
 * 計画で動けた人と、計画が無く手が要った人（コードの数え。Claude を呼ばない）。people は終わりの前の連絡、inOutage は本人ごとの停電の地区。
 * 動けた: 停電で内蔵が切れて計画の予備に替えた・計画の避難先へ（移送の手なしで）移った・在宅避難の計画で家にいた。
 * 要った: 停電で止まる機器があり予備も外の電源も計画に無い（停電の地区）・区域にいて避難の筋（浸水・津波・警戒レベル 4 以上）があるのに避難先か手段が計画に無い
 */
export function scorePlans(input: {
  participants: ReadonlyArray<string>;
  plans: ReadonlyMap<string, Plan>;
  world: WorldState;
  people: Readonly<Record<string, PersonState>>;
  actions: ReadonlyArray<ActionRecord>;
  endMinute: number;
  inOutage: (person: string) => boolean;
}): PlanScore {
  const w = input.world;
  const danger = w.flood || w.tsunami !== "none" || (w.alertLevel ?? 0) >= 4;
  const rows: PlanRow[] = [];
  for (const p of input.participants) {
    const plan = input.plans.get(p);
    if (!plan) continue;
    const f = factsOf({ person: p, world: w, state: input.people[p] ?? null, actions: input.actions.filter((a) => a.person === p), now: input.endMinute, plan, inOutage: !!w.outage && input.inOutage(p) });
    const acted: PlanAct[] = [];
    const needed: PlanNeed[] = [];
    if (f.devices.some((d) => d.spare !== null)) acted.push("spare");
    const where = placeOfState(input.people[p] ?? null);
    const moved = (w.arrivals ?? []).some((a) => a.person === p && a.role === "transport" && a.arrived);
    if (plan.move && (where === "shelter" || where === "other") && !moved) acted.push("evacuate");
    if (plan.stayHome && where === "home") acted.push("stay");
    if (f.devices.some((d) => d.outAt !== null && d.spare === null) && !plan.power) needed.push("power");
    if (danger && plan.zone && !plan.move && !plan.stayHome) needed.push("move");
    if (acted.length > 0 || needed.length > 0) rows.push({ person: p, acted, needed });
  }
  return { acted: rows.filter((r) => r.acted.length > 0).length, needed: rows.filter((r) => r.needed.length > 0).length, rows };
}
