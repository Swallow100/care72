// 訓練の「AI 停止」の帯（T76。docs/progress/qa-20261104.md の高 2）。刻みごとに「世界 停止」「本人役 停止」を積まず、訓練の画面と紙面に 1 本だけ出す。
//
// engine の今の動き（lib/drill/engine.ts・hooks.ts・persona.ts・director.ts・world-room.ts）をそのまま言葉にする。動きは変えない:
// - 固定の筋（大雨・地震・10 分版）: AI が止まっても、想定の表の出来事と表の安否で最後まで進む（監督の差し込みと本人役の言葉が無くなる）→「想定のみ」
// - 仮想: 表の出来事も本人の行も無いので、世界（街の出来事・結末）も本人役の連絡も止まる。ケアマネの対応と時計は進む →「世界停止」
// - 止まった役は 1 要求ごとに作り直し、次の「進める」で毎回 AI を呼び直す。だから再開のボタンは無く、戻れば次の刻みから勝手に戻る:
//   失敗（時間切れ・形の違い）は次の刻みで再試行、上限到達は日が替わる（JST）まで、未設定（鍵なし）は戻らない。
//
// 止まった刻みの跡（保存した状況）: 上限の印（ai_stop）、世界の止まり（world_note off。鍵なし・DRILL_WORLD=off）、
// 世界の失敗（world_note down で世界の 1 文 narration が無い）。固定の筋の鍵なしは刻みに跡が残らないので、進行中は今の状態（lib/claude/status.ts）で補う。
// 色は使わない（AI の状態は人の安否ではない。中立の印）。

import { AI_STATUS_LABELS, type AiStatus } from "../claude/status.ts";
import type { DrillIncident, Tick } from "./engine.ts";
import { AI_STOP_UI, DRILL_LABELS } from "./labels.ts";
import { CAP_REASON, CLOCK_LABELS } from "./clock.ts";

/** cap は連続の時計の訓練（T90）の 1 訓練の上限（150 回、lib/drill/clock.ts）。戻らない */
export type AiStopReason = "unset" | "limit" | "failed" | "cap";

/** 戻り方。next = 次の刻みで呼び直す、tomorrow = 上限の日が替われば戻る、done = もう戻った、null = 戻らない（未設定）か再生 */
export type AiStopResume = "next" | "tomorrow" | "done" | null;

export type AiStopBand = {
  reason: AiStopReason;
  /** 止まり始めた刻みの時刻（発災からの時間）。"next" はまだ止まった刻みが無く、次の刻みから止まる（上限に今達した） */
  from: number | "next";
  /** 戻った（止まった最後の刻みの時刻）。まだ止まっていれば null */
  to: number | null;
  resume: AiStopResume;
  /** 仮想（世界停止）か固定の筋（想定のみ）か */
  virtual: boolean;
  /** 訓練の最初の刻みから止まっている（「経過 0 時間〜」を言わない） */
  whole: boolean;
};

type TickLike = Pick<Tick, "hour" | "incidents"> & { turns?: Tick["turns"] };

/** 区切りに AI の出した物（監督の差し込み・世界の 1 文・本人役の安否）があるか */
function hasAi(t: TickLike): boolean {
  return t.incidents.some((e) => e.ai || e.change.kind === "narration") || (t.turns ?? []).some((x) => x.ai);
}

function hasNarration(t: Pick<Tick, "incidents">): boolean {
  return t.incidents.some((e) => e.change.kind === "narration");
}

/** 止まった印の状況か（帯にまとめ、刻みの行と紙面の行からは外す）。世界が 1 回呼びで動いた刻みの「代替」は止まりでない */
export function isStopIncident(e: DrillIncident, tick: Pick<Tick, "incidents">): boolean {
  if (e.change.kind === "ai_stop") return true;
  if (e.change.kind !== "world_note") return false;
  return e.change.state === "off" || !hasNarration(tick);
}

/** 刻みが AI の止まった刻みなら理由。1 訓練の上限（T90）が先、次に 1 日の上限の印（上限で世界も落ちると world_note down も並ぶ） */
export function tickStopReason(t: Pick<Tick, "incidents">): AiStopReason | null {
  if (t.incidents.some((e) => e.change.kind === "ai_stop" && e.reason === CAP_REASON)) return "cap";
  if (t.incidents.some((e) => e.change.kind === "ai_stop")) return "limit";
  const notes = t.incidents.filter((e) => e.change.kind === "world_note");
  if (notes.some((e) => e.change.kind === "world_note" && e.change.state === "off")) return "unset";
  if (notes.length > 0 && !hasNarration(t)) return "failed";
  return null;
}

/**
 * 帯 1 本（無ければ null）。刻みの跡の一番新しい止まりの続き（見ている刻みまで）と、進行中なら今の状態。
 * 進行中: 今が未設定なら未設定（固定の筋の鍵なしは跡が無いので最初から）、今が上限到達なら上限到達（まだ止まった刻みが無ければ「次から」）
 */
export function aiStopBand(
  ticks: ReadonlyArray<TickLike>,
  opts: { virtual: boolean; running: boolean; now: AiStatus | null; clock?: boolean },
): AiStopBand | null {
  const first = ticks[0]?.hour ?? 0;
  let cur: { reason: AiStopReason; from: number; to: number } | null = null;
  let ended: { reason: AiStopReason; from: number; to: number } | null = null;
  for (const t of ticks) {
    const r = tickStopReason(t);
    if (r) cur = cur ? { reason: r, from: cur.from, to: t.hour } : { reason: r, from: t.hour, to: t.hour };
    // 連続の時計（T90）は AI を呼ばない区切り（空の 30 分・手の途中）があるので、AI の出した物の無い区切りでは止まりを終えない
    else if (cur && opts.clock && !hasAi(t)) continue;
    else if (cur) {
      ended = cur;
      cur = null;
    }
  }
  const band = (reason: AiStopReason, from: number | "next", to: number | null, resume: AiStopResume): AiStopBand => ({
    reason,
    from,
    to,
    resume,
    virtual: opts.virtual,
    whole: from === first && to === null,
  });

  // 1 訓練の上限（T90）は日が替わっても戻らない
  if (cur?.reason === "cap") return band("cap", cur.from, null, null);
  if (opts.running && opts.now?.kind === "unset") return band("unset", cur?.from ?? first, null, null);
  if (opts.running && opts.now?.kind === "limit") return band("limit", cur?.from ?? "next", null, "tomorrow");
  if (cur) {
    if (!opts.running) return band(cur.reason, cur.from, null, null);
    // 今は使える（か読めない）: 次の刻みで呼び直す。上限の止まりも、日が替わっていれば次の刻みで戻る
    return band(cur.reason, cur.from, null, cur.reason === "unset" ? null : "next");
  }
  if (ended) return band(ended.reason, ended.from, ended.to, "done");
  return null;
}

/** 帯の言葉の組（画面と紙面で同じ）。span は「経過 6 時間〜」「経過 6〜9 時間」「次から」、最初から止まっていれば null */
export function aiStopParts(b: AiStopBand): { title: string; reason: string; span: string | null; effect: string; effectTitle: string; resume: string | null } {
  const reason = { unset: AI_STATUS_LABELS.unset, limit: AI_STATUS_LABELS.limit, failed: AI_STATUS_LABELS.failed, cap: CLOCK_LABELS.cap }[b.reason];
  const span =
    b.from === "next"
      ? AI_STOP_UI.next
      : b.whole
        ? null
        : b.to === null
          ? `${DRILL_LABELS.elapsed} ${b.from} ${DRILL_LABELS.hours}〜`
          : b.to === b.from
            ? `${DRILL_LABELS.elapsed} ${b.from} ${DRILL_LABELS.hours}`
            : `${DRILL_LABELS.elapsed} ${b.from}〜${b.to} ${DRILL_LABELS.hours}`;
  const resume = b.resume === "next" ? AI_STOP_UI.retry : b.resume === "tomorrow" ? AI_STOP_UI.tomorrow : b.resume === "done" ? AI_STOP_UI.resumed : null;
  return {
    title: AI_STOP_UI.title,
    reason,
    span,
    effect: b.virtual ? AI_STOP_UI.virtual : AI_STOP_UI.fixed,
    effectTitle: b.virtual ? AI_STOP_UI.virtualTitle : AI_STOP_UI.fixedTitle,
    resume,
  };
}

/** 帯の 1 行の文（紙面・読み上げ）。「AI 停止 上限到達 経過 6 時間〜 想定のみ 翌日再開」 */
export function aiStopText(b: AiStopBand): string {
  const p = aiStopParts(b);
  return [p.title, p.reason, p.span, p.effect, p.resume].filter(Boolean).join(" ");
}
