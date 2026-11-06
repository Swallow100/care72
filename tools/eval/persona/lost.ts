// 迷いを数える（docs/tasks/T156.md）。手の記録だけから台が決める（AI に決めさせない）。
// - 見つからない: 1 つの目標の中で同じ画面（道と見た目の指紋）に 3 回来た、同じ画面で同じ物を 3 回押した
// - 読み違い: 使う人が「前の手の結果が思ったのと違う」と言った（その前の手に付ける）、果たしたと言ったのに台の印が立っていない
// - 行き止まり: 押せなかった、押しても画面が何も変わらない、あきらめた
// - 戻り: ブラウザの戻る、「戻る」を押した
// - エラー: HTTP の 4xx・5xx と頁の例外、押したあとに新しく出た断りの知らせ
// - 時間切れ: 目標の手の上限・筋の手の上限・時間の上限で止めた（walk.ts が目標ごとに付ける）

import type { LostEvent, StepRecord } from "./types.ts";

/** 断り・失敗の知らせの言葉（押したあとに新しく出た物だけ数える） */
export const ERROR_WORDS = /エラー|失敗|できない|できません|未入力|見つから|権限|無効|競合|違う|不足|断り|超過/;

const BACK_NAMES = new Set(["戻る"]);

export function lostOf(steps: readonly StepRecord[]): LostEvent[] {
  const out: LostEvent[] = [];
  const visits = new Map<string, number>();
  const presses = new Map<string, number>();
  const flagged = new Set<string>();
  let goal = "";
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    if (st.goal !== goal) {
      goal = st.goal;
      visits.clear();
      presses.clear();
    }
    const ev = (kind: LostEvent["kind"], note: string, at: StepRecord = st): LostEvent => ({
      kind,
      step: at.n,
      goal: at.goal,
      path: at.before.path,
      target: at.target?.name ?? null,
      thought: at.move.thought || null,
      note,
    });

    // 見つからない
    const key = `${st.before.path}|${st.before.hash}`;
    const seen = (visits.get(key) ?? 0) + 1;
    visits.set(key, seen);
    if (seen === 3 && !flagged.has(`v|${goal}|${key}`)) {
      flagged.add(`v|${goal}|${key}`);
      out.push(ev("not_found", "同じ画面に 3 回"));
    }
    if (st.target && st.move.action === "click") {
      const pk = `${st.before.path}|${st.target.name}`;
      const n = (presses.get(pk) ?? 0) + 1;
      presses.set(pk, n);
      if (n === 3 && !flagged.has(`p|${goal}|${pk}`)) {
        flagged.add(`p|${goal}|${pk}`);
        out.push(ev("not_found", "同じ物を 3 回押した"));
      }
    }

    // 読み違い（前の手に付ける）
    if (st.move.surprised && i > 0) out.push(ev("misread", "前の手の結果が思ったのと違う", steps[i - 1]));
    if (st.move.action === "done" && !st.reached.includes(st.goal)) out.push(ev("misread", "果たしたと思ったが未達"));

    // 行き止まり
    if (!st.result.ok) out.push(ev("dead_end", st.result.error ? `押せない（${st.result.error.slice(0, 40)}）` : "押せない"));
    else if (
      (st.move.action === "click" || st.move.action === "select") &&
      st.before.path === st.after.path &&
      st.before.hash === st.after.hash &&
      st.before.look === st.after.look &&
      st.after.alerts.length === 0 &&
      // 画面の切替で今の画面を押した（何も起きないのが正しい）は数えない
      !st.target?.zone?.startsWith("切替")
    ) {
      out.push(ev("dead_end", "押しても画面が変わらない"));
    }
    if (st.move.action === "give_up") out.push(ev("dead_end", "あきらめた"));

    // 戻り
    if (st.move.action === "back") out.push(ev("back", "ブラウザの戻る"));
    else if (st.move.action === "click" && st.target && BACK_NAMES.has(st.target.name)) out.push(ev("back", "「戻る」を押した"));

    // エラー
    if (st.after.errors.length > 0) out.push(ev("error", st.after.errors.slice(0, 3).join("・")));
    const fresh = st.after.alerts.filter((a) => !st.before.alerts.includes(a) && ERROR_WORDS.test(a));
    if (fresh.length > 0) out.push(ev("error", `知らせ「${fresh[0].slice(0, 40)}」`));
  }
  return out;
}

export function countByKind(events: readonly LostEvent[]): Record<LostEvent["kind"], number> {
  const c = { not_found: 0, misread: 0, dead_end: 0, back: 0, error: 0, timeout: 0 };
  for (const e of events) c[e.kind] += 1;
  return c;
}
