"use client";

// 地図の枠の指・マウス・ホイール（T151）。全部の地図が使う: CaseMap（右の面・訓練・全画面）、LocationPick（事業所の地域・本人の位置）、
// 避難経路の窓（RouteMap）。押した・動いた・離したの数えは lib/map/drag.ts の MapDrag（純粋な計算）、ホイールの決まりは lib/map/camera.ts。
// 部品は返ってきた移動・ピンチ・ホイールを自分の表示（View・真ん中とズーム）に当てるだけ。
// gated: 画面の送りの中にある地図。ホイールは Ctrl（⌘）か地図を押した後だけ（ほかは画面の送りに渡し、短く「Ctrl＋ホイールで拡大」）、
//   指は押す前は縦の送りを画面に（touch-action: pan-y）、押した後は全部地図に（touch-action: none）。全画面は gated でない

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { sideWheelTakes, toFrame, wheelZoom } from "@/lib/map/camera";
import { MapDrag, touchClass, type DragStep } from "@/lib/map/drag";
import type { Pt, Size } from "@/lib/map/geo";

/** ホイールを地図に効かせなかったときの知らせを出す長さ（ミリ秒） */
const HINT_MS = 1500;

export type PanStep = Extract<DragStep, { type: "pan" }>;

export type MapDragOptions = {
  box: RefObject<HTMLElement | null>;
  /** 計算の枠の大きさ（地図ごとの基準の大きさ。全画面は測った大きさ）。測れていなければ null */
  frame: () => Size | null;
  gated: boolean;
  onPan: (step: PanStep) => void;
  onPinch?: (before: [Pt, Pt], after: [Pt, Pt]) => void;
  /** ホイール（dz は lib/map/camera.ts の wheelZoom、at は枠の座標のカーソルの所） */
  onWheel: (dz: number, at: Pt) => void;
};

export function useMapDrag({ box, frame, gated, onPan, onPinch, onWheel }: MapDragOptions) {
  const drag = useRef(new MapDrag());
  const [armed, setArmed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ホイールの受け口は 1 回だけ付け、中で今の値を読む
  const latest = useRef({ frame, gated, onWheel });
  useEffect(() => {
    latest.current = { frame, gated, onWheel };
  });

  const sync = useCallback(() => {
    setArmed(drag.current.armed);
    setMoving(drag.current.moving);
  }, []);

  const local = useCallback(
    (e: { clientX: number; clientY: number }): Pt | null => {
      const el = box.current;
      const s = frame();
      return el && s ? toFrame({ x: e.clientX, y: e.clientY }, el.getBoundingClientRect(), s) : null;
    },
    [box, frame],
  );

  const showHint = useCallback(() => {
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), HINT_MS);
  }, []);
  useEffect(() => () => void (hintTimer.current && clearTimeout(hintTimer.current)), []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheelEvent = (e: WheelEvent) => {
      const { frame: f, gated: g, onWheel: w } = latest.current;
      if (g && !sideWheelTakes(e, drag.current.armed)) {
        showHint();
        return;
      }
      const s = f();
      if (!s) return;
      e.preventDefault();
      w(wheelZoom(e), toFrame({ x: e.clientX, y: e.clientY }, el.getBoundingClientRect(), s));
    };
    el.addEventListener("wheel", onWheelEvent, { passive: false });
    return () => el.removeEventListener("wheel", onWheelEvent);
  }, [box, showHint]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const at = local(e);
    if (!at) return;
    if (drag.current.down(e.pointerId, at, e.pointerType, e.button)) sync();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const at = local(e);
    if (!at) return;
    const step = drag.current.move(e.pointerId, at);
    if (step.type === "none") return;
    // 動き出してから枠に捕まえる（押しただけならピンのリンク・押して置くボタンがそのまま受ける）
    const el = box.current;
    if (el && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    if (step.type === "pan") onPan(step);
    else onPinch?.(step.before, step.after);
    if (!moving) sync();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    drag.current.up(e.pointerId, e.pointerType);
    sync();
  };
  const onPointerCancel = (e: React.PointerEvent<HTMLElement>) => {
    drag.current.cancel(e.pointerId);
    sync();
  };
  const onPointerLeave = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    // 押したまま捕まえずに外へ出た（動かす前）なら、その押しは忘れる
    if (!box.current?.hasPointerCapture(e.pointerId)) drag.current.cancel(e.pointerId);
    drag.current.disarm();
    sync();
  };
  const onBlur = (e: React.FocusEvent<HTMLElement>) => {
    // 枠の中のボタン・リンクへ焦点が移っただけなら外さない
    if (e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget)) return;
    drag.current.disarm();
    sync();
  };
  /** 動かしたあとの click は、ピンのリンクにも押して置くボタンにも通さない */
  const onClickCapture = (e: React.MouseEvent) => {
    if (!drag.current.takeClick()) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return {
    armed,
    moving,
    hint,
    /** 枠の class に足す touch-action */
    touch: touchClass(gated, armed),
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onBlur, onClickCapture },
  };
}
