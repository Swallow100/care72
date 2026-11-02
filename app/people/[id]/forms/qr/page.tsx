import "@/components/qr/qr-print.css";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/forms/PrintButton";
import { QrBlock } from "@/components/forms/QrBlock";
import { StateTag } from "@/components/person/parts";
import { requirePage } from "@/lib/auth/server";
import { nowSec, sessionSecret } from "@/lib/auth/session";
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

type Props = { params: Promise<{ id: string }> };

const STATUS_TONES: Record<QrStatus, StateTone> = { none: "unknown", active: "ok", expired: "check" };

// 本人のページの書類の「QR」。作る・作り直す（前の版は無効）・印刷用の表示（QR の部品だけを紙に）・閲覧記録。
// 壁は本人のページと同じ（loadPersonPage → personInScope、範囲の外は 404）。作る・作り直すはケアマネだけ。
// QR が開く頁（/q/<token>）に出るのは医療班提供の同意の範囲だけなので、その同意と範囲を上に出す。
// 医療班・行政の同意の範囲に QR の画面（閲覧記録を含む）は無いので 404（T24、lib/consent/scope.ts）。
export default async function QrFormPage({ params }: Props) {
  const principal = await requirePage("person");
  const { id } = await params;
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <div className="qr-screen-only flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/people/${encodeURIComponent(rows.person.id)}`} className="rounded px-2 py-1 text-sm text-muted" data-press>
          戻る
        </Link>
        <div className="font-bold">
          {QR_LABELS.title} <span className="font-normal text-muted">{rows.person.name}</span>
        </div>
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="rounded px-2 py-1 text-sm text-accent underline underline-offset-4" data-press>
              {QR_LABELS.open}
            </a>
          )}
          {canIssue && (
            <form method="post" action={`/api/people/${encodeURIComponent(rows.person.id)}/qr`}>
              {state.status === "none" ? (
                <button type="submit" className="rounded-md bg-accent px-4 py-1.5 font-bold text-on-accent" data-press>
                  {QR_LABELS.issue}
                </button>
              ) : (
                <button
                  type="submit"
                  className={
                    state.status === "active"
                      ? "rounded-md bg-panel2 px-4 py-1.5 font-bold text-danger"
                      : "rounded-md bg-accent px-4 py-1.5 font-bold text-on-accent"
                  }
                  data-press
                >
                  {QR_LABELS.reissue}
                </button>
              )}
            </form>
          )}
          {url && <PrintButton />}
        </div>
      </div>

      <div className="mt-3 grid items-start gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
        {url && state.expiresAt && (
          <section className="qr-print rounded-lg bg-panel p-4">
            <QrBlock url={url} expiresAt={state.expiresAt} />
          </section>
        )}
        <section className="qr-screen-only rounded-lg bg-panel px-4 py-3" data-qr-views={views.length}>
          <h2 className="text-sm font-bold text-muted">
            {QR_LABELS.views} <span className="tabular-nums">{views.length}</span>
          </h2>
          {views.length === 0 ? (
            <p className="mt-1 text-sm text-muted">{BLANK_LABELS.none}</p>
          ) : (
            <table className="mt-1 w-full text-sm">
              <thead className="text-xs text-muted">
                <tr className="text-left">
                  <th className="px-1 py-1 pr-3 font-normal">{QR_LABELS.time}</th>
                  <th className="px-1 py-1 pr-3 font-normal">{QR_LABELS.recipient}</th>
                  <th className="px-1 py-1 pr-3 font-normal">{QR_LABELS.scope}</th>
                  <th className="px-1 py-1 font-normal">{QR_LABELS.generation}</th>
                </tr>
              </thead>
              <tbody>
                {views.map((v) => (
                  <tr key={v.id} className="odd:bg-panel2">
                    <td className="px-1 py-1 pr-3 tabular-nums">{v.when}</td>
                    <td className="px-1 py-1 pr-3">{v.who}</td>
                    <td className="px-1 py-1 pr-3">{v.scope}</td>
                    <td className="px-1 py-1 tabular-nums">{v.generation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}
