import "@/components/forms/paper.css";
import "@/components/qr/qr-print.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { QrBlock } from "@/components/forms/QrBlock";
import { QrSheet } from "@/components/forms/QrSheet";
import { StateTag } from "@/components/person/parts";
import { Button, buttonClass } from "@/components/ui/Button";
import { PaperIcon } from "@/components/ui/Icon";
import { FormAbout } from "@/components/forms/FormAbout";
import { PaperBar, wantsPrint } from "@/components/ui/PaperBar";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
import { DOCUMENT_CATALOG } from "@/lib/forms/catalog";
import { warekiText } from "@/lib/forms/wareki";
import { BLANK_LABELS, CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS } from "@/lib/labels";
import { loadPersonDocument } from "@/lib/consent/documents";
import { formatJst, type StateTone } from "@/lib/person";
import { QR_LABELS, QR_STATUS_LABELS } from "@/lib/qr/labels";
import { currentQrToken, loadQrRow, qrState, type QrStatus } from "@/lib/qr/store";
import { originFromHeaders, qrUrl } from "@/lib/qr/url";
import { medicalConsentOf, qrViewLog } from "@/lib/qr/view";

// D1 を毎回読む
export const dynamic = "force-dynamic";

// 印刷の PDF の名前にもなる。氏名は入れない
export const metadata: Metadata = { title: QR_LABELS.title };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ print?: string | string[] }> };

const STATUS_TONES: Record<QrStatus, StateTone> = { none: "unknown", active: "ok", expired: "check" };

// 本人のページの書類の「QR」。作る・作り直す（前の版は無効）・QR の表示・閲覧記録。
// 印刷は QR の紙（components/forms/QrSheet: だれの QR か・範囲・期限・版と QR、A4 1 枚）。画面の操作・QR の面・閲覧記録は紙に出さない。
// 壁は本人のページと同じ（loadPersonPage → personInScope、範囲の外は 404）。作る・作り直すはケアマネだけ。
// QR が開く頁（/q/<token>）に出るのは医療班提供の同意の範囲だけなので、その同意と範囲を上に出す。
// 医療班・行政の同意の範囲に QR の画面（閲覧記録を含む）は無いので 404（T24、lib/consent/scope.ts）。
export default async function QrFormPage({ params, searchParams }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
  const autoPrint = wantsPrint((await searchParams).print);
  const { env } = await getCloudflareContext({ async: true });
  const opened = await loadPersonDocument(env.DB, principal, id, "qr");
  if (!opened) notFound();
  const { rows } = opened;
  const row = (await loadQrRow(env.DB, rows.person.id)) ?? { qr_generation: 0, qr_issued_at: null };
  const state = qrState(row, nowSec());
  const token = state.status === "active" ? await currentQrToken(rows.person.id, row, sessionSecret(env)) : null;
  const origin = originFromHeaders(await headers());
  const url = token && origin ? qrUrl(origin, token) : null;
  const consent = medicalConsentOf(rows);
  const views = qrViewLog(rows);
  const canIssue = principal.role === "care_manager";
  const office = await env.DB.prepare("SELECT name FROM offices WHERE id = ?1")
    .bind(rows.person.office_id)
    .first<{ name: string }>();

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <PaperBar
        back={`/people/${encodeURIComponent(rows.person.id)}`}
        title={QR_LABELS.title}
        name={rows.person.name}
        hide="qr-screen-only"
        contained
        print={url !== null}
        autoPrint={autoPrint && url !== null}
        actions={
          <>
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className={buttonClass("plain")} data-press>
                <PaperIcon aria-hidden className="size-4 shrink-0" />
                {QR_LABELS.open}
              </a>
            )}
            {canIssue && (
              <form method="post" action={`/api/people/${encodeURIComponent(rows.person.id)}/qr`}>
                {/* 作り直すと前に刷った紙の QR は無効になるので、使える QR があるときの再作成は赤 */}
                <Button type="submit" kind={state.status === "active" ? "danger" : "main"}>
                  {state.status === "none" ? QR_LABELS.issue : QR_LABELS.reissue}
                </Button>
              </form>
            )}
          </>
        }
      >
        <span className="flex items-baseline gap-2" data-qr-status={state.status}>
          <StateTag tone={STATUS_TONES[state.status]}>{QR_STATUS_LABELS[state.status]}</StateTag>
          {state.expiresAt && (
            <span className="text-sm tabular-nums">
              {QR_LABELS.expires} {formatJst(state.expiresAt).slice(0, 10)}
            </span>
          )}
          {state.generation > 0 && (
            <span className="text-sm text-muted tabular-nums">
              {QR_LABELS.generation} {state.generation}
            </span>
          )}
        </span>
        <span className="flex items-baseline gap-2 text-sm" data-consent={consent}>
          {consent === "granted" ? (
            <span>
              {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS.granted}
            </span>
          ) : (
            <StateTag tone="check">
              {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS[consent]}
            </StateTag>
          )}
          <span className="text-muted">
            {QR_LABELS.scope} {consent === "granted" ? QR_LABELS.scopeSummary : QR_LABELS.scopeNone}
          </span>
        </span>
      </PaperBar>
      <FormAbout entry={DOCUMENT_CATALOG.qr} className="qr-screen-only mt-1" />

      <div className="mt-3 grid items-start gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
        {url && state.expiresAt && (
          <section className="qr-screen-only rounded-lg bg-panel p-4">
            <QrBlock url={url} expiresAt={state.expiresAt} />
          </section>
        )}
        <Panel className="qr-screen-only" data-qr-views={views.length}>
          <PanelHead title={QR_LABELS.views} count={views.length} />
          {views.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{BLANK_LABELS.none}</p>
          ) : (
            <div className={`mt-2 ${TABLE_BOX}`}>
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>{QR_LABELS.time}</th>
                    <th className={TH}>{QR_LABELS.recipient}</th>
                    <th className={TH}>{QR_LABELS.scope}</th>
                    <th className={TH}>{QR_LABELS.generation}</th>
                  </tr>
                </thead>
                <tbody>
                  {views.map((v) => (
                    <tr key={v.id}>
                      <td className={`${TD} tabular-nums`}>{v.when}</td>
                      <td className={TD}>{v.who}</td>
                      <td className={TD}>{v.scope}</td>
                      <td className={`${TD} tabular-nums`}>{v.generation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {url && state.expiresAt && (
        <QrSheet
          personId={rows.person.id}
          name={rows.person.name}
          kana={rows.person.kana}
          url={url}
          expiresAt={state.expiresAt}
          generation={state.generation}
          consent={consent}
          date={warekiText(todayJst())}
          office={office?.name ?? null}
          careManager={rows.careManagerName}
        />
      )}
    </main>
  );
}
