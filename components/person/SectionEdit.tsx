"use client";

// 本人のページの面の「編集」（T45）。面の右上の「編集」を押すと、その面の項目が入力欄に変わり、下に「保存」「取消」。
// 手の入力なので埋まった欄も上書きでき、同意と時計の頼り先の確認もここで変える（保存は /api/intake/save の edit）。
// 経過に「ケアマネが直した」。開いたときの値と版で保存し、ほかの人が先に保存していれば「競合」（読み直して開き直す）。
// 読む側（面の中身）はサーバーで描いた物を children で受け取り、編集していない間はそのまま出す。

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { AddIcon, CloseIcon, RemoveIcon, RestoreIcon, SaveIcon } from "@/components/ui/Icon";
import { appConfirm } from "@/lib/ui/dialog";
import {
  CONSENT_KINDS,
  CONSENT_STATUSES,
  CONTACT_KINDS,
  DEVICE_KINDS,
  HAZARD_KINDS,
  MEDICATION_CATEGORIES,
  type CheckStatus,
  type ClockUnit,
  type ContactKind,
  type MedicationCategory,
} from "@/lib/db/types";
import {
  CHECK_STATUS_LABELS,
  CLOCK_UNIT_LABELS,
  CONSENT_KIND_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_KIND_LABELS,
  DEPENDS_ON_LABELS,
  DEVICE_LABELS,
  dropConfirmText,
  HAZARD_LABELS,
  INTAKE_LABELS,
  MED_PARTS,
  MEDICATION_CATEGORY_LABELS,
} from "@/lib/labels";
import {
  blankContact,
  blankMed,
  dropKey,
  editChanges,
  editDraft,
  removalNames,
  toggled,
  type ContactDraft,
  type EditData,
  type EditDraft,
  type EditSection,
  type MedDraft,
  type NightDraft,
  type OrderClash,
  type OrderDraft,
  CONTACT_ORDERS,
  orderClash,
} from "@/lib/intake/edit";
import { INTAKE_FIELDS } from "@/lib/intake/fields";
import { FieldInput } from "./IntakeChanges";
import { CheckIcon, EditIcon } from "./icons";
import { isError, postJson } from "./intake-api";
import { CHECK, INPUT, INPUT_IN } from "./intake-ui";
import { StateText } from "./parts";

/** 欄の名前と入力を並べる段（読む側の行と同じ幅） */
const ROW = "grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2";
const SUB = "text-xs text-muted";

type Props = {
  section: EditSection;
  data: EditData;
  /** 見出しの段（面の名前・未確認の数） */
  head: ReactNode;
  /** 読む側の中身（サーバーで描いた物） */
  children: ReactNode;
};

export function SectionEdit({ section, data, head, children }: Props) {
  const router = useRouter();
  // 開いたときの値（変更はこれと比べて作り、版もこれで送る）
  const [open, setOpen] = useState<{ base: EditData; draft: EditDraft } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changes = open ? editChanges(section, open.base, open.draft) : [];
  // 同じ緊急・支援の順を 2 人に付けたら保存しない（サーバーも断る）
  const clashed = open !== null && section === "people" && (() => {
    const c = orderClash(open.draft);
    return c.emergency.length > 0 || c.supporter.length > 0;
  })();
  const set = (patch: Partial<EditDraft>) => setOpen((o) => (o ? { ...o, draft: { ...o.draft, ...patch } } : o));

  async function save() {
    if (!open || changes.length === 0 || clashed) return;
    // 外す物があれば、保存の前に 1 回だけ確かめる（取消なら面は開いたまま）
    const drops = removalNames(changes, open.base);
    if (drops.length > 0) {
      const ok = await appConfirm(dropConfirmText(drops), { title: INTAKE_LABELS.dropTitle, ok: INTAKE_LABELS.drop, danger: true });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    const r = await postJson<{ ok: true; changed: number }>("/api/intake/save", {
      personId: open.base.personId,
      version: open.base.version,
      ai: null,
      edit: true,
      changes,
    });
    setBusy(false);
    if (isError(r)) {
      setError(r.label);
      // 競合はほかの人の保存。閉じて読み直す（直した所は開き直して入れ直す）
      if (r.error === "conflict") {
        setOpen(null);
        router.refresh();
      }
      return;
    }
    setOpen(null);
    router.refresh();
  }

  return (
    <div data-edit={section} data-editing={open ? "" : undefined}>
      <div className="flex items-baseline gap-2">
        {head}
        {!open && (
          <Button
            size="sm"
            icon={EditIcon}
            className="ml-auto self-center"
            data-edit-open={section}
            onClick={() => {
              setError(null);
              setOpen({ base: data, draft: editDraft(data) });
            }}
          >
            {INTAKE_LABELS.sectionEdit}
          </Button>
        )}
      </div>
      {error && !open && (
        <p role="alert" className="mt-1 text-xs font-bold text-danger">
          {error}
        </p>
      )}
      {open ? (
        <form
          className="mt-1.5 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <SectionForm section={section} data={open.base} draft={open.draft} set={set} />
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button type="submit" kind="main" size="sm" icon={SaveIcon} disabled={busy || changes.length === 0 || clashed} data-edit-save={section}>
              {INTAKE_LABELS.save}
            </Button>
            <Button kind="quiet" size="sm" icon={CloseIcon} disabled={busy} onClick={() => setOpen(null)}>
              {INTAKE_LABELS.discard}
            </Button>
            <span role="status" className="text-xs tabular-nums">
              {busy ? (
                <span className="text-muted">{INTAKE_LABELS.busy}</span>
              ) : error ? (
                <span className="font-bold text-danger">{error}</span>
              ) : (
                <span className="text-muted">{changes.length} 件</span>
              )}
            </span>
          </div>
        </form>
      ) : (
        <div className="mt-1.5">{children}</div>
      )}
    </div>
  );
}

type FormProps = { section: EditSection; data: EditData; draft: EditDraft; set: (patch: Partial<EditDraft>) => void };

/** 面の入力欄。並びは読む側の行の並び */
export function SectionForm({ section, data, draft, set }: FormProps) {
  const clash = orderClash(draft);
  const fields = INTAKE_FIELDS.filter((f) => f.section === section);
  const fieldRows = fields.map((f) => (
    <label key={f.key} className={ROW} data-field={f.key}>
      <span className={SUB}>{f.label}</span>
      <FieldInput field={f} value={draft.values[f.key]} onPanel onChange={(v) => set({ values: { ...draft.values, [f.key]: v } })} />
    </label>
  ));

  switch (section) {
    case "medical":
      return (
        <div className="space-y-2">
          <Group label="薬">
            {draft.meds.map((m, i) =>
              draft.drops.includes(dropKey.med(i)) ? (
                <DroppedRow key={i} name={data.ledger.medical.medications[i]?.name ?? m.name} onUndo={() => set({ drops: toggled(draft.drops, dropKey.med(i)) })} />
              ) : (
                <MedRow
                  key={i}
                  med={m}
                  onChange={(next) => set({ meds: draft.meds.map((x, j) => (j === i ? next : x)) })}
                  onDrop={() => set({ drops: toggled(draft.drops, dropKey.med(i)) })}
                />
              ),
            )}
            {draft.newMeds.map((m, i) => (
              <MedRow key={`new-${i}`} med={m} isNew onChange={(next) => set({ newMeds: draft.newMeds.map((x, j) => (j === i ? next : x)) })} />
            ))}
            <Button size="sm" icon={AddIcon} onClick={() => set({ newMeds: [...draft.newMeds, blankMed()] })}>
              {INTAKE_LABELS.addMedication}
            </Button>
          </Group>
          <Group label="機器">
            {draft.devices.map((d, i) =>
              draft.drops.includes(dropKey.device(d.kind)) ? (
                <DroppedRow key={d.kind} name={DEVICE_LABELS[d.kind]} onUndo={() => set({ drops: toggled(draft.drops, dropKey.device(d.kind)) })} />
              ) : (
                <div key={d.kind} className={ROW} data-device={d.kind}>
                  <span className={SUB}>{DEVICE_LABELS[d.kind]}</span>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1">
                    <input
                      className={INPUT}
                      placeholder="中身"
                      aria-label={`${DEVICE_LABELS[d.kind]} 中身`}
                      value={d.detail}
                      onChange={(e) => set({ devices: draft.devices.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })}
                    />
                    <input
                      className={INPUT}
                      placeholder="回数"
                      aria-label={`${DEVICE_LABELS[d.kind]} 回数`}
                      value={d.schedule}
                      onChange={(e) => set({ devices: draft.devices.map((x, j) => (j === i ? { ...x, schedule: e.target.value } : x)) })}
                    />
                    <DropButton onClick={() => set({ drops: toggled(draft.drops, dropKey.device(d.kind)) })} name={DEVICE_LABELS[d.kind]} />
                  </div>
                </div>
              ),
            )}
            <Checks
              label="追加"
              options={DEVICE_KINDS.filter((k) => !draft.devices.some((d) => d.kind === k)).map((k) => ({ value: k, label: DEVICE_LABELS[k] }))}
              picked={draft.newDevices}
              onChange={(v) => set({ newDevices: v as EditDraft["newDevices"] })}
            />
          </Group>
          <Group label="時計">
            {draft.clocks.length === 0 && <span className={SUB}>なし</span>}
            {draft.clocks.map((k, i) => {
              const cur = data.clocks.find((c) => c.id === k.id);
              const check = draft.checks[k.id];
              const seen = draft.seen.includes(k.id);
              // 値を直したら確認の日付は直しの方で今になる。値確認は値が同じで、値の入った時計だけ
              const valueSame = cur?.value != null && String(cur.value) === k.value.trim() && cur.unit === k.unit;
              return (
                <div key={k.id} className="space-y-1" data-clock={k.id}>
                  {/* 時計の名前は長い（「酸素 予備ボンベ」）ので、名前の横に値と単位を折り返して並べる */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 text-xs">{k.label}</span>
                    <div className="flex items-center gap-1">
                      <input
                        className={`${INPUT} w-20`}
                        inputMode="decimal"
                        aria-label={`${k.label} 値`}
                        value={k.value}
                        onChange={(e) => set({ clocks: draft.clocks.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                      />
                      <Select
                        className={`${INPUT} w-20`}
                        aria-label={`${k.label} 単位`}
                        value={k.unit}
                        onChange={(e) => set({ clocks: draft.clocks.map((x, j) => (j === i ? { ...x, unit: e.target.value as ClockUnit } : x)) })}
                      >
                        {(["minute", "hour", "day", "week"] as const).map((u) => (
                          <option key={u} value={u}>
                            {CLOCK_UNIT_LABELS[u]}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  {/* 値を変えずに今日確かめた（確認の日付だけ今に） */}
                  {cur?.value != null && (
                    <div className={ROW} data-clock-seen={k.id}>
                      <span className={SUB}>確認日</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs tabular-nums">
                          {seen && valueSame ? INTAKE_LABELS.seenToday : cur.confirmed_at ? jstDay(cur.confirmed_at) : "未確認"}
                        </span>
                        {valueSame && (
                          <Button
                            size="sm"
                            icon={seen ? CloseIcon : CheckIcon}
                            aria-pressed={seen}
                            onClick={() => set({ seen: toggled(draft.seen, k.id) })}
                          >
                            {seen ? INTAKE_LABELS.seenOff : INTAKE_LABELS.seen}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {/* 頼り先の確認（透析先・冷蔵・配達・保管）。人が確かめて付ける */}
                  {cur?.depends_on && check && (
                    <div className={ROW} data-clock-check={k.id}>
                      <span className={SUB}>{DEPENDS_ON_LABELS[cur.depends_on]}</span>
                      <div className="flex items-center gap-2">
                        <StateText tone={check === "confirmed" ? "ok" : "check"} className="text-xs">
                          {CHECK_STATUS_LABELS[check]}
                        </StateText>
                        <Button
                          size="sm"
                          icon={check === "confirmed" ? CloseIcon : CheckIcon}
                          onClick={() => set({ checks: { ...draft.checks, [k.id]: (check === "confirmed" ? "unconfirmed" : "confirmed") as CheckStatus } })}
                        >
                          {check === "confirmed" ? INTAKE_LABELS.checkOff : INTAKE_LABELS.checkOn}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </Group>
          <div className="space-y-1">{fieldRows}</div>
        </div>
      );
    case "evacuation":
      return (
        <div className="space-y-2">
          <Group label="ハザード">
            {draft.hazards.map((h, i) =>
              draft.drops.includes(dropKey.hazard(h.kind)) ? (
                <DroppedRow key={h.kind} name={HAZARD_LABELS[h.kind]} onUndo={() => set({ drops: toggled(draft.drops, dropKey.hazard(h.kind)) })} />
              ) : (
                <div key={h.kind} className={ROW} data-hazard={h.kind}>
                  <span className={SUB}>{HAZARD_LABELS[h.kind]}</span>
                  <div className="flex items-center gap-1">
                    <input
                      className={`${INPUT} w-20`}
                      inputMode="decimal"
                      placeholder="深さ"
                      aria-label={`${HAZARD_LABELS[h.kind]} 深さ`}
                      value={h.depth}
                      onChange={(e) => set({ hazards: draft.hazards.map((x, j) => (j === i ? { ...x, depth: e.target.value } : x)) })}
                    />
                    <span className="text-xs">m</span>
                    <DropButton className="ml-auto" onClick={() => set({ drops: toggled(draft.drops, dropKey.hazard(h.kind)) })} name={HAZARD_LABELS[h.kind]} />
                  </div>
                </div>
              ),
            )}
            <Checks
              label="追加"
              options={HAZARD_KINDS.filter((k) => !draft.hazards.some((h) => h.kind === k)).map((k) => ({ value: k, label: HAZARD_LABELS[k] }))}
              picked={draft.newHazards}
              onChange={(v) => set({ newHazards: v as EditDraft["newHazards"] })}
            />
          </Group>
          <div className="space-y-1">{fieldRows}</div>
        </div>
      );
    case "people":
      return (
        <div className="space-y-2">
          {(clash.emergency.length > 0 || clash.supporter.length > 0) && (
            <p role="alert" className="text-xs font-bold text-danger" data-order-clash>
              {INTAKE_LABELS.orderClash}{" "}
              {[
                ...clash.emergency.map((n) => `${INTAKE_LABELS.emergency} ${n}`),
                ...clash.supporter.map((n) => `${INTAKE_LABELS.supporter} ${n}`),
              ].join("・")}
            </p>
          )}
          {draft.contacts.map((c, i) => {
            const key = c.id ? dropKey.contact(c.id) : null;
            const cur = data.contacts.find((x) => x.id === c.id);
            return key && draft.drops.includes(key) ? (
              <DroppedRow
                key={c.id ?? i}
                name={`${CONTACT_KIND_LABELS[c.kind]} ${cur?.relation || cur?.name || ""}`.trim()}
                onUndo={() => set({ drops: toggled(draft.drops, key) })}
              />
            ) : (
              <ContactRow
                key={c.id ?? i}
                c={c}
                clash={clash}
                onChange={(next) => set({ contacts: draft.contacts.map((x, j) => (j === i ? next : x)) })}
                onDrop={key ? () => set({ drops: toggled(draft.drops, key) }) : undefined}
              />
            );
          })}
          {draft.newContacts.map((c, i) => (
            <ContactRow key={`new-${i}`} c={c} isNew clash={clash} onChange={(next) => set({ newContacts: draft.newContacts.map((x, j) => (j === i ? next : x)) })} />
          ))}
          <Button size="sm" icon={AddIcon} onClick={() => set({ newContacts: [...draft.newContacts, blankContact()] })}>
            {INTAKE_LABELS.addContact}
          </Button>
          <div className="space-y-1">{fieldRows}</div>
        </div>
      );
    case "basic":
      return (
        <div className="space-y-1">
          {fieldRows}
          {data.ledger.notes.map((n, i) => {
            const key = dropKey.note(i);
            return (
              <div key={key} className={ROW} data-note={i}>
                <span className={SUB}>特記</span>
                {draft.drops.includes(key) ? (
                  <DroppedRow name={n} onUndo={() => set({ drops: toggled(draft.drops, key) })} />
                ) : (
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-sm">{n}</span>
                    <DropButton onClick={() => set({ drops: toggled(draft.drops, key) })} name="特記" />
                  </div>
                )}
              </div>
            );
          })}
          <label className={ROW}>
            <span className={SUB}>{INTAKE_LABELS.addNote}</span>
            <textarea className={INPUT} rows={2} value={draft.note} onChange={(e) => set({ note: e.target.value })} />
          </label>
        </div>
      );
    case "consent":
      return (
        <div className="space-y-1">
          {CONSENT_KINDS.map((k) => (
            <label key={k} className={ROW} data-consent={k}>
              <span className={SUB}>{CONSENT_KIND_LABELS[k]}</span>
              <Select
                className={INPUT}
                value={draft.consents[k]}
                onChange={(e) => set({ consents: { ...draft.consents, [k]: e.target.value as EditDraft["consents"][typeof k] } })}
              >
                {CONSENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CONSENT_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </label>
          ))}
        </div>
      );
  }
}

/** 確認の日付（JST の YYYY-MM-DD） */
const jstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);

/** 行の「外す」。戻せる印なので無色（確かめの窓の最後の 1 押しが赤） */
function DropButton({ onClick, name, className = "" }: { onClick: () => void; name: string; className?: string }) {
  return (
    <Button size="sm" icon={RemoveIcon} className={className} aria-label={`${name} ${INTAKE_LABELS.drop}`} data-drop onClick={onClick}>
      {INTAKE_LABELS.drop}
    </Button>
  );
}

/** 外す印を付けた行（保存すると外れる。「戻す」で印を外す） */
function DroppedRow({ name, onUndo }: { name: string; onUndo: () => void }) {
  return (
    <div className="flex items-center gap-2" data-dropped>
      <span className="min-w-0 flex-1 truncate text-sm text-muted line-through">{name}</span>
      <span className="text-xs font-bold text-danger">{INTAKE_LABELS.dropMark}</span>
      <Button size="sm" icon={RestoreIcon} aria-label={`${name} ${INTAKE_LABELS.undrop}`} onClick={onUndo}>
        {INTAKE_LABELS.undrop}
      </Button>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-bold">{label}</div>
      {children}
    </div>
  );
}

function Checks({
  label,
  options,
  picked,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  picked: readonly string[];
  onChange: (v: string[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className={ROW}>
      <span className={SUB}>{label}</span>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {options.map((o) => (
          <label key={o.value} className="inline-flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              className={CHECK}
              checked={picked.includes(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))}
            />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function MedRow({ med, isNew = false, onChange, onDrop }: { med: MedDraft; isNew?: boolean; onChange: (m: MedDraft) => void; onDrop?: () => void }) {
  const p = (patch: Partial<MedDraft>) => onChange({ ...med, ...patch });
  return (
    <div className="grid grid-cols-2 gap-1" data-med={isNew ? "new" : med.name}>
      <input className={INPUT} placeholder="薬の名前" aria-label="薬の名前" value={med.name} onChange={(e) => p({ name: e.target.value })} />
      <Select className={INPUT} aria-label="薬の区分" value={med.category} onChange={(e) => p({ category: e.target.value as MedicationCategory })}>
        {MEDICATION_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {MEDICATION_CATEGORY_LABELS[c]}
          </option>
        ))}
      </Select>
      <input className={INPUT} placeholder="回数" aria-label={`${med.name} 回数`} value={med.schedule} onChange={(e) => p({ schedule: e.target.value })} />
      <input className={INPUT} placeholder={MED_PARTS.amount} aria-label={`${med.name} ${MED_PARTS.amount}`} value={med.amount} onChange={(e) => p({ amount: e.target.value })} />
      <div className="col-span-2 flex items-center gap-1">
        <input
          className={`${INPUT} min-w-0 flex-1`}
          placeholder={MED_PARTS.storage}
          aria-label={`${med.name} ${MED_PARTS.storage}`}
          value={med.storage}
          onChange={(e) => p({ storage: e.target.value })}
        />
        {onDrop && <DropButton onClick={onDrop} name={med.name} />}
      </div>
    </div>
  );
}

const NIGHT: ReadonlyArray<{ value: NightDraft; label: string }> = [
  { value: "", label: "夜間 未確認" },
  { value: "yes", label: "夜間可" },
  { value: "no", label: "夜間不可" },
];

function ContactRow({
  c,
  isNew = false,
  clash,
  onChange,
  onDrop,
}: {
  c: ContactDraft;
  isNew?: boolean;
  /** 重なった順（赤の太字） */
  clash: OrderClash;
  onChange: (c: ContactDraft) => void;
  onDrop?: () => void;
}) {
  const p = (patch: Partial<ContactDraft>) => onChange({ ...c, ...patch });
  const who = c.name || c.relation || CONTACT_KIND_LABELS[c.kind];
  return (
    <div className="grid grid-cols-2 gap-1 rounded bg-panel2 p-1.5" data-contact={c.id ?? "new"}>
      {isNew ? (
        <Select className={INPUT_IN} aria-label="連絡先の種類" value={c.kind} onChange={(e) => p({ kind: e.target.value as ContactDraft["kind"] })}>
          {CONTACT_KINDS.filter((k): k is Exclude<ContactKind, "self"> => k !== "self").map((k) => (
            <option key={k} value={k}>
              {CONTACT_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      ) : (
        <span className="self-center text-xs font-bold">{CONTACT_KIND_LABELS[c.kind]}</span>
      )}
      <input className={INPUT_IN} placeholder="続柄" aria-label={`${who} 続柄`} value={c.relation} onChange={(e) => p({ relation: e.target.value })} />
      <input className={INPUT_IN} placeholder="名前" aria-label={`${who} 名前`} value={c.name} onChange={(e) => p({ name: e.target.value })} />
      <input
        className={`${INPUT_IN} tabular-nums`}
        placeholder="電話"
        inputMode="tel"
        aria-label={`${who} 電話`}
        value={c.phone}
        onChange={(e) => p({ phone: e.target.value })}
      />
      <Select className={INPUT_IN} aria-label={`${who} 夜間`} value={c.night} onChange={(e) => p({ night: e.target.value as NightDraft })}>
        {NIGHT.map((n) => (
          <option key={n.value} value={n.value}>
            {n.label}
          </option>
        ))}
      </Select>
      <div className="flex items-center gap-1">
        <input className={`${INPUT_IN} min-w-0 flex-1`} placeholder="備考" aria-label={`${who} 備考`} value={c.note} onChange={(e) => p({ note: e.target.value })} />
        {onDrop && <DropButton onClick={onDrop} name={who} />}
      </div>
      {/* 緊急連絡先の順・支援者の順（人が決める。ルールの表は支援の順のある人を「支援者」と数える） */}
      <OrderSelect label={INTAKE_LABELS.emergency} who={who} value={c.emergency} clash={clash.emergency} onChange={(v) => p({ emergency: v })} />
      <OrderSelect label={INTAKE_LABELS.supporter} who={who} value={c.supporter} clash={clash.supporter} onChange={(v) => p({ supporter: v })} />
    </div>
  );
}

/** 順の選択（— / 1 / 2 / 3）。今の値が 3 より大きければその値も出す。重なった順は赤の太字 */
function OrderSelect({
  label,
  who,
  value,
  clash,
  onChange,
}: {
  label: string;
  who: string;
  value: OrderDraft;
  clash: readonly number[];
  onChange: (v: OrderDraft) => void;
}) {
  const orders: number[] = [...CONTACT_ORDERS];
  if (value !== "" && !orders.includes(Number(value))) orders.push(Number(value));
  const bad = value !== "" && clash.includes(Number(value));
  return (
    <Select
      className={`${INPUT_IN}${bad ? " font-bold text-danger" : ""}`}
      aria-label={`${who} ${label}`}
      aria-invalid={bad || undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-order={label}
    >
      <option value="">{label} —</option>
      {orders.map((n) => (
        <option key={n} value={String(n)}>
          {label} {n}
        </option>
      ))}
    </Select>
  );
}
