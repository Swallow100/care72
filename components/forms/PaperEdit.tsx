"use client";

// 紙に直接書く（T117）。計画書の紙（前からの紙面・原本の枠の紙）を包み、押せる欄に画面だけの印（点線の灰の枠、paper-edit.css）を付ける。
// 欄を押すと、その欄の元（lib/forms/form-inputs.ts）の入力の窓が開き、保存で台帳のその場所に入る（/api/intake/save の edit。
// 本人のページの面の編集と同じ保存で、経過は「ケアマネが直した」）。入れ子の値（薬・連絡先の人・同意など）は本人のページへの道だけ。
// 紙の部品は状態を持たないまま（押す所は data-field・data-edit-key の印で受ける）。印刷では印も窓も出ない。

import "./paper-edit.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { FieldInput } from "@/components/person/IntakeChanges";
import { postJson, isError } from "@/components/person/intake-api";
import { INPUT } from "@/components/person/intake-ui";
import { Button, buttonClass } from "@/components/ui/Button";
import { CloseIcon, EditIcon, SaveIcon } from "@/components/ui/Icon";
import { intakeField } from "@/lib/intake/fields";
import { INTAKE_LABELS } from "@/lib/labels";
import { draftKey, paperChanges, type PaperEditData, type PaperTarget } from "@/lib/forms/paper-edit";

/** 窓の言葉（2〜4 字） */
export const PAPER_EDIT_LABELS = { write: "記入", page: "本人のページ", nothing: "変更なし" } as const;

export function PaperEdit({ data, children }: { data: PaperEditData; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<PaperTarget | null>(null);
  const byKey = useMemo(() => new Map(data.targets.map((t) => [t.key as string, t])), [data]);

  // 押せる欄に印を付ける。原本の枠の紙は欄の矩形の箱（data-edit-key）、前からの紙面は欄（data-field）
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const boxes = [...el.querySelectorAll<HTMLElement>("[data-edit-key]")];
    const nodes = boxes.length > 0 ? boxes : [...el.querySelectorAll<HTMLElement>("[data-field]")];
    for (const n of nodes) {
      const t = targetOf(n, byKey);
      if (!t) continue;
      n.setAttribute("data-editable", t.key);
      n.setAttribute("role", "button");
      n.setAttribute("aria-label", `${t.label} ${PAPER_EDIT_LABELS.write}`);
      n.tabIndex = 0;
    }
  }, [byKey]);

  const pick = (e: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
    const n = (e.target as HTMLElement).closest<HTMLElement>("[data-editable]");
    if (!n || !root.current?.contains(n)) return;
    const t = byKey.get(n.getAttribute("data-editable") ?? "");
    if (!t) return;
    e.preventDefault();
    setOpen(t);
  };

  return (
    <div
      ref={root}
      data-paper-edit
      onClick={pick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") pick(e);
      }}
    >
      {children}
      {open && <EditWindow key={open.key} data={data} target={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 印の付いた所の欄（data-edit-key は空白区切りの欄の鍵、data-field は 1 つ） */
function targetOf(n: HTMLElement, byKey: ReadonlyMap<string, PaperTarget>): PaperTarget | null {
  const keys = (n.getAttribute("data-edit-key") ?? n.getAttribute("data-field") ?? "").split(/\s+/).filter(Boolean);
  for (const k of keys) {
    const t = byKey.get(k);
    if (t) return t;
  }
  return null;
}

/** 欄の入力の窓。保存で台帳に入り、紙を読み直す */
function EditWindow({ data, target, onClose }: { data: PaperEditData; target: PaperTarget; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(target.inputs.flatMap((i) => (i.kind === "page" ? [] : [[draftKey(i), i.value]]))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    el?.querySelector<HTMLElement>("input, select, textarea")?.focus();
  }, []);

  async function save() {
    const { changes, bad } = paperChanges(target, draft);
    if (bad.length > 0) {
      setError(`${INTAKE_LABELS.invalid} ${bad.join("・")}`);
      return;
    }
    if (changes.length === 0) {
      setError(PAPER_EDIT_LABELS.nothing);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await postJson<{ ok: true; changed: number }>("/api/intake/save", {
      personId: data.personId,
      version: data.version,
      ai: null,
      edit: true,
      changes,
    });
    setBusy(false);
    if (isError(r)) {
      setError(r.label);
      if (r.error === "conflict") router.refresh();
      return;
    }
    onClose();
    router.refresh();
  }

  const writable = target.inputs.some((i) => i.kind !== "page");
  return (
    <dialog
      ref={ref}
      aria-labelledby="paper-edit-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg bg-panel p-0 text-ink backdrop:bg-black/40"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-paper-edit-window={target.key}
    >
      <form
        className="space-y-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void save();
        }}
      >
        <h2 id="paper-edit-title" className="flex items-center gap-1.5 text-[1rem] leading-snug font-bold">
          <EditIcon aria-hidden className="size-4 shrink-0 text-muted" />
          {target.label}
        </h2>
        <div className="space-y-1.5">
          {target.inputs.map((i) => {
            if (i.kind === "page") {
              return (
                <div key={`page-${i.label}`} className="flex items-center gap-2 text-sm" data-paper-page>
                  <span className="text-muted">{i.label}</span>
                  <Link href={i.href} className={`${buttonClass("plain", "sm")} ml-auto`} data-press="">
                    {PAPER_EDIT_LABELS.page}
                  </Link>
                </div>
              );
            }
            const k = draftKey(i);
            if (i.kind === "field") {
              const f = intakeField(i.key);
              if (!f) return null;
              return (
                <label key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2" data-paper-input={k}>
                  <span className="text-xs text-muted">{i.label}</span>
                  <FieldInput field={f} value={draft[k]} onPanel onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />
                </label>
              );
            }
            const tel = i.part === "phone" || i.part === "mobile";
            return (
              <label key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-2" data-paper-input={k}>
                <span className="text-xs text-muted">{i.label}</span>
                <input
                  className={tel ? `${INPUT} tabular-nums` : INPUT}
                  inputMode={tel ? "tel" : undefined}
                  maxLength={i.part === "address" ? 60 : i.part === "kana" ? 40 : 20}
                  value={typeof draft[k] === "string" ? (draft[k] as string) : ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  aria-label={i.label}
                />
              </label>
            );
          })}
        </div>
        {error && <p className="text-xs font-bold text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button kind="quiet" icon={CloseIcon} onClick={onClose}>
            {INTAKE_LABELS.discard}
          </Button>
          {writable && (
            <Button kind="main" type="submit" icon={SaveIcon} disabled={busy}>
              {busy ? INTAKE_LABELS.busy : INTAKE_LABELS.save}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  );
}
