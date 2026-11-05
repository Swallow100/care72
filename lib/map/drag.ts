// 地図を指・マウスで動かす決まり（T151）。全部の地図が同じ物を使う: 担当一覧の右の面と全画面・訓練の地図（components/map/CaseMap.tsx）、
// 事業所の地域と本人の位置を置く地図（components/person/LocationPick.tsx）、避難経路の地図の窓（components/map/RouteMap.tsx）。
// 画面の部品は押した・動いた・離したをここへ渡し、返ってきた移動（px）を自分の表示に当てるだけ（純粋な計算で、DOM を読まない）。
// - 1 本のドラッグ（マウス・ペン・指）は移動。DRAG_SLOP より動かなければ押しただけで、ピンのリンクや「押して置く」がそのまま効く
// - 2 本の指はピンチ（拡大・縮小と移動）。2 本目が来たら押したことにしない
// - 画面の送りの中にある地図（gated）は、ホイールと縦の指の送りを画面に渡す。地図を押した後（armed）だけ地図に効かせる。
//   マウス・ペンは押した時、指は押して離した時（叩いた・地図を動かした）に armed になる。ブラウザが指の動きを画面の送りに使った
//   （pointercancel）・枠の外へ出た・焦点が外れたら外れる。全画面（gated でない）はいつも地図に効く
// 雨・地図の操作は色と連絡順に使わない。

import { DRAG_SLOP } from "./camera.ts";
import type { Pt } from "./geo.ts";

export type PointerKind = "mouse" | "pen" | "touch";

/** 1 回の動きの結果 */
export type DragStep =
  | { type: "none" }
  /** 移動。dx・dy は前の動きからの量、total はこの一続きの移動の始めからの量（px）。fresh はこの一続きの最初の移動 */
  | { type: "pan"; dx: number; dy: number; total: Pt; fresh: boolean }
  /** 2 本の指（前の 2 点 → 今の 2 点） */
  | { type: "pinch"; before: [Pt, Pt]; after: [Pt, Pt] };

const kindOf = (k: string): PointerKind => (k === "touch" ? "touch" : k === "pen" ? "pen" : "mouse");

/**
 * 押した指・マウスを数える。地図の部品ごとに 1 つ持つ（React の ref）。座標は地図の枠の座標（lib/map/camera.ts の toFrame で直した物）
 */
export class MapDrag {
  private pointers = new Map<number, Pt>();
  /** 一続きの移動の始めの点（指の数が変わると、残った指の今の点から数え直す） */
  private origin: Pt | null = null;
  /** 押してから DRAG_SLOP より動いたか、2 本目の指が来たか（離したあとの click を押したことにしない） */
  private dragged = false;
  /** 一続きの移動がもう始まったか（fresh を 1 回だけ立てる） */
  private panning = false;
  /** 地図に効かせてよいか（画面の送りの中の地図のホイールと縦の指） */
  armed = false;

  /** 押した。マウスの左以外のボタンは数えない（false） */
  down(id: number, at: Pt, kind: string, button = 0): boolean {
    const k = kindOf(kind);
    if (k === "mouse" && button !== 0) return false;
    if (this.pointers.size === 0) {
      this.dragged = false;
      this.panning = false;
    }
    this.pointers.set(id, at);
    this.rebase();
    if (this.pointers.size >= 2) this.dragged = true; // 2 本目の指はピンチ（押したことにしない）
    if (k !== "touch") this.armed = true;
    return true;
  }

  /** 動いた。押していない指・マウスの動き（上を通っただけ）は none */
  move(id: number, at: Pt): DragStep {
    const prev = this.pointers.get(id);
    if (!prev) return { type: "none" };
    const ids = [...this.pointers.keys()];
    if (ids.length >= 2) {
      const [a, b] = ids;
      if (id !== a && id !== b) {
        this.pointers.set(id, at);
        return { type: "none" };
      }
      const before: [Pt, Pt] = [this.pointers.get(a)!, this.pointers.get(b)!];
      this.pointers.set(id, at);
      const after: [Pt, Pt] = [this.pointers.get(a)!, this.pointers.get(b)!];
      this.panning = false;
      return { type: "pinch", before, after };
    }
    const o = this.origin ?? prev;
    if (!this.dragged) {
      if (Math.hypot(at.x - o.x, at.y - o.y) < DRAG_SLOP) return { type: "none" };
      this.dragged = true;
    }
    this.pointers.set(id, at);
    const fresh = !this.panning;
    this.panning = true;
    // 押しただけの間（DRAG_SLOP の中）に動いた分も、最初の移動に入れる（地図が指に遅れない）
    const from = fresh ? o : prev;
    return { type: "pan", dx: at.x - from.x, dy: at.y - from.y, total: { x: at.x - o.x, y: at.y - o.y }, fresh };
  }

  /**
   * 離した。指を離したときは armed にする（叩いた・地図を動かした）。返す tap は、最後の 1 本を動かさずに離したか
   */
  up(id: number, kind: string): { tap: boolean } {
    if (!this.pointers.has(id)) return { tap: false };
    this.pointers.delete(id);
    const last = this.pointers.size === 0;
    if (kindOf(kind) === "touch") this.armed = true;
    this.rebase();
    return { tap: last && !this.dragged };
  }

  /** ブラウザがその動きを画面の送りに使った（指）・取り消した。地図には効かせず、armed も外す */
  cancel(id: number): void {
    if (!this.pointers.delete(id)) return;
    this.armed = false;
    this.rebase();
  }

  /** 地図の外へ出た（マウス）・焦点が外れた */
  disarm(): void {
    this.armed = false;
  }

  /** 何かを押しているか */
  get active(): boolean {
    return this.pointers.size > 0;
  }

  /** 動かしているか（押してから DRAG_SLOP より動いた） */
  get moving(): boolean {
    return this.dragged && this.pointers.size > 0;
  }

  /**
   * 離したあとの click を押したこととして通すか（ピンのリンク・押して置く）。動かしたあとの click は通さない。
   * 読むと次の押しまで忘れる
   */
  takeClick(): boolean {
    const pass = !this.dragged;
    this.dragged = false;
    return pass;
  }

  /** 指の数が変わったら、残った指の今の点から数え直す（ピンチのあと 1 本で動かすと、離した指の分だけ飛ばない） */
  private rebase() {
    const first = this.pointers.values().next();
    this.origin = first.done ? null : first.value;
    this.panning = false;
  }
}

/**
 * 画面の送りの中の地図（gated）の指の扱い（CSS の touch-action）。地図を押す前は縦の指の送りを画面に渡し（横に動かした指は地図）、
 * 押した後は指を全部地図に（縦も）。全画面はいつも地図に。touch-action は指を置いた時に読まれるので、変えると次の指から効く
 */
export function touchClass(gated: boolean, armed: boolean): "touch-none" | "touch-pan-y" {
  return !gated || armed ? "touch-none" : "touch-pan-y";
}

/**
 * ホイールを段ごとに数える（ズームが整数の段だけの地図: 避難経路の窓）。lib/map/camera.ts の wheelZoom の量（1 回で -1〜1）を足し、
 * 1 段分たまったら 1 段動かす。向きが変わったら数え直す
 */
export function wheelSteps(acc: number, dz: number): { steps: number; acc: number } {
  const sum = Math.sign(acc) !== 0 && Math.sign(acc) !== Math.sign(dz) ? dz : acc + dz;
  // 0.4 を 5 回足すと 0.9999… になるので、端数の誤差の分だけ足して数える
  const steps = Math.trunc(sum + Math.sign(sum) * 1e-9) || 0; // -0 は 0 に
  const rest = sum - steps;
  return { steps, acc: Math.abs(rest) < 1e-9 ? 0 : rest };
}
