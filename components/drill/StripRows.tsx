// 訓練の上の帯の種類の段（docs/tasks/T128.md の 1）。DrillBar の strip に渡す行（名前・今の様子・軸の 3 つの欄の並び）。
// 段と印は lib/drill/strip.ts（経過の行から作る。進行中は経過の発生のタブと同じく、ケアマネが知り得ない物を出さない）。
// - 印に触れると title にその出来事の 1 行（時刻・種類・文・名前・区域の対象）。押すと経過のその行へ（#log-<タブ>-<鍵>。
//   経過の切替 components/drill/LogTabs が hash でタブを替えて行まで送り、行に印）
// - 近い印は 1 つにまとめて数を添える（lib/drill/strip.ts の clusterMarks）。手は始まりから終わりの棒
// - 帯の段（停電・電話・断水）は前と同じ帯の棒（DrillBar の BandBar）に、その段の状況の細い印を重ねる
// - 今の様子の欄（1024px 以上）: 帯の段は今の状態（「停電中 6 時間 全域」「通話不可」）、ほかの段はいちばん新しい印の 1 行と区域の対象の人数
// 色は止まった・悪くなった状況の要確認の色・赤の安否の至急の色・本文色と灰だけ（被害状況の欄と帯と同じ）。サーバーで描く。

import { ACTION_STATUS_LABELS } from "@/lib/drill/actions";
import { clockText, type TimeBase } from "@/lib/drill/act-time";
import { areaTargetOf, targetText, type AreaPerson } from "@/lib/drill/area-targets";
import { incidentLabel } from "@/lib/drill/event-catalog";
import { ACTION_LABELS, CALL_UI, EVENT_KIND_LABELS, PHONE_LABELS, WATER_LABELS, WORLD_LABELS } from "@/lib/drill/labels";
import type { WorldState } from "@/lib/drill/scenarios";
import {
  axisAt,
  clusterMarks,
  clusterTone,
  isBandLane,
  logAnchorId,
  STRIP_LABELS,
  type MarkCluster,
  type MarkTone,
  type BandLane,
  type StripLaneView,
  type StripMark,
} from "@/lib/drill/strip";
import type { DrillLog, LogRow } from "@/lib/drill/timeline";
import type { NewsItem } from "@/lib/drill/news";
import { hourText, minuteText } from "@/lib/drill/time-text";
import type { Band } from "@/lib/drill/view";
import { COLOR_LABELS } from "@/lib/labels";
import { BandBar } from "./DrillBar";

type Names = Readonly<Record<string, string>>;

/** 軸の位置（DrillBar の strip と同じ縮尺。lib/drill/strip.ts の axisAt） */
const pctOf = (minute: number, last: number) => `${axisAt(minute / 60, last) * 100}%`;

/** 印の形と色。状況は角の小さな四角、人の連絡は丸、帯の段の状況は細い縦の線 */
const SHAPE: Record<MarkTone, string> = {
  check: "size-2.5 rounded-sm bg-state-check-fill",
  urgent: "size-2.5 rounded-full bg-state-urgent-fill",
  call: "size-2.5 rounded-full bg-ink",
  plain: "size-2.5 rounded-sm bg-muted",
};

export type LineCtx = { names: Names; people: ReadonlyArray<AreaPerson>; base: TimeBase | null };
type Ctx = LineCtx;

const TURN_WORDS = { red: COLOR_LABELS.red, green: COLOR_LABELS.green, unknown: COLOR_LABELS.gray } as const;

/** 印 1 つの 1 行（種類・文・名前・対象）。時刻は別 */
function markLine(m: StripMark, c: Ctx): string {
  return rowLine(m.row, c);
}

/** 経過の行 1 つの短い 1 行（帯の印の title・今の様子・新着の文。種類・文・名前・区域の対象） */
export function rowLine(r: LogRow, c: LineCtx): string {
  const name = (p: string | null | undefined) => (p ? (c.names[p] ?? p) : "");
  switch (r.source) {
    case "incident": {
      const label = incidentLabel(r.e) ?? EVENT_KIND_LABELS[r.e.change.kind];
      const t = areaTargetOf(r.e.change, c.people);
      return [label, r.e.text, name(r.e.person), t ? targetText(t, c.names, c.people.length) : ""].filter(Boolean).join(" ");
    }
    case "doing":
      return [name(r.t.person), r.t.doing ?? ""].filter(Boolean).join(" ");
    case "signal":
      return [name(r.t.person), TURN_WORDS[r.t.color], r.callIn ? CALL_UI.incoming : "", r.t.saying ? `「${r.t.saying}」` : ""].filter(Boolean).join(" ");
    case "action":
    case "heard": {
      const a = r.a;
      return [ACTION_LABELS[a.kind], name(a.person), a.result ? ACTION_STATUS_LABELS[a.result.status] : ""].filter(Boolean).join(" ");
    }
  }
}

/** 印の時刻の言い方（「経過 1 時間 5 分 14:49」） */
function markAt(m: StripMark, base: TimeBase | null): string {
  const at = base ? `${minuteText(m.minute)} ${clockText(base, m.minute)}` : minuteText(m.minute);
  return m.end !== null && m.end > m.minute ? `${at}〜${base ? clockText(base, m.end) : minuteText(m.end)}` : at;
}

/**
 * 帯の段の今の状態。bad は止まっている状態の言葉（要確認の色の塗りの印。被害状況の欄と同じ）、rest はうしろの小さな言葉。
 * 停電は「停電中」「6 時間 全域」、電話・断水は今の状態の言葉。ほかの帯の段（通信の段など、種類が増えたとき）は続いているかだけ
 */
function bandState(lane: BandLane, world: WorldState, bands: ReadonlyArray<Band>, now: number): { bad: string | null; rest: string } {
  if (lane === "outage") {
    const o = world.outage;
    if (!o) return { bad: null, rest: WORLD_LABELS.no };
    if (o.restoredAt !== null) return { bad: null, rest: WORLD_LABELS.restored };
    const area = o.area.scope === "office" ? WORLD_LABELS.office : o.area.scope === "towns" ? o.area.towns.join("・") : WORLD_LABELS.area;
    return { bad: WORLD_LABELS.outageNow, rest: `${hourText(now - o.since)} ${area}` };
  }
  if (lane === "phone") return world.phone === "ok" ? { bad: null, rest: PHONE_LABELS.ok } : { bad: PHONE_LABELS[world.phone], rest: "" };
  if (lane === "water") return world.water === "out" ? { bad: WATER_LABELS.out, rest: "" } : { bad: null, rest: WATER_LABELS[world.water] };
  const open = bands.some((b) => (b.kind as string) === (lane as string) && b.to === null);
  return open ? { bad: STRIP_LABELS[lane], rest: "" } : { bad: null, rest: WORLD_LABELS.no };
}

export function StripRows({
  lanes,
  bands,
  last,
  now,
  world,
  names,
  people,
  base,
}: {
  lanes: ReadonlyArray<StripLaneView>;
  bands: ReadonlyArray<Band>;
  /** 軸の右端（時間。72） */
  last: number;
  /** 見ている時刻（発災からの時間） */
  now: number;
  world: WorldState;
  names: Names;
  /** 参加者の台帳のハザードと町（区域の対象。lib/drill/area-targets.ts） */
  people: ReadonlyArray<AreaPerson>;
  /** 時刻の元（訓練の中の時刻） */
  base: TimeBase | null;
}) {
  const c: Ctx = { names, people, base };
  return (
    <>
      {lanes.map(({ lane, marks }) => {
        const band = isBandLane(lane);
        const latest = marks.at(-1) ?? null;
        const state = band ? bandState(lane, world, bands, now) : { bad: null, rest: latest ? markLine(latest, c) : "" };
        const title = [state.bad, state.rest].filter(Boolean).join(" ");
        return (
          <div key={lane} className="contents" data-strip-lane={lane}>
            <span className="text-xs text-muted">{STRIP_LABELS[lane]}</span>
            <span className="hidden truncate text-xs lg:block" title={title} data-strip-state={lane}>
              {state.bad && <span className="mr-1 font-bold tone-check">{state.bad}</span>}
              {state.rest}
            </span>
            <div className="relative h-4" data-strip-axis={lane}>
              {band && <BandBar bands={bands.filter((b) => b.kind === lane)} last={last} now={now} kind={lane} className="absolute inset-x-0 top-[5px] h-1.5" warp />}
              <span className="pointer-events-none absolute inset-y-0 w-px bg-muted/40" style={{ left: pctOf(now * 60, last) }} aria-hidden />
              {(lane === "act" ? marks.map((m) => ({ from: m.minute, to: m.minute, marks: [m] })) : clusterMarks(marks)).map((cl) => (
                <MarkLink key={cl.marks[0].key} cluster={cl} last={last} band={band} c={c} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** 印（まとめた物）1 つ。押すと経過の最後の行へ。手は始まりから終わりの棒 */
function MarkLink({ cluster, last, band, c }: { cluster: MarkCluster; last: number; band: boolean; c: Ctx }) {
  const head = cluster.marks.at(-1)!;
  const lines = cluster.marks.map((m) => `${markAt(m, c.base)} ${markLine(m, c)}`);
  const title = lines.join("\n");
  const href = `#${logAnchorId(head.tab, head.key)}`;
  const n = cluster.marks.length;
  if (head.end !== null) {
    const from = pctOf(head.minute, last);
    const to = pctOf(Math.max(head.end, head.minute), last);
    return (
      <a
        href={href}
        title={title}
        aria-label={lines[0]}
        className="absolute inset-y-0 flex min-w-2.5 items-center rounded px-0"
        style={{ left: from, width: `max(0.625rem, calc(${to} - ${from}))` }}
        data-press
        data-strip-mark={head.key}
        data-mark-tab={head.tab}
      >
        <span className="h-1.5 w-full rounded-sm bg-muted" />
      </a>
    );
  }
  const tone = clusterTone(cluster);
  return (
    <a
      href={href}
      title={title}
      aria-label={lines.at(-1)}
      className="absolute top-0 flex h-4 -translate-x-[0.4375rem] items-center gap-0.5 rounded px-0.5"
      style={{ left: pctOf(cluster.from, last) }}
      data-press
      data-strip-mark={head.key}
      data-mark-tab={head.tab}
      data-tone={tone}
      {...(n > 1 ? { "data-count": n } : {})}
    >
      <span className={band ? "h-3 w-0.5 rounded-sm bg-ink" : SHAPE[tone]} />
      {n > 1 && <span className="text-[10px] leading-none font-bold tabular-nums">{n}</span>}
    </a>
  );
}

/**
 * 新着の候補（T128。経過の発生・把握の行。公表の状況は発生と把握の両方にあるので 1 つ）。新着かどうかはブラウザの NewsBar が
 * 端末の見た記録で決める。手（対応のタブ）は自分の操作なので入れない
 */
export function newsItemsOf(log: Pick<DrillLog, "occur" | "know">, c: LineCtx): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const [tab, rows] of [["occur", log.occur], ["know", log.know]] as const) {
    for (const r of rows) {
      if (seen.has(r.key)) continue;
      seen.add(r.key);
      out.push({ key: r.key, tab, minute: r.minute, at: c.base ? clockText(c.base, r.minute) : minuteText(r.minute), text: rowLine(r, c) });
    }
  }
  return out;
}
