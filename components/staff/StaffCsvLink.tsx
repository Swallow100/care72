"use client";

// 受け持ちの見出しの行の右の「CSV出力」（T62）。今の絞込と並び（表が URL に書く。lib/custody/staff-view.ts）を CSV に持ち越す。
// URL は表（StaffTable）が history.replaceState で書き換え、useSearchParams はそれに付いてくる（Next の router と同期）。
// 様式 9 と同じ字・アイコン・download の a。移る物なので無色

import { useSearchParams } from "next/navigation";
import { buttonClass } from "@/components/ui/Button";
import { DownloadIcon } from "@/components/ui/Icon";
import { parseStaffView, staffViewQuery } from "@/lib/custody/staff-view";
import { EXPORT_LABELS, STAFF_CSV_PATH } from "@/lib/forms/export-paths";

export function StaffCsvLink({ className = "" }: { className?: string }) {
  const params = useSearchParams();
  const query = staffViewQuery(
    parseStaffView({
      shelter: params.get("shelter") ?? undefined,
      color: params.get("color") ?? undefined,
      q: params.get("q") ?? undefined,
      sort: params.get("sort") ?? undefined,
    }),
  );
  return (
    <a href={query ? `${STAFF_CSV_PATH}?${query}` : STAFF_CSV_PATH} download className={buttonClass("plain", "md", className)} data-press data-export="csv">
      <DownloadIcon aria-hidden className="size-4 shrink-0" />
      {EXPORT_LABELS.csv}
    </a>
  );
}
