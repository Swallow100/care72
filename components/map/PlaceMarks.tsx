// 地図の避難先と避難所の印（T169）。強く拡大したときだけ。2 種類を形と文字で分ける:
// - 計画の避難先（台帳の値。位置のある物だけ）: 塗った旗と「避難先」・名前・人数
// - 地図の避難所（国土地理院のデータ）: 白抜きの旗と「避難所」「福祉」「緊急避難」・名前（名前が重なる物は旗だけ）
// 旗は経路地図の窓と同じ形（lib/map/route-image.ts の markPath。塗りが選んだ避難先、白抜きが候補）。人のピンは名前の印の下に丸い点なので形が違う。
// 色は操作の色 1 色（状態の 4 色を使わない）。人のピンより下に重ね、まとめには入れない。押す物ではない（押すと本人のページへ移るのは人のピンだけ）。

import { place, type Size, type View } from "@/lib/map/geo";
import { markPath } from "@/lib/map/route-image";
import { candidateKinds, SHELTER_MAP_ZOOM, shelterNameIds, withoutPlanned, type MapShelter } from "@/lib/map/shelters";
import { MAP_UI } from "@/lib/map/labels";
import type { MapDestination } from "@/lib/map/side";
import { ROUTE_LABELS as L } from "@/lib/labels";

/** 枠の外でもこの px までの印は描く（端で切れないように） */
const CULL = 40;

const KINDS = { emergency: L.kindEmergency, shelter: L.kindShelter, welfare: L.kindWelfare };

/** 短い種類の言葉（避難所が先。指定緊急避難場所だけの所は「緊急避難」） */
function shortKind(s: Pick<MapShelter, "shelter" | "welfare">): string {
  return s.welfare && !s.shelter ? KINDS.welfare : s.shelter ? KINDS.shelter : KINDS.emergency;
}

function Flag({ filled }: { filled: boolean }) {
  // 竿の根元（10, 23）が位置。親は大きさ 0 の点なので、そこから左上へずらす。旗の先は位置から右へ 15px
  return (
    <svg width="28" height="26" viewBox="0 0 28 26" className="absolute -top-[23px] -left-[10px]" aria-hidden>
      <path
        d={markPath("dest", 10, 23, 8.5)}
        className={filled ? "fill-accent-fill stroke-panel" : "fill-panel stroke-accent-fill"}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PlaceMarks({
  view,
  size,
  tz,
  shelters,
  destinations,
}: {
  view: View;
  size: Size;
  /** 今のタイルの段 */
  tz: number;
  shelters: readonly MapShelter[];
  destinations: readonly MapDestination[];
}) {
  if (tz < SHELTER_MAP_ZOOM) return null;
  const at = <T extends { at: MapDestination["at"] }>(x: T) => {
    const p = place(view, x.at, size);
    return { x, left: p.left, top: p.top, px: (p.left / 100) * size.w, py: (p.top / 100) * size.h };
  };
  const inFrame = (p: { px: number; py: number }) => p.px > -CULL && p.px < size.w + CULL && p.py > -CULL && p.py < size.h + CULL;
  const dests = destinations.map(at).filter(inFrame);
  // 計画の避難先と同じ施設は計画の方だけ出す（同じ名前で旗が重なる）。名前と距離の両方で比べる（T184。同じ名前の別の場所は出す）
  const marks = withoutPlanned(shelters, destinations)
    .map(at)
    .filter(inFrame);
  const names = shelterNameIds(
    marks.map((m) => ({ id: m.x.id, x: m.px, y: m.py, name: m.x.name })),
    dests.map((d) => ({ x: d.px, y: d.py, w: [...d.x.name].length * 11 + 90 })),
  );
  return (
    <>
      {marks.map(({ x: s, left, top }) => {
        const title = `${candidateKinds(s, KINDS)} ${s.name}`;
        return (
          <span key={s.id} role="img" aria-label={title} title={title} className="absolute size-0" style={{ left: `${left}%`, top: `${top}%`, zIndex: 4 }} data-map-shelter={shortKind(s)}>
            <Flag filled={false} />
            {names.has(s.id) && (
              <span className="absolute -top-[23px] left-[18px] flex max-w-56 items-baseline overflow-hidden rounded-sm text-[11px] leading-4 whitespace-nowrap" data-map-shelter-name>
                <span className="shrink-0 bg-panel2 px-1 text-muted">{shortKind(s)}</span>
                <span className="min-w-0 truncate bg-panel px-1 text-ink">{s.name}</span>
              </span>
            )}
          </span>
        );
      })}
      {dests.map(({ x: d, left, top }) => {
        const title = `${MAP_UI.planDest} ${d.name} ${d.people.join("・")}`;
        return (
          <span key={d.id} role="img" aria-label={title} title={title} className="absolute size-0" style={{ left: `${left}%`, top: `${top}%`, zIndex: 5 }} data-map-dest={d.id}>
            <Flag filled />
            <span className="absolute -top-[23px] left-[18px] flex items-baseline overflow-hidden rounded-sm text-xs leading-[1.125rem] font-bold whitespace-nowrap ring-2 ring-panel">
              <span className="bg-panel2 px-1 text-ink">{MAP_UI.planDest}</span>
              <span className="bg-panel px-1 text-ink">{d.name}</span>
              <span className="bg-panel pr-1 font-normal text-muted tabular-nums">{d.people.length} 人</span>
            </span>
          </span>
        );
      })}
    </>
  );
}
