import { todayJst } from "@/lib/age";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { csvFileNames, form9Csv } from "@/lib/forms/form9-csv";
import { form9Scope, loadForm9, loadSituation } from "@/lib/forms/form9-db";
import { loadForm9Entries, withForm9Entries } from "@/lib/forms/form9-fill";

// 様式 9 の CSV を落とす（UTF-8 の BOM、CRLF。Excel でそのまま開ける）。並びはいつも優先順位の順。
// ログインしていなければ 401、ケアマネの役でなければ 403。範囲は事業所
export async function GET(request: Request) {
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "read");
  if (no) return no;
  const scope = form9Scope(principal);
  if (!scope) return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });

  const situation = await loadSituation(env.DB, scope.officeId);
  const loaded = await loadForm9(env.DB, scope, { today: todayJst(), situation });
  if (!loaded) return Response.json({ error: "not_found", label: "該当なし" }, { status: 404 });
  // 紙の上で書いた行の欄（T147）も紙と同じに
  const data = { ...loaded, sheet: withForm9Entries(loaded.sheet, await loadForm9Entries(env.DB, scope.officeId)) };

  const madeAt = new Date().toISOString();
  const names = csvFileNames(madeAt);
  return new Response(form9Csv(data.sheet, { officeName: data.office.name, madeAt }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${names.ascii}"; filename*=UTF-8''${encodeURIComponent(names.utf8)}`,
      "Cache-Control": "no-store",
    },
  });
}
