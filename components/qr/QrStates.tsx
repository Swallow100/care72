// QR の頁の、要約を出さないときの形と、医療班・行政の「受入」の入口。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
//
// - 同意なし・未確認: その言葉だけ。記録の日・人・備考（components/forms/MedicalWithheld.tsx が出す物）も出さない
// - 無効（期限切れ・作り直した前の版・署名が合わない）: 「無効」だけ。どれで落ちたかも、誰の QR かも出さない
// - 受入: 医療班・行政でログインしているときだけ。避難所を入れて受け持ちに入れる（T23。/staff/receive）

import { WITHHELD_LABELS } from "@/components/forms/MedicalWithheld";
import { StateTag } from "@/components/person/parts";
import { SHELTER_MAX } from "@/lib/custody/forms";
import { CUSTODY_LABELS } from "@/lib/custody/labels";
import { QR_RECEIVE_PATH } from "@/lib/custody/paths";
import { DOCUMENT_LABELS } from "@/lib/labels";
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

/**
 * 受入の入口（T23）。避難所の名前を入れて「受入」で受け持ちに入れる（/staff/receive へのフォームの POST）。
 * 本人の id はフォームに載せず、トークンだけ（サーバーが引き直す）。避難所の既定は自分がいちばん最近に受け入れた所
 */
export function QrReceive({ token, shelter }: { token: string; shelter: string | null }) {
  return (
    <form
      method="post"
      action={QR_RECEIVE_PATH}
      className="flex flex-wrap items-end gap-3 rounded-lg bg-panel px-4 py-3"
      data-qr-receive
    >
      <input type="hidden" name="token" value={token} />
      <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="text-muted">{CUSTODY_LABELS.shelter}</span>
        <input
          type="text"
          name="shelter"
          required
          maxLength={SHELTER_MAX}
          defaultValue={shelter ?? ""}
          className="rounded-md bg-panel2 px-2 py-1.5 text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
      </label>
      <button type="submit" className="rounded-md bg-accent px-4 py-2 font-bold text-on-accent" data-press="overlay">
        {QR_LABELS.receive}
      </button>
    </form>
  );
}
