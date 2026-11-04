// 訓練の世界の「変わり方の決まり」（T121）。人ごと・場所ごとの今の状態は世界（WorldState）が持ち、変わった時刻は stamps（applyEvent が書く）。
// ここは、AI（監督・世界の部屋・1 回呼び）の出した出来事が、その状態の筋に反していないかを表で見て、通す・後ろに回す・捨てるを決める。
// Claude を呼ばない。色と順位はここで決めない（lib/triage だけ。ここは世界の出来事を選ぶだけ）。
//
// - 一度起きたら戻らない出来事（停電の復旧・同じ人への同じ物の到着・家の電話の不通・印・note の話題）は、もう起きていれば捨てる
// - 変わるのに時間が要る状態（道・施設・電話・断水・停電・避難所・天候）は、前に変わってから決まりの分がたつまで変えない。
//   通れるようになる・再開する（回復の向き）は、決まりの時刻まで後ろに回して予定（world.scheduled）に積む。ほかは捨てる
// - 想定の表（固定の筋）は骨。表がこのあと変える状態を AI が先に変えない。表の出来事そのものは「もう起きている」の門だけ通す
// - 予定の出来事（監督の見込み・後ろに回した物）は、時刻が来たときに「もう起きている」「戻る向きなのに今の方が良い」を見る
// - 型を決めて出来事を減らすのではなく、筋の通らない物だけを外す。どの種類も、筋が通る時刻なら起きてよい

import type { DrillIncident } from "./incident-types.ts";
import { applyEvent, type PersonMarks, type PhoneState, type WorldChange, type WorldState } from "./scenarios.ts";
import { minuteText } from "./time-text.ts";

/** 出来事がどこから来たか。table 想定の表、scheduled 時刻の来た予定、ai 監督・世界がこの区切りで出した物 */
export type Origin = "table" | "scheduled" | "ai";

/** 変わるのに要る時間（分）。前に変わった時刻（stamps）から数える */
export const DWELL_MINUTES = {
  /** 通行止 → 通行可 */
  roadReopen: 360,
  /** 通行可に戻った道がまた通行止に */
  roadClose: 720,
  /** 施設の休止 → 再開、再開した施設がまた休止 */
  facility: 720,
  /** 電話の状態（通常・不安定・通話不可）の入れ替わり */
  phone: 360,
  /** 断水 → 解消、解消した断水がまた断水 */
  water: 720,
  /** 停電の復旧のあとの、もう一度の停電 */
  outage: 360,
  /** 避難所の状態（開設・混雑・満員・閉鎖） */
  shelter: 360,
  /** 天候（大雨・止む） */
  weather: 180,
} as const;

/** 同じ人に同じ役の人が着いたあと、また同じ役が来る予定を受けるまでの分（業者の巡回・電源・薬） */
export const ARRIVAL_AGAIN_MINUTES = 1440;

/**
 * 決まりの表。id はログと評価の台の数え、words は監督に渡す決まりの言い方（Claude に渡す文。画面の言葉ではない）
 */
export const STATE_RULES = [
  { id: "once:restore", kind: "once", words: "停電の復旧は 1 回だけ（復旧したあとにもう一度復旧しない）" },
  { id: "once:arrival", kind: "once", words: `同じ人に同じ役の人（業者・電源・薬）が着いたら、${ARRIVAL_AGAIN_MINUTES / 60} 時間は同じ役の予定を入れない` },
  { id: "once:line", kind: "once", words: "家の電話の不通は 1 回だけ（不通のあいだに重ねない）" },
  { id: "once:mark", kind: "once", words: "本人ごとの印（帰宅困難・介護休止など）は 1 回だけ" },
  { id: "once:note", kind: "once", words: "給水所・情報の混乱・土砂の警戒の話題は 1 回だけ" },
  { id: "same", kind: "once", words: "今と同じ状態にする出来事は出さない" },
  { id: "dwell:road", kind: "dwell", words: `道は、通行止から ${DWELL_MINUTES.roadReopen / 60} 時間たつまで通れるようにならない。通れるようになった道は ${DWELL_MINUTES.roadClose / 60} 時間たつまで通行止に戻らない` },
  { id: "dwell:facility", kind: "dwell", words: `施設の休止と再開は、前に変わってから ${DWELL_MINUTES.facility / 60} 時間たつまで入れ替わらない` },
  { id: "dwell:phone", kind: "dwell", words: `電話の状態は、前に変わってから ${DWELL_MINUTES.phone / 60} 時間たつまで変わらない` },
  { id: "dwell:water", kind: "dwell", words: `断水と解消は、前に変わってから ${DWELL_MINUTES.water / 60} 時間たつまで入れ替わらない` },
  { id: "dwell:outage", kind: "dwell", words: `停電が復旧したら、${DWELL_MINUTES.outage / 60} 時間たつまでもう一度の停電にしない` },
  { id: "dwell:shelter", kind: "dwell", words: `避難所の状態は、前に変わってから ${DWELL_MINUTES.shelter / 60} 時間たつまで変わらない` },
  { id: "dwell:weather", kind: "dwell", words: `天候は、前に変わってから ${DWELL_MINUTES.weather / 60} 時間たつまで変わらない` },
  { id: "table_first", kind: "table", words: "想定の表がこのあと変える状態（停電の復旧・電話・その道や施設）は、表より先に変えない" },
] as const;
export type StateRuleId = (typeof STATE_RULES)[number]["id"];

/** 想定の表がこのあと変える状態（鍵 → 変える時刻〔発災からの分〕の一覧）。鍵は stamps と同じ形と、復旧は restore */
export type TableAhead = ReadonlyMap<string, ReadonlyArray<number>>;

/** 表の出来事の変化が触る状態の鍵（表の先回りの門に使う） */
export function tableKeysOf(change: WorldChange): string[] {
  switch (change.kind) {
    case "outage_restored":
      return ["restore"];
    case "outage":
      return ["outage"];
    case "phone":
      return ["phone"];
    case "water":
      return ["water"];
    case "road":
      return [`road:${change.id}`];
    case "facility":
      return [`facility:${change.id}`];
    case "shelter":
      return [`shelter:${change.id}`];
    default:
      return [];
  }
}

/** 表の出来事（時刻つき）から、このあと変える状態の一覧を作る。after より後の物だけ */
export function tableAheadOf(events: ReadonlyArray<{ event: Pick<DrillIncident, "change">; minute: number }>, after: number): TableAhead {
  const out = new Map<string, number[]>();
  for (const { event, minute } of events) {
    if (minute <= after) continue;
    for (const k of tableKeysOf(event.change)) out.set(k, [...(out.get(k) ?? []), minute]);
  }
  return out;
}

export type ScreenContext = {
  /** 今の時刻（発災からの分）。出来事の起きる時刻（区切りの終わり） */
  minute: number;
  origin: Origin;
  /** 想定の表がこのあと変える状態（仮想・表の無い訓練は空） */
  ahead?: TableAhead;
};

/** 1 つの出来事の決め。defer は at（発災からの分）に後ろに回した予定の出来事 */
export type ScreenVerdict = { keep: true } | { keep: false; rule: StateRuleId } | { keep: "defer"; rule: StateRuleId; at: number };

const PHONE_RANK: Readonly<Record<PhoneState, number>> = { ok: 0, busy: 1, down: 2 };

/** 前に変わった時刻（発災からの分）。無ければ null（始めからその状態） */
function stampOf(world: WorldState, key: string): number | null {
  const h = world.stamps?.[key];
  return typeof h === "number" ? Math.round(h * 60) : null;
}

/** 前に変わってから dwell 分たっていない（前の変化が無ければ足りている） */
function tooSoon(world: WorldState, key: string, now: number, dwell: number): number | null {
  const at = stampOf(world, key);
  return at !== null && now - at < dwell ? at + dwell : null;
}

/** 表がこのあと（今より後に）この鍵を変えるか */
const tableWillChange = (ctx: ScreenContext, key: string): boolean => (ctx.ahead?.get(key) ?? []).some((m) => m > ctx.minute);

const marked = (world: WorldState, person: string | null | undefined, key: keyof PersonMarks): boolean =>
  !!person && world.marks?.[person]?.[key] !== undefined;

const ROLE_SUPPLY: Readonly<Record<string, "power" | "oxygen" | "medicine">> = { power: "power", vendor: "oxygen", medicine: "medicine" };

/** 同じ人に同じ役の人が向かっているか、ARRIVAL_AGAIN_MINUTES のうちに着いた・届いた */
function arrivalTaken(world: WorldState, person: string, role: string, now: number): boolean {
  for (const a of world.arrivals ?? []) {
    if (a.person !== person || a.role !== role) continue;
    if (!a.arrived || now - a.arrive < ARRIVAL_AGAIN_MINUTES) return true;
  }
  const supply = ROLE_SUPPLY[role];
  const got = supply ? world.supplies?.[person]?.[supply] : undefined;
  return typeof got === "number" && now - got < ARRIVAL_AGAIN_MINUTES;
}

/** 道の 1 本の決め（id ごと）。open は出来事の後の状態 */
function roadVerdict(world: WorldState, id: string, open: boolean, ctx: ScreenContext): ScreenVerdict {
  const key = `road:${id}`;
  const road = world.roads.find((r) => r.id === id);
  if (road && road.open === open) return { keep: false, rule: "same" };
  if (!road && open) return { keep: false, rule: "same" };
  if (ctx.origin === "ai" && tableWillChange(ctx, key)) return { keep: false, rule: "table_first" };
  if (ctx.origin === "table") return { keep: true };
  if (open) {
    const until = tooSoon(world, key, ctx.minute, DWELL_MINUTES.roadReopen);
    if (until !== null) return ctx.origin === "ai" ? { keep: "defer", rule: "dwell:road", at: until } : { keep: false, rule: "dwell:road" };
    return { keep: true };
  }
  // 通行可に戻った道（前に変わった時刻がある＝一度通行止になって戻った）がまた通行止に
  if (road && tooSoon(world, key, ctx.minute, DWELL_MINUTES.roadClose) !== null) return { keep: false, rule: "dwell:road" };
  return { keep: true };
}

function facilityVerdict(world: WorldState, id: string, open: boolean, ctx: ScreenContext): ScreenVerdict {
  const key = `facility:${id}`;
  const f = world.facilities.find((x) => x.id === id);
  if (f && f.open === open) return { keep: false, rule: "same" };
  if (!f && open) return { keep: false, rule: "same" };
  if (ctx.origin === "ai" && tableWillChange(ctx, key)) return { keep: false, rule: "table_first" };
  if (ctx.origin === "table" || !f) return { keep: true };
  const until = tooSoon(world, key, ctx.minute, DWELL_MINUTES.facility);
  if (until === null) return { keep: true };
  return open && ctx.origin === "ai" ? { keep: "defer", rule: "dwell:facility", at: until } : { keep: false, rule: "dwell:facility" };
}

/**
 * 1 つの出来事を決まりの表で見る（世界は当てる前の物）。想定の表の出来事は「もう起きている」の門だけ（骨なので時間の門は通さない）
 */
export function screenIncident(world: WorldState, e: DrillIncident, ctx: ScreenContext): ScreenVerdict {
  const c = e.change;
  const person = e.person ?? null;
  const ai = ctx.origin === "ai";
  switch (c.kind) {
    case "outage_restored": {
      if (!world.outage || world.outage.restoredAt !== null) return { keep: false, rule: "once:restore" };
      if (ctx.origin !== "table" && tableWillChange(ctx, "restore")) return { keep: false, rule: "table_first" };
      return { keep: true };
    }
    case "outage": {
      if (ctx.origin === "table") return { keep: true };
      if (ai && tableWillChange(ctx, "outage")) return { keep: false, rule: "table_first" };
      const o = world.outage;
      if (o && o.restoredAt !== null && ctx.minute - Math.round(o.restoredAt * 60) < DWELL_MINUTES.outage) return { keep: false, rule: "dwell:outage" };
      return { keep: true };
    }
    case "phone": {
      if (c.state === world.phone) return { keep: false, rule: "same" };
      if (ctx.origin === "table") return { keep: true };
      // 予定の電話の変化は見込みの回復（携帯不可の一部回復）。今の方が良ければ起きない
      if (ctx.origin === "scheduled") return PHONE_RANK[c.state] < PHONE_RANK[world.phone] ? { keep: true } : { keep: false, rule: "same" };
      if (tableWillChange(ctx, "phone") && (ctx.ahead?.get("phone") ?? []).some((m) => m > ctx.minute && m - ctx.minute < DWELL_MINUTES.phone)) {
        return { keep: false, rule: "table_first" };
      }
      return tooSoon(world, "phone", ctx.minute, DWELL_MINUTES.phone) !== null ? { keep: false, rule: "dwell:phone" } : { keep: true };
    }
    case "water": {
      const next = c.out ? "out" : world.water === "out" ? "restored" : world.water;
      if (next === world.water) return { keep: false, rule: "same" };
      if (ctx.origin === "table") return { keep: true };
      if (ai && tableWillChange(ctx, "water")) return { keep: false, rule: "table_first" };
      return tooSoon(world, "water", ctx.minute, DWELL_MINUTES.water) !== null ? { keep: false, rule: "dwell:water" } : { keep: true };
    }
    case "road":
      return roadVerdict(world, c.id, c.open, ctx);
    case "town_road": {
      // 町の道は人ごとの id。最初の人で見る（同じ出来事の人は同じ道）
      const p = c.persons[0];
      return p ? roadVerdict(world, `rd-${c.road}-${p}`, c.open, ctx) : { keep: false, rule: "same" };
    }
    case "facility":
      return facilityVerdict(world, c.id, c.open, ctx);
    case "town_facility": {
      const p = c.persons[0];
      return p ? facilityVerdict(world, `fc-${c.facility}-${p}`, c.open, ctx) : { keep: false, rule: "same" };
    }
    case "shelter": {
      const s = world.shelters.find((x) => x.id === c.id);
      if (s && s.state === c.state) return { keep: false, rule: "same" };
      if (!s || ctx.origin === "table") return { keep: true };
      if (ai && tableWillChange(ctx, `shelter:${c.id}`)) return { keep: false, rule: "table_first" };
      return tooSoon(world, `shelter:${c.id}`, ctx.minute, DWELL_MINUTES.shelter) !== null ? { keep: false, rule: "dwell:shelter" } : { keep: true };
    }
    case "town_water": {
      const left = c.persons.filter((p) => (c.out ? !marked(world, p, "waterOut") : marked(world, p, "waterOut")));
      return left.length === 0 ? { keep: false, rule: "same" } : { keep: true };
    }
    case "weather": {
      if (world.weather === c.state) return { keep: false, rule: "same" };
      const at = stampOf(world, "weather");
      return at !== null && ctx.minute - at < DWELL_MINUTES.weather ? { keep: false, rule: "dwell:weather" } : { keep: true };
    }
    case "line_down":
      return marked(world, person, "lineDown") ? { keep: false, rule: "once:line" } : { keep: true };
    case "town_line":
      return c.persons.every((p) => marked(world, p, "lineDown")) ? { keep: false, rule: "once:line" } : { keep: true };
    case "supply_left":
      return marked(world, person, "supplyLeft") ? { keep: false, rule: "once:mark" } : { keep: true };
    case "nurse_away":
      return marked(world, person, "nurseAway") ? { keep: false, rule: "once:mark" } : { keep: true };
    case "going_home":
      return marked(world, person, "goingHome") ? { keep: false, rule: "once:mark" } : { keep: true };
    case "mark":
      return marked(world, person, c.mark) ? { keep: false, rule: "once:mark" } : { keep: true };
    case "note":
      return world.notes?.[c.topic] !== undefined ? { keep: false, rule: "once:note" } : { keep: true };
    case "schedule": {
      if (ctx.origin === "table") return { keep: true };
      const t = c.then;
      if (t.kind === "arrival") return person && arrivalTaken(world, person, t.role, ctx.minute) ? { keep: false, rule: "once:arrival" } : { keep: true };
      if (t.change.kind === "outage_restored") {
        if (!world.outage || world.outage.restoredAt !== null) return { keep: false, rule: "once:restore" };
        if (tableWillChange(ctx, "restore")) return { keep: false, rule: "table_first" };
        if ((world.scheduled ?? []).some((s) => s.change.kind === "outage_restored")) return { keep: false, rule: "once:restore" };
      }
      return { keep: true };
    }
    default:
      return { keep: true };
  }
}

/** 後ろに回した出来事の文（表の言い方。「家の前の道 通行再開見込 3 時間後」） */
function deferText(e: DrillIncident, inHours: number): string {
  const c = e.change;
  const label = c.kind === "road" || c.kind === "town_road" || c.kind === "facility" || c.kind === "town_facility" ? c.label : "";
  const what = c.kind === "facility" || c.kind === "town_facility" ? "再開" : "通行再開";
  return `${label} ${what}見込 ${inHours} 時間後`.trim();
}

/** 後ろに回す予定の出来事（世界の予定に積む状況）。時刻は時間の切りのよい所へ */
function deferred(e: DrillIncident, now: number, until: number): DrillIncident {
  const inHours = Math.max(1, Math.ceil((until - now) / 60));
  const at = now + inHours * 60;
  return {
    ...e,
    change: { kind: "schedule", at, by: e.actor === "director" ? "director" : "world", then: { kind: "event", change: e.change, text: e.text } },
    text: deferText(e, inHours),
  };
}

export type Screened = {
  /** 通した出来事（後ろに回した物は予定の出来事に置き換えた物）。並びは元のまま */
  kept: DrillIncident[];
  /** 当てたあとの世界 */
  world: WorldState;
  /** 捨てた・後ろに回した物の決まり（ログと数え。中身は書かない） */
  ruled: Array<{ rule: StateRuleId; kind: WorldChange["kind"]; deferred: boolean }>;
};

/**
 * 出来事の並びを決まりの表で見ながら世界に当てる（前の出来事を当てた世界で次を見る）。時刻は出来事ごと（at）。
 * 想定の表の出来事は「もう起きている」の門だけ、AI の出来事は全部の門
 */
export function screenIncidents(
  world: WorldState,
  incidents: ReadonlyArray<DrillIncident>,
  ctx: Omit<ScreenContext, "minute"> & { minute?: number; originOf?: (e: DrillIncident) => Origin },
): Screened {
  let w = world;
  const kept: DrillIncident[] = [];
  const ruled: Screened["ruled"] = [];
  for (const e of incidents) {
    const minute = ctx.minute ?? Math.round(e.at * 60);
    const v = screenIncident(w, e, { minute, origin: ctx.originOf?.(e) ?? ctx.origin, ...(ctx.ahead ? { ahead: ctx.ahead } : {}) });
    if (v.keep === false) {
      ruled.push({ rule: v.rule, kind: e.change.kind, deferred: false });
      continue;
    }
    const x = v.keep === "defer" ? deferred(e, minute, v.at) : e;
    if (v.keep === "defer") ruled.push({ rule: v.rule, kind: e.change.kind, deferred: true });
    kept.push(x);
    w = applyEvent(w, x, x.at);
  }
  if (ruled.length > 0) console.warn("世界の決まりで出来事を外した", ruled.map((r) => `${r.rule}${r.deferred ? "→予定" : ""}`).join("・"));
  return { kept, world: w, ruled };
}

// ---------- 監督・世界に渡す「今の状態と、いつから」 ----------

/** 「（3 時間 10 分から）」 */
const sinceWords = (world: WorldState, key: string): string => {
  const at = stampOf(world, key);
  return at === null ? "" : `（${minuteText(at)}から）`;
};

/** まだ変えられない時刻の言い方（「9 時間 10 分まで変えない」）。足りていれば空 */
function holdWords(world: WorldState, key: string, now: number, dwell: number): string {
  const until = tooSoon(world, key, now, dwell);
  return until === null ? "" : `。${minuteText(until)}まで変わらない`;
}

/**
 * 監督・世界に渡す今の状態の行（変わった時刻と、まだ変わらない時刻）。who は本人の id → 仮名（無ければ書かない）。
 * 一度きりの出来事（復旧・到着）は「もう起きた」と書く
 */
export function stateLines(world: WorldState, now: number, who: (person: string | null) => string | null = () => null): string[] {
  const out: string[] = [];
  const o = world.outage;
  if (o) {
    out.push(
      o.restoredAt !== null
        ? `停電: 復旧済（${minuteText(o.restoredAt * 60)}）。もう一度の復旧は起きない`
        : `停電: 停電中（${minuteText(o.since * 60)}から）`,
    );
  }
  out.push(`電話: ${PHONE_WORDS[world.phone]}${sinceWords(world, "phone")}${holdWords(world, "phone", now, DWELL_MINUTES.phone)}`);
  if (world.water !== "none") out.push(`断水: ${world.water === "out" ? "断水中" : "解消"}${sinceWords(world, "water")}${holdWords(world, "water", now, DWELL_MINUTES.water)}`);
  for (const r of world.roads) {
    const key = `road:${r.id}`;
    const hold = holdWords(world, key, now, r.open ? DWELL_MINUTES.roadClose : DWELL_MINUTES.roadReopen);
    const by = who(r.person);
    out.push(`${r.label}${by ? `（${by}）` : ""}: ${r.open ? "通行可" : "通行止"}${sinceWords(world, key)}${hold}`);
  }
  for (const f of world.facilities) {
    const key = `facility:${f.id}`;
    const by = who(f.person);
    out.push(`${f.label}${by ? `（${by}）` : ""}: ${f.open ? "稼働" : "休止"}${sinceWords(world, key)}${holdWords(world, key, now, DWELL_MINUTES.facility)}`);
  }
  for (const a of world.arrivals ?? []) {
    if (!a.arrived) continue;
    const by = who(a.person);
    if (by) out.push(`${by}: ${ARRIVAL_WORDS[a.role] ?? a.role}が着いた（${minuteText(a.arrive)}）`);
  }
  return out;
}

const PHONE_WORDS: Readonly<Record<PhoneState, string>> = { ok: "通常", busy: "不安定", down: "通話不可" };
const ARRIVAL_WORDS: Readonly<Record<string, string>> = {
  staff: "事業所の職員",
  nurse: "訪問看護",
  supporter: "支援者",
  family: "家族",
  vendor: "酸素業者",
  transport: "移送の車",
  power: "電源",
  medicine: "薬の配達",
};

/** 監督・世界の指示に足す決まりの文（表から） */
export const STATE_RULES_TEXT = ["変わり方の決まり（決まりに反する出来事は使われない）:", ...STATE_RULES.map((r) => `- ${r.words}`)].join("\n");
