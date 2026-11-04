import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { IMPORT_MAX_BYTES, originalError, originalImportPost } from "@/lib/forms/originals-http";

type Ctx = { params: Promise<{ id: string }> };

// 元の様式の原本の取り込み（T101）。ブラウザが公式の PDF と刷る解像度の頁の PNG を送る。
// PDF のハッシュが欄の矩形を起こした版と同じときだけ、頁の PNG を事業所の R2 に置く。中身は lib/forms/originals-http.ts
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return originalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > IMPORT_MAX_BYTES) return originalError("invalid");
  const form = await request.formData().catch(() => null);
  if (!form) return originalError("invalid");
  return originalImportPost(
    {
      put: (key, value, options) => env.RECORDINGS.put(key, value, options),
      get: (key) => env.RECORDINGS.get(key),
    },
    principal,
    id,
    form,
  );
}
