import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { parseMappingInput } from "@/lib/forms/mapping";
import { formsScope, saveCheckedMapping } from "@/lib/forms/mapping-db";
import { mappingError, NO_STORE } from "@/lib/forms/mapping-http";

type Props = { params: Promise<{ id: string }> };

// 確かめた対応表を保存する（確認済にする。差し込みに使えるのはこれから）。台帳に無い項目名があれば断る。
// 版が違えば 409（ほかの人が先に保存した）。ケアマネの役だけ。範囲は事業所（ほかの事業所の id は 404）
export async function PUT(request: Request, { params }: Props) {
  if (!isSameOrigin(request)) return mappingError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "save");
  if (no) return no;
  const scope = formsScope(principal);
  if (!scope) return mappingError("forbidden");
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return mappingError("not_found");

  const body = (await request.json().catch(() => null)) as { version?: unknown; mapping?: unknown } | null;
  if (!body || typeof body.version !== "number" || !Number.isInteger(body.version)) return mappingError("invalid");
  const parsed = parseMappingInput(body.mapping);
  if (!parsed.ok) return mappingError(parsed.error === "unknown_item" ? "unknown_item" : "invalid", parsed.at);
  if (parsed.mapping.fields.filter((f) => !f.removed).length === 0) return mappingError("invalid");

  const saved = await saveCheckedMapping(env.DB, {
    officeId: scope.officeId,
    id,
    version: body.version,
    mapping: parsed.mapping,
    by: scope.accountId,
    at: new Date().toISOString(),
  });
  if (!saved.ok) return mappingError(saved.error);
  return Response.json({ ok: true, version: saved.version }, { headers: NO_STORE });
}
