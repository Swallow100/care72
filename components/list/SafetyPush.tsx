"use client";

// 担当一覧の行の詳細（発災時）の「安否確認」（docs/tasks/T149.md）。本人と家族のスマホへ「大丈夫ですか」の通知を送る。
// 送るのはサーバー（app/api/people/[id]/push。ケアマネの役・壁の中・災害モード・1 分に 1 回）。押したら結果の言葉（「送信 2」「通知先なし」
// 「通知 未設定」「送信済 待機」）を横に出す。通知の文は固定で、名前・病名は入れない。色と連絡順には触れない。
// 送ったら経過に「安否確認 通知」が入るので、画面を読み直す。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { NotifyIcon } from "@/components/ui/Icon";
import { PUSH_LABELS } from "@/lib/push/labels";

export function safetyPushPath(personId: string): string {
  return `/api/people/${encodeURIComponent(personId)}/push`;
}

export function SafetyPush({ personId }: { personId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setLabel(null);
    try {
      const res = await fetch(safetyPushPath(personId), { method: "POST" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; sent?: number; label?: string } | null;
      setLabel(body?.label ?? PUSH_LABELS.failed);
      if (res.ok && (body?.sent ?? 0) > 0) router.refresh();
    } catch {
      setLabel(PUSH_LABELS.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-safety-push={personId}>
      <Button kind="plain" size="sm" icon={NotifyIcon} onClick={send} disabled={busy} data-safety-send>
        {PUSH_LABELS.safety}
      </Button>
      {label && (
        <span className="text-xs font-bold" role="status" data-safety-result>
          {label}
        </span>
      )}
    </div>
  );
}
