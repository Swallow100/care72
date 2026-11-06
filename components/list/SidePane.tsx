// 担当一覧の右の面（T14、docs/tasks/T14.md）。中身は lib/map/side.ts の buildSidePane で作り、ここは並べるだけ。
// 平時: 避難計画の内訳 → 地図・ハザード・避難先 → 見直しと未確認（1 人 1 行で何を入れるか。押すと本人のページのその欄が紫に。T169）
// 発災時: 地図（ピンは lib/triage の色）・状態の人数・ハザード（状態の内訳）・避難先 → 見直しと未確認 → 計画
// 1024px 以上で右に出し、狭い幅は畳む（SideFold）。本人のページ（?open=）が開いているときは、この面の代わりに本人のページ（app/page.tsx）。
// 司令室の見た目にしない: 右端の 1 列で、地図は小さく（その場の拡大・縮小は T66、広く見るのは地図の「全画面」で。T46）。雨雲・震度はデモの印を付ける（components/map/CaseMap.tsx）。
// 数と言葉で伝える（T96）: 色だけの横の帯（計画の割合・未確認の件数）と、数の前の黄の細い帯（tone-check）は置かない。
// 人数は本文色の数と単位（0 は薄い本文色）。「未確認 N」「未確認」は言葉ごと黄の塗りの印（書類の紙面の帯の未確認と同じ形。T87）

import Link from "next/link";
import type { MapRegion } from "@/lib/map/region";
import { CaseMap } from "@/components/map/CaseMap";
import { CountLabel, countClass, Mark, StateTag } from "@/components/ui/Tag";
import type { GeoPoint, HazardKind } from "@/lib/db/types";
import { worklistOf, type DestinationCount, type HazardCount, type PlanCount, type ReviewItem, type SidePaneData, type StateCount } from "@/lib/map/side";
import { PLAN_STATUS_LABELS } from "@/lib/labels";
import { SideFold } from "./SideFold";

/** 平時に既定で重ねる層（発災時はデモの場面の層） */
const NORMAL_LAYERS: HazardKind[] = ["flood"];

/**
 * 地図の真ん中（ピンが無いとき。事業所の中心、T68）と、気象庁の雨雲を重ねるか（デモでない事業所で旗が on のとき）。T72。
 * fictional はピンが種の架空の位置（デモ事業所）のとき。地図の出典の行に「位置は架空」（T114。本物の事業所は出さない）
 */
/** region は事業所の地域（中心と広さ、T148）。無ければ地図に「地域」を出さず、ピンが無いときは center（前から） */
export type SideMapOptions = { center: GeoPoint | null; nowcast: boolean; fictional: boolean; region?: MapRegion | null };

export function SidePane({ data, map: mapOptions }: { data: SidePaneData; map?: SideMapOptions }) {
  const disaster = data.mode === "disaster";
  const map = <MapSection key="map" data={data} options={mapOptions} />;
  const review = <ReviewSection key="review" data={data} />;
  const plan = <PlanSection key="plan" counts={data.plan} />;
  const sections = disaster ? [map, review, plan] : [plan, map, review];
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

/** 畳んだときの 1 行（見直し 2 人・未確認 2 人） */
function FoldSummary({ data }: { data: SidePaneData }) {
  if (data.states) return <StateNumbers counts={data.states} size="sm" />;
  return (
    <span className="text-muted" data-fold-summary>
      見直し <Count n={data.review.length} /> 人・未確認 <Count n={data.pendingTop.length} /> 人
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

/** 見出しの横の人数・件数。本文色の太字（0 は薄い本文色）。色や帯は付けない（言葉と単位で読む） */
function Count({ n }: { n: number }) {
  return <span className={`font-bold tabular-nums ${n > 0 ? "text-ink" : "text-muted"}`}>{n}</span>;
}

/** 至急・要確認・不明・無事の人数。1 人以上は言葉を状態の塗りの印に、数は本文色。0 人は印も数も灰（CountLabel）。lg は面の中の箱の上 */
function StateNumbers({ counts, size }: { counts: StateCount[]; size: "sm" | "lg" }) {
  return (
    <dl className={`flex flex-wrap items-baseline ${size === "lg" ? "gap-x-4 gap-y-1" : "gap-x-2.5"}`} data-states>
      {counts.map((s) => (
        <div key={s.color} className="flex items-baseline gap-1" data-color={s.color}>
          <dt className={size === "lg" ? "text-sm text-muted" : "text-xs text-muted"}>
            <CountLabel tone={s.tone} count={s.count} inPanel2={size === "lg"}>
              {s.label}
            </CountLabel>
          </dt>
          <dd
            className={`font-bold tabular-nums ${size === "lg" ? "text-2xl" : ""} ${countClass(s.count)}`}
          >
            {s.count}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function MapSection({ data, options }: { data: SidePaneData; options?: SideMapOptions }) {
  return (
    <Section
      id="map"
      title="地図"
      aside={<span className="text-xs font-normal text-muted tabular-nums">{data.pins.length} 人</span>}
    >
      <CaseMap
        pins={data.pins}
        layers={data.demo?.layers ?? NORMAL_LAYERS}
        demo={data.demo}
        unplaced={data.unplaced}
        center={options?.center ?? undefined}
        region={options?.region ?? null}
        nowcast={options?.nowcast ?? false}
        fictional={options?.fictional ?? false}
      />
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
            {/* 状態の内訳は人数の帯と同じ形（言葉を塗りの印、数は本文色。0 の状態は出さない。T66） */}
            {h.states.length > 0 && (
              <span className="flex w-36 shrink-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs" data-hazard-states>
                {h.states.map((s) => (
                  <span key={s.color} className="flex items-baseline gap-0.5" data-hazard-state={s.color}>
                    <StateTag tone={s.tone}>{s.label}</StateTag>
                    <span className="font-bold tabular-nums">{s.count}</span>
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
            {d.unset ? (
              <StateTag tone="check">{d.label}</StateTag>
            ) : (
              <span className="min-w-0 truncate" title={d.label}>
                {d.label}
              </span>
            )}
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

/**
 * 見直しと未確認（T169）。前は別の面で同じ人が 2 回並んだ。1 人 1 行: 氏名・計画の段階・「見直し」（計画が下書きの人）・「未確認 N」、
 * その下に何を入れるか（欄の名前）。氏名を押すと全部の未確認の欄、欄の名前を押すとその欄が本人のページで紫になる
 */
function ReviewSection({ data }: { data: Pick<SidePaneData, "review" | "pendingTop"> }) {
  const items = worklistOf(data);
  return (
    <Section
      id="review"
      title="見直し・未確認"
      aside={
        <span className="text-xs font-normal text-muted">
          今週 <Count n={data.review.length} /> 人・計 <Count n={items.reduce((s, r) => s + r.pending, 0)} /> 件
        </span>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted">なし</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((r) => (
            <ReviewRow key={r.id} item={r} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function ReviewRow({ item: r }: { item: ReviewItem }) {
  return (
    <li className="rounded-md bg-panel2 px-2 py-1.5" data-review={r.id}>
      <span className="flex items-baseline gap-2">
        <Link href={r.href} className="min-w-0 truncate rounded-sm font-bold" data-press data-review-name>
          {r.name}
        </Link>
        {/* 計画の状態は色を付けない小さな言葉（黄は右の「未確認 N」の 1 つだけ） */}
        <span className="shrink-0 text-xs text-muted" data-review-plan={r.plan}>
          {PLAN_STATUS_LABELS[r.plan]}
        </span>
        {r.plan === "draft" && (
          <span className="shrink-0" data-review-due>
            <Mark inPanel2>見直し</Mark>
          </span>
        )}
        <span className="ml-auto shrink-0" data-review-pending={r.pending}>
          <StateTag tone="check">
            未確認 <span className="tabular-nums">{r.pending}</span>
          </StateTag>
        </span>
      </span>
      <ul className="mt-0.5 flex flex-wrap gap-x-2 text-xs" data-review-fields>
        {r.fields.map((f) => (
          <li key={f.key}>
            <Link href={f.href} className="rounded-sm text-accent underline underline-offset-2" data-press data-review-field={f.key}>
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
    </li>
  );
}

/**
 * 計画の状態の内訳。言葉の印と数（人数の帯と同じ形。1 人以上は塗りの印、0 は灰）。
 * 前は上に色の割合の横の帯があったが、色だけで段の名前が読めず意味が伝わらなかったので外した（T96）。
 * T146: 段階 3 つ（未作成・下書き・作成済）と、別に訓練に出た人の数。訓練は計画の段階でないので色の印にせず小さな言葉（人数の合計は段階 3 つだけ）
 */
function PlanSection({ counts }: { counts: PlanCount[] }) {
  const total = counts.filter((c) => c.status !== "drill").reduce((s, c) => s + c.count, 0);
  return (
    <Section
      id="plan"
      title="避難計画"
      aside={<span className="text-xs font-normal text-muted tabular-nums">{total} 人</span>}
    >
      <dl className="grid grid-cols-4 gap-1 text-sm" data-plan>
        {counts.map((c) => (
          <div key={c.status} className="flex flex-col items-start" data-status={c.status}>
            <dt className="text-xs text-muted">
              {c.status === "drill" ? (
                <span className="inline-block leading-[1.125rem] font-bold">{c.label}</span>
              ) : (
                <CountLabel tone={c.tone} count={c.count}>
                  {c.label}
                </CountLabel>
              )}
            </dt>
            <dd
              className={`text-lg font-bold tabular-nums ${countClass(c.count)}`}
            >
              {c.count}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
