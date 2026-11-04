"use client";

// 場所の確かめ（T86）。元の様式の頁の画像の上に、欄ごとの値を書く場所（AI が読んだ矩形）を重ねて見せ、ずれていれば直す。
// - 頁は切替（1頁・2頁…）。選んだ欄の頁へ移る。枠を押すとその欄を選ぶ（表の行も選ばれる）
// - 選んだ欄の枠は操作の色の太い線、ほかは灰の破線、AI の自信が低い欄は黄の線。面は塗らない（様式の字を隠さない）
// - 直し方: 左・右・上・下で動かす（頁の 0.5%）、数（%）で左端・上端・幅・高さ、画像を押すと選んだ枠の左上をそこへ。
//   画像に焦点があるときは矢印キーで動かし、Shift と矢印で大きさを変える。choice は選択肢ごとの □ の場所も同じく直せる
// - 拡大: 画像を列の幅いっぱいに（高さで縛らない。画面全体の縦の送りで見る）。縮小で画面の高さに収まる大きさに戻す
// - 状態は親（MappingEditor）が持つ。ここは描くのと、直した場所を返すだけ

import { useEffect, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/Button";
import { AddIcon, MoveDownIcon, MoveLeftIcon, MoveRightIcon, MoveUpIcon, RemoveIcon, ZoomInIcon, ZoomOutIcon } from "@/components/ui/Icon";
import { INPUT } from "@/components/person/intake-ui";
import { BOX_STEP, boxOf, defaultSize, FIELD_TARGET, fromPercent, moveBox, placeAt, resizeBox, type BoxTarget } from "@/lib/forms/box-edit";
import { MAPPING_LABELS as L, type FieldBox, type MappingField } from "@/lib/forms/mapping";

export type PageImageView = { page: number; width: number; height: number; src: string };

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const PERCENT_KEYS: Array<{ key: keyof FieldBox; label: string }> = [
  { key: "x", label: "左端" },
  { key: "y", label: "上端" },
  { key: "w", label: "幅" },
  { key: "h", label: "高さ" },
];

export function PageBoxes({
  pages,
  fields,
  selected,
  target,
  onSelect,
  onTarget,
  onBox,
  zoom = false,
  onZoom,
}: {
  pages: PageImageView[];
  fields: MappingField[];
  selected: string | null;
  target: BoxTarget;
  onSelect: (id: string) => void;
  onTarget: (t: BoxTarget) => void;
  onBox: (fieldId: string, target: BoxTarget, box: FieldBox | null) => void;
  /** 拡大（列の幅いっぱい）。親が列の幅を変える */
  zoom?: boolean;
  onZoom?: (zoom: boolean) => void;
}) {
  const sel = fields.find((f) => f.id === selected && !f.removed) ?? null;
  const [page, setPage] = useState(sel?.page ?? 1);
  // 選んだ欄の頁へ移る
  useEffect(() => {
    if (sel) setPage(Math.min(sel.page, pages.length));
  }, [sel?.id, sel?.page, pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const img = pages.find((p) => p.page === page) ?? pages[0];
  const onPage = fields.filter((f) => !f.removed && f.page === img.page);
  const box = sel ? boxOf(sel, target) : null;
  const set = (b: FieldBox | null) => sel && onBox(sel.id, target, b);

  // 画像を押すと、選んだ枠の左上をそこへ（場所が無ければ決まった大きさで置く）
  const place = (e: MouseEvent<HTMLDivElement>) => {
    if (!sel || sel.page !== img.page) return;
    const r = e.currentTarget.getBoundingClientRect();
    set(placeAt(box, defaultSize(sel, target), (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height));
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!box) return;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    set(e.shiftKey ? resizeBox(box, d[0] * BOX_STEP, d[1] * BOX_STEP) : moveBox(box, d[0] * BOX_STEP, d[1] * BOX_STEP));
  };

  return (
    <div className="grid content-start gap-2" data-page-boxes>
      <div className="flex flex-wrap items-center gap-1">
        {pages.length > 1 && (
        <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label="頁">
          {pages.map((p) => (
            <button
              key={p.page}
              type="button"
              aria-pressed={p.page === img.page}
              className={`relative rounded px-2 py-1 ${p.page === img.page ? "font-bold text-ink underline decoration-2 underline-offset-[6px]" : "text-muted"}`}
              data-press
              onClick={() => setPage(p.page)}
            >
              {p.page}頁
            </button>
          ))}
        </div>
        )}
        {onZoom && (
          <Button size="sm" kind="quiet" icon={zoom ? ZoomOutIcon : ZoomInIcon} className="ml-auto" onClick={() => onZoom(!zoom)}>
            {zoom ? "縮小" : "拡大"}
          </Button>
        )}
      </div>

      {/* 画像の箱は画像と同じ縦横の比。高さが画面に収まる幅にする（画面の中で送らない） */}
      <div
        className="relative mx-auto bg-white outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
        style={{ width: zoom ? "100%" : `min(100%, calc((100dvh - 15rem) * ${img.width / img.height}))`, aspectRatio: `${img.width} / ${img.height}` }}
        tabIndex={0}
        aria-label={`${img.page}頁 元様式`}
        onClick={place}
        onKeyDown={keys}
        data-page-image={img.page}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 様式の頁の画像（R2 の物を API から）。next/image の変換は通さない */}
        <img src={img.src} alt={`${img.page}頁`} className="absolute inset-0 size-full select-none" draggable={false} />
        {onPage.map((f) => {
          const b = f.box ?? null;
          if (!b) return null;
          const on = f.id === sel?.id;
          const low = f.ai !== null && (f.ai.confidence === "low" || f.ai.rejected !== undefined);
          return (
            <button
              key={f.id}
              type="button"
              title={f.section ? `${f.section} ${f.label}` : f.label}
              aria-label={f.label}
              aria-pressed={on}
              className={`absolute ${on && target === FIELD_TARGET ? "border-2 border-accent" : on ? "border border-accent" : low ? "border border-state-check" : "border border-dashed border-muted"}`}
              style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }}
              data-box={f.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(f.id);
                onTarget(FIELD_TARGET);
              }}
            />
          );
        })}
        {sel?.page === img.page &&
          sel.shape === "choice" &&
          sel.options.map((o, i) => {
            const b = sel.optionBoxes?.[i] ?? null;
            if (!b) return null;
            return (
              <button
                key={`${sel.id}-${i}`}
                type="button"
                title={o}
                aria-label={o}
                aria-pressed={target === i}
                className={`absolute ${target === i ? "border-2 border-accent" : "border border-accent"}`}
                style={{ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) }}
                data-option-box={i}
                onClick={(e) => {
                  e.stopPropagation();
                  onTarget(i);
                }}
              />
            );
          })}
      </div>

      {sel && <BoxControls field={sel} target={target} box={box} onTarget={onTarget} set={set} />}
    </div>
  );
}

function BoxControls({
  field,
  target,
  box,
  onTarget,
  set,
}: {
  field: MappingField;
  target: BoxTarget;
  box: FieldBox | null;
  onTarget: (t: BoxTarget) => void;
  set: (b: FieldBox | null) => void;
}) {
  const move = (dx: number, dy: number) => box && set(moveBox(box, dx * BOX_STEP, dy * BOX_STEP));
  const targets = field.shape === "choice" ? [{ t: FIELD_TARGET, label: "欄" }, ...field.options.map((o, i) => ({ t: i, label: o }))] : [];
  return (
    <div className="grid gap-1.5 rounded bg-panel2 p-2 text-sm" data-box-controls={field.id}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-bold">{field.label}</span>
        {field.section && <span className="text-xs text-muted">{field.section}</span>}
        <span className="text-xs text-muted tabular-nums">{field.page}頁</span>
      </div>
      {targets.length > 0 && (
        <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="対象">
          {targets.map((x) => (
            <button
              key={x.t}
              type="button"
              aria-pressed={x.t === target}
              className={`relative rounded px-1.5 py-0.5 ${x.t === target ? "font-bold text-ink underline decoration-2 underline-offset-4" : "text-muted"}`}
              data-press
              onClick={() => onTarget(x.t)}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
      {box ? (
        <>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" icon={MoveLeftIcon} onClick={() => move(-1, 0)}>
              左
            </Button>
            <Button size="sm" icon={MoveRightIcon} onClick={() => move(1, 0)}>
              右
            </Button>
            <Button size="sm" icon={MoveUpIcon} onClick={() => move(0, -1)}>
              上
            </Button>
            <Button size="sm" icon={MoveDownIcon} onClick={() => move(0, 1)}>
              下
            </Button>
            <Button size="sm" kind="quiet" icon={RemoveIcon} className="ml-auto" onClick={() => set(null)}>
              {L.clearBox}
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {PERCENT_KEYS.map((k) => (
              <PercentInput key={`${field.id}-${target}-${k.key}`} label={k.label} name={k.key} value={box[k.key]} onCommit={(v) => set(fromPercent(box, k.key, v))} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{L.noBox}</span>
          <Button kind="add" size="sm" icon={AddIcon} onClick={() => set(placeAt(null, defaultSize(field, target), 0.4, 0.45))}>
            {L.addBox}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * 場所の数（%）の欄。打っている間は下書きで持ち、欄を出る・Enter で決める。上下の矢印・欄の増減の印は打つたびに決める
 * （打つ途中の「30.」を毎回 30 に直すと、小数が打てない）
 */
function PercentInput({ label, name, value, onCommit }: { label: string; name: keyof FieldBox; value: number; onCommit: (percent: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = String(Math.round(value * 1000) / 10);
  const commit = (text: string) => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n)) onCommit(n);
    setDraft(null);
  };
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    // 打った字（insertText など）は下書き。矢印・増減の印（inputType が無い）はすぐ決める
    const typed = Boolean((e.nativeEvent as InputEvent).inputType);
    if (typed) setDraft(e.target.value);
    else commit(e.target.value);
  };
  return (
    <label className="grid gap-0.5 text-xs text-muted">
      {label}
      <input
        type="number"
        step={0.1}
        min={0}
        max={100}
        className={`${INPUT} py-0.5 text-xs text-ink tabular-nums`}
        value={draft ?? shown}
        onChange={change}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(e.currentTarget.value);
          }
        }}
        data-box-input={name}
      />
    </label>
  );
}
