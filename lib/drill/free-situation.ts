// 自由対応の「今の状況」（docs/tasks/T129.md の 4）。自由対応の AI（lib/drill/free-action.ts）に、この状況でこの文の行動をすると
// 何が起きるかを決めさせるための事実の文と、ケアマネが今いる所。
//
// 線:
// - 元にする事実は、ケアマネに分かっている事実だけ（T105 の公表の線、T94 の knownOf・T110 の手の可否の決まりと同じ元）。
//   本人に起きたことで知らせの無い物（栄養剤の持ち出し忘れ・訪問看護の都合など）は書かない
// - 名前・町名・施設の名前を書かない（数と状態の言葉だけ）。文は仮名化の門（pseudonymizeText）を通してから Claude に渡す
// - 色と連絡順（lib/triage）は読まない・書かない。本人の様子は最後の連絡の言葉（personWords）で、色の順位は渡さない
//
// D1・Claude を読まない純な計算。

import { effectiveKind, isOwnFree } from "./action-catalog.ts";
import { dayHourOf, isDark, type TermSource } from "./action-terms.ts";
import type { ActionRecord } from "./action-types.ts";
import { ARRIVAL_ROLE_LABELS } from "./event-catalog.ts";
import { clockLabel, PHONE_LABELS, TSUNAMI_LABELS } from "./labels.ts";
import type { PersonState } from "./persona-types.ts";
import type { WorldState } from "./scenarios.ts";
import { askWords, personWords } from "./score-labels.ts";

// ---------- ケアマネが今いる所 ----------

/** ケアマネが今いる所。home は訪問で着いた家（本人の id）。shelter は自分の避難のあと */
export type CmWhere = { kind: "office" } | { kind: "home"; person: string } | { kind: "shelter" };

/** 今いる所の言葉（2〜3 字） */
export const WHERE_LABELS = { office: "事業所", home: "訪問先", shelter: "避難先" } as const;

/**
 * 打った手から、ケアマネが今いる所を決める（保存しない。手の記録から毎回作る）。
 * 訪問で着いた家（訪問・そのままの手の訪問）にいて、次に出向く手（訪問・自分の避難）まで動かない。
 * 着けずに引き返した訪問は事業所に戻ったとする。通行止で出られなかった訪問は動かない
 */
export function whereOf(actions: ReadonlyArray<Pick<ActionRecord, "kind" | "as" | "way" | "person" | "result">>): CmWhere {
  let where: CmWhere = { kind: "office" };
  for (const a of actions) {
    const r = a.result;
    if (!r) continue;
    const k = effectiveKind(a);
    if (k === "evacuate_self") {
      if (r.ok) where = { kind: "shelter" };
    } else if (k === "visit" && a.person) {
      if (r.status === "arrived") where = { kind: "home", person: a.person };
      else if (r.status === "turnedBack") where = { kind: "office" };
    } else if (isOwnFree(a) && a.way === "visit" && a.person && r.ok) {
      where = { kind: "home", person: a.person };
    }
  }
  return where;
}

/** ケアマネがその本人の家にいるか（その場で会える） */
export const atHomeOf = (where: CmWhere, person: string | null): boolean => person !== null && where.kind === "home" && where.person === person;

// ---------- 状況の文 ----------

/** 状況の文の元（訓練の状態の要る所だけ） */
export type SituationSource = Omit<TermSource, "world"> & {
  world: TermSource["world"] & Partial<Pick<WorldState, "quake" | "shelters" | "asks" | "arrivals" | "advised">>;
  people?: Readonly<Record<string, PersonState>>;
  actions?: ReadonlyArray<ActionRecord>;
};

const SHELTER_OPEN = new Set(["open", "crowded"]);

/**
 * 今の状況の文（Claude に渡す前。仮名化の門で伏せる）。対象の本人がいれば、その人について分かっている事も。
 * 1 行 1 事実の「名前: 値」。名前・町名・施設の名前は書かない
 */
export function situationText(s: SituationSource, person: string | null): string {
  const w = s.world;
  const hour = dayHourOf(s.startedAt, s.minute, s.options?.night === true);
  const where = whereOf(s.actions ?? []);
  const lines: string[] = [];
  lines.push(`時刻: 発災から ${clockLabel(s.minute)}（${hour} 時台、${isDark(hour) ? "夜で暗い" : "明るい"}）`);
  lines.push(
    `今いる所: ${
      where.kind === "home"
        ? `${WHERE_LABELS.home}（${person !== null && where.person === person ? "対象の本人の家" : "ほかの人の家"}）`
        : WHERE_LABELS[where.kind]
    }`,
  );
  lines.push(`電話: ${PHONE_LABELS[w.phone]}`);
  const o = w.outage;
  if (o && o.restoredAt === null) {
    const hours = Math.max(0, Math.floor(s.minute / 60 - o.since));
    lines.push(`停電: 続いている（${hours} 時間、${o.area.scope === "office" ? "事業所を含む" : "一部の地区"}）`);
  } else if (o) {
    lines.push("停電: 復旧");
  }
  if (w.quake) lines.push(`揺れ: 震度 ${w.quake}`);
  if (w.alertLevel) lines.push(`警戒: レベル ${w.alertLevel}`);
  if (w.flood) lines.push("浸水: あり");
  if (w.tsunami !== "none") lines.push(`津波: ${TSUNAMI_LABELS[w.tsunami]}`);
  const shelters = (w.shelters ?? []).filter((x) => x.person === null);
  if (shelters.length > 0) lines.push(`避難所: 開設 ${shelters.filter((x) => SHELTER_OPEN.has(x.state)).length} か所・満員 ${shelters.filter((x) => x.state === "full").length} か所`);
  lines.push(`職員の空き: ${w.staff} 人`);
  if (person) {
    const marks = w.marks[person] ?? {};
    lines.push(`対象の本人の家の電話: ${marks.lineDown !== undefined ? PHONE_LABELS.down : PHONE_LABELS[w.phone]}`);
    lines.push(`対象の本人の家の前の道: ${w.roads.some((r) => r.person === person && !r.open) ? "通行止" : "通れる"}`);
    const closed = w.facilities.filter((f) => f.person === person && !f.open).length;
    if (closed > 0) lines.push(`対象の本人の頼り先: 休止 ${closed} か所`);
    lines.push(`対象の本人の最後の連絡: ${personWords({ person: s.people?.[person] ?? null })}`);
    const asks = (w.asks?.[person] ?? []).filter((a) => a.done === null).map((a) => a.kind);
    if (asks.length > 0) lines.push(`対象の本人の頼み事: ${askWords(asks)}`);
    const coming = (w.arrivals ?? []).filter((a) => a.person === person && !a.arrived);
    if (coming.length > 0) lines.push(`対象の本人の家へ向かっている人: ${coming.map((a) => `${ARRIVAL_ROLE_LABELS[a.role]}（${clockLabel(a.arrive)}ごろ）`).join("、")}`);
    const advised = w.advised?.[person];
    if (advised !== undefined) lines.push(`119 への連絡: ${clockLabel(advised)}に勧めた`);
  }
  return lines.join("\n");
}
