import { getCloudflareContext } from "@opennextjs/cloudflare";

// 手元と配信先で binding が見えているかを確かめる。値や秘密は返さない。
export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  return Response.json({
    ok: true,
    bindings: {
      DB: Boolean(env.DB),
      RECORDINGS: Boolean(env.RECORDINGS),
    },
  });
}
