// 評価の台（T108）の検査 9: 人ごとの事実の帳面との矛盾（T130）。本人役・通話・往復・訪問の言葉と安否、監督・世界の出来事が、
// その時の帳面（前の連絡・手・到着・台帳の計画）と食い違った数を数える。帳面の決まりは lib/drill/person-facts.ts の関数をそのまま使う
// （門と同じ物差し。門が効いていれば 0 のはず）。色と順位は決めない・付け直さない。数えるだけ。
//
// 見る型: いる所が手も計画も無く変わる（place_flip）・いる所と食い違う言葉（place_text）・同居の人が「来た」（with_arrived）・
// いない家族（absent_kin）・電気が戻ったあとの電池の頼み事（ask_after_power）・予備の無い人の予備や戻った電池（spare_without_plan）・
// 止まった機器のまま落ち着いている（calm_while_down）・声が無いと伝えられた本人が話す（voice_lost）・手も計画も無い業者の巡回（supply_without_hand）・
// 同じ言い回しの出来事を別の人に（repeat_text）・同じ種類を上限より多く（repeat_kind）・画面に出た結末の理由の医療の言い方（reason_medical）。
// 赤（動けない）→ 緑は checks.ts の hurt_to_safe（前からの検査）が数える

import { castTurn, turnKey } from "../../../lib/drill/cast.ts";
import { EVENT_CATALOG, isInjectKind } from "../../../lib/drill/event-catalog.ts";
import type { DrillScenario } from "../../../lib/db/types.ts";
import { eventHour, scenarioOf } from "../../../lib/drill/scenarios.ts";
import {
  amountMinutes,
  canLeaveHome,
  carryPlace,
  factsOf,
  helpedFlip,
  KIND_REPEAT_MAX,
  placeFlipped,
  placeOfState,
  powerBack,
  sameWording,
  batteryTopicNext,
  carryPromises,
  sentenceFix,
  sentenceSlip,
  slipContextOf,
  supplyAllowed,
  SUPPLY_ROLES,
  wholeContext,
  type GateRule,
  type Plan,
} from "../../../lib/drill/person-facts.ts";
import type { ActionRecord } from "../../../lib/drill/action-types.ts";
import type { PersonState } from "../../../lib/drill/persona-types.ts";
import type { WorldState } from "../../../lib/drill/scenarios.ts";
import { REASON_MEDICAL_WORDS } from "../../../lib/drill/world-apply.ts";
import { LOST_MAX_MINUTES } from "../../../lib/drill/lost.ts";
import { AREA_GAP_MINUTES } from "../../../lib/drill/time-odds.ts";
import type { CheckHit } from "./checks.ts";
import type { LooseAction, LooseTurn, RunOutcome } from "./drive.ts";

/** 帳面の検査に要る本人ごとの台帳の事実（台が種の台帳から作る。lib/drill/persona.ts の housemates と planOf） */
export type FactPerson = {
  plan: Plan;
  together: ReadonlyArray<string>;
  kin: ReadonlyArray<string> | null;
  hazards: ReadonlyArray<{ kind: string; depthM?: number | null }>;
  town: string | null;
  /** スマホで赤緑を押せる人がいるか（T174。いなければ連絡の無いのは筋の外。無ければ押せると見る） */
  canPress?: boolean;
};

const RETURNED = /帰宅|(?:家|自宅|うち)に戻|帰って(?:き|来)|戻ってき/;

/** 停電の地区にこの家が入るか（lib/drill/persona.ts の inOutageArea と同じ決め） */
function inOutage(world: WorldState, p: FactPerson | undefined): boolean {
  const o = world.outage;
  if (!o || !p) return false;
  if (o.area.scope === "office") return true;
  if (o.area.scope === "towns") return !p.town || o.area.towns.includes(p.town);
  const a = o.area;
  return p.hazards.some((h) => h.kind === a.hazard && (h.depthM ?? 0) >= a.minDepthM);
}

/** 安否 1 つの本人の様子。前の様子からいる所を引き継ぐ（T158。engine の本人の様子と同じ carryPlace） */
const stateOf = (u: LooseTurn & { at: number }, prev: PersonState | null = null): PersonState => {
  const s: PersonState = {
    color: (u.color as PersonState["color"]) ?? "unknown",
    source: (u.source as PersonState["source"]) ?? "agent",
    whereNow: (u.whereNow as PersonState["whereNow"]) ?? null,
    at: u.at,
    saying: u.saying ?? null,
    doing: u.doing ?? null,
    injured: u.injured ?? null,
    atHome: u.atHome ?? null,
    canMove: u.canMove ?? null,
    hasMedicine: u.hasMedicine ?? null,
  };
  const known = s.color === "red" && s.atHome === false ? carryPlace(prev, s) : null;
  // 言って済んでいない予定も engine と同じに引き継ぐ（T165）
  const promised = carryPromises(prev, s);
  return { ...s, ...(known === "shelter" ? { placeKnown: known } : {}), ...(promised.length > 0 ? { promised } : {}) };
};

const cut = (t: string) => Array.from(t).slice(0, 40).join("");

/**
 * 想定の表の行の安否（本人と発災からの分 → 表のする事）。表の行は骨なので、いる所と声の門の外（言葉は見る）。配役（T70）を当てる。
 * 表のする事（「4 問の途中で止まった」）は画面の記録の言葉で、本人役の言葉ではないので見ない（T165）
 */
function tableTurns(outcome: RunOutcome): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const cast = outcome.cast ?? {};
  for (const t of scenarioOf(outcome.plan.scenario as DrillScenario).ticks) {
    t.turns.forEach((raw, i) => {
      const r = castTurn(raw, cast[turnKey(t.hour, i)]);
      out.set(`${r.person}|${Math.round(eventHour(r, t.hour) * 60)}`, r.doing ?? null);
    });
  }
  return out;
}

/** 9. 帳面との矛盾（T130）。checked は見た数（安否・言葉・出来事・到着） */
export function factHits(outcome: RunOutcome, people: Readonly<Record<string, FactPerson>>): { checked: number; hits: CheckHit[] } {
  const hits: CheckHit[] = [];
  const r = outcome.replay;
  if (!r) return { checked: 0, hits };
  const world = r.world as unknown as WorldState;
  const actions = r.actions as unknown as ActionRecord[];
  let checked = 0;
  const hit = (rule: GateRule | FactExtraRule, person: string | null, minute: number | null, evidence: string) => hits.push({ check: "facts", rule, person, minute, evidence });
  const factsAt = (person: string, prev: PersonState | null, minute: number) => {
    const p = people[person];
    return factsOf({
      person,
      world,
      state: prev,
      actions: actions.filter((a) => a.person === person),
      now: minute,
      plan: p?.plan ?? null,
      inOutage: inOutage(world, p),
      together: p?.together ?? [],
      kin: p?.kin ?? null,
    });
  };

  const table = tableTurns(outcome);
  // 家の外へ出た・車中泊・帰ろうとする印（その時の世界の印。終わりの世界では人が着くと消えているので、出来事から作る）
  const awayMarks: Array<{ person: string; minute: number; kind: "wandering" | "car" | "other" }> = [];
  const foundMarks: Array<{ person: string; minute: number }> = [];
  for (const t of r.ticks) {
    for (const e of t.incidents) {
      const k = e.change?.kind;
      const mark = k === "mark" ? (e.change as { mark?: unknown }).mark : null;
      if (e.person && (k === "going_home" || mark === "wandering" || mark === "carSleep")) awayMarks.push({ person: e.person, minute: Math.round((e.at ?? t.hour) * 60), kind: mark === "wandering" ? "wandering" : mark === "carSleep" ? "car" : "other" });
      if (e.person && mark === "found") foundMarks.push({ person: e.person, minute: Math.round((e.at ?? t.hour) * 60) });
    }
  }
  // 栄養剤の持ち出し忘れの印（T158。終わりの世界では人が着くと消えているので、出来事と到着から作る）
  const leftMarks: Array<{ person: string; minute: number }> = [];
  for (const t of r.ticks) {
    for (const e of t.incidents) {
      const k = e.change?.kind;
      if (e.person && (k === "supply_left" || (k === "mark" && (e.change as { mark?: unknown }).mark === "supplyLeft"))) leftMarks.push({ person: e.person, minute: Math.round((e.at ?? t.hour) * 60) });
    }
  }
  // 印を消す手（T167。lib/drill/action-catalog.ts の clearMarks の手と到着）。前は世界の到着だけを見ていて、ケアマネの訪問・受入で印が消えた
  // あとの言葉も「家に置いたまま」と数え、門（世界の印を見る）と食い違った（評価の 8 回目の left_remain 2 件）
  const cleared = (person: string, from: number, to: number): boolean =>
    (world.arrivals ?? []).some((a) => a.person === person && a.arrived && a.arrive > from && a.arrive <= to) ||
    (world.dispatched ?? []).some((d) => d.person === person && d.arrived && d.arrive > from && d.arrive <= to) ||
    actions.some((a) => a.person === person && a.result?.cleared !== undefined && a.result.cleared.length > 0 && a.result.atMinute > from && a.result.atMinute <= to);
  const leftAt = (person: string, minute: number): boolean => leftMarks.some((m) => m.person === person && m.minute <= minute && !cleared(person, m.minute, minute));
  const awayAt = (person: string, minute: number): boolean =>
    awayMarks.some(
      // 車中泊の印は人が着いても消えない（CLEARED_ON_ARRIVAL に無い）
      (m) => m.person === person && m.minute <= minute && (m.kind === "car" || !cleared(person, m.minute, minute)) && !foundMarks.some((x) => x.person === person && x.minute > m.minute && x.minute <= minute),
    );
  // 本人ごとの安否を時刻の順に（前の連絡からの帳面で、次の安否と言葉を見る）
  const byPerson = new Map<string, Array<LooseTurn & { at: number }>>();
  for (const t of r.ticks) for (const u of t.turns) if (u.person) byPerson.set(u.person, [...(byPerson.get(u.person) ?? []), { ...u, at: u.at ?? t.hour }]);
  for (const [person, turns] of byPerson) {
    turns.sort((a, b) => a.at - b.at);
    let prev: PersonState | null = null;
    for (const u of turns) {
      const minute = Math.round(u.at * 60);
      const f = factsAt(person, prev, minute);
      checked += 1;
      const place = placeOfState(stateOf(u));
      const words = `${u.saying ?? ""}${u.doing ?? ""}`;
      // 言葉の矛盾は AI の言葉だけ（表の固定の言葉は表の試験で見る）
      if (u.ai) {
        const row = table.has(`${person}|${minute}`);
        if (!row && f.voiceLost && u.source === "agent") hit("voice_lost", person, minute, `${Math.round(f.voiceLost.at)} 分に声なし → 本人`);
        const prevPlace = f.place?.where ?? null;
        if (!row && prevPlace && place && placeFlipped(prevPlace, place) && !helpedFlip(f, prevPlace) && !awayAt(person, minute)) {
          const leaving = prevPlace === "home";
          const ok = leaving ? canLeaveHome(f) : RETURNED.test(words.normalize("NFKC"));
          if (!ok) hit("place_flip", person, minute, `${prevPlace} → ${place}`);
        }
        const ctx = { ...slipContextOf(f, place ?? f.place?.where ?? null), ...(u.source === "family" ? { kin: null } : {}), ...(leftAt(person, minute) ? { leftBehind: true } : {}) };
        // 表の行のする事（表のまま残した物）は画面の記録の言葉なので見ない（T165）。表に無く本人役が作ったする事は見る
        const tableDoing = table.get(`${person}|${minute}`) ?? null;
        for (const [field, text] of [["saying", u.saying], ["doing", tableDoing !== null && u.doing === tableDoing ? null : u.doing]] as const) {
          if (!text) continue;
          for (const r of sentenceHits(text, ctx)) hit(r.rule, person, minute, `${field}: ${cut(r.text)}`);
        }
      }
      prev = stateOf(u, prev);
    }
  }

  // 通話・往復・訪問の言葉と頼み事（手の返事の時刻の帳面で）
  for (const a of r.actions as LooseAction[]) {
    const res = a.result;
    const person = a.person ?? null;
    if (!res || !person || typeof res.atMinute !== "number") continue;
    const minute = res.atMinute;
    const prev = lastStateBefore(byPerson.get(person) ?? [], minute);
    const f = factsAt(person, prev, minute);
    const ctx = { ...slipContextOf(f), kin: null, ...(leftAt(person, minute) ? { leftBehind: true } : {}) };
    const texts: Array<[string, string | null | undefined]> = [
      ["call.speech", res.speech],
      ...(res.talk ?? []).filter((l) => l.who !== "cm").map((l): [string, string | undefined] => ["talk", l.text]),
      ["visit.speech", res.visit?.speech],
      ["visit.condition", res.visit?.condition],
    ];
    for (const [field, text] of texts) {
      if (!text) continue;
      checked += 1;
      if (field === "call.speech" && a.callee === "self" && f.voiceLost) hit("voice_lost", person, minute, "本人への電話で話した");
      // 訪問は本人のいる所へ（T167。門と同じ。帳面のいる所、分からなければ家）
      for (const r of sentenceHits(text, field.startsWith("visit") ? { ...ctx, place: ctx.place ?? "home" } : ctx)) hit(r.rule, person, minute, `${field}: ${cut(r.text)}`);
    }
    const asks = [...((res.talk ?? []) as Array<{ ask?: unknown; asks?: unknown }>).flatMap((l) => (Array.isArray(l.asks) ? l.asks : [])), ...(res.visit?.asks ?? [])];
    if (powerBack(f) && asks.some((k) => k === "power" || k === "battery")) hit("ask_after_power", person, minute, "頼み事 電源・電池");
  }

  // 掛かってきた電話の往復の言葉（T158。往復は手の記録の外。drive.ts が集めた incoming。着信に出た時刻の帳面で）
  for (const c of outcome.incoming ?? []) {
    if (!c.person) continue;
    const prev = lastStateBefore(byPerson.get(c.person) ?? [], c.minute);
    const f = factsAt(c.person, prev, c.minute);
    const ctx = { ...slipContextOf(f), kin: null, ...(leftAt(c.person, c.minute) ? { leftBehind: true } : {}) };
    for (const l of c.lines) {
      if (l.who === "cm" || !l.text || !l.ai) continue;
      checked += 1;
      for (const s of sentenceHits(l.text, ctx)) hit(s.rule, c.person, typeof l.minute === "number" ? l.minute : c.minute, `incoming: ${cut(s.text)}`);
    }
  }

  // 機器の予備が切れたあと長く連絡が無い（T167。評価の 8 回目で、予備が切れてから 11 時間、本人役が呼ばれず、審査役が本当らしさに欠けると読んだ）。
  // 切れた時刻ちょうどの連絡は数えない（T174。評価の 9 回目で、切れた知らせのあと 13 時間誰からも連絡が無かった。見るのはそのあとの反応）。
  // 電気が戻った・電源が届いた人、結末の人、家の外へ移った人、押せる人のいない人は見ない。予備も外の電源も無い機器は内蔵が切れた時刻から（T174）
  // down_green: 機器が止まったまま家にいる間の緑（T174。本人役の緑は門が赤にするので 0 のはず。表の行は骨なので見ない）
  {
    const o = world.outage;
    const end = Math.max(...r.ticks.map((x) => Math.round(x.hour * 60)), 0);
    for (const [person, p] of Object.entries(people)) {
      if (!o || !inOutage(world, p) || !(outcome.plan.participants ?? [person]).includes(person) || p.canPress === false) continue;
      const turns = byPerson.get(person) ?? [];
      const carried = (world.arrivals ?? []).filter((a) => a.person === person && a.role === "transport" && a.arrived).map((a) => a.arrive);
      const awayBy = (minute: number) => carried.some((x) => x <= minute) || turns.some((u) => Math.round(u.at * 60) <= minute && ["shelter", "other"].includes(placeOfState(stateOf(u)) ?? ""));
      for (const d of p.plan.devices) {
        const s = p.plan.spares.find((x) => x.category === d.category);
        if (d.hours === null || (s ? s.hours == null : p.plan.power)) continue;
        const cutAt = Math.round((o.since + d.hours + (s?.hours ?? 0)) * 60);
        const until = cutAt + DOWN_SILENT_MINUTES;
        const back = [o.restoredAt != null ? Math.round(o.restoredAt * 60) : null, world.supplies?.[person]?.power ?? null].filter((x): x is number => typeof x === "number");
        const backAt = back.length > 0 ? Math.min(...back) : Infinity;
        for (const u of turns) {
          const m = Math.round(u.at * 60);
          if (u.ai && u.color === "green" && m >= cutAt && m < backAt && !table.has(`${person}|${m}`) && !awayBy(m)) hit("down_green", person, m, `${d.category} 止まったまま緑`);
        }
        const endedAt = world.ended?.[person] ? end : null;
        if (until > end || endedAt !== null || back.some((x) => x <= until) || awayBy(until)) continue;
        checked += 1;
        if (!turns.some((u) => Math.round(u.at * 60) > cutAt && Math.round(u.at * 60) <= until)) hit("down_silent", person, cutAt, `${d.category} 予備が切れた時刻から ${DOWN_SILENT_MINUTES} 分`);
      }
    }
  }

  // 電池の残りの数の流れ（T158）。同じ人の言った残りから終わる時刻を出し、前に言った物と食い違う（予備に替えた・電気が戻ったと言わずに）
  for (const [person, segs] of batterySaid(byPerson, r.actions as LooseAction[])) {
    for (const said of segs) for (let i = 1; i < said.length; i++) {
      checked += 1;
      const a = said[i - 1];
      const b = said[i];
      if (b.spare && !a.spare) continue;
      const gap = Math.abs(b.end - a.end);
      if (gap > Math.max(CLOCK_DRIFT_MIN, (a.end - a.minute) * 0.25)) hit("clock_drift", person, b.minute, `${a.minute} 分に残り ${a.end - a.minute} 分 → ${b.minute} 分に残り ${b.end - b.minute} 分`);
    }
  }

  // 手も表の行も計画も無い業者の巡回（世界の到着。監督・世界が積んだ物は from が director・world）
  for (const x of (world.arrivals ?? [])) {
    if (!SUPPLY_ROLES.has(x.role) || (x.from !== "director" && x.from !== "world")) continue;
    checked += 1;
    const before = actions.filter((a) => a.atMinute <= x.arrive);
    if (!supplyAllowed(x.person, before, people[x.person]?.plan ?? null)) hit("supply_without_hand", x.person, x.arrive, `${x.role}${x.arrived ? " 着" : ""}`);
  }

  // 監督・世界の出来事の言い回しと種類の重なり（AI の人ごとの出来事。文をコードが書く種類は言い回しで見ない）
  const seen: Array<{ kind: string; person: string | null; text: string }> = [];
  const ticks = [...r.ticks].sort((a, b) => a.step - b.step);
  for (const t of ticks) {
    for (const e of t.incidents) {
      if (e.change?.kind === "outcome" && typeof (e.change as { reason?: unknown }).reason === "string") {
        checked += 1;
        const reason = (e.change as { reason: string }).reason;
        if (REASON_MEDICAL_WORDS.test(reason.normalize("NFKC"))) hit("reason_medical", e.person ?? null, Math.round((e.at ?? t.hour) * 60), cut(reason));
      }
      if (!e.ai || typeof e.inject !== "string" || !e.text) continue;
      checked += 1;
      const person = e.person ?? null;
      const minute = Math.round((e.at ?? t.hour) * 60);
      const own = isInjectKind(e.inject) && EVENT_CATALOG[e.inject].ownText === true;
      if (!own && seen.some((x) => x.person !== person && sameWording(x.text, e.text!))) hit("repeat_text", person, minute, `${e.inject}: ${cut(e.text)}`);
      const personKind = isInjectKind(e.inject) && EVENT_CATALOG[e.inject].scope === "person";
      if (personKind && seen.filter((x) => x.kind === e.inject).length >= KIND_REPEAT_MAX) hit("repeat_kind", person, minute, String(e.inject));
      seen.push({ kind: e.inject, person, text: e.text });
    }
  }
  // 行き先の分からない人があとで拾われない（T141）。家の外へ出た印から LOST_MAX_MINUTES ＋ 60 分のうちに、見つかった印・人の到着・訪問が無い
  const end = Math.max(...r.ticks.map((x) => Math.round(x.hour * 60)), 0);
  for (const lost of awayMarks.filter((m) => m.kind === "wandering")) {
    checked += 1;
    const until = Math.min(lost.minute + LOST_MAX_MINUTES + 60, end);
    if (until <= lost.minute) continue;
    const found = foundMarks.some((m) => m.person === lost.person && m.minute > lost.minute && m.minute <= until);
    const came =
      (world.arrivals ?? []).some((a) => a.person === lost.person && a.arrived && a.arrive > lost.minute && a.arrive <= until) ||
      actions.some((a) => a.person === lost.person && a.result?.visit !== undefined && a.result.atMinute > lost.minute && a.result.atMinute <= until);
    if (!found && !came && end >= lost.minute + LOST_MAX_MINUTES + 60) hit("lost_unresolved", lost.person, lost.minute, "家の外へ出た印のあと見つからない");
  }
  // 全体の出来事の同じ種類が、同じ文か短い間でくり返す（T141。lib/drill/time-odds.ts の areaRested の下限 0.75 倍より短い間）
  const areaSeen = new Map<string, Array<{ minute: number; text: string }>>();
  for (const t2 of ticks) {
    for (const e of t2.incidents) {
      if (!e.ai || typeof e.inject !== "string" || e.person || !e.text) continue;
      if (!isInjectKind(e.inject) || EVENT_CATALOG[e.inject].scope === "person") continue;
      const minute = Math.round((e.at ?? t2.hour) * 60);
      const prev = areaSeen.get(e.inject) ?? [];
      // 1 つの出来事の 2 行目（同じ種類・同じ時刻。家族と連絡がつかないと、その見込み）は数えない
      if (prev.some((x) => x.minute === minute)) continue;
      if (prev.length > 0) {
        checked += 1;
        const last = prev[prev.length - 1];
        if (prev.some((x) => x.text === e.text) || minute - last.minute < AREA_GAP_MINUTES * prev.length * 0.75) hit("area_repeat", null, minute, `${e.inject}: ${cut(e.text)}`);
      }
      areaSeen.set(e.inject, [...prev, { minute, text: e.text }]);
    }
  }
  return { checked, hits };
}

/** 帳面の門の決まりのほかに、台が数える型（T141。clock_drift は T158） */
export type FactExtraRule = "lost_unresolved" | "area_repeat" | "clock_drift" | "down_silent" | "down_green";

/** 機器の予備が切れてから連絡が無いと見る間（分。T167） */
export const DOWN_SILENT_MINUTES = 240;

/** 電池の残りの数の流れの食い違いと見る差（分）の下限（T158） */
export const CLOCK_DRIFT_MIN = 30;
/** 台が見る電池の話と残りの数（台が足した目安。本人役の門 person-facts.ts の物より広め） */
const BATTERY_WORDS = /電池|バッテリー|予備|ボンベ|呼吸器|濃縮器|吸引器|酸素/;
const NOT_BATTERY = /薬|栄養剤|透析|インスリン|水|食べ|ミルク|食事/;
const REMAIN_SAID = /(?:あと|残り(?:は|が)?|もう)\s*((?:約|およそ)?\s*(?:\d+(?:\.\d+)?|[一二三四五六七八九十]+)\s*(?:時間|分)半?)|((?:約|およそ)?\s*(?:\d+(?:\.\d+)?|[一二三四五六七八九十]+)\s*(?:時間|分)半?)(?:ほど|くらい|ぐらい|程度)?(?:しか|で|は)?(?:もち|持ち|もた|持た|切れ|なくな|無くな)/u;
const SPARE_SAID = /予備|替え|換え|交換|(?:に|へ)(?:かえ|変え)/;
/** 電気で動いている・切れた（残りの数の流れを切る言い方） */
const FLOW_RESET = /電気(?:が|で)?(?:戻|動|来)|電源(?:が|で)(?:届|動|つな)|切れ(?:ました|たまま|てしまい)/;

/** 本人ごとの電池の残りを言った所（発災からの分と、終わる時刻の見込み）。AI の言葉だけ */
function batterySaid(
  byPerson: ReadonlyMap<string, ReadonlyArray<LooseTurn & { at: number }>>,
  actions: ReadonlyArray<LooseAction>,
): Map<string, Array<Array<{ minute: number; end: number; spare: boolean }>>> {
  const raw = new Map<string, Array<{ minute: number; text: string }>>();
  const add = (person: string, minute: number, text: string | null | undefined) => {
    if (text) raw.set(person, [...(raw.get(person) ?? []), { minute, text }]);
  };
  for (const [person, turns] of byPerson) for (const u of turns) if (u.ai) add(person, Math.round(u.at * 60), u.saying);
  for (const a of actions) {
    const res = a.result;
    if (!a.person || !res || typeof res.atMinute !== "number") continue;
    if (res.speechAi !== false) add(a.person, res.atMinute, res.speech);
    for (const l of (res.talk ?? []) as Array<{ who?: string; text?: string; ai?: boolean; minute?: number }>) if (l.who !== "cm" && l.ai) add(a.person, typeof l.minute === "number" ? l.minute : res.atMinute, l.text);
  }
  const out = new Map<string, Array<Array<{ minute: number; end: number; spare: boolean }>>>();
  for (const [person, xs] of raw) {
    const segs: Array<Array<{ minute: number; end: number; spare: boolean }>> = [[]];
    for (const x of [...xs].sort((p, q) => p.minute - q.minute)) {
      // 電池の話は次の文にも続く（「電池に切り替わった。3 時間しかもたない」。ほかの話の文で切れる）
      let topic = false;
      let spare = false;
      for (const s of x.text.normalize("NFKC").split(/(?<=[。！？!?])/u)) {
        // 電気で動いた・切れた後の数は前の流れと比べない
        if (FLOW_RESET.test(s)) {
          if (segs[segs.length - 1].length > 0) segs.push([]);
          topic = false;
          continue;
        }
        topic = BATTERY_WORDS.test(s) ? !NOT_BATTERY.test(s) : NOT_BATTERY.test(s) ? false : topic;
        spare = topic && (spare || SPARE_SAID.test(s));
        if (!topic) continue;
        const m = s.match(REMAIN_SAID);
        const phrase = m?.[1] ?? m?.[2];
        const left = phrase ? amountMinutes(phrase) : null;
        if (left === null) continue;
        segs[segs.length - 1].push({ minute: x.minute, end: x.minute + left, spare });
      }
    }
    out.set(person, segs.filter((g) => g.length > 1));
  }
  return out;
}

/**
 * 言葉の文ごとの帳面との食い違い（T141 で直せる物も数える: 前からの電池切れを新しい事のように言う・残りの数が帳面と違う）。
 * 門（lib/drill/person-facts.ts の dropFactSlips）と同じ物差しで、電池の話は次の文にも続くと見る
 */
function sentenceHits(text: string, ctx0: Parameters<typeof sentenceSlip>[1]): Array<{ rule: GateRule; text: string }> {
  const out: Array<{ rule: GateRule; text: string }> = [];
  const ctx = wholeContext(text, ctx0);
  let battery = false;
  for (const s of text.split(/(?<=[。！？!?])/u)) {
    if (!s.trim()) continue;
    const fix = sentenceFix(s, ctx, battery);
    battery = batteryTopicNext(s, battery);
    for (const r of fix.rules) out.push({ rule: r, text: s });
    const rule = fix.drop ?? sentenceSlip(fix.text, ctx);
    if (rule) out.push({ rule, text: s });
  }
  return out;
}

/** その分より前の、その人のいちばん新しい安否 */
function lastStateBefore(turns: ReadonlyArray<LooseTurn & { at: number }>, minute: number): PersonState | null {
  let out: PersonState | null = null;
  // いる所は前の様子から引き継ぐ（T158。本人役の門が見る本人の様子と同じ）
  for (const u of turns) if (Math.round(u.at * 60) <= minute) out = stateOf(u, out);
  return out;
}
