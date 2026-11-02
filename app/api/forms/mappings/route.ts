import * as z from "zod";
import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { LIMITS } from "@/lib/forms/mapping";
import { formsScope, insertManualMapping } from "@/lib/forms/mapping-db";
import { mappingError, NO_STORE } from "@/lib/forms/mapping-http";

const Body = z.object({ title: z.string().trim().min(1).max(LIMITS.title) });

// 対応表を手で作る（AI 未設定のときの道。AI があっても使える）。欄なしの下書きを作り、確かめる画面で欄を足す。
// ケアマネの役だけ。範囲は事業所
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return mappingError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "save");
  if (no) return no;
  const scope = formsScope(principal);
  if (!scope) return mappingError("forbidden");

  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return mappingError("invalid");
  const id = await insertManualMapping(env.DB, {
    id: crypto.randomUUID(),
    officeId: scope.officeId,
    title: body.data.title,
    by: scope.accountId,
    at: new Date().toISOString(),
  });
  return Response.json({ ok: true, id }, { headers: NO_STORE });
}
