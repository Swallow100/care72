// 訓練の上の 72 時間の棒（docs/tasks/T17.md）。時間は左から右へ同じ縮尺。刻みの印（0・1・3・6…72）、今の時刻の印、
// 過ぎた所の地、停電・断水・電話の帯（見ている時刻まで。先の出来事は出さない）。
// 再生では刻みの印を押すとその時刻を見る。進行中は印を押せない（進めるのは「進める」だけ）。
// 色: 帯は要確認の色（担当一覧の上の停電の経過と同じ）。今の印は文字の色。面を塗らない。

import Link from "next/link";
import { BAND_LABELS, DRILL_LABELS } from "@/lib/drill/labels";
import type { Band } from "@/lib/drill/view";

const pct = (h: number, last: number) => `${(Math.min(Math.max(h, 0), last) / last) * 100}%`;

export function DrillBar({
  hours,
  last,
  now,
  bands,
  hrefOf,
  reached,
}: {
  hours: readonly number[];
  /** 棒の右端（72） */
  last: number;
  /** 見ている時刻（発災からの時間） */
  now: number;
  bands: ReadonlyArray<Band>;
  /** 再生のとき、刻み i を見る URL。進行中は無し */
  hrefOf?: (i: number) => string;
  /** 保存してある最後の刻み（再生で押せるのはここまで） */
  reached: number;
}) {
  const kinds = (["outage", "water", "phone"] as const).filter((k) => bands.some((b) => b.kind === k));
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1" data-bar>
      <span className="text-xs text-muted">{DRILL_LABELS.elapsed}</span>
      <div className="relative h-7">
        {/* 棒 */}
        <div className="absolute inset-x-0 top-1.5 h-2 rounded-sm bg-panel2" />
        <div className="absolute left-0 top-1.5 h-2 rounded-sm bg-muted/40" style={{ width: pct(now, last) }} data-bar-past />
        {/* 刻みの印 */}
        {hours.map((h, i) => {
          const passed = h <= now;
          const mark = (
            <>
              <span className={`mx-auto block h-3.5 w-px ${passed ? "bg-ink" : "bg-muted/50"}`} />
              <span className={`block text-[11px] leading-3 tabular-nums ${h === now ? "font-bold text-ink" : passed ? "text-ink" : "text-muted"}`}>
                {h}
              </span>
            </>
          );
          const style = { left: pct(h, last) };
          const cls = "absolute top-0 -translate-x-1/2 text-center";
          return hrefOf && i <= reached ? (
            <Link
              key={h}
              href={hrefOf(i)}
              className={`${cls} rounded px-0.5`}
              style={style}
              aria-label={`${DRILL_LABELS.elapsed} ${h} ${DRILL_LABELS.hours}`}
              aria-current={h === now ? "true" : undefined}
              data-press
              data-tick={i}
            >
              {mark}
            </Link>
          ) : (
            <span key={h} className={cls} style={style} data-tick={i}>
              {mark}
            </span>
          );
        })}
        {/* 今の印 */}
        <span
          className="pointer-events-none absolute top-0 h-5 w-0.5 -translate-x-1/2 rounded-sm bg-ink"
          style={{ left: pct(now, last) }}
          data-bar-now={now}
        />
      </div>
      {kinds.map((k) => (
        <BandRow key={k} label={BAND_LABELS[k]} bands={bands.filter((b) => b.kind === k)} last={last} now={now} kind={k} />
      ))}
    </div>
  );
}

function BandRow({ label, bands, last, now, kind }: { label: string; bands: Band[]; last: number; now: number; kind: Band["kind"] }) {
  return (
    <>
      <span className="text-xs text-muted">{label}</span>
      <div className="relative h-1.5" data-band={kind}>
        {bands.map((b) => {
          const to = Math.min(b.to ?? now, now);
          if (to < b.from) return null;
          return (
            <span
              key={`${b.from}`}
              className="absolute top-0 h-1.5 min-w-1 rounded-sm bg-state-check"
              style={{ left: pct(b.from, last), width: `calc(${pct(to, last)} - ${pct(b.from, last)})` }}
              data-band-from={b.from}
              data-band-to={b.to ?? ""}
            />
          );
        })}
      </div>
    </>
  );
}
