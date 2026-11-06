import { MAP_UI } from "@/lib/map/labels";

/**
 * 画面の送りの中の地図で、Ctrl なしのホイールを地図に効かせなかったとき、地図の真ん中に短く出す（T66。T151 で全部の地図に）。
 * 地図を押してからなら Ctrl なしでも効く
 */
export function WheelHint() {
  return (
    <p
      role="status"
      className="pointer-events-none absolute inset-x-0 top-1/2 z-40 mx-auto w-fit -translate-y-1/2 rounded bg-panel px-2 py-1 text-xs font-bold text-ink ring-1 ring-ink/15"
      data-wheel-hint
    >
      {MAP_UI.wheelHint}
    </p>
  );
}
