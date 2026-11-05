"use client";

// 雨雲（降水ナウキャスト）のタイルを地図に加工せず重ねる（T72 の 4）。CaseMap が、旗 JMA_NOWCAST が on のとき（デモ事業所も。訓練の画面は置かない。T103）だけ置く。
// - 時刻は Workers の route（/api/jma/nowc/times）から一番新しい実況の 1 つだけ（5 分ごとに読み直す）。補間・延長・動画にしない
// - タイルも Workers の route から（ブラウザは気象庁を直接読まない）。不透明度も色も変えない（雨の無い所は透明の PNG のまま）
// - 右下に小さな凡例（降水量の 8 段の色の帯と境の値と「02:20 時点」。components/map/RainScaleLegend.tsx。訓練の雨と同じ部品）。
//   出典は地図の下の出典の行（CaseMap の MapSource、NOWC_SOURCE の文のまま）。T151 で、気象庁の凡例の画像と出典の長い 1 文の白い四角
//   （小さな地図の半分ほどを隠した）から替えた
// 中身の決まりは lib/jma/nowcast.ts。

import { useEffect, useState, type SyntheticEvent } from "react";
import { tilesFor, type Size, type View } from "@/lib/map/geo";
import { nowcastLegendLabel } from "@/lib/map/rain-scale";
import { isNowcTime, NOWC_TIMES_PATH, NOWC_ZOOM, nowcTilePath, stampHm, type NowcTime } from "@/lib/jma/nowcast";
import { RainScaleLegend } from "./RainScaleLegend";

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

/** 雨雲のタイル（地図の枠の中、ピンの下）と右下の小さな凡例（時刻つき） */
export function NowcastLayer({ time, view, size }: { time: NowcTime; view: View; size: Size }) {
  const hm = stampHm(time.validtime);
  return (
    <>
      {tilesFor(view, size, { range: NOWC_ZOOM }).map((t) => (
        <img
          key={`nowc-${t.z}/${t.x}/${t.y}`}
          src={nowcTilePath(time, t.z, t.x, t.y)}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={hide}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.width}%`, height: `${t.height}%` }}
          data-layer="nowcast"
        />
      ))}
      <RainScaleLegend kind="nowcast" head={`${hm} 時点`} label={nowcastLegendLabel(hm)} />
    </>
  );
}
