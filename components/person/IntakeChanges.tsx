"use client";

// 入れる欄の「変更点」: Claude の分け方を今の台帳と並べた差分。項目ごとに 今の値 → 新しい値。
// 追加は選んだまま、既入力（今と違う）は外したまま、一致は選べない。人が外す・直す・選んでから保存する。
// AI の出力なので見出しに「AI」の印。伏せ字が残る所は「伏せ字」の印で、直してから保存する。

import { useMemo } from "react";
import { applyLedgerChanges } from "@/lib/db/ledger";
import type { ClockCategory, Ledger } from "@/lib/db/types";
import { CONTACT_KIND_LABELS, DIFF_STATE_LABELS, INTAKE_LABELS, MEDICATION_CATEGORY_LABELS, SECTION_LABELS } from "@/lib/labels";
import { changeText, hasMask, type IntakeChange } from "@/lib/intake/changes";
import type { DiffItem } from "@/lib/intake/diff";
import { INTAKE_SECTIONS, intakeField, type IntakeField } from "@/lib/intake/fields";
import { markPreview, planMarkClocks } from "@/lib/intake/marks";
import { MEDICATION_CATEGORIES } from "@/lib/db/types";
import { buttonClass } from "@/components/ui/Button";
import { BTN, BTN_MAIN, CHECK, INPUT, INPUT_IN } from "./intake-ui";
import { AiMark, StateTag } from "./parts";
import { Select } from "@/components/ui/Select";

/** 変更点の 1 行。edited は人が「修正」で値を直したか（行の AI の印の横に「修正済」） */
export type ChangeRow = DiffItem & { on: boolean; editing: boolean; edited: boolean };

export function rowsOf(items: readonly DiffItem[]): ChangeRow[] {
  return items.map((i) => ({ ...i, on: i.state === "add", editing: false, edited: false }));
}

type Props = {
  rows: ChangeRow[];
  dropped: number;
  ledger: Ledger;
  clocks: ReadonlyArray<{ category: ClockCategory; label: string }>;
  busy: boolean;
  onChange: (rows: ChangeRow[]) => void;
  onSave: (changes: IntakeChange[]) => void;
  onDiscard: () => void;
};

export function IntakeChanges({ rows, dropped, ledger, clocks, busy, onChange, onSave, onDiscard }: Props) {
  const selected = useMemo(() => rows.filter((r) => r.on && r.change).map((r) => r.change!), [rows]);
  // 保存で付く印（機器・薬の区分から機械的に。Claude は決めない）
  const marks = useMemo(() => markPreview(planMarkClocks(applyLedgerChanges(ledger, selected).ledger, clocks)), [ledger, selected, clocks]);
  const count = (s: DiffItem["state"]) => rows.filter((r) => r.state === s).length;
  const update = (id: string, patch: Partial<ChangeRow>) => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2" data-intake="changes">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="font-bold">{INTAKE_LABELS.changes}</h3>
        <AiMark />
        <span className="text-xs text-muted tabular-nums">
          {DIFF_STATE_LABELS.add} {count("add")}・{DIFF_STATE_LABELS.filled} {count("filled")}・{DIFF_STATE_LABELS.same} {count("same")}
          {dropped > 0 && `・${INTAKE_LABELS.dropped} ${dropped}`}
        </span>
      </div>
      {rows.length === 0 && <p className="text-muted">{INTAKE_LABELS.unchanged}</p>}
      {INTAKE_SECTIONS.map((section) => {
        const mine = rows.filter((r) => r.section === section);
        if (mine.length === 0) return null;
        return (
          <section key={section} className="rounded bg-panel2 px-2 py-1.5" data-section={section}>
            <h4 className="text-sm font-bold">{SECTION_LABELS[section]}</h4>
            <ul className="mt-0.5 space-y-1">
              {mine.map((r) => (
                <ChangeItem key={r.id} row={r} onPatch={(p) => update(r.id, p)} />
              ))}
            </ul>
          </section>
        );
      })}
      {marks.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs" data-intake="marks">
          <span className="text-muted">{INTAKE_LABELS.marks}</span>
          {marks.map((m) => (
            <span key={m.label} className="font-bold">
              {m.label}
              {m.tier !== null && <span className="ml-0.5 font-normal text-muted tabular-nums">{m.tier}</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={BTN_MAIN}
          data-press="overlay"
          disabled={busy || selected.length === 0}
          onClick={() => onSave(selected)}
        >
          {INTAKE_LABELS.save}
        </button>
        <button type="button" className={BTN} data-press disabled={busy} onClick={onDiscard}>
          {INTAKE_LABELS.discard}
        </button>
        <span className="text-xs text-muted tabular-nums">{selected.length} 件</span>
      </div>
    </div>
  );
}

function ChangeItem({ row, onPatch }: { row: ChangeRow; onPatch: (p: Partial<ChangeRow>) => void }) {
  const selectable = row.change !== null;
  const editable = row.change !== null && isEditable(row.change);
  const setChange = (change: IntakeChange) => {
    const next = changeText(change);
    onPatch({ change, next, edited: true, masked: hasMask(next) || (change.t === "contact" && hasMask(change.value.note ?? "")) });
  };
  return (
    <li className={`text-sm ${selectable ? "" : "text-muted"}`} data-state={row.state}>
      <div className="flex items-start gap-1.5">
        {selectable ? (
          <input
            type="checkbox"
            className={`${CHECK} mt-0.5`}
            checked={row.on}
            onChange={(e) => onPatch({ on: e.target.checked })}
            aria-label={`${row.label} ${row.state === "filled" ? INTAKE_LABELS.overwrite : DIFF_STATE_LABELS.add}`}
          />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-xs font-bold">{row.label}</span>
            {/* 項目ごとの AI の印（Claude の分け方から来た行）。人が直した行は「修正済」を添える */}
            <AiMark small title={row.edited ? "AI の出力を人が修正" : undefined} />
            {row.edited && <span className="text-xs text-muted">{INTAKE_LABELS.edited}</span>}
            {row.state === "filled" ? (
              <StateTag tone="check">{DIFF_STATE_LABELS.filled}</StateTag>
            ) : (
              <span className="text-xs text-muted">{DIFF_STATE_LABELS[row.state]}</span>
            )}
            {row.masked && <StateTag tone="check">{INTAKE_LABELS.masked}</StateTag>}
            {editable && (
              <button type="button" className={buttonClass("quiet", "sm", "ml-auto")} data-press onClick={() => onPatch({ editing: !row.editing })}>
                {INTAKE_LABELS.edit}
              </button>
            )}
          </div>
          <div className="break-words">
            {row.current !== null && row.state !== "same" && (
              <>
                {/* 上書き（既入力）だけ今の値に線。追加は今の値の空いた所を埋めるだけなので線を引かない */}
                <span className={`text-muted ${row.state === "filled" ? "line-through decoration-1" : ""}`}>{row.current}</span>
                <span className="mx-1 text-muted">→</span>
              </>
            )}
            <span className={row.state === "same" ? "" : "font-bold"}>{row.next}</span>
          </div>
          {row.editing && row.change && <EditChange change={row.change} onChange={setChange} />}
        </div>
      </div>
    </li>
  );
}

function isEditable(c: IntakeChange): boolean {
  return c.t === "field" || c.t === "note" || c.t === "medication" || c.t === "contact";
}

/** 直す欄。値の形に合わせた入力 */
function EditChange({ change, onChange }: { change: IntakeChange; onChange: (c: IntakeChange) => void }) {
  switch (change.t) {
    case "field": {
      const f = intakeField(change.key);
      if (!f) return null;
      return <FieldInput field={f} value={change.value} onChange={(value) => onChange({ ...change, value })} />;
    }
    case "note":
      return (
        <textarea
          className={`${INPUT_IN} mt-1`}
          rows={2}
          value={change.value}
          onChange={(e) => onChange({ ...change, value: e.target.value })}
          aria-label="特記"
        />
      );
    case "medication": {
      const v = change.value;
      const set = (patch: Partial<typeof v>) => onChange({ ...change, value: { ...v, ...patch } });
      return (
        <div className="mt-1 grid grid-cols-2 gap-1">
          <input className={INPUT_IN} value={v.name} onChange={(e) => set({ name: e.target.value })} aria-label="薬の名前" disabled={change.index != null} />
          <Select
            className={INPUT_IN}
            value={v.category}
            onChange={(e) => set({ category: e.target.value as typeof v.category })}
            aria-label="薬の区分"
            disabled={change.index != null}
          >
            {MEDICATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MEDICATION_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
          <input className={INPUT_IN} value={v.schedule ?? ""} onChange={(e) => set({ schedule: e.target.value })} placeholder="回数" aria-label="回数" />
          <input className={INPUT_IN} value={v.amount ?? ""} onChange={(e) => set({ amount: e.target.value })} placeholder="用量" aria-label="用量" />
          <input className={`${INPUT_IN} col-span-2`} value={v.storage ?? ""} onChange={(e) => set({ storage: e.target.value })} placeholder="保管" aria-label="保管" />
        </div>
      );
    }
    case "contact": {
      const v = change.value;
      const set = (patch: Partial<typeof v>) => onChange({ ...change, value: { ...v, ...patch } });
      return (
        <div className="mt-1 grid grid-cols-2 gap-1">
          <input className={INPUT_IN} value={v.name ?? ""} onChange={(e) => set({ name: e.target.value })} placeholder="名前" aria-label="名前" />
          <input
            className={INPUT_IN}
            value={v.phone ?? ""}
            onChange={(e) => set({ phone: e.target.value })}
            placeholder="電話"
            aria-label="電話"
            inputMode="tel"
          />
          <input
            className={INPUT_IN}
            value={v.relation ?? ""}
            onChange={(e) => set({ relation: e.target.value })}
            placeholder={CONTACT_KIND_LABELS[v.kind]}
            aria-label="続柄"
          />
          <Select
            className={INPUT_IN}
            value={v.nightOk === undefined ? "" : String(v.nightOk)}
            onChange={(e) => set({ nightOk: e.target.value === "" ? undefined : e.target.value === "true" })}
            aria-label="夜間"
          >
            <option value="">夜間未確認</option>
            <option value="true">夜間可</option>
            <option value="false">夜間不可</option>
          </Select>
          <input className={`${INPUT_IN} col-span-2`} value={v.note ?? ""} onChange={(e) => set({ note: e.target.value })} placeholder="備考" aria-label="備考" />
        </div>
      );
    }
    default:
      return null;
  }
}

/** 欄の形に合わせた入力。値は欄の形のまま（文字の配列・選択肢の値・真偽・数）か、打っている途中の文字 */
export function FieldInput({
  field,
  value,
  onChange,
  onPanel = false,
}: {
  field: IntakeField;
  value: unknown;
  onChange: (v: unknown) => void;
  /** 面（白）の上に置く（本人のページの面の編集）。欄は面の中の灰色 */
  onPanel?: boolean;
}) {
  const s = field.shape;
  const box = onPanel ? INPUT : `${INPUT_IN} mt-1`;
  switch (s.type) {
    case "enum":
      return (
        <Select className={box} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-label={field.label}>
          <option value="">未確認</option>
          {s.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case "bool":
      return (
        <Select
          className={box}
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value === "true")}
          aria-label={field.label}
        >
          <option value="">未確認</option>
          <option value="true">あり</option>
          <option value="false">なし</option>
        </Select>
      );
    case "enumList": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className={`${onPanel ? "" : "mt-1 "}flex flex-wrap gap-x-3 gap-y-1`}>
          {s.options.map((o) => (
            <label key={o.value} className="inline-flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                className={CHECK}
                checked={list.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "list":
      return (
        <input
          className={box}
          value={Array.isArray(value) ? value.join("、") : typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
        />
      );
    case "int":
      return (
        <input
          className={box}
          inputMode="numeric"
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
        />
      );
    case "text":
      return (
        <input className={box} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} aria-label={field.label} />
      );
  }
}
