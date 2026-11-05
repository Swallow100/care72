"use client";

// 紙の上でその場で入れる（T135）。元の様式の上に値を置いた紙（OverlaySheet）を包み、頁ごとの層（.ov-layer）に重ねて描く:
// - 欄: 押すと欄の上で入れる。字の置き場と大きさは紙に刷るときと同じ関数（lib/forms/paper-fill.ts の livePlace → T133 の placeText。
//   印刷の字を避けて欄の枠の中の空いた所、下限 6pt）で、欄の枠の中だけ。空いた欄の 2 つの区別（T133）: 台帳に無い欄は質問で、置けなかった欄はその場で
//   □ は押して印、部品つきの欄（年・月・日、− −）は部品ごと。元が台帳の何か所かにまたがる欄は入力の窓（T117 の EditWindow）
// - 行き先: 台帳の項目に当たる欄は台帳（欄の脇に「台帳」）、様式だけの欄はその人のその様式の手入れ（「様式」）。どちらも誰がいつを残す
// - 文字の枠と画像: 紙の上の好きな所に置き、動かす・大きさを変える。刷る PDF にも同じ位置（サーバーが紙に描く）
// - 印（手で入れた所・置いた枠と画像）は画面だけ。取消・再実行
// - 質問: この紙の空いた欄のうち台帳に項目のある欄の問い（定型）を順に聞く。答えは台帳に入り紙が埋まる
// - 見直しの一覧（T136、components/forms/PaperReview.tsx）の行から送られた欄（窓の出来事 care72:paper-field）をその場の入力か窓で開く
// 保存は /api/forms/entries（台帳は lib/intake/save.ts の saveIntake を通る）。Claude は通らない。紙の部品は状態を持たないまま（サーバーの描画）。
// 印刷では層も帯も出ない（paper-fill.css）。
// T147: 台帳の 1 か所に書けない字の欄（pageLink）も窓でなくその場で打ち、様式のみの値に。書いている間は欄の下に行き先（台帳保存・様式のみ）。
// 帯に「保存」と保存の状態（保存済・保存中・未保存・保存失敗）。確定のたびに残すのは今のまま、「保存」は書きかけを確定し、残らなかった物を送り直す。
// 未保存のまま頁を離れる時は確かめる。質問の面は聞く問いがあれば開いて出す。文字の枠と画像は components/forms/PaperFillFree.tsx

import "./paper-fill.css";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { postJson, isError, postForm } from "@/components/person/intake-api";
import { IntakeQuestion } from "@/components/person/IntakeQuestion";
import { Button } from "@/components/ui/Button";
import { AskIcon, CloseIcon, ImageIcon, MarkIcon, RedoIcon, SaveIcon, TextBoxIcon, UndoIcon } from "@/components/ui/Icon";
import { EditWindow } from "./PaperEdit";
import { AssetPicker, FreeView } from "./PaperFillFree";
import { useLeaveGuard, type LeaveState } from "./leave-guard";
import type { IntakeChange } from "@/lib/intake/changes";
import type { Question } from "@/lib/intake/ask";
import type { FormEntry } from "@/lib/forms/form-entries";
import type { FieldBox } from "@/lib/forms/mapping";
import {
  FILL_LABELS as L,
  joinParts,
  livePlace,
  partsOf,
  slotChanges,
  slotForField,
  toggleOption,
  type AssetInfo,
  type PaperFillData,
  type PaperSlot,
  type SlotValue,
} from "@/lib/forms/paper-fill";
import { PAPER_FIELD_EVENT, type PaperFieldDetail } from "@/lib/forms/review";

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

/** 保存の状態（帯の右に出す） */
export type SaveState = "saved" | "saving" | "unsaved" | "failed";
export const SAVE_STATE_LABELS: Record<SaveState, string> = { saved: L.saved, saving: L.saving, unsaved: L.unsaved, failed: L.failed };

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
  // 聞く問いがあれば質問の面を開いて出す（閉じられる。T147）。開いた直後は紙を送らない（人が押してから送る）
  const [asking, setAsking] = useState(() => data.questions.length > 0);
  const askScroll = useRef(false);
  const [skip, setSkip] = useState<string[]>([]);
  const [assets, setAssets] = useState<Record<string, { name: string; src: string }>>(data.assets);
  const busy = saving || refreshing;
  // 保存の状態（T147）: 送っている数・残らなかった物（「保存」で送り直す）
  const pending = useRef(0);
  const retry = useRef<(() => Promise<boolean>) | null>(null);
  const [failed, setFailed] = useState(false);
  const saveState: SaveState = saving ? "saving" : failed ? "failed" : editing || freeEdit ? "unsaved" : "saved";
  /** 送った結果を保存の状態に（残らなければ again を「保存」で送り直す） */
  const settle = useCallback((ok: boolean, again: () => Promise<boolean>) => {
    if (ok) {
      retry.current = null;
      setFailed(false);
    } else {
      retry.current = again;
      setFailed(true);
    }
    return ok;
  }, []);

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
      pending.current += 1;
      setSaving(true);
      const r = await postJson<Saved>("/api/forms/entries", { personId: data.personId, formId: data.formId, ...body });
      pending.current -= 1;
      if (pending.current === 0) setSaving(false);
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

  const saveValueRef = useRef<(slot: PaperSlot, next: SlotValue, record?: boolean) => Promise<boolean>>(async () => false);
  const saveEntryRef = useRef<(before: FormEntry | null, after: FormEntry | null, record?: boolean) => Promise<boolean>>(async () => false);

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
      settle(ok, () => saveValueRef.current(slot, next, record));
      if (ok && record) {
        setUndo((u) => [...u, { t: "value", key: slot.key, before: slot.value, after: next }]);
        setRedo([]);
      }
      return ok;
    },
    [post, refresh, saveLedger, settle],
  );
  saveValueRef.current = saveValue;

  /** 文字の枠・画像を入れる（after が null は取り消す） */
  const saveEntry = useCallback(
    async (before: FormEntry | null, after: FormEntry | null, record = true): Promise<boolean> => {
      if (!before && !after) return true;
      const r = after
        ? await post({
            op: "put",
            entry: { id: after.id, kind: after.kind, fieldKey: null, page: after.page, box: after.box, value: after.value, ...(after.kind === "text" ? { pt: after.pt ?? null } : {}) },
          })
        : before
          ? await post({ op: "remove", id: before.id })
          : null;
      if (!settle(r !== null, () => saveEntryRef.current(before, after, record))) return false;
      setFree((list) => (after ? [...list.filter((e) => e.id !== after.id), after] : list.filter((e) => e.id !== before?.id)));
      if (record) {
        setUndo((u) => [...u, { t: "entry", before, after }]);
        setRedo([]);
      }
      setStatus({ tone: "ok", text: `${L.form} ${L.saved}` });
      refresh();
      return true;
    },
    [post, refresh, settle],
  );
  saveEntryRef.current = saveEntry;

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

  // ---------- 保存のボタンと、未保存のまま離れるとき（T147） ----------

  /** 書きかけの欄・文字の枠を確定し（焦点を外すと確定する）、残らなかった物を送り直す */
  const saveNow = useCallback(async () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && root.current?.contains(el)) el.blur();
    // 確定の保存が走り終わるのを待つ
    await new Promise((r) => setTimeout(r, 0));
    const again = retry.current;
    if (again) await again();
  }, []);

  // 未保存のまま頁を離れるときの確かめ（components/forms/leave-guard.ts）
  const leaveRef = useRef<LeaveState>({ unsaved: false, pending: 0 });
  leaveRef.current = { unsaved: failed || editing !== null || freeEdit !== null, pending: pending.current };
  useLeaveGuard(leaveRef, root);

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

  // 台帳に無い欄（T133 の ask）を押す・見直しの一覧から送られたときは、その欄の問いを先に
  const [askFirst, setAskFirst] = useState<string | null>(null);
  const left = data.questions.filter((q) => !skip.includes(q.key));
  const questions = askFirst && left.some((q) => q.key === askFirst) ? [...left.filter((q) => q.key === askFirst), ...left.filter((q) => q.key !== askFirst)] : left;
  const question = questions[0] ?? null;
  const askedSlot = question ? data.slots.find((s) => s.asks?.includes(question.key)) : undefined;
  useEffect(() => {
    if (!asking || !askedSlot || !askScroll.current) return;
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
  /**
   * 空いた欄の 2 つの区別（T133 の黄の塗り）: 台帳に無い（ask）欄で問いがあれば、質問の面でその問いを先に出す（質問でも埋められる）。
   * T147: 押した欄はその場で打てる（質問は並べて出すだけで、打つのを止めない）。台帳の 1 か所に書けない欄（pageLink）も同じ
   */
  const askFor = (slot: PaperSlot): boolean => {
    if (slot.gap !== "ask" || (slot.dest !== "ledger" && !slot.pageLink)) return false;
    const q = left.find((x) => slot.asks?.includes(x.key));
    if (!q) return false;
    setAskFirst(q.key);
    setAsking(true);
    return true;
  };
  const pressSlot = (slot: PaperSlot) => {
    if (busy) return;
    askFor(slot);
    if (slot.input.kind === "window") setWindowSlot(slot);
    else if (slot.input.kind === "check") void saveValue(slot, slot.value !== true);
    else if (slot.input.kind === "text") startText(slot);
  };

  // ---------- 見直しの一覧（T136）から送られた欄 ----------
  // 一覧の行を押すと窓の出来事 care72:paper-field（欄の id・紙の上の物）が来る。その欄に枠を出して送り、字の欄はその場の入力、
  // 何か所かにまたがる欄は窓を開く（□・選ぶ欄は枠だけで、□ を押して直す）。紙の上に無い欄（別紙だけの欄）は何もしない
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const fromReview = useRef<(d: PaperFieldDetail) => void>(() => undefined);
  useEffect(() => {
    fromReview.current = (d) => {
      const slot = slotForField(data.slots, d);
      if (!slot) return;
      setReviewKey(slot.key);
      root.current?.querySelector<HTMLElement>(`[data-slot="${CSS.escape(slot.key)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (busy || placing) return;
      askFor(slot);
      if (slot.input.kind === "text") startText(slot);
      else if (slot.input.kind === "window") setWindowSlot(slot);
    };
  });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<PaperFieldDetail>).detail;
      if (d && typeof d.field === "string" && Array.isArray(d.items)) fromReview.current(d);
    };
    window.addEventListener(PAPER_FIELD_EVENT, on);
    return () => window.removeEventListener(PAPER_FIELD_EVENT, on);
  }, []);

  const pagesWithLayer = Object.keys(layers).map(Number);

  return (
    <div ref={root} data-paper-fill data-marks={marks ? "1" : undefined} data-placing={placing ? placing.kind : undefined}>
      <div className="screen-only sticky top-0 z-20 mx-auto mb-2 flex max-w-[calc(210mm+2rem)] flex-wrap items-center gap-2 bg-base px-4 py-1.5" data-fill-bar>
        <Button size="sm" icon={TextBoxIcon} aria-pressed={placing?.kind === "text"} onClick={() => setPlacing((p) => (p?.kind === "text" ? null : { kind: "text" }))} disabled={busy} data-fill-add-text>
          {L.addText}
        </Button>
        <Button size="sm" icon={ImageIcon} aria-pressed={placing?.kind === "image" || picker} onClick={() => setPicker(true)} disabled={busy} data-fill-add-image>
          {L.addImage}
        </Button>
        <Button size="sm" icon={UndoIcon} onClick={() => void doUndo()} disabled={busy || undo.length === 0} data-fill-undo>
          {L.undo}
        </Button>
        <Button size="sm" icon={RedoIcon} onClick={() => void doRedo()} disabled={busy || redo.length === 0} data-fill-redo>
          {L.redo}
        </Button>
        <Button size="sm" icon={MarkIcon} aria-pressed={marks} onClick={() => setMarks((m) => !m)} data-fill-marks>
          {L.marks}
        </Button>
        <Button
          size="sm"
          icon={AskIcon}
          aria-pressed={asking}
          onClick={() => {
            askScroll.current = true;
            setAsking((a) => !a);
          }}
          data-fill-ask
        >
          {L.ask} <span className="tabular-nums">{questions.length}</span>
        </Button>
        {placing && <span className="text-xs text-muted">{L.place}</span>}
        <span className="ml-auto flex items-center gap-2">
          {status && status.tone === "danger" && (
            <span className="text-xs font-bold text-danger" role="alert" data-fill-status={status.tone}>
              {status.text}
            </span>
          )}
          {/* 保存の状態（T147）。確定のたびに残し、「保存」は書きかけを確定して残らなかった物を送り直す */}
          <span
            className={`text-xs font-bold ${saveState === "failed" ? "text-danger" : saveState === "saved" ? "text-muted" : "text-ink"}`}
            role="status"
            data-save-state={saveState}
          >
            {saveState === "saved" && status?.tone === "ok" ? status.text : SAVE_STATE_LABELS[saveState]}
          </span>
          <Button size="sm" kind="main" icon={SaveIcon} onClick={() => void saveNow()} disabled={saving} data-fill-save>
            {L.save}
          </Button>
        </span>
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
            askedKey={asking ? (askedSlot?.key ?? null) : reviewKey}
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
          formId={data.formId}
          onFormSaved={() => {
            setStatus({ tone: "ok", text: `${L.form} ${L.saved}` });
            refresh();
          }}
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
        <FreeView
          key={e.id}
          entry={e}
          layer={layerRef}
          mm={p.mm}
          maxPt={p.maxPt}
          assets={p.assets}
          selected={p.selected === e.id}
          setSelected={p.setSelected}
          writing={p.freeEdit?.id === e.id ? p.freeEdit : null}
          setFreeEdit={p.setFreeEdit}
          setFree={p.setFree}
          onSaveEntry={p.onSaveEntry}
          busy={p.busy}
        />
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

/**
 * 書いている欄の下の行き先（T147）: 台帳に入る欄は「台帳保存」（ほかの様式にも効く）、この人のこの様式だけの値は「様式のみ」。
 * 台帳の 1 か所に書けない欄は、台帳を直す道（本人のページ、別のタブ）も添える
 */
function DestLabel({ slot, overflow = false, unit }: { slot: PaperSlot; overflow?: boolean; unit?: string }) {
  return (
    <span className="pf-dest" style={{ left: pct(slot.box.x), top: pct(slot.box.y + slot.box.h) }} data-dest-label={slot.dest}>
      {slot.dest === "ledger" ? L.toLedger : L.toForm}
      {overflow && <span className="pf-over"> {L.annex}</span>}
      {unit ? ` ${unit}` : ""}
      {slot.pageLink && (
        <a
          href={slot.pageLink.href}
          target="_blank"
          rel="noreferrer"
          className="pf-dest-link"
          title={slot.pageLink.label}
          onMouseDown={(e) => e.preventDefault()}
          data-dest-page
        >
          {L.page}
        </a>
      )}
    </span>
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
    // 空いた訳（T133 の黄の塗り 2 つ）: ask は台帳に無い（押すと質問）、fix は置けなかった（押すとこの様式の手入れ）
    "data-gap": slot.gap,
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
          <DestLabel slot={slot} />
          {parts.map((part, i) => {
            const font = livePlace(slot, editing.parts[i] ?? "", part.box, p.mm, slot.box);
            return (
              <input
                key={i}
                className="pf-input"
                style={{ ...at(font.box), fontSize: `${font.fontPt}pt` }}
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
    // 書いている字の置き場と大きさは、紙に刷るときと同じ関数（T133 の placeText。印刷の字を避けて欄の枠の中の空いた所）
    const font = livePlace(slot, editing.parts[0] ?? "", slot.box, p.mm);
    return (
      <>
        <textarea
          className="pf-input"
          style={{ ...at(font.box), fontSize: `${font.fontPt}pt` }}
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
        <DestLabel slot={slot} overflow={font.overflow} unit={input.unit} />
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
