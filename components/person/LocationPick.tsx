"use client";

// 位置を置く小さな地図（T68）。本人のページの基本の面の「位置」と、事業所の画面の「地域」の「中心」で使う。
// - 地図を押した所にピンを置く（キーの Enter・Space は真ん中に置く）。「外す」でピンを消す。保存は呼ぶ側
// - 拡大・縮小は＋−のボタンだけ（ホイール・ピンチ・引いて動かすは作らない。担当一覧の地図 components/map/CaseMap.tsx の作りは使わない）。
//   ピンがあればピンを真ん中にして拡大する（離れた所は、引いた地図で近くを押す → 拡大 → 押し直す）
// - 真ん中は 本人の位置 → 事業所の中心 → 既定（lib/map/center.ts）。呼ぶ側が center に渡す
// - 下の地図は地理院タイル（lib/map/layers.ts の BASE_LAYER の URL だけ）。出典を下に出す
// 緯度経度は Claude に渡さない（台帳の basic.location。lib/pseudonym の ClaudePerson に無い）。

import { useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/Button";
import { RemoveIcon, ZoomInIcon, ZoomOutIcon } from "@/components/ui/Icon";
import type { GeoPoint } from "@/lib/db/types";
import { PLACE_LABELS } from "@/lib/labels";
import { roundPoint } from "@/lib/map/center";
import { place, project, tilesFor, tileUrl, unproject, type Size } from "@/lib/map/geo";
import { BASE_LAYER, BASE_OPACITY } from "@/lib/map/layers";

/** 枠の基準の大きさ（px）。画面では幅いっぱいに伸び縮みし、縦横の比は保つ */
const SIZE: Size = { w: 320, h: 200 };
/** ズームの範囲（地理院タイルの淡色地図の範囲）と、最初のズーム（置いてある・置いていない）。置いてある時も町名と周りの町が読める 14（前は 16 で道しか見えなかった。T79） */
const MIN_Z = BASE_LAYER.minZ;
const MAX_Z = BASE_LAYER.maxZ;
const PLACED_Z = 14;
const OPEN_Z = 13;

const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/**
 * フォームの POST で送る形（事業所の画面の「中心」）。押した所を自分で覚え、隠しの欄 <name>_lat・<name>_lng に入れる（外すと空）
 */
export function LocationField({
  name,
  defaultValue,
  center,
  label,
  readOnly = false,
}: {
  name: string;
  defaultValue: GeoPoint | null;
  center: GeoPoint;
  label: string;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState<GeoPoint | null>(defaultValue);
  return (
    <>
      <input type="hidden" name={`${name}_lat`} value={value ? String(value.lat) : ""} />
      <input type="hidden" name={`${name}_lng`} value={value ? String(value.lng) : ""} />
      <LocationPick value={value} onChange={setValue} center={center} label={label} readOnly={readOnly} />
    </>
  );
}

type Props = {
  value: GeoPoint | null;
  onChange: (v: GeoPoint | null) => void;
  /** 置いていないときの真ん中（事業所の中心か既定） */
  center: GeoPoint;
  /** 読み上げの名前（「位置」「中心」） */
  label: string;
  /** 見るだけ（押しても置かない。拡大・縮小だけ） */
  readOnly?: boolean;
};

export function LocationPick({ value, onChange, center, label, readOnly = false }: Props) {
  const [z, setZ] = useState(value ? PLACED_Z : OPEN_Z);
  // 地図の真ん中（緯度経度）。最初はピンか呼ぶ側の真ん中
  const [mid, setMid] = useState<GeoPoint>(value ?? center);
  const view = { z, center: project(mid, z) };
  const tiles = tilesFor(view, SIZE, { range: BASE_LAYER });
  const pin = value ? place(view, value, SIZE) : null;
  const pinShown = pin && pin.left >= 0 && pin.left <= 100 && pin.top >= 0 && pin.top <= 100;

  /** 押した所（枠の中の比）を緯度経度に */
  const pointAt = (fx: number, fy: number): GeoPoint =>
    roundPoint(unproject({ x: view.center.x - SIZE.w / 2 + fx * SIZE.w, y: view.center.y - SIZE.h / 2 + fy * SIZE.h }, z));

  const onPick = (e: MouseEvent<HTMLButtonElement>) => {
    if (readOnly) return;
    // キーで押したとき（detail 0）は真ん中に置く
    if (e.detail === 0) {
      onChange(roundPoint(mid));
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    onChange(pointAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
  };

  const zoom = (dz: number) => {
    const next = Math.min(MAX_Z, Math.max(MIN_Z, z + dz));
    if (next === z) return;
    if (value) setMid(value);
    setZ(next);
  };

  return (
    <div className="space-y-1" data-location-pick={label}>
      <div className="relative w-full overflow-hidden rounded bg-panel2 select-none" style={{ aspectRatio: `${SIZE.w} / ${SIZE.h}` }}>
        {tiles.map((t) => (
          <img
            key={`${t.z}/${t.x}/${t.y}`}
            src={tileUrl(BASE_LAYER.url, t)}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.visibility = "hidden";
            }}
            className="pointer-events-none absolute max-w-none opacity-(--map-base-opacity) dark:opacity-100 dark:brightness-[.82]"
            style={{
              left: `${t.left}%`,
              top: `${t.top}%`,
              width: `calc(${t.width}% + 1px)`,
              height: `calc(${t.height}% + 1px)`,
              ["--map-base-opacity" as string]: BASE_OPACITY,
            }}
          />
        ))}
        {/* ピン: 点と、その上の細い柱（押した所が点の真ん中） */}
        {pinShown && (
          <span
            aria-hidden
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel bg-accent-fill"
            style={{ left: `${pin.left}%`, top: `${pin.top}%` }}
            data-location-pin
          />
        )}
        {/* 地図の面そのものが押す所（指で置ける大きさ） */}
        <button
          type="button"
          aria-label={readOnly ? label : `${label} ${value ? "変更" : "設定"}`}
          disabled={readOnly}
          onClick={onPick}
          className={`absolute inset-0 size-full ${readOnly ? "cursor-default" : "cursor-crosshair"} ${FOCUS} focus-visible:-outline-offset-2`}
          data-no-press
          data-location-surface
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button size="sm" icon={ZoomInIcon} className={FOCUS} disabled={z >= MAX_Z} onClick={() => zoom(1)} aria-label={`${label} ${PLACE_LABELS.zoomIn}`}>
          {PLACE_LABELS.zoomIn}
        </Button>
        <Button size="sm" icon={ZoomOutIcon} className={FOCUS} disabled={z <= MIN_Z} onClick={() => zoom(-1)} aria-label={`${label} ${PLACE_LABELS.zoomOut}`}>
          {PLACE_LABELS.zoomOut}
        </Button>
        {!readOnly && value && (
          <Button size="sm" icon={RemoveIcon} className={FOCUS} onClick={() => onChange(null)} aria-label={`${label} ${PLACE_LABELS.unset}`} data-location-unset>
            {PLACE_LABELS.unset}
          </Button>
        )}
        {/* 置いたかどうかだけ。緯度経度の数字は読む人に要らないので出さない（T113）。置いた所は地図のピンで見る */}
        <span className={`ml-auto text-xs ${value ? "" : "text-muted"}`} data-location-value={value ? "set" : "none"}>
          {value ? PLACE_LABELS.set : PLACE_LABELS.none}
        </span>
      </div>
      <p className="text-[11px] leading-4 text-muted">
        出典{" "}
        <a href={BASE_LAYER.attribution.href} target="_blank" rel="noreferrer" className="underline underline-offset-2" data-press>
          {BASE_LAYER.attribution.text}
        </a>
      </p>
    </div>
  );
}
