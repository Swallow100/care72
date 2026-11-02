// 担当一覧の右の面（T14、docs/tasks/T14.md）。中身は lib/map/side.ts の buildSidePane で作り、ここは並べるだけ。
// 平時: 計画の内訳 → 見直し（今週。計画が下書きで未確認のある人）→ 未確認の多い人 → 地図・ハザード・避難先
// 発災時: 地図（ピンは lib/triage の色）・状態の人数・ハザード（状態の内訳）・避難先 → 見直し → 未確認 → 計画
// 1024px 以上で右に出し、狭い幅は畳む（SideFold）。本人のページ（?open=）が開いているときは、この面の代わりに本人のページ（app/page.tsx）。
// 司令室の見た目にしない: 右端の 1 列で、地図は動かさない。雨雲・震度はデモの印を付ける（components/map/CaseMap.tsx）。

import Link from "next/link";
import { CaseMap } from "@/components/map/CaseMap";
import { TONE_TEXT } from "@/components/person/parts";
import { CountLabel, countClass, StateText } from "@/components/ui/Tag";
import type { HazardKind } from "@/lib/db/types";
import type { DestinationCount, HazardCount, PlanCount, ReviewItem, SidePaneData, StateCount } from "@/lib/map/side";
import { PLAN_STATUS_LABELS } from "@/lib/labels";
import { PLAN_TONES } from "@/lib/caseload";
import type { StateTone } from "@/lib/person";
import { SideFold } from "./SideFold";

/** 平時に既定で重ねる層（発災時はデモの場面の層） */
const NORMAL_LAYERS: HazardKind[] = ["flood"];

/** 細い帯の色は印の塗りと同じ澄んだ色 */
const BAR: Record<StateTone, string> = {
  ok: "bg-state-ok-fill",
  urgent: "bg-state-urgent-fill",
  check: "bg-state-check-fill",
  unknown: "bg-state-unknown-fill",
};

export function SidePane({ data }: { data: SidePaneData }) {
  const disaster = data.mode === "disaster";
  const map = <MapSection key="map" data={data} />;
  const review = <ReviewSection key="review" items={data.review} />;
  const pending = <PendingSection key="pending" items={data.pendingTop} />;
  const plan = <PlanSection key="plan" counts={data.plan} />;
  const sections = disaster ? [map, review, pending, plan] : [plan, review, pending, map];
  // 発災時は担当一覧の表に約 64rem 要る（T13）ので、右に出すのは 1536px（2xl）から。それ未満は表の下に 2 列で並べる。
  // 内側で送らない（送るのは画面全体の縦 1 本）。右の列はページの流れに置く
  const aside = "min-w-0 self-start";
  const grid = disaster ? "grid items-start gap-2 md:grid-cols-2 2xl:grid-cols-1" : "grid items-start gap-2 md:grid-cols-2 lg:grid-cols-1";
  return (
    <aside aria-label="概況" className={aside} data-side={data.mode}>
      <SideFold title="概況" summary={<FoldSummary data={data} />}>
        <div className={grid}>{sections}</div>
      </SideFold>
    </aside>
  );
}

/** 畳んだときの 1 行 */
function FoldSummary({ data }: { data: SidePaneData }) {
  if (data.states) return <StateNumbers counts={data.states} size="sm" />;
  return (
    <span className="text-muted">
      見直し <b className="tone-check tabular-nums">{data.review.length}</b>・未確認{" "}
      <b className="tone-check tabular-nums">{data.pendingTop.length}</b> 人
    </span>
  );
}

function Section({ title, aside, children, id }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={`side-${id}`} className="rounded-lg bg-panel p-3" data-section={id}>
      <h2 id={`side-${id}`} className="flex items-baseline gap-2 text-[1rem] leading-6 font-bold">
        {title}
        {aside}
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Count({ n, tone }: { n: number; tone?: StateTone }) {
  return (
    <span className={`font-bold tabular-nums ${n > 0 && tone ? TONE_TEXT[tone] : n > 0 ? "" : "text-muted"}`}>{n}</span>
  );
}

/** 至急・要確認・不明・無事の人数。数字に状態の色（0 は色なし）。要確認は言葉を黄の塗りの印に、数は本文色 */
function StateNumbers({ counts, size }: { counts: StateCount[]; size: "sm" | "lg" }) {
  return (
    <dl className={`flex flex-wrap items-baseline ${size === "lg" ? "gap-x-4 gap-y-1" : "gap-x-2.5"}`} data-states>
      {counts.map((s) => (
        <div key={s.color} className="flex items-baseline gap-1" data-color={s.color}>
          <dt className={size === "lg" ? "text-sm text-muted" : "text-xs text-muted"}>
            <CountLabel tone={s.tone} count={s.count}>
              {s.label}
            </CountLabel>
          </dt>
          <dd
            className={`font-bold tabular-nums ${size === "lg" ? "text-2xl" : ""} ${countClass(s.tone, s.count)}`}
            data-tone={s.count > 0 ? s.tone : undefined}
          >
            {s.count}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MapSection({ data }: { data: SidePaneData }) {
  return (
    <Section
      id="map"
      title="地図"
      aside={<span className="text-xs font-normal text-muted tabular-nums">{data.pins.length} 人</span>}
    >
      <CaseMap pins={data.pins} layers={data.demo?.layers ?? NORMAL_LAYERS} demo={data.demo} unplaced={data.unplaced} />
      {data.states && (
        <div className="mt-2 rounded-md bg-panel2 px-2 py-1.5">
          <StateNumbers counts={data.states} size="lg" />
        </div>
      )}
      <div className="mt-2 space-y-2">
        <HazardList rows={data.hazards} />
        <DestinationList rows={data.destinations} />
      </div>
    </Section>
  );
}

function HazardList({ rows }: { rows: HazardCount[] }) {
  return (
    <div>
      <h3 className="text-xs text-muted">ハザード</h3>
      <ul className="mt-0.5 space-y-px text-sm" data-hazards>
        {rows.map((h) => (
          <li key={h.key} className="flex items-baseline gap-2" data-hazard={h.key}>
            <span className={h.kind ? "" : "text-muted"}>{h.label}</span>
            <span className="ml-auto tabular-nums">
              {h.count}
              <span className="text-xs text-muted"> 人</span>
            </span>
            {h.states.length > 0 && (
              <span className="flex w-36 shrink-0 gap-1.5 text-xs" data-hazard-states>
                {h.states.map((s) => (
                  <span key={s.color} className={`font-bold ${TONE_TEXT[s.tone]}`} data-tone={s.tone}>
                    {s.label} <span className="tabular-nums">{s.count}</span>
                  </span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DestinationList({ rows }: { rows: DestinationCount[] }) {
  return (
    <div>
      <h3 className="text-xs text-muted">避難先</h3>
      <ul className="mt-0.5 space-y-px text-sm" data-destinations>
        {rows.map((d) => (
          <li key={d.label} className="flex items-baseline gap-2">
            <span className={`min-w-0 truncate ${d.unset ? "font-bold tone-check" : ""}`} title={d.label}>
              {d.label}
            </span>
            <span className="ml-auto shrink-0 tabular-nums">
              {d.count}
              <span className="text-xs text-muted"> 人</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 今週の見直し: 計画が下書きで未確認のある人。何が未確認かを小さく */
function ReviewSection({ items }: { items: ReviewItem[] }) {
  return (
    <Section
      id="review"
      title="見直し"
      aside={
        <span className="text-xs font-normal text-muted">
          今週 <Count n={items.length} tone="check" /> 人
        </span>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">なし</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className="block rounded-md bg-panel2 px-2 py-1.5" data-press="overlay" data-review={r.id}>
                <span className="flex items-baseline gap-2">
                  <span className="font-bold">{r.name}</span>
                  <StateText tone={PLAN_TONES[r.plan]}>{PLAN_STATUS_LABELS[r.plan]}</StateText>
                  <span className="ml-auto text-sm font-bold tone-check tabular-nums">未確認 {r.pending}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted">{r.labels.join("・")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 未確認の多い人（多い順）。件数の帯は最多の人を 100% に */
function PendingSection({ items }: { items: ReviewItem[] }) {
  const max = Math.max(1, ...items.map((r) => r.pending));
  return (
    <Section
      id="pending"
      title="未確認"
      aside={
        <span className="text-xs font-normal text-muted">
          <Count n={items.length} tone="check" /> 人・計 <Count n={items.reduce((s, r) => s + r.pending, 0)} /> 件
        </span>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">なし</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((r) => (
            <li key={r.id}>
              <Link
                href={r.href}
                className="grid grid-cols-[minmax(0,1fr)_3rem_2.5rem] items-center gap-2 rounded-md bg-panel2 px-2 py-1 text-sm"
                data-press="overlay"
                data-pending-row={r.id}
              >
                <span className="truncate">{r.name}</span>
                <span className="h-1 overflow-hidden rounded-xs bg-base" aria-hidden>
                  <span className="block h-full bg-state-check-fill" style={{ width: `${(r.pending / max) * 100}%` }} />
                </span>
                <span className="text-right font-bold tone-check tabular-nums">{r.pending} 件</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 計画の状態の内訳。細い帯と数字（数字に状態の色、0 は色なし） */
function PlanSection({ counts }: { counts: PlanCount[] }) {
  const total = counts.reduce((s, c) => s + c.count, 0);
  return (
    <Section
      id="plan"
      title="避難計画"
      aside={<span className="text-xs font-normal text-muted tabular-nums">{total} 人</span>}
    >
      {total > 0 && (
        <div className="flex h-1.5 gap-px overflow-hidden rounded-xs" aria-hidden data-plan-bar>
          {counts
            .filter((c) => c.count > 0)
            .map((c) => (
              <span key={c.status} className={BAR[c.tone]} style={{ width: `${(c.count / total) * 100}%` }} />
            ))}
        </div>
      )}
      <dl className="mt-1.5 grid grid-cols-4 gap-1 text-sm" data-plan>
        {counts.map((c) => (
          <div key={c.status} className="flex flex-col items-start" data-status={c.status}>
            <dt className="text-xs text-muted">
              <CountLabel tone={c.tone} count={c.count}>
                {c.label}
              </CountLabel>
            </dt>
            <dd
              className={`text-lg font-bold tabular-nums ${countClass(c.tone, c.count)}`}
              data-tone={c.count > 0 ? c.tone : undefined}
            >
              {c.count}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
