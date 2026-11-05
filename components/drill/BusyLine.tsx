// 時間を使う手の見え方（docs/tasks/T110.md の 1）。対応の欄の上の 1 行（サーバーで描く。状態を持たない）。
// 使用（手に使った時間。AI を動かした最後の区切りから。連続の時計の訓練だけ）・職員の空き・外出・次空（職員が次に空く時刻）。
// 色は使わない（状態の 4 色は安否だけ）。言葉は lib/drill/busy.ts の BUSY_LABELS。
// T128: 使用は「使用 60 分」、次空は訓練の中の時刻「14:30」（手の時刻と同じ書き方。lib/drill/act-time.ts）。元が無ければ発災からの経過

import { BUSY_LABELS, type BusyView } from "@/lib/drill/busy";
import { clockText, type TimeBase } from "@/lib/drill/act-time";
import { ACTION_UI } from "@/lib/drill/labels";

export function BusyLine({ busy, base = null }: { busy: BusyView; base?: TimeBase | null }) {
  const L = BUSY_LABELS;
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm tabular-nums" data-busy data-busy-used={busy.used ?? undefined}>
      {busy.used !== null && (
        <span data-busy-time>
          <span className="text-xs text-muted">{L.used}</span>{" "}
          <span className="font-bold">
            {busy.used} {ACTION_UI.minutes}
          </span>
          {busy.acts > 0 && (
            <span className="ml-1.5 text-xs text-muted">
              {L.acts} {busy.acts}
            </span>
          )}
        </span>
      )}
      <span data-busy-staff={busy.staffFree}>
        <span className="text-xs text-muted">
          {L.staff} {L.free}
        </span>{" "}
        <span className="font-bold">{busy.staffFree}</span>
        {busy.staffOut > 0 && (
          <span className="ml-1.5">
            <span className="text-xs text-muted">{L.out}</span> <span className="font-bold">{busy.staffOut}</span>
          </span>
        )}
      </span>
      {busy.nextFree !== null && (
        <span data-busy-next={busy.nextFree}>
          <span className="text-xs text-muted">{L.next}</span> <span className="font-bold">{clockText(base, busy.nextFree)}</span>
        </span>
      )}
    </p>
  );
}
