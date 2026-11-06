"use client";

// 雨雲（降水ナウキャスト）のタイルを地図に加工せず重ねる（T72 の 4）。CaseMap が、旗 JMA_NOWCAST が on のとき（デモ事業所も。訓練の画面は置かない。T103）だけ置く。
// - 時刻は Workers の route（/api/jma/nowc/times）から一番新しい実況の 1 つだけ（5 分ごとに読み直す）。補間・延長・動画にしない
// - タイルも Workers の route から（ブラウザは気象庁を直接読まない）。色は変えず、層を NOWCAST_OPACITY（0.65）で透かす（T151b。前は不透明で、
//   弱い雨の白っぽい色・薄い水色が地図の地名と道を隠した。雨の無い所は透明の PNG のまま）
// - 右下に小さな凡例（降水量の 8 段の色の帯と境の値と「02:20 時点」。components/map/RainScaleLegend.tsx。訓練の雨と同じ部品）。
//   出典は地図の下の出典の行（CaseMap の MapSource、NOWC_SOURCE の文のまま）。T151 で、気象庁の凡例の画像と出典の長い 1 文の白い四角
//   （小さな地図の半分ほどを隠した）から替えた
// - タイルの段は 5〜10（NOWC_ZOOM）。地図がそれより寄ると段 10 のタイルを引き伸ばし、引くと段 5 のタイルを縮めて並べる（lib/map/geo.ts の
//   tilesFor が段を範囲に収める。画像は加工せず、表示の大きさだけ）。地図は事業所のまわりの町の縮尺なので、雨が地図の外（ほかの地方）にあると出ない。
//   だから見えている所に雨が無いときは凡例の左に「範囲内 雨なし」（lib/map/rain-in-view.ts。T151b）
// 中身の決まりは lib/jma/nowcast.ts。

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { tilesFor, type Size, type TileSpot, type View } from "@/lib/map/geo";
import { MAP_UI } from "@/lib/map/labels";
import { NOWCAST_OPACITY } from "@/lib/map/layers";
import { hasRain, rainInView, TILE_PX, visiblePixels, type RainInView } from "@/lib/map/rain-in-view";
import { nowcastLegendLabel } from "@/lib/map/rain-scale";
import { isNowcTime, NOWC_TIMES_PATH, NOWC_ZOOM, nowcTilePath, stampHm, type NowcTime } from "@/lib/jma/nowcast";
import { LegendNote, RainScaleLegend } from "./RainScaleLegend";

/** 時刻を読み直す間（ミリ秒） */
const RELOAD_MS = 5 * 60_000;

function hide(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = "hidden";
}

/** 一番新しい実況の時刻。enabled でなければ読まない（null）。取れなければ null */
export function useNowcastTime(enabled: boolean): NowcTime | null {
  const [time, setTime] = useState<NowcTime | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () =>
      fetch(NOWC_TIMES_PATH)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: unknown) => {
          if (alive) setTime(isNowcTime(j) ? { basetime: j.basetime, validtime: j.validtime } : null);
        })
        .catch(() => {
          if (alive) setTime(null);
        });
    void load();
    const id = setInterval(load, RELOAD_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);
  return enabled ? time : null;
}

/** 読んだタイルの画素（同じ origin の route の画像。読めなければ null） */
function readTile(src: string): Promise<ImageData | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = TILE_PX;
        c.height = TILE_PX;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) return resolve(null);
        g.drawImage(img, 0, 0, TILE_PX, TILE_PX);
        resolve(g.getImageData(0, 0, TILE_PX, TILE_PX));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * 見えている所に雨があるか（T151b）。動かすのが止まってから（0.3 秒）タイルの見えている画素を読む。タイルの画素は時刻ごとに覚える
 * （画面の <img> と同じ URL なので、読み直しはブラウザの写しから）
 */
function useRainInView(time: NowcTime, tiles: TileSpot[]): RainInView {
  const memo = useRef(new Map<string, ImageData | null>());
  const [state, setState] = useState<RainInView>("checking");
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const results = await Promise.all(
        tiles.map(async (t) => {
          const src = nowcTilePath(time, t.z, t.x, t.y);
          let d = memo.current.get(src);
          if (d === undefined) {
            d = await readTile(src);
            memo.current.set(src, d);
          }
          if (!d) return null;
          const r = visiblePixels(t);
          return r ? hasRain(d.data, TILE_PX, r) : false;
        }),
      );
      if (alive) setState(rainInView(results));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [time, tiles]);
  return state;
}

/** 雨雲のタイル（地図の枠の中、ピンの下）と右下の小さな凡例（時刻つき）。見えている所に雨が無ければ凡例の左に「範囲内 雨なし」 */
export function NowcastLayer({ time, view, size }: { time: NowcTime; view: View; size: Size }) {
  const hm = stampHm(time.validtime);
  const tiles = useMemo(() => tilesFor(view, size, { range: NOWC_ZOOM }), [view, size]);
  const rain = useRainInView(time, tiles);
  return (
    <>
      {tiles.map((t) => (
        <img
          key={`nowc-${t.z}/${t.x}/${t.y}`}
          src={nowcTilePath(time, t.z, t.x, t.y)}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={hide}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.width}%`, height: `${t.height}%`, opacity: NOWCAST_OPACITY }}
          data-layer="nowcast"
        />
      ))}
      <RainScaleLegend kind="nowcast" head={`${hm} 時点`} label={nowcastLegendLabel(hm)} />
      <NowcastNote state={rain} />
    </>
  );
}

/** 凡例の左の知らせ。見えている所に雨が無いと分かったときだけ（読んでいる途中・読めないタイルがあるときは出さない） */
export function NowcastNote({ state }: { state: RainInView }) {
  return state === "none" ? <LegendNote>{MAP_UI.rainNone}</LegendNote> : null;
}
