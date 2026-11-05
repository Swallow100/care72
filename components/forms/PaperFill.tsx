"use client";

// 紙の上でその場で入れる（T135）。元の様式の上に値を置いた紙（OverlaySheet）を包み、頁ごとの層（.ov-layer）に重ねて描く:
// - 欄: 押すと欄の上で入れる。字は紙に刷るときと同じ決まり（lib/forms/paper-fill.ts の liveFont → fitText）の大きさで、欄の矩形の中だけ。
//   □ は押して印、部品つきの欄（年・月・日、− −）は部品ごと。元が台帳の何か所かにまたがる欄は入力の窓（T117 の EditWindow）
// - 行き先: 台帳の項目に当たる欄は台帳（欄の脇に「台帳」）、様式だけの欄はその人のその様式の手入れ（「様式」）。どちらも誰がいつを残す
// - 文字の枠と画像: 紙の上の好きな所に置き、動かす・大きさを変える。刷る PDF にも同じ位置（サーバーが紙に描く）
// - 印（手で入れた所・置いた枠と画像）は画面だけ。取消・再実行
// - 質問: この紙の空いた欄のうち台帳に項目のある欄の問い（定型）を順に聞く。答えは台帳に入り紙が埋まる
// 保存は /api/forms/entries（台帳は lib/intake/save.ts の saveIntake を通る）。Claude は通らない。紙の部品は状態を持たないまま（サーバーの描画）。
// 印刷では層も帯も出ない（paper-fill.css）。

import "./paper-fill.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { postJson, isError, postForm } from "@/components/person/intake-api";
import { IntakeQuestion } from "@/components/person/IntakeQuestion";
import { Button } from "@/components/ui/Button";
import { AddIcon, AskIcon, CloseIcon, ImageIcon, MarkIcon, RedoIcon, RemoveIcon, TextBoxIcon, UndoIcon } from "@/components/ui/Icon";
import { EditWindow } from "./PaperEdit";
import type { IntakeChange } from "@/lib/intake/changes";
import type { Question } from "@/lib/intake/ask";
import { freeText, type FormEntry } from "@/lib/forms/form-entries";
import type { FieldBox } from "@/lib/forms/mapping";
import {
  ASSET_KIND_LABELS,
  ASSET_KINDS,
  boxMm,
  FILL_LABELS as L,
  joinParts,
  liveFont,
  partsOf,
  slotChanges,
  toggleOption,
  type AssetInfo,
  type AssetKind,
  type PaperFillData,
  type PaperSlot,
  type SlotValue,
} from "@/lib/forms/paper-fill";
import { shrinkImage } from "@/lib/forms/shrink-image";

type Op =
  /** 欄の値（台帳か様式だけ） */
  | { t: "value"; key: string; before: SlotValue; after: SlotValue }
  /** 文字の枠・画像（before が null は置いた、after が null は消した） */
  | { t: "entry"; before: FormEntry | null; after: FormEntry | null };

type Status = { tone: "ok" | "danger"; text: string } | null;
type Saved = { ok: true; version?: number };

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;
const at = (b: FieldBox) => ({ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });
const newId = () => `fe-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const sameValue = (a: SlotValue, b: SlotValue) => JSON.stringify(a) === JSON.stringify(b);
const textOf = (v: SlotValue) => (typeof v === "string" ? v : Array.isArray(v) ? v.join("・") : "");
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
};

/** 書き始めは入っている字の後ろから */
const caretToEnd = (e: { currentTarget: HTMLTextAreaElement }) => {
  const n = e.currentTarget.value.length;
  e.currentTarget.setSelectionRange(n, n);
};

/** 欄の印の文字（台帳・様式）と、誰がいつ */
const handTitle = (s: PaperSlot) => `${s.dest === "ledger" ? L.ledger : L.form}${s.hand ? ` ${s.hand.by ?? ""} ${when(s.hand.at)}` : ""}`.trim();

export function PaperFill({ data, children }: { data: PaperFillData; children: ReactNode }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Record<number, HTMLElement>>({});
  const version = useRef(data.version);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [undo, setUndo] = useState<Op[]>([]);
  const [redo, setRedo] = useState<Op[]>([]);
  const [marks, setMarks] = useState(true);
  const [editing, setEditing] = useState<{ key: string; parts: string[] } | null>(null);
  const [windowSlot, setWindowSlot] = useState<PaperSlot | null>(null);
  const [free, setFree] = useState<FormEntry[]>(data.free);
  const [selected, setSelected] = useState<string | null>(null);
  const [freeEdit, setFreeEdit] = useState<{ id: string; text: string; fresh: boolean } | null>(null);
  const [placing, setPlacing] = useState<null | { kind: "text" } | { kind: "image"; asset: AssetInfo }>(null);
  const [picker, setPicker] = useState(false);
  const [asking, setAsking] = useState(false);
  const [skip, setSkip] = useState<string[]>([]);
  const [assets, setAssets] = useState<Record<string, { name: string; src: string }>>(data.assets);
  const busy = saving || refreshing;

  useEffect(() => {
    version.current = Math.max(version.current, data.version);
  }, [data.version]);
  // 読み直した紙の手入れを写す（動かしている・書いている最中は待つ）
  useEffect(() => {
    if (!freeEdit) setFree(data.free);
    setAssets((a) => ({ ...a, ...data.assets }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 読み直したときだけ
  }, [data.free, data.assets]);

  // 頁ごとの層（OverlaySheet の .ov-layer）を探す
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const found: Record<number, HTMLElement> = {};
    for (const n of el.querySelectorAll<HTMLElement>("[data-layer]")) found[Number(n.dataset.layer)] = n;
    setLayers(found);
  }, [data]);

  const bySlot = useMemo(() => new Map(data.slots.map((s) => [s.key, s])), [data.slots]);
  const pageMm = useCallback((page: number) => data.pages.find((p) => p.page === page) ?? { page, w: 210, h: 297 }, [data.pages]);
  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  // ---------- 保存 ----------

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<Saved | null> => {
      setSaving(true);
      const r = await postJson<Saved>("/api/forms/entries", { personId: data.personId, formId: data.formId, ...body });
      setSaving(false);
      if (isError(r)) {
        setStatus({ tone: "danger", text: `${L.failed} ${r.label}` });
        if (r.error === "conflict") refresh();
        return null;
      }
      if (r.version) version.current = r.version;
      return r;
    },
    [data.personId, data.formId, refresh],
  );

  /** 台帳に入れる（面の編集と同じ手入力。edit が false は問いの答え） */
  const saveLedger = useCallback(
    async (changes: IntakeChange[], keys: string[], edit = true): Promise<boolean> => {
      if (changes.length === 0) return true;
      const r = await post({ op: "ledger", fieldKeys: keys, version: version.current, edit, changes });
      if (!r) return false;
      setStatus({ tone: "ok", text: `${L.ledger} ${L.saved}` });
      refresh();
      return true;
    },
    [post, refresh],
  );

  /** 欄の値を入れる（台帳か様式だけ）。record は取消の列に積むか */
  const saveValue = useCallback(
    async (slot: PaperSlot, next: SlotValue, record = true): Promise<boolean> => {
      if (sameValue(slot.value, next)) return true;
      let ok: boolean;
      if (slot.dest === "ledger") {
        const { changes, bad } = slotChanges(slot, next);
        if (bad) {
          setStatus({ tone: "danger", text: `${L.failed} ${slot.label}` });
          return false;
        }
        ok = await saveLedger(changes, [slot.key]);
      } else {
        const empty = next === false || (typeof next === "string" && next.trim() === "") || (Array.isArray(next) && next.length === 0);
        const r = empty
          ? slot.entryId
            ? await post({ op: "remove", id: slot.entryId })
            : { ok: true as const }
          : await post({ op: "put", entry: { id: slot.entryId ?? newId(), kind: "field", fieldKey: slot.key, page: null, box: null, value: JSON.stringify(next) } });
        ok = r !== null;
        if (ok) {
          setStatus({ tone: "ok", text: `${L.form} ${L.saved}` });
          refresh();
        }
      }
      if (ok && record) {
        setUndo((u) => [...u, { t: "value", key: slot.key, before: slot.value, after: next }]);
        setRedo([]);
      }
      return ok;
    },
    [post, refresh, saveLedger],
  );

  /** 文字の枠・画像を入れる（after が null は取り消す） */
  const saveEntry = useCallback(
    async (before: FormEntry | null, after: FormEntry | null, record = true): Promise<boolean> => {
      const r = after
        ? await post({ op: "put", entry: { id: after.id, kind: after.kind, fieldKey: null, page: after.page, box: after.box, value: after.value } })
        : before
          ? await post({ op: "remove", id: before.id })
          : null;
      if (!r) return false;
      setFree((list) => (after ? [...list.filter((e) => e.id !== after.id), after] : list.filter((e) => e.id !== before?.id)));
      if (record) {
        setUndo((u) => [...u, { t: "entry", before, after }]);
        setRedo([]);
      }
      setStatus({ tone: "ok", text: `${L.form} ${L.saved}` });
      refresh();
      return true;
    },
    [post, refresh],
  );

  // ---------- 取消・再実行 ----------

  const replay = useCallback(
    async (op: Op, back: boolean): Promise<boolean> => {
      if (op.t === "value") {
        const slot = bySlot.get(op.key);
        return slot ? saveValue(slot, back ? op.before : op.after, false) : false;
      }
      return back ? saveEntry(op.after, op.before, false) : saveEntry(op.before, op.after, false);
    },
    [bySlot, saveEntry, saveValue],
  );
  const doUndo = useCallback(async () => {
    const op = undo[undo.length - 1];
    if (!op || busy) return;
    if (await replay(op, true)) {
      setUndo((u) => u.slice(0, -1));
      setRedo((r) => [...r, op]);
    }
  }, [busy, replay, undo]);
  const doRedo = useCallback(async () => {
    const op = redo[redo.length - 1];
    if (!op || busy) return;
    if (await replay(op, false)) {
      setRedo((r) => r.slice(0, -1));
      setUndo((u) => [...u, op]);
    }
  }, [busy, redo, replay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Escape") {
        setPlacing(null);
        setSelected(null);
      }
      if (!(e.ctrlKey || e.metaKey)) {
        if ((e.key === "Delete" || e.key === "Backspace") && selected) {
          const ent = free.find((x) => x.id === selected);
          if (ent) {
            e.preventDefault();
            setSelected(null);
            void saveEntry(ent, null);
          }
        }
        return;
      }
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        void doUndo();
      } else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) {
        e.preventDefault();
        void doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doRedo, doUndo, free, saveEntry, selected]);

  // ---------- 書いている欄の紙の字を隠す（入力と重ねない） ----------

  useEffect(() => {
    const key = editing?.key ?? freeEdit?.id ?? null;
    const el = root.current;
    if (!key || !el) return;
    const hidden: HTMLElement[] = [];
    for (const n of el.querySelectorAll<HTMLElement>(".ov-img [data-field]")) {
      const ids = (n.dataset.field ?? "").split(/[:+]/);
      if (ids.includes(key) || n.dataset.free === key) {
        n.style.visibility = "hidden";
        hidden.push(n);
      }
    }
    return () => {
      for (const n of hidden) n.style.visibility = "";
    };
  }, [editing?.key, freeEdit?.id, data]);

  // ---------- 質問 ----------

  const questions = data.questions.filter((q) => !skip.includes(q.key));
  const question = questions[0] ?? null;
  const askedSlot = question ? data.slots.find((s) => s.asks?.includes(question.key)) : undefined;
  useEffect(() => {
    if (!asking || !askedSlot) return;
    root.current?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(askedSlot.key)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [asking, askedSlot]);

  // ---------- 描く ----------

  const startText = (slot: PaperSlot) => {
    if (busy) return;
    const text = textOf(slot.value);
    const parts = slot.input.kind === "text" && slot.input.parts ? partsOf(text, slot.input.parts.map((p) => p.sep)) : [text];
    setSelected(null);
    setEditing({ key: slot.key, parts });
  };
  const commitText = async (slot: PaperSlot, parts: string[]) => {
    setEditing(null);
    if (slot.input.kind !== "text") return;
    const next = slot.input.parts ? joinParts(parts, slot.input.parts.map((p) => p.sep)) : parts[0];
    await saveValue(slot, slot.input.multiline ? next.replace(/\r\n/g, "\n") : next.replace(/\s*\n\s*/g, " "));
  };
  const pressSlot = (slot: PaperSlot) => {
    if (busy) return;
    if (slot.input.kind === "window") setWindowSlot(slot);
    else if (slot.input.kind === "check") void saveValue(slot, slot.value !== true);
    else if (slot.input.kind === "text") startText(slot);
  };

  const pagesWithLayer = Object.keys(layers).map(Number);

  return (
    <div ref={root} data-paper-fill data-marks={marks ? "1" : undefined} data-placing={placing ? placing.kind : undefined}>
      <div className="screen-only sticky top-0 z-20 mx-auto mb-2 flex max-w-[calc(210mm+2rem)] flex-wrap items-center gap-2 bg-base px-4 py-1.5" data-fill-bar>
        <Button size="sm" icon={TextBoxIcon} aria-pressed={placing?.kind === "text"} onClick={() => setPlacing((p) => (p?.kind === "text" ? null : { kind: "text" }))} disabled={busy}>
          {L.textBox}
        </Button>
        <Button size="sm" icon={ImageIcon} aria-pressed={placing?.kind === "image" || picker} onClick={() => setPicker(true)} disabled={busy}>
          {L.image}
        </Button>
        <Button size="sm" icon={UndoIcon} onClick={() => void doUndo()} disabled={busy || undo.length === 0} data-fill-undo>
          {L.undo}
        </Button>
        <Button size="sm" icon={RedoIcon} onClick={() => void doRedo()} disabled={busy || redo.length === 0} data-fill-redo>
          {L.redo}
        </Button>
        <Button size="sm" icon={MarkIcon} aria-pressed={marks} onClick={() => setMarks((m) => !m)}>
          {L.marks}
        </Button>
        <Button size="sm" icon={AskIcon} aria-pressed={asking} onClick={() => setAsking((a) => !a)} data-fill-ask>
          {L.ask} <span className="tabular-nums">{questions.length}</span>
        </Button>
        {placing && <span className="text-xs text-muted">{L.place}</span>}
        {status && (
          <span className={`ml-auto text-xs font-bold ${status.tone === "danger" ? "text-danger" : "text-muted"}`} role="status" data-fill-status={status.tone}>
            {status.text}
          </span>
        )}
      </div>

      {children}

      {pagesWithLayer.map((page) =>
        createPortal(
          <PageLayer
            key={page}
            page={page}
            mm={pageMm(page)}
            slots={data.slots.filter((s) => s.page === page)}
            free={free.filter((e) => e.page === page)}
            assets={assets}
            maxPt={data.maxPt}
            editing={editing}
            setEditing={setEditing}
            onPress={pressSlot}
            onCommitText={commitText}
            onPick={(slot, value) => {
              if (slot.input.kind !== "choice") return;
              void saveValue(slot, toggleOption(slot.value, value, slot.input.multi));
            }}
            askedKey={asking ? (askedSlot?.key ?? null) : null}
            selected={selected}
            setSelected={setSelected}
            freeEdit={freeEdit}
            setFreeEdit={setFreeEdit}
            setFree={setFree}
            onSaveEntry={saveEntry}
            placing={placing}
            onPlace={(box) => {
              const p = placing;
              setPlacing(null);
              if (!p) return;
              if (p.kind === "text") {
                const ent: FormEntry = { id: newId(), kind: "text", fieldKey: null, page, box, value: "", by: null, at: new Date().toISOString() };
                setFree((list) => [...list, ent]);
                setFreeEdit({ id: ent.id, text: "", fresh: true });
                setSelected(ent.id);
              } else {
                const ent: FormEntry = { id: newId(), kind: "image", fieldKey: null, page, box, value: p.asset.id, by: null, at: new Date().toISOString() };
                setAssets((a) => ({ ...a, [p.asset.id]: { name: p.asset.name, src: p.asset.src } }));
                void saveEntry(null, ent);
                setSelected(ent.id);
              }
            }}
            placingAsset={placing?.kind === "image" ? placing.asset : null}
            busy={busy}
          />,
          layers[page],
          `layer-${page}`,
        ),
      )}

      {windowSlot?.target && (
        <EditWindow
          key={windowSlot.key}
          data={{ personId: data.personId, version: version.current }}
          target={windowSlot.target}
          onClose={() => setWindowSlot(null)}
          submit={async (changes) => {
            const r = await post({ op: "ledger", fieldKeys: [windowSlot.key], version: version.current, edit: true, changes });
            if (!r) return L.failed;
            setStatus({ tone: "ok", text: `${L.ledger} ${L.saved}` });
            refresh();
            return null;
          }}
        />
      )}

      {picker && (
        <AssetPicker
          onClose={() => setPicker(false)}
          onChoose={(asset) => {
            setPicker(false);
            setPlacing({ kind: "image", asset });
          }}
        />
      )}

      {asking && (
        <aside className="screen-only fixed right-4 bottom-4 z-30 w-[22rem] max-w-[calc(100vw-2rem)] space-y-2 rounded-lg bg-panel p-3 shadow-lg" aria-label={L.ask} data-fill-questions>
          <div className="flex items-center gap-2">
            <AskIcon aria-hidden className="size-4 shrink-0 text-muted" />
            <span className="text-sm font-bold">{L.ask}</span>
            {askedSlot && <span className="truncate text-xs text-muted">{askedSlot.label}</span>}
            <Button size="sm" kind="quiet" icon={CloseIcon} className="ml-auto" onClick={() => setAsking(false)}>
              {L.done}
            </Button>
          </div>
          {question ? (
            <div className="rounded bg-panel2 p-2">
            <IntakeQuestion
              question={question}
              left={questions.length}
              busy={busy}
              aiReady={false}
              onAnswer={async (changes) => {
                // 答えた欄（この問いが埋める欄）に印。「不明」「無回答」は値が入らないので印を付けない
                const keys = changes.some((c) => c.t !== "pending") ? data.slots.filter((s) => s.asks?.includes(question.key)).map((s) => s.key) : [];
                await saveLedger(changes, keys, false);
              }}
              onSkip={async (q: Question) => {
                // 次回: この回は飛ばし、未聴取として残す（今の決まりのまま）
                setSkip((s) => [...s, q.key]);
                await saveLedger([{ t: "pending", field: q.key, status: "not_asked" }], [], false);
              }}
              onFree={() => undefined}
            />
            </div>
          ) : (
            <p className="text-xs text-muted" data-fill-no-ask>
              {L.noAsk}
            </p>
          )}
        </aside>
      )}
    </div>
  );
}

// ---------- 頁の層 ----------

type LayerProps = {
  page: number;
  mm: { w: number; h: number };
  slots: PaperSlot[];
  free: FormEntry[];
  assets: Record<string, { name: string; src: string }>;
  maxPt: number;
  editing: { key: string; parts: string[] } | null;
  setEditing: (e: { key: string; parts: string[] } | null) => void;
  onPress: (s: PaperSlot) => void;
  onCommitText: (s: PaperSlot, parts: string[]) => Promise<void>;
  onPick: (s: PaperSlot, value: string) => void;
  askedKey: string | null;
  selected: string | null;
  setSelected: (id: string | null) => void;
  freeEdit: { id: string; text: string; fresh: boolean } | null;
  setFreeEdit: (e: { id: string; text: string; fresh: boolean } | null) => void;
  setFree: (f: (list: FormEntry[]) => FormEntry[]) => void;
  onSaveEntry: (before: FormEntry | null, after: FormEntry | null) => Promise<boolean>;
  placing: null | { kind: "text" } | { kind: "image"; asset: AssetInfo };
  onPlace: (box: FieldBox) => void;
  placingAsset: AssetInfo | null;
  busy: boolean;
};

function PageLayer(p: LayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={layerRef} className="pf-layer" data-page-layer={p.page}>
      {/* 1 つの欄が何か所かの矩形に分かれる様式（計画書の地域の支援者の行など）があるので、描く鍵は並びの番号も */}
      {p.slots.map((s, i) => (
        <SlotView key={`${s.key}-${i}`} slot={s} {...p} />
      ))}
      {p.free.map((e) => (
        <FreeView key={e.id} entry={e} layer={layerRef} {...p} />
      ))}
      {p.placing && (
        <div
          className="pf-place"
          data-place={p.placing.kind}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            const y = (e.clientY - r.top) / r.height;
            // 文字の枠は 50 × 10mm、画像は幅 60mm（縦横の比は画像のまま）
            const w = (p.placingAsset ? 60 : 50) / p.mm.w;
            const hMm = p.placingAsset ? (60 * p.placingAsset.height) / p.placingAsset.width : 10;
            const h = Math.min(hMm / p.mm.h, 0.9);
            p.onPlace({ x: clamp01(Math.min(x, 1 - w)), y: clamp01(Math.min(y, 1 - h)), w: Math.min(w, 1), h });
          }}
        />
      )}
    </div>
  );
}

function SlotView({ slot, ...p }: LayerProps & { slot: PaperSlot }) {
  const editing = p.editing?.key === slot.key ? p.editing : null;
  const area = slot.area ?? slot.box;
  const tag = slot.hand ? (
    <span className="pf-tag" title={handTitle(slot)} data-hand={slot.dest}>
      {slot.dest === "ledger" ? L.ledger : L.form}
    </span>
  ) : null;
  const common = {
    "data-slot": slot.key,
    "data-dest": slot.dest,
    "data-empty": slot.empty ? "1" : undefined,
    "data-asked": p.askedKey === slot.key ? "1" : undefined,
    "data-hand": slot.hand ? slot.dest : undefined,
  };

  if (slot.input.kind === "choice") {
    const on = Array.isArray(slot.value) ? slot.value : [];
    return (
      <>
        <div className="pf-area pf-choice" style={at(area)} {...common} title={`${slot.label} ${slot.dest === "ledger" ? L.ledger : L.form}`}>
          {tag}
        </div>
        {slot.input.options.map(
          (o) =>
            o.box && (
              <button
                key={o.value}
                type="button"
                className="pf-option"
                style={at(o.box)}
                aria-label={`${slot.label} ${o.label}`}
                aria-pressed={on.includes(o.value)}
                data-option={o.value}
                data-slot-option={slot.key}
                disabled={p.busy}
                onClick={() => p.onPick(slot, o.value)}
              />
            ),
        )}
      </>
    );
  }

  if (editing && slot.input.kind === "text") {
    const input = slot.input;
    const parts = input.parts;
    const commit = (vals: string[]) => void p.onCommitText(slot, vals);
    const cancel = () => p.setEditing(null);
    if (parts) {
      return (
        <div
          className="pf-parts"
          {...common}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit(editing.parts);
          }}
        >
          {parts.map((part, i) => {
            const mm = boxMm(part.box, p.mm);
            const font = liveFont(editing.parts[i] ?? "", mm, slot.maxPt);
            return (
              <input
                key={i}
                className="pf-input"
                style={{ ...at(part.box), fontSize: `${font.fontPt}pt` }}
                value={editing.parts[i] ?? ""}
                aria-label={`${slot.label} ${part.sep}`}
                inputMode={input.tel ? "tel" : /[年月日歳]$/.test(part.sep) ? "numeric" : undefined}
                autoFocus={i === 0}
                data-part={i}
                onChange={(e) => p.setEditing({ key: slot.key, parts: editing.parts.map((x, j) => (j === i ? e.target.value : x)) })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(editing.parts);
                  } else if (e.key === "Escape") cancel();
                }}
              />
            );
          })}
        </div>
      );
    }
    const font = liveFont(editing.parts[0] ?? "", slot.mm, slot.maxPt);
    return (
      <>
        <textarea
          className="pf-input"
          style={{ ...at(slot.box), fontSize: `${font.fontPt}pt` }}
          value={editing.parts[0] ?? ""}
          aria-label={slot.label}
          maxLength={input.max}
          inputMode={input.tel ? "tel" : undefined}
          autoFocus
          onFocus={caretToEnd}
          {...common}
          data-font={font.fontPt}
          onChange={(e) => p.setEditing({ key: slot.key, parts: [e.target.value] })}
          onBlur={() => commit(editing.parts)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
            else if (e.key === "Enter" && (!input.multiline || e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commit(editing.parts);
            }
          }}
        />
        <span className="pf-dest" style={{ left: pct(slot.box.x), top: pct(slot.box.y + slot.box.h) }} data-dest-label={slot.dest}>
          {slot.dest === "ledger" ? L.ledger : L.form}
          {font.overflow && <span className="pf-over"> {L.annex}</span>}
          {input.unit ? ` ${input.unit}` : ""}
        </span>
      </>
    );
  }

  return (
    <div
      className="pf-area"
      style={at(slot.input.kind === "text" ? slot.box : area)}
      role="button"
      tabIndex={0}
      aria-label={`${slot.label} ${slot.dest === "ledger" ? L.ledger : L.form}`}
      title={`${slot.label} ${slot.dest === "ledger" ? L.ledger : L.form}`}
      {...common}
      data-window={slot.input.kind === "window" ? "1" : undefined}
      aria-pressed={slot.input.kind === "check" ? slot.value === true : undefined}
      onClick={() => p.onPress(slot)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          p.onPress(slot);
        }
      }}
    >
      {tag}
    </div>
  );
}

/** 置いた文字の枠と画像。押すと選び、文字の枠は字を書く。上の縁を引いて動かし、右下の角で大きさを変える */
function FreeView({ entry, layer, ...p }: LayerProps & { entry: FormEntry; layer: React.RefObject<HTMLDivElement | null> }) {
  const sel = p.selected === entry.id;
  const writing = p.freeEdit?.id === entry.id ? p.freeEdit : null;
  const box = entry.box!;
  const drag = useRef<{ mode: "move" | "size"; x: number; y: number; start: FieldBox; w: number; h: number; moved: boolean } | null>(null);
  /** 引いて離した直後の押した扱いを受けない */
  const dragged = useRef(false);
  const mm = boxMm(box, p.mm);

  const down = (mode: "move" | "size") => (e: ReactPointerEvent<HTMLElement>) => {
    if (p.busy || writing) return;
    const r = layer.current?.getBoundingClientRect();
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, start: { ...box }, w: r.width, h: r.height, moved: false };
    p.setSelected(entry.id);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.w;
    const dy = (e.clientY - d.y) / d.h;
    if (Math.abs(dx) + Math.abs(dy) > 0.002) d.moved = true;
    let next: FieldBox;
    if (d.mode === "move") {
      next = { ...d.start, x: clamp01(Math.min(d.start.x + dx, 1 - d.start.w)), y: clamp01(Math.min(d.start.y + dy, 1 - d.start.h)) };
    } else {
      const w = Math.min(Math.max(d.start.w + dx, 8 / p.mm.w), 1 - d.start.x);
      // 画像は縦横の比のまま
      const h = entry.kind === "image" ? Math.min((d.start.h * w) / d.start.w, 1 - d.start.y) : Math.min(Math.max(d.start.h + dy, 4 / p.mm.h), 1 - d.start.y);
      next = { ...d.start, w, h };
    }
    p.setFree((list) => list.map((x) => (x.id === entry.id ? { ...x, box: next } : x)));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.moved) return;
    dragged.current = true;
    void p.onSaveEntry({ ...entry, box: d.start }, entry);
  };

  const commitText = () => {
    if (!writing) return;
    p.setFreeEdit(null);
    const text = writing.text.replace(/\r\n/g, "\n");
    if (text.trim() === "") {
      // 書かずに離れた新しい枠は置かない。前からの枠を空にしたら消す
      if (writing.fresh) p.setFree((list) => list.filter((x) => x.id !== entry.id));
      else void p.onSaveEntry(entry, null);
      return;
    }
    if (!writing.fresh && text === entry.value) return;
    void p.onSaveEntry(writing.fresh ? null : entry, { ...entry, value: text });
  };

  const placed = entry.kind === "text" ? freeText(writing ? writing.text || " " : entry.value, mm.w, mm.h, p.maxPt) : null;
  const font = writing ? liveFont(writing.text, mm, p.maxPt) : null;
  const asset = entry.kind === "image" ? p.assets[entry.value] : undefined;

  return (
    <div
      className="pf-free"
      style={at(box)}
      data-free-box={entry.id}
      data-kind={entry.kind}
      data-selected={sel ? "1" : undefined}
      onPointerDown={entry.kind === "image" ? down("move") : undefined}
      onPointerMove={move}
      onPointerUp={up}
      onClick={(e) => {
        e.stopPropagation();
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        // 1 回目は選ぶだけ（上の縁を引いて動かす・右下で大きさ・削除）。選んだ枠をもう一度押すと字を書く
        if (!sel) {
          p.setSelected(entry.id);
          return;
        }
        if (entry.kind === "text" && !writing && !p.busy) p.setFreeEdit({ id: entry.id, text: entry.value, fresh: false });
      }}
    >
      {entry.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- 事業所の画像（R2 の物を API から）
        <img className="pf-img" src={asset?.src} alt={asset?.name ?? ""} draggable={false} />
      ) : writing ? (
        <textarea
          className="pf-input pf-free-input"
          style={{ fontSize: `${font?.fontPt ?? p.maxPt}pt` }}
          value={writing.text}
          aria-label={L.textBox}
          maxLength={400}
          autoFocus
          onFocus={caretToEnd}
          onChange={(e) => p.setFreeEdit({ ...writing, text: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              p.setFreeEdit(null);
              if (writing.fresh) p.setFree((list) => list.filter((x) => x.id !== entry.id));
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              commitText();
            }
          }}
        />
      ) : (
        <div className="pf-free-text" style={{ fontSize: `${placed?.fontPt ?? p.maxPt}pt` }}>
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
      {sel && (
        <>
          <span className="pf-grip" onPointerDown={down("move")} onPointerMove={move} onPointerUp={up} aria-label={L.move} role="button" tabIndex={-1} />
          <span className="pf-size" onPointerDown={down("size")} onPointerMove={move} onPointerUp={up} aria-hidden />
          <button
            type="button"
            className="pf-remove"
            aria-label={`${entry.kind === "image" ? L.image : L.textBox} ${L.remove}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              p.setSelected(null);
              p.setFreeEdit(null);
              if (writing?.fresh) p.setFree((list) => list.filter((x) => x.id !== entry.id));
              else void p.onSaveEntry(entry, null);
            }}
          >
            <RemoveIcon aria-hidden className="size-3.5" />
            {L.remove}
          </button>
        </>
      )}
    </div>
  );
}

// ---------- 画像の選択と取り込み ----------

function AssetPicker({ onClose, onChoose }: { onClose: () => void; onChoose: (a: AssetInfo) => void }) {
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
          className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 rounded bg-panel2 p-2"
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
