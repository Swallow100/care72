// 想定の表の配役（docs/tasks/T70.md の 1）。想定の表の人ごとの行・出来事はデモ事業所の 10 人（p-01〜p-10）を指す。
// 新しい事業所ではその人がいないので、行に添えた「どんな人の行か」（who）で、参加者の台帳から代わりの人を選ぶ。Claude を呼ばない。
//
// - 行の person が事業所にいれば、その人のまま（デモ事業所は参加者を絞っても今と同じ。絞った人の行は捨てる）
// - 事業所にいない person の行は、who に合う参加者のうち、まだその想定で配られていない人をカナ順で（参加者の並び = 担当一覧のよみの順）。
//   同じ person の行はまとめて同じ人に配る（3 田中の 0・12・18・48 時間の行が 1 人の筋になる）。
//   合う人の少ない行から配り（呼吸器の人が 1 人なら先に呼吸器の行へ）、誰でもよい行（any）は最後。
//   合う人がいなければ行を捨てる（今の動き）
// - 決めた配役は DrillState.cast（drills.world の JSON）に、代わりの人に配った行だけを持つ。全部 person のままなら持たない
//   （デモ事業所の訓練・種の訓練の JSON は前と同じ）
// - 色と順位はここで決めない。行の安否を誰の物にするかだけ

import type { ClockCategory, DeviceKind, HazardKind, Household } from "../db/types.ts";
import { injectChange, type FixedTurn, type Scenario, type WorldEvent } from "./scenarios.ts";

/**
 * 行に当てる人の選び方（台帳の中身で選ぶ）。device 機器・clock 時計の区分（透析・インスリン）・hazard ハザード（深さの下限）・
 * household 独居・smartphone 本人も連絡先も押せない人・any 誰でも
 */
export type CastPick =
  | { device: DeviceKind }
  | { clock: ClockCategory }
  | { hazard: HazardKind; minDepthM?: number }
  | { household: Extract<Household, "alone"> }
  | { smartphone: "none" }
  | { any: true };

/** 配役に使う台帳の事実（サーバーの中だけ。Claude に渡さない） */
export type CastFacts = {
  devices: ReadonlyArray<string>;
  /** 時計の区分と薬の区分（インスリンは薬にも時計にもある） */
  clocks: ReadonlyArray<string>;
  hazards: ReadonlyArray<{ kind: HazardKind; depthM: number | null }>;
  household: Household | null;
  /** スマホで赤緑を押せる人がいる（本人か、家族・支援者。lib/drill/persona.ts の reportersOf） */
  canPress: boolean;
};

/** 行の鍵 → 代わりの人（台帳の id）。代わりの人に配った行だけ */
export type Cast = Record<string, string>;

export const eventKey = (hour: number, i: number) => `${hour}:e${i}`;
export const turnKey = (hour: number, i: number) => `${hour}:t${i}`;

/** who に合うか。機器と時計は同じ区分の名前を両方見る（透析は機器にも時計にもある） */
export function matchesPick(f: CastFacts, who: CastPick): boolean {
  if ("any" in who) return true;
  if ("device" in who) return f.devices.includes(who.device) || f.clocks.includes(who.device);
  if ("clock" in who) return f.clocks.includes(who.clock) || f.devices.includes(who.clock);
  if ("hazard" in who) return f.hazards.some((h) => h.kind === who.hazard && (h.depthM ?? 0) >= (who.minDepthM ?? 0));
  if ("household" in who) return f.household === who.household;
  return !f.canPress;
}

type Row = { key: string; person: string; who: CastPick | undefined };

/** 想定の表の人を指す行（出来事は person のある物だけ） */
function rowsOf(s: Scenario): Row[] {
  const out: Row[] = [];
  for (const t of s.ticks) {
    t.events.forEach((e, i) => {
      if (e.person) out.push({ key: eventKey(t.hour, i), person: e.person, who: e.who });
    });
    t.turns.forEach((x, i) => out.push({ key: turnKey(t.hour, i), person: x.person, who: x.who }));
  }
  return out;
}

/**
 * 想定の行ごとの配役。participants は担当一覧の順（よみ）。facts は事業所の人の台帳の事実（事業所にいるかもこれで見る）。
 * 代わりの人に配った行だけを返す（全部 person のままなら空）
 */
export function castScenario(scenario: Scenario, participants: ReadonlyArray<string>, facts: ReadonlyMap<string, CastFacts>): Cast {
  const rows = rowsOf(scenario);
  // 事業所にいない person ごとに、最初に who のある行の who
  const missing = new Map<string, CastPick | undefined>();
  for (const r of rows) {
    if (facts.has(r.person)) continue;
    if (!missing.has(r.person) || (missing.get(r.person) === undefined && r.who)) missing.set(r.person, r.who);
  }
  const members = new Set(participants);
  const dealt = new Set(rows.filter((r) => members.has(r.person)).map((r) => r.person));
  const open = [...missing].filter((g): g is [string, CastPick] => g[1] !== undefined);
  const candidates = (who: CastPick) => participants.filter((p) => !dealt.has(p) && facts.has(p) && matchesPick(facts.get(p)!, who));
  const sub = new Map<string, string>();
  // 安否の行の数（出来事だけの人より、連絡してくる人を先に配る）
  const turns = new Map<string, number>();
  for (const r of rows) if (r.key.includes(":t")) turns.set(r.person, (turns.get(r.person) ?? 0) + 1);
  // 合う人の少ない行から配る（誰でもよい行は最後。同じ数なら安否の行の多い人、それも同じなら表の順）。1 人に配るたびに数え直す
  while (open.length > 0) {
    let best = -1;
    let bestRank: [number, number] = [Infinity, Infinity];
    open.forEach(([person, who], i) => {
      const rank: [number, number] = ["any" in who ? Number.MAX_SAFE_INTEGER : candidates(who).length, -(turns.get(person) ?? 0)];
      if (rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) [best, bestRank] = [i, rank];
    });
    const [person, who] = open.splice(best, 1)[0];
    const hit = candidates(who)[0];
    if (!hit) continue;
    sub.set(person, hit);
    dealt.add(hit);
  }
  const cast: Cast = {};
  for (const r of rows) {
    const p = sub.get(r.person);
    if (p) cast[r.key] = p;
  }
  return cast;
}

/** 想定の行のうち、配役で事業所の外の人を指す物があるか（無ければ台帳を読まずに済む） */
export function needsCast(scenario: Scenario, participants: ReadonlyArray<string>): boolean {
  const members = new Set(participants);
  return rowsOf(scenario).some((r) => !members.has(r.person) && r.who !== undefined);
}

/**
 * 本人役を呼びうる人か（開始の前の見込み、lib/drill/estimate.ts）。押せる人がいるか、想定に当たりうる行がある
 * （その人の行か、who に合う行。参加者の選び方で配役が変わるので、当たりうる物を全部数える = 上限の側）
 */
export function mayBeCalled(scenario: Scenario, person: string, f: CastFacts): boolean {
  if (f.canPress) return true;
  return rowsOf(scenario).some((r) => r.person === person || (r.who !== undefined && matchesPick(f, r.who)));
}

/** 出来事 1 つを配役で引く。代わりの人がいれば person を替え、差し込みは世界の変化も組み直す（施設・道の id は人ごと） */
export function castEvent(e: WorldEvent, sub: string | undefined): WorldEvent {
  if (!sub || !e.person) return e;
  return { ...e, person: sub, ...(e.inject ? { change: injectChange(e.inject, sub) } : {}) };
}

/** 本人の行 1 つを配役で引く */
export function castTurn(t: FixedTurn, sub: string | undefined): FixedTurn {
  return sub ? { ...t, person: sub } : t;
}
