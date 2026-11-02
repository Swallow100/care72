// QR の紙（A4 縦 1 枚、文書の寸法）。本人のページの QR の画面（/people/[id]/forms/qr）の印刷で出す。画面には出さない。
// 誰の QR か・何が開くか・期限を紙に書く（QR だけを刷ると、だれの物か分からない）。URL の文字は出さない（トークンを書き写させない）。
// QR が開くのは医療班提供の同意の範囲だけ（同意なしは「同意なし」の頁）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。見た目は paper.css と qr-sheet の部分（paper.css）。

import { CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS } from "@/lib/labels";
import type { ConsentStatus } from "@/lib/db/types";
import { QR_LABELS } from "@/lib/qr/labels";
import { paperText } from "@/lib/forms/paper-text";
import { PaperFoot } from "./PaperFoot";
import { QrBlock, qrExpiryDate } from "./QrBlock";

/** 紙の QR の一辺（mm）。机の上でもスマホのカメラで読める大きさ */
export const QR_SHEET_MM = 45;

export const QR_SHEET_TITLE = "医療要約 QR";

export type QrSheetProps = {
  personId: string;
  name: string;
  kana: string | null;
  url: string;
  expiresAt: string;
  generation: number;
  consent: ConsentStatus;
  /** 作成日（和暦の文字） */
  date: string;
  office: string | null;
  careManager: string | null;
};

export function QrSheet(p: QrSheetProps) {
  const by = [p.office, p.careManager ? `${p.careManager}（ケアマネ）` : null].filter(Boolean).join(" ");
  const granted = p.consent === "granted";
  return (
    <div className="print-only" data-paper-print>
      <div className="paper-stack" data-paper-root data-sheet="qr" data-person={p.personId}>
        <section className="paper qr-sheet" aria-label={QR_SHEET_TITLE} data-page="1">
          <div className="head-row">
            <h1 className="title">{QR_SHEET_TITLE}</h1>
            <div className="top-col">
              <span className="nowrap">{paperText(p.date)} 作成</span>
              {by && <span className="nowrap">{by}</span>}
            </div>
          </div>
          <div className="qr-who">
            <span className="f-l">対象者</span>
            <span className="qr-name">{p.name}</span>
            {p.kana && <span className="qr-kana">{p.kana}</span>}
          </div>
          <div className="qr-body">
            <QrBlock url={p.url} expiresAt={p.expiresAt} sizeMm={QR_SHEET_MM} caption={false} />
            <dl className="qr-facts">
              <dt>読む人</dt>
              <dd className="p-strong">{QR_LABELS.blockNote}</dd>
              <dt>{QR_LABELS.scope}</dt>
              <dd>
                {granted ? QR_LABELS.scopeSummary : QR_LABELS.scopeNone}
                <span className="p-sub">
                  {" "}
                  {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS[p.consent]}
                </span>
              </dd>
              <dt>{QR_LABELS.expires}</dt>
              <dd className="p-strong" data-qr-expires>
                {qrExpiryDate(p.expiresAt)}
              </dd>
              <dt>{QR_LABELS.generation}</dt>
              <dd>{p.generation}</dd>
            </dl>
          </div>
          <div className="small-note">
            {granted ? (
              <p>※QR を読むと医療要約の頁が開く。氏名（漢字）と住所は出ない。開いた記録は本人のページの経過に残る</p>
            ) : (
              <p>※医療班提供の同意が無いので、QR を読んでも「同意なし」だけが出る</p>
            )}
            <p>※QR を作り直すと、この紙の QR は使えなくなる。期限が過ぎたら作り直して刷り直す</p>
          </div>
          <PaperFoot doc={QR_SHEET_TITLE} name={p.name} page={1} total={1} />
        </section>
      </div>
    </div>
  );
}
