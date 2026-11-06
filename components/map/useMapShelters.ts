"use client";

// 地図の避難所（T169、lib/map/shelters.ts）。強く拡大しているあいだだけ、映っている所を覆うズーム 10 のタイルをブラウザが読む。
// 引いた地図では要求しない。読んだタイルは覚えるので、動かしても・読み直しでも同じタイルを要求しない。
// 描くのは読めたあとだけ（サーバーの描画には出ない）。

import { useEffect, useMemo, useState } from "react";
import { tileZoom, type Size, type View } from "@/lib/map/geo";
import { BASE_LAYER } from "@/lib/map/layers";
import { fetchMapShelters, SHELTER_MAP_ZOOM, shelterTilesForView, type MapShelter, type MapShelterResult } from "@/lib/map/shelters";

export type MapSheltersState = {
  /** 今のズームで出せるか（引いているときは false で「要拡大」） */
  inZoom: boolean;
  list: readonly MapShelter[];
  failed: boolean;
};

export function useMapShelters(on: boolean, view: View | null, size: Size | null): MapSheltersState {
  const inZoom = view !== null && tileZoom(view.z, BASE_LAYER) >= SHELTER_MAP_ZOOM;
  const tiles = useMemo(() => (on && inZoom && view && size ? shelterTilesForView(view, size) : []), [on, inZoom, view, size]);
  const key = tiles.map((t) => `${t.x}/${t.y}`).join("|");
  const [got, setGot] = useState<{ key: string; result: MapShelterResult } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchMapShelters({ tiles }).then((result) => {
      if (alive) setGot({ key, result });
    });
    return () => {
      alive = false;
    };
    // tiles は key が同じなら同じ中身（動かしても同じタイルのあいだは読み直さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!on || !inZoom || !got) return { inZoom, list: [], failed: false };
  // タイルをまたいで読んでいる間は前の印を残す（動かすたびに消えないように）
  return { inZoom, list: got.result.ok ? got.result.list : [], failed: !got.result.ok && got.key === key };
}
