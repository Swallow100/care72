// 地図の場所の印（T170。仮想の訓練の世界の出来事）。人のピンと見分けるため四角の点で、人の状態の色を使わない。タイルの上では地の色の差が効かないので、ピンと同じ細い線で囲む。
// 押せない（地図のドラッグを奪わない）。印はピンの点の下に置き、人の名前の印やほかの印に重なれば下へ送って細い線で元の所とつなぐ（lib/map/marks.ts の layoutMarks）。
// 小さな地図で言葉を置けない印は四角の点だけにし、右下に「他 N」（全画面と場所別の一覧に全部ある）。
// 出来事は訓練の想定なので、印があるときは地図の上に「デモ」の帯（MarkBand）。

import { labelWidth } from "@/lib/map/cluster";
import { place, type Size, type View } from "@/lib/map/geo";
import { layoutMarks, MARK_BAND, type MapMark } from "@/lib/map/marks";
import type { MapPin } from "@/lib/map/side";

/** 場所の印があるときの帯（デモの帯と同じ破線の枠） */
export function MarkBand() {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 rounded border border-dashed border-ink px-1.5 py-0.5 text-xs leading-5" data-demo="marks">
      <span className="font-bold">{MARK_BAND.head}</span>
      <span>{MARK_BAND.title}</span>
      <span className="ml-auto text-muted">{MARK_BAND.tail}</span>
    </div>
  );
}

/** 小さな地図で印を下へ送る長さの上限（px）。これより遠いと元の所が読めない */
const SMALL_MAX_DROP = 36;

export function WorldMarks({
  marks,
  pins,
  view,
  size,
  wording,
}: {
  marks: ReadonlyArray<MapMark>;
  pins: ReadonlyArray<MapPin>;
  view: View;
  size: Size;
  /** short は小さな地図（出来事だけ）、label は全画面（場所と出来事） */
  wording: "short" | "label";
}) {
  const at = (p: MapPin["location"]) => {
    const q = place(view, p, size);
    return { left: q.left, top: q.top, x: (q.left / 100) * size.w, y: (q.top / 100) * size.h };
  };
  const placed = marks.map((m) => ({ mark: m, text: m[wording], ...at(m.at) }));
  const drops = layoutMarks(
    placed.map((p) => ({ id: p.mark.id, x: p.x, y: p.y, text: p.text })),
    pins.map((p) => ({ ...at(p.location), w: labelWidth(p) + (p.note ? p.note.length * 11 + 8 : 0) })),
    wording === "short" ? { maxDrop: SMALL_MAX_DROP, height: size.h } : {},
  );
  const hidden = placed.filter((p) => drops[p.mark.id] === null).length;
  const shown = placed.flatMap(({ mark, text, left, top }) => {
    const drop = drops[mark.id];
    // 言葉を置けない印も、場所は四角の点で示す
    if (drop === null || drop === undefined) {
      return [<span key={mark.id} title={mark.title} className="pointer-events-none absolute z-[5] size-2 -translate-x-1/2 -translate-y-1/2 bg-ink outline-1 outline-panel" style={{ left: `${left}%`, top: `${top}%` }} data-world-mark={mark.id} data-world-mark-dot aria-hidden />];
    }
    return [(
      <span key={mark.id} className="pointer-events-none absolute z-[5]" style={{ left: `${left}%`, top: `${top}%` }} data-world-mark={mark.id} data-drop={drop}>
        {drop > 0 && <span className="absolute top-0 left-0 w-px bg-ink" style={{ height: drop }} aria-hidden />}
        <span
          title={mark.title}
          className="absolute flex -translate-x-1/2 items-center gap-1 rounded-sm bg-panel px-1 text-[11px] leading-4 whitespace-nowrap text-ink outline-1 outline-ink/50"
          style={{ top: drop }}
        >
          <span className="size-1.5 shrink-0 bg-ink" aria-hidden />
          {text}
        </span>
      </span>
    )];
  });
  return (
    <>
      {shown}
      {hidden > 0 && (
        <span className="pointer-events-none absolute right-1 bottom-1 z-[5] rounded-sm bg-panel px-1 outline-1 outline-ink/50 text-[11px] leading-4 text-ink tabular-nums" data-world-mark-more={hidden}>
          {MARK_BAND.more} {hidden}
        </span>
      )}
    </>
  );
}
