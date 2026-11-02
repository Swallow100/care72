// 医療要約の紙面（A4 縦 1 枚）。欄の名前と順は lib/forms/medical-summary.ts の MEDICAL_FIELDS（災害診療記録 2018 の 1 頁の順）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 大事な欄（禁忌事項・特記事項（常用薬等）のチェック・常用薬と中断注意・透析・在宅酸素・メディカル ID）は太い枠と大きい文字。
// 「なぜこの行があるか」と出典は紙に出さない（画面の脇の MedicalSummaryBasis だけ）。
// 見た目は components/forms/paper.css と medical-paper.css（読み込むのはページの側。テストでは読まない）。

import type { CSSProperties, ReactNode } from "react";
import {
  MEDICAL_ID_PART_LABELS,
  medicalField,
  type MedicalKey,
  type MedicalSummary,
} from "@/lib/forms/medical-summary";
import { formatJst } from "@/lib/person";
import { CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS, DOCUMENT_LABELS, PENDING_STATUS_LABELS } from "@/lib/labels";
import { FormCell } from "./FormCell";

type Size = "sm" | "lg" | "xl";

function F({
  s,
  k,
  label,
  size,
  style,
  bare,
}: {
  s: MedicalSummary;
  k: MedicalKey;
  label?: string;
  size?: Size;
  style?: CSSProperties;
  /** 選ぶ欄の □ の名前が欄の名前と同じときは、欄の名前を出さない */
  bare?: boolean;
}) {
  return (
    <div className={size} data-field={k} style={style}>
      {!bare && <span className="f-l">{label ?? medicalField(k).label}</span>}
      <span className="f-v">
        <FormCell cell={s.cells[k]} />
      </span>
    </div>
  );
}

const cols = (template: string): CSSProperties => ({ gridTemplateColumns: template });
const span = (n: number): CSSProperties => ({ gridColumn: `span ${n}` });

/** 「2026 年 11 月 2 日」 */
function dateText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}

/** 常用薬の表（薬ごとに 回数・用量・残り・保管・中断注意） */
function MedicationTable({ s }: { s: MedicalSummary }) {
  if (s.medications.length === 0) {
    return <F s={s} k="meds.list" size="lg" />;
  }
  return (
    <div data-field="meds.list">
      <table className="med-table">
        <thead>
          <tr>
            <th>薬</th>
            <th>回数</th>
            <th>用量</th>
            <th>残り</th>
            <th>保管</th>
            <th>印</th>
          </tr>
        </thead>
        <tbody>
          {s.medications.map((m, i) => (
            <tr key={i} data-medication={m.name} data-mark={m.mark ? (m.mark.tier ?? "ledger") : undefined}>
              <td className="med-name">
                <span className="p-strong">{m.name}</span>
                {m.categoryLabel && <span className="p-sub"> {m.categoryLabel}</span>}
              </td>
              <td>
                <FormCell cell={m.schedule} />
              </td>
              <td>
                <FormCell cell={m.amount} />
              </td>
              <td className="med-remaining">
                <FormCell cell={m.remaining} />
              </td>
              <td>
                <FormCell cell={m.storage} />
              </td>
              <td className="med-mark">{m.mark ? m.mark.label : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** メディカル ID の枠（西暦生年月日 8 桁・M か F・カナ 7 字）。様式の枠に 1 字ずつ写せる形 */
function MedicalIdBoxes({ s }: { s: MedicalSummary }) {
  const id = s.medicalId;
  const digits = Array.from({ length: 8 }, (_, i) => id.birth8?.[i] ?? "");
  const kana = Array.from(id.kana7 ?? "");
  const kanaBoxes = Array.from({ length: 7 }, (_, i) => kana[i] ?? "");
  return (
    <div className="mid" data-field="id.medical" data-medical-id={id.id ?? ""}>
      <div className="mid-row" aria-hidden="true">
        <span className="mid-group">
          {digits.map((d, i) => (
            <span key={i} className="mid-box">
              {d}
            </span>
          ))}
        </span>
        <span className="mid-sex">
          <span className={id.sex === "M" ? "on" : undefined}>M</span>
          <span className={id.sex === "F" ? "on" : undefined}>F</span>
        </span>
        <span className="mid-group">
          {kanaBoxes.map((c, i) => (
            <span key={i} className="mid-box">
              {c}
            </span>
          ))}
        </span>
      </div>
      <div className="mid-text">
        <FormCell cell={s.cells["id.medical"]} />
        <span className="f-l">
          {MEDICAL_ID_PART_LABELS.birth}（西暦 8 桁）＋{MEDICAL_ID_PART_LABELS.sex}＋{MEDICAL_ID_PART_LABELS.kana}（上から 7 字）
        </span>
      </div>
    </div>
  );
}

/** 医療要約の紙面（A4 縦 1 枚の束）。画面 /people/[id]/forms/medical */
export function MedicalSummarySheet({ sheet: s }: { sheet: MedicalSummary }) {
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-sheet="medical" data-person={s.personId}>
        <MedicalSummaryPaper sheet={s} />
      </div>
    </div>
  );
}

/**
 * 医療要約の A4 の 1 頁（束に入れる前の section）。本人の 1 枚（T06）の裏もこれをそのまま使う。
 * page は束の中の何頁目か、aside は題名の段の右に置く物（本人の 1 枚の QR の枠）
 */
export function MedicalSummaryPaper({ sheet: s, page = 1, aside }: { sheet: MedicalSummary; page?: 1 | 2; aside?: ReactNode }) {
  const author = [s.author.office, s.author.careManager ? `${s.author.careManager}（ケアマネ）` : ""].filter(Boolean).join(" ");
  const consentAt = s.consent.recordedAt ? formatJst(s.consent.recordedAt).slice(0, 10) : null;
  return (
        <section className="paper med-paper" aria-label={DOCUMENT_LABELS.medical} data-page={page}>
          <div className="head-row">
            <h1 className="title">{DOCUMENT_LABELS.medical}</h1>
            <div className="top-col">
              <span className="nowrap">
                災害診療記録2018 基本情報の順・台帳 {formatJst(s.ledgerAt)} 時点
              </span>
              <span className="nowrap">
                作成 {dateText(s.today)}
                {author && ` ${author}`}・
                <span data-consent={s.consent.status}>
                  {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS[s.consent.status]}
                  {consentAt && ` 記録 ${consentAt}`}
                  {s.consent.recordedBy && ` ${s.consent.recordedBy}`}
                </span>
              </span>
            </div>
            {aside}
          </div>

          <div className="blk" data-block="patient">
            <div className="grid" style={cols("1.5fr 1.2fr 1.7fr 0.6fr")}>
              <F s={s} k="patient.kana" size="xl" />
              <F s={s} k="patient.name" size="lg" />
              <F s={s} k="patient.birth" size="lg" />
              <F s={s} k="patient.sex" />
            </div>
            <div className="grid" style={cols("0.95fr 0.85fr 1.1fr 1.3fr")}>
              <F s={s} k="patient.phone" />
              <F s={s} k="patient.address" />
              <F s={s} k="patient.house" label="状態（家）" />
              <F s={s} k="patient.dwelling" size="sm" />
            </div>
            <div className="grid" style={cols("1fr 1fr")} data-block="shelter">
              <F s={s} k="shelter.first" size="lg" />
              <F s={s} k="shelter.second" size="lg" />
            </div>
          </div>

          <div className="blk" data-block="contact">
            <div className="grid" style={cols("1fr 1fr")}>
              <F s={s} k="contact.kinds" />
              <F s={s} k="contact.others" size="sm" />
              <F s={s} k="contact.people" style={span(2)} />
            </div>
          </div>

          <div className="blk key" data-block="contra">
            <div className="blk-h">【禁忌事項等】</div>
            <div className="grid" style={cols("1.6fr 1fr")}>
              <F s={s} k="contra.allergy" size="lg" />
              <F s={s} k="contra.food" size="lg" />
            </div>
          </div>

          <div className="blk key" data-block="special">
            <div className="blk-h">【特記事項（常用薬等）】</div>
            <div className="grid chk" style={cols("1fr 1fr")}>
              <F s={s} k="drug.antiplatelet" size="lg" bare />
              <F s={s} k="drug.anticoagulant" size="lg" bare />
              <F s={s} k="drug.diabetes" size="lg" bare />
              <F s={s} k="drug.steroid" size="lg" bare />
              <F s={s} k="drug.antiepileptic" size="lg" bare />
              <F s={s} k="drug.other" size="lg" bare />
              <F s={s} k="drug.dialysis" size="lg" style={span(2)} bare />
              <F s={s} k="drug.hot" size="lg" style={span(2)} bare />
              <F s={s} k="drug.devices" size="lg" style={span(2)} />
            </div>
          </div>

          <div className="blk key" data-block="meds">
            <div className="blk-h">常用薬</div>
            <MedicationTable s={s} />
            <div className="grid" style={cols("1fr 1fr")}>
              <F s={s} k="meds.carry" />
              <F s={s} k="meds.notes" />
            </div>
          </div>

          <div className="blk" data-block="care">
            <div className="grid" style={cols("1fr")}>
              <F s={s} k="care.vulnerable" bare />
              <F s={s} k="care.protect" label="【要保護者】" />
            </div>
          </div>

          <div className="blk" data-block="history">
            <div className="grid" style={cols("1fr 1fr")}>
              <F s={s} k="history.disease" />
              <F s={s} k="history.vaccination" />
            </div>
          </div>

          <div className="blk key" data-block="id">
            <div className="blk-h">メディカル ID</div>
            <MedicalIdBoxes s={s} />
          </div>

          {s.pending.length > 0 && (
            <div className="blk" data-block="pending">
              <div className="grid" style={cols("1fr")}>
                <div className="sm" data-pending-list={s.pending.length}>
                  <span className="f-l">未確認（台帳）</span>
                  <span className="f-v ln">
                    {s.pending.map((p) => (
                      <span key={p.field} className="p-unc-r" data-pending={p.status}>
                        {p.label}（{PENDING_STATUS_LABELS[p.status]}）
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="foot small-note">
            <span>欄の順は 災害診療記録2018（一般診療版）による。既往症・予防接種は様式の 2 頁</span>
          </div>
        </section>
  );
}
