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
  factsOf,
  KIND_REPEAT_MAX,
  placeFlipped,
  placeOfState,
  powerBack,
  sameWording,
  sentenceSlip,
  slipContextOf,
  supplyAllowed,
  SUPPLY_ROLES,
  type GateRule,
  type Plan,
} from "../../../lib/drill/person-facts.ts";
import type { ActionRecord } from "../../../lib/drill/action-types.ts";
import type { PersonState } from "../../../lib/drill/persona-types.ts";
import type { WorldState } from "../../../lib/drill/scenarios.ts";
import { REASON_MEDICAL_WORDS } from "../../../lib/drill/world-apply.ts";
import type { CheckHit } from "./checks.ts";
import type { LooseAction, LooseTurn, RunOutcome } from "./drive.ts";

/** 帳面の検査に要る本人ごとの台帳の事実（台が種の台帳から作る。lib/drill/persona.ts の housemates と planOf） */
export type FactPerson = {
  plan: Plan;
  together: ReadonlyArray<string>;
  kin: ReadonlyArray<string> | null;
  hazards: ReadonlyArray<{ kind: string; depthM?: number | null }>;
  town: string | null;
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

const stateOf = (u: LooseTurn & { at: number }): PersonState => ({
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
});

const cut = (t: string) => Array.from(t).slice(0, 40).join("");

/** 想定の表の行の安否（本人と発災からの分）。表の行は骨なので、いる所と声の門の外（言葉は見る）。配役（T70）を当てる */
function tableTurns(outcome: RunOutcome): Set<string> {
  const out = new Set<string>();
  const cast = outcome.cast ?? {};
  for (const t of scenarioOf(outcome.plan.scenario as DrillScenario).ticks) {
    t.turns.forEach((raw, i) => {
      const r = castTurn(raw, cast[turnKey(t.hour, i)]);
      out.add(`${r.person}|${Math.round(eventHour(r, t.hour) * 60)}`);
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
  const hit = (rule: GateRule, person: string | null, minute: number | null, evidence: string) => hits.push({ check: "facts", rule, person, minute, evidence });
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
  const awayMarks: Array<{ person: string; minute: number }> = [];
  for (const t of r.ticks) {
    for (const e of t.incidents) {
      const k = e.change?.kind;
      const mark = k === "mark" ? (e.change as { mark?: unknown }).mark : null;
      if (e.person && (k === "going_home" || mark === "wandering" || mark === "carSleep")) awayMarks.push({ person: e.person, minute: Math.round((e.at ?? t.hour) * 60) });
    }
  }
  const awayAt = (person: string, minute: number): boolean =>
    awayMarks.some((m) => m.person === person && m.minute <= minute && !(world.arrivals ?? []).some((a) => a.person === person && a.arrived && a.arrive > m.minute && a.arrive <= minute));
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
        if (!row && prevPlace && place && placeFlipped(prevPlace, place) && !f.help && !awayAt(person, minute)) {
          const leaving = prevPlace === "home";
          const ok = leaving ? !!f.plan?.move && (!f.hurt || f.plan.helper) : RETURNED.test(words.normalize("NFKC"));
          if (!ok) hit("place_flip", person, minute, `${prevPlace} → ${place}`);
        }
        const ctx = { ...slipContextOf(f, place ?? f.place?.where ?? null), ...(u.source === "family" ? { kin: null } : {}) };
        for (const [field, text] of [["saying", u.saying], ["doing", u.doing]] as const) {
          if (!text) continue;
          for (const s of text.split(/(?<=[。！？!?])/u)) {
            const rule = sentenceSlip(s, ctx);
            if (rule) hit(rule, person, minute, `${field}: ${cut(s)}`);
          }
        }
      }
      prev = stateOf(u);
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
    const ctx = { ...slipContextOf(f), kin: null };
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
      for (const s of text.split(/(?<=[。！？!?])/u)) {
        const rule = sentenceSlip(s, field.startsWith("visit") ? { ...ctx, place: "home" } : ctx);
        if (rule) hit(rule, person, minute, `${field}: ${cut(s)}`);
      }
    }
    const asks = [...((res.talk ?? []) as Array<{ ask?: unknown; asks?: unknown }>).flatMap((l) => (Array.isArray(l.asks) ? l.asks : [])), ...(res.visit?.asks ?? [])];
    if (powerBack(f) && asks.some((k) => k === "power" || k === "battery")) hit("ask_after_power", person, minute, "頼み事 電源・電池");
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
  return { checked, hits };
}

/** その分より前の、その人のいちばん新しい安否 */
function lastStateBefore(turns: ReadonlyArray<LooseTurn & { at: number }>, minute: number): PersonState | null {
  let out: PersonState | null = null;
  for (const u of turns) if (Math.round(u.at * 60) <= minute) out = stateOf(u);
  return out;
}
