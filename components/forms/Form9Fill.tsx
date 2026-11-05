"use client";

// 様式 9 の紙の上でその場で書く（T147）。画面の印刷見本（components/forms/Form9Paper.tsx の onScreen）の各枚の層（.f9-layer）に、
// 行の欄ごとの押す所を重ねる。押すと欄の上で打ち、確定（Enter・欄を離れる）でその行の人の手入れ（form_entries、form_id "form9"）に残す。
// 字の大きさは紙と同じ決まり（欄の矩形に fitText。上限 6.57pt、下限 6pt。入らなければ「別紙」の見込み）。空にすると手入れを取り消す（表の値に戻る）。
// 帯に「保存」と保存の状態、未保存のまま離れる時は確かめる（components/forms/leave-guard.ts）。印刷では層も帯も出ない。
// 保存は /api/forms/entries（壁は本人のページと同じ。行の人ごと）。Claude は呼ばない。

import "./paper-fill.css";
import { useRouter } from "next/navigation";
import { useCallback, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isError, postJson } from "@/components/person/intake-api";
import { Button } from "@/components/ui/Button";
import { MarkIcon, SaveIcon } from "@/components/ui/Icon";
import { FILL_LABELS as L, liveFont } from "@/lib/forms/paper-fill";
import { FORM9_FILL_PT, FORM9_FORM_ID, type Form9Slot } from "@/lib/forms/form9-fill";
import { useLeaveGuard, type LeaveState } from "./leave-guard";

/** 様式 9 の 1 枚の内容の箱（mm） */
const SHEET = { w: 261, h: 172 };
const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(3)}%`;
const newId = () => `fe-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
const keyOf = (s: Pick<Form9Slot, "personId" | "col">) => `${s.personId}:${s.col}`;

type SaveState = "saved" | "saving" | "unsaved" | "failed";
const STATE_LABELS: Record<SaveState, string> = { saved: L.saved, saving: L.saving, unsaved: L.unsaved, failed: L.failed };

export function Form9Fill({ slots, children }: { slots: Form9Slot[]; children: ReactNode }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<Record<number, HTMLElement>>({});
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef(0);
  const retry = useRef<(() => Promise<boolean>) | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [marks, setMarks] = useState(true);
  const state: SaveState = saving || refreshing ? "saving" : failed ? "failed" : editing ? "unsaved" : "saved";

  const leaveRef = useRef<LeaveState>({ unsaved: false, pending: 0 });
  leaveRef.current = { unsaved: failed !== null || editing !== null, pending: pending.current };
  useLeaveGuard(leaveRef, root);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const found: Record<number, HTMLElement> = {};
    for (const n of el.querySelectorAll<HTMLElement>("[data-f9-layer]")) found[Number(n.dataset.f9Layer)] = n;
    setLayers(found);
  }, [slots]);

  /** 1 つの欄を残す（空なら取り消す）。残らなければ「保存」で送り直す */
  const save = useCallback(
    async (slot: Form9Slot, text: string): Promise<boolean> => {
      const next = text.replace(/\s*\n\s*/g, " ").trim();
      if (next === slot.value.trim()) return true;
      const body =
        next === ""
          ? slot.entryId
            ? { op: "remove", personId: slot.personId, formId: FORM9_FORM_ID, id: slot.entryId }
            : null
          : {
              op: "put",
              personId: slot.personId,
              formId: FORM9_FORM_ID,
              entry: { id: slot.entryId ?? newId(), kind: "field", fieldKey: slot.col, page: null, box: null, value: JSON.stringify(next) },
            };
      if (!body) return true;
      pending.current += 1;
      setSaving(true);
      const r = await postJson<{ ok: true }>("/api/forms/entries", body);
      pending.current -= 1;
      if (pending.current === 0) setSaving(false);
      if (isError(r)) {
        retry.current = () => save(slot, text);
        setFailed(`${L.failed} ${r.label}`);
        return false;
      }
      retry.current = null;
      setFailed(null);
      startTransition(() => router.refresh());
      return true;
    },
    [router],
  );

  const commit = (slot: Form9Slot, text: string) => {
    setEditing(null);
    void save(slot, text);
  };

  const saveNow = async () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && root.current?.contains(el)) el.blur();
    await new Promise((r) => setTimeout(r, 0));
    const again = retry.current;
    if (again) await again();
  };

  const bySheet = new Map<number, Form9Slot[]>();
  for (const s of slots) bySheet.set(s.sheet, [...(bySheet.get(s.sheet) ?? []), s]);

  return (
    <div ref={root} data-paper-fill data-form9-fill data-marks={marks ? "1" : undefined}>
      <div className="screen-only sticky top-0 z-20 mx-auto mb-2 flex max-w-[297mm] flex-wrap items-center gap-2 bg-base py-1.5" data-fill-bar>
        <Button size="sm" icon={MarkIcon} aria-pressed={marks} onClick={() => setMarks((m) => !m)} data-fill-marks>
          {L.marks}
        </Button>
        <span className="ml-auto flex items-center gap-2">
          {failed && (
            <span className="text-xs font-bold text-danger" role="alert">
              {failed}
            </span>
          )}
          <span className={`text-xs font-bold ${state === "failed" ? "text-danger" : state === "saved" ? "text-muted" : "text-ink"}`} role="status" data-save-state={state}>
            {STATE_LABELS[state]}
          </span>
          <Button size="sm" kind="main" icon={SaveIcon} onClick={() => void saveNow()} disabled={saving} data-fill-save>
            {L.save}
          </Button>
        </span>
      </div>
      {children}
      {Object.entries(layers).map(([n, el]) =>
        createPortal(
          <div className="pf-layer" data-form9-sheet={n}>
            {(bySheet.get(Number(n)) ?? []).map((s) => {
              const key = keyOf(s);
              const style = { left: pct(s.box.x, SHEET.w), top: pct(s.box.y, SHEET.h), width: pct(s.box.w, SHEET.w), height: pct(s.box.h, SHEET.h) };
              if (editing?.key === key) {
                const font = liveFont(editing.text, { w: s.box.w, h: s.box.h }, FORM9_FILL_PT);
                return (
                  <span key={key}>
                    <textarea
                      className="pf-input"
                      style={{ ...style, fontSize: `${font.fontPt}pt` }}
                      value={editing.text}
                      aria-label={`${s.name} ${s.col}`}
                      maxLength={200}
                      autoFocus
                      onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
                      onChange={(e) => setEditing({ key, text: e.target.value })}
                      onBlur={() => commit(s, editing.text)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(null);
                        else if (e.key === "Enter") {
                          e.preventDefault();
                          commit(s, editing.text);
                        }
                      }}
                      data-form9-input={key}
                    />
                    <span className="pf-dest" style={{ left: style.left, top: pct(s.box.y + s.box.h, SHEET.h) }} data-dest-label="form">
                      {L.toForm}
                      {font.overflow && <span className="pf-over"> {L.annex}</span>}
                    </span>
                  </span>
                );
              }
              return (
                <div
                  key={key}
                  className="pf-area"
                  style={style}
                  role="button"
                  tabIndex={0}
                  aria-label={`${s.name} ${s.col}`}
                  title={s.hand ? `${L.form} ${s.hand.by ?? ""}` : s.name}
                  data-form9-cell={key}
                  data-hand={s.hand ? "form" : undefined}
                  onClick={() => setEditing({ key, text: s.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setEditing({ key, text: s.value });
                    }
                  }}
                >
                  {s.hand && (
                    <span className="pf-tag" data-hand="form">
                      {L.form}
                    </span>
                  )}
                </div>
              );
            })}
          </div>,
          el,
          `f9-layer-${n}`,
        ),
      )}
    </div>
  );
}
