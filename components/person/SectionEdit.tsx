"use client";

// 本人のページの面の「編集」（T45）。面の右上の「編集」を押すと、その面の項目が入力欄に変わり、下に「保存」「取消」。
// 手の入力なので埋まった欄も上書きでき、同意と時計の頼り先の確認もここで変える（保存は /api/intake/save の edit）。
// 経過に「ケアマネが直した」。開いたときの値と版で保存し、ほかの人が先に保存していれば「競合」（読み直して開き直す）。
// 読む側（面の中身）はサーバーで描いた物を children で受け取り、編集していない間はそのまま出す。
// 面の中は組（lib/intake/fields.ts の FIELD_GROUPS、T145）に分ける: 面の下を面の中の灰色にし、組ごとに白い箱と見出し。
// 組が 3 つ以上なら上に目次（押すとその組へ送る）。入力の欄に入った組・目次で飛んだ組の見出しを強くする。
// T166: 目次はリンク（読み上げは「避難先 移動」）で、押すとその組の最初の欄にカーソルを置く（前は組が見えていると押しても何も変わらず、入力を開く物と読まれて 4 回押された）。
// 「保存」「取消」と「変更 N 件」は開いている間、画面の下に留める（欄の下の遠い所にあり、保存の場所が分からなかった）。保存のあとは面の頭に「保存済」

import { useRouter } from "next/navigation";
import { Fragment, useState, type ComponentProps, type FocusEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { AddIcon, CloseIcon, RemoveIcon, RestoreIcon, SaveIcon } from "@/components/ui/Icon";
import { appConfirm } from "@/lib/ui/dialog";
import {
  CLOCK_SOURCES,
  CONSENT_KINDS,
  CONSENT_STATUSES,
  CONTACT_REACHES,
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
  CLOCK_CATEGORY_LABELS,
  CLOCK_KIND_LABELS,
  CLOCK_SOURCE_LABELS,
  CLOCK_START_LABELS,
  CLOCK_UNIT_LABELS,
  CONSENT_KIND_LABELS,
  CONSENT_STATUS_LABELS,
  CONTACT_KIND_LABELS,
  CONTACT_PART_LABELS,
  CONTACT_REACH_LABELS,
  DEPENDS_ON_LABELS,
  DEVICE_LABELS,
  dropConfirmText,
  HAZARD_LABELS,
  INTAKE_LABELS,
  MED_PARTS,
  MEDICATION_CATEGORY_LABELS,
  PLACE_LABELS,
} from "@/lib/labels";
import { pickCenter } from "@/lib/map/center";
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
  blankClock,
  ADDABLE_CLOCK_CATEGORIES,
  type ClockDraft,
  type RunningStart,
  editBlockers,
  orderClash,
  selfTwice,
  ADDRESS_MAX,
  type FlagDraft,
} from "@/lib/intake/edit";
import { LocationPick } from "./LocationPick";
import { groupsOf, INTAKE_FIELDS, type FieldGroup } from "@/lib/intake/fields";
import { markClockIds } from "@/lib/intake/marks";
import { FieldInput } from "./IntakeChanges";
import { CheckIcon, EditIcon } from "./icons";
import { isError, postJson } from "./intake-api";
import { CHECK, INPUT, INPUT_IN } from "./intake-ui";
import { StateText } from "./parts";

/** 欄の名前と入力を並べる段（読む側の行と同じ幅） */
const ROW = "grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2";
/** 同じ段で、右が高い物（位置の地図）。欄の名前は上に揃える */
const ROW_TOP = "grid grid-cols-[4.5rem_minmax(0,1fr)] items-start gap-x-2";
const SUB = "text-xs text-muted";
/**
 * 連絡先の行（2 列、@container）の電話・携帯: 行が狭い（スマホの幅）ときは 1 段を使う。
 * 欄の名前を枠の中に出すので、半分の幅では電話番号の最後の字が切れる（T145）
 */
const WIDE_NARROW = "col-span-2 @[21rem]:col-span-1";

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
  // 今直している組（入力の欄に入った組か、目次で飛んだ組）。開き直すと無し
  const [active, setActive] = useState<string | null>(null);
  // 保存して閉じた（次に開くまで面の頭に「保存済」。T166）
  const [saved, setSaved] = useState(false);
  const changes = open ? editChanges(section, open.base, open.draft) : [];
  // 同じ緊急・支援の順を 2 人に付けたら保存しない（サーバーも断る）
  const clashed = open !== null && section === "people" && (() => {
    const c = orderClash(open.draft);
    return c.emergency.length > 0 || c.supporter.length > 0;
  })();
  // 「その他」の中身が空（続柄・名前）。種類だけでは何か分からないので保存しない（T57）。住所の片方だけ（T68）も
  const blockers = open ? editBlockers(section, open.draft, open.base) : [];
  // 本人の電話が 2 つ（T68。1 人 1 つ。サーバーも断る）
  const twice = open !== null && section === "people" && selfTwice(open.draft);
  const stopped = clashed || twice || blockers.length > 0;
  const set = (patch: Partial<EditDraft>) => setOpen((o) => (o ? { ...o, draft: { ...o.draft, ...patch } } : o));

  async function save() {
    if (!open || changes.length === 0 || stopped) return;
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
    setSaved(true);
    router.refresh();
  }

  return (
    <div data-edit={section} data-editing={open ? "" : undefined}>
      <div className="flex items-baseline gap-2">
        {head}
        {!open && saved && (
          <span role="status" className="text-xs font-bold" data-edit-saved={section}>
            {INTAKE_LABELS.saved}
          </span>
        )}
        {!open && (
          <Button
            size="sm"
            icon={EditIcon}
            className="ml-auto self-center"
            data-edit-open={section}
            onClick={() => {
              setError(null);
              setActive(null);
              setSaved(false);
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
        // 面の下を面の中の灰色に（組の白い箱との地の色の差で区切る）。左右と下は面の余白（components/person/PersonView.tsx の
        // SectionPanel の px-3 py-2.5）の分だけ外へ出して、面の端まで灰色にする
        <form
          className="-mx-3 mt-1.5 -mb-2.5 space-y-1.5 rounded-b-lg bg-panel2 p-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <SectionForm section={section} data={open.base} draft={open.draft} set={set} active={active} onActive={setActive} />
          <div className="sticky bottom-0 z-10 -mx-1.5 -mb-1.5 flex flex-wrap items-center gap-2 rounded-b-lg bg-panel2 px-2.5 py-1.5" data-edit-bar={section}>
            <Button type="submit" kind="main" size="sm" icon={SaveIcon} disabled={busy || changes.length === 0 || stopped} data-edit-save={section}>
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
              ) : blockers.length > 0 ? (
                <span className="font-bold text-danger" data-edit-blocked>
                  {INTAKE_LABELS.missing} {blockers.join("・")}
                </span>
              ) : (
                <span className="text-muted" data-edit-count>
                  {INTAKE_LABELS.changeCount} {changes.length} 件
                </span>
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

type FormProps = {
  section: EditSection;
  data: EditData;
  draft: EditDraft;
  set: (patch: Partial<EditDraft>) => void;
  /** 今直している組の id（見出しを強く・目次の印）。無ければ印なし */
  active?: string | null;
  /** 入力の欄に入ったとき・目次で飛んだときに、その組の id */
  onActive?: (id: string) => void;
};

/** 目次を出す組の数（これより少ない区分は目次なし） */
const NAV_MIN_GROUPS = 3;

/** 面の入力欄。区分の中を組（lib/intake/fields.ts の FIELD_GROUPS）に分け、組の並びと組の中の並びは組の表のとおり */
export function SectionForm({ section, data, draft, set, active = null, onActive }: FormProps) {
  const clash = orderClash(draft);
  // 印の時計（機器・薬・認知症から作る物）は時計だけでは外せない（次の保存で作り直される。T57）
  const marks = markClockIds(data.ledger, data.clocks);
  // 項目の鍵ごとの入力（欄の表の欄と、表の外の項目）。組はこれを鍵の順に並べる。鍵に入力が無い組（読む側だけの組）は出さない
  const items = new Map<string, ReactNode>();
  for (const f of INTAKE_FIELDS.filter((x) => x.section === section)) {
    items.set(
      f.key,
      <label className={ROW} data-field={f.key}>
        <span className={SUB}>{f.label}</span>
        <FieldInput field={f} value={draft.values[f.key]} onPanel onChange={(v) => set({ values: { ...draft.values, [f.key]: v } })} />
      </label>,
    );
  }
  // 関係者の組の連絡先の行（組ごと）
  const contactsOf = new Map<string, ReactNode[]>();

  switch (section) {
    case "medical":
      items.set(
        "medical.medications",
        <div className="space-y-2">
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
          <Button kind="add" size="sm" icon={AddIcon} onClick={() => set({ newMeds: [...draft.newMeds, blankMed()] })}>
            {INTAKE_LABELS.addMedication}
          </Button>
        </div>,
      );
      items.set(
        "medical.devices",
        <div className="space-y-1">
          {draft.devices.map((d, i) =>
            draft.drops.includes(dropKey.device(d.kind)) ? (
              <DroppedRow key={d.kind} name={DEVICE_LABELS[d.kind]} onUndo={() => set({ drops: toggled(draft.drops, dropKey.device(d.kind)) })} />
            ) : (
              <div key={d.kind} className={ROW} data-device={d.kind}>
                <span className={SUB}>{DEVICE_LABELS[d.kind]}</span>
                <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto] gap-1">
                  <LabeledInput
                    box={INPUT}
                    label={d.kind === "other" ? INTAKE_LABELS.deviceName : "中身"}
                    aria-label={`${DEVICE_LABELS[d.kind]} ${d.kind === "other" ? INTAKE_LABELS.deviceName : "中身"}`}
                    value={d.detail}
                    onChange={(e) => set({ devices: draft.devices.map((x, j) => (j === i ? { ...x, detail: e.target.value } : x)) })}
                  />
                  <LabeledInput
                    box={INPUT}
                    label="回数"
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
          {/* その他の機器は名前を書いてから保存（空なら保存を止める） */}
          {draft.newDevices.includes("other") && (
            <label className={ROW} data-new-device-other>
              <span className={SUB}>{`${DEVICE_LABELS.other} ${INTAKE_LABELS.deviceName}`}</span>
              <input className={INPUT} maxLength={200} value={draft.newDeviceDetail} onChange={(e) => set({ newDeviceDetail: e.target.value })} />
            </label>
          )}
        </div>,
      );
      items.set(
        "clocks",
        <div className="space-y-2">
          {draft.clocks.length === 0 && <span className={SUB}>なし</span>}
          {draft.clocks.map((k, i) => {
            const cur = data.clocks.find((c) => c.id === k.id);
            const check = draft.checks[k.id];
            const seen = draft.seen.includes(k.id);
            // 値を直したら確認の日付は直しの方で今になる。値確認は値が同じで、値の入った時計だけ
            const valueSame = cur?.value != null && String(cur.value) === k.value.trim() && cur.unit === k.unit;
            const dropKeyOf = dropKey.clock(k.id);
            if (draft.drops.includes(dropKeyOf)) {
              return <DroppedRow key={k.id} name={k.label} onUndo={() => set({ drops: toggled(draft.drops, dropKeyOf) })} />;
            }
            return (
              <div key={k.id} className="space-y-1" data-clock={k.id}>
                {/* 時計の名前（「酸素 予備ボンベ」）・値・単位の 1 段。名前が長ければ名前の列の中で折り返す */}
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] items-center gap-1">
                  <span className="text-xs font-bold">{k.label}</span>
                  <div className="contents">
                    <input
                      className={`${INPUT} tabular-nums`}
                      inputMode="decimal"
                      aria-label={`${k.label} 値`}
                      value={k.value}
                      onChange={(e) => set({ clocks: draft.clocks.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                    />
                    <Select
                      className={INPUT}
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
                {/* 起点（停電・発災）と、印でない時計の「外す」（印の時計は機器・薬を外すと一緒に消える。T57） */}
                <div className={ROW} data-clock-start={k.id}>
                  <span className={SUB}>{INTAKE_LABELS.clockStart}</span>
                  <div className="flex items-center gap-1">
                    <StartSelect
                      label={k.label}
                      value={k.start}
                      onChange={(v) => set({ clocks: draft.clocks.map((x, j) => (j === i ? { ...x, start: v } : x)) })}
                    />
                    {!marks.has(k.id) && <DropButton onClick={() => set({ drops: toggled(draft.drops, dropKeyOf) })} name={k.label} />}
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
          {draft.newClocks.map((k, i) => (
            <NewClockRow
              key={`new-${i}`}
              clock={k}
              onChange={(next) => set({ newClocks: draft.newClocks.map((x, j) => (j === i ? next : x)) })}
              onDrop={() => set({ newClocks: draft.newClocks.filter((_, j) => j !== i) })}
            />
          ))}
          <Button kind="add" size="sm" icon={AddIcon} onClick={() => set({ newClocks: [...draft.newClocks, blankClock()] })} data-clock-add>
            {INTAKE_LABELS.addClock}
          </Button>
        </div>,
      );
      break;
    case "evacuation":
      items.set(
        "evacuation.hazards",
        <div className="space-y-1">
          {draft.hazards.map((h, i) =>
            draft.drops.includes(dropKey.hazard(h.kind)) ? (
              <DroppedRow key={h.kind} name={HAZARD_LABELS[h.kind]} onUndo={() => set({ drops: toggled(draft.drops, dropKey.hazard(h.kind)) })} />
            ) : (
              <div key={h.kind} className={ROW} data-hazard={h.kind}>
                <span className={SUB}>{HAZARD_LABELS[h.kind]}</span>
                <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-1">
                  <LabeledInput
                    box={INPUT}
                    label="深さ"
                    suffix="m"
                    inputMode="decimal"
                    aria-label={`${HAZARD_LABELS[h.kind]} 深さ`}
                    value={h.depth}
                    onChange={(e) => set({ hazards: draft.hazards.map((x, j) => (j === i ? { ...x, depth: e.target.value } : x)) })}
                  />
                  {/* 書き足し（その他の中身・裏山など。60 字。T57） */}
                  <LabeledInput
                    box={INPUT}
                    label={INTAKE_LABELS.hazardNote}
                    maxLength={60}
                    aria-label={`${HAZARD_LABELS[h.kind]} ${INTAKE_LABELS.hazardNote}`}
                    value={h.note}
                    onChange={(e) => set({ hazards: draft.hazards.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })}
                  />
                  <DropButton onClick={() => set({ drops: toggled(draft.drops, dropKey.hazard(h.kind)) })} name={HAZARD_LABELS[h.kind]} />
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
          {draft.newHazards.includes("other") && (
            <label className={ROW} data-new-hazard-other>
              <span className={SUB}>{`${HAZARD_LABELS.other} ${INTAKE_LABELS.hazardNote}`}</span>
              <input className={INPUT} maxLength={60} value={draft.newHazardNote} onChange={(e) => set({ newHazardNote: e.target.value })} />
            </label>
          )}
        </div>,
      );
      break;
    case "people": {
      // 連絡先は種類の組へ（lib/intake/fields.ts の contactKinds）。どの組にも無い種類は最後の種類の多い組（関係先）へ。並びは台帳の並び
      const contactGroups = groupsOf("people").filter((g) => g.contactKinds);
      const fallback = [...contactGroups].reverse().find((g) => (g.contactKinds?.length ?? 0) > 1) ?? contactGroups[contactGroups.length - 1];
      const groupOf = (kind: ContactKind) => contactGroups.find((g) => g.contactKinds!.includes(kind)) ?? fallback;
      const push = (g: FieldGroup, node: ReactNode) => contactsOf.set(g.id, [...(contactsOf.get(g.id) ?? []), node]);
      draft.contacts.forEach((c, i) => {
        const group = groupOf(c.kind);
        const key = c.id ? dropKey.contact(c.id) : null;
        const cur = data.contacts.find((x) => x.id === c.id);
        const dropped = key && draft.drops.includes(key) ? key : null;
        if (dropped) {
          push(
            group,
            <DroppedRow
              key={c.id ?? i}
              name={c.kind === "self" ? CONTACT_KIND_LABELS.self : `${CONTACT_KIND_LABELS[c.kind]} ${cur?.relation || cur?.name || ""}`.trim()}
              onUndo={() => set({ drops: toggled(draft.drops, dropped) })}
            />,
          );
          return;
        }
        // 本人の電話（T68）は電話と備考だけ。外すのはほかの連絡先と同じ
        if (c.kind === "self") {
          push(
            group,
            <SelfRow
              key={c.id ?? i}
              c={c}
              onChange={(next) => set({ contacts: draft.contacts.map((x, j) => (j === i ? next : x)) })}
              onDrop={key ? () => set({ drops: toggled(draft.drops, key) }) : undefined}
            />,
          );
          return;
        }
        push(
          group,
          <ContactRow
            key={c.id ?? i}
            c={c}
            group={group}
            clash={clash}
            onChange={(next) => set({ contacts: draft.contacts.map((x, j) => (j === i ? next : x)) })}
            onDrop={key ? () => set({ drops: toggled(draft.drops, key) }) : undefined}
          />,
        );
      });
      // 足す行は種類の組に（組の「連絡先追加」がその組の種類で始めるので、選び直しても組の中の種類のまま）
      draft.newContacts.forEach((c, i) => {
        const group = groupOf(c.kind);
        push(
          group,
          <ContactRow
            key={`new-${i}`}
            c={c}
            isNew
            group={group}
            clash={clash}
            onChange={(next) => set({ newContacts: draft.newContacts.map((x, j) => (j === i ? next : x)) })}
            onDrop={() => set({ newContacts: draft.newContacts.filter((_, j) => j !== i) })}
          />,
        );
      });
      // 組ごとの「連絡先追加」。本人の電話は 1 人 1 つなので、外していない本人がいれば出さない
      const hasSelf =
        draft.contacts.some((c) => c.kind === "self" && !(c.id && draft.drops.includes(dropKey.contact(c.id)))) ||
        draft.newContacts.some((c) => c.kind === "self");
      for (const g of contactGroups) {
        const kind = g.contactKinds![0];
        if (kind === "self" && hasSelf) continue;
        push(
          g,
          <Button
            key="add"
            kind="add"
            size="sm"
            icon={AddIcon}
            aria-label={`${g.label} ${INTAKE_LABELS.addContact}`}
            data-contact-add={kind}
            onClick={() => set({ newContacts: [...draft.newContacts, { ...blankContact(), kind }] })}
          >
            {INTAKE_LABELS.addContact}
          </Button>,
        );
      }
      break;
    }
    case "basic": {
      // 住所（市・町名）と位置（T68）。手入力だけ（AI の分け方には無い）。町名は事業所の今の町名を候補に出して綴りをそろえる
      const townsId = `towns-${data.personId}`;
      const towns = data.place?.towns ?? [];
      items.set(
        "basic.address",
        <div className="space-y-1">
          <label className={ROW} data-field="basic.address.city">
            <span className={SUB}>{PLACE_LABELS.city}</span>
            <input
              className={INPUT}
              maxLength={ADDRESS_MAX.city}
              autoComplete="off"
              value={draft.address.city}
              onChange={(e) => set({ address: { ...draft.address, city: e.target.value } })}
            />
          </label>
          <label className={ROW} data-field="basic.address.town">
            <span className={SUB}>{PLACE_LABELS.town}</span>
            <input
              className={INPUT}
              maxLength={ADDRESS_MAX.town}
              autoComplete="off"
              list={towns.length > 0 ? townsId : undefined}
              value={draft.address.town}
              onChange={(e) => set({ address: { ...draft.address, town: e.target.value } })}
            />
          </label>
          {towns.length > 0 && (
            <datalist id={townsId}>
              {towns.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          )}
        </div>,
      );
      items.set(
        "basic.location",
        <div className={ROW_TOP} data-field="basic.location">
          <span className={`${SUB} pt-1`}>{PLACE_LABELS.location}</span>
          <LocationPick
            value={draft.location}
            onChange={(v) => set({ location: v })}
            center={pickCenter(draft.location, data.place?.center)}
            label={PLACE_LABELS.location}
          />
        </div>,
      );
      items.set(
        "notes",
        <div className="space-y-1">
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
        </div>,
      );
      break;
    }
    case "consent":
      for (const k of CONSENT_KINDS) {
        items.set(
          `consent.${k}`,
          <label className={ROW} data-consent={k}>
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
          </label>,
        );
      }
      break;
  }

  // 組ごとの中身（鍵の順の入力と、関係者の連絡先の行）。中身の無い組は出さない
  const shown = groupsOf(section)
    .map((g) => {
      const nodes = g.keys.flatMap((k) => {
        const node = items.get(k);
        return node === undefined ? [] : [<Fragment key={k}>{node}</Fragment>];
      });
      const contacts = contactsOf.get(g.id) ?? [];
      // 組の欄（地域のみまもり員・支援組織など）を先に、連絡先の行と「連絡先追加」をそのあとに（追加はどの組でも箱の下の端）
      return { g, body: [...nodes, ...contacts] };
    })
    .filter((x) => x.body.length > 0);
  const anchor = (id: string) => `edit-${data.personId}-${id}`;
  const withNav = shown.length >= NAV_MIN_GROUPS;

  return (
    <div
      className="space-y-1.5"
      onFocusCapture={(e: FocusEvent<HTMLDivElement>) => {
        // 入力の欄に入ったら、その組を今の組に（目次のボタン・一覧の窓〔body の直下〕は組の外なので変えない）
        const id = (e.target as HTMLElement).closest<HTMLElement>("[data-group]")?.dataset.group;
        if (id && id !== active) onActive?.(id);
      }}
    >
      {section === "people" && (clash.emergency.length > 0 || clash.supporter.length > 0) && (
        <p role="alert" className="px-1 text-xs font-bold text-danger" data-order-clash>
          {INTAKE_LABELS.orderClash}{" "}
          {[...clash.emergency.map((n) => `${INTAKE_LABELS.emergency} ${n}`), ...clash.supporter.map((n) => `${INTAKE_LABELS.supporter} ${n}`)].join(
            "・",
          )}
        </p>
      )}
      {section === "people" && selfTwice(draft) && (
        <p role="alert" className="px-1 text-xs font-bold text-danger" data-self-twice>
          {INTAKE_LABELS.selfTwice}
        </p>
      )}
      {withNav && (
        <GroupNav
          groups={shown.map((x) => x.g)}
          active={active}
          anchorOf={anchor}
          onJump={(id) => {
            onActive?.(id);
            const box = document.getElementById(anchor(id));
            box?.scrollIntoView({ block: "start", behavior: "smooth" });
            box?.querySelector<HTMLElement>("input:not([type=checkbox]):not([type=radio]):not([type=hidden]),textarea")?.focus({ preventScroll: true });
          }}
        />
      )}
      {shown.map(({ g, body }) => (
        <GroupBox key={g.id} id={anchor(g.id)} group={g} active={g.id === active} nav={withNav}>
          {body}
        </GroupBox>
      ))}
    </div>
  );
}

/**
 * 組の目次（横に並べ、狭い幅では折り返す）。押すとその組へ送る。今の組は本文の色と下線（下地を敷かない）。
 * 面の中の灰色の上に置き、送っても面の上に留める（sticky）
 */
function GroupNav({
  groups,
  active,
  onJump,
  anchorOf,
}: {
  groups: readonly FieldGroup[];
  active: string | null;
  onJump: (id: string) => void;
  anchorOf: (id: string) => string;
}) {
  return (
    <nav aria-label={INTAKE_LABELS.groupNav} className="sticky top-0 z-10 -mx-1.5 bg-panel2 px-1.5 py-0.5" data-group-nav>
      <ul className="flex flex-wrap gap-x-1 gap-y-0.5">
        {groups.map((g) => {
          const on = g.id === active;
          return (
            <li key={g.id}>
              <a
                href={`#${anchorOf(g.id)}`}
                aria-label={`${g.label} ${INTAKE_LABELS.groupMove}`}
                className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${
                  on ? "text-ink underline decoration-accent decoration-2 underline-offset-4" : "text-muted"
                }`}
                aria-current={on || undefined}
                data-press=""
                data-group-link={g.id}
                onClick={(e) => {
                  e.preventDefault();
                  onJump(g.id);
                }}
              >
                {g.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 組の白い箱。見出しは今の組なら本文の色で少し大きく、左に操作の色の細い帯（行の高さは変えない） */
function GroupBox({ id, group, active, nav, children }: { id: string; group: FieldGroup; active: boolean; nav: boolean; children: ReactNode }) {
  const headId = `${id}-head`;
  return (
    <div
      id={id}
      role="group"
      aria-labelledby={headId}
      className={`${nav ? "scroll-mt-9" : "scroll-mt-2"} relative space-y-1.5 rounded bg-panel px-2.5 pt-1.5 pb-2`}
      data-group={group.id}
      data-active={active || undefined}
    >
      {/* 今の組の帯は箱の左の端（見出しの字の位置は変えない） */}
      {active && <span aria-hidden className="absolute top-2 left-0 h-4 w-[3px] rounded-r-sm bg-accent" />}
      <p id={headId} className={`leading-5 font-bold ${active ? "text-[0.8125rem] text-ink" : "text-xs text-muted"}`}>
        {group.label}
      </p>
      {children}
    </div>
  );
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

/**
 * 欄の名前を枠の中の左に出す文字の欄（T145）。下書きの字だけだと、入れたあとに何の欄か（電話か携帯か・続柄か備考か）が見えなくなる。
 * box は INPUT（面の上）か INPUT_IN（面の中の区分の上）。読み上げの名前は今までどおり aria-label
 */
function LabeledInput({
  box,
  label,
  suffix,
  danger = false,
  className = "",
  ...input
}: { box: string; label: string; suffix?: string; danger?: boolean; className?: string } & Omit<ComponentProps<"input">, "className">) {
  const digits = input.inputMode === "tel" || input.inputMode === "decimal" || input.inputMode === "numeric";
  return (
    <label className={`${box} flex items-center gap-1.5 focus-within:outline-2 focus-within:outline-solid focus-within:outline-accent ${className}`}>
      <span className={`shrink-0 text-xs ${danger ? "font-bold text-danger" : "text-muted"}`}>{label}</span>
      <input className={`min-w-0 flex-1 bg-transparent outline-none${digits ? " tabular-nums" : ""}`} {...input} />
      {suffix && <span className="shrink-0 text-xs text-muted">{suffix}</span>}
    </label>
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
      <LabeledInput box={INPUT} label="薬名" aria-label="薬の名前" value={med.name} onChange={(e) => p({ name: e.target.value })} />
      <Select className={INPUT} aria-label="薬の区分" value={med.category} onChange={(e) => p({ category: e.target.value as MedicationCategory })}>
        {MEDICATION_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {MEDICATION_CATEGORY_LABELS[c]}
          </option>
        ))}
      </Select>
      <LabeledInput box={INPUT} label="回数" aria-label={`${med.name} 回数`} value={med.schedule} onChange={(e) => p({ schedule: e.target.value })} />
      <LabeledInput
        box={INPUT}
        label={MED_PARTS.amount}
        aria-label={`${med.name} ${MED_PARTS.amount}`}
        value={med.amount}
        onChange={(e) => p({ amount: e.target.value })}
      />
      <div className="col-span-2 flex items-center gap-1">
        <LabeledInput
          box={INPUT}
          className="min-w-0 flex-1"
          label={MED_PARTS.storage}
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

/**
 * 連絡先の行。group はその行の組（lib/intake/fields.ts の contactKinds を持つ組）。
 * 組の見出しが種類と同じ（家族・支援者）なら行の頭に種類を重ねて出さない。種類が 2 つ以上の組（関係先）と、
 * 見出しが種類と違う組（地域 → 民生委員）は行の頭に種類。足す行で種類を選べるのは種類が 2 つ以上の組だけで、選べるのはその組の種類（選び直しても組は変わらない）
 */
function ContactRow({
  c,
  isNew = false,
  group,
  clash,
  onChange,
  onDrop,
}: {
  c: ContactDraft;
  isNew?: boolean;
  group: FieldGroup;
  /** 重なった順（赤の太字） */
  clash: OrderClash;
  onChange: (c: ContactDraft) => void;
  onDrop?: () => void;
}) {
  const p = (patch: Partial<ContactDraft>) => onChange({ ...c, ...patch });
  const who = c.name || c.relation || CONTACT_KIND_LABELS[c.kind];
  const kinds = group.contactKinds ?? [];
  const showKind = kinds.length > 1 || !kinds.includes(c.kind) || group.label !== CONTACT_KIND_LABELS[c.kind];
  return (
    <div className="@container grid grid-cols-2 gap-1 rounded bg-panel2 p-1.5" data-contact={c.id ?? "new"}>
      {showKind &&
        (isNew && kinds.length > 1 ? (
          <Select className={INPUT_IN} aria-label="連絡先の種類" value={c.kind} onChange={(e) => p({ kind: e.target.value as ContactKind })}>
            {(kinds.includes(c.kind) ? kinds : [c.kind, ...kinds]).map((k) => (
              <option key={k} value={k}>
                {CONTACT_KIND_LABELS[k] ?? k}
              </option>
            ))}
          </Select>
        ) : (
          <span className="self-center px-0.5 text-xs font-bold">{CONTACT_KIND_LABELS[c.kind] ?? c.kind}</span>
        ))}
      {/* 本人の行は電話の欄（電話と備考）だけ（T68） */}
      {c.kind === "self" ? <SelfFields c={c} p={p} onDrop={onDrop} /> : <OtherFields c={c} p={p} who={who} clash={clash} onDrop={onDrop} shifted={showKind} />}
    </div>
  );
}

/** 本人の電話の行（T68）。電話と備考（固定電話・携帯）だけ。「外す」はほかの連絡先と同じ（外すと訓練の本人電話は番号なし） */
function SelfRow({ c, onChange, onDrop }: { c: ContactDraft; onChange: (c: ContactDraft) => void; onDrop?: () => void }) {
  const p = (patch: Partial<ContactDraft>) => onChange({ ...c, ...patch });
  return (
    <div className="@container grid grid-cols-2 gap-1 rounded bg-panel2 p-1.5" data-contact={c.id ?? "new"} data-contact-self>
      <SelfFields c={c} p={p} onDrop={onDrop} />
    </div>
  );
}

function SelfFields({ c, p, onDrop }: { c: ContactDraft; p: (patch: Partial<ContactDraft>) => void; onDrop?: () => void }) {
  const who = CONTACT_KIND_LABELS.self;
  return (
    <>
      <LabeledInput box={INPUT_IN} className={WIDE_NARROW} label="電話" inputMode="tel" aria-label={`${who} 電話`} value={c.phone} onChange={(e) => p({ phone: e.target.value })} />
      <div className={`${WIDE_NARROW} flex items-center gap-1`}>
        <LabeledInput box={INPUT_IN} className="min-w-0 flex-1" label="備考" aria-label={`${who} 備考`} value={c.note} onChange={(e) => p({ note: e.target.value })} />
        {onDrop && <DropButton onClick={onDrop} name={who} />}
      </div>
    </>
  );
}

/** 有無の選択（— / あり / なし）。スマホ・車（T68） */
function FlagSelect({ label, who, value, onChange }: { label: string; who: string; value: FlagDraft; onChange: (v: FlagDraft) => void }) {
  return (
    <Select className={INPUT_IN} aria-label={`${who} ${label}`} value={value} onChange={(e) => onChange(e.target.value as FlagDraft)} data-flag={label}>
      <option value="" data-placeholder>
        {label} —
      </option>
      <option value="yes">
        {label} {PLACE_LABELS.yes}
      </option>
      <option value="no">
        {label} {PLACE_LABELS.no}
      </option>
    </Select>
  );
}

function OtherFields({
  c,
  p,
  who,
  clash,
  onDrop,
  shifted = false,
}: {
  c: ContactDraft;
  p: (patch: Partial<ContactDraft>) => void;
  who: string;
  clash: OrderClash;
  onDrop?: () => void;
  /** 行の頭に種類の欄がある（欄が 1 つずれる）。狭い幅で住所の右が空かないよう、住所も 1 段に */
  shifted?: boolean;
}) {
  return (
    <>
      {/* その他は続柄（何の連絡先か）が空なら保存しない（editBlockers）。空のあいだは赤の太字の欄名 */}
      <LabeledInput
        box={INPUT_IN}
        label="続柄"
        danger={c.kind === "other" && c.relation.trim() === ""}
        aria-label={`${who} 続柄`}
        aria-required={c.kind === "other" || undefined}
        value={c.relation}
        onChange={(e) => p({ relation: e.target.value })}
      />
      <LabeledInput box={INPUT_IN} label="名前" aria-label={`${who} 名前`} value={c.name} onChange={(e) => p({ name: e.target.value })} />
      {/* フリガナ・住所（市町村と町名まで）・携帯（T117）。計画書の近親者・実施者の欄の元 */}
      <LabeledInput
        box={INPUT_IN}
        label={CONTACT_PART_LABELS.kana}
        maxLength={40}
        aria-label={`${who} ${CONTACT_PART_LABELS.kana}`}
        value={c.kana ?? ""}
        onChange={(e) => p({ kana: e.target.value })}
        data-contact-part="kana"
      />
      <LabeledInput
        box={INPUT_IN}
        className={shifted ? WIDE_NARROW : ""}
        label={CONTACT_PART_LABELS.address}
        maxLength={60}
        aria-label={`${who} ${CONTACT_PART_LABELS.address}`}
        value={c.address ?? ""}
        onChange={(e) => p({ address: e.target.value })}
        data-contact-part="address"
      />
      <LabeledInput box={INPUT_IN} className={WIDE_NARROW} label="電話" inputMode="tel" aria-label={`${who} 電話`} value={c.phone} onChange={(e) => p({ phone: e.target.value })} />
      <LabeledInput
        box={INPUT_IN}
        className={WIDE_NARROW}
        label={CONTACT_PART_LABELS.mobile}
        inputMode="tel"
        aria-label={`${who} ${CONTACT_PART_LABELS.mobile}`}
        value={c.mobile ?? ""}
        onChange={(e) => p({ mobile: e.target.value })}
        data-contact-part="mobile"
      />
      <Select className={INPUT_IN} aria-label={`${who} 夜間`} value={c.night} onChange={(e) => p({ night: e.target.value as NightDraft })}>
        {NIGHT.map((n) => (
          <option key={n.value} value={n.value} data-placeholder={n.value === "" || undefined}>
            {n.label}
          </option>
        ))}
      </Select>
      <Select className={INPUT_IN} aria-label={`${who} ${INTAKE_LABELS.reach}`} value={c.reach} onChange={(e) => p({ reach: e.target.value as ContactDraft["reach"] })} data-reach>
        <option value="" data-placeholder>
          {INTAKE_LABELS.reach} —
        </option>
        {/* 字は「距離 市内」（夜間・緊急・支援・スマホ・車の選択と同じ形。選んだあとも何の欄か見える） */}
        {CONTACT_REACHES.map((r) => (
          <option key={r} value={r}>
            {INTAKE_LABELS.reach} {CONTACT_REACH_LABELS[r]}
          </option>
        ))}
      </Select>
      {/* 緊急連絡先の順・支援者の順（人が決める。ルールの表は支援の順のある人を「支援者」と数える） */}
      <OrderSelect label={INTAKE_LABELS.emergency} who={who} value={c.emergency} clash={clash.emergency} onChange={(v) => p({ emergency: v })} />
      <OrderSelect label={INTAKE_LABELS.supporter} who={who} value={c.supporter} clash={clash.supporter} onChange={(v) => p({ supporter: v })} />
      {/* スマホ・車の有無（T68）。スマホ ありの家族・支援者は訓練の押せる人になる */}
      <FlagSelect label={PLACE_LABELS.smartphone} who={who} value={c.smartphone ?? ""} onChange={(v) => p({ smartphone: v })} />
      <FlagSelect label={PLACE_LABELS.car} who={who} value={c.car ?? ""} onChange={(v) => p({ car: v })} />
      <div className="col-span-2 flex items-center gap-1">
        <LabeledInput box={INPUT_IN} className="min-w-0 flex-1" label="備考" aria-label={`${who} 備考`} value={c.note} onChange={(e) => p({ note: e.target.value })} />
        {onDrop && <DropButton onClick={onDrop} name={who} />}
      </div>
    </>
  );
}

/** 時計の起点（停電・発災）。走らない状態の時計には出さない */
function StartSelect({ label, value, onChange }: { label: string; value: RunningStart; onChange: (v: RunningStart) => void }) {
  return (
    <Select className={`${INPUT} w-24`} aria-label={`${label} ${INTAKE_LABELS.clockStart}`} value={value} onChange={(e) => onChange(e.target.value as RunningStart)}>
      {(["outage", "disaster"] as const).map((s) => (
        <option key={s} value={s}>
          {CLOCK_START_LABELS[s]}
        </option>
      ))}
    </Select>
  );
}

const UNITS = ["minute", "hour", "day", "week"] as const;
const ADDABLE_KINDS = ["device", "supply", "medication"] as const;

/** 手で足す時計の行（T57）: 名前・区分・対象・値と単位（空は未確認）・起点・出典と書き足し。「外す」で下書きから消す */
function NewClockRow({ clock: k, onChange, onDrop }: { clock: ClockDraft; onChange: (k: ClockDraft) => void; onDrop: () => void }) {
  const p = (patch: Partial<ClockDraft>) => onChange({ ...k, ...patch });
  const name = k.label.trim() || INTAKE_LABELS.addClock;
  return (
    <div className="grid grid-cols-2 gap-1 rounded bg-panel2 p-1.5" data-clock="new">
      <LabeledInput
        box={INPUT_IN}
        className="col-span-2"
        label={INTAKE_LABELS.clockName}
        maxLength={100}
        aria-label={`${INTAKE_LABELS.addClock} ${INTAKE_LABELS.clockName}`}
        value={k.label}
        onChange={(e) => p({ label: e.target.value })}
      />
      <Select className={INPUT_IN} aria-label={`${name} ${INTAKE_LABELS.clockKind}`} value={k.kind} onChange={(e) => p({ kind: e.target.value as ClockDraft["kind"] })}>
        {ADDABLE_KINDS.map((x) => (
          <option key={x} value={x}>
            {CLOCK_KIND_LABELS[x]}
          </option>
        ))}
      </Select>
      <Select className={INPUT_IN} aria-label={`${name} ${INTAKE_LABELS.clockCategory}`} value={k.category} onChange={(e) => p({ category: e.target.value as ClockDraft["category"] })}>
        {ADDABLE_CLOCK_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CLOCK_CATEGORY_LABELS[c]}
          </option>
        ))}
      </Select>
      <LabeledInput
        box={INPUT_IN}
        label="値"
        inputMode="decimal"
        placeholder="未確認"
        aria-label={`${name} 値`}
        value={k.value}
        onChange={(e) => p({ value: e.target.value })}
      />
      <Select className={INPUT_IN} aria-label={`${name} 単位`} value={k.unit} onChange={(e) => p({ unit: e.target.value as ClockDraft["unit"] })}>
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {CLOCK_UNIT_LABELS[u]}
          </option>
        ))}
      </Select>
      <Select className={INPUT_IN} aria-label={`${name} ${INTAKE_LABELS.clockStart}`} value={k.start} onChange={(e) => p({ start: e.target.value as RunningStart })}>
        {(["outage", "disaster"] as const).map((s) => (
          <option key={s} value={s}>
            {INTAKE_LABELS.clockStart} {CLOCK_START_LABELS[s]}
          </option>
        ))}
      </Select>
      <Select className={INPUT_IN} aria-label={`${name} ${INTAKE_LABELS.clockSource}`} value={k.source} onChange={(e) => p({ source: e.target.value as ClockDraft["source"] })}>
        <option value="" data-placeholder>
          {INTAKE_LABELS.clockSource} —
        </option>
        {CLOCK_SOURCES.map((s) => (
          <option key={s} value={s}>
            {CLOCK_SOURCE_LABELS[s]}
          </option>
        ))}
      </Select>
      <div className="col-span-2 flex items-center gap-1">
        <LabeledInput
          box={INPUT_IN}
          className="min-w-0 flex-1"
          label={INTAKE_LABELS.clockSourceNote}
          maxLength={100}
          aria-label={`${name} ${INTAKE_LABELS.clockSourceNote}`}
          value={k.sourceNote}
          onChange={(e) => p({ sourceNote: e.target.value })}
        />
        <DropButton onClick={onDrop} name={name} />
      </div>
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
      <option value="" data-placeholder>
        {label} —
      </option>
      {orders.map((n) => (
        <option key={n} value={String(n)}>
          {label} {n}
        </option>
      ))}
    </Select>
  );
}
