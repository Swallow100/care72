"use client";

// 医療班への受入依頼の一覧（/staff の上、docs/tasks/T163.md）。ケアマネ（事業所）が送った依頼中の人を事業所ごとにまとめて古い順に並べ（T172）、
// 行ごとに「受入」と「受入不可」の 2 つだけ（自由文の理由の欄は作らない）。受入は今の受け入れ（受け持ち・経過・第三者提供の記録）を通し、
// 受入一覧のその人の行を表の上に出す（?received=、T152 と同じ行き先）。受入不可は依頼の行から消え、事業所の本人のページに返事が出る。
// 行に出すのはカナ・年齢・依頼元の事業所・行き先・依頼の時刻だけ（受け入れる前は本人確認の範囲。薬・機器は受け入れてから）。
// 依頼が無ければ面ごと出さない（空の面を作らない。一括受入の失敗が残っている間は出す）。
// 一括受入（T172）: 行か事業所の欄で選び、1 回の避難所の入力で全員に（空なら各人の依頼の行き先）。1 人ずつ今の受け口へ送る（lib/custody/bulk.ts）。
// 事業所でまとめるのは依頼の来ている行だけで、依頼の無い人を足さない。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BULK_MAX, requestsByOffice, togglePick, togglePickAll, type BulkSent, type BulkTarget } from "@/lib/custody/bulk";
import { SHELTER_MAX } from "@/lib/custody/forms";
import { BULK_LABELS, CUSTODY_LABELS, REQUEST_LABELS } from "@/lib/custody/labels";
import { CUSTODY_REQUEST_REPLY_API, receivedHref } from "@/lib/custody/paths";
import type { RequestHit } from "@/lib/custody/requests";
import { shortJst } from "@/lib/disaster/state";
import { Button } from "@/components/ui/Button";
import { AddPersonIcon, DeclinedIcon } from "@/components/ui/Icon";
import { Panel, PanelHead } from "@/components/ui/Panel";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import { BulkButton, BulkCheck, BulkResult, PICKED_ROW, useBulkRun } from "./BulkReceive";

type Json = { ok?: boolean; label?: string; custodyId?: string | null };

async function reply(requestId: string, answer: "accept" | "decline", shelter?: string): Promise<Json> {
  try {
    const res = await fetch(CUSTODY_REQUEST_REPLY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, answer, ...(shelter ? { shelter } : {}) }),
    });
    return ((await res.json().catch(() => null)) as Json | null) ?? { ok: false, label: "送信失敗" };
  } catch {
    return { ok: false, label: "送信失敗" };
  }
}

export const REQUESTS_TITLE_ID = "requests-title";

/** 狭い画面で省く列 */
const SM = "hidden sm:table-cell";

const INPUT =
  "w-40 min-w-0 rounded-md bg-panel2 px-2 py-1 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function StaffRequests({ requests }: { requests: RequestHit[] }) {
  const bulk = useBulkRun();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [shelter, setShelter] = useState("");
  if (requests.length === 0 && !bulk.outcomes) return null;
  // 読み直しで消えた依頼（ほかの人が返事をした）は選んでいないのと同じ
  const chosen = requests.filter((r) => picked.has(r.id));
  const live = new Set(chosen.map((r) => r.id));
  const full = live.size >= BULK_MAX;

  async function receiveAll() {
    const place = shelter.trim();
    const send = async (t: BulkTarget): Promise<BulkSent> => {
      const res = await reply(t.id, "accept", place || undefined);
      return res.ok && res.custodyId ? { ok: true, custodyId: res.custodyId } : { ok: false, label: res.label ?? "送信失敗" };
    };
    const out = await bulk.run(
      chosen.map((r) => ({ id: r.id, kana: r.kana })),
      send,
    );
    // 失敗した人は選んだまま（もう 1 回押せる）。成功した人だけ外す
    setPicked(new Set(out.flatMap((o) => (o.ok ? [] : [o.id]))));
  }

  return (
    <Panel aria-labelledby={REQUESTS_TITLE_ID} data-requests>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <PanelHead id={REQUESTS_TITLE_ID} title={REQUEST_LABELS.list} count={`${requests.length} ${CUSTODY_LABELS.people}`} />
        {requests.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-bulk="requests">
            <label className="flex items-center gap-1.5 text-sm">
              <span className="text-muted">{CUSTODY_LABELS.shelter}</span>
              <input
                type="text"
                value={shelter}
                onChange={(e) => setShelter(e.target.value)}
                maxLength={SHELTER_MAX}
                placeholder={BULK_LABELS.asAsked}
                disabled={bulk.busy}
                className={INPUT}
                data-field="bulk-shelter"
              />
            </label>
            <BulkButton count={chosen.length} total={requests.length} bulk={bulk} onClick={receiveAll} />
          </div>
        )}
      </div>
      <BulkResult outcomes={bulk.outcomes} />
      {requests.length > 0 && (
        <div className={`mt-2 ${TABLE_BOX}`}>
          <table className={TABLE} data-table="requests">
            <thead>
              <tr>
                <th className={`${TH} w-px`}>
                  <span className="sr-only">{BULK_LABELS.select}</span>
                </th>
                <th className={TH}>{CUSTODY_LABELS.kana}</th>
                <th className={`${TH} ${SM}`}>{CUSTODY_LABELS.age}</th>
                <th className={`${TH} ${SM}`}>{REQUEST_LABELS.shelter}</th>
                <th className={`${TH} ${SM}`}>{REQUEST_LABELS.at}</th>
                <th className={TH}>
                  <span className="sr-only">{REQUEST_LABELS.replied}</span>
                </th>
              </tr>
            </thead>
            {requestsByOffice(requests).map((g) => {
              const ids = g.requests.map((r) => r.id);
              const on = ids.filter((id) => picked.has(id)).length;
              return (
                <tbody key={g.officeId} data-request-office={g.office} data-request-office-id={g.officeId}>
                  {/* 事業所の行: その事業所の全員を選ぶ欄（見える字つき。全員を選ぶと全解除）と名前と人数 */}
                  <tr>
                    <th scope="colgroup" colSpan={6} className={`${TH} whitespace-normal`}>
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <BulkCheck
                          label={`${on === ids.length ? BULK_LABELS.clearAll : BULK_LABELS.selectAll} ${g.office}`}
                          text={on === ids.length ? BULK_LABELS.clearAll : BULK_LABELS.selectAll}
                          checked={on === ids.length}
                          indeterminate={on > 0 && on < ids.length}
                          disabled={bulk.busy || (full && on === 0)}
                          onChange={() => setPicked(togglePickAll(live, ids))}
                        />
                        <span>
                          {REQUEST_LABELS.from} <span className="text-ink">{g.office}</span> <span className="tabular-nums">{ids.length}</span> {CUSTODY_LABELS.people}
                        </span>
                      </span>
                    </th>
                  </tr>
                  {g.requests.map((r) => (
                    <RequestRow
                      key={r.id}
                      r={r}
                      picked={picked.has(r.id)}
                      pickable={picked.has(r.id) || !full}
                      locked={bulk.busy}
                      onPick={() => setPicked(togglePick(live, r.id))}
                    />
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </Panel>
  );
}

function RequestRow({ r, picked, pickable, locked, onPick }: { r: RequestHit; picked: boolean; pickable: boolean; locked: boolean; onPick: () => void }) {
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
    <tr data-request={r.id} data-picked={picked || undefined} className={picked ? PICKED_ROW : undefined} aria-busy={busy !== null || undefined}>
      <td className={`${TD} w-px align-middle`}>
        <BulkCheck label={`${BULK_LABELS.select} ${r.kana}`} checked={picked} disabled={locked || !pickable} onChange={onPick} />
      </td>
      <td className={TD}>
        <div className="font-bold">{r.kana}</div>
        {/* 640px 未満は年齢・行き先・依頼の列を省き、カナの下に（375 で受入のボタンが切れた） */}
        <div className="text-xs text-muted sm:hidden">
          <span className="tabular-nums">{r.age ?? "-"}</span> 歳 {REQUEST_LABELS.shelter} {r.shelter} {REQUEST_LABELS.at} <span className="tabular-nums">{shortJst(r.requestedAt)}</span>
        </div>
      </td>
      <td className={`${TD} ${SM} tabular-nums`}>{r.age ?? "-"}</td>
      <td className={`${TD} ${SM}`}>{r.shelter}</td>
      <td className={`${TD} ${SM} tabular-nums whitespace-nowrap`}>{shortJst(r.requestedAt)}</td>
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
            disabled={busy !== null || locked}
            data-pending={busy === "accept" || undefined}
            onClick={() => act("accept")}
            aria-label={`${REQUEST_LABELS.accept} ${r.kana}`}
          >
            {REQUEST_LABELS.accept}
          </Button>
          <Button
            size="sm"
            icon={DeclinedIcon}
            disabled={busy !== null || locked}
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
