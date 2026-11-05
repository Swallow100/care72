// 計画の状態の出し方（T146）。担当一覧の表 2 つ・右の面・本人のページの頭・事業所の画面・CSV が、ここの言い方を使う。
//
// DB の plan_status は 4 つ（none・draft・consented・trained）のまま変えない。画面と紙には計画の段階を 3 つで出す:
// 未作成・下書き・作成済（consented・trained はどちらも作成済）。「訓練済」は計画の段階の 1 つに見えて作成済と取り違えやすいので、
// 訓練に出たことは段階と別に「訓練 11/5」（その人が最後に出た終わった訓練の日、lib/drill/last.ts）と並べる。
// 色は意味色のまま（未作成 灰・下書き 黄・作成済 緑）。訓練の日は状態でないので色を付けない。
// どれも色と連絡順（lib/triage）には使わない。

import { todayJst } from "./age.ts";
import type { PlanStatus } from "./db/types.ts";
import { PLAN_DRILL_LABELS, PLAN_STATUS_LABELS } from "./labels.ts";
import type { StateTone } from "./person.ts";

/** 画面に出す計画の段階 */
export const PLAN_STAGES = ["none", "draft", "made"] as const;
export type PlanStage = (typeof PLAN_STAGES)[number];

/** DB の状態から画面の段階へ（同意済・訓練済は作成済） */
export function planStage(s: PlanStatus): PlanStage {
  return s === "none" || s === "draft" ? s : "made";
}

/** 段階の言葉（PLAN_STATUS_LABELS と同じ字） */
export const PLAN_STAGE_LABELS: Record<PlanStage, string> = {
  none: PLAN_STATUS_LABELS.none,
  draft: PLAN_STATUS_LABELS.draft,
  made: PLAN_STATUS_LABELS.consented,
};

/**
 * 計画の状態の色（意味色。CLAUDE.md「画面の決まり」）。未作成は灰、下書きは黄（要確認）、作成済（同意済・訓練済）は緑。
 * 色は印と数字にだけ置き、必ず段階の文字（未作成・下書き・作成済）を添える
 */
export const PLAN_TONES: Record<PlanStatus, StateTone> = { none: "unknown", draft: "check", consented: "ok", trained: "ok" };
export const PLAN_STAGE_TONES: Record<PlanStage, StateTone> = { none: "unknown", draft: "check", made: "ok" };

/** 最後に出た訓練の言い方。done は日付の有無に関わらず訓練に出た印（数える・並べるのに使う） */
export type DrillMark = { text: string; done: boolean };

/** YYYY-MM-DD を「11/5」に（違う年は「2025/11/5」） */
function dayText(day: string, today: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const md = `${Number(m[2])}/${Number(m[3])}`;
  return m[1] === today.slice(0, 4) ? md : `${m[1]}/${md}`;
}

/**
 * 訓練の欄の値。day はその人が最後に出た終わった訓練の日（JST の YYYY-MM-DD。無ければ null）。
 * 訓練の記録が無くて DB の状態が trained の人（前からの種の値）は日付無しの「済」。どちらも無ければ「未実施」
 */
export function drillMark(day: string | null | undefined, plan: PlanStatus, today: string = todayJst()): DrillMark {
  if (day) return { text: dayText(day, today), done: true };
  if (plan === "trained") return { text: PLAN_DRILL_LABELS.done, done: true };
  return { text: PLAN_DRILL_LABELS.none, done: false };
}

/** 「訓練 11/5」「訓練 未実施」（CSV・1 行の言い方） */
export function drillLine(day: string | null | undefined, plan: PlanStatus, today?: string): string {
  return `${PLAN_DRILL_LABELS.head} ${drillMark(day, plan, today).text}`;
}

const STAGE_RANK: Record<PlanStage, number> = { none: 0, draft: 1, made: 2 };

/** 訓練の並びの鍵: 未実施 → 日付無しの済 → 日付の古い順 */
function drillKey(day: string | null | undefined, plan: PlanStatus): string {
  if (day) return `2${day}`;
  return plan === "trained" ? "1" : "0";
}

/**
 * 計画の列の並び（昇順）: 見えている段階の順（未作成 → 下書き → 作成済）、同じ段階の中は訓練（未実施 → 済 → 古い日）。
 * 同意済と訓練済は同じ「作成済」なので、DB の値では分けない
 */
export function comparePlan(
  a: { plan: PlanStatus; drill?: string | null },
  b: { plan: PlanStatus; drill?: string | null },
): number {
  const s = STAGE_RANK[planStage(a.plan)] - STAGE_RANK[planStage(b.plan)];
  if (s !== 0) return s;
  const ka = drillKey(a.drill, a.plan);
  const kb = drillKey(b.drill, b.plan);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
