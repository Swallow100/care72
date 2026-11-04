"use client";

// 避難経路の地図（T102）。本人のページの避難の面の下に「経路地図」の行（今の地図の小さな絵と要約）と、押すと開く窓。
// 窓: 避難先（1・2）・手段（徒歩・車）・置く物（避難先・経由点）を選び、地図を押して避難先の位置や経由点を置く。
//   「経路作成」は openrouteservice で引く（/api/evac-route。外へ送るのは家〔約 150 m の格子に丸めた点〕と避難先の座標と手段だけ）。
//   押したときだけ外へ要求する。本当の家から線の始まりまでは点線、枠の左上に「経路 目安」（lib/map/route-image.ts）。
//   鍵が無い・失敗したときは、家 → 経由点 → 避難先を直線で結んだ線（手入力）のまま。
//   範囲は 左・右・上・下・拡大・縮小・全体（様式の欄の位置の直し T86 と同じ言葉）。紙はこの範囲を刷る（lib/map/route-image.ts）。
//   「保存」で避難先の位置・経路地図・範囲を台帳に（/api/intake/save の edit、経過に「ケアマネが直した: 経路地図」）
// T112:
//   「候補」は国土地理院の指定緊急避難場所・指定避難所を、押したときだけブラウザが読む（lib/map/shelters.ts。外へ出るのは層とタイルの z/x/y だけ）。
//   一覧か地図の印を押すと、名前と位置が今の避難先（1・2）に入る（保存で避難先の文字も直す）。手で置く道も残す（置いた所が候補の近くなら候補に寄せる）
//   徒歩の時間は台帳の歩行から出典の速さで見込み「目安」と添える。浸水のハザードがあり手段が車なら「冠水注意」（色と連絡順には使わない）
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
  ShelterIcon,
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
  candidateKinds,
  fetchShelters,
  shelterLayers,
  snapCandidate,
  SHELTER_CREDIT,
  type ShelterCandidate,
} from "@/lib/map/shelters";
import { floodCar, FLOOD_CAR_SOURCE, walkSpeedOf, WALK_SPEED_SOURCE } from "@/lib/map/transport";
import { sourceById } from "@/lib/sources";
import {
  currentRoute,
  destNameChanges,
  frameOf,
  pickCandidate,
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
import { markPath, ROUTE_FRAME, ROUTE_ZOOM, routeScene, routeSceneOf } from "@/lib/map/route-image";
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
  const flood = map && scene ? floodCar(data.ledger, map.mode) : false;
  return (
    <div className={`${LABEL_COL} mt-1`} data-field="evacuation.routeMap">
      <span className="pt-1 text-xs text-muted">{L.open}</span>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums" data-route-summary>
            {map && scene ? routeSummary(map, walkSpeedOf(data.ledger)) : L.none}
          </span>
          {flood && <FloodMark />}
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

type Busy = "route" | "save" | "candidates" | null;

/** 候補の読み込みの状態（押す前・読めた・読めない） */
type Cands = { state: "idle" } | { state: "ok"; list: ShelterCandidate[] } | { state: "failed" };

/** 地図を押した所から候補に寄せる距離（m） */
const SNAP_M = 40;

const samePlace = (a: GeoPoint | null, b: GeoPoint) => !!a && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

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
  const [cands, setCands] = useState<Cands>({ state: "idle" });

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
  const routeCh = routeChange(data.ledger, d);
  // 経路地図と、候補から選んだ避難先の名前を 1 回で保存する
  const changes = [...(routeCh ? [routeCh] : []), ...destNameChanges(data.ledger, d)];
  const set = (next: RouteDraft) => {
    setD(next);
    setError(null);
  };
  const list = cands.state === "ok" ? cands.list : [];
  const walk = walkSpeedOf(data.ledger);
  const flood = floodCar(data.ledger, d.mode);
  const nameOf = (n: 1 | 2) => d.names?.[n] || (n === 1 ? e.destination1 : e.destination2) || undefined;

  const onPick = (ev: MouseEvent<HTMLButtonElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    // キーで押したとき（detail 0）は真ん中に置く
    let p: GeoPoint;
    if (ev.detail === 0) p = pointInFrame(d.view, 0.5, 0.5);
    else if (r.width <= 0 || r.height <= 0) return;
    else p = pointInFrame(d.view, (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    // 避難先を置くとき、候補の近くなら候補に寄せる（名前も入る）
    const near = d.tool === "dest" ? snapCandidate(list, p, SNAP_M) : null;
    set(near ? pickCandidate(d, near) : pickPoint(d, p));
  };

  async function loadCandidates() {
    if (!home || busy) return;
    setBusy("candidates");
    setNote(null);
    const r = await fetchShelters({ home, layers: shelterLayers(data.ledger) });
    setBusy(null);
    setCands(r.ok ? { state: "ok", list: r.candidates } : { state: "failed" });
  }

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
    if (changes.length === 0 || busy) return;
    setBusy("save");
    setError(null);
    const r = await postJson<{ ok: true }>("/api/intake/save", { personId: data.personId, version: data.version, ai: null, edit: true, changes });
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

  // 一覧の中で作る物にも key を付ける（React の key の警告。T112）
  const toggle = (on: boolean, label: string, onClick: () => void, attr: string, sub?: string) => (
    <button
      key={attr}
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

  const status = !home ? L.noHome : !dest ? `${L.dest}${d.to} ${L.noDest}` : route ? routeSummary(route, walk) : L.none;
  const candNote =
    busy === "candidates" ? null : cands.state === "failed" ? L.failed : cands.state === "ok" && cands.list.length === 0 ? L.candidatesNone : null;
  const walkBasis = sourceById(WALK_SPEED_SOURCE);
  const floodBasis = sourceById(FLOOD_CAR_SOURCE);

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
            {busy === "route" || busy === "candidates" ? <span className="text-muted">{L.busy}</span> : status}
            {flood && busy === null && <FloodMark className="ml-2" />}
            {note && busy !== "route" && (
              <span className="ml-2 font-bold" data-route-note>
                {note}
              </span>
            )}
            {candNote && (
              <span className="ml-2 font-bold" data-route-cand-note>
                {L.candidates} {candNote}
              </span>
            )}
          </span>
          <div className="ml-auto flex gap-1.5">
            <Button kind="quiet" size="sm" icon={CloseIcon} disabled={busy === "save"} onClick={() => onClose()} data-route-discard>
              {L.discard}
            </Button>
            <Button kind="main" size="sm" icon={SaveIcon} disabled={busy !== null || changes.length === 0} onClick={() => void save()} data-route-save>
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
            {([1, 2] as const).map((n) => toggle(d.to === n, `${L.dest}${n}`, () => set({ ...d, to: n, tool: d.dest[n] ? d.tool : "dest" }), `to-${n}`, nameOf(n)))}
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
          {/* 候補の印（白抜きの旗。旗の竿の根元が位置）。押すと今の避難先に。選んだ避難先と同じ所の候補は塗った旗が出ているので出さない */}
          {list.map((c) => {
            const { fx, fy } = frameOf(d.view, c.at);
            if (fx < 0 || fx > 1 || fy < 0 || fy > 1 || samePlace(dest, c.at)) return null;
            return (
              <button
                key={c.id}
                type="button"
                title={c.name}
                aria-label={`${c.name} ${L.dest}${d.to}`}
                onClick={() => set(pickCandidate(d, c))}
                className={`absolute size-6 -translate-x-[42%] -translate-y-[96%] cursor-pointer ${FOCUS}`}
                style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }}
                data-no-press
                data-route-candidate={c.id}
              >
                <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
                  <path d={markPath("dest", 10, 23, 8.5)} className="fill-panel stroke-accent-fill" strokeWidth={1.8} strokeLinejoin="round" />
                </svg>
              </button>
            );
          })}
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
          <Button size="sm" icon={ShelterIcon} className={FOCUS} disabled={!home || busy !== null} onClick={() => void loadCandidates()} data-route-candidates>
            {L.candidates}
          </Button>
          <Button size="sm" icon={RetryIcon} className={FOCUS} disabled={!home || !dest || busy !== null} onClick={() => void makeRoute()} data-route-make>
            {L.make}
          </Button>
          <Button size="sm" kind="danger" icon={RemoveIcon} className={FOCUS} disabled={d.via.length === 0} onClick={() => set({ ...d, via: d.via.slice(0, -1) })} data-route-via-undo>
            {L.viaUndo}
          </Button>
        </div>

        {list.length > 0 && (
          <ul aria-label={L.candidates} className="grid gap-x-3 sm:grid-cols-2" data-route-candidate-list>
            {list.map((c) => {
              const on = samePlace(dest, c.at);
              return (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => set(pickCandidate(d, c))}
                    className={`flex w-full min-w-0 items-baseline gap-2 rounded px-1 py-1 text-left ${FOCUS}`}
                    data-press=""
                    data-route-candidate-row={c.id}
                  >
                    <span className={`min-w-0 truncate ${on ? "font-bold underline decoration-2 underline-offset-4" : ""}`}>{c.name}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{c.distanceM >= 1000 ? `${(c.distanceM / 1000).toFixed(1)} km` : `${c.distanceM} m`}</span>
                    <span className="min-w-0 truncate text-xs text-muted">
                      {candidateKinds(c, { emergency: L.kindEmergency, shelter: L.kindShelter, welfare: L.kindWelfare })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

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
          {cands.state === "ok" && (
            <>
              {" "}
              <a href={SHELTER_CREDIT.href} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press data-route-shelter-credit>
                {SHELTER_CREDIT.text}
              </a>{" "}
              <a href={SHELTER_CREDIT.noticeHref} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press data-route-shelter-notice>
                {SHELTER_CREDIT.notice}
              </a>
            </>
          )}
          {route?.mode === "foot" && (
            <>
              {" "}
              <span data-route-walk>
                {L.speed} {walk} m/秒
              </span>{" "}
              <a href={walkBasis.url} target="_blank" rel="noreferrer" title={walkBasis.title} className="underline underline-offset-2" data-press data-basis={walkBasis.id}>
                {L.basis} {walkBasis.publisher} {walkBasis.year}
              </a>
            </>
          )}
          {flood && (
            <>
              {" "}
              {L.floodCar}{" "}
              <a href={floodBasis.url} target="_blank" rel="noreferrer" title={floodBasis.title} className="underline underline-offset-2" data-press data-basis={floodBasis.id}>
                {L.basis} {floodBasis.publisher} {floodBasis.year}
              </a>
            </>
          )}
        </p>
      </div>
    </dialog>
  );
}

/** 「冠水注意」の 1 語（本文の色。状態の色と連絡の順には使わない） */
function FloodMark({ className = "" }: { className?: string }) {
  return (
    <span className={`text-xs font-bold ${className}`} data-route-flood>
      {L.floodCar}
    </span>
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
