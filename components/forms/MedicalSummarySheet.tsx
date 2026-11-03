// 医療要約の紙面（A4 縦 1 枚）。欄の名前と順は lib/forms/medical-summary.ts の MEDICAL_FIELDS（災害診療記録 2018 の 1 頁の順）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 大事な欄（禁忌事項・特記事項（常用薬等）のチェック・常用薬と中断注意・透析・在宅酸素・メディカル ID）は太い枠と大きい文字。
// 字は太くしない（災害診療記録 2018 に太字は無い。T47）。様式に無い欄（住まい・連絡先の人・関係先・機器・常用薬の表・持出品・特記）は
// 様式の欄のあとの「補足」の段にまとめる（様式の欄の中に混ぜない）。
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
import { paperText } from "@/lib/forms/paper-text";
import { FormCell } from "./FormCell";
import { PaperFoot } from "./PaperFoot";

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
  // 範囲の外の欄（医療班・行政の住所・本人の電話。T24）は描かない
  if (s.hidden?.includes(k)) return null;
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

/** 患者の 2 行目（電話・住所・家の状態）の列。描かない欄（T24）の列は詰める */
function patientRow2(s: MedicalSummary): string {
  const widths: Array<[MedicalKey, string]> = [
    ["patient.phone", "1fr"],
    ["patient.address", "1.2fr"],
    ["patient.house", "1fr"],
  ];
  return widths
    .filter(([k]) => !s.hidden?.includes(k))
    .map(([, w]) => w)
    .join(" ");
}
const span = (n: number): CSSProperties => ({ gridColumn: `span ${n}` });

/** 「2026年11月2日」（紙の書き方。数字と単位を詰める） */
function dateText(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

/** 常用薬の表（薬ごとに 回数・用量・残り・保管・中断注意） */
function MedicationTable({ s }: { s: MedicalSummary }) {
  if (s.medications.length === 0) {
    return (
      <div className="grid" style={cols("1fr")}>
        <F s={s} k="meds.list" size="lg" />
      </div>
    );
  }
  return (
    <div data-field="meds.list">
      <table className="med-table">
        <thead>
          <tr>
            <th>常用薬</th>
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
                <span>{paperText(m.name)}</span>
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
      <span className="mid-label">{medicalField("id.medical").label}</span>
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
          {MEDICAL_ID_PART_LABELS.birth}（西暦8桁）＋{MEDICAL_ID_PART_LABELS.sex}＋{MEDICAL_ID_PART_LABELS.kana}（上から7字）
        </span>
      </div>
    </div>
  );
}

/** 医療要約の紙面（A4 縦 1 枚の束）。画面 /people/[id]/forms/medical */
export function MedicalSummarySheet({ sheet: s }: { sheet: MedicalSummary }) {
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-paper-root data-sheet="medical" data-person={s.personId}>
        <MedicalSummaryPaper sheet={s} />
      </div>
    </div>
  );
}

/**
 * 医療要約の A4 の 1 頁（束に入れる前の section）。本人の 1 枚（T06）の裏もこれをそのまま使う。
 * page は束の中の何頁目か、aside は題名の段の右に置く物（本人の 1 枚の QR）、
 * note は題名の段の右の小さな字の一番上に足す 1 行（本人の 1 枚の「この QR は医療班が読みます」と期限）、
 * foot は頁の下の端の文書名と頁番号（既定は医療要約の 1 / 1。本人の 1 枚の裏は 2 / 2）
 */
export function MedicalSummaryPaper({
  sheet: s,
  page = 1,
  aside,
  note,
  foot = { doc: DOCUMENT_LABELS.medical, page: 1, total: 1 },
}: {
  sheet: MedicalSummary;
  page?: 1 | 2;
  aside?: ReactNode;
  note?: ReactNode;
  foot?: { doc: string; page: number; total: number };
}) {
  const author = [s.author.office, s.author.careManager ? `${s.author.careManager}（ケアマネ）` : ""].filter(Boolean).join(" ");
  const consentAt = s.consent.recordedAt ? formatJst(s.consent.recordedAt).slice(0, 10) : null;
  return (
        <section className="paper form med-paper" aria-label={DOCUMENT_LABELS.medical} data-page={page}>
          <div className="head-row">
            <h1 className="title">{DOCUMENT_LABELS.medical}</h1>
            <div className="top-col">
              {note}
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
            <div className="grid" style={cols("1.5fr 1.2fr 0.6fr 1.7fr")}>
              <F s={s} k="patient.kana" size="xl" />
              <F s={s} k="patient.name" size="lg" />
              <F s={s} k="patient.sex" />
              <F s={s} k="patient.birth" size="lg" />
            </div>
            <div className="grid" style={cols(patientRow2(s))}>
              <F s={s} k="patient.phone" />
              <F s={s} k="patient.address" />
              <F s={s} k="patient.house" />
            </div>
            <div className="grid" style={cols("1fr 1fr")} data-block="shelter">
              <F s={s} k="shelter.first" size="lg" />
              <F s={s} k="shelter.second" size="lg" />
            </div>
            <div className="grid" style={cols("1fr")} data-block="contact">
              <F s={s} k="contact.kinds" />
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
            {/* 様式の □ の並び（抗血小板薬 → 抗凝固薬 → 糖尿病治療薬 → ステロイド → 抗てんかん薬 → その他 → 透析）を 1 つの枠に流す */}
            <div className="grid chk" style={cols("1fr")}>
              <div className="flow">
                <F s={s} k="drug.antiplatelet" size="lg" bare />
                <F s={s} k="drug.anticoagulant" size="lg" bare />
                <F s={s} k="drug.diabetes" size="lg" bare />
                <F s={s} k="drug.steroid" size="lg" bare />
                <F s={s} k="drug.antiepileptic" size="lg" bare />
                <F s={s} k="drug.other" size="lg" bare />
                <F s={s} k="drug.dialysis" size="lg" bare />
              </div>
              <F s={s} k="drug.hot" size="lg" bare />
            </div>
          </div>

          <div className="blk" data-block="care">
            <div className="grid" style={cols("1fr")}>
              <F s={s} k="care.vulnerable" bare />
              <F s={s} k="care.protect" label="【要保護者】" />
            </div>
          </div>

          <div className="blk key" data-block="id">
            <MedicalIdBoxes s={s} />
            {/* 既往症・予防接種は様式の 2 頁の欄（1 頁のメディカル ID のあと） */}
            <div className="grid" style={cols("1fr 1fr")} data-block="history">
              <F s={s} k="history.disease" />
              <F s={s} k="history.vaccination" />
            </div>
          </div>

          {/* 様式の外の欄（災害診療記録 2018 に無い。台帳の値を医療班へ渡すために足した） */}
          <div className="blk key" data-block="extra">
            <div className="blk-h">
              補足<span className="note">様式外の欄</span>
            </div>
            <div className="grid" style={cols("1fr 1fr")}>
              <F s={s} k="contact.people" style={span(2)} />
              <F s={s} k="contact.others" size="sm" />
              <F s={s} k="drug.devices" size="lg" />
            </div>
            <MedicationTable s={s} />
            <div className="grid" style={cols("1fr 1fr 1fr")}>
              <F s={s} k="patient.dwelling" size="sm" />
              <F s={s} k="meds.carry" />
              <F s={s} k="meds.notes" />
            </div>
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

          <div className="small-note">
            <p>
              ※欄の順は災害診療記録2018（一般診療版）による（既往症・予防接種は様式の2頁）。値は台帳の記録を並べた物で、□ と中断注意の印は薬の区分などから機械的に付けた。初診日・傷病名・トリアージ・処置など医療班が書く欄は載せていない
            </p>
          </div>
          <PaperFoot doc={foot.doc} name={s.name} page={foot.page} total={foot.total} />
        </section>
  );
}
