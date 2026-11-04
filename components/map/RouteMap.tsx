"use client";

// 避難経路の地図（T102）。本人のページの避難の面の下に「経路地図」の行（今の地図の小さな絵と要約）と、押すと開く窓。
// 窓: 避難先（1・2）・手段（徒歩・車）・置く物（避難先・経由点）を選び、地図を押して避難先の位置や経由点を置く。
//   「経路作成」は openrouteservice で引く（/api/evac-route。外へ送るのは家と避難先の座標と手段だけ）。押したときだけ外へ要求する。
//   鍵が無い・失敗したときは、家 → 経由点 → 避難先を直線で結んだ線（手入力）のまま。
//   範囲は 左・右・上・下・拡大・縮小・全体（様式の欄の位置の直し T86 と同じ言葉）。紙はこの範囲を刷る（lib/map/route-image.ts）。
//   「保存」で避難先の位置・経路地図・範囲を台帳に（/api/intake/save の edit、経過に「ケアマネが直した: 経路地図」）
// 担当一覧の地図（CaseMap）の雨と状態の層とは別の部品。位置は Claude に渡さない。ケアマネの役で開いたときだけ出す（PersonView）。

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import {
  CloseIcon,
  FitIcon,
  MoveDownIcon,
  MoveLeftIcon,
  MoveRightIcon,
  MoveUpIcon,
  RemoveIcon,
  RetryIcon,
  RouteMapIcon,
  SaveIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@/components/ui/Icon";
import { isError, postJson } from "@/components/person/intake-api";
import type { GeoPoint, RouteMode } from "@/lib/db/types";
import type { EditData } from "@/lib/intake/edit";
import { PLACE_LABELS, ROUTE_LABELS as L } from "@/lib/labels";
import { pickCenter } from "@/lib/map/center";
import { isGeoPoint } from "@/lib/map/geo";
import { BASE_LAYER } from "@/lib/map/layers";
import { ORS_ATTRIBUTION, type RouteResult } from "@/lib/map/route";
import {
  currentRoute,
  fitRoute,
  panRoute,
  pickPoint,
  pointInFrame,
  routeChange,
  routeDraft,
  routeSummary,
  zoomRoute,
  ROUTE_VIA_MAX,
  type PanDir,
  type RouteDraft,
} from "@/lib/map/route-edit";
import { ROUTE_FRAME, ROUTE_ZOOM, routeScene, routeSceneOf } from "@/lib/map/route-image";
import { RouteSceneSvg } from "./RouteSceneSvg";

const LABEL_COL = "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2";
const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

const pointOrNull = (p: unknown): GeoPoint | null => (isGeoPoint(p) ? p : null);

/** 画面に描いた幅がこれ以上なら、地図のタイルを 1 段細かくする（基準の枠 480px を大きく伸ばすと地図の字がぼやけて大きくなる） */
const DETAIL_PX = 720;

/** 要素の幅（px）。測れるまで null */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(el.getBoundingClientRect().width || null);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** 本人のページの避難の面の「経路地図」の行（小さな絵と要約、窓を開くボタン） */
export function RouteMapPanel({ data }: { data: EditData }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [box, px] = useWidth<HTMLDivElement>();
  const map = data.ledger.evacuation.routeMap;
  const scene = routeSceneOf(data.ledger, ROUTE_FRAME, px && px >= DETAIL_PX ? 1 : 0);
  return (
    <div className={`${LABEL_COL} mt-1`} data-field="evacuation.routeMap">
      <span className="pt-1 text-xs text-muted">{L.open}</span>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums" data-route-summary>
            {map && scene ? routeSummary(map) : L.none}
          </span>
          {note && (
            <span role="alert" className="text-xs font-bold text-danger">
              {note}
            </span>
          )}
          <Button
            size="sm"
            icon={RouteMapIcon}
            className="ml-auto"
            onClick={() => {
              setNote(null);
              setOpen(true);
            }}
            data-route-open
          >
            {L.open}
          </Button>
        </div>
        <div ref={box} className="overflow-hidden rounded">
          {scene && <RouteSceneSvg scene={scene} label={L.title} px={px} />}
        </div>
      </div>
      {open && (
        <RouteEditor
          data={data}
          onClose={(why) => {
            setOpen(false);
            setNote(why ?? null);
          }}
        />
      )}
    </div>
  );
}

type Busy = "route" | "save" | null;

/** 経路地図の窓。閉じるときに理由（競合）があれば渡す */
export function RouteEditor({ data, onClose }: { data: EditData; onClose: (why?: string) => void }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [frame, px] = useWidth<HTMLDivElement>();
  const home = pointOrNull(data.ledger.basic.location);
  const [d, setD] = useState<RouteDraft>(() => routeDraft(data.ledger, pickCenter(home, data.place?.center)));
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 開く。開いている間は後ろを送らない（地図の全画面・黒塗りの窓と同じ形）
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (!el.open) el.showModal();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  const e = data.ledger.evacuation;
  const dest = d.dest[d.to];
  const route = currentRoute(d, home);
  const scene = routeScene({
    map: route ? { ...route, view: d.view } : { to: d.to, mode: d.mode, source: "hand", line: [], via: d.via, distanceM: 0, view: d.view },
    home,
    dest,
    size: ROUTE_FRAME,
    detail: px && px >= DETAIL_PX ? 1 : 0,
  });
  const change = routeChange(data.ledger, d);
  const set = (next: RouteDraft) => {
    setD(next);
    setError(null);
  };

  const onPick = (ev: MouseEvent<HTMLButtonElement>) => {
    // キーで押したとき（detail 0）は真ん中に置く
    if (ev.detail === 0) return set(pickPoint(d, pointInFrame(d.view, 0.5, 0.5)));
    const r = ev.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    set(pickPoint(d, pointInFrame(d.view, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height)));
  };

  async function makeRoute() {
    if (!home || !dest || busy) return;
    setBusy("route");
    setNote(null);
    const r = await postJson<RouteResult & { ok: true }>("/api/evac-route", { personId: data.personId, to: dest, mode: d.mode });
    setBusy(null);
    if (isError(r)) {
      // 鍵なし・経路なし・上限・失敗は手入力の線のまま（理由の印だけ出す）
      setNote(r.label);
      return;
    }
    const line = r.line;
    setD((cur) => ({
      ...cur,
      via: [],
      auto: { to: cur.to, mode: cur.mode, dest, line, distanceM: r.distanceM, durationS: r.durationS },
      view: fitRoute([home, dest, ...line], home),
    }));
  }

  async function save() {
    if (!change || busy) return;
    setBusy("save");
    setError(null);
    const r = await postJson<{ ok: true }>("/api/intake/save", { personId: data.personId, version: data.version, ai: null, edit: true, changes: [change] });
    setBusy(null);
    if (isError(r)) {
      // 競合はほかの人の保存。閉じて読み直す（ほかの人の保存を上書きしない。置いた所は開き直して置き直す。面の編集と同じ）
      if (r.error === "conflict") {
        onClose(L.conflict);
        router.refresh();
        return;
      }
      setError(r.label || L.saveFailed);
      return;
    }
    onClose();
    router.refresh();
  }

  const toggle = (on: boolean, label: string, onClick: () => void, attr: string, sub?: string) => (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${buttonClass("quiet", "sm")} ${on ? "underline decoration-2 underline-offset-[6px]" : "font-normal text-muted"} ${FOCUS}`}
      data-press=""
      data-route-toggle={attr}
    >
      {label}
      {sub && <span className="ml-1 max-w-32 truncate text-xs font-normal">{sub}</span>}
    </button>
  );
  const pan = (dir: PanDir) => set({ ...d, view: panRoute(d.view, dir) });

  const status = !home ? L.noHome : !dest ? `${L.dest}${d.to} ${L.noDest}` : route ? routeSummary(route) : L.none;

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100%-1rem)] max-w-[880px] rounded-lg bg-panel p-0 text-ink backdrop:bg-black/40"
      onCancel={(ev) => {
        ev.preventDefault();
        if (busy !== "save") onClose();
      }}
      data-route-editor
    >
      <div className="space-y-2 px-3 py-2.5 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id={titleId} className="text-[1rem] leading-6 font-bold">
            {L.title}
          </h2>
          <span role="status" className="text-xs tabular-nums" data-route-status>
            {busy === "route" ? <span className="text-muted">{L.busy}</span> : status}
            {note && busy !== "route" && (
              <span className="ml-2 font-bold" data-route-note>
                {note}
              </span>
            )}
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button kind="quiet" size="sm" icon={CloseIcon} disabled={busy === "save"} onClick={() => onClose()} data-route-discard>
              {L.discard}
            </Button>
            <Button kind="main" size="sm" icon={SaveIcon} disabled={busy !== null || change === null} onClick={() => void save()} data-route-save>
              {L.save}
            </Button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-xs font-bold text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Choice label={L.dest}>
            {([1, 2] as const).map((n) =>
              toggle(d.to === n, `${L.dest}${n}`, () => set({ ...d, to: n, tool: d.dest[n] ? d.tool : "dest" }), `to-${n}`, (n === 1 ? e.destination1 : e.destination2) || undefined),
            )}
          </Choice>
          <Choice label={L.mode}>
            {(["foot", "car"] as const satisfies readonly RouteMode[]).map((m) => toggle(d.mode === m, L[m], () => set({ ...d, mode: m }), `mode-${m}`))}
          </Choice>
          <Choice label={L.tool}>
            {toggle(d.tool === "dest", L.dest, () => set({ ...d, tool: "dest" }), "tool-dest")}
            {toggle(d.tool === "via", L.via, () => set({ ...d, tool: "via" }), "tool-via")}
          </Choice>
        </div>

        <div ref={frame} className="relative overflow-hidden rounded bg-panel2" style={{ aspectRatio: `${ROUTE_FRAME.w} / ${ROUTE_FRAME.h}` }}>
          <RouteSceneSvg scene={scene} label={L.title} px={px} />
          {/* 地図の面そのものが押す所（置く物を置く） */}
          <button
            type="button"
            aria-label={`${d.tool === "dest" ? `${L.dest}${d.to}` : L.via} ${L.tool}`}
            onClick={onPick}
            disabled={d.tool === "via" && d.via.length >= ROUTE_VIA_MAX}
            className={`absolute inset-0 size-full cursor-crosshair ${FOCUS} focus-visible:-outline-offset-2`}
            data-no-press
            data-route-surface
          />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" icon={MoveLeftIcon} className={FOCUS} onClick={() => pan("left")}>
            {L.left}
          </Button>
          <Button size="sm" icon={MoveRightIcon} className={FOCUS} onClick={() => pan("right")}>
            {L.right}
          </Button>
          <Button size="sm" icon={MoveUpIcon} className={FOCUS} onClick={() => pan("up")}>
            {L.up}
          </Button>
          <Button size="sm" icon={MoveDownIcon} className={FOCUS} onClick={() => pan("down")}>
            {L.down}
          </Button>
          <Button size="sm" icon={ZoomInIcon} className={FOCUS} disabled={d.view.z >= ROUTE_ZOOM.maxZ} onClick={() => set({ ...d, view: zoomRoute(d.view, 1) })}>
            {PLACE_LABELS.zoomIn}
          </Button>
          <Button size="sm" icon={ZoomOutIcon} className={FOCUS} disabled={d.view.z <= ROUTE_ZOOM.minZ} onClick={() => set({ ...d, view: zoomRoute(d.view, -1) })}>
            {PLACE_LABELS.zoomOut}
          </Button>
          <Button
            size="sm"
            icon={FitIcon}
            className={FOCUS}
            onClick={() => set({ ...d, view: fitRoute([home, dest, ...(route?.line ?? [])].filter((p): p is GeoPoint => p !== null), pickCenter(home, data.place?.center)) })}
            data-route-fit
          >
            {L.fit}
          </Button>
          <span className="mx-0.5 hidden h-4 w-px bg-panel2 sm:inline-block" aria-hidden />
          <Button size="sm" icon={RetryIcon} className={FOCUS} disabled={!home || !dest || busy !== null} onClick={() => void makeRoute()} data-route-make>
            {L.make}
          </Button>
          <Button size="sm" kind="danger" icon={RemoveIcon} className={FOCUS} disabled={d.via.length === 0} onClick={() => set({ ...d, via: d.via.slice(0, -1) })} data-route-via-undo>
            {L.viaUndo}
          </Button>
        </div>

        <p className="text-[11px] leading-4 text-muted">
          {L.credit}{" "}
          <a href={BASE_LAYER.attribution.href} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press>
            {BASE_LAYER.attribution.text}
          </a>
          {route?.source === "ors" && (
            <>
              {" "}
              <a href={ORS_ATTRIBUTION.href} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press data-route-ors-credit>
                {ORS_ATTRIBUTION.text}
              </a>
            </>
          )}
        </p>
      </div>
    </dialog>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      <span className="mr-1 text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}
