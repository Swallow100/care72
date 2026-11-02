"use client";

// 担当一覧の右の面の地図（T14）。地理院タイルを並べ、ハザードマップポータルの層を透過して重ね、ピンを立てる。
// 外の地図の道具は使わない（lib/map/geo.ts の頭の注）。動かさない地図で、層の切替だけを持つ。
// ピンの色は lib/triage の色（発災時）。色だけにせず、札に状態の言葉と姓を出す。平時は姓だけ。
// 雨雲・震度はデモの絵と数字で、枠の左上に「デモ」の印を必ず出す。

import Link from "next/link";
import { useId, useMemo, useState, type SyntheticEvent } from "react";
import type { HazardKind } from "@/lib/db/types";
import type { DemoOverlay } from "@/lib/map/demo";
import { fitView, place, tilesFor, tileUrl, VIEW_H, VIEW_W, type View } from "@/lib/map/geo";
import { BASE_LAYER, HAZARD_LAYERS, HAZARD_OPACITY, HAZARD_PORTAL, type Attribution } from "@/lib/map/layers";
import type { MapPin } from "@/lib/map/side";
import type { StateTone } from "@/lib/person";

/** ピンが無いときの真ん中（松山市の市街） */
const FALLBACK = { lat: 33.84, lng: 132.765 };

/** 状態の札（薄い下地と文字の色）と点の色。components/person/parts.tsx の StateTag と同じ組 */
const PIN_TAG: Record<StateTone, string> = {
  ok: "bg-state-ok-soft text-state-ok",
  urgent: "bg-state-urgent-soft text-state-urgent",
  check: "bg-state-check-soft text-state-check",
  unknown: "bg-state-unknown-soft text-state-unknown",
};
const PIN_DOT: Record<StateTone, string> = {
  ok: "bg-state-ok",
  urgent: "bg-state-urgent",
  check: "bg-state-check",
  unknown: "bg-state-unknown",
};

/** 雨雲の斜線（強いほど詰めて濃く）。色は文字の色だけで、気象庁の色の段は使わない */
const RAIN_HATCH = { 1: { gap: 7, opacity: 0.22 }, 2: { gap: 5, opacity: 0.32 }, 3: { gap: 3.5, opacity: 0.42 } } as const;

function hideBroken(e: SyntheticEvent<HTMLImageElement>) {
  // 区域の無い所のタイルは 404 になる。壊れた画像の印を出さない
  e.currentTarget.style.visibility = "hidden";
}

export type CaseMapProps = {
  pins: ReadonlyArray<MapPin>;
  /** 既定で重ねる層 */
  layers: ReadonlyArray<HazardKind>;
  demo: DemoOverlay | null;
  /** 位置の無い人の数 */
  unplaced: number;
};

export function CaseMap({ pins, layers, demo, unplaced }: CaseMapProps) {
  const [on, setOn] = useState<ReadonlySet<HazardKind>>(() => new Set(layers));
  const [rainOn, setRainOn] = useState(true);
  const hatchId = useId();

  const view: View = useMemo(
    () =>
      fitView(
        pins.map((p) => p.location),
        { minZ: 11, maxZ: 15, fallback: FALLBACK },
      ),
    [pins],
  );
  const tiles = useMemo(() => tilesFor(view), [view]);
  const shown = HAZARD_LAYERS.filter((l) => on.has(l.id) && view.z >= l.minZ && view.z <= l.maxZ);

  const toggle = (id: HazardKind) =>
    setOn((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const px = (p: { lat: number; lng: number }) => {
    const at = place(view, p);
    return `${(at.left / 100) * VIEW_W},${(at.top / 100) * VIEW_H}`;
  };

  return (
    <figure className="space-y-1.5" data-map>
      <div role="group" aria-label="重ねる層" className="flex flex-wrap items-center gap-1">
        {HAZARD_LAYERS.map((l) => (
          <LayerButton key={l.id} pressed={on.has(l.id)} onClick={() => toggle(l.id)} layer={l.id}>
            {l.label}
          </LayerButton>
        ))}
        {demo && demo.rain.length > 0 && (
          <LayerButton pressed={rainOn} onClick={() => setRainOn((v) => !v)} layer="rain">
            雨雲
          </LayerButton>
        )}
        {unplaced > 0 && <span className="ml-auto text-xs text-state-check tabular-nums">位置なし {unplaced} 人</span>}
      </div>

      <div
        className="relative w-full overflow-hidden rounded-md bg-panel2"
        style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
        data-zoom={view.z}
      >
        {tiles.map((t) => (
          <img
            key={`base-${t.z}-${t.x}-${t.y}`}
            src={tileUrl(BASE_LAYER.url, t)}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={hideBroken}
            className="absolute max-w-none select-none dark:brightness-[.82]"
            style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.width}%`, height: `${t.height}%` }}
            data-layer="base"
          />
        ))}
        {shown.flatMap((l) =>
          l.urls.flatMap((url) =>
            tiles.map((t) => (
              <img
                key={`${l.id}-${url}-${t.x}-${t.y}`}
                src={tileUrl(url, t)}
                alt=""
                draggable={false}
                loading="lazy"
                decoding="async"
                onError={hideBroken}
                className="absolute max-w-none select-none"
                style={{
                  left: `${t.left}%`,
                  top: `${t.top}%`,
                  width: `${t.width}%`,
                  height: `${t.height}%`,
                  opacity: HAZARD_OPACITY,
                }}
                data-layer={l.id}
              />
            )),
          ),
        )}

        {demo && rainOn && demo.rain.length > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full text-ink"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            aria-hidden
            data-demo="rain"
          >
            <defs>
              {demo.rain.map((b) => (
                <pattern
                  key={b.strength}
                  id={`${hatchId}-${b.strength}`}
                  patternUnits="userSpaceOnUse"
                  width={RAIN_HATCH[b.strength].gap}
                  height={RAIN_HATCH[b.strength].gap}
                  patternTransform="rotate(-35)"
                >
                  <line x1="0" y1="0" x2="0" y2={RAIN_HATCH[b.strength].gap} stroke="currentColor" strokeWidth="1.3" />
                </pattern>
              ))}
            </defs>
            {demo.rain.map((b) => (
              <polygon
                key={b.strength}
                points={b.ring.map(px).join(" ")}
                fill={`url(#${hatchId}-${b.strength})`}
                fillOpacity={RAIN_HATCH[b.strength].opacity}
                stroke="currentColor"
                strokeOpacity={0.35}
                strokeDasharray="4 3"
                strokeWidth="1"
              />
            ))}
          </svg>
        )}

        {pins.map((p) => {
          const at = place(view, p.location);
          return (
            <Link
              key={p.id}
              href={p.href}
              title={p.title}
              aria-label={p.title}
              className="absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
              style={{ left: `${at.left}%`, top: `${at.top}%`, zIndex: 10 + p.layer }}
              data-pin={p.id}
              data-tone={p.tone ?? undefined}
            >
              <span className="flex items-baseline overflow-hidden rounded text-[11px] leading-4 font-bold whitespace-nowrap ring-1 ring-black/10">
                {p.tone && p.state && <span className={`px-1 ${PIN_TAG[p.tone]}`}>{p.state}</span>}
                <span className="bg-panel px-1 text-ink">{p.label}</span>
              </span>
              <span
                className={`mt-0.5 size-2 rounded-full ring-2 ring-panel ${p.tone ? PIN_DOT[p.tone] : "bg-ink"}`}
                aria-hidden
              />
            </Link>
          );
        })}

        {demo && (
          <div
            className="pointer-events-none absolute top-1.5 left-1.5 z-50 rounded border border-dashed border-ink bg-panel/90 px-1.5 py-0.5 text-xs leading-5"
            data-demo="label"
          >
            <span className="font-bold">デモ</span>
            <span className="ml-1.5">{demo.title}</span>
            {demo.quake && (
              <span className="ml-1.5 font-bold" data-demo="quake">
                震度 <span className="text-base tabular-nums">{demo.quake.intensity}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <figcaption className="text-[11px] leading-4 text-muted" data-attribution>
        <span>出典 </span>
        <SourceLink a={BASE_LAYER.attribution} />
        {shown.length > 0 && (
          <>
            <span>・</span>
            <SourceLink a={HAZARD_PORTAL} />
            <span>（{shown.map((l) => `${l.data} ${l.origin}`).join("、")}）</span>
          </>
        )}
        <span className="ml-1">位置は架空</span>
        {demo && <span className="ml-1">雨雲・震度は筋書きの値</span>}
      </figcaption>
    </figure>
  );
}

function LayerButton({
  pressed,
  onClick,
  layer,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  layer: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-press
      data-toggle={layer}
      className={`rounded bg-panel2 px-2 py-0.5 text-sm ${pressed ? "font-bold text-ink ring-2 ring-inset ring-accent" : "text-muted"}`}
    >
      {children}
    </button>
  );
}

function SourceLink({ a }: { a: Attribution }) {
  return (
    <a href={a.href} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press>
      {a.text}
    </a>
  );
}
