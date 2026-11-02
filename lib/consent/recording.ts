// 録音の範囲（docs/tasks/T24.md）。録音の再生の API（app/api/recordings/[signal]）が、lib/list/recording.ts の recordingGet の前に呼ぶ。
// 録音は医療班・行政の同意の範囲（本人確認・医療・避難・人の一部）にも、家族・支援者の範囲にも無いので開けない。
// 範囲の外は、壁の外と同じ 404「対象なし」（在ることも言わない）。ログイン・役・信号の形・壁は recordingGet が見る。

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import { roleAllows } from "../auth/roles.ts";
import type { ConsentKind, ConsentStatus, PersonOrigin } from "../db/types.ts";
import { viewScope } from "./scope.ts";

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } as const;

/** 範囲の外なら 404 の応答。範囲の中・ログインしていない・信号が無いときは null（recordingGet に任せる） */
export async function recordingScopeRefusal(db: D1Database, p: Principal | null, signalId: string): Promise<Response | null> {
  if (!p || !roleAllows(p.role, "read")) return null;
  const person = await db
    .prepare("SELECT p.id, p.origin FROM signals s JOIN people p ON p.id = s.person_id WHERE s.id = ?1")
    .bind(signalId)
    .first<{ id: string; origin: PersonOrigin }>();
  if (!person) return null;
  const consents = await db
    .prepare("SELECT kind, status, scope FROM consents WHERE person_id = ?1")
    .bind(person.id)
    .all<{ kind: ConsentKind; status: ConsentStatus; scope: string | null }>();
  if (viewScope(p.role, { consents: consents.results, origin: person.origin }).recordings) return null;
  return Response.json({ ok: false, label: "対象なし" }, { status: 404, headers: HEADERS });
}
