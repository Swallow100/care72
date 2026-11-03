"use client";

// 地図（T14・T46）。地理院タイルを並べ、ハザードマップポータルの層を透過して重ね、ピンを立てる。
// 外の地図の道具は使わない（lib/map/geo.ts の頭の注）。
// - 小さな地図（担当一覧の右の面・訓練の画面）: ピンが全部入るズームに固定。層の切替と「全画面」を持つ
// - 全画面（T46）: <dialog> で画面いっぱいに出し、拡大・縮小（ボタン・ホイール・ピンチ・＋−のキー）と
//   移動（ドラッグ・指・矢印のキー）ができる。ズームは 9〜18（lib/map/camera.ts）。名前の印が重なれば近い物をまとめて
//   「他 N 人」（lib/map/cluster.ts）。Escape か「閉じる」で戻る。開いている間は後ろを送らない
// 層の切替は小さな地図と全画面で同じ物を使う。ピンの色は lib/triage の色（発災時）。色だけにせず、印に状態の言葉と姓を出す。
// 平時は姓だけ。雨雲・震度はデモの絵と数字で、地図の上の帯に「デモ」の印を必ず出す（全画面でも）。

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Button } from "@/components/ui/Button";
import { CloseIcon, FitIcon, FullIcon, ZoomInIcon, ZoomOutIcon } from "@/components/ui/Icon";
import { CountLabel, countClass, TONE_FILL } from "@/components/ui/Tag";
import type { GeoPoint, HazardKind } from "@/lib/db/types";
import { DRAG_SLOP, FULL_ZOOM, JAPAN_BOUNDS, keyAction, pinchView, stepZoom, wheelZoom } from "@/lib/map/camera";
import { COUNT_W, groupPins, labelWidth, memberStates, statesWidth, type PinGroup } from "@/lib/map/cluster";
import type { DemoOverlay } from "@/lib/map/demo";
import {
  BASE_SIZE,
  clampView,
  fitView,
  inRange,
  panBy,
  place,
  tilesFor,
  tileUrl,
  tileZoom,
  VIEW_H,
  VIEW_W,
  zoomAt,
  type Padding,
  type Pt,
  type Size,
  type TileSpot,
  type View,
} from "@/lib/map/geo";
import { MAP_UI, othersLabel } from "@/lib/map/labels";
import { BASE_LAYER, HAZARD_LAYERS, HAZARD_OPACITY, HAZARD_PORTAL, type Attribution, type HazardLayer } from "@/lib/map/layers";
import type { MapPin } from "@/lib/map/side";
import { COLOR_LABELS } from "@/lib/labels";
import type { StateTone } from "@/lib/person";

/** ピンが無いときの真ん中（松山市の市街） */
const FALLBACK = { lat: 33.84, lng: 132.765 };

/** ピンの名前の印（澄んだ色の塗りと文字）と点の色。components/ui/Tag の StateTag と同じ組 */
const PIN_TAG: Record<StateTone, string> = TONE_FILL;
const PIN_DOT: Record<StateTone, string> = {
  ok: "bg-state-ok-fill",
  urgent: "bg-state-urgent-fill",
  check: "bg-state-check-fill",
  unknown: "bg-state-unknown-fill",
};

/** 状態の人数を並べる順（至急・要確認・不明・無事） */
const TONE_ORDER: readonly StateTone[] = ["urgent", "check", "unknown", "ok"];

/** 雨雲の斜線（強いほど詰めて濃く）。色は文字の色だけで、気象庁の色の段は使わない */
const RAIN_HATCH = { 1: { gap: 7, opacity: 0.22 }, 2: { gap: 5, opacity: 0.32 }, 3: { gap: 3.5, opacity: 0.42 } } as const;

/** 全画面の最初のズームの上限（ピンが 1 人だけでも寄りすぎない） */
const FULL_FIT_MAX = 15;
/** 全画面でピンが全部入る余白（px）。名前の印が上に出るので上を広く。スマホの幅では左右を詰める（詰めないと 1 段引いてまとまる） */
export function fullPadding(size: Size): Padding {
  const side = size.w < 640 ? 36 : 72;
  return { top: 48, right: side, bottom: 24, left: side };
}
/** 全画面のズームと中心の制限 */
const FULL_LIMITS = { range: FULL_ZOOM, bounds: JAPAN_BOUNDS };
/** 枠の外でもこの px までのピンは描く（端で印が切れないように） */
const PIN_CULL = 80;

/** 区域の無い所のタイルは 404 になる。壊れた画像の印を出さない */
function hideBroken(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = "hidden";
}

/** 画面が動き出す前に 404 になったタイルは onError が届かないので、動き出したあとに見て隠す */
function useHideBrokenTiles(ref: React.RefObject<HTMLDivElement | null>, deps: React.DependencyList) {
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    for (const img of box.querySelectorAll("img")) {
      if (img.complete && img.naturalWidth === 0) img.style.visibility = "hidden";
    }
  }, deps); // 層の切替とタイルの段が変わるたびに見る（動かすたびには見ない。そこは onError で足りる）
}

export type CaseMapProps = {
  pins: ReadonlyArray<MapPin>;
  /** 既定で重ねる層 */
  layers: ReadonlyArray<HazardKind>;
  demo: DemoOverlay | null;
  /** 位置の無い人の数 */
  unplaced: number;
};

/** 層の切替（小さな地図と全画面で同じ物） */
type LayerChoice = {
  on: ReadonlySet<HazardKind>;
  toggle: (id: HazardKind) => void;
  rainOn: boolean;
  toggleRain: () => void;
};

export function CaseMap({ pins, layers, demo, unplaced }: CaseMapProps) {
  const [on, setOn] = useState<ReadonlySet<HazardKind>>(() => new Set(layers));
  const [rainOn, setRainOn] = useState(true);
  const [full, setFull] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const view: View = useMemo(
    () =>
      fitView(
        pins.map((p) => p.location),
        { minZ: 11, maxZ: 15, fallback: FALLBACK },
      ),
    [pins],
  );
  const tiles = useMemo(() => tilesFor(view), [view]);
  const shown = HAZARD_LAYERS.filter((l) => on.has(l.id) && inRange(view.z, l));
  useHideBrokenTiles(box, [tiles, on]);

  const choice: LayerChoice = {
    on,
    toggle: (id) =>
      setOn((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    rainOn,
    toggleRain: () => setRainOn((v) => !v),
  };

  return (
    <>
      <figure className="space-y-1.5" data-map>
        <div className="flex flex-wrap items-center gap-1">
          <LayerToggles choice={choice} demo={demo} tz={view.z} />
          <span className="ml-auto flex items-center gap-2">
            <Unplaced n={unplaced} />
            <Button kind="plain" size="sm" icon={FullIcon} onClick={() => setFull(true)} aria-haspopup="dialog" data-map-open>
              {MAP_UI.full}
            </Button>
          </span>
        </div>

        {demo && <DemoBand demo={demo} />}

        <div
          ref={box}
          className="relative w-full overflow-hidden rounded-md bg-panel2"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
          data-zoom={view.z}
        >
          <BaseTiles tiles={tiles} />
          <HazardTiles tiles={tiles} shown={shown} />
          {demo && rainOn && <Rain demo={demo} view={view} size={BASE_SIZE} />}
          {pins.map((p) => {
            const at = place(view, p.location);
            return <PinLink key={p.id} pin={p} style={{ left: `${at.left}%`, top: `${at.top}%`, zIndex: 10 + p.layer }} />;
          })}
        </div>

        <MapSource shown={shown} />
      </figure>
      {/* 全画面は押してから作る（閉じている間はタイルを要求しない）。<dialog> の showModal で一番上の層に出るので
          場所を取らない。figcaption を figure の最後に置くため、figure の外に置く */}
      {full && <FullMap pins={pins} demo={demo} unplaced={unplaced} choice={choice} onClose={() => setFull(false)} />}
    </>
  );
}

// ---------- 全画面 ----------

type FullMapProps = {
  pins: ReadonlyArray<MapPin>;
  demo: DemoOverlay | null;
  unplaced: number;
  choice: LayerChoice;
  onClose: () => void;
  /** テスト用: 枠の大きさを測る前に使う大きさ（サーバーの描画では ResizeObserver が動かない） */
  initialSize?: Size;
};

/** タイルの番号の鍵 */
const tileKey = (t: Pick<TileSpot, "z" | "x" | "y">) => `${t.z}/${t.x}/${t.y}`;

export function FullMap({ pins, demo, unplaced, choice, onClose, initialSize }: FullMapProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const points = useMemo(() => pins.map((p) => p.location), [pins]);
  const fit = useCallback(
    (s: Size) => fitView(points, { minZ: FULL_ZOOM.minZ, maxZ: FULL_FIT_MAX, fallback: FALLBACK, size: s, padding: fullPadding(s) }),
    [points],
  );
  const [size, setSize] = useState<Size | null>(initialSize ?? null);
  const [view, setView] = useState<View | null>(() => (initialSize ? fit(initialSize) : null));
  const sizeRef = useRef<Size | null>(size);

  /** 表示を変える（ズームは 9〜18、真ん中は日本の周りに収める） */
  const update = useCallback((f: (v: View, s: Size) => View) => {
    setView((v) => {
      const s = sizeRef.current;
      return v && s ? clampView(f(v, s), s, FULL_LIMITS) : v;
    });
  }, []);

  // 開く・閉じる。Escape は <dialog> の cancel → close で、「閉じる」と同じ道を通る
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    box.current?.focus({ preventScroll: true });
    // 開いている間は後ろを送らない
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    // 片付けで close() を呼ばない（開発の StrictMode は effect を 2 度回すので、close の知らせで開いた直後に閉じてしまう）。
    // 部品が外れると <dialog> も外れて一番上の層から消える
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // 枠の大きさを測る（画面の向きや幅が変われば測り直す。ズームと中心はそのまま）
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const s = { w: e.contentRect.width, h: e.contentRect.height };
      if (s.w === 0 || s.h === 0) return;
      sizeRef.current = s;
      setSize(s);
      setView((v) => v ?? fit(s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // ホイール（React の onWheel は passive で preventDefault できないので、ここで足す）
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      const dz = wheelZoom(e);
      update((v, s) => zoomAt(v, s, v.z + dz, at));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update]);

  // ドラッグ・指。押しただけ（DRAG_SLOP より動かない）ならピンのリンクがそのまま効く
  const pointers = useRef(new Map<number, Pt>());
  const drag = useRef<{ start: Pt; moved: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const at = local(e);
    pointers.current.set(e.pointerId, at);
    if (pointers.current.size === 1) drag.current = { start: at, moved: false };
    else if (drag.current) drag.current.moved = true; // 2 本目の指が来たらピンチ（押したことにしない）
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const now = local(e);
    const d = drag.current;
    if (d && !d.moved) {
      if (Math.hypot(now.x - d.start.x, now.y - d.start.y) < DRAG_SLOP) return;
      d.moved = true;
    }
    const el = box.current;
    if (el && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    const ids = [...pointers.current.keys()];
    if (ids.length >= 2) {
      const [a, b] = ids;
      if (e.pointerId !== a && e.pointerId !== b) return;
      const before: [Pt, Pt] = [pointers.current.get(a)!, pointers.current.get(b)!];
      pointers.current.set(e.pointerId, now);
      const after: [Pt, Pt] = [pointers.current.get(a)!, pointers.current.get(b)!];
      update((v, s) => pinchView(v, s, before, after));
    } else {
      pointers.current.set(e.pointerId, now);
      update((v) => panBy(v, now.x - prev.x, now.y - prev.y));
    }
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };
  /** 動かしたあとの click はピンへ通さない */
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
    drag.current = null;
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-pin],[data-pin-group]")) return;
    const at = local(e);
    update((v, s) => zoomAt(v, s, stepZoom(v.z, 1), at));
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // ブラウザの拡大（Ctrl ＋）は奪わない
    const a = keyAction(e.key);
    if (!a) return;
    e.preventDefault();
    if (a.type === "pan") update((v) => panBy(v, a.dx, a.dy));
    else update((v, s) => zoomAt(v, s, stepZoom(v.z, a.dz)));
  };

  const close = () => dialog.current?.close();

  // タイル: 見える分だけ。下の地図は周りに 1 枚足し（動かしたときに端が空かない）、透過の層は見える分だけ
  const tz = view ? tileZoom(view.z, BASE_LAYER) : null;
  const baseTiles = useMemo(() => (view && size ? tilesFor(view, size, { range: BASE_LAYER, margin: 1 }) : []), [view, size]);
  const overTiles = useMemo(() => (view && size ? tilesFor(view, size, { range: BASE_LAYER }) : []), [view, size]);
  const shown = tz === null ? [] : HAZARD_LAYERS.filter((l) => choice.on.has(l.id) && inRange(tz, l));
  useHideBrokenTiles(box, [tz, choice.on]);

  // 段が変わったあと、新しい段のタイルが届くまで前の段の読み込み済みのタイルを下に敷く（前の画像を使い回す。新しく要求しない）
  const loaded = useRef(new Set<string>());
  const [backZ, setBackZ] = useState<number | null>(null);
  const lastZ = useRef<number | null>(null);
  useEffect(() => {
    if (tz === null) return;
    if (lastZ.current !== null && lastZ.current !== tz) setBackZ(lastZ.current);
    lastZ.current = tz;
  }, [tz]);
  const backTiles =
    view && size && backZ !== null && backZ !== tz
      ? tilesFor(view, size, { range: { minZ: backZ, maxZ: backZ } }).filter((t) => loaded.current.has(tileKey(t)))
      : [];
  const onBaseLoad = (t: TileSpot) => loaded.current.add(tileKey(t));

  // ピン: 枠の近くの物だけ。名前の印が重なればまとめる（一番寄った段ではまとめない）
  const groups: { group: PinGroup; pins: MapPin[] }[] = useMemo(() => {
    if (!view || !size) return [];
    const byId = new Map(pins.map((p) => [p.id, p]));
    const placed = pins
      .map((p) => {
        const at = place(view, p.location, size);
        return { id: p.id, x: (at.left / 100) * size.w, y: (at.top / 100) * size.h, layer: p.layer, w: labelWidth(p) };
      })
      .filter((p) => p.x > -PIN_CULL && p.x < size.w + PIN_CULL && p.y > -PIN_CULL && p.y < size.h + PIN_CULL);
    const gs =
      view.z >= FULL_ZOOM.maxZ - 0.01
        ? placed.map((p) => ({ head: p.id, ids: [p.id], x: p.x, y: p.y, layer: p.layer }))
        : groupPins(placed, (ids) => COUNT_W + statesWidth(memberStates(ids.map((id) => byId.get(id)!))));
    return gs.map((g) => ({ group: g, pins: g.ids.map((id) => byId.get(id)!) }));
  }, [pins, view, size]);

  /** まとめを押したら、まとめた人が入るまで寄る（入らなければ 1 段寄る） */
  const zoomInto = (g: PinGroup, members: MapPin[]) =>
    update((v, s) => {
      const f = fitView(
        members.map((m) => m.location),
        { minZ: Math.ceil(v.z), maxZ: FULL_ZOOM.maxZ, fallback: members[0].location, size: s, padding: fullPadding(s) },
      );
      return f.z > v.z ? f : zoomAt(v, s, stepZoom(v.z, 1), { x: g.x, y: g.y });
    });

  const zoomLabel = view ? Math.round(view.z) : null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-0 size-full max-h-none max-w-none overscroll-contain bg-base p-0 text-ink backdrop:bg-black/40"
      onClose={onClose}
      onKeyDown={onKeyDown}
      data-map-full
    >
      <figure className="flex h-full flex-col gap-2 p-2 sm:p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-panel px-3 py-2">
          <h2 id={titleId} className="flex items-baseline gap-2 text-[1rem] leading-6 font-bold">
            {MAP_UI.title}
            <span className="text-xs font-normal text-muted tabular-nums">{pins.length} 人</span>
          </h2>
          <PinStates pins={pins} />
          <div className="flex flex-wrap items-center gap-1">
            <LayerToggles choice={choice} demo={demo} tz={tz} />
          </div>
          <Unplaced n={unplaced} />
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {zoomLabel !== null && (
              <span className="text-xs text-muted tabular-nums" data-zoom-label>
                {MAP_UI.zoom} {zoomLabel}
              </span>
            )}
            <Button
              size="sm"
              icon={ZoomOutIcon}
              disabled={!view || view.z <= FULL_ZOOM.minZ}
              onClick={() => update((v, s) => zoomAt(v, s, stepZoom(v.z, -1)))}
              data-map-zoom="out"
            >
              {MAP_UI.zoomOut}
            </Button>
            <Button
              size="sm"
              icon={ZoomInIcon}
              disabled={!view || view.z >= FULL_ZOOM.maxZ}
              onClick={() => update((v, s) => zoomAt(v, s, stepZoom(v.z, 1)))}
              data-map-zoom="in"
            >
              {MAP_UI.zoomIn}
            </Button>
            <Button size="sm" icon={FitIcon} onClick={() => update((_, s) => fit(s))} data-map-fit>
              {MAP_UI.fit}
            </Button>
            <Button size="sm" kind="quiet" icon={CloseIcon} onClick={close} data-map-close>
              {MAP_UI.close}
            </Button>
          </div>
        </div>

        {demo && <DemoBand demo={demo} />}

        <div
          ref={box}
          tabIndex={0}
          aria-label={MAP_UI.title}
          className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden rounded-md bg-panel2 outline-none select-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClickCapture={onClickCapture}
          onDoubleClick={onDoubleClick}
          data-zoom={view ? view.z.toFixed(2) : undefined}
          data-tile-zoom={tz ?? undefined}
        >
          {view && size && (
            <>
              <BaseTiles tiles={backTiles} back />
              <BaseTiles tiles={baseTiles} onLoad={onBaseLoad} />
              <HazardTiles tiles={overTiles} shown={shown} />
              {demo && choice.rainOn && <Rain demo={demo} view={view} size={size} />}
              {groups.map(({ group: g, pins: ms }) =>
                ms.length === 1 ? (
                  <PinLink
                    key={g.head}
                    pin={ms[0]}
                    style={{ left: g.x, top: g.y, zIndex: 10 + g.layer }}
                    onClick={close}
                  />
                ) : (
                  <PinCluster key={g.head} members={ms} group={g} onClick={() => zoomInto(g, ms)} />
                ),
              )}
            </>
          )}
        </div>

        <MapSource shown={shown} />
      </figure>
    </dialog>
  );
}

// ---------- 部品 ----------

function LayerToggles({ choice, demo, tz }: { choice: LayerChoice; demo: DemoOverlay | null; tz: number | null }) {
  return (
    <span role="group" aria-label="重ねる層" className="flex flex-wrap items-center gap-1">
      {HAZARD_LAYERS.map((l) => (
        <LayerButton
          key={l.id}
          pressed={choice.on.has(l.id)}
          onClick={() => choice.toggle(l.id)}
          layer={l.id}
          outOfRange={tz !== null && !inRange(tz, l)}
        >
          {l.label}
        </LayerButton>
      ))}
      {demo && demo.rain.length > 0 && (
        <LayerButton pressed={choice.rainOn} onClick={choice.toggleRain} layer="rain" outOfRange={false}>
          雨雲
        </LayerButton>
      )}
    </span>
  );
}

function Unplaced({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="text-xs tone-check tabular-nums">
      {MAP_UI.unplaced} {n} 人
    </span>
  );
}

/**
 * 状態の色 → 言葉（至急・要確認・不明・無事）。lib/person.ts の COLOR_TONES の逆（lib/person はサーバーの物を多く読むので、
 * 画面の部品からは読まない。食い違いは lib/map/full.test.ts で見る）
 */
export const TONE_LABEL: Record<StateTone, string> = {
  urgent: COLOR_LABELS.red,
  check: COLOR_LABELS.yellow,
  unknown: COLOR_LABELS.gray,
  ok: COLOR_LABELS.green,
};

/** 全画面の上の、地図に出ている人の状態ごとの人数（発災時だけ。至急 2・要確認 1…。0 の状態も並べる） */
function PinStates({ pins }: { pins: ReadonlyArray<MapPin> }) {
  if (!pins.some((p) => p.tone)) return null;
  return (
    <dl className="flex flex-wrap items-baseline gap-x-2.5" data-map-states>
      {TONE_ORDER.map((tone) => {
        const count = pins.filter((p) => p.tone === tone).length;
        return (
          <div key={tone} className="flex items-baseline gap-1" data-tone={tone}>
            <dt className="text-xs text-muted">
              <CountLabel tone={tone} count={count}>
                {TONE_LABEL[tone]}
              </CountLabel>
            </dt>
            <dd className={`font-bold tabular-nums ${countClass(count)}`}>{count}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** デモの印は地図の真上の帯に置く（地図の中に置くとピンと重なる）。破線の枠で、本物の情報と見分ける */
function DemoBand({ demo }: { demo: DemoOverlay }) {
  return (
    <div
      className="flex items-baseline gap-1.5 rounded border border-dashed border-ink px-1.5 py-0.5 text-xs leading-5"
      data-demo="label"
    >
      <span className="font-bold">デモ</span>
      <span>{demo.title}</span>
      {demo.quake && (
        <span className="font-bold" data-demo="quake">
          震度 <span className="text-lg leading-none tabular-nums">{demo.quake.intensity}</span>
        </span>
      )}
      <span className="ml-auto text-muted">想定値</span>
    </div>
  );
}

/** 下の地図（淡色地図）。隣のタイルとの間に髪の毛ほどの隙間が出ないよう 1px 重ねる */
function BaseTiles({ tiles, back = false, onLoad }: { tiles: TileSpot[]; back?: boolean; onLoad?: (t: TileSpot) => void }) {
  return tiles.map((t) => (
    <img
      key={`base-${tileKey(t)}`}
      src={tileUrl(BASE_LAYER.url, t)}
      alt=""
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={hideBroken}
      onLoad={onLoad ? () => onLoad(t) : undefined}
      className="absolute max-w-none select-none dark:brightness-[.82]"
      style={{ left: `${t.left}%`, top: `${t.top}%`, width: `calc(${t.width}% + 1px)`, height: `calc(${t.height}% + 1px)` }}
      data-layer={back ? "base-back" : "base"}
    />
  ));
}

/** 重ねる層（透過。重ねると線が濃くなるので 1px 重ねない） */
function HazardTiles({ tiles, shown }: { tiles: TileSpot[]; shown: readonly HazardLayer[] }) {
  return shown.flatMap((l) =>
    l.urls.flatMap((url) =>
      tiles.map((t) => (
        <img
          key={`${l.id}-${url}-${tileKey(t)}`}
          src={tileUrl(url, t)}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={hideBroken}
          className="absolute max-w-none select-none"
          style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.width}%`, height: `${t.height}%`, opacity: HAZARD_OPACITY }}
          data-layer={l.id}
        />
      )),
    ),
  );
}

/** 雨雲のデモ（灰色の斜線）。枠の大きさの座標で描く */
function Rain({ demo, view, size }: { demo: DemoOverlay; view: View; size: Size }) {
  const hatchId = useId();
  if (demo.rain.length === 0) return null;
  const px = (p: GeoPoint) => {
    const at = place(view, p, size);
    return `${(at.left / 100) * size.w},${(at.top / 100) * size.h}`;
  };
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full text-ink"
      viewBox={`0 0 ${size.w} ${size.h}`}
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
  );
}

/** ピンの名前の印（発災時は状態の塗りの印＋姓） */
function PinLabel({ pin, extra }: { pin: MapPin; extra?: React.ReactNode }) {
  return (
    <span className="flex items-baseline overflow-hidden rounded text-[11px] leading-4 font-bold whitespace-nowrap ring-1 ring-ink/15">
      {pin.tone && pin.state && <span className={`px-1 ${PIN_TAG[pin.tone]}`}>{pin.state}</span>}
      <span className="bg-panel px-1 text-ink">{pin.label}</span>
      {extra}
    </span>
  );
}

function PinDot({ tone }: { tone: StateTone | null }) {
  return <span className={`mt-0.5 size-2 rounded-full ring-2 ring-panel ${tone ? PIN_DOT[tone] : "bg-ink"}`} aria-hidden />;
}

/** ピン 1 人。押すと本人のページ（?open=） */
function PinLink({ pin, style, onClick }: { pin: MapPin; style: React.CSSProperties; onClick?: () => void }) {
  return (
    <Link
      href={pin.href}
      title={pin.title}
      aria-label={pin.title}
      draggable={false}
      onClick={onClick}
      className="absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
      style={style}
      data-pin={pin.id}
      data-tone={pin.tone ?? undefined}
    >
      <PinLabel pin={pin} />
      <PinDot tone={pin.tone} />
    </Link>
  );
}

/**
 * まとめたピン。顔の人の印に「他 N 人」を添え、発災時は中の人（顔の人を除く）の状態ごとの数を塗りの印で並べる
 * （要確認 1・無事 2。色だけにせず言葉と数。T40）。押すと寄る
 */
function PinCluster({ members, group, onClick }: { members: MapPin[]; group: PinGroup; onClick: () => void }) {
  const head = members[0];
  const count = members.length - 1;
  const states = memberStates(members);
  const stateText = states.map((s) => `${TONE_LABEL[s.tone]} ${s.count}`).join(" ");
  const label = [head.title, othersLabel(count), stateText, MAP_UI.zoomIn].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
      style={{ left: group.x, top: group.y, zIndex: 10 + group.layer }}
      data-pin-group={head.id}
      data-count={count + 1}
      data-tone={head.tone ?? undefined}
    >
      <PinLabel
        pin={head}
        extra={
          <span className="flex items-baseline gap-px bg-panel2 tabular-nums">
            <span className="px-1 text-ink">{othersLabel(count)}</span>
            {states.map((s) => (
              <span key={s.tone} data-member-tone={s.tone} className={`px-1 ${PIN_TAG[s.tone]}`}>
                {`${TONE_LABEL[s.tone]} ${s.count}`}
              </span>
            ))}
          </span>
        }
      />
      <PinDot tone={head.tone} />
    </button>
  );
}

function LayerButton({
  pressed,
  onClick,
  layer,
  outOfRange,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  layer: string;
  outOfRange: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-press
      data-toggle={layer}
      data-out-of-range={outOfRange && pressed ? "" : undefined}
      className={`rounded bg-panel2 px-2 py-0.5 text-sm ${pressed ? "font-bold text-ink ring-2 ring-inset ring-accent" : "text-muted"}`}
    >
      {children}
      {outOfRange && pressed && <span className="ml-1 text-xs font-normal text-muted">{MAP_UI.outOfRange}</span>}
    </button>
  );
}

/** 出典（地理院タイル、重ねた層があればハザードマップポータルサイトと層ごとの作成者）と「位置は架空」 */
function MapSource({ shown }: { shown: readonly HazardLayer[] }) {
  return (
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
    </figcaption>
  );
}

function SourceLink({ a }: { a: Attribution }) {
  return (
    <a href={a.href} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press>
      {a.text}
    </a>
  );
}
