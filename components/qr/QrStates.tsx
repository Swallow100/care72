// QR の頁の、要約を出さないときの形と、医療班・行政の「受領」の入口。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
//
// - 同意なし・未確認: その言葉だけ。記録の日・人・備考（components/forms/MedicalWithheld.tsx が出す物）も出さない
// - 無効（期限切れ・作り直した前の版・署名が合わない）: 「無効」だけ。どれで落ちたかも、誰の QR かも出さない
// - 受領: 医療班・行政でログインしているときだけ。中身（受け持ちに入れる）は T23

import { WITHHELD_LABELS } from "@/components/forms/MedicalWithheld";
import { StateTag } from "@/components/person/parts";
import { DOCUMENT_LABELS, DOCUMENT_STATUS_LABELS } from "@/lib/labels";
import { QR_LABELS } from "@/lib/qr/labels";

export function QrWithheld({ kind }: { kind: "refused" | "unconfirmed" }) {
  return (
    <section className="rounded-lg bg-panel px-4 py-4" data-withheld={kind}>
      <h1 className="text-xl font-bold">{DOCUMENT_LABELS.medical}</h1>
      <div className="mt-3">
        <StateTag tone="check" size="md">
          {WITHHELD_LABELS[kind]}
        </StateTag>
      </div>
    </section>
  );
}

export function QrInvalid() {
  return (
    <section className="rounded-lg bg-panel px-4 py-4" data-qr-invalid>
      <StateTag tone="unknown" size="md">
        {QR_LABELS.invalid}
      </StateTag>
    </section>
  );
}

/** 受領の入口（T23 で中身）。押せない形で、準備中と出す */
export function QrReceive() {
  return (
    <section className="flex items-center gap-3 rounded-lg bg-panel px-4 py-3" data-qr-receive>
      <button type="button" disabled className="rounded-md bg-panel2 px-4 py-2 font-bold text-muted">
        {QR_LABELS.receive}
      </button>
      <span className="text-sm text-muted">{DOCUMENT_STATUS_LABELS.pending}</span>
    </section>
  );
}
