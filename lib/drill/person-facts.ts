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

import type { ContactKind, ContactReach, Ledger, Sex, SignalColor, WhereNow } from "../db/types.ts";
import { isSpouse, relationOf } from "./speaker.ts";
import { TALK_ASK_WORDS, type TalkAsk } from "./dialogue.ts";
import type { ActionRecord } from "./action-types.ts";
import type { DrillTurn, PersonState, TurnMove } from "./persona-types.ts";
import type { AskKind, WorldState } from "./scenarios.ts";
import { minuteText } from "./time-text.ts";
import { clipWords } from "./clip.ts";
import { clockOfMinute, clockWhen } from "./night.ts";

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

/**
 * 停電で減る機器の予備 1 つ。hours は予備の持つ時間（分からなければ null）。assumed は台帳に予備の時間が無く、
 * 内蔵の電池と同じ時間と見た（T139。評価の 4 回目で、予備の時間が「未確認」のまま何十時間も使えている言い方が残った）
 */
export type PlanSpare = { category: string; label: string; hours: number | null; assumed?: boolean };

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
  /**
   * ふだんから自分で動けない（寝たきり・歩行 困難。T139）。この人の赤の「動けない」はふだんの事で、けが・閉じ込めの「動けない」ではない
   * （赤 → 緑の門と台の検査が同じに見る）
   */
  immobile: boolean;
  /** 台帳の浸水の想定の深さ（m。浸水の区域が無ければ null。T141 で、川の氾濫の間に家の辺りが水につかっているかを見る） */
  floodM?: number | null;
  /** 同居で車のある人がいる（その場にいる手伝う人と乗り物。T141 で、ふだん動けない人が計画の手段で移れるかを見る） */
  carer?: boolean;
  /** 寝たきり（T177）。同居の人の車だけでは移れない。運べる人か乗り物が来て移る */
  bedridden?: boolean;
  /** 歩行に問題が無い（T177）。false は一部介助などで、手段の家族が来られないと移れない。無ければ見ない */
  walks?: boolean;
};

/** 川の氾濫（world.flood）で水につかる区域の深さ（m）。本人役の今の様子の「浸水 3 m の想定の地区で浸水」と同じ（lib/drill/persona.ts の worldWords） */
export const FLOOD_AREA_M = 3;

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
  // 予備の時間が台帳に無ければ、同じ機器の内蔵の電池と同じ時間と見る（T139 の案。見込みと分かる形で渡す）
  for (const s of spares) {
    const d = devices.find((x) => x.category === s.category);
    if (s.hours === null && d?.hours != null) Object.assign(s, { hours: d.hours, assumed: true });
  }
  const texts = [...items, ...(l.notes ?? []), ...(l.medical?.devices ?? []).map((d) => d.detail ?? ""), l.basic?.householdNote ?? ""];
  const e = l.evacuation ?? {};
  const stayHome = e.stayHome === true;
  const destination = stayHome ? null : (placeKindOf(e.destination1) ?? placeKindOf(e.destination2));
  const helperCar = src.contacts.some((c) => (c.reach === "together" || c.reach === "nearby") && c.has_car === 1);
  const means = !!(e.transport?.trim() || e.transportKind);
  const walks = l.care?.walking === "ok" && l.care?.bedridden !== true;
  const floods = (e.hazards ?? []).filter((h) => h.kind === "flood");
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
    immobile: l.care?.bedridden === true || l.care?.walking === "hard",
    floodM: floods.length > 0 ? Math.max(...floods.map((h) => h.depthM ?? 0)) : null,
    carer: src.contacts.some((c) => c.reach === "together" && c.has_car === 1),
    bedridden: l.care?.bedridden === true,
    walks,
  };
}

/**
 * 計画の予備が切れる時刻（発災からの分。T167）。時計の半分・切れ（lib/drill/clock.ts）は内蔵の電池の時計しか見ず、評価の 8 回目で、予備が切れてから
 * 11 時間、本人役が呼ばれなかった。runs は機器の時計の走り方（label と切れる時刻）。予備の時間が分からない物は入れない
 */
export function spareCuts(plan: Plan, person: string, runs: ReadonlyArray<{ person: string; label: string; outMinute: number }>): number[] {
  return plan.devices.flatMap((d) => {
    const s = plan.spares.find((x) => x.category === d.category);
    const run = runs.find((r) => r.person === person && r.label === d.label);
    return s?.hours != null && run ? [run.outMinute + Math.round(s.hours * 60)] : [];
  });
}

/**
 * 機器が止まってから本人役を呼ぶ間（分。T174）。評価の 9 回目で、予備が切れた知らせのあと、業者が着くまで 13 時間、誰からも連絡が無かった
 * （切れた時刻の呼び出しは 1 回だけで、巡回は 12〜24 時間ごと）。電気が戻る・電源が届く・家の外へ移ると止める
 */
export const DOWN_FOLLOW_MINUTES = [120, 360, 720] as const;

/** 機器が止まる時刻（発災からの分。T174）。予備があれば予備が切れる時刻、予備も外の電源も無ければ内蔵が切れる時刻。予備の時間が分からない物は入れない */
export function downCuts(plan: Plan, person: string, runs: ReadonlyArray<{ person: string; label: string; outMinute: number }>): number[] {
  return plan.devices.flatMap((d) => {
    const s = plan.spares.find((x) => x.category === d.category);
    const run = runs.find((r) => r.person === person && r.label === d.label);
    if (!run) return [];
    if (s) return s.hours != null ? [run.outMinute + Math.round(s.hours * 60)] : [];
    return plan.power ? [] : [run.outMinute];
  });
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
        ? `停電で${d.label}が切れたら、${s.label}に替える（計画。${s.hours != null ? `予備 ${s.hours} 時間${s.assumed ? "の見込み（台帳に時間が無く、内蔵と同じと見た）" : ""}` : "予備の時間は未確認"}）`
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

// ---------- 電話に出る人（台帳から。T174） ----------

/** 電話に出られるかを読む台帳の欄（仮名化の前。サーバーの中だけ） */
export type SelfPhoneLedger = {
  basic?: { contactMeans?: { mobile?: boolean | null; smartphone?: string | null } | null };
  care?: { bedridden?: boolean | null; hearing?: string | null };
};

/**
 * 本人が電話に出られるか（T174。評価の 9 回目で、寝たままの本人が固定電話に出て話した）。訓練の架空の人の役の決めで、台帳の働きの欄と電話の手段だけを見る:
 * 寝たきりで手元に電話が無い（固定電話だけ）・聞こえが「困難」。処置や病名の記録からは決めない。認知症・聞こえ「一部」の記録では止めない（出たあとの話し方は本人役が演じる）
 */
export function selfCanAnswer(l: SelfPhoneLedger): boolean {
  const means = l.basic?.contactMeans;
  const atHand = means?.mobile === true || means?.smartphone === "uses";
  if (l.care?.bedridden === true && !atHand) return false;
  return l.care?.hearing !== "hard";
}

/** 本人への電話に出る人（呼び方）。本人が出られなければ同居の家族・支援者（電話の話し手の役割名）の最初の人、誰もいなければ null（呼び出し音だけ。出ない） */
export function phoneAnswerer(l: SelfPhoneLedger, housemateRoles: ReadonlyArray<string>): string | null {
  return selfCanAnswer(l) ? "本人" : (housemateRoles[0] ?? null);
}

// ---------- 帳面（今ある物から引く） ----------

/** ケアマネの行 1 つ（外へ掛けた電話・掛かってきた電話の往復）。text は保存した言葉（自由の言葉は名前に戻してある。Claude に渡すときは伏せる） */
export type ToldLine = { minute: number; text: string; ask?: string };

/** 帳面に書くケアマネに言われた事 1 つ */
export type Told = { at: number; words: string; via: "out" | "in" };

/** 帳面に書くケアマネに言われた事の数（新しい物から） */
export const TOLD_MAX = 4;

/** ケアマネに言われた事 1 つの長さ（字）。超えたら文の切れ目で切る（T139） */
const TOLD_WORDS_MAX = 60;

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
    if (words) out.push({ at: l.minute, words: clipWords(words, TOLD_WORDS_MAX), via: l.via });
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
  /** 想定の表のこの人の次の行（今より後。T139）。表の行は骨で、本人役が表の次の緑と食い違うけが・閉じ込めを足さない。無ければ見ない */
  ahead?: { color: SignalColor; at: number } | null;
  /**
   * ケアマネの自由の言葉を Claude に渡せる形に伏せる口（呼ぶ側が事業所の全員の鍵で。伏せきれなければ null で渡さない）。
   * 無ければ自由の言葉は帳面の文に書かない（決まった問い・指示の言葉だけ）
   */
  mask?: (text: string) => string | null;
  /** 発災の時刻（時。T177、night.ts の clockStartOf）。あれば帳面の時刻を時計の言い方で渡す。無ければ経過の数のまま */
  startHour?: number | null;
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
  spare: { label: string; at: number; by: string; outAt: number | null; assumed?: boolean } | null;
  /** 内蔵の電池が切れる時刻（停電中でまだ切れていない時。T139 で残りを渡す）。分からなければ null */
  dueAt?: number | null;
  /** 今、止まっていて戻っていない（予備も無い・切れた、電気も電源も来ていない） */
  down: boolean;
  /**
   * 停電が戻った・電源が届いて、電気で動き出した時刻（T141）。まだなら null。評価の 5 回目で、停電が戻ったあとも帳面の文が
   * 「予備も切れた」のままで、本人役が電池切れを言い続けた
   */
  backAt?: number | null;
  /**
   * 残り（分。T141）。internal 内蔵の残り・spare 予備の残り（替える前は予備の持つ時間）・total 合わせた残り。電池で動いていなければ null。
   * 本人役の言う数はこれから決める（コードが決める）
   */
  remain?: { internal: number | null; spare: number | null; total: number | null } | null;
  /** 切れたのが前の連絡より前（もう起きた事。新しい事のように「切れました」と言わない。T141） */
  known?: boolean;
};

/** 計画の手段で向かえない訳（T141） */
export type GoWhy = "plan" | "blocked" | "helper";

/** いる所の出どころ（T139・T141） */
export type PlaceBy = "turn" | "transport" | "plan" | "wandering" | "found";

export type Facts = {
  person: string;
  now: number;
  /** 発災の時刻（時。T177）。無ければ帳面の時刻は経過の数 */
  startHour?: number | null;
  plan: Plan | null;
  /**
   * いる所と時刻（T139 で出どころを足した）。turn 前の連絡（緑はいる所、赤は「家にいるか」）・transport 移送の車が着いた（避難先の種類へ）・
   * plan 避難先へ向かうと言い、計画の手段で移った・wandering 本人が家を出て行き先が分からない
   * （T141）・found 行き先の分からなかった本人が見つかり家に戻った（T141）。前の連絡のあとの物ほど新しい物を使う
   */
  place: { where: WhereNow; at: number; by?: PlaceBy; loose?: true } | null;
  /** 前の連絡の時刻（発災からの分。まだ無ければ -1。T141） */
  prevAt?: number;
  /** もう移った先にいる人に移送の車が着いた時刻（T167。乗らずにそのまま） */
  rideAfter?: number;
  /** 計画の手段で向かっている途中（T177。移った事の記録の着く時刻が今より後） */
  moving?: TurnMove;
  /** 前の連絡のあとに移送の車が着いた（T177。「移送の車が来ました」と言ってよい） */
  rideNew?: boolean;
  /** 同居でない家族が帰宅困難（T177。手段の家族が来られない） */
  familyAway?: boolean;
  /** 家の辺りが通れない（道の通行止・家の辺りの浸水。計画の手段でも移れない。T141 で川の氾濫の区域を足した） */
  blocked?: boolean;
  /** 通れない訳（T174）。閉じている道の名前と、家の辺りが水につかっているか */
  blockedBy?: { roads: ReadonlyArray<string>; flooded: boolean };
  /** この人の道が土砂でふさがった事があり、家の辺りは水につかっていない（T174。通れない訳を水と言わない） */
  dryRoad?: boolean;
  /** 避難先へ向かうと言った（時刻と、計画の手段で移れるか。T139）。移れなければ訳（T141） */
  going: { at: number; can: boolean; why?: GoWhy } | null;
  /** 家族・支援者が本人の所にいる・見に行ったと伝えた（時刻と出どころ。WITH_MINUTES の間。T139） */
  withPerson: { at: number; by: "family" | "supporter" } | null;
  /** 想定の表のこの人の次の行（T139） */
  ahead: { color: SignalColor; at: number } | null;
  /** 前の連絡が赤で、動けない・けがと言った（時刻） */
  hurt: { at: number; canMove: boolean | null; injured: boolean | null } | null;
  /** 前の連絡から今までに来た人・届いた物・会えた手（いちばん新しい物） */
  help: Help | null;
  /** 前の連絡から今までに来た、本人を運べる人・乗り物（電源・薬・機器の業者のほか。いちばん新しい物。T141） */
  mover?: Help | null;
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
  /** 栄養剤を家に置いてきた（世界の印の時刻。T158）。人が着くと印は消える。無ければ null */
  left?: { at: number } | null;
  /** 前の連絡までに言って、まだ済んでいない予定（T165。119 へ掛ける・物を取りに行く。時刻は発災からの分） */
  promised?: ReadonlyArray<{ kind: IntentKind; at: number }>;
};

/**
 * 前に言った予定の種類（T165）。評価の 7 回目で「119 にかけます」を 3 回の連絡で言い、掛けた・掛けられなかったの話が無かった。
 * call119 は 119・救急へ掛ける、fetch は物を取りに行く。言った予定は本人の様子に残り（engine の personStateOf）、済んだ言い方で消える
 */
export const INTENT_KINDS = ["call119", "fetch"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
/** これからする言い方（「119 にかけます」「119 には、このあとかけます」「取りに行きます」） */
const INTENT_FUTURE: Readonly<Record<IntentKind, RegExp>> = {
  call119: /(?:119|一一九|救急車?)(?:に|へ|を)?(?:は|も)?[^。]{0,8}?(?:かけ(?:ます|る|よう|てみ)|掛け(?:ます|る|よう|てみ)|呼び(?:ます|たい)|呼ぶ|呼ぼう|電話し(?:ます|てみ|よう)|連絡し(?:ます|てみ|よう))/u,
  fetch: /取りに(?:行き(?:ます|たい)|行く|行こう|戻り(?:ます|たい)|戻る|帰り(?:ます|たい))/u,
};
/** 済んだ・やめた言い方（「119 にかけました」「119 はかけない」「救急車が来た」「取ってきました」） */
const INTENT_DONE: Readonly<Record<IntentKind, RegExp>> = {
  call119:
    /(?:119|救急)[^。]{0,10}?(?:かけ|掛け|呼び|呼ん|電話し|連絡し)(?:ました|た(?!ら|い)|ています|てい[るま])|(?:119|救急)[^。]{0,10}?(?:かけ|掛け|呼ば)(?:ない|ません|ず)|(?:119|救急)[^。]{0,10}?(?:やめ|つなが)|救急(?:車|隊)?が(?:来|着)/u,
  fetch: /取って(?:き|来)|取りに(?:行っ|戻っ)た|取りに(?:行き|戻り)ました|持って(?:き|来)(?:ました|た)/u,
};
/** 予定の言葉（帳面の文） */
const INTENT_WORDS: Readonly<Record<IntentKind, string>> = { call119: "119 へ掛ける", fetch: "物を取りに行く" };

/** 1 つの言葉の、これからする予定の種類（済んだ言い方の物は入れない。T165） */
export function intentsSaid(text: string | null | undefined): IntentKind[] {
  const t = (text ?? "").normalize("NFKC");
  return INTENT_KINDS.filter((k) => INTENT_FUTURE[k].test(t) && !INTENT_DONE[k].test(t));
}

/**
 * 連絡を重ねて残す予定（T165。engine の本人の様子と帳面が同じに引く）。前の予定のうち、この連絡で済んだ・やめたと言った物を外し、
 * この連絡で新しく言った予定を足す（時刻は言った時の時間）。前の様子に予定が無ければ前の言葉から引く
 */
export function carryPromises(
  prev: Pick<PersonState, "saying" | "at" | "promised"> | null,
  t: { saying?: string | null; at: number },
): Array<{ kind: IntentKind; at: number }> {
  const said = (t.saying ?? "").normalize("NFKC");
  const before = prev ? (prev.promised ?? intentsSaid(prev.saying).map((kind) => ({ kind, at: prev.at }))) : [];
  const out = before.filter((p) => !INTENT_DONE[p.kind].test(said));
  for (const k of intentsSaid(said)) if (!out.some((p) => p.kind === k)) out.push({ kind: k, at: t.at });
  return out;
}

/**
 * 向かう先と動詞の間に挟まる手段・連れの言い方（T165。評価の 7 回目で「避難所へ歩いて行きます」が向かうと言った事にならず、
 * 計画の手段で移らないまま、あとの連絡で家にいた）。「車で」「妻と」「これから」など短い物だけ
 */
const GO_GAP = String.raw`(?:歩いて|車で|徒歩で|一緒に|これから|今から|すぐに?|早めに|[^。、\s]{1,4}?(?:と一緒に|と|の車で))?`;
/** 避難先へ向かうと言った言い方（打ち消し・「行かん」は見ない。T139） */
const GO_INTENT = new RegExp(
  `(?:避難所|避難先|病院|集会所|公民館|学校|高台)(?:へ|に)${GO_GAP}(?:向か(?!え)|行き(?!ませ)|行く|行こう|移り(?!ませ)|移る|移ろう|移動し(?!な|ませ)|連れて行(?!け))|避難(?:します|する|しよう|しています|を始め)`,
  "u",
);
/** 向かえない・迷っている言い方（「行きたいが道が通れず行けない」）。向かうと言った事にしない */
const GO_NOT = /行け(?:ない|ません|ず|なく)|向かえ(?:ない|ません|ず)|移れ(?:ない|ません|ず)|たいけど|たいが|たいのですが|か(?:迷|悩)/;
/** 向かうと言ってから、計画の手段で着いたと見るまでの分 */
export const GO_MINUTES = 60;
/** 家族・支援者が本人の所にいる・見に行ったと伝えた言い方（T139） */
const WITH_WORDS = /見に行(?:きました|った|って)|(?:様子|顔)を見(?:に|て)(?:来|き)|(?:家|そば|横|一緒)に(?:い|居)(?:ます|る)|(?:着きました|来ました|来た)(?:。|$|よ|けど|が)|付き添っ/;
/** そばにいると伝えてから「様子が分からない」と言わない間（分） */
export const WITH_MINUTES = 180;

export const ARRIVAL_WORDS: Readonly<Record<string, string>> = {
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
/** 電話の様子の話（T165。「電話では声が出ませんでした」は電話の出方で、そばの人が見た本人の声の話ではない） */
const PHONE_TALK = /電話|通話|回線|着信|呼び出し/;
/**
 * 家族・支援者が本人の声が無いと伝えたか（T165）。電話の話の文は見ない（評価の 7 回目で、ケアマネの電話が物音だけだった事を家族が
 * 「電話では声が出ない」と伝え、声の印が付いて、機器も無く歩ける人がそのあと電話で話さなくなった）
 */
export function voiceLostSaid(text: string): boolean {
  return text
    .normalize("NFKC")
    .split(/(?<=[。！？!?])/u)
    .some((s) => NO_VOICE.test(s) && !PHONE_TALK.test(s));
}
export const NO_VOICE =
  /声が(?:ない|無い|出ない|出ません|しない|しません|聞こえない|聞こえません|ありません)|返事が(?:ない|無い|ありません)|呼(?:び)?かけ[^。]{0,8}(?:答えない|答えません|応えない|反応(?:が)?(?:ない|無い|ありません))|反応が(?:ない|無い|ありません)|物音だけ/;

/**
 * 前の連絡のいる所（緑はいる所、赤は「家にいるか」）。分からなければ null。
 * 赤の「家にいない」は、前からの連絡で避難所と分かっていれば避難所（T158、placeKnown）。評価の 6 回目で、避難所に移ったあとの赤の連絡が
 * 「家の外（避難所でない所）」と帳面に渡り、本人役が「避難所ではない・避難所へ移ります」と言った
 */
export function placeOfState(s: (Pick<PersonState, "color" | "whereNow" | "atHome"> & { placeKnown?: WhereNow | null }) | null): WhereNow | null {
  if (!s) return null;
  if (s.color === "green") return s.whereNow ?? null;
  if (s.color === "red" && typeof s.atHome === "boolean") return s.atHome ? "home" : s.placeKnown === "shelter" ? "shelter" : "other";
  return null;
}

/**
 * 連絡を重ねて分かっているいる所（T158。engine の本人の様子と台の検査が同じに引く）。緑はいる所、赤の「家にいる」は家、
 * 赤の「家にいない」は言葉が避難所にいると言っていれば避難所、前から家の外（避難所・その他）と分かっていればその所、無ければその他。
 * いる所の分からない連絡（色の分からない・赤で家にいるか答えない）は前のまま
 */
export function carryPlace(
  prev: (Pick<PersonState, "color" | "whereNow" | "atHome"> & { placeKnown?: WhereNow | null }) | null,
  t: Pick<DrillTurn, "color" | "whereNow"> & { atHome?: boolean | null; saying?: string | null },
): WhereNow | null {
  const before = prev ? (placeOfState(prev) ?? prev.placeKnown ?? null) : null;
  if (t.color === "green" && t.whereNow) return t.whereNow;
  if (t.color === "red" && t.atHome === true) return "home";
  if (t.color === "red" && t.atHome === false) {
    if (t.saying && placeSaid(t.saying) === "shelter") return "shelter";
    return before === "shelter" || before === "other" ? before : "other";
  }
  return before;
}

/**
 * 移った事の記録を連絡で重ねる（T177。engine の本人の様子と台の検査が同じに引く）。評価の 10 回目で 3 回とも、本人役の言葉だけで避難所や病院へ移り、次の連絡で家に戻った。
 * 門を通った安否（計画の手段の記録・想定の表の行・手が来たあとの連絡）だけを記録する。表の固定の安否が「家」でも記録は戻さない（移った人の表の行は門が直す。AI が失敗した時の固定の安否だけここに来る）
 */
export function carryMoved(prev: Pick<PersonState, "moved"> | null, t: Pick<DrillTurn, "color" | "whereNow" | "at"> & { atHome?: boolean | null | undefined; move?: TurnMove | undefined; ai?: boolean | undefined }): TurnMove | null {
  if (t.move) return t.move;
  const before = prev?.moved ?? null;
  const place = placeOfState({ color: t.color, whereNow: t.whereNow, atHome: t.atHome ?? null });
  const minute = Math.round(t.at * 60);
  if (place === "shelter" || place === "other") return before && before.to !== "home" ? before : { to: place, at: minute, by: "turn" };
  if (place === "home" && before && before.to !== "home" && before.at <= minute && t.ai === true) return { to: "home", at: minute, by: "turn" };
  return before;
}

/** 安否 1 つのいる所（緑はいる所、赤は「家にいるか」） */
function placeOfTurn(t: Pick<DrillTurn, "color" | "whereNow" | "atHome">): WhereNow | null {
  return placeOfState({ color: t.color, whereNow: t.whereNow, atHome: t.atHome });
}

/** 本人を運べる人・乗り物か（電源・薬・機器の業者は物を届けるだけ。T141） */
const NOT_MOVERS: ReadonlySet<string> = new Set([ARRIVAL_WORDS.power, ARRIVAL_WORDS.medicine, ARRIVAL_WORDS.vendor]);
export const isMover = (h: Help): boolean => !NOT_MOVERS.has(h.what);

/**
 * いる所の入れ替わりを、前の連絡からの手で認めるか（T130・T141）。ふだん動けない人が家から出るのは、運べる人・乗り物が来た時だけ
 * （電源や薬が届いただけでは家の外へ出ない）。ほかは前からの手で認める
 */
export function helpedFlip(f: Pick<Facts, "mover">, prev: WhereNow): boolean {
  // 家の外から家へは、来た人・届いた物では戻らない（T167。評価の 8 回目で、病院へ移ったと言ったあとに業者が来た事で家にいる連絡が通った）。戻るのは戻った言葉のときだけ
  if (prev !== "home") return false;
  // 家から出るのは運べる人・乗り物が来た時だけ（T177。薬や電源が届いただけでは出ない。前はふだん動ける人なら何が届いても出られた）
  return (f.mover ?? null) !== null;
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

/**
 * 家の辺りが通れないか（T139・T141）。この人の家の近くの道か全体の道の通行止、家の辺りの浸水（仮想の印）、
 * 川の氾濫の間で家が浸水の区域（台帳の浸水の深さが FLOOD_AREA_M 以上）。計画の手段があっても移れない
 */
export function placeBlocked(world: WorldState, person: string, plan: Plan | null): boolean {
  const roads = (world.roads ?? []).some((r) => (!r.person || r.person === person) && !r.open);
  const flooded = world.marks?.[person]?.flooded !== undefined || (world.flood === true && (plan?.floodM ?? 0) >= FLOOD_AREA_M);
  return roads || flooded;
}

/** 家の辺りが通れない訳（T174）。閉じている道の名前と、家の辺りが水につかっているか */
export function blockedWhy(world: WorldState, person: string, plan: Plan | null): { roads: string[]; flooded: boolean } {
  const roads = (world.roads ?? []).filter((r) => (!r.person || r.person === person) && !r.open).map((r) => r.label);
  return { roads: [...new Set(roads)], flooded: world.marks?.[person]?.flooded !== undefined || (world.flood === true && (plan?.floodM ?? 0) >= FLOOD_AREA_M) };
}

/**
 * 計画の手段で避難先へ移れた時刻（T139・T141。移れなければ null）。going は向かうと言った時刻。
 * - 計画に避難先と手段が無い・家の辺りが通れない間は移れない
 * - ふだん動けない人（寝たきり・歩行 困難）は、同居で車のある人がいる（その場に手伝う人と乗り物がある）か、手伝う人か乗り物が実際に
 *   来た時（向かうと言ったあとの到着・訪問）だけ。台帳の手段の字（「訪問看護と…」）だけでは移らない（評価の 5 回目で、寝たきりで呼吸器の人が
 *   浸水の中で向かうと言った 1 時間後に「家の外」になった）
 * - けが・閉じ込めの人は、手伝う人か乗り物が計画にあるとき（T130 のまま）。ほかは向かうと言ってから GO_MINUTES
 */
export function planMoveAt(
  x: { world: WorldState; actions: ReadonlyArray<ActionRecord>; person: string; plan: Plan | null; hurt: boolean; going: number; now: number },
): number | null {
  const plan = x.plan;
  if (!plan?.move || placeBlocked(x.world, x.person, plan)) return null;
  if (needsMover(plan)) {
    const came = helpsBetween(x.world, x.actions, x.person, x.going, x.now).filter(isMover)[0];
    return came ? came.at : null;
  }
  if (x.hurt && !plan.helper) return null;
  return x.going + GO_MINUTES <= x.now ? x.going + GO_MINUTES : null;
}

/**
 * 計画の手段で今移れる形か（いる所の門 screenTurn と台の検査が同じに見る。T141・T177）。
 * 自力で移れる人（T177 の決め）: 計画に避難先と手段があり、道が通れて、次のどれか。歩行に問題が無い。同居で車のある人がいる（寝たきりは除く）。一部介助で手段の家族が来られる（帰宅困難の印が無い）。
 * 寝たきりの人と、同居の車の無いふだん動けない人は、運べる人か乗り物が来るまで移らない。けがの人は手伝う人か乗り物が計画にある時だけ
 */
export function canLeaveHome(f: Pick<Facts, "plan" | "hurt" | "mover" | "blocked" | "familyAway">): boolean {
  const plan = f.plan;
  if (!plan?.move || f.blocked) return false;
  if (needsMover(plan)) return (f.mover ?? null) !== null;
  if (f.familyAway && plan.walks === false && !plan.carer) return false;
  return !f.hurt || plan.helper;
}

/** 運べる人か乗り物が来ないと移れない人（T177。寝たきり、同居の車の無いふだん動けない人） */
const needsMover = (plan: Plan): boolean => plan.bedridden === true || (plan.immobile && !plan.carer);

/** 移った先から家へ戻れる形か（T177。行きと同じ手が要る。道が通れて、運べる人が来たか自分で動ける） */
export function canReturnHome(f: Pick<Facts, "plan" | "mover" | "blocked">): boolean {
  if (f.blocked) return false;
  return !f.plan || !needsMover(f.plan) || (f.mover ?? null) !== null;
}

/** 計画の手段で移り始めた記録（T177）。着くのは GO_MINUTES あと。行き先は計画の避難先の種類 */
export function planMoveOf(f: Pick<Facts, "plan" | "now">): TurnMove {
  return { to: f.plan?.destination === "shelter" ? "shelter" : "other", at: f.now + GO_MINUTES, by: "plan" };
}

/** 帳面を引く（コードの計算。Claude を呼ばない） */
export function factsOf(input: FactsInput): Facts {
  const { person, world, state, actions, now, plan } = input;
  const prevAt = state ? Math.round(state.at * 60) : -1;
  const turnWhere0 = placeOfState(state);
  // 移った事の記録（T177）。着く時刻の前は向かっている途中で、いる所は前のまま。移った先にいる間は、連絡がいる所を言わなくても家に戻さない
  const record = state?.moved ?? null;
  const moving = record && record.at > now ? record : null;
  const settledAt = record && !moving && record.to !== "home" ? record : null;
  const turnWhere = settledAt && (turnWhere0 === "home" || (turnWhere0 === "other" && state?.color === "red")) ? settledAt.to : turnWhere0;
  // 移送の車が前の連絡より前に着いていて、そのあとの赤の「家にいない」（どこかは言わない）は移った先のまま（T158）
  const carriedBefore = (world.arrivals ?? []).some((a) => a.person === person && a.role === "transport" && a.arrived && a.arrive <= prevAt);
  const where: WhereNow | null =
    turnWhere === "other" && state?.color === "red" && state.placeKnown !== "other" && carriedBefore ? (plan?.destination === "shelter" ? "shelter" : "other") : turnWhere;
  // 動けない（けが・閉じ込め）。ふだんから動けない人の「動けない」は数えない（T139）
  const hurt =
    state && state.color === "red" && (state.injured === true || (state.canMove === false && !plan?.immobile))
      ? { at: prevAt, canMove: state.canMove ?? null, injured: state.injured ?? null }
      : null;
  const dest: WhereNow = plan?.destination === "shelter" ? "shelter" : "other";
  const blocked = placeBlocked(world, person, plan);
  const blockedBy = blockedWhy(world, person, plan);
  // 移送の車が前の連絡のあとに着いた（T139。移送は本人を避難先へ運ぶ手。着いたら帳面のいる所は避難先の種類）
  const carried = (world.arrivals ?? []).filter((a) => a.person === person && a.role === "transport" && a.arrived && a.arrive > prevAt && a.arrive <= now).at(-1);
  // 避難先へ向かうと言った（家族・本人。打ち消しは見ない）。計画の手段で移れた時刻は planMoveAt（T139・T141）
  const said = state?.saying?.normalize("NFKC") ?? "";
  // 前の連絡でもう家の外にいる人（「避難所に移りました」）は向かう途中ではない（T141）
  const goingSaid = !!state && where !== "shelter" && where !== "other" && GO_INTENT.test(said) && !RETURNED.test(said) && !GO_NOT.test(said);
  const movedAt = goingSaid ? planMoveAt({ world, actions, person, plan, hurt: hurt !== null, going: prevAt, now }) : null;
  // 向かえない訳（T141）: plan 計画に避難先か手段が無い・blocked 道が通れない・浸水・helper ふだん動けない人に手伝う人・乗り物がまだ来ていない
  const goWhy: GoWhy | null = !plan?.move ? "plan" : blocked ? "blocked" : (plan.immobile && !plan.carer && movedAt === null) || (hurt && !plan.helper) ? "helper" : null;
  const going = moving ? { at: moving.at - GO_MINUTES, can: true } : goingSaid && !record ? { at: prevAt, can: goWhy === null, ...(goWhy ? { why: goWhy } : {}) } : null;
  // 本人が家を出て行き先が分からない・見つかった（T141。世界の印）
  const m = world.marks?.[person] ?? {};
  const lostAt = typeof m.wandering === "number" ? Math.round(m.wandering * 60) : null;
  const foundAt = typeof m.found === "number" ? Math.round(m.found * 60) : null;
  const lost = lostAt !== null && lostAt <= now && !(foundAt !== null && foundAt >= lostAt && foundAt <= now);
  // いる所の候補（前の連絡のあとの物ほど新しい。同じ時刻は後に足した物）
  const cands: Array<{ where: WhereNow; at: number; by: PlaceBy; loose?: true }> = [];
  // 赤の「家にいない」だけで、どこかが分からない（T158。帳面の文で「避難所でない所」と書かない）
  const loose = where === "other" && state?.color === "red";
  if (where && state) cands.push({ where, at: prevAt, by: "turn", ...(loose ? { loose: true as const } : {}) });
  // もう避難所にいる人に移送の車が来ても、移った事にしない（T167。評価の 8 回目で、避難所へ移ったと言ったあとに迎えの車で着いた話になった）
  const rideAfter = carried && where === "shelter" && dest === "shelter" ? carried.arrive : carried && settledAt ? carried.arrive : null;
  if (carried && rideAfter === null) cands.push({ where: dest, at: carried.arrive, by: "transport" });
  // 前の連絡より前に着いた移送の車（T177。そのあとの連絡がいる所を言わなくても、移った先のまま）
  const carriedOld = !where && !carried ? (world.arrivals ?? []).filter((a) => a.person === person && a.role === "transport" && a.arrived && a.arrive <= prevAt).at(-1) : undefined;
  if (carriedOld) cands.push({ where: dest, at: carriedOld.arrive, by: "transport" });
  if (movedAt !== null && !carried && !record) cands.push({ where: dest, at: movedAt, by: "plan" });
  if (settledAt) cands.push({ where: settledAt.to, at: settledAt.at, by: settledAt.by === "plan" ? "plan" : "turn" });
  // 訪問は本人のいる所へ行く（T167。lib/drill/persona.ts の visitText）。訪問で、いる所を家に直さない（前は訪問の返事がどこでも「家で会えた」になり、避難所の人が家に戻っていた）
  if (lost && lostAt! > prevAt) cands.push({ where: "other", at: lostAt!, by: "wandering" });
  if (foundAt !== null && lostAt !== null && foundAt >= lostAt && foundAt > prevAt && foundAt <= now) cands.push({ where: "home", at: foundAt, by: "found" });
  const latest = cands.reduce<(typeof cands)[number] | null>((acc, c) => (!acc || c.at >= acc.at ? c : acc), null);
  const place: Facts["place"] = latest ? { where: latest.where, at: latest.at, by: latest.by, ...(latest.loose ? { loose: true as const } : {}) } : null;
  const withPerson =
    state && state.source !== "agent" && WITH_WORDS.test(said) && now - prevAt <= WITH_MINUTES ? { at: prevAt, by: state.source as "family" | "supporter" } : null;
  const helps = helpsBetween(world, actions, person, prevAt, now);
  const got = helpsBetween(world, actions, person, -1, now);
  const voice = state && state.source !== "agent" && state.saying && voiceLostSaid(state.saying) && helps.length === 0 ? { at: prevAt } : null;
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
    const spareHours = s?.hours != null ? Math.round(s.hours * 60) : null;
    const spare = outAt !== null && s ? { label: s.label, at: outAt, by, outAt: spareHours !== null ? outAt + spareHours : null, assumed: s.assumed === true } : null;
    // 電気が戻った・電源が届いた（停電の間だけ。予備が切れる前に戻れば予備は切れていない。T141）
    const backAt = since !== null && stop !== null ? stop : null;
    const spareCut = spare?.outAt != null && spare.outAt <= now && (backAt === null || backAt > spare.outAt) ? spare.outAt : null;
    const spareRunning = spare !== null && backAt === null && (spare.outAt === null || spare.outAt > now);
    const due = raw !== null && outAt === null && stop === null && raw > now ? raw : null;
    const down = outAt !== null && backAt === null && !spareRunning && !plan?.power;
    // 残り（分。T141）。替える前は内蔵の残りと予備の持つ時間、替えたあとは予備の残り、止まっていれば 0
    const remain =
      backAt !== null || since === null || (outAt !== null && plan?.power && !spareRunning)
        ? null
        : due !== null
          ? { internal: due - now, spare: spareHours, total: spareHours !== null ? due - now + spareHours : s ? null : due - now }
          : spareRunning
            ? { internal: 0, spare: spare!.outAt !== null ? spare!.outAt - now : null, total: spare!.outAt !== null ? spare!.outAt - now : null }
            : down
              ? { internal: 0, spare: s ? 0 : null, total: 0 }
              : null;
    // 前の連絡より前に切れた（予備があれば予備の切れた時刻、無ければ内蔵の切れた時刻。T141）
    const lastCut = s ? spareCut : outAt;
    const known = lastCut !== null && backAt === null && lastCut < prevAt;
    return {
      label: d.label,
      category: d.category,
      outAt,
      spare: spare ? { ...spare, outAt: spareCut ?? (spareRunning ? spare.outAt : null) } : null,
      dueAt: due,
      down,
      backAt,
      remain,
      known,
    };
  });
  return {
    person,
    now,
    ...(input.startHour != null ? { startHour: input.startHour } : {}),
    plan,
    place,
    prevAt,
    ...(rideAfter !== null ? { rideAfter } : {}),
    ...(moving ? { moving } : {}),
    rideNew: carried !== undefined,
    ...(m.familyAway !== undefined ? { familyAway: true } : {}),
    blocked,
    blockedBy,
    dryRoad: !blockedBy.flooded && !world.flood && (world.roads ?? []).some((r) => r.person === person && r.id.startsWith("rd-ls-")),
    going,
    withPerson,
    ahead: input.ahead ?? null,
    hurt,
    help: helps.at(-1) ?? null,
    mover: helps.filter(isMover).at(-1) ?? null,
    got,
    voiceLost: voice,
    power: { outage: since === null ? "none" : restoredAt !== null && restoredAt <= now ? "restored" : "on", since, restoredAt, supplied },
    devices,
    together: input.together ?? [],
    kin: input.kin ?? null,
    away: lost || m.carSleep !== undefined || m.goingHome !== undefined,
    left: typeof m.supplyLeft === "number" && Math.round(m.supplyLeft * 60) <= now ? { at: Math.round(m.supplyLeft * 60) } : null,
    // 前の連絡までに言った予定（T165。前からの保存で予定の欄が無ければ前の言葉から引く）
    promised: (state ? (state.promised ?? intentsSaid(state.saying).map((kind) => ({ kind, at: state.at }))) : []).map((p) => ({
      kind: p.kind,
      at: Math.round(p.at * 60),
    })),
    told: toldOf(input),
  };
}

/** 電気が戻った・電源が届いた（電池・電源を頼まない） */
export const powerBack = (f: Facts): boolean => f.power.outage === "restored" || f.power.supplied !== null;

const WHERE_WORDS: Readonly<Record<WhereNow, string>> = { home: "家", shelter: "避難所", other: "家の外（避難所でない所）" };
const PLACE_BY_WORDS: Readonly<Record<PlaceBy, string>> = {
  turn: "の連絡",
  transport: "に移送の車で移った",
  plan: "に計画の手段で移った",
  wandering: "に本人が家を出た",
  found: "に見つかり家に戻った",
};

/**
 * いる所の言葉（T141）。計画・移送で移った先は避難先の種類（病院・避難所・決めた所）で書き、「家の外」と書かない（評価の 5 回目で、
 * 寝たきりの人の移った先の病院が「家の外」と渡り、本人役がそのまま「家の外にいる」と言った）。行き先の分からない人は家と書かない
 */
export function placeWords(f: Pick<Facts, "place" | "plan">): string | null {
  const p = f.place;
  if (!p) return null;
  if (p.by === "wandering") return "行き先が分からない（家にいない）";
  if ((p.by === "plan" || p.by === "transport") && p.where !== "home") return p.where === "shelter" ? "避難所" : f.plan?.destination ? PLACE_WORDS[f.plan.destination] : "避難先";
  // 赤の「家にいない」だけ（T158）。避難所でないとは言えないので、そう書かない
  if (p.loose) return "家にいない（どこにいるかは前に言った所のまま。新しい所を作らない）";
  return WHERE_WORDS[p.where];
}

const GO_WHY_WORDS: Readonly<Record<GoWhy, string>> = {
  plan: "計画に移る手段が無いか避難先が無い",
  blocked: "道が通れないか家の辺りが水につかっている",
  helper: "動けないので、手伝う人か乗り物が来るまで移れない",
};

/**
 * 通れない訳の言葉（T174）。前は「道か水か」の二択の文を渡していて、土砂の人の家族が水を訳に挙げた。事実の方だけを書く。名前の無い時は二択の文のまま
 */
function blockedWords(f: Pick<Facts, "blockedBy">): string {
  const b = f.blockedBy;
  if (!b || (b.roads.length === 0 && !b.flooded)) return GO_WHY_WORDS.blocked;
  return [b.roads.length > 0 ? `${b.roads.join("・")}が通行止` : null, b.flooded ? "家の辺りが水につかっている" : null].filter(Boolean).join("で、");
}

/**
 * 「どこにいますか」のコードの答え（T177。記録から。名前を書かない）。記録が無い・家にいないだけで行き先の分からない連絡は null（本人役が答える）
 */
export function placeReplyOf(f: Pick<Facts, "place" | "plan" | "moving">): string | null {
  if (f.moving) return "今、向かっている途中です。";
  const p = f.place;
  if (!p || p.loose) return null;
  if (p.by === "wandering") return "どこにいるか分かりません。";
  if (p.where === "home") return "家にいます。";
  if (p.where === "shelter") return "避難所にいます。";
  return f.plan?.destination === "hospital" ? "病院にいます。" : "避難先にいます。";
}

/** 残りの時間の言い方（T141。コードが決める数。10 分・30 分・1 時間に丸める） */
export function remainWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `約 ${Math.max(10, Math.round(m / 10) * 10)} 分`;
  if (m < 180) {
    const half = Math.round(m / 30) * 30;
    const h = Math.floor(half / 60);
    return half % 60 === 0 ? `約 ${h} 時間` : `約 ${h} 時間半`;
  }
  return `約 ${Math.round(m / 60)} 時間`;
}

/**
 * 電池の残りを言う数（分。T141）。替える前は内蔵の残り、替えたあとは予備の残り。電池で動いていない（電気が戻った・止まった）なら null。
 * 本人役の言う数はこれのまま（ほかの数を言わない）。食い違う数は門が直す
 */
export function sayMinutes(d: DeviceNow): number | null {
  const r = d.remain;
  if (!r || (r.total === 0 && r.internal === 0)) return null;
  if (r.internal !== null && r.internal > 0) return r.internal;
  return r.spare !== null && r.spare > 0 ? r.spare : null;
}

/** 言ってよい残りの数（分。T141）。内蔵・予備・合わせた残りのどれか */
export function remainChoices(d: DeviceNow): number[] {
  const r = d.remain;
  if (!r) return [];
  return [r.internal, r.spare, r.total].filter((x): x is number => x !== null && x > 0);
}

/** 止まった機器の文の決まり（T174。前は予備の無い人の文にしか無く、予備が切れた人の家族が落ち着いた連絡を続けた） */
const DOWN_WORDS = "止まっている間は緑（無事）を押さない。連絡は赤で、落ち着いたままとは言わない。する事・様子も、機器が止まった事が分かる言い方に。機器と電源の事実だけを言い、体の具合の重さは言わない";

/**
 * 帳面の時刻の言い方（T177）。時計が分かれば「16 時ごろ（3 時間前）」。今より後は「（あと 2 時間）」。今は「（今）」。
 * 評価の 10 回目で、帳面の経過の数を本人役が時計の時刻として言った（同じ人の連絡の中でも形が変わった）
 */
export function whenWordsOf(f: Pick<Facts, "startHour" | "now">): (minute: number) => string {
  const start = f.startHour;
  if (typeof start !== "number") return minuteText;
  return (m) => {
    const gap = f.now - m;
    return `${clockWhen(m, start, f.now)}（${gap === 0 ? "今" : gap > 0 ? `${minuteText(gap)}前` : `あと ${minuteText(-gap)}`}）`;
  };
}

/** 切れた時刻の言い方の決まり（T177） */
const cutSay = (f: Pick<Facts, "startHour">): string =>
  typeof f.startHour === "number" ? "言う時は書いた時計の時刻か「N 時間前」のどちらかで。ほかの時刻を作らない" : "言う時は切れた時刻も添える";

/**
 * 帳面の文（Claude に渡す前。呼ぶ側が仮名化の門を通す）。言った事は決まった印の言い方だけ（本人役の言葉そのものは書かない）
 */
export function factLines(f: Facts): string[] {
  const out: string[] = [];
  const where = placeWords(f);
  // 時刻の言い方（T177）。時計が分かれば「16 時ごろ（3 時間前）」、分からなければ経過の数のまま
  const at = whenWordsOf(f);
  if (f.place && where) {
    out.push(
      f.place.by === "wandering"
        ? `いる所: ${where}（${at(f.place.at)}${PLACE_BY_WORDS.wandering}。まだ見つかっていない。家にいるとは言わない）`
        : `いる所: ${where}（${at(f.place.at)}${PLACE_BY_WORDS[f.place.by ?? "turn"]}）${f.plan?.immobile && f.place.where === "home" ? "。ふだん自分で動けないので、手伝う人か乗り物が来るまで家にいる（家の外にいるとは言わない）" : ""}`,
    );
  }
  if (f.rideAfter !== undefined) out.push(`移送の車: ${at(f.rideAfter)}に来たが、もう${f.plan?.destination === "shelter" || !f.plan ? "避難所" : "移った先"}にいるので乗らない（「迎えの車で着いた」と言わない）`);
  if (f.going && f.place?.by !== "plan" && f.place?.by !== "transport") {
    out.push(
      f.going.can
        ? `移動: ${at(f.going.at)}に避難先へ向かうと言った（計画の手段で ${at(f.going.at + GO_MINUTES)}ごろ着く）`
        : `移動: ${at(f.going.at)}に避難先へ向かうと言ったが、${f.going.why === "blocked" ? blockedWords(f) : GO_WHY_WORDS[f.going.why ?? "plan"]}（まだ家。向かえていない理由を言う）`,
    );
  }
  // 移れるかはコードの記録で決まる（T177。本人役の言葉では移らない）
  const atHome = (f.place?.where ?? "home") === "home";
  if (f.plan?.destination && atHome && !f.moving && !f.going && !f.plan.stayHome) {
    out.push(
      canLeaveHome(f)
        ? `移動: 計画の手段で移れる。移るなら「これから移ります」と言う（着くのは ${GO_MINUTES / 60} 時間後で、コードの記録に入る。まだ「移りました」と言わない）`
        : `移動: 今は移れない（${f.blocked ? blockedWords(f) : "手伝う人か乗り物が来ていない"}）。「移ります」「移りました」と言わない。移る手だてを頼むのはよい`,
    );
  }
  // 通れない訳（T174）。言うならこの訳だけ。水につかっていないのに水と言わない
  if (f.blocked && f.blockedBy && (f.blockedBy.roads.length > 0 || f.blockedBy.flooded)) out.push(`家の辺りの道: ${blockedWords(f)}。通れない訳を言うならこれだけ${f.dryRoad ? "（水につかっていない。水のせいと言わない）" : ""}`);
  else if (f.dryRoad) out.push("家の辺りの道: 通れる。水につかっていない（水のせいと言わない）");
  if (f.withPerson) out.push(`そばの人: ${f.withPerson.by === "family" ? "家族" : "支援者"}が本人の所にいる・見たと伝えた（${at(f.withPerson.at)}）。様子が分からないとは言わない`);
  if (f.hurt) {
    const what = [f.hurt.canMove === false ? "動けない" : null, f.hurt.injured === true ? "けが" : null].filter(Boolean).join("・");
    out.push(`前に言った事: ${what}（${at(f.hurt.at)}）。${f.help ? `そのあと ${f.help.what}が来た（${at(f.help.at)}）` : "そのあと誰も来ていない・手も届いていない"}`);
  }
  out.push(`来た人・届いた物: ${f.got.length > 0 ? f.got.map((h) => `${h.what}（${at(h.at)}）`).join("、") : "まだ無い"}`);
  for (const p of f.promised ?? []) {
    out.push(`前に言った予定（まだ済んでいない）: ${INTENT_WORDS[p.kind]}（${at(p.at)}に言った）。済んだなら結果を、できないなら訳を言う。同じ予定を新しく言い直さない`);
  }
  if (f.voiceLost) out.push(`本人の声: 家族・支援者が「声が無い・返事が無い」と伝えた（${at(f.voiceLost.at)}）。人が来るまで本人は話さない`);
  if (f.told.length > 0) {
    out.push(`ケアマネに言われた事（覚えて従う。従えない時は理由を言う）: ${f.told.map((t) => `${at(t.at)}「${t.words}」`).join("、")}`);
  }
  if (f.together.length > 0) out.push(`同居の人（もう家にいる。あとから「来た」と言わない）: ${f.together.join("・")}`);
  if (f.power.outage === "on") out.push(`電気: 停電中（${at(f.power.since ?? 0)}から）${f.power.supplied !== null ? `。電源が届いた（${at(f.power.supplied)}）` : ""}`);
  else if (f.power.outage === "restored") out.push(`電気: 戻った（${at(f.power.restoredAt ?? 0)}）。電池・電源を頼まない`);
  for (const d of f.devices) {
    // 電気が戻った・電源が届いた（T141）。停電の間に切れた事は済んだ事で、今は電気で動いている
    if (typeof d.backAt === "number") {
      const how = f.power.restoredAt === d.backAt ? "停電が戻り、今は電気で動いている" : "電源が届き、今は届いた電源で動いている（停電は続いている。電気が戻ったとは言わない）";
      out.push(
        `${d.label}: ${at(d.backAt)}に${how}${d.outAt !== null ? `（停電の間に内蔵の電池が ${at(d.outAt)}に切れた${d.spare ? "。予備に替えた" : ""}。済んだ事で、今は切れていない・止まっていない。「切れた」と言わない）` : ""}`,
      );
      continue;
    }
    const say = sayMinutes(d);
    if (d.outAt === null && typeof d.dueAt === "number") {
      const r = d.remain;
      const s = f.plan?.spares.find((x) => x.category === d.category) ?? null;
      out.push(
        `${d.label}: 停電で内蔵の電池で動いている。残り ${minuteText(d.dueAt - f.now)}（${at(d.dueAt)}ごろ切れる）${s ? `。切れたら${s.label}に替える${r?.total != null ? `（合わせた残り ${minuteText(r.total)}${s.assumed ? "、見込み" : ""}）` : "（予備の時間は分からない）"}` : "。予備は無い"}`,
      );
    }
    if (d.outAt !== null) {
      if (d.spare) {
        const spareOut = d.spare.outAt !== null && d.spare.outAt <= f.now;
        out.push(
          `${d.label}: ${at(d.outAt)}に切れ、計画どおり${d.spare.label}に替えた（替えたのは ${d.spare.by}。残りを言う時は「予備に替えた」と添える）${spareOut ? `。予備も ${at(d.spare.outAt!)}に切れた（${cutSay(f)}）${d.down ? `。${DOWN_WORDS}` : ""}` : d.spare.outAt !== null ? `。予備の残り ${minuteText(d.spare.outAt - f.now)}${d.spare.assumed ? "（見込み）" : ""}（${at(d.spare.outAt)}ごろ切れる。それより長く使えるとは言わない）` : "。予備の残りは分からない"}`,
        );
      } else if (d.down) {
        out.push(`${d.label}: ${at(d.outAt)}に切れた（${cutSay(f)}）。予備は無く、電源が届くか停電が戻るまで戻らない（${DOWN_WORDS}）`);
      }
      // 一度起きた事（T141）。前の連絡より前に切れた物は、新しい事のように言わない
      if (d.known) out.push(`${d.label}が切れたのは前の連絡より前（もう起きた事）。新しい事のように「切れました」と言わない。言うなら「切れたまま」`);
    }
    // 言う数（T141）。残りを言う時はこの数のまま（ほかの数・時刻を作らない）
    if (say !== null) out.push(`${d.label}の残りを言う時の数: あと${remainWords(say)}${d.outAt !== null && d.spare ? "（予備の残り。「予備の〜があと〜」と予備と分かる言い方で）" : ""}。この数のまま言い、ほかの数を言わない`);
  }
  return out;
}

/**
 * 機器が止まったまま家にいるか（T174）。停電で減る機器に予備も電気も無く、家の外へ移っていない。移った先は別の電源があるので見ない。
 * この間の連絡は赤（無事じゃない）で、緑の連絡を使わない（lib/drill/persona.ts の personaTurns。色の入力をコードが決める）
 */
export const stuckDown = (f: Pick<Facts, "devices" | "place">): boolean => f.devices.some((d) => d.down) && (f.place?.where ?? "home") === "home";

/** 機器が止まったままの連絡のコードの言葉（T174。本人役が連絡しなかった時と、言葉が門で全部落ちた時）。名前・体の具合を書かない。前の言葉と同じ物を避ける */
export const DOWN_SAYINGS = ["機械が止まったままです。電源がありません。", "電源が無いままです。機械は止まっています。", "機械は動かないままです。電源が要ります。"] as const;
export const downSaying = (prev: string | null | undefined, now: number): string => {
  const start = Math.abs(Math.trunc(now)) % DOWN_SAYINGS.length;
  for (let i = 0; i < DOWN_SAYINGS.length; i++) {
    const x = DOWN_SAYINGS[(start + i) % DOWN_SAYINGS.length];
    if (x !== prev) return x;
  }
  return DOWN_SAYINGS[start];
};

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
  "unknown_while_with", // 家族・支援者が本人の所にいると伝えたあとに「様子が分からない」（T139）
  "supply_without_hand", // 手も表の行も計画も無い業者の巡回・届く物
  "repeat_kind", // 同じ種類の出来事を訓練の中で何度も
  "repeat_text", // 同じ言い回しの出来事を別の人に
  "reason_medical", // 結末の理由に医療の言い方
  "out_after_power", // 電気が戻った・電源が届いたあとに電池が切れた・止まったと言う（T141）
  "old_news", // 前の連絡より前に切れた電池を新しい事のように言う（「切れたまま」に直した。T141）
  "remain_mismatch", // 電池・予備の残りの数が帳面と食い違う（コードの数に直した・落とした。T141）
  "spare_unsaid", // 予備で動いているのに、残りの数を「予備」と言わない（「予備の」を足した。T158）
  "left_remain", // 家に置いてきた栄養剤の残りの時間を言う（手元に無い。T158）
  "repeat_said", // 前の連絡・同じ通話の前の返事とほぼ同じ文（落とした。T158）
  "repeat_intent", // 前に言って済んでいない予定（119 へ掛ける・取りに行く）を新しい事のように言い直す（落とした。T165）
  "swap_news", // 前の連絡より前に予備に替えた事を、また替えたと言う（落とした。T165）
  "backstage", // 訓練の裏側の言葉（問いの途中・この訓練・演じる。落とした。T165）
  "power_said", // 停電の戻りと家の電気の食い違い（届いた電源を「電気が戻った」と言う〔直した〕・戻ったあとに「まだ停電」と言う〔落とした〕。T167）
  "road_said", // 道の開通と言葉の食い違い（閉じているのに通れた・開いたのに通れない・土砂の人が水を訳に挙げる。落とした。T174）
  "clock_said", // 機器の切れた時刻の言葉が帳面の時計と食い違う（帳面の時刻に直した。T177）
  "move_said", // 記録に無い移動の言葉（移れない人の「移ります」・来ていない移送の車。落とした。T177）
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
/**
 * 家にいる言い方。T158 で「家で付き添っています」「家には母と私の二人です」「家で一緒にいます」を足した（評価の 6 回目で、避難所にいると
 * 帳面にある人の通話で、この言い方が門を抜けた）
 */
const HOME_STAY =
  /(?:家|自宅|うち)で(?:過ご(?!せ)|休ん|休み|待っ|待ち|待つ|寝て|様子を見|付き添|つきそ|横にな|横たわ|寝たまま|座っ|座り|話せ|話し(?!合)|動け|落ち着|元気|いつも|普段|変わり|受け答|答え)|(?:家|自宅|うち)で(?![はもの])[^。、]{0,14}?(?:できる|でき(?:ています|ます)|います|ている|ます)[。！!]?$|(?:家|自宅|うち)に(?:い|居)(?:ます|る|て)|家から出ていない|家に残っ|(?:家|自宅|うち)に(?:は)?[^。、置]{0,8}?(?:二人|ふたり|三人)(?:です|でい|だけ|きり)|(?:家|自宅|うち)(?:に|で)(?:は)?一緒に(?:い|居)/;
/**
 * 病院へ移った・病院にいる言い方（T167。家にいる人は言わない）。評価の 8 回目で、ふだん動けない人の家族が手も人も無いまま病院へ移ったと言い、
 * 帳面は家のままで、次の連絡では家で業者を迎えた。これから移る言い方（「移ろうと思います」）は見ない
 */
const AT_HOSPITAL = /病院(?:に|へ)(?:着(?!け)|移(?:りました|れました|った|動しました)|入(?:りました|院)|(?:い|居)(?:ます|る))|入院(?:しました|しています|中)/;
/** 電気が戻った言い方（T167。届いた電源で動いている家は、停電が戻ったのではない）。直すのは sentenceFix */
const GRID_BACK = /(?:電気|停電)(?:が|は|も)?(?:戻り|戻っ|復旧し|回復し|直り|直っ)(?:ました|た(?!ら)|て(?:い|き))[^。！？!?]*/u;
/** 停電が続いている言い方（T167。停電が戻ったあとは言わない。「停電の間に」のような済んだ話は見ない） */
const STILL_OUT = /まだ停電|停電(?:が|は)?(?:まだ|今も)?(?:続い|続き|のまま)|停電中(?:です|で)/u;
/**
 * 避難所にいる言い方。T158 で「避難所へ移ります」「避難所にいきます」（これから向かう）を外した（向かう言い方は GO_SHELTER）。
 * 前は向かうと言っただけで「避難所にいる」と見て、家にいる人の「避難所へ移ります」を落としていた
 */
const AT_SHELTER =
  /避難所(?:に|へ)(?:着(?!け)|い(?!ない|ません|け|か|き|こ)|居(?!ない|ません)|来(?!られ|れ)|移(?!れ|り(?:ます|たい|ましょ)|ろう|る))|避難所で(?:過ご(?!せ)|休|待)/;
/** 移る先の言葉（T177） */
const MOVE_PLACE = "(?:福祉避難所|避難所|避難先|病院|集会所|公民館|学校|高台|施設|親戚の家)";
/**
 * これから移る言い方（T177）。評価の 10 回目で「計画どおり避難所へ行きます」「母を避難所へ車で移します」「兄を車で避難所へ送ります」と言ったあと、移す手も無いまま手伝いを待った。
 * 記録に無い移動の言葉は門で落とす（移れる人の刻みの言葉は記録になる）。「行きたい」「移れますか」「移してほしい」のような頼み事は見ない
 */
const MOVE_FUTURE = new RegExp(
  `${MOVE_PLACE}(?:へ|に|まで)${GO_GAP}(?:向かいます|向かう(?!か)|向かおう|行きます|行く(?!か|の|ん|べ)|行こう|いきます|移ります|移る(?!か|の|ん|手|先|所|人|段|方)|移ろう|移します|移す(?!か|の|ん|手|段|方)|移動します|移動する(?!か|の|手)|送ります|送る(?!か|の)|連れて行きます|連れていきます)|避難(?:します|しよう)`,
  "u",
);
/** 移ったと言う言い方のうち AT_SHELTER・AT_HOSPITAL の外の物（T177。家にいる人は言わない） */
const MOVED_SAID = new RegExp(`${MOVE_PLACE}(?:に|へ)(?:着きました|着いた|移りました|移った|移れました|入りました|来たよ|来ました)|家から移っ|移送の車で[^。、]{0,8}?移(?:りました|った)`, "u");
/** 移送の車が来た言い方（T177。来ていない車を来たと言わない。「来たら」「来ません」は見ない） */
const RIDE_CAME = /(?:移送|迎え)の車(?:が|は|も)?(?:今|さっき|やっと)?(?:来|着)(?:ました|た(?!ら)|いた(?!ら)|きました)/u;

/** 避難所へこれから向かう言い方（T158。もう避難所にいる人は言わない） */
const GO_SHELTER = new RegExp(
  `避難所(?:へ|に)${GO_GAP}(?:向か(?!え|いまし|った|って)|行き(?:ます|たい)|行く|行こう|いきます|移り(?:ます|たい|ましょ)|移る|移ろう|移動し(?:ます|たい))`,
  "u",
);
/** 避難所にいない言い方（T158。避難所にいる人は言わない） */
const NOT_AT_SHELTER = /避難所では(?:ない|ありません|なく)|避難所に(?:は)?(?:い(?:ない|ません)|着いてい(?:ない|ません)|移れてい(?:ない|ません))/;
/** 家に物を置いてきた言い方（T158。家の外にいる。家にいる人は言わない） */
const LEFT_HOME = /(?:家|自宅|うち)に(?:置いて|おいて)(?:き|来)/;
const RETURNED = /帰宅|(?:家|自宅|うち)に戻|帰って(?:き|来)|戻ってき/;

/**
 * 文が言ういる所（T158。本人役の門と台の検査が同じに見る）。shelter 避難所にいる・home 家にいる・going 避難所へ向かう・left 家に物を置いてきた
 * （家の外）。家に戻った言い方の文は home。どれでもなければ null
 */
export type PlaceSaid = "shelter" | "home" | "going" | "left";
export function placeSaid(text: string): PlaceSaid | null {
  const t = text.normalize("NFKC");
  if (RETURNED.test(t)) return "home";
  if (AT_SHELTER.test(t)) return "shelter";
  if (LEFT_HOME.test(t)) return "left";
  if (HOME_STAY.test(t)) return "home";
  // 向かうか迷っている・行きたいが行けない言い方は向かうと言った事にしない
  if (GO_SHELTER.test(t) && !GO_NOT.test(t)) return "going";
  return null;
}
const ARRIVED_VERB = "(?:が|も)(?:今|さっき|やっと|ようやく)?(?:来|帰って|帰宅|戻って|駆けつけ|着い|到着)";
/** 家族の続柄の主語の形（「娘が」「息子さんも」） */
const KIN_WORDS = ["夫", "妻", "娘", "息子", "長男", "長女", "次男", "次女", "孫", "嫁", "婿", "甥", "姪", "弟", "妹", "兄", "姉"] as const;
/** 予備に替えた言い方（計画に予備の無い人は言わない。「替えられない」は見ない） */
const SWAP = /予備(?:の)?(?:電池|バッテリー|ボンベ)?(?:に|へ|を)(?:替え|換え|交換|切り替え|つない|使)(?!られ|ない|ません|ず)|(?:電池|バッテリー|ボンベ)を(?:替え|換え|交換|取り替え)(?!られ|ない|ません|ず)/;
/**
 * 切れた電池が戻った・まだ動いている言い方（止まった機器のまま言わない。「充電できない」は見ない）。T139 で「予備（の電池）でまだ続けている」を足した
 * （評価の 4 回目で、予備が切れているはずの時刻にも予備で使えていると言い続けた）
 */
const BATTERY_BACK =
  /充電(?:でき(?!ない|ません|ず)|した|して(?!い?ない|いません))|(?:電池|バッテリー)が(?:戻(?!らな|りませ)|回復|復活|もっ|持っ|まだ(?:ある|あり|もつ|持つ|残))|予備(?:の(?:電池|バッテリー|ボンベ))?で(?:まだ|今も|なんとか)?(?:もっ|持っ|続け|動い|使え|動か)(?!な|ませ|ず)/;
const ASK_POWER = /(?:電池|電源|バッテリー|充電|発電機)[^。]{0,14}(?:ほしい|欲しい|お願い|頼|届け|足りな|持って(?:き|来)|来て|ください|ないか|ありません)/;
/** 落ち着いたままの言い方（「大丈夫じゃない」「落ち着いていません」「問題なのは」は見ない） */
const CALM =
  /落ち着い(?!て(?:い)?(?:ない|ません|られ))|穏やか(?!で(?:は)?(?:ない|ありません)|じゃ)|いつも通り(?!で(?:は)?(?:ない|ありません)|じゃ)|普段通り(?!で(?:は)?(?:ない|ありません)|じゃ)|変わりな|問題な(?=い|く|し)|安定し(?!て(?:い)?(?:ない|ません))|大丈夫(?!(?:です|でしょう)?か|じゃ|では|で(?:は)?(?:ない|ありません)|そうじゃ)|無事(?!(?:です|でしょう)?か|じゃ|では|で(?:は)?(?:ない|ありません))/;

/** 様子が分からない言い方（T139。そばにいると伝えたあとは言わない） */
const UNKNOWN_STATE = /様子が(?:分から|わから)|(?:安否|状況)が(?:分から|わから)|(?:連絡|電話)が(?:つかな|取れな|とれな)|見に行け(?:て)?(?:い)?(?:ない|ません)/;
/** 家の外（道・屋外）で動けない言い方（T139。避難所にいる人は言わない） */
const OUTSIDE_STUCK = /(?:外|道|屋外|家の外|路上)で(?:動けな|倒れ|転|立てな)|外に出(?:て|た)(?:ら|まま)?(?:動けな|倒れ|転)/;

/** 道が通れた言い方（T174。「通れるか」「通れる道」は見ない） */
const ROAD_OPEN_SAID = /(?:道|道路|橋|トンネル)(?:が|は|も)?[^。、]{0,6}?(?:通れるように|通った|通りました|通れま(?!せん)|通れる(?![かよ道])|開通|片付|再開|通行可)/u;
/** 道が通れない言い方（T174。「通れなかった」のような済んだ話は見ない） */
const ROAD_SHUT_SAID = /(?:道|道路|橋|トンネル)(?:が|は|も)?[^。、]{0,8}?(?:通れ(?:ない|ません|なく|ず)|ふさが|塞が|通行止|封鎖)/u;
/** 家の辺りが水につかった言い方（T174。「水が出ない」「水が来たら」は見ない） */
const WATER_SAID = /(?:家|辺り|周り|近く|道|外|足元)[^。、]{0,6}?(?:水につ|水が(?:来(?:て|ま)|つい|上が(?:って|り)|入(?:って|り)|引(?:か|く|い))|水で|浸水|冠水)|水が引(?:く|い)/u;

/** 道の開通と言葉の食い違い（T174。本人役の門と、遅れて当たった監督の出来事のあとの engine の門が同じに見る） */
export function roadSlip(t: string, ctx: Pick<SlipContext, "roadClosed" | "dryRoad">): boolean {
  if (ctx.roadClosed === true && ROAD_OPEN_SAID.test(t)) return true;
  if (ctx.roadClosed === false && ROAD_SHUT_SAID.test(t)) return true;
  return ctx.dryRoad === true && WATER_SAID.test(t);
}

/**
 * 遅れて当たった監督の道の出来事に、同じ区切りの本人役の言葉を合わせる（T174。評価の 9 回目で、本人役が「道が通れない」と言った同じ分に、並べて呼んだ監督の
 * 開通が当たった）。合わない文だけ落とす。色と 4 問は変えない。plan が無いので閉じているかは道と印だけで見る
 */
export function dropRoadSlips(text: string | null, world: WorldState, person: string, onDrop?: (rule: GateRule) => void): string | null {
  if (!text) return text;
  const roadClosed = placeBlocked(world, person, null);
  const kept = text.split(/(?<=[。！？!?])/u).filter((s) => {
    if (!roadSlip(s.normalize("NFKC"), { roadClosed })) return true;
    onDrop?.("road_said");
    return false;
  });
  return kept.join("").trim() || null;
}

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
  /** 家族・支援者が本人の所にいる・見たと伝えた間（T139） */
  withPerson?: boolean;
  /**
   * 電池・予備の残りで言ってよい数（分。内蔵・予備・合わせた残り。T141）。無ければ数を見ない。空の配列は電池で動いていない
   * （電気が戻った・止まった。残りの数を言わない）
   */
  remains?: ReadonlyArray<number> | null;
  /** 言う数（分。T141）。食い違う数はこの数に直す。null なら直さず、その文を使わない */
  say?: number | null;
  /** 前の連絡より前に切れた電池がある（新しい事のように言わない。T141） */
  oldOut?: boolean;
  /**
   * 内蔵の電池が切れて予備に替えたあとで、予備で動いている（T158）。残りの数を言う文に「予備」が無ければ足す
   * （評価の 6 回目で、1 時に「3 時間」、6 時に予備の残りの「50 分」と言い、替えたことが言葉に無いので数が食い違って見えた）
   */
  onSpare?: boolean;
  /** 栄養剤を家に置いてきた（世界の印。T158）。手元に無いので残りの時間を言わない */
  leftBehind?: boolean;
  /** 帳面のいる所が前から避難所（T158）。「避難所に着きました」を新しい事のように言わない */
  shelterBefore?: boolean;
  /** 前の連絡までに言って済んでいない予定（T165）。同じ予定の言い直しを落とす */
  promised?: ReadonlyArray<IntentKind>;
  /** 前の連絡より前に予備に替えた機器がある（T165）。「予備に替えました」を新しい事のように言わない */
  swappedBefore?: boolean;
  /** 停電は続いていて、この家には電源が届いた（T167）。「電気が戻りました」を「届いた電源で」に直す */
  suppliedOnly?: boolean;
  /** この家の停電は戻った（T167）。「まだ停電」と言わない */
  outageRestored?: boolean;
  /** 家の辺りの道が閉じている（T174）。true は「通れた」と言わない、false は「通れない」と言わない。無ければ見ない */
  roadClosed?: boolean;
  /** 土砂の人で家の辺りは水につかっていない（T174）。水を訳に挙げない */
  dryRoad?: boolean;
  /** 記録に無い移動を言わない（T177）。家にいて、向かっている途中でなく、この言葉で移り始められない。無ければ見ない */
  noMove?: boolean;
  /** 前の連絡のあとに移送の車が着いたか（T177）。false は「移送の車が来ました」と言わない。無ければ見ない */
  rideCame?: boolean;
  /** 機器の切れた時刻（発災からの分。T177）と発災の時刻・今。あれば切れた時刻の言葉を時計で見る */
  cutClock?: { startHour: number; now: number; cuts: ReadonlyArray<{ minute: number; spare: boolean }> };
};

/** 予備に替えたあと、予備で動いている機器か（T158） */
export const onSpareNow =
  (now: number) =>
  (d: DeviceNow): boolean =>
    d.outAt !== null && d.spare !== null && (d.backAt ?? null) === null && (d.spare.outAt === null || d.spare.outAt > now);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const relOf = (role: string) => role.replace(/[ 　]*\d+$/u, "").trim();

/** 切れた時刻（T177）。電気が戻った機器の切れた時刻も、済んだ話として言うので入れる。時計か切れた時刻が無ければ見ない */
function cutClockOf(f: Facts): Pick<SlipContext, "cutClock"> {
  if (typeof f.startHour !== "number") return {};
  const cuts = f.devices.flatMap((d) => [
    ...(d.outAt !== null ? [{ minute: d.outAt, spare: false }] : []),
    ...(d.spare && d.spare.outAt !== null && d.spare.outAt <= f.now ? [{ minute: d.spare.outAt, spare: true }] : []),
  ]);
  return cuts.length > 0 ? { cutClock: { startHour: f.startHour, now: f.now, cuts } } : {};
}

/**
 * 通話・訪問の言葉の文脈（T177）。移り始める記録は刻みの連絡だけが持つので、通話では向かっている途中でなければ「移ります」と言わない
 * （評価の 10 回目で、通話で移ると言ったあと移らないまま手伝いを待った）
 */
export function talkContextOf(f: Facts, place: WhereNow | null = f.place?.where ?? null): SlipContext {
  return { ...slipContextOf(f, place), ...(f.plan && (place ?? "home") === "home" && !f.moving ? { noMove: true } : {}) };
}

export function slipContextOf(f: Facts, place: WhereNow | null = f.place?.where ?? null): SlipContext {
  const plan = f.plan;
  return {
    place,
    together: f.together,
    kin: f.kin,
    powerBack: powerBack(f),
    noSpare: !!plan && plan.devices.length > 0 && plan.spares.length === 0 && !plan.power,
    down: f.devices.some((d) => d.down),
    withPerson: f.withPerson !== null,
    onSpare: f.devices.some(onSpareNow(f.now)),
    leftBehind: (f.left ?? null) !== null,
    // 移送・計画の手段で移ったあと、もう連絡した人も（T177。記録のいる所は by を変えないので、前の連絡の時刻で見る）
    shelterBefore: f.place?.where === "shelter" && ((f.place.by ?? "turn") === "turn" || (f.prevAt ?? -1) >= f.place.at),
    promised: (f.promised ?? []).map((p) => p.kind),
    swappedBefore: f.devices.some((d) => d.outAt !== null && d.spare !== null && d.backAt === null && d.outAt < (f.prevAt ?? -1)),
    suppliedOnly: f.power.outage === "on" && f.power.supplied !== null,
    outageRestored: f.power.outage === "restored",
    ...(f.blocked !== undefined ? { roadClosed: f.blocked } : {}),
    ...(f.dryRoad ? { dryRoad: true } : {}),
    ...cutClockOf(f),
    ...(plan && (place ?? "home") === "home" && !f.moving && !canLeaveHome(f) ? { noMove: true } : {}),
    rideCame: f.rideNew === true,
    // 電池の残りの数（T141）。停電の区域で停電で減る機器のある人だけ見る
    ...(f.power.outage !== "none" && f.devices.length > 0
      ? { remains: f.devices.flatMap(remainChoices), say: f.devices.map(sayMinutes).find((x) => x !== null) ?? null, oldOut: f.devices.some((d) => d.known === true) }
      : {}),
  };
}

/** 家の外にいる言い方（T141。いる所が家の人は言わない。「家の外に出られない」は見ない） */
const AWAY_TEXT = /(?:家の外|外|屋外)(?:に|で)(?:い|居)(?:ます|る|て(?!は))|家の外へ出(?:た|まし)/;
/** 電池・機器の話（T141。残りの数・切れた言い方を見る文） */
const BATTERY_TOPIC = /電池|バッテリー|予備|充電|ボンベ|呼吸器|濃縮器|吸引器/;
/** 電池でない残りの話（薬・栄養剤・透析など。この文の数は電池の数と見ない） */
const OTHER_TOPIC = /薬|栄養剤|透析|インスリン|水|食べ|ミルク|食事/;
/** 電池・予備が切れた・止まった言い方（電気が戻ったあとは言わない。「切れる前に」「切れそう」は見ない） */
const OUT_WORDS = /(?:電池|バッテリー|予備|ボンベ)(?:も|が|は)?[^。]{0,8}?(?:切れ(?!る前|そう|かけ|たら|れば|ない|ません)|止ま(?!る前|りそう|らない|りません)|尽き)|電池切れ/;
/** 今は電気で動いている言い方（「停電の間に切れたが、今は電気で動いている」は切れたままの話ではない） */
const RUNNING_NOW = /電気(?:が|で)?(?:戻|動|来|つ)|電源(?:が|で)(?:届|動|つな)/;
/** 切れた事を新しい事のように言う言い方（T141。「切れたまま」に直す） */
const OUT_NEW = /((?:電池|バッテリー|予備|ボンベ)(?:も|が|は)?[^。、]{0,6}?)切れ(?:ました|てしまいました|ちゃいました)/u;
/** 予備のことを言っている言い方（T158。「電池に切り替わった」は内蔵の電池なので見ない） */
const SPARE_SAID = /予備|替え|換え|交換|(?:に|へ)(?:かえ|変え)/;

/**
 * 言葉の全体で見る物を文ごとの見方に移す（T158）。同じ言葉のどこかで予備に替えたと言っていれば、残りの数の文に「予備」を足さない
 * （「予備のボンベに替えました。あと 3 時間です」）
 */
export function wholeContext(text: string, ctx: SlipContext): SlipContext {
  return ctx.onSpare && SPARE_SAID.test(text.normalize("NFKC")) ? { ...ctx, onSpare: false } : ctx;
}
/** 「予備の」を前に足す電池の言葉（T158） */
const SPARE_WORD = /(電池|バッテリー|ボンベ)/u;
/** 前に言った「避難所に着いた」（T158。「避難所にいます」に直す） */
const ARRIVE_NEWS = /避難所(?:に|へ)(?:着きました|移りました|移動しました|移れました)/u;
/** 家に置いてきた物の話（T158。栄養剤の持ち出し忘れの印） */
const LEFT_SUPPLY = /栄養剤|経管|栄養/;
/** 残りの時間の数（「あと 3 時間」「残りは 50 分」「3 時間しかもたない」）。NUM は数字か漢数字 */
const NUM = "(?:\\d+(?:\\.\\d+)?|[一二三四五六七八九十]+)";
const AMOUNT = `(?:約|およそ)?\\s*${NUM}\\s*(?:時間|分)半?`;
const REMAIN_RE = new RegExp(`(?:あと|残り(?:は|が)?|もう)\\s*(${AMOUNT})|(${AMOUNT})(?:ほど|くらい|ぐらい|程度)?(?:しか|で|は)?(?:もち|持ち|もた|持た|切れ|なくな|無くな|使え)`, "u");
const KANJI_NUM: Readonly<Record<string, number>> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 数の字（「3」「2.5」「十二」） → 数 */
function numOf(s: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
    } else if (KANJI_NUM[ch] !== undefined) cur = KANJI_NUM[ch];
    else return null;
  }
  return total + cur;
}

/** 残りの時間の字（「約 3 時間半」） → 分 */
export function amountMinutes(s: string): number | null {
  const m = s.match(new RegExp(`(${NUM})\\s*(時間|分)(半)?`, "u"));
  if (!m) return null;
  const n = numOf(m[1]);
  if (n === null) return null;
  return m[2] === "時間" ? Math.round(n * 60 + (m[3] ? 30 : 0)) : Math.round(n);
}

/** 言った残りの数が帳面のどれかに近いか（20 分か 4 分の 1 の幅） */
const remainFits = (said: number, choices: ReadonlyArray<number>): boolean => choices.some((r) => Math.abs(said - r) <= Math.max(20, r * 0.25));

/**
 * 1 文の残りの数を帳面で見る（T141）。電池の話の文（前の文が電池の話で、この文がほかの話でない時も）の「あと N 時間」が、帳面の内蔵・予備・
 * 合わせた残りのどれとも合わなければ、コードの数（say）に直す。say が無い（電池で動いていない）なら文を使わない（null）。合えばそのまま
 */
function remainFix(t: string, ctx: SlipContext, battery: boolean): { text: string | null; hit: boolean } {
  if (!ctx.remains || !battery) return { text: t, hit: false };
  const m = t.match(REMAIN_RE);
  if (!m) return { text: t, hit: false };
  const phrase = m[1] ?? m[2];
  const said = phrase ? amountMinutes(phrase) : null;
  if (said === null || remainFits(said, ctx.remains)) return { text: t, hit: false };
  if (ctx.say == null) return { text: null, hit: true };
  return { text: t.replace(phrase!, remainWords(ctx.say)), hit: true };
}

/** 訓練の裏側の言葉（T165。想定の表の「4 問の途中で止まった」は画面の記録の言葉で、本人役が言葉にした） */
// 「訓練」は「避難訓練のとおりに」のように本人が実の意味で言うので、この訓練・訓練の中や役の言い方だけ
export const BACKSTAGE = /質問の途中|問(?:い)?の途中|[0-9一二三四五六]\s?問(?:目|の途中|に答え)|この訓練|訓練の(?:中|外|裏|役)|演じ/u;
/** 予備に替えた事の知らせ（T165。過去の形だけ。「替えたら」は見ない） */
const SWAP_NEWS =
  /予備(?:の)?(?:電池|バッテリー|ボンベ)?(?:に|へ)(?:替え|換え|交換し|切り替え|切り替わり|つなぎ)(?:ました|た(?!ら))|(?:電池|バッテリー|ボンベ)を(?:替え|換え|交換し|取り替え)(?:ました|た(?!ら))/u;

/** 1 文が帳面と食い違うか（食い違う決まりの名前。無ければ null） */
export function sentenceSlip(s: string, ctx: SlipContext): GateRule | null {
  const t = s.normalize("NFKC");
  if (BACKSTAGE.test(t)) return "backstage";
  // 前に言って済んでいない予定の言い直し（T165。済んだ・やめた言い方は落とさない）
  for (const k of ctx.promised ?? []) if (INTENT_FUTURE[k].test(t) && !INTENT_DONE[k].test(t)) return "repeat_intent";
  // 前の連絡より前に替えた予備を、また替えたと言う（T165。残りの数のある文は数を残すので落とさない）
  if (ctx.swappedBefore && SWAP_NEWS.test(t) && !REMAIN_RE.test(t)) return "swap_news";
  if ((ctx.place === "shelter" || ctx.place === "other") && HOME_STAY.test(t) && !RETURNED.test(t)) return "place_text";
  if (ctx.place === "home" && AT_SHELTER.test(t)) return "place_text";
  if (ctx.place === "home" && AT_HOSPITAL.test(t) && !RETURNED.test(t)) return "place_text";
  // 記録に無い移動（T177）。家にいる人の「避難先に移りました」、避難所にいる人の「病院に移りました」、移れない人の「移ります」、来ていない移送の車
  if (ctx.place === "home" && MOVED_SAID.test(t) && !RETURNED.test(t)) return "place_text";
  if (ctx.place === "shelter" && AT_HOSPITAL.test(t) && !RETURNED.test(t)) return "place_text";
  if (ctx.noMove && MOVE_FUTURE.test(t) && !GO_NOT.test(t)) return "move_said";
  if (ctx.rideCame === false && RIDE_CAME.test(t)) return "move_said";
  if (roadSlip(t, ctx)) return "road_said";
  // 停電が戻ったあとに、まだ続いていると言う（T167。世界の停電の復旧と家の電気を食い違わせない）
  if (ctx.outageRestored && STILL_OUT.test(t)) return "power_said";
  // 家にいる人の「家の外にいる」（T141。評価の 5 回目で、ふだん動けない人が家の外にいると言った）
  if (ctx.place === "home" && AWAY_TEXT.test(t) && !RETURNED.test(t)) return "place_text";
  if (ctx.place === "shelter" && OUTSIDE_STUCK.test(t)) return "place_text";
  // もう避難所にいる人の「避難所へ移ります」（T158。評価の 6 回目で、避難所にいると言ったあとに、また移ると言った）
  // 見るのは前の連絡から避難所と分かっている時だけ（この連絡そのものが「避難所へ向かう途中」の緑の避難所は見ない）
  if (ctx.shelterBefore && GO_SHELTER.test(t) && !GO_NOT.test(t) && !RETURNED.test(t)) return "place_text";
  // 避難所にいる人の「避難所ではない・避難所に移れていない」（T158）
  if ((ctx.place === "shelter" || ctx.shelterBefore) && NOT_AT_SHELTER.test(t)) return "place_text";
  // 家に置いてきた栄養剤の残りの時間（T158。手元に無いので数えない）
  if (ctx.leftBehind && LEFT_SUPPLY.test(t) && REMAIN_RE.test(t)) return "left_remain";
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
  // 電気が戻った・電源が届いたあとに電池が切れた・止まったと言う（T141。今は電気で動いていると言う文は見ない）
  if (ctx.powerBack && OUT_WORDS.test(t) && !RUNNING_NOW.test(t)) return "out_after_power";
  if (ctx.noSpare && SWAP.test(t)) return "spare_without_plan";
  if (ctx.down && BATTERY_BACK.test(t)) return "spare_without_plan";
  if (ctx.down && CALM.test(t)) return "calm_while_down";
  if (ctx.withPerson && UNKNOWN_STATE.test(t)) return "unknown_while_with";
  // 残りの数が帳面と合わず、言う数も無い（電池で動いていない。T141）
  if (BATTERY_TOPIC.test(t) && !OTHER_TOPIC.test(t) && remainFix(t, ctx, true).text === null) return "remain_mismatch";
  return null;
}

/** 切れた・止まった話の文（T177。これから切れる話は見ない） */
const CUT_TOPIC = /(?:電池|バッテリー|予備|ボンベ|呼吸器|濃縮器|吸引器|酸素|機械|機器)[^。]*?(?:切れ|止ま)(?!る前|そう|かけ|たら|れば|りそう)/u;
/** 言葉の中の時計の時刻（「午後 4 時」「十一時」。「4 時間」は見ない）。m[1] 数 */
const CLOCK_SAID = /(?:午前|午後|朝|昼|夕方|夜|深夜|未明|明け方)?\s*(\d{1,2}|[一二三四五六七八九十]+)\s*時(?!間)(?:\s*\d{1,2}\s*分|半)?/u;
/** 切れた時刻として言った時計の時刻か（時刻のすぐ後に切れ・止まがある。「業者は 7 時に来ますが、予備が切れました」の時刻は見ない） */
const CLOCK_CUT = new RegExp(`${CLOCK_SAID.source}[^、。]{0,12}?(?:切れ|止ま)`, "u");
/** 言葉の中の「N 時間前」（T177。すぐ後に切れ・止まがある物） */
const AGO_SAID = new RegExp(`(${NUM})\\s*時間(半)?前[^、。]{0,8}?(?:切れ|止ま)`, "u");
const AGO_WORDS = new RegExp(`${NUM}\\s*時間半?前`, "u");
/** 12 時間の時計で見た差（「4 時」は 16 時とも読める。午前・午後の無い話し言葉なので 12 時間の差は比べない） */
const dial = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
};

/**
 * 切れた時刻の言葉を帳面の時計で見る（T177）。評価の 10 回目で形が 3 つ出た: 時計に直して正しい・経過の数をそのまま時刻として言う・計算が違う。
 * 切れた話の文の時計の時刻が帳面の切れた時刻のどれとも 1 時間より離れていれば、帳面の時刻に直す。「N 時間前」も同じ（1 時間か 4 分の 1 の幅）。門と台が同じに見る
 */
function clockFix(t: string, ctx: SlipContext): { text: string; hit: boolean } {
  const c = ctx.cutClock;
  if (!c || c.cuts.length === 0 || !CUT_TOPIC.test(t)) return { text: t, hit: false };
  // 予備の話は予備の切れた時刻とだけ比べる（内蔵の切れた時刻に近いだけの数を通さない）
  const spares = /予備|ボンベ/u.test(t) ? c.cuts.filter((x) => x.spare) : [];
  const cuts = spares.length > 0 ? spares : c.cuts;
  const pick = cuts.at(-1)!;
  const ago = t.match(AGO_SAID);
  if (ago) {
    const said = (numOf(ago[1]) ?? 0) * 60 + (ago[2] ? 30 : 0);
    if (cuts.some((x) => Math.abs(c.now - x.minute - said) <= Math.max(60, (c.now - x.minute) * 0.25))) return { text: t, hit: false };
    return { text: t.replace(AGO_WORDS, `${minuteText(c.now - pick.minute)}前`), hit: true };
  }
  const m = t.match(CLOCK_CUT);
  const said = m ? numOf(m[1]) : null;
  if (!m || said === null) return { text: t, hit: false };
  const fits = cuts.some((x) => {
    const k = clockOfMinute(x.minute, c.startHour);
    return dial(said, k.hour + k.min / 60) <= 1;
  });
  if (fits) return { text: t, hit: false };
  return { text: t.replace(m[0], m[0].replace(CLOCK_SAID, `${clockOfMinute(pick.minute, c.startHour).hour} 時`)), hit: true };
}

/**
 * 1 文を帳面に合わせて直す（T141。落とさずに直せる物だけ）。前の連絡より前に切れた電池の「切れました」は「切れたままです」、
 * 電池の残りの数はコードの数（say）。直した決まりを返す。battery は前の文から続く電池の話か
 */
export function sentenceFix(s: string, ctx: SlipContext, battery = false): { text: string; rules: GateRule[]; drop?: GateRule } {
  let t = s.normalize("NFKC");
  const rules: GateRule[] = [];
  if (ctx.oldOut && !ctx.powerBack && OUT_NEW.test(t)) {
    t = t.replace(OUT_NEW, "$1切れたままです");
    rules.push("old_news");
  }
  // もう避難所にいると前の連絡で言った人の「避難所に着きました」（T158。着いた知らせを 2 度言わない）
  if (ctx.shelterBefore && ARRIVE_NEWS.test(t)) {
    t = t.replace(ARRIVE_NEWS, "避難所にいます");
    rules.push("old_news");
  }
  // 停電は続いていて、届いた電源で動いている（T167。評価の 8 回目で、業者の電源が届いた家が電気が戻ったと言い、世界の復旧の時刻と食い違った）
  if (ctx.suppliedOnly && (GRID_BACK.test(t) || /(?<!届いた)電気で動/u.test(t))) {
    t = t.replace(GRID_BACK, "届いた電源で動いています").replace(/(?<!届いた)電気で動/u, "届いた電源で動");
    rules.push("power_said");
  }
  const clock = clockFix(t, ctx);
  if (clock.hit) {
    t = clock.text;
    rules.push("clock_said");
  }
  const topic = (BATTERY_TOPIC.test(t) || battery) && !OTHER_TOPIC.test(t);
  const r = remainFix(t, ctx, topic);
  if (r.hit && r.text === null) return { text: s, rules, drop: "remain_mismatch" };
  if (r.hit && r.text !== null) {
    t = r.text;
    rules.push("remain_mismatch");
  }
  // 予備で動いているのに残りの数を「予備」と言わない（T158）。電池の言葉の前に「予備の」を、無ければ文の頭に「予備で、」を足す
  if (ctx.onSpare && topic && REMAIN_RE.test(t) && !SPARE_SAID.test(t)) {
    t = SPARE_WORD.test(t) ? t.replace(SPARE_WORD, "予備の$1") : `予備で、${t}`;
    rules.push("spare_unsaid");
  }
  return { text: rules.length > 0 ? t : s, rules };
}

/** 次の文に続く話が電池の話か（T141。この文が電池の話なら続く、ほかの話なら切れる、どちらでもなければ前のまま） */
export function batteryTopicNext(s: string, before: boolean): boolean {
  const n = s.normalize("NFKC");
  return BATTERY_TOPIC.test(n) ? true : OTHER_TOPIC.test(n) ? false : before;
}

/** 文の区切り（句点・感嘆・疑問）。区切りの字は前の文に付ける */
const sentencesOf = (t: string): string[] => t.split(/(?<=[。！？!?])/u).filter((x) => x.trim() !== "");

/**
 * 帳面と食い違う文を落とした言葉（全部落ちれば空文字）。落とした・直した決まりを onDrop に。
 * 直せる物（T141: 一度起きた事・残りの数）は直してから見る。電池の話は次の文にも続くと見る（「電池が切れました。あと 3 時間です」）
 */
export function dropFactSlips(raw: string, ctx0: SlipContext, onDrop?: (rule: GateRule) => void): string {
  if (!raw.trim()) return raw;
  const ctx = wholeContext(raw, ctx0);
  const kept: string[] = [];
  let battery = false;
  for (const s0 of sentencesOf(raw.replace(/\s+/g, " ").trim())) {
    const fixed = sentenceFix(s0, ctx, battery);
    battery = batteryTopicNext(s0, battery);
    const rule = fixed.drop ?? sentenceSlip(fixed.text, ctx);
    for (const r of fixed.rules) onDrop?.(r);
    if (rule) onDrop?.(rule);
    else kept.push(fixed.text);
  }
  return kept.join("");
}

// ---------- 繰り返し（T158） ----------

/** 文の 3 字の並び（空白・句読点・かぎを外す。台の数え tools/eval/drill/talk-check.ts と同じ形） */
export function trigramsOf(text: string): Set<string> {
  const a = Array.from(text.normalize("NFKC").replace(/[\s、。，．,.！？!?「」『』（）()・…]/gu, ""));
  const out = new Set<string>();
  for (let i = 0; i + 2 < a.length; i++) out.add(a[i] + a[i + 1] + a[i + 2]);
  return out;
}

/** a の 3 字の並びのうち b にもある割合（a から見る） */
export function overlapOf(a: string, b: string): number {
  const x = trigramsOf(a);
  if (x.size === 0) return 0;
  const y = trigramsOf(b);
  let n = 0;
  for (const g of x) if (y.has(g)) n += 1;
  return n / x.size;
}

/** ほぼ同じと見る重なり（3 字の並びの 6 割） */
export const REPEAT_OVERLAP = 0.6;
/** 繰り返しを見る文の短さの下限（3 字の並びの数）。「はい」「分かりました」のような短い文は見ない */
const REPEAT_MIN_GRAMS = 4;

/**
 * 前に言った言葉とほぼ同じ文を落とす（T158）。評価の 6 回目で、前の連絡・同じ通話の前の返事と同じ文（頼み事・いる所・残りの数）を毎回足していた。
 * 全部が繰り返しなら keepAll（刻みの連絡）は元のまま、そうでなければ空文字を返す（通話は呼ぶ側が短い返事に替える）。落とした数は onDrop に
 */
export function dropRepeats(raw: string, earlier: ReadonlyArray<string | null | undefined>, opts: { keepAll?: boolean; onDrop?: (rule: GateRule) => void } = {}): string {
  const prior = earlier.flatMap((e) => (e ? sentencesOf(e) : []));
  if (!raw.trim() || prior.length === 0) return raw;
  const sents = sentencesOf(raw.replace(/\s+/g, " ").trim());
  const kept = sents.filter((s) => trigramsOf(s).size < REPEAT_MIN_GRAMS || !prior.some((p) => overlapOf(s, p) >= REPEAT_OVERLAP));
  if (kept.length === sents.length) return raw;
  if (kept.length === 0 && opts.keepAll) return raw;
  for (let i = kept.length; i < sents.length; i++) opts.onDrop?.("repeat_said");
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
  const planMoved = (next === "shelter" || next === "other") && canLeaveHome(f);
  if (f.hurt && turn.color === "green" && !f.help && !planMoved) {
    onDrop?.("hurt_to_safe");
    return null;
  }
  // 表の次の行が緑なのに、表に無いけが・閉じ込め（ふだん動ける人の「動けない」）を足さない（T139。評価の 4 回目で、本人役の赤の
  // 「動けない」のあとに表の緑の行が来て、手なしで緑になった。表の行は骨で色を変えないので、食い違いの元の側を使わない）
  const newHurt = turn.color === "red" && (turn.injured === true || (turn.canMove === false && !f.plan?.immobile));
  if (newHurt && !f.hurt && f.ahead?.color === "green") {
    onDrop?.("hurt_to_safe");
    return null;
  }
  if (f.voiceLost && turn.source === "agent") {
    onDrop?.("voice_lost");
    return null;
  }
  // いる所の分からない人は家と見る（T177。全員家から始まり、移った事は記録にしか無い）
  const prev = f.place?.where ?? "home";
  // 見るのは家と家の外の入れ替わりだけ（赤の「家にいない」は避難所とも食い違わない）
  // 移送・計画の手段で移った所は、手（その移送）があっても戻さない（T139。移送の車が来ても家にいると言い続けた）
  const settled = f.place?.by === "transport" || f.place?.by === "plan";
  if (next && placeFlipped(prev, next) && (!helpedFlip(f, prev) || settled) && !f.away) {
    // 家から出るのはコードの記録になってから（T177）。本人役の答えだけでは移らない。自力で移れる人は、ここから移り始めた記録を付け、GO_MINUTES あとに着く
    const leaving = prev === "home";
    if (leaving || !RETURNED.test(words.normalize("NFKC")) || !canReturnHome(f)) {
      onDrop?.("place_flip");
      const go = leaving && !f.moving && canLeaveHome(f) ? { move: planMoveOf(f) } : {};
      if (turn.color === "green") return { ...turn, whereNow: prev, ...go };
      if (turn.color === "red") return { ...turn, atHome: prev === "home", ...go };
    }
  }
  return turn;
}

/**
 * 刻みの言葉が移り始める言い方か（T177）。自力で移れる人の「これから移ります」は記録になる（いる所の答えが家のままでも）。
 * 移れない人の言葉は門が落とすので、ここには来ない
 */
export function startsMove(f: Facts, texts: ReadonlyArray<string | null | undefined>): boolean {
  if ((f.place?.where ?? "home") !== "home" || f.moving || !canLeaveHome(f)) return false;
  return texts.some((x) => {
    const t = (x ?? "").normalize("NFKC");
    return t !== "" && (MOVE_FUTURE.test(t) || GO_INTENT.test(t)) && !GO_NOT.test(t) && !RETURNED.test(t);
  });
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

/** 出した出来事を数える（AI の人ごとの出来事と、コードが足した人ごとの出来事〔T167〕。表と印・結末は数えない）。多すぎないよう新しい 40 件まで */
export function noteIssued(world: WorldState, incidents: ReadonlyArray<{ ai?: boolean; filled?: true; actor?: string; inject?: string; person?: string; text?: string; at?: number; change?: { kind?: string } }>): WorldState {
  const add: Issued[] = [];
  for (const e of incidents) {
    if ((!e.ai && !e.filled) || typeof e.inject !== "string" || !e.text) continue;
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
export function issuedBlock(
  world: WorldState,
  label: (kind: string) => string,
  who: (p: string | null) => string | null,
  members?: ReadonlyArray<string>,
): string[] {
  const lines = issuedLines(world, label, who);
  const quiet = members ? quietPeople(world, members).flatMap((p) => (who(p) ? [who(p)!] : [])) : [];
  return [
    ...(lines.length > 0
      ? [[`もう出した出来事（同じ言い回しを別の人に使わない。人ごとの同じ種類は訓練に ${KIND_REPEAT_MAX} 回まで。違う種類・違う言い方で）:`, ...lines.map((x) => `- ${x}`)].join("\n")]
      : []),
    // T165: まだ出来事の無い人（評価の 7 回目で、1 回の訓練の人の 3 割余りに、その人を指す出来事が 1 つも無かった）
    ...(quiet.length > 0 ? [`まだ出来事の無い人（差し込む・起こすなら、この人の暮らしと弱点に合う事を先に。何人にも同じ形の筋を作らない）: ${quiet.join("・")}`] : []),
  ];
}

/**
 * まだその人を指す出来事の無い人（T165）。監督・世界が出した出来事（world.issued）と、その人の道・施設・印のどれも無い人。
 * 結末を迎えた人は入れない。並びは members のまま
 */
export function quietPeople(world: WorldState, members: ReadonlyArray<string>): string[] {
  const touched = new Set<string>();
  for (const x of world.issued ?? []) if (x.person) touched.add(x.person);
  for (const r of world.roads ?? []) if (r.person) touched.add(r.person);
  for (const f of world.facilities ?? []) if (f.person) touched.add(f.person);
  for (const [p, m] of Object.entries(world.marks ?? {})) if (Object.values(m ?? {}).some((v) => v !== undefined)) touched.add(p);
  const ended = world.ended ?? {};
  return members.filter((p) => !touched.has(p) && !ended[p]);
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
    // いる所は帳面の物（T141。計画・移送・訪問・行き先不明を当てた後）。ふだん動けない人は、手伝う人か乗り物が来て計画の手段で移った時だけ
    // （評価の 5 回目で、寝たきりの人が台帳の手段の字だけで「計画の避難先へ移った」に数えられた）
    const where = f.place?.where ?? placeOfState(input.people[p] ?? null);
    const moved = (w.arrivals ?? []).some((a) => a.person === p && a.role === "transport" && a.arrived);
    const by = f.place?.by ?? "turn";
    if (plan.move && (where === "shelter" || where === "other") && !moved && by !== "wandering" && (!plan.immobile || by === "plan")) acted.push("evacuate");
    if (plan.stayHome && where === "home") acted.push("stay");
    if (f.devices.some((d) => d.outAt !== null && d.spare === null) && !plan.power) needed.push("power");
    if (danger && plan.zone && !plan.move && !plan.stayHome) needed.push("move");
    if (acted.length > 0 || needed.length > 0) rows.push({ person: p, acted, needed });
  }
  return { acted: rows.filter((r) => r.acted.length > 0).length, needed: rows.filter((r) => r.needed.length > 0).length, rows };
}
