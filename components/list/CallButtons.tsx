"use client";

// 行の詳細の連絡先と電話のボタン（docs/tasks/T13.md「電話は tel: のリンクで、押した事実を経過に残す」）。
// 電話のボタンは tel: のリンク（かけるのはケアマネ本人の電話）。押すと「電話 家族 娘」を経過に残してから電話の画面へ。
// 「不通」は 1 押しで「電話 家族 娘 不通」を残す。残したら画面を読み直す（電話の記録と最後の電話が変わる）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DetailContact } from "@/lib/list/detail";
import { DETAIL_LABELS } from "@/lib/list/labels";
import { buttonClass } from "@/components/ui/Button";
import { PhoneIcon } from "@/components/ui/Icon";
import { CALL_PATH } from "@/lib/list/paths";

type Result = "dialed" | "no_answer";

export function CallButtons({ personId, contacts }: { personId: string; contacts: DetailContact[] }) {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function log(contactId: string, result: Result) {
    setBusy(`${contactId}:${result}`);
    setFailed(null);
    try {
      const res = await fetch(CALL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: personId, contact: contactId, result }),
        // 電話の画面に移っても送り切る
        keepalive: true,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { label?: string } | null;
        setFailed(j?.label ?? "記録失敗");
        return;
      }
      router.refresh();
    } catch {
      setFailed("記録失敗");
    } finally {
      setBusy(null);
    }
  }

  if (contacts.length === 0) return <p className="text-sm text-muted">{DETAIL_LABELS.none}</p>;
  return (
    <div>
      <ul className="space-y-1.5">
        {contacts.map((c) => (
          <li key={c.id} data-contact={c.kind}>
            {/* 1 行目: 誰か（種類・名前・間柄・緊急連絡先の順・最後の電話） */}
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-xs text-muted">{c.kindLabel}</span>
              {c.name && <span className="font-bold">{c.name}</span>}
              {c.relation && <span className="text-xs text-muted">{c.relation}</span>}
              {c.emergencyOrder !== null && (
                <span className="whitespace-nowrap text-xs text-muted">
                  {DETAIL_LABELS.emergency} {c.emergencyOrder}
                </span>
              )}
              {c.lastCall && (
                <span
                  className={`whitespace-nowrap text-xs tabular-nums ${c.lastCall.result === "no_answer" ? "font-bold tone-check" : "text-muted"}`}
                  data-last-call={c.lastCall.result ?? ""}
                >
                  {c.lastCall.when} {c.lastCall.result === "no_answer" ? DETAIL_LABELS.noAnswer : DETAIL_LABELS.calls}
                </span>
              )}
            </div>
            {/* 2 行目: 電話（tel:）と不通 */}
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <a
                href={`tel:${c.tel}`}
                onClick={() => void log(c.id, "dialed")}
                className={buttonClass("main", "sm")}
                data-press="overlay"
                data-tel={c.id}
              >
                <PhoneIcon aria-hidden className="size-3.5 shrink-0" />
                {DETAIL_LABELS.calls} {c.phone}
              </a>
              <button
                type="button"
                onClick={() => void log(c.id, "no_answer")}
                disabled={busy !== null}
                className={buttonClass("plainIn", "sm")}
                data-press
                data-no-answer={c.id}
              >
                {DETAIL_LABELS.noAnswer}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="mt-1 text-sm font-bold text-danger">
          {failed}
        </p>
      )}
    </div>
  );
}
