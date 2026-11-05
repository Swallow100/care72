"use client";

// 対応表を確かめる画面の本体。欄ごとに AI が読んだ物（AI の印・自信・理由）と、ケアマネが選ぶ台帳の項目を並べる。
// 直す（項目・欄の名前・段・頁・形・選択肢）・外す・欄を足す。確認保存で事業所に保存し、差し込みに使えるようになる。
// 自信が低い欄と台帳に無い項目名を返した欄は要確認（本文色＋黄の帯・黄の塗りの印）。人が直した欄は「修正済」。
// 表は欄の中で送らない（画面全体の縦 1 本。見出しの行は画面の上に留める、T38）。
// T86: 様式の頁の画像があれば、左に頁の画像と欄ごとの値の場所（AI が読んだ矩形）を重ね（PageBoxes）、ずれていれば直す。
// 行を選ぶ（行の欄に触る・位置を押す）とその欄の枠が選ばれ、枠を押すと行が選ばれる。書体（ゴシック・明朝）もここで直す。
// T120: 台帳の項目なしで人が選ぶ欄（AI の候補がある欄・同意の欄）は「要選択」（黄の印）と候補の「採用」。読めなかった頁は「未読」と「再読」。
// 日付・電話の欄は区切りの字（年・月・日）を直せる（区切りの空きの場所は頁の画像の上で）。
// T122: 自信の低い欄・台帳の項目なしの欄・読み違いの多い種類の欄（複数選択の一部・種類の □・元号。lib/forms/field-risk.ts）は「要確認」（黄の帯と印）。
// 下書きでは要確認順（要確認を先に）で並べ、「確認」で外す（項目を直しても確認に）。「保留」を選ぶと、確認していない要確認の欄を紙に使わない。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiMark, StateTag } from "@/components/person/parts";
import { INPUT } from "@/components/person/intake-ui";
import { Button } from "@/components/ui/Button";
import { AddIcon, RemoveIcon, RestoreIcon, RetryIcon, SaveIcon } from "@/components/ui/Icon";
import { PageBoxes, type PageImageView } from "./PageBoxes";
import { FIELD_RISK_LABELS, fieldRisks, openRisks, riskOrder, type FieldRisk } from "@/lib/forms/field-risk";
import { FIELD_TARGET, realignOptionBoxes, withBox, type BoxTarget } from "@/lib/forms/box-edit";
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
  ledgerItem,
  LIMITS,
  MAPPING_LABELS as L,
  mappingStats,
  needsPick,
  PART_SHAPES,
  TYPEFACE_LABELS,
  TYPEFACES,
  type FieldBox,
  type FieldShape,
  type FormMapping,
  type LedgerItemKey,
  type MappingField,
  type Typeface,
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
  pageImages = null,
}: {
  id: string;
  version: number;
  status: FormMappingStatus;
  initial: FormMapping;
  /** 様式の頁の画像（T86）。無ければ場所の確かめは出さない */
  pageImages?: PageImageView[] | null;
}) {
  const router = useRouter();
  const [m, setM] = useState<FormMapping>(initial);
  const [version, setVersion] = useState(initialVersion);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<BoxTarget>(FIELD_TARGET);
  const [zoom, setZoom] = useState(false);
  const images = pageImages && pageImages.length > 0 ? pageImages : null;

  const stats = mappingStats(m);
  const picks = m.fields.filter(needsPick).length;
  // 要確認（T122）。並びは下書きで要確認があれば要確認順
  const risks = fieldRisks(m.fields);
  const open = openRisks(m);
  const [order, setOrder] = useState<"risk" | "form">(initialStatus === "draft" && openRisks(initial) > 0 ? "risk" : "form");
  const rows = order === "risk" ? riskOrder(m.fields) : m.fields;
  const unread = m.unread ?? [];
  const [rereading, setRereading] = useState(false);
  const emptyLabels = m.fields.filter((f) => !f.removed && !f.label.trim()).map((f) => f.id);
  const canSave = !saving && stats.fields > 0 && emptyLabels.length === 0 && m.title.trim() !== "";

  const edit = (patch: Partial<FormMapping>) => {
    setM((cur) => ({ ...cur, ...patch }));
    setDirty(true);
    setMsg(null);
  };
  const editField = (fid: string, patch: Partial<MappingField>) =>
    edit({ fields: m.fields.map((f) => (f.id === fid ? { ...f, ...patch } : f)) });
  const replaceField = (fid: string, next: (f: MappingField) => MappingField) => edit({ fields: m.fields.map((f) => (f.id === fid ? next(f) : f)) });
  const select = (fid: string) => {
    if (fid !== selected) setTarget(FIELD_TARGET);
    setSelected(fid);
  };
  // 枠を押して選んだ行を見える所へ
  const selectFromBox = (fid: string) => {
    select(fid);
    document.querySelector(`tr[data-field="${fid}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const setBox = (fid: string, t: BoxTarget, box: FieldBox | null) => replaceField(fid, (f) => withBox(f, t, box));
  const add = () => edit({ fields: [...m.fields, blankField(m.fields, m.pages)] });

  // 読めなかった頁を読み直す（T120）。直しかけがあるときは押せない（保存した物に足すため）
  const reread = async () => {
    setRereading(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/forms/mappings/${encodeURIComponent(id)}/reread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; version?: number; mapping?: FormMapping; label?: string } | null;
      if (res.ok && data?.ok && typeof data.version === "number" && data.mapping) {
        setM(data.mapping);
        setVersion(data.version);
        // AI の読んだ欄が足されたので、確かめるまで下書き（サーバーも下書きに戻す）
        setStatus("draft");
        setMsg({ tone: (data.mapping.unread ?? []).length > 0 ? "error" : "ok", text: (data.mapping.unread ?? []).length > 0 ? L.unread : L.reused });
      } else {
        setMsg({ tone: "error", text: data?.label ?? L.aiFailed });
      }
    } catch {
      setMsg({ tone: "error", text: L.aiFailed });
    } finally {
      setRereading(false);
    }
  };

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
          {/* 頁の画像があれば頁の数は画像の数まで（画像の無い頁の欄は元の様式の上に置けない。T86） */}
          <input
            type="number"
            min={1}
            max={images ? images.length : LIMITS.pages}
            className={`${INPUT} text-ink tabular-nums`}
            value={m.pages}
            onChange={(e) => edit({ pages: Math.min(Math.max(1, Number(e.target.value) || 1), images ? images.length : LIMITS.pages) })}
          />
        </label>
        {images && (
          <label className="grid w-28 gap-0.5 text-xs text-muted">
            {L.typeface}
            <Select className={`${INPUT} text-ink`} value={m.typeface ?? "gothic"} onChange={(e) => edit({ typeface: e.target.value as Typeface })}>
              {TYPEFACES.map((t) => (
                <option key={t} value={t}>
                  {TYPEFACE_LABELS[t]}
                </option>
              ))}
            </Select>
          </label>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button kind="add" icon={AddIcon} onClick={add}>
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
        {risks.size > 0 && (
          <span className="flex flex-wrap items-baseline gap-1.5" data-risks={open}>
            <StateTag tone="check">{L.risk}</StateTag>
            <span className="font-bold tabular-nums">{open}</span>
            <Button
              size="sm"
              aria-pressed={m.holdRisky === true}
              className={m.holdRisky ? "underline decoration-2 underline-offset-[6px]" : "font-normal text-muted"}
              onClick={() => edit({ holdRisky: !m.holdRisky })}
              data-hold={m.holdRisky ? "1" : "0"}
            >
              {L.hold}
            </Button>
            {(["risk", "form"] as const).map((o) => (
              <Button
                key={o}
                size="sm"
                kind="quiet"
                aria-pressed={order === o}
                className={order === o ? "underline decoration-2 underline-offset-[6px]" : "font-normal text-muted"}
                onClick={() => setOrder(o)}
                data-order={o}
              >
                {o === "risk" ? L.riskOrder : L.formOrder}
              </Button>
            ))}
          </span>
        )}
        {picks > 0 && (
          <span className="tabular-nums" data-picks={picks}>
            <StateTag tone="check">{L.pick}</StateTag> <span className="font-bold">{picks}</span>
          </span>
        )}
        {unread.length > 0 && (
          <span className="flex items-baseline gap-1.5" data-unread={unread.join(",")}>
            <StateTag tone="check">{L.unread}</StateTag>
            <span className="font-bold tabular-nums">{unread.map((p) => `${p}頁`).join("・")}</span>
            <Button size="sm" icon={RetryIcon} disabled={dirty || rereading} onClick={reread} data-pending={rereading ? "" : undefined}>
              {rereading ? L.reading : "再読"}
            </Button>
          </span>
        )}
        {images && <Stat label={L.box} value={`${stats.placed}/${stats.fields}`} />}
        {images && stats.boxMoved > 0 && <Stat label={L.boxMoved} value={stats.boxMoved} />}
        {msg && (
          <span role={msg.tone === "error" ? "alert" : "status"} className={`font-bold ${msg.tone === "error" ? "text-danger" : "text-state-ok"}`}>
            {msg.text}
          </span>
        )}
      </div>

      <div
        className={
          !images
            ? "contents"
            : zoom
              ? "mt-2 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,44rem)_minmax(0,1fr)]"
              : "mt-2 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]"
        }
      >
      {images && (
        // 頁の画像は表を送っても見えるように留める（広い画面で、拡大していないとき。狭い画面は表の上）
        <div className={zoom ? "self-start" : "self-start xl:sticky xl:top-2"}>
          <PageBoxes
            pages={images}
            fields={m.fields}
            selected={selected}
            target={target}
            onSelect={selectFromBox}
            onTarget={setTarget}
            onBox={setBox}
            zoom={zoom}
            onZoom={setZoom}
          />
        </div>
      )}
      {/* 欄の中で送らない（前は 68vh の箱の中で縦に送っていた）。clip は留めた見出しを効かせたまま角の外を切る */}
      <div className={`${images ? "" : "mt-2 "}min-w-0 self-start overflow-clip rounded bg-panel2`}>
        {/* 行の区切りは線でなく、行の間から見える面の中の灰色 */}
        <table className="w-full border-separate [border-spacing:0_1px] text-sm">
          <thead className="sticky top-0 z-10 bg-panel2 text-left text-xs text-muted">
            <tr>
              <th className={`${CELL} w-12`}>頁</th>
              <th className={`${CELL} w-32`}>段</th>
              <th className={CELL}>欄の名前</th>
              <th className={`${CELL} w-24`}>形</th>
              {images && <th className={`${CELL} w-16`}>{L.box}</th>}
              <th className={`${CELL} w-52`}>台帳の項目</th>
              <th className={`${CELL} w-56`}>AI</th>
              <th className={`${CELL} w-16`} />
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <FieldRow
                key={f.id}
                f={f}
                risk={risks.get(f.id) ?? null}
                hold={m.holdRisky === true}
                pages={m.pages}
                empty={emptyLabels.includes(f.id)}
                onChange={(p) => editField(f.id, p)}
                onOptions={(options) => replaceField(f.id, (x) => realignOptionBoxes(x, options))}
                place={images ? { selected: f.id === selected, select: () => select(f.id) } : null}
              />
            ))}
          </tbody>
        </table>
        {m.fields.length === 0 && (
          <div className="px-2 py-3 text-sm">
            <Button kind="addIn" icon={AddIcon} onClick={add}>
              {L.addField}
            </Button>
          </div>
        )}
      </div>
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

function FieldRow({
  f,
  risk,
  hold,
  pages,
  empty,
  onChange,
  onOptions,
  place,
}: {
  f: MappingField;
  /** 要確認の訳（T122。要確認でなければ null） */
  risk: FieldRisk | null;
  /** 要確認の欄を確認するまで紙に使わない */
  hold: boolean;
  pages: number;
  empty: boolean;
  onChange: (p: Partial<MappingField>) => void;
  onOptions: (options: string[]) => void;
  /** 場所の確かめ（T86）。頁の画像が無ければ null */
  place: { selected: boolean; select: () => void } | null;
}) {
  const off = f.removed;
  const low = f.ai !== null && (f.ai.confidence === "low" || f.ai.rejected !== undefined);
  // 確認していない要確認の欄（T122）は左の黄の帯
  const open = risk !== null && !f.confirmed && !off;
  return (
    <tr
      // 選んだ行は左の操作の色の帯、要確認は黄の帯（下地は敷かない）
      className={`bg-panel ${off ? "text-muted" : ""} ${place?.selected ? "shadow-[inset_3px_0_0_var(--accent)]" : open ? "shadow-[inset_3px_0_0_var(--state-check)]" : ""}`}
      data-risk={risk ?? undefined}
      data-open={open ? "1" : undefined}
      data-field={f.id}
      data-removed={off ? "1" : undefined}
      data-selected={place?.selected ? "1" : undefined}
      onFocusCapture={place && !off ? place.select : undefined}
    >
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
        {(f.shape === "choice" || (PART_SHAPES.includes(f.shape) && (f.shape !== "text" || f.options.length > 0))) && (
          <input
            key={`${f.id}-${f.options.join("・")}`}
            aria-label={f.shape === "choice" ? "選択肢" : L.parts}
            placeholder={f.shape === "choice" ? "選択肢（・区切り）" : f.shape === "phone" ? "区切り（局番・市内・番号）" : "区切り（年・月・日）"}
            className={`${IN} mt-0.5`}
            defaultValue={f.options.join("・")}
            disabled={off}
            onBlur={(e) =>
              onOptions(
                e.target.value
                  .split(/[・、,，]/)
                  .map((x) => x.trim())
                  .filter((x) => x !== "")
                  .slice(0, LIMITS.options),
              )
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
      {place && (
        <td className={CELL}>
          <button
            type="button"
            className={`relative rounded px-1 py-0.5 text-xs whitespace-nowrap ${f.box ? "text-ink" : "text-muted"} ${place.selected ? "font-bold underline decoration-2 underline-offset-4" : ""}`}
            disabled={off}
            data-press
            data-place={f.id}
            onClick={place.select}
          >
            {f.box ? `${f.page}頁` : L.noBox}
          </button>
        </td>
      )}
      <td className={CELL}>
        <Select
          aria-label="台帳の項目"
          className={`${IN} ${f.item === null && f.shape !== "handwrite" && !off ? "text-muted" : ""}`}
          value={f.item ?? ""}
          disabled={off || f.shape === "handwrite"}
          // 項目を直したら確認した欄に（T122）
          onChange={(e) => onChange({ item: (e.target.value || null) as LedgerItemKey | null, confirmed: true })}
        >
          <option value="">{f.shape === "handwrite" ? "手書き" : needsPick(f) ? L.pick : L.noItem}</option>
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
        {needsPick(f) && (
          // 項目なしで人が選ぶ欄（同意など。AI は本人の意思の欄を決まりで項目なしにする）。黄の印と、候補があれば採用
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs" data-pick={f.id}>
            <StateTag tone="check">{L.pick}</StateTag>
            {f.ai?.candidate && (
              <Button size="sm" onClick={() => onChange({ item: f.ai!.candidate!, confirmed: true })}>
                {L.candidate} {ledgerItem(f.ai.candidate).label} {L.adopt}
              </Button>
            )}
          </div>
        )}
      </td>
      <td className={CELL}>
        {risk !== null && !off && (
          // 要確認の訳と確認（T122）。保留のとき、確認していない項目ありの欄は紙に使わない
          <div className="mb-0.5 flex flex-wrap items-center gap-1 text-xs" data-risk-tag={f.id}>
            {f.confirmed ? (
              <span className="text-muted">{L.confirmed}</span>
            ) : (
              <>
                <StateTag tone="check">{FIELD_RISK_LABELS[risk]}</StateTag>
                {hold && f.item !== null && <span className="font-bold">{L.hold}</span>}
                <Button size="sm" onClick={() => onChange({ confirmed: true })} data-confirm={f.id}>
                  {L.confirm}
                </Button>
              </>
            )}
          </div>
        )}
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
