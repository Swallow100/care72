// QR の頁の要約（医療班がスマホで読む）。欄は医療要約の紙面と同じ順（災害診療記録 2018 の 1 頁の順）で、大きめの字。
// 氏名の全部と住所は lib/qr/view.ts で値ごと除いてある（ここには来ない）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 見た目の言葉の部品は components/qr/qr-view.css（読み込むのはページの側。テストでは読まない）。

import { FormCell } from "@/components/forms/FormCell";
import { StateTag } from "@/components/person/parts";
import { MEDICAL_ID_PART_LABELS, type MedicationRow } from "@/lib/forms/medical-summary";
import { BLANK_LABELS, CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS, DOCUMENT_LABELS, PENDING_STATUS_LABELS } from "@/lib/labels";
import { formatJst } from "@/lib/person";
import { QR_LABELS } from "@/lib/qr/labels";
import type { QrField, QrKey, QrSheet } from "@/lib/qr/view";

/** 選ぶ欄の □ の名前が欄の名前と同じ欄は、欄の名前を出さない（紙面と同じ） */
const BARE: ReadonlySet<QrKey> = new Set<QrKey>([
  "drug.antiplatelet",
  "drug.anticoagulant",
  "drug.diabetes",
  "drug.steroid",
  "drug.antiepileptic",
  "drug.other",
  "drug.dialysis",
  "drug.hot",
  "care.vulnerable",
]);

/** 大きく出す欄（本人を確かめる欄） */
const LARGE: ReadonlySet<QrKey> = new Set<QrKey>(["patient.kana", "patient.birth"]);

function FieldRow({ f }: { f: QrField }) {
  const value = (
    <dd className={LARGE.has(f.key) ? "text-2xl font-bold" : undefined}>
      <FormCell cell={f.cell} />
    </dd>
  );
  if (BARE.has(f.key)) {
    return (
      <div data-field={f.key} className="py-1.5">
        <dt className="sr-only">{f.label}</dt>
        {value}
      </div>
    );
  }
  return (
    <div data-field={f.key} className="py-1.5">
      <dt className="text-sm text-muted">{f.label}</dt>
      {value}
    </div>
  );
}

function MedicationItem({ m }: { m: MedicationRow }) {
  return (
    <li className="rounded bg-panel2 px-3 py-2" data-medication={m.name}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-bold">{m.name}</span>
        {m.categoryLabel && <span className="text-sm text-muted">{m.categoryLabel}</span>}
        {m.mark && <StateTag tone="check">{m.mark.label}</StateTag>}
      </div>
      <dl className="mt-1 grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2">
        <dt className="text-sm text-muted">回数</dt>
        <dd>
          <FormCell cell={m.schedule} />
        </dd>
        <dt className="text-sm text-muted">用量</dt>
        <dd>
          <FormCell cell={m.amount} />
        </dd>
        <dt className="text-sm text-muted">残り</dt>
        <dd>
          <FormCell cell={m.remaining} />
        </dd>
        <dt className="text-sm text-muted">保管</dt>
        <dd>
          <FormCell cell={m.storage} />
        </dd>
      </dl>
    </li>
  );
}

export function QrSummary({ sheet: s, expiresAt }: { sheet: QrSheet; expiresAt: string }) {
  const author = [s.author.office, s.author.careManager ? `${s.author.careManager}（ケアマネ）` : ""].filter(Boolean).join(" ");
  return (
    <div className="space-y-3 text-lg leading-relaxed" data-qr-sheet>
      <header className="px-1">
        <h1 className="text-xl font-bold">{DOCUMENT_LABELS.medical}</h1>
        <div className="flex flex-wrap gap-x-3 text-sm text-muted tabular-nums">
          <span>台帳 {formatJst(s.ledgerAt)} 時点</span>
          <span>
            作成 {s.today}
            {author && ` ${author}`}
          </span>
          <span data-consent="granted">
            {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS.granted}
            {s.consentRecordedAt && ` 記録 ${formatJst(s.consentRecordedAt).slice(0, 10)}`}
          </span>
          <span>
            {QR_LABELS.expires} {formatJst(expiresAt).slice(0, 10)}
          </span>
        </div>
      </header>

      {s.blocks.map((b) => (
        <section key={b.block} className="rounded-lg bg-panel px-4 py-2" data-block={b.block}>
          <h2 className="pt-1 text-sm font-bold text-muted">{b.label}</h2>
          {b.block === "meds" && s.medications.length > 0 && (
            <ul className="mt-1 space-y-1.5" data-field="meds.list">
              {s.medications.map((m, i) => (
                <MedicationItem key={i} m={m} />
              ))}
            </ul>
          )}
          <dl>
            {b.fields
              .filter((f) => !(f.key === "meds.list" && s.medications.length > 0))
              .map((f) =>
                f.key === "id.medical" ? (
                  <div key={f.key} data-field={f.key} data-medical-id={s.medicalId.id ?? ""} className="py-1.5">
                    <dt className="text-sm text-muted">
                      {MEDICAL_ID_PART_LABELS.birth}＋{MEDICAL_ID_PART_LABELS.sex}＋{MEDICAL_ID_PART_LABELS.kana}
                    </dt>
                    <dd className="text-2xl font-bold tabular-nums">
                      <FormCell cell={f.cell} />
                    </dd>
                  </div>
                ) : (
                  <FieldRow key={f.key} f={f} />
                ),
              )}
          </dl>
        </section>
      ))}

      {s.pending.length > 0 && (
        <section className="rounded-lg bg-panel px-4 py-2" data-block="pending" data-pending-list={s.pending.length}>
          <h2 className="pt-1 text-sm font-bold text-muted">
            {BLANK_LABELS.unconfirmed} <span className="tabular-nums">{s.pending.length}</span>
          </h2>
          <ul className="flex flex-wrap gap-x-3 py-1.5">
            {s.pending.map((p) => (
              <li key={p.field} data-pending={p.status}>
                {p.label}（{PENDING_STATUS_LABELS[p.status]}）
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
