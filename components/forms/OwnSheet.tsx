// 本人の 1 枚の紙面（A4 縦の表と裏、印刷で 2 頁）。表は lib/forms/own-sheet.ts の文を大きな文字で 1 枚に、
// 裏は医療要約（T07）の頁をそのまま（MedicalSummaryPaper）と QR（T16）。医療班提供の同意が無い人の裏は「同意なし」だけ。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// 見た目は paper.css・medical-paper.css・own-paper.css（読み込むのはページの側。テストでは読まない）。
// QR は題名の段の右に 24mm の四角（T16 の QrBlock の字を外した形。11/3 に 18mm から大きくした、docs/DECISIONS.md 11/3 04:0x の 6）。
// 「この QR は医療班が読みます」と期限は段の右の小さな字の一番上。
// QR がまだ無い（未作成・期限切れ）ときは同じ 24mm の枠に状態を書く。QR の頁は同意の無い人にも「同意なし」を出す作りなので、裏の両方に置く。

import type { MedicalSummaryResult } from "@/lib/forms/medical-summary";
import type { OwnLine, OwnPhone, OwnSheet } from "@/lib/forms/own-sheet";
import { CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS, DOCUMENT_LABELS } from "@/lib/labels";
import { QR_LABELS, QR_STATUS_LABELS } from "@/lib/qr/labels";
import type { QrStatus } from "@/lib/qr/store";
import { paperWords } from "@/lib/forms/paper-text";
import { EasyWords } from "./EasyText";
import { MedicalSummaryPaper } from "./MedicalSummarySheet";
import { PaperFoot } from "./PaperFoot";
import { WITHHELD_LABELS } from "./MedicalWithheld";
import { QrBlock, qrExpiryDate } from "./QrBlock";

/**
 * 裏の QR の一辺（mm。own-paper.css の .qr-frame と同じ）。題名の段の高さがこの分だけ伸び、裏の要約は 10 人とも 1 頁に収まる
 * （11/3 に測った裏の余りは 山田 ハナの 12mm がいちばん少なく、18 → 24mm の 6mm を足しても 2 頁のまま。頁数はテストで数える）
 */
export const OWN_QR_MM = 24;

/** 裏に刷る QR。url は今の版のトークンの /q/ の URL（未作成・期限切れ・元の分からないときは null） */
export type OwnQr = { status: QrStatus; url: string | null; expiresAt: string | null };

type PrintableQr = { url: string; expiresAt: string };

function printable(qr: OwnQr | null | undefined): PrintableQr | null {
  return qr && qr.status === "active" && qr.url && qr.expiresAt ? { url: qr.url, expiresAt: qr.expiresAt } : null;
}

/** QR の無いときの枠（一辺 OWN_QR_MM）。状態（未作成・期限切れ）を書く */
export function QrFrame({ status }: { status: Exclude<QrStatus, "active"> }) {
  return (
    <div className="qr-frame" data-qr="placeholder" data-qr-status={status}>
      <span>{QR_LABELS.title}</span>
      <span className="qr-frame-state">{QR_STATUS_LABELS[status]}</span>
    </div>
  );
}

/** 題名の段の右の QR（有効なら QR の部品、無ければ枠） */
function QrSpot({ qr }: { qr: OwnQr | null | undefined }) {
  const p = printable(qr);
  if (p) return <QrBlock url={p.url} expiresAt={p.expiresAt} sizeMm={OWN_QR_MM} caption={false} />;
  return <QrFrame status={qr?.status === "expired" ? "expired" : "none"} />;
}

/** 題名の段の右の小さな字の一番上: 「この QR は医療班が読みます」と期限。QR が無ければ出さない */
function QrNote({ qr }: { qr: OwnQr | null | undefined }) {
  const p = printable(qr);
  if (!p) return null;
  return (
    <span className="nowrap own-qr-note" data-qr-note>
      <b>{QR_LABELS.blockNote}</b> {QR_LABELS.expires} {qrExpiryDate(p.expiresAt)}
    </span>
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

/** 紙の書き方（数字と単位を詰める）。本人の言葉の段（words.*）は台帳の文のまま */
const paperLine = (line: OwnLine) => (line.key.startsWith("words.") ? line.words : paperWords(line.words));

function Line({ line }: { line: OwnLine }) {
  return (
    <li className={line.tone ? `own-ln ${line.tone}` : "own-ln"} data-line={line.key}>
      <span className="own-tx">
        <EasyWords words={paperLine(line)} />
      </span>
      {line.phone && <Phone phone={line.phone} />}
    </li>
  );
}

/** 裏の頁の下の端の文書名 */
const OWN_BACK_DOC = `${DOCUMENT_LABELS.own} 裏（${DOCUMENT_LABELS.medical}）`;

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
      <PaperFoot page={1} total={2} />
    </section>
  );
}

/** 医療班提供の同意が無い人の裏。要約の中身は作らない */
function OwnBackWithheld({ kind, qr, name }: { kind: "refused" | "unconfirmed"; qr: OwnQr | null | undefined; name: string }) {
  return (
    <section className="paper own-back" aria-label={DOCUMENT_LABELS.medical} data-page="2" data-withheld={kind}>
      <div className="head-row">
        <h1 className="title">{DOCUMENT_LABELS.medical}</h1>
        <div className="top-col">
          <QrNote qr={qr} />
        </div>
        <QrSpot qr={qr} />
      </div>
      <div className="blk key own-withheld">
        <div className="own-withheld-tag">{WITHHELD_LABELS[kind]}</div>
        <div>
          {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS[kind]}
        </div>
      </div>
      <PaperFoot doc={OWN_BACK_DOC} name={name} page={2} total={2} />
    </section>
  );
}

/** 表と裏の 2 頁。qr が無ければ（未作成）裏は枠だけ */
export function OwnSheetPaper({ sheet, medical, qr }: { sheet: OwnSheet; medical: MedicalSummaryResult; qr?: OwnQr | null }) {
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-paper-root data-sheet="own" data-person={sheet.personId}>
        <OwnSheetFront sheet={sheet} />
        {medical.kind === "sheet" ? (
          <MedicalSummaryPaper
            sheet={medical.sheet}
            page={2}
            aside={<QrSpot qr={qr} />}
            note={<QrNote qr={qr} />}
            foot={{ doc: OWN_BACK_DOC, page: 2, total: 2 }}
          />
        ) : (
          <OwnBackWithheld kind={medical.kind} qr={qr} name={sheet.name} />
        )}
      </div>
    </div>
  );
}
