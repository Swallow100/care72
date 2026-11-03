// QR を作る・作り直すフォーム（本人のページの書類の QR の画面、T64）。期限の日数（30・90・180）を選んで「作成」「再作成」。
// 選ぶ所は components/ui/Select（隠しの欄 ttl で送る。JS が動く前でも既定の値が送られる）。既定は本人の行の今の日数。
// 作り直すと前に刷った紙の QR は無効になるので、使える QR があるときの再作成は赤。

import { Button } from "@/components/ui/Button";
import { QrIcon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { QR_LABELS } from "@/lib/qr/labels";
import type { QrStatus } from "@/lib/qr/store";
import { QR_TTL_CHOICES, type QrTtlDays } from "@/lib/qr/token";

const SELECT =
  "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function QrIssueForm({ personId, status, ttlDays }: { personId: string; status: QrStatus; ttlDays: QrTtlDays }) {
  return (
    <form method="post" action={`/api/people/${encodeURIComponent(personId)}/qr`} className="flex flex-wrap items-center gap-2" data-qr-issue>
      <label className="flex items-center gap-1.5 text-sm">
        <span className="text-muted">{QR_LABELS.expires}</span>
        <Select name="ttl" defaultValue={String(ttlDays)} className={SELECT} aria-label={QR_LABELS.expires} data-qr-ttl>
          {QR_TTL_CHOICES.map((d) => (
            <option key={d} value={String(d)}>
              {`${d} ${QR_LABELS.days}`}
            </option>
          ))}
        </Select>
      </label>
      <Button type="submit" kind={status === "active" ? "danger" : "main"} icon={QrIcon}>
        {status === "none" ? QR_LABELS.issue : QR_LABELS.reissue}
      </Button>
    </form>
  );
}
