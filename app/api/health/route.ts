import { getCloudflareContext } from "@opennextjs/cloudflare";
import { hasAnthropicKey, hasGeminiKey } from "@/lib/claude/client";

// 手元と配信先で binding と鍵が見えているかを確かめる。値や秘密は返さない（有る・無いだけ）。
export async function GET() {
  const { env } = await getCloudflareContext({ async: true });
  return Response.json({
    ok: true,
    bindings: {
      DB: Boolean(env.DB),
      RECORDINGS: Boolean(env.RECORDINGS),
    },
    ai: {
      anthropic: hasAnthropicKey(env),
      gemini: hasGeminiKey(env),
    },
  });
}
