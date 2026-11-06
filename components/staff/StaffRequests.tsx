"use client";

// 医療班への受入依頼の一覧（/staff の上、docs/tasks/T163.md）。ケアマネ（事業所）が送った依頼中の人を古い順に並べ、
// 行ごとに「受入」と「受入不可」の 2 つだけ（自由文の理由の欄は作らない）。受入は今の受け入れ（受け持ち・経過・第三者提供の記録）を通し、
// 受入一覧のその人の行を表の上に出す（?received=、T152 と同じ行き先）。受入不可は依頼の行から消え、事業所の本人のページに返事が出る。
// 行に出すのはカナ・年齢・依頼元の事業所・行き先・依頼の時刻だけ（受け入れる前は本人確認の範囲。薬・機器は受け入れてから）。
// 依頼が無ければ面ごと出さない（空の面を作らない）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CUSTODY_LABELS, REQUEST_LABELS } from "@/lib/custody/labels";
import { CUSTODY_REQUEST_REPLY_API, receivedHref } from "@/lib/custody/paths";
import type { RequestHit } from "@/lib/custody/requests";
import { shortJst } from "@/lib/disaster/state";
import { Button } from "@/components/ui/Button";
import { AddPersonIcon, DeclinedIcon } from "@/components/ui/Icon";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";

type Json = { ok?: boolean; label?: string; custodyId?: string | null };

async function reply(requestId: string, answer: "accept" | "decline"): Promise<Json> {
  try {
    const res = await fetch(CUSTODY_REQUEST_REPLY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, answer }),
    });
    return ((await res.json().catch(() => null)) as Json | null) ?? { ok: false, label: "送信失敗" };
  } catch {
    return { ok: false, label: "送信失敗" };
  }
}

export const REQUESTS_TITLE_ID = "requests-title";

export function StaffRequests({ requests }: { requests: RequestHit[] }) {
  if (requests.length === 0) return null;
  return (
    <Panel aria-labelledby={REQUESTS_TITLE_ID} data-requests>
      <PanelHead id={REQUESTS_TITLE_ID} title={REQUEST_LABELS.list} count={`${requests.length} ${CUSTODY_LABELS.people}`} />
      <div className={`mt-2 ${TABLE_BOX}`}>
        <table className={TABLE}>
          <thead>
            <tr>
              <th className={TH}>{CUSTODY_LABELS.kana}</th>
              <th className={TH}>{CUSTODY_LABELS.age}</th>
              <th className={TH}>{REQUEST_LABELS.from}</th>
              <th className={TH}>{REQUEST_LABELS.shelter}</th>
              <th className={TH}>{REQUEST_LABELS.at}</th>
              <th className={TH}>
                <span className="sr-only">{REQUEST_LABELS.replied}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <RequestRow key={r.id} r={r} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function RequestRow({ r }: { r: RequestHit }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (answer: "accept" | "decline") => {
    setBusy(answer);
    setError(null);
    const res = await reply(r.id, answer);
    if (res.ok && answer === "accept" && res.custodyId) {
      router.push(receivedHref(res.custodyId));
      router.refresh();
      return;
    }
    setBusy(null);
    if (!res.ok) {
      setError(res.label ?? "送信失敗");
      return;
    }
    router.refresh();
  };
  return (
    <tr data-request={r.id} aria-busy={busy !== null || undefined}>
      <td className={`${TD} font-bold`}>{r.kana}</td>
      <td className={`${TD} tabular-nums`}>{r.age ?? "-"}</td>
      <td className={TD}>{r.office}</td>
      <td className={TD}>{r.shelter}</td>
      <td className={`${TD} tabular-nums whitespace-nowrap`}>{shortJst(r.requestedAt)}</td>
      <td className={`${TD} text-right`}>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {error && (
            <span role="alert" className="text-xs font-bold text-danger">
              {error}
            </span>
          )}
          <Button
            kind="main"
            size="sm"
            icon={AddPersonIcon}
            disabled={busy !== null}
            data-pending={busy === "accept" || undefined}
            onClick={() => act("accept")}
            aria-label={`${REQUEST_LABELS.accept} ${r.kana}`}
          >
            {REQUEST_LABELS.accept}
          </Button>
          <Button
            size="sm"
            icon={DeclinedIcon}
            disabled={busy !== null}
            data-pending={busy === "decline" || undefined}
            onClick={() => act("decline")}
            aria-label={`${REQUEST_LABELS.decline} ${r.kana}`}
          >
            {REQUEST_LABELS.decline}
          </Button>
        </div>
      </td>
    </tr>
  );
}
