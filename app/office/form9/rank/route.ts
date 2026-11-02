import { todayJst } from "@/lib/age";
import { isSameOrigin, seeOther } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { parseRankForm } from "@/lib/forms/form9";
import { form9Scope, insertRankEdit, loadForm9, loadSituation } from "@/lib/forms/form9-db";
import { form9Href, parseSort } from "@/lib/forms/form9-href";

// 様式 9 の優先順位の手直し（フォームの POST）。順位と理由を 1 行足し、表に戻る。「手直し解除」は順位なしの行を足す。
// 自動の順位と並び（平時・発災時）はサーバーで読み直して入れる（フォームの値は使わない）。範囲は事業所（事業所の壁）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "save");
  if (no) return no;
  const scope = form9Scope(principal);
  if (!scope || !principal) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });

  const form = await request.formData().catch(() => null);
  const sort = parseSort(form?.get("sort"));
  const situation = await loadSituation(env.DB, scope.officeId);
  const data = await loadForm9(env.DB, scope, { today: todayJst(), situation });
  if (!data) return seeOther(request, form9Href({ sort }));

  const parsed = parseRankForm(
    { person: form?.get("person"), rank: form?.get("rank"), reason: form?.get("reason"), clear: form?.get("clear") },
    data.sheet.rows.length,
  );
  if (!parsed.ok) return seeOther(request, form9Href({ sort, edit: parsed.personId, error: parsed.error }));

  const row = data.sheet.rows.find((r) => r.id === parsed.value.personId);
  const saved =
    row !== undefined &&
    (await insertRankEdit(env.DB, {
      id: crypto.randomUUID(),
      officeId: scope.officeId,
      personId: row.id,
      mode: data.sheet.mode,
      rank: parsed.value.rank,
      autoRank: row.autoRank,
      reason: parsed.value.reason,
      setBy: principal.accountId,
      setAt: new Date().toISOString(),
    }));
  if (!saved) return seeOther(request, form9Href({ sort, edit: parsed.value.personId, error: "person" }));
  return seeOther(request, `${form9Href({ sort })}#row-${row.id}`);
}
