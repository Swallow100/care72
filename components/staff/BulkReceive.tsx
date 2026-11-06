"use client";

// 一括受入の共通の部品（T172）。受入依頼（StaffRequests）と検索のヒット（StaffIntake）で同じ形。
// 送り方は lib/custody/bulk.ts（1 人ずつ今の受け口）。終わったら失敗した人を理由つきで一覧に残し（読み直しで行が消えても残る）、
// 成功した人は受入一覧の上に出す（?received=。失敗した人がいても、成功した人は戻さない）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AddPersonIcon } from "@/components/ui/Icon";
import { BULK_MAX, runBulk, type BulkOutcome, type BulkSent, type BulkTarget } from "@/lib/custody/bulk";
import { BULK_LABELS, CUSTODY_LABELS } from "@/lib/custody/labels";
import { receivedHref } from "@/lib/custody/paths";

export type BulkRun = {
  busy: boolean;
  /** 送信中の進み（送り終わった人数・全部） */
  step: { done: number; total: number } | null;
  outcomes: BulkOutcome[] | null;
  run: (targets: readonly BulkTarget[], send: (t: BulkTarget) => Promise<BulkSent>) => Promise<BulkOutcome[]>;
};

export function useBulkRun(): BulkRun {
  const router = useRouter();
  const [step, setStep] = useState<BulkRun["step"]>(null);
  const [outcomes, setOutcomes] = useState<BulkOutcome[] | null>(null);
  const run: BulkRun["run"] = async (targets, send) => {
    setOutcomes(null);
    setStep({ done: 0, total: Math.min(targets.length, BULK_MAX) });
    const out = await runBulk(targets, send, (done, total) => setStep({ done, total }));
    setStep(null);
    setOutcomes(out);
    const ids = out.flatMap((o) => (o.ok ? [o.custodyId] : []));
    if (ids.length > 0) router.push(receivedHref(ids));
    router.refresh();
    return out;
  };
  return { busy: step !== null, step, outcomes, run };
}

/** 選ぶ欄。印は 18px、押せる所は周りの 36px 四方（事業所の担当の一括と同じ。components/office/AssignMany.tsx）。読み上げの名前は「選択 カナ」 */
export function BulkCheck({
  label,
  checked,
  disabled,
  indeterminate,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="-m-2 inline-flex size-9 cursor-pointer items-center justify-center rounded align-middle">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate === true;
        }}
        className="size-[1.125rem] shrink-0 accent-accent outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-accent"
        data-bulk-check
      />
    </label>
  );
}

/** 一括受入のボタンと進み。人数は選んだ数。上限に達したら横に「上限 20 人」 */
export function BulkButton({ count, bulk, onClick }: { count: number; bulk: BulkRun; onClick: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <Button kind="main" size="sm" icon={AddPersonIcon} disabled={count === 0 || bulk.busy} data-pending={bulk.busy || undefined} onClick={onClick} data-bulk-receive={count}>
        {BULK_LABELS.receive} <span className="tabular-nums">{count}</span> {CUSTODY_LABELS.people}
      </Button>
      {count >= BULK_MAX && (
        <span className="text-xs font-bold tone-check" data-bulk-limit>
          {BULK_LABELS.limit} {BULK_MAX} {CUSTODY_LABELS.people}
        </span>
      )}
      {bulk.step && (
        <span role="status" className="tabular-nums text-muted" data-bulk-step>
          {CUSTODY_LABELS.sending} {bulk.step.done}/{bulk.step.total}
        </span>
      )}
    </span>
  );
}

/** 終わったあとの結果。受入と失敗の人数、失敗した人のカナと理由の一覧 */
export function BulkResult({ outcomes }: { outcomes: BulkOutcome[] | null }) {
  if (!outcomes || outcomes.length === 0) return null;
  const failed = outcomes.filter((o): o is BulkOutcome & { ok: false } => !o.ok);
  return (
    <div className="mt-1.5 text-sm" data-bulk-result={failed.length === 0 ? "ok" : "failed"}>
      <p>
        <span className="text-muted">{BULK_LABELS.done}</span> <span className="font-bold tabular-nums">{outcomes.length - failed.length}</span> {CUSTODY_LABELS.people}
        {failed.length > 0 && (
          <>
            <span className="ml-3 text-danger">{BULK_LABELS.failed}</span> <span className="font-bold tabular-nums text-danger">{failed.length}</span> {CUSTODY_LABELS.people}
          </>
        )}
      </p>
      {failed.length > 0 && (
        <ul role="alert" className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5" data-bulk-failed>
          {failed.map((f) => (
            <li key={f.id} data-bulk-failed-row={f.id}>
              <span className="font-bold">{f.kana}</span> <span className="font-bold text-danger">{f.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
