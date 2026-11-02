// 本人の 1 枚の紙面（A4 縦の表と裏、印刷で 2 頁）。表は lib/forms/own-sheet.ts の文を大きな文字で 1 枚に、
// 裏は医療要約（T07）の頁をそのまま（MedicalSummaryPaper）と QR の枠。医療班提供の同意が無い人の裏は「同意なし」だけ。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 見た目は paper.css・medical-paper.css・own-paper.css（読み込むのはページの側。テストでは読まない）。
// QR の枠は T16 の QR の部品が main に入ったら差し替える。いまは「QR」と書いた四角。

import type { MedicalSummaryResult } from "@/lib/forms/medical-summary";
import type { OwnLine, OwnPhone, OwnSheet } from "@/lib/forms/own-sheet";
import { CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { EasyWords } from "./EasyText";
import { MedicalSummaryPaper } from "./MedicalSummarySheet";
import { WITHHELD_LABELS } from "./MedicalWithheld";

/** QR の枠（T16 の部品に差し替えるまでの四角） */
export function QrFrame() {
  return (
    <div className="qr-frame" data-qr="placeholder">
      QR
    </div>
  );
}

/** 電話の欄。番号が無ければ手で書く線 */
function Phone({ phone }: { phone: OwnPhone }) {
  return phone.number ? (
    <span className="own-tel" data-tel={phone.number}>
      {phone.number}
    </span>
  ) : (
    <span className="own-tel blank" data-tel="" />
  );
}

function Line({ line }: { line: OwnLine }) {
  return (
    <li className={line.tone ? `own-ln ${line.tone}` : "own-ln"} data-line={line.key}>
      <span className="own-tx">
        <EasyWords words={line.words} />
      </span>
      {line.phone && <Phone phone={line.phone} />}
    </li>
  );
}

/** 表（本人・家族・支援者が読む面） */
export function OwnSheetFront({ sheet: s }: { sheet: OwnSheet }) {
  return (
    <section className="paper own-paper" aria-label={DOCUMENT_LABELS.own} data-page="1">
      <h1 className="own-title">
        <EasyWords words={s.title} />
      </h1>
      {s.blocks.map((b) => (
        <div key={b.id} className="own-blk" data-block={b.id}>
          <h2 className="own-h">
            <EasyWords words={b.heading} />
          </h2>
          <ul className={b.id === "carry" ? "own-lines cols" : "own-lines"}>
            {b.lines.map((l) => (
              <Line key={l.key} line={l} />
            ))}
          </ul>
        </div>
      ))}
      <div className="own-sos" data-block="emergency">
        <EasyWords words={s.emergency} />
      </div>
      <div className="own-foot">
        <EasyWords words={s.made} />
      </div>
    </section>
  );
}

/** 医療班提供の同意が無い人の裏。要約の中身は作らない */
function OwnBackWithheld({ kind }: { kind: "refused" | "unconfirmed" }) {
  return (
    <section className="paper own-back" aria-label={DOCUMENT_LABELS.medical} data-page="2" data-withheld={kind}>
      <div className="head-row">
        <h1 className="title">{DOCUMENT_LABELS.medical}</h1>
        <QrFrame />
      </div>
      <div className="blk key own-withheld">
        <div className="own-withheld-tag">{WITHHELD_LABELS[kind]}</div>
        <div>
          {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS[kind]}
        </div>
      </div>
    </section>
  );
}

/** 表と裏の 2 頁 */
export function OwnSheetPaper({ sheet, medical }: { sheet: OwnSheet; medical: MedicalSummaryResult }) {
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-sheet="own" data-person={sheet.personId}>
        <OwnSheetFront sheet={sheet} />
        {medical.kind === "sheet" ? (
          <MedicalSummaryPaper sheet={medical.sheet} page={2} aside={<QrFrame />} />
        ) : (
          <OwnBackWithheld kind={medical.kind} />
        )}
      </div>
    </div>
  );
}
