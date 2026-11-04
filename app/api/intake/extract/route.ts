import * as z from "zod";
import { todayJst } from "@/lib/age";
import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { questionQueue } from "@/lib/intake/ask";
import { extractIntake, INTAKE_TEXT_MAX } from "@/lib/intake/extract";
import { aiConsentRefusal, intakeError, intakeErrorOf } from "@/lib/intake/http";
import { loadPersonPage } from "@/lib/person";

const Body = z.object({
  personId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  text: z.string().trim().min(1).max(INTAKE_TEXT_MAX),
  /** 今の問いの場所（答えとして読ませる）。問いの言葉はサーバーの表から引く */
  focus: z.string().max(120).nullable().optional(),
});

// 入れる欄: ケアマネの文を Claude（Sonnet）が台帳の欄に分け、今の台帳と並べた差分を返す。書かない（保存は /api/intake/save）。
// ケアマネの役だけ（審査員のケアマネの役を含む）。本人は personInScope を通した人だけ。Claude の呼び出しは 1 要求 1 回
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return intakeError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "ai");
  if (no) return no;
  if (!principal || principal.role !== "care_manager" || !principal.office) return intakeError("forbidden");

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return intakeError("invalid");
  const rows = await loadPersonPage(env.DB, principal, body.data.personId);
  if (!rows) return intakeError("not_found");
  // AI 提供が不同意の人の台帳は Claude に渡さない（T74。未確認は通す）
  const refused = aiConsentRefusal(rows.consents);
  if (refused) return refused;
  const focus = body.data.focus ? (questionQueue(rows).find((q) => q.key === body.data.focus)?.focus ?? null) : null;

  try {
    const ctx = await aiContextFor(principal.office.id);
    const proposal = await extractIntake(rows, body.data.text, ctx, { today: todayJst(), focus });
    return Response.json({ ok: true, version: rows.person.version, ...proposal }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const res = intakeErrorOf(e);
    if (res) return res;
    console.error("入れる欄の分け方に失敗", e instanceof Error ? e.name : typeof e);
    return intakeError("ai_failed");
  }
}
