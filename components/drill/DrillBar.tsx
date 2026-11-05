// 訓練の上の 72 時間の棒（docs/tasks/T17.md）。時間は左から右へ同じ縮尺。刻みの印（0・1・3・6…72）、今の時刻の印、
// 過ぎた所の地、停電・断水・電話の帯（見ている時刻まで。先の出来事は出さない）。
// 再生では刻みの印を押すとその時刻を見る。進行中は印を押せない（進めるのは「進める」だけ）。
// 色: 帯は要確認の色（担当一覧の上の停電の経過と同じ）。今の印は文字の色。面を塗らない。
// 夜間発災（T59）の訓練は、下に時刻の行（発災 2 時・今 何時）。開始の時刻（started_at）はずらさないので、上の日時とは別の訓練の中の時刻。
// T128: 訓練の画面は strip（components/drill/StripRows。種類の段の出来事の一覧）を渡す。渡すと列は 名前・今の様子（1024px 以上）・軸 の 3 つになり、
// 帯の行（停電・断水・電話）は strip の段が描く（帯の棒は下の BandBar を同じに使う）。渡さなければ前のまま（帯の行をここで描く）。

import Link from "next/link";
import { BAND_LABELS, DRILL_LABELS, elapsedLabel, T59_LABELS } from "@/lib/drill/labels";
import { NIGHT_START_HOUR, nightClock } from "@/lib/drill/night";
import { AXIS_LABEL_HOURS, axisAt } from "@/lib/drill/strip";
import type { Band } from "@/lib/drill/view";

/** 軸の位置。warp は種類の段の帯（T128）の縮尺（lib/drill/strip.ts の axisAt。はじめの時間を広く）、無ければ同じ縮尺 */
const pct = (h: number, last: number, warp = false) =>
  warp ? `${axisAt(h, last) * 100}%` : `${(Math.min(Math.max(h, 0), last) / last) * 100}%`;

export function DrillBar({
  hours,
  last,
  now,
  bands,
  hrefOf,
  reached,
  night = false,
  clock = false,
  strip,
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
  /** 夜間発災（T59）。時刻の行を足す */
  night?: boolean;
  /** 連続の時計の訓練（T90）。hours は保存した区切りの時刻 */
  clock?: boolean;
  /** 種類の段の行（T128、StripRows）。渡すと帯の行はここで描かない */
  strip?: React.ReactNode;
}) {
  const kinds = (["outage", "water", "phone"] as const).filter((k) => bands.some((b) => b.kind === k));
  const wide = strip !== undefined;
  /** 今の様子の列（strip のときだけ。1024px 未満は出さない） */
  const stateCell = wide ? <span className="hidden lg:block" /> : null;
  return (
    <div
      className={`grid items-center gap-x-2 ${wide ? "gap-y-0.5 grid-cols-[3.5rem_minmax(0,1fr)] lg:grid-cols-[4rem_13rem_minmax(0,1fr)]" : "gap-y-1 grid-cols-[3rem_minmax(0,1fr)]"}`}
      data-bar
      data-strip={wide ? "" : undefined}
    >
      <span className="text-xs text-muted">{DRILL_LABELS.elapsed}</span>
      {stateCell}
      <div className="relative h-7">
        {/* 棒 */}
        <div className="absolute inset-x-0 top-1.5 h-2 rounded-sm bg-panel2" />
        <div className="absolute left-0 top-1.5 h-2 rounded-sm bg-[color-mix(in_srgb,var(--muted)_45%,var(--panel2))]" style={{ width: pct(now, last, wide) }} data-bar-past />
        {/* 連続の時計（T90）: 目盛りは 3 時間ごとの固定（数字は 12 時間ごと、広い画面は 6 時間ごとも）、区切りは棒の下の小さな印 */}
        {clock && <ClockScale last={last} now={now} warp={wide} />}
        {clock && <CutMarks hours={hours} last={last} now={now} reached={reached} warp={wide} {...(hrefOf ? { hrefOf } : {})} />}
        {/* 刻みの印 */}
        {!clock && hours.map((h, i) => {
          const passed = h <= now;
          const mark = (
            <>
              <span className={`mx-auto block h-3.5 w-px ${passed ? "bg-ink" : "bg-muted"}`} />
              <span className={`block text-[11px] leading-3 tabular-nums ${h === now ? "font-bold text-ink" : passed ? "text-ink" : "text-muted"}`}>
                {h}
              </span>
            </>
          );
          const style = { left: pct(h, last, wide) };
          const cls = "absolute top-0 -translate-x-1/2 text-center";
          return hrefOf && i <= reached ? (
            <Link
              key={h}
              href={hrefOf(i)}
              className={`${cls} rounded px-0.5`}
              style={style}
              aria-label={elapsedLabel(h)}
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
          style={{ left: pct(now, last, wide) }}
          data-bar-now={now}
        />
      </div>
      {wide
        ? strip
        : kinds.map((k) => <BandRow key={k} label={BAND_LABELS[k]} bands={bands.filter((b) => b.kind === k)} last={last} now={now} kind={k} />)}
      {night && (
        <>
          <span className="text-xs text-muted">{T59_LABELS.clock}</span>
          {stateCell}
          <span className="flex flex-wrap gap-x-3 text-xs tabular-nums" data-night-clock={nightClock(now)}>
            <span>
              <span className="text-muted">{T59_LABELS.night}</span> {NIGHT_START_HOUR}
              {T59_LABELS.oclock}
            </span>
            <span className="font-bold">
              <span className="font-normal text-muted">{T59_LABELS.now}</span> {nightClock(now)}
              {T59_LABELS.oclock}
            </span>
          </span>
        </>
      )}
    </div>
  );
}

/** 連続の時計の目盛り（3 時間ごと。数字は 12 時間ごと、640px 以上は 6 時間ごとも。縮尺を変えた軸〔warp〕は AXIS_LABEL_HOURS） */
function ClockScale({ last, now, warp = false }: { last: number; now: number; warp?: boolean }) {
  const marks = Array.from({ length: Math.floor(last / 3) + 1 }, (_, i) => i * 3);
  return (
    <>
      {marks.map((h) => {
        const big = warp ? AXIS_LABEL_HOURS.includes(h) : h % 12 === 0;
        const mid = !warp && !big && h % 6 === 0;
        const passed = h <= now;
        return (
          <span key={h} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: pct(h, last, warp) }} data-scale={h}>
            <span className={`mx-auto block w-px ${big ? "h-3.5" : "h-2.5"} ${passed ? "bg-ink" : "bg-muted"}`} />
            {(big || mid) && (
              <span
                className={`${mid ? "hidden sm:block" : "block"} text-[11px] leading-3 tabular-nums ${passed ? "text-ink" : "text-muted"}`}
              >
                {h}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

/** 保存した区切りの印（棒の上の小さな点）。再生では押すとその区切りを見る */
function CutMarks({
  hours,
  last,
  now,
  reached,
  hrefOf,
  warp = false,
}: {
  hours: readonly number[];
  last: number;
  now: number;
  reached: number;
  hrefOf?: (i: number) => string;
  warp?: boolean;
}) {
  return (
    <>
      {hours.map((h, i) => {
        const here = Math.abs(h - now) < 1e-6;
        const dot = <span className={`block size-1.5 rounded-sm ${here ? "bg-ink" : "bg-muted"}`} />;
        const style = { left: pct(h, last, warp) };
        const cls = "absolute top-[0.1875rem] -translate-x-1/2";
        return hrefOf && i <= reached ? (
          <Link
            key={i}
            href={hrefOf(i)}
            className={`${cls} rounded p-0.5`}
            style={style}
            aria-label={elapsedLabel(h)}
            aria-current={here ? "true" : undefined}
            data-press
            data-tick={i}
          >
            {dot}
          </Link>
        ) : (
          <span key={i} className={`${cls} p-0.5`} style={style} data-tick={i} aria-hidden>
            {dot}
          </span>
        );
      })}
    </>
  );
}

function BandRow({ label, bands, last, now, kind }: { label: string; bands: Band[]; last: number; now: number; kind: Band["kind"] }) {
  return (
    <>
      <span className="text-xs text-muted">{label}</span>
      <BandBar bands={bands} last={last} now={now} kind={kind} />
    </>
  );
}

/** 帯の棒 1 本（停電・断水・電話。見ている時刻まで）。種類の段の行（StripRows）も同じ棒を使う。className は外の高さ・位置 */
export function BandBar({
  bands,
  last,
  now,
  kind,
  className = "relative h-1.5",
  warp = false,
}: {
  bands: Band[];
  last: number;
  now: number;
  kind: Band["kind"];
  className?: string;
  /** 種類の段の帯の縮尺（T128） */
  warp?: boolean;
}) {
  return (
    <div className={className} data-band={kind}>
      {bands.map((b) => {
        const to = Math.min(b.to ?? now, now);
        if (to < b.from) return null;
        return (
          <span
            key={`${b.from}`}
            className="absolute top-0 h-1.5 min-w-1 rounded-sm bg-state-check-fill"
            style={{ left: pct(b.from, last, warp), width: `calc(${pct(to, last, warp)} - ${pct(b.from, last, warp)})` }}
            data-band-from={b.from}
            data-band-to={b.to ?? ""}
          />
        );
      })}
    </div>
  );
}
