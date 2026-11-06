"use client";

// 事業所の地域（components/office/OfficePlace.tsx、T148）の選ぶ欄: 広さ（km）と浸水の深さ。
// 選ぶ部品（components/ui/Select）は中の <option> を読んで一覧を作るので、client の部品の中で <option> を書く
// （server の部品から <option> を渡すと、server の描画では一覧が読めず「未選択」になり、client と字が食い違った）。

import { Select } from "@/components/ui/Select";
import { PLACE_LABELS } from "@/lib/labels";

const SELECT = "h-8 min-w-0 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 広さ（name="region_km"。auto は自動で、今の自動の km を添える） */
export function ExtentSelect({ kms, value, autoKm }: { kms: readonly number[]; value: number | null; autoKm: number }) {
  return (
    <Select name="region_km" defaultValue={value === null ? "auto" : String(value)} className={SELECT} aria-label={PLACE_LABELS.extent}>
      <option value="auto">{`${PLACE_LABELS.auto} ${autoKm} km`}</option>
      {kms.map((k) => (
        <option key={k} value={String(k)}>{`${k} km`}</option>
      ))}
    </Select>
  );
}

/** 浸水の深さ（name="flood_depth"。none は深さなし） */
export function DepthSelect({ depths, value }: { depths: readonly number[]; value: number | null }) {
  return (
    <Select name="flood_depth" defaultValue={value === null ? "none" : String(value)} className={SELECT} aria-label={PLACE_LABELS.floodDepth}>
      <option value="none">{`${PLACE_LABELS.floodDepth} —`}</option>
      {depths.map((d) => (
        <option key={d} value={String(d)}>{`${PLACE_LABELS.floodDepth} ${d} m`}</option>
      ))}
    </Select>
  );
}
