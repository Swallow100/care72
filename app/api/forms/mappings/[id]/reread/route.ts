import { isSameOrigin } from "@/lib/auth/cookie";
import { denied } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { formsScope } from "@/lib/forms/mapping-db";
import { mappingError } from "@/lib/forms/mapping-http";
import { formRereadPost } from "@/lib/forms/read-post";

type Props = { params: Promise<{ id: string }> };

// 様式の読み取りで読めなかった頁を読み直す（T120）。置いた頁の画像（黒塗りの画面を通した物）から、読めなかった頁だけを Opus で読み、
// 欄を足す。中身は lib/forms/read-post.ts の formRereadPost。ケアマネの役だけ。範囲は事業所。版が違えば 409
export async function POST(request: Request, { params }: Props) {
  if (!isSameOrigin(request)) return mappingError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const no = denied(principal, "ai");
  if (no) return no;
  const scope = formsScope(principal);
  if (!scope) return mappingError("forbidden");
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return mappingError("not_found");
  const body = (await request.json().catch(() => null)) as { version?: unknown } | null;
  if (!body || typeof body.version !== "number" || !Number.isInteger(body.version)) return mappingError("invalid");

  return formRereadPost(
    {
      db: env.DB,
      bucket: {
        put: (key, value, options) => env.RECORDINGS.put(key, value, options),
        get: (key) => env.RECORDINGS.get(key),
      },
      aiContext: aiContextFor,
    },
    scope,
    id,
    body.version,
  );
}
