"use client";

// 本人のページの「受入依頼」の面（ケアマネの役、docs/tasks/T163.md）。医療班へ受け入れを頼み、返事（受入済・受入不可）を見る。
// 置き場所は本人のページの頭のすぐ下（components/person/PersonView.tsx の request）。出すのは災害モードのときと、前に依頼したことがある人だけ
// （components/person/PersonWithIntake.tsx が決める）。
// - 医療班への提供に同意の無い人は「同意なし」だけ（押せる物を出さない。サーバーも断る）
// - 依頼中は「依頼中」と行き先・時刻と「取消」。受入済・受入不可は返事をした医療班の名前と時刻。受入不可・取消済のあとは送り直せる
// - 行き先の既定は台帳の避難先 1。送る中身は本人の id と行き先だけ（ほかの物は医療班が受け入れてから本人のページで見る）
// - T166: 依頼中の面に、役を選べる人（審査員と見本のケアマネ。lib/auth/wall.ts の canChooseRole）だけ「医療班」（ヘッダーの入口と同じ言葉と役のアイコン、T184。読み上げと title は「医療班 受入一覧」）。押すと役を医療班にして受入一覧へ
//   （受け入れる操作は医療班の側にあり、依頼の近くに取消しか無いと読まれた）。本物のケアマネには出さない

import { useRouter } from "next/navigation";
import { useState } from "react";
import { REQUEST_LABELS, REQUEST_STATE_LABELS } from "@/lib/custody/labels";
import { SHELTER_MAX } from "@/lib/custody/forms";
import { CUSTODY_REQUEST_API, CUSTODY_REQUEST_WITHDRAW_API } from "@/lib/custody/paths";
import type { RequestPanel } from "@/lib/custody/requests";
import { formatJst } from "@/lib/person";
import { Button } from "@/components/ui/Button";
import { RoleIcon, SendIcon, UndoIcon } from "@/components/ui/Icon";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { Mark } from "@/components/ui/Tag";

type Json = { ok?: boolean; label?: string };

async function post(url: string, body: unknown): Promise<Json> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return ((await res.json().catch(() => null)) as Json | null) ?? { ok: false, label: "送信失敗" };
  } catch {
    return { ok: false, label: "送信失敗" };
  }
}

const INPUT =
  "w-full min-w-0 rounded-md bg-panel2 px-2 py-1 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function RequestSection({
  personId,
  panel,
  level,
  staffEntry = false,
  staffRole = "medical",
}: {
  personId: string;
  panel: RequestPanel;
  level: 1 | 2;
  staffEntry?: boolean;
  /** 受入一覧への入口の役の値（新規事業所の中では新規事業所の医療班、T180。lib/auth/roles.ts の medicalChoiceOf） */
  staffRole?: string;
}) {
  const router = useRouter();
  const H = level === 1 ? "h2" : "h3";
  const titleId = `person-${personId}-request`;
  const latest = panel.latest;
  const [shelter, setShelter] = useState(latest?.shelter ?? panel.defaultShelter);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (url: string, body: unknown) => {
    setBusy(true);
    setError(null);
    const r = await post(url, body);
    setBusy(false);
    if (!r.ok) setError(r.label ?? "送信失敗");
    else router.refresh();
  };
  const open = latest?.state === "open";
  const canSend = panel.canSend && (!latest || latest.state === "declined" || latest.state === "withdrawn");
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg bg-panel px-3 py-2.5 text-sm"
      data-section="request"
      data-request-state={latest?.state ?? "none"}
      aria-busy={busy || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <H id={titleId} className="text-[1rem] leading-6 font-bold">
          {REQUEST_LABELS.list}
        </H>
        {latest && (
          <span className="flex flex-wrap items-baseline gap-x-2" data-request-status>
            <Mark tone={latest.state === "declined" ? "check" : null}>
              <span className="font-bold">{REQUEST_STATE_LABELS[latest.state]}</span>
            </Mark>
            <span>
              <span className="text-xs text-muted">{REQUEST_LABELS.shelter}</span> {latest.shelter}
            </span>
            <span className="text-xs text-muted tabular-nums">
              {REQUEST_LABELS.at} {formatJst(latest.requestedAt)}
            </span>
            {latest.repliedAt && latest.state !== "withdrawn" && (
              <span className="text-xs tabular-nums">
                <span className="text-muted">{REQUEST_LABELS.replied}</span> {latest.repliedName ?? ""} {formatJst(latest.repliedAt)}
              </span>
            )}
          </span>
        )}
        {!panel.canSend && !open && <Mark>{REQUEST_LABELS.noConsent}</Mark>}
        {open && staffEntry && (
          <form method="post" action="/api/auth/role" className="ml-auto" data-request-staff>
            <SubmitButton kind="main" size="sm" icon={RoleIcon} name="role" value={staffRole} aria-label={REQUEST_LABELS.toStaffName} title={REQUEST_LABELS.toStaffName}>
              {REQUEST_LABELS.toStaff}
            </SubmitButton>
          </form>
        )}
        {open && (
          <Button
            kind="quiet"
            size="sm"
            icon={UndoIcon}
            disabled={busy}
            data-pending={busy || undefined}
            onClick={() => run(CUSTODY_REQUEST_WITHDRAW_API, { requestId: latest.id })}
            className={staffEntry ? "" : "ml-auto"}
          >
            {REQUEST_LABELS.withdraw}
          </Button>
        )}
      </div>
      {canSend && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!shelter.trim()) {
              setError(`${REQUEST_LABELS.shelter} 未入力`);
              return;
            }
            void run(CUSTODY_REQUEST_API, { personId, shelter: shelter.trim() });
          }}
        >
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-xs text-muted">{REQUEST_LABELS.shelter}</span>
            <input
              type="text"
              value={shelter}
              onChange={(e) => setShelter(e.target.value)}
              maxLength={SHELTER_MAX}
              className={`${INPUT} max-w-xs`}
              data-field="request-shelter"
            />
          </label>
          <Button type="submit" kind="main" size="sm" icon={SendIcon} disabled={busy} data-pending={busy || undefined}>
            {latest ? REQUEST_LABELS.again : REQUEST_LABELS.send}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs font-bold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
