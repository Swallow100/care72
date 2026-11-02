// ケアマネの上書きを書く（docs/tasks/T13.md）。読む側（payload の形・今の上書き）は lib/disaster/override.ts。
// baseAtOverride（上書きしたときの表の色）は画面から受け取らず、保存のときにサーバーで本人を表に当て直して決める
// （本人のページと同じ lib/disaster/person.ts の personDisaster。今の上書きも当てた色が「今の色」）。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import { MAX_OVERRIDE_REASON, OVERRIDE_SOURCE, type OverridePayload } from "../disaster/override.ts";
import { personDisaster } from "../disaster/person.ts";
import { COLOR_LABELS } from "../labels.ts";
import { loadPersonPage } from "../person.ts";
import type { Color } from "../triage/index.ts";

export type OverrideInput = { personId: string; to: Color | null; reason: string };

export type OverrideError = "forbidden" | "not_found" | "normal" | "invalid" | "same";

export type OverrideResult = { ok: true; from: Color; to: Color } | { ok: false; error: OverrideError };

/** 経過の 1 行「要確認→至急 近所で土砂」「解除 至急→要確認」 */
export function overrideLogBody(from: Color, to: Color, reason: string, cleared: boolean): string {
  const move = `${COLOR_LABELS[from]}→${COLOR_LABELS[to]}`;
  const r = reason.trim();
  return [cleared ? "解除" : null, move, r || null].filter((s) => s !== null).join(" ");
}

/**
 * 上書きを書く。ケアマネの役だけ（審査員のケアマネの役を含む）、事業所の中の本人だけ、災害モードの間だけ。
 * 理由が要る（解除は無くてよい）。今の色（上書きを当てたあと）と同じ色には上書きしない。解除は上書きがあるときだけ
 */
export async function saveOverride(
  db: D1Database,
  p: Principal | null,
  input: OverrideInput,
  now: string,
): Promise<OverrideResult> {
  if (!p || p.role !== "care_manager" || !roleAllows(p.role, "save")) return { ok: false, error: "forbidden" };
  const reason = input.reason.trim();
  if (reason.length > MAX_OVERRIDE_REASON) return { ok: false, error: "invalid" };
  if (input.to !== null && !reason) return { ok: false, error: "invalid" };

  const rows = await loadPersonPage(db, p, input.personId);
  if (!rows) return { ok: false, error: "not_found" };
  const d = await personDisaster(db, rows, now);
  if (!d.triage) return { ok: false, error: "normal" };
  const shown = d.triage.color;
  const base = d.triage.baseColor;

  let to: Color;
  if (input.to === null) {
    if (!d.triage.override) return { ok: false, error: "same" };
    to = base;
  } else {
    if (input.to === shown) return { ok: false, error: "same" };
    to = input.to;
  }

  const payload: OverridePayload = { source: OVERRIDE_SOURCE, to: input.to, baseAtOverride: base, reason };
  await db
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
       VALUES (?1, ?2, ?3, 'care_manager', 'override', ?4, ?5, ?6)`,
    )
    .bind(
      crypto.randomUUID(),
      rows.person.id,
      p.accountId,
      overrideLogBody(shown, to, reason, input.to === null),
      JSON.stringify(payload),
      now,
    )
    .run();
  return { ok: true, from: shown, to };
}
