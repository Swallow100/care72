// ケアマネの上書き（docs/tasks/T13.md「ケアマネの上書き（上げる・下げる・理由）」）。
// 担当一覧の行の詳細で、ルールの表の色をケアマネが手で直す。理由が要り、経過に残る。
//
// 置き場: 表を足さず、本人の経過（timeline_entries）に kind override の行を足す。payload に lib/triage の Override の形
// （to・baseAtOverride・reason）、書き手と時刻は行の author_id・occurred_at。解除は to が null の行（消さない）。
// 今の上書きは「発災から今までの、いちばん新しい override の行」。前の災害モードの上書きは持ち越さない。
// 色への当て方はルールの表（lib/triage の applyOverride）のまま: 上書きしたあとに表の色が悪くなったら上書きは切れる。
// 担当一覧・本人のページ・様式 9 の 3 か所が同じ上書きを読む（同じ人が画面ごとに違う色にならないように）。
//
// ここは読む側（payload の形・今の上書き・D1 から読む）。書く側（保存の壁と、表の色の当て直し）は lib/list/override.ts。

import type { D1Database } from "@cloudflare/workers-types";
import type { Color, Override, Situation } from "../triage/index.ts";
import { withinDisaster } from "./triage.ts";

export const OVERRIDE_SOURCE = "override";

/** 理由の長さの上限 */
export const MAX_OVERRIDE_REASON = 200;

const COLORS: ReadonlyArray<Color> = ["red", "yellow", "gray", "green"];

export function isColor(v: unknown): v is Color {
  return typeof v === "string" && (COLORS as readonly string[]).includes(v);
}

/** 経過の行の payload。to が null は解除（表の色に戻す） */
export type OverridePayload = {
  source: typeof OVERRIDE_SOURCE;
  to: Color | null;
  /** 上書きしたときの表の色 */
  baseAtOverride: Color;
  reason: string;
};

/** 表に渡す上書きに、書き手の名前を添えた物（行の詳細に出す） */
export type StoredOverride = Override & { byName: string | null };

export function parseOverridePayload(text: string | null): OverridePayload | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<OverridePayload>;
    if (v.source !== OVERRIDE_SOURCE || !isColor(v.baseAtOverride)) return null;
    if (v.to !== null && !isColor(v.to)) return null;
    const reason = typeof v.reason === "string" ? v.reason : "";
    // 理由の無い上書きは表が受け付けない（lib/triage が投げる）。壊れた行で一覧を落とさないように捨てる
    if (v.to !== null && !reason.trim()) return null;
    return { source: OVERRIDE_SOURCE, to: v.to, baseAtOverride: v.baseAtOverride, reason };
  } catch {
    return null;
  }
}

export type OverrideEntryRow = {
  person_id: string;
  author_id: string | null;
  author_name: string | null;
  payload: string | null;
  occurred_at: string;
};

/**
 * 経過の override の行（時刻の順）から、本人ごとの今の上書き。発災から今までの行だけを読み、
 * いちばん新しい行が解除（to が null）なら上書きなし。読めない行は飛ばす
 */
export function latestOverrides(
  rows: ReadonlyArray<OverrideEntryRow>,
  s: Pick<Situation, "disasterAt" | "now">,
): Map<string, StoredOverride> {
  const out = new Map<string, StoredOverride>();
  for (const r of rows) {
    if (!withinDisaster(r.occurred_at, s)) continue;
    const p = parseOverridePayload(r.payload);
    if (!p) continue;
    if (p.to === null) {
      out.delete(r.person_id);
      continue;
    }
    out.set(r.person_id, {
      to: p.to,
      baseAtOverride: p.baseAtOverride,
      reason: p.reason,
      by: r.author_id ?? "",
      at: r.occurred_at,
      byName: r.author_name,
    });
  }
  return out;
}

const OVERRIDE_SELECT = `SELECT t.person_id, t.author_id, a.display_name AS author_name, t.payload, t.occurred_at
    FROM timeline_entries t LEFT JOIN accounts a ON a.id = t.author_id`;

/** 事業所の本人の今の上書き（発災から今まで） */
export async function loadOfficeOverrides(
  db: D1Database,
  officeId: string,
  s: Pick<Situation, "disasterAt" | "now">,
): Promise<Map<string, StoredOverride>> {
  const res = await db
    .prepare(
      `${OVERRIDE_SELECT}
        WHERE t.kind = 'override' AND t.person_id IN (SELECT id FROM people WHERE office_id = ?1)
        ORDER BY t.occurred_at, t.created_at, t.id`,
    )
    .bind(officeId)
    .all<OverrideEntryRow>();
  return latestOverrides(res.results, s);
}

/** 1 人の今の上書き（発災から今まで） */
export async function loadPersonOverride(
  db: D1Database,
  personId: string,
  s: Pick<Situation, "disasterAt" | "now">,
): Promise<StoredOverride | undefined> {
  const res = await db
    .prepare(`${OVERRIDE_SELECT} WHERE t.kind = 'override' AND t.person_id = ?1 ORDER BY t.occurred_at, t.created_at, t.id`)
    .bind(personId)
    .all<OverrideEntryRow>();
  return latestOverrides(res.results, s).get(personId);
}

