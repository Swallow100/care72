// 市町村への安否報告の下書き。様式 9 の表を数え、決まった形の文にする（Claude は呼ばない）。
// 安否は色ごとの人数（至急・要確認・不明・無事）、所在は結果の列の所在（自宅・避難所〔名前ごと〕・その他・搬送・不明）。
// 名前は出さず人数だけ（市への集計は人数で足りる。docs/SPEC.md「画面 6」）。言葉は状態の 4 つの言葉だけを使う。

import { COLOR_LABELS } from "../labels.ts";
import type { Color } from "../triage/index.ts";
import { colorCounts, LOCATION_LABELS, type Form9Location, type Form9Row, type Form9Sheet } from "./form9.ts";

/** 報告での色の順（連絡の順） */
export const REPORT_COLORS: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];
const LOCATION_ORDER: ReadonlyArray<Form9Location> = ["home", "shelter", "other", "transported", "unknown"];

export type Form9Tally = {
  total: number;
  colors: Record<Color, number>;
  locations: Record<Form9Location, number>;
  /** 避難所の名前ごとの人数（名前の分からない人は「名称不明」） */
  shelters: Array<{ name: string; count: number }>;
};

export const UNNAMED_SHELTER = "名称不明";

export function tally(rows: ReadonlyArray<Pick<Form9Row, "color" | "result">>): Form9Tally {
  const locations: Record<Form9Location, number> = { home: 0, shelter: 0, other: 0, transported: 0, unknown: 0 };
  const shelters = new Map<string, number>();
  for (const r of rows) {
    const loc = r.result?.location ?? "unknown";
    locations[loc] += 1;
    if (loc === "shelter") {
      const name = r.result?.place ?? UNNAMED_SHELTER;
      shelters.set(name, (shelters.get(name) ?? 0) + 1);
    }
  }
  return {
    total: rows.length,
    colors: colorCounts(rows),
    locations,
    shelters: [...shelters.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || (a.name === UNNAMED_SHELTER ? 1 : b.name === UNNAMED_SHELTER ? -1 : a.name.localeCompare(b.name, "ja"))),
  };
}

/** 日時（JST の 2026年11月3日 14:20） */
export function jstDateTimeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 9 * 3_600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${hh}:${mm}`;
}

export type ReportMeta = {
  officeName: string;
  /** 数えた時刻（ISO。発災時は災害の状態の「今」） */
  at: string;
  /** 災害の名前（災害モードの切替で入る。無ければ出さない） */
  disaster?: string | null;
  /** 事業所の連絡先（担当の名前など。無ければ出さない） */
  contact?: string | null;
};

/** 報告の下書きの文 */
export function form9Report(sheet: Form9Sheet, meta: ReportMeta): string {
  const t = tally(sheet.rows);
  const n = (x: number) => `${x} 人`;
  const lines: string[] = ["【安否報告（下書き）】", `事業所：${meta.officeName}`];
  if (meta.disaster) lines.push(`災害：${meta.disaster}`);
  lines.push(`時点：${jstDateTimeLabel(meta.at)}`, `対象：利用者 ${n(t.total)}（様式9 災害時利用者一覧表）`, "");

  lines.push("【安否】", REPORT_COLORS.map((c) => `${COLOR_LABELS[c]} ${n(t.colors[c])}`).join("、"), "");

  lines.push("【所在】");
  for (const loc of LOCATION_ORDER) {
    if (loc === "transported") continue;
    const count = t.locations[loc];
    if (loc === "shelter" && t.shelters.length > 0) {
      lines.push(`${LOCATION_LABELS[loc]} ${n(count)}（${t.shelters.map((s) => `${s.name} ${n(s.count)}`).join("、")}）`);
    } else {
      lines.push(`${LOCATION_LABELS[loc]} ${n(count)}`);
    }
  }
  lines.push("", "【搬送】", n(t.locations.transported), "");

  const following = t.colors.red + t.colors.yellow;
  if (following > 0) lines.push(`至急・要確認の ${n(following)}は事業所で連絡を続けています。`);
  const unknown = t.colors.gray;
  if (unknown > 0) lines.push(`不明の ${n(unknown)}は安否を確かめています。`);
  if (meta.contact) lines.push(`連絡先：${meta.contact}`);
  return lines.join("\n").trimEnd() + "\n";
}
