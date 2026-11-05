"use client";

// 紙の上に置いた文字の枠と画像（T135、components/forms/PaperFill.tsx から分けた。T147 で動かし方と字の大きさを足した）。
// - 枠の本体をつまんで動かす。4 つの角と 4 つの辺をつまんで大きさを変える（画像は縦横の比を保つので角だけ）。PC のマウスとペン
// - 押すと選び、選んだ文字の枠をもう一度押すと字を書く。選んだ枠の上に「大きさ」（文字の枠の字の大きさ。自動は紙の欄と同じ上限から縮む）と「削除」
// - 字の大きさは選んだ値を上限に、枠に入らなければ縮む（下限 6pt。lib/forms/form-entries.ts の freeText）。刷る PDF も同じ（サーバーが同じ関数で描く）
// 動かし方の計算は lib/forms/paper-fill.ts の moveBox・resizeBox（テストあり）。保存は PaperFill の onSaveEntry（/api/forms/entries）。

import { useLayoutEffect, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { postForm, isError } from "@/components/person/intake-api";
import { Button } from "@/components/ui/Button";
import { AddIcon, CloseIcon, ImageIcon, RemoveIcon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { freeText, FREE_TEXT_PTS, type FormEntry } from "@/lib/forms/form-entries";
import type { FieldBox } from "@/lib/forms/mapping";
import {
  ASSET_KIND_LABELS,
  ASSET_KINDS,
  BOX_HANDLES,
  boxMm,
  FILL_LABELS as L,
  IMAGE_HANDLES,
  liveFont,
  moveBox,
  resizeBox,
  type AssetInfo,
  type AssetKind,
  type BoxHandle,
} from "@/lib/forms/paper-fill";
import { shrinkImage } from "@/lib/forms/shrink-image";

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
const at = (b: FieldBox) => ({ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
};
/** 書き始めは入っている字の後ろから */
const caretToEnd = (e: { currentTarget: HTMLTextAreaElement }) => {
  const n = e.currentTarget.value.length;
  e.currentTarget.setSelectionRange(n, n);
};

/** 引いたと見る動きの量（頁の比） */
const DRAG_MIN = 0.002;

export type FreeWriting = { id: string; text: string; fresh: boolean };

export type FreeViewProps = {
  entry: FormEntry;
  layer: React.RefObject<HTMLDivElement | null>;
  /** 頁の大きさ（mm） */
  mm: { w: number; h: number };
  /** 紙の欄の字の上限（pt）。自動のときの上限 */
  maxPt: number;
  assets: Record<string, { name: string; src: string }>;
  selected: boolean;
  setSelected: (id: string | null) => void;
  writing: FreeWriting | null;
  setFreeEdit: (e: FreeWriting | null) => void;
  setFree: (f: (list: FormEntry[]) => FormEntry[]) => void;
  onSaveEntry: (before: FormEntry | null, after: FormEntry | null) => Promise<boolean>;
  busy: boolean;
};

export function FreeView({ entry, layer, mm: pageMm, maxPt, assets, selected, setSelected, writing, setFreeEdit, setFree, onSaveEntry, busy }: FreeViewProps) {
  const box = entry.box!;
  const drag = useRef<{ handle: BoxHandle | "move"; x: number; y: number; start: FieldBox; w: number; h: number; moved: boolean } | null>(null);
  const mm = boxMm(box, pageMm);
  const isText = entry.kind === "text";
  const upperPt = entry.pt ?? maxPt;

  const down = (handle: BoxHandle | "move") => (e: ReactPointerEvent<HTMLElement>) => {
    if (busy || writing || e.button !== 0) return;
    const r = layer.current?.getBoundingClientRect();
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: { ...box }, w: r.width, h: r.height, moved: false };
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.w;
    const dy = (e.clientY - d.y) / d.h;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) <= DRAG_MIN) return;
    d.moved = true;
    const next = d.handle === "move" ? moveBox(d.start, dx, dy) : resizeBox(d.start, d.handle, dx, dy, pageMm, entry.kind === "image");
    setFree((list) => list.map((x) => (x.id === entry.id ? { ...x, box: next } : x)));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      setSelected(entry.id);
      void onSaveEntry({ ...entry, box: d.start }, entry);
      return;
    }
    if (d.handle !== "move") return;
    // 動かさずに離した: 1 回目は選ぶだけ、選んだ文字の枠をもう一度押すと字を書く
    if (!selected) setSelected(entry.id);
    else if (isText && !busy) setFreeEdit({ id: entry.id, text: entry.value, fresh: false });
  };

  const commitText = () => {
    if (!writing) return;
    setFreeEdit(null);
    const text = writing.text.replace(/\r\n/g, "\n");
    if (text.trim() === "") {
      // 書かずに離れた新しい枠は置かない。前からの枠を空にしたら消す
      if (writing.fresh) setFree((list) => list.filter((x) => x.id !== entry.id));
      else void onSaveEntry(entry, null);
      return;
    }
    if (!writing.fresh && text === entry.value) return;
    void onSaveEntry(writing.fresh ? null : entry, { ...entry, value: text });
  };

  const placed = isText ? freeText(writing ? writing.text || " " : entry.value, mm.w, mm.h, upperPt) : null;
  const font = writing ? liveFont(writing.text, mm, upperPt) : null;
  const asset = entry.kind === "image" ? assets[entry.value] : undefined;
  const handles = entry.kind === "image" ? IMAGE_HANDLES : BOX_HANDLES;

  return (
    <div
      className="pf-free"
      style={at(box)}
      data-free-box={entry.id}
      data-kind={entry.kind}
      data-selected={selected ? "1" : undefined}
      data-pt={entry.pt ?? undefined}
      onPointerDown={writing ? undefined : down("move")}
      onPointerMove={move}
      onPointerUp={up}
      onClick={(e) => e.stopPropagation()}
    >
      {entry.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- 事業所の画像（R2 の物を API から）
        <img className="pf-img" src={asset?.src} alt={asset?.name ?? ""} draggable={false} />
      ) : writing ? (
        <textarea
          className="pf-input pf-free-input"
          style={{ fontSize: `${font?.fontPt ?? upperPt}pt` }}
          value={writing.text}
          aria-label={L.textBox}
          maxLength={400}
          autoFocus
          onFocus={caretToEnd}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => setFreeEdit({ ...writing, text: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setFreeEdit(null);
              if (writing.fresh) setFree((list) => list.filter((x) => x.id !== entry.id));
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commitText();
            }
          }}
        />
      ) : (
        <div className="pf-free-text" style={{ fontSize: `${placed?.fontPt ?? upperPt}pt` }} data-font={placed?.fontPt}>
          {(placed?.lines ?? []).map((l, i) => (
            <span key={i} className="pf-ln">
              {l}
            </span>
          ))}
        </div>
      )}
      <span className="pf-tag" title={`${entry.kind === "image" ? L.image : L.textBox} ${entry.by ?? ""} ${when(entry.at)}`.trim()}>
        {entry.kind === "image" ? L.image : L.textBox}
      </span>
      {selected && !writing && (
        <>
          {handles.map((h) => (
            <span key={h} className="pf-handle" data-handle={h} onPointerDown={down(h)} onPointerMove={move} onPointerUp={up} aria-hidden />
          ))}
          <span className="pf-tools" onPointerDown={(e) => e.stopPropagation()} data-free-tools>
            {isText && (
              <label className="pf-tool-size">
                <span>{L.size}</span>
                <Select
                  className="pf-size-select"
                  value={entry.pt ? String(entry.pt) : ""}
                  aria-label={`${L.textBox} ${L.size}`}
                  disabled={busy}
                  onChange={(ev) => {
                    const v = ev.target.value;
                    const pt = v === "" ? null : Number(v);
                    if (pt === (entry.pt ?? null)) return;
                    const { pt: _old, ...rest } = entry;
                    void onSaveEntry(entry, pt === null ? rest : { ...rest, pt });
                  }}
                  data-free-size
                >
                  <option value="">{L.auto}</option>
                  {FREE_TEXT_PTS.map((p) => (
                    <option key={p} value={String(p)}>
                      {p}pt
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <button
              type="button"
              className="pf-remove"
              aria-label={`${entry.kind === "image" ? L.image : L.textBox} ${L.remove}`}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(null);
                setFreeEdit(null);
                void onSaveEntry(entry, null);
              }}
            >
              <RemoveIcon aria-hidden className="size-3.5" />
              {L.remove}
            </button>
          </span>
        </>
      )}
    </div>
  );
}

// ---------- 画像の選択と取り込み ----------

export function AssetPicker({ onClose, onChoose }: { onClose: () => void; onChoose: (a: AssetInfo) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [list, setList] = useState<AssetInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AssetKind>("map");
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  useEffect(() => {
    let alive = true;
    void fetch("/api/forms/assets")
      .then((r) => r.json() as Promise<{ ok: boolean; assets?: AssetInfo[]; label?: string }>)
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.assets) setList(r.assets);
        else setError(r.label ?? L.failed);
      })
      .catch(() => alive && setError(L.failed));
    return () => {
      alive = false;
    };
  }, []);

  async function upload() {
    if (!file || !name.trim()) return;
    setBusy(true);
    setError(null);
    // 長い辺 2000px までの JPEG に縮める（様式の読み取りと同じ縮め方。ここで縮めた画像は紙に置くだけで、Claude には送らない）
    const shrunk = await shrinkImage(file);
    if (!shrunk.ok || shrunk.kind !== "image") {
      setBusy(false);
      setError(L.failed);
      return;
    }
    const size = await imageSize(shrunk.file);
    const form = new FormData();
    form.set("file", shrunk.file);
    form.set("name", name.trim().slice(0, 40));
    form.set("kind", kind);
    form.set("width", String(size.w));
    form.set("height", String(size.h));
    const r = await postForm<{ ok: true; asset: AssetInfo }>("/api/forms/assets", form);
    setBusy(false);
    if (isError(r)) {
      setError(r.label);
      return;
    }
    onChoose(r.asset);
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="pf-picker-title"
      className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-lg bg-panel p-0 text-ink backdrop:bg-black/40"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-fill-picker
    >
      <div className="space-y-3 p-4">
        <h2 id="pf-picker-title" className="flex items-center gap-1.5 text-[1rem] font-bold">
          <ImageIcon aria-hidden className="size-4 shrink-0 text-muted" />
          {L.image}
        </h2>
        {list === null && !error && <p className="text-xs text-muted">…</p>}
        {list && list.length > 0 && (
          <ul className="grid grid-cols-3 gap-2" data-fill-assets>
            {list.map((a) => (
              <li key={a.id}>
                <button type="button" className="block w-full rounded bg-panel2 p-1.5 text-left" data-press onClick={() => onChoose(a)} data-asset={a.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 事業所の画像（R2 の物を API から） */}
                  <img src={a.src} alt="" className="h-20 w-full object-contain" />
                  <span className="mt-1 block truncate text-xs">
                    <span className="text-muted">{ASSET_KIND_LABELS[a.kind]}</span> {a.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 rounded bg-panel2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void upload();
          }}
        >
          <span className="text-xs text-muted">{L.upload}</span>
          <input
            type="file"
            accept="image/jpeg,image/png"
            className="text-xs"
            aria-label={L.upload}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !name) setName(f.name.replace(/\.[^.]+$/, "").slice(0, 40));
            }}
          />
          <span className="text-xs text-muted">{L.name}</span>
          <input className="rounded bg-panel px-2 py-1 text-sm" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label={L.name} />
          <span className="text-xs text-muted">種類</span>
          <div className="flex gap-3 text-sm">
            {ASSET_KINDS.map((k) => (
              <label key={k} className="inline-flex items-center gap-1">
                <input type="radio" name="pf-kind" checked={kind === k} onChange={() => setKind(k)} className="accent-accent" />
                {ASSET_KIND_LABELS[k]}
              </label>
            ))}
          </div>
          <span />
          <div>
            <Button type="submit" kind="add" size="sm" icon={AddIcon} disabled={busy || !file || !name.trim()}>
              {L.upload}
            </Button>
          </div>
        </form>
        {error && <p className="text-xs font-bold text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button kind="quiet" icon={CloseIcon} onClick={onClose}>
            {L.done}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

async function imageSize(file: File): Promise<{ w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { w: img.naturalWidth, h: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
