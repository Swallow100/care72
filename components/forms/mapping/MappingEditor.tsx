"use client";

// 対応表を確かめる画面の本体。欄ごとに AI が読んだ物（AI の印・自信・理由）と、ケアマネが選ぶ台帳の項目を並べる。
// 直す（項目・欄の名前・段・頁・形・選択肢）・外す・欄を足す。確認保存で事業所に保存し、差し込みに使えるようになる。
// 自信が低い欄と台帳に無い項目名を返した欄は要確認（本文色＋黄の帯・黄の塗りの印）。人が直した欄は「修正済」。
// 表は欄の中で送らない（画面全体の縦 1 本。見出しの行は画面の上に留める、T38）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiMark, StateTag } from "@/components/person/parts";
import { INPUT } from "@/components/person/intake-ui";
import { Button } from "@/components/ui/Button";
import { AddIcon, RemoveIcon, RestoreIcon, SaveIcon } from "@/components/ui/Icon";
import type { FormMappingStatus } from "@/lib/db/types";
import { Select } from "@/components/ui/Select";
import {
  blankField,
  CONFIDENCE_LABELS,
  FIELD_SHAPE_LABELS,
  FIELD_SHAPES,
  fieldChanged,
  ITEM_GROUPS,
  LEDGER_ITEMS,
  LIMITS,
  MAPPING_LABELS as L,
  mappingStats,
  type FieldShape,
  type FormMapping,
  type LedgerItemKey,
  type MappingField,
} from "@/lib/forms/mapping";

const GROUPED = (Object.keys(ITEM_GROUPS) as Array<keyof typeof ITEM_GROUPS>).map((g) => ({
  group: g,
  label: ITEM_GROUPS[g],
  items: LEDGER_ITEMS.filter((i) => i.group === g),
}));

const CELL = "px-1.5 py-1 align-top";
const IN = `${INPUT} py-0.5 text-xs`;

type Msg = { tone: "ok" | "error"; text: string };

export function MappingEditor({
  id,
  version: initialVersion,
  status: initialStatus,
  initial,
}: {
  id: string;
  version: number;
  status: FormMappingStatus;
  initial: FormMapping;
}) {
  const router = useRouter();
  const [m, setM] = useState<FormMapping>(initial);
  const [version, setVersion] = useState(initialVersion);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [dirty, setDirty] = useState(false);

  const stats = mappingStats(m);
  const emptyLabels = m.fields.filter((f) => !f.removed && !f.label.trim()).map((f) => f.id);
  const canSave = !saving && stats.fields > 0 && emptyLabels.length === 0 && m.title.trim() !== "";

  const edit = (patch: Partial<FormMapping>) => {
    setM((cur) => ({ ...cur, ...patch }));
    setDirty(true);
    setMsg(null);
  };
  const editField = (fid: string, patch: Partial<MappingField>) =>
    edit({ fields: m.fields.map((f) => (f.id === fid ? { ...f, ...patch } : f)) });
  const add = () => edit({ fields: [...m.fields, blankField(m.fields, m.pages)] });

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/forms/mappings/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, mapping: m }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; version?: number; label?: string } | null;
      if (res.ok && data?.ok && typeof data.version === "number") {
        setVersion(data.version);
        setStatus("checked");
        setDirty(false);
        setMsg({ tone: "ok", text: L.saved });
        router.refresh();
      } else {
        setMsg({ tone: "error", text: data?.label ?? L.aiFailed });
      }
    } catch {
      setMsg({ tone: "error", text: L.aiFailed });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="対応表" className="rounded-lg bg-panel p-3" data-mapping={id}>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="grid min-w-0 flex-1 basis-64 gap-0.5 text-xs text-muted">
          題名
          <input className={`${INPUT} text-ink`} value={m.title} maxLength={LIMITS.title} onChange={(e) => edit({ title: e.target.value })} />
        </label>
        <label className="grid w-40 gap-0.5 text-xs text-muted">
          発行元
          <input className={`${INPUT} text-ink`} value={m.issuer} maxLength={LIMITS.issuer} onChange={(e) => edit({ issuer: e.target.value })} />
        </label>
        <label className="grid w-16 gap-0.5 text-xs text-muted">
          頁数
          <input
            type="number"
            min={1}
            max={LIMITS.pages}
            className={`${INPUT} text-ink tabular-nums`}
            value={m.pages}
            onChange={(e) => edit({ pages: Math.min(Math.max(1, Number(e.target.value) || 1), LIMITS.pages) })}
          />
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button icon={AddIcon} onClick={add}>
            {L.addField}
          </Button>
          <Button kind="main" icon={SaveIcon} disabled={!canSave} onClick={save} data-pending={saving ? "" : undefined}>
            {saving ? L.saving : L.save}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" data-stats>
        {status === "checked" && !dirty ? <StateTag tone="ok">{L.checked}</StateTag> : <StateTag tone="check">{dirty ? "未保存" : L.draft}</StateTag>}
        <Stat label="欄" value={stats.fields} />
        {stats.read > 0 && <Stat label="自動対応" value={`${stats.autoMapped}/${stats.read}`} />}
        <Stat label={L.changed} value={stats.changed} />
        <Stat label={L.added} value={stats.added} />
        <Stat label="対応" value={stats.mapped} />
        {msg && (
          <span role={msg.tone === "error" ? "alert" : "status"} className={`font-bold ${msg.tone === "error" ? "text-danger" : "text-state-ok"}`}>
            {msg.text}
          </span>
        )}
      </div>

      {/* 欄の中で送らない（前は 68vh の箱の中で縦に送っていた）。clip は留めた見出しを効かせたまま角の外を切る */}
      <div className="mt-2 overflow-clip rounded bg-panel2">
        {/* 行の区切りは線でなく、行の間から見える面の中の灰色 */}
        <table className="w-full border-separate [border-spacing:0_1px] text-sm">
          <thead className="sticky top-0 z-10 bg-panel2 text-left text-xs text-muted">
            <tr>
              <th className={`${CELL} w-12`}>頁</th>
              <th className={`${CELL} w-32`}>段</th>
              <th className={CELL}>欄の名前</th>
              <th className={`${CELL} w-24`}>形</th>
              <th className={`${CELL} w-52`}>台帳の項目</th>
              <th className={`${CELL} w-56`}>AI</th>
              <th className={`${CELL} w-16`} />
            </tr>
          </thead>
          <tbody>
            {m.fields.map((f) => (
              <FieldRow key={f.id} f={f} pages={m.pages} empty={emptyLabels.includes(f.id)} onChange={(p) => editField(f.id, p)} />
            ))}
          </tbody>
        </table>
        {m.fields.length === 0 && (
          <div className="px-2 py-3 text-sm">
            <Button kind="plainIn" icon={AddIcon} onClick={add}>
              {L.addField}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <span>
      <span className="text-muted">{label}</span> <span className="font-bold tabular-nums">{value}</span>
    </span>
  );
}

function FieldRow({ f, pages, empty, onChange }: { f: MappingField; pages: number; empty: boolean; onChange: (p: Partial<MappingField>) => void }) {
  const off = f.removed;
  const low = f.ai !== null && (f.ai.confidence === "low" || f.ai.rejected !== undefined);
  return (
    <tr className={`bg-panel ${off ? "text-muted" : ""}`} data-field={f.id} data-removed={off ? "1" : undefined}>
      <td className={CELL}>
        <input
          type="number"
          min={1}
          max={pages}
          aria-label="頁"
          className={`${IN} w-11 tabular-nums`}
          value={f.page}
          disabled={off}
          onChange={(e) => onChange({ page: Math.min(Math.max(1, Number(e.target.value) || 1), pages) })}
        />
      </td>
      <td className={CELL}>
        <input aria-label="段" className={IN} value={f.section} maxLength={LIMITS.section} disabled={off} onChange={(e) => onChange({ section: e.target.value })} />
      </td>
      <td className={CELL}>
        <input
          aria-label="欄の名前"
          aria-invalid={empty || undefined}
          className={`${IN} ${off ? "line-through" : ""} ${empty ? "outline-2 outline-state-check" : ""}`}
          value={f.label}
          maxLength={LIMITS.label}
          disabled={off}
          onChange={(e) => onChange({ label: e.target.value })}
        />
        {f.position && <div className="mt-0.5 truncate text-[11px] text-muted">{f.position}</div>}
        {f.shape === "choice" && (
          <input
            key={`${f.id}-${f.options.join("・")}`}
            aria-label="選択肢"
            placeholder="選択肢（・区切り）"
            className={`${IN} mt-0.5`}
            defaultValue={f.options.join("・")}
            disabled={off}
            onBlur={(e) =>
              onChange({
                options: e.target.value
                  .split(/[・、,，]/)
                  .map((x) => x.trim())
                  .filter((x) => x !== "")
                  .slice(0, LIMITS.options),
              })
            }
          />
        )}
      </td>
      <td className={CELL}>
        <Select aria-label="形" className={IN} value={f.shape} disabled={off} onChange={(e) => onChange({ shape: e.target.value as FieldShape, ...(e.target.value === "handwrite" ? { item: null } : {}) })}>
          {FIELD_SHAPES.map((s) => (
            <option key={s} value={s}>
              {FIELD_SHAPE_LABELS[s]}
            </option>
          ))}
        </Select>
      </td>
      <td className={CELL}>
        <Select
          aria-label="台帳の項目"
          className={`${IN} ${f.item === null && f.shape !== "handwrite" && !off ? "text-muted" : ""}`}
          value={f.item ?? ""}
          disabled={off || f.shape === "handwrite"}
          onChange={(e) => onChange({ item: (e.target.value || null) as LedgerItemKey | null })}
        >
          <option value="">{f.shape === "handwrite" ? "手書き" : L.noItem}</option>
          {GROUPED.map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.items.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </td>
      <td className={CELL}>
        {f.ai ? (
          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs">
            <AiMark small title="AI の読取。人が確認" />
            <span className={low ? "font-bold tone-check" : "text-muted"}>自信 {CONFIDENCE_LABELS[f.ai.confidence]}</span>
            {f.ai.rejected && (
              <StateTag tone="check">
                {L.rejected} {f.ai.rejected}
              </StateTag>
            )}
            {fieldChanged(f) && <span className="font-bold">{L.changed}</span>}
            {f.ai.reason && <span className="w-full text-muted">{f.ai.reason}</span>}
          </div>
        ) : (
          <span className="text-xs text-muted">{L.added}</span>
        )}
      </td>
      <td className={`${CELL} text-right`}>
        {/* 外すは戻せる印なので無色（行ごとに赤を並べない。事業所の担当の表と同じ向き） */}
        <Button size="sm" icon={off ? RestoreIcon : RemoveIcon} onClick={() => onChange({ removed: !off })}>
          {off ? L.restore : L.remove}
        </Button>
      </td>
    </tr>
  );
}
