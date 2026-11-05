"use client";

// 不在着信（docs/tasks/T127.md の 2）。1 刻みの着信は 2 件まで（lib/drill/calls.ts の CALLS_PER_TICK）なので、鳴らさなかった電話の形の連絡を
// 対応の欄の上に並べ、折返（連絡先電話の手。掛けてきた人の連絡先が無ければ本人電話）につなぐ。折返したら一覧から外れる（lib/drill/calls.ts の openMissedCalls）。
// 折返は手の欄と同じ口（POST /api/drill/<id>/action）を読んだ刻みと手の数で打つ。その時の電話の可否・決まりの表で断られたら理由を 1 行
// （「通話不可」など）。打てたら画面を読み直す（最新の結果に返事と往復の欄が出る）。
// 色は安否の印だけ。押したときは灰色だけ（Button の data-press）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { PhoneIcon } from "@/components/ui/Icon";
import { MISSED_LABELS, MISSED_SHOWN } from "@/lib/drill/calls";
import type { FictionKind } from "@/lib/drill/fiction";
import { clockLabel, DRILL_LABELS } from "@/lib/drill/labels";
import { FictionalMark } from "./Fictional";

export type MissedItem = {
  /** 着信の安否の鍵（刻みと並び） */
  key: string;
  person: string;
  name: string;
  /** 掛けてきた人の言い方（「家族 夫」） */
  caller: string;
  /** 掛かってきた時刻（発災からの分） */
  minute: number;
  saying: string | null;
  ai: boolean;
  /** 折返の手（掛けてきた人の連絡先があれば連絡先電話、無ければ本人電話） */
  kind: "call_contact" | "call_person";
  target: string | null;
};

const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function MissedCalls({
  drillId,
  step,
  actions,
  items,
  fiction,
}: {
  drillId: string;
  step: number;
  actions: number;
  /** 新しい順 */
  items: ReadonlyArray<MissedItem>;
  fiction?: FictionKind;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; label: string } | null>(null);
  if (items.length === 0) return null;
  const shown = items.slice(0, MISSED_SHOWN);
  const rest = items.length - shown.length;

  const callback = async (m: MissedItem) => {
    setBusy(m.key);
    setError(null);
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(drillId)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, actions, kind: m.kind, person: m.person, target: m.target }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (!res.ok || !body?.ok) setError({ key: m.key, label: body?.label ?? String(res.status) });
      router.refresh();
    } catch {
      setError({ key: m.key, label: DRILL_LABELS.network });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="missed-calls" className="rounded-md bg-panel2 px-2.5 py-2" data-missed-calls={items.length}>
      <h3 id="missed-calls" className="flex items-baseline gap-2 text-sm">
        <span className="font-bold">{MISSED_LABELS.title}</span>
        <span className="font-bold tabular-nums">{items.length}</span>
      </h3>
      <ul className="mt-1 space-y-1">
        {shown.map((m) => (
          <li key={m.key} className="flex items-center gap-2 text-sm" data-missed={m.person}>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-muted tabular-nums">{clockLabel(m.minute)}</span>
              <span className="font-bold">
                {m.name}
                <FictionalMark kind={fiction} />
              </span>
              <span className="text-xs text-muted">{m.caller}</span>
              {m.saying && (
                <span className="min-w-0 max-w-full truncate text-xs" title={m.saying}>
                  {m.ai && <AiMark small />}「{m.saying}」
                </span>
              )}
              {error?.key === m.key && (
                <span role="alert" className="basis-full text-xs font-bold text-danger" data-missed-error>
                  {error.label}
                </span>
              )}
            </div>
            <Button
              kind="plainIn"
              size="sm"
              icon={PhoneIcon}
              className={`shrink-0 ${FOCUS}`}
              disabled={busy !== null}
              onClick={() => void callback(m)}
              data-missed-callback={m.kind}
            >
              {busy === m.key ? MISSED_LABELS.calling : MISSED_LABELS.callback}
            </Button>
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <p className="mt-1 text-xs text-muted tabular-nums" data-missed-more={rest}>
          {MISSED_LABELS.more} {rest} {MISSED_LABELS.count}
        </p>
      )}
    </section>
  );
}
