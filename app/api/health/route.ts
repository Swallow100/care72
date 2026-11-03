import { getCloudflareContext } from "@opennextjs/cloudflare";
import { healthBody } from "@/lib/health";
import { BUILT_AT, COMMIT } from "@/lib/version";

// 手元と配信先で binding と鍵が見えているか、配信中の commit と build の時刻（lib/health.ts）。値や秘密は返さない（有る・無いだけ）。
// lib/version.ts は build のときに作る（tools/deploy/write-version.ts、commit しない）。
export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  return Response.json(healthBody(env, { commit: COMMIT, builtAt: BUILT_AT }), {
    headers: { "Cache-Control": "no-store" },
  });
}
