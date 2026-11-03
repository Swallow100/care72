"use client";

// 最後の手の取消（T59）。履歴（ActionLog、サーバーで描く）の最後の手の行に置く。押すとアプリ内の確認の窓で決めてから
// POST /api/drill/<id>/undo（読んだ刻みと手の数を送る。違えば競合）。終わったら画面を読み直す。断られたら理由を 1 行。
// 赤の文字（消す系）。押したときは灰色だけ（Button の data-press）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { RestoreIcon } from "@/components/ui/Icon";
import { DRILL_LABELS, T59_LABELS } from "@/lib/drill/labels";
import { appConfirm } from "@/lib/ui/dialog";

export function UndoButton({ drillId, step, actions, act }: { drillId: string; step: number; actions: number; act: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!(await appConfirm(T59_LABELS.undoBody, { title: T59_LABELS.undoTitle, ok: T59_LABELS.undoOk, danger: true, icon: "RestoreIcon" }))) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/drill/${encodeURIComponent(drillId)}/undo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, actions }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (!res.ok || !body?.ok) setError(body?.label ?? String(res.status));
      router.refresh();
    } catch {
      setError(DRILL_LABELS.network);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="ml-auto inline-flex items-center gap-1.5">
      {error && (
        <span role="alert" className="text-xs font-bold text-danger">
          {error}
        </span>
      )}
      <Button kind="danger" size="sm" icon={RestoreIcon} onClick={() => void run()} disabled={busy} data-action="undo" data-undo={act}>
        {T59_LABELS.undo}
      </Button>
    </span>
  );
}
