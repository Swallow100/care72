import { principalFromRequest } from "@/lib/auth/server";
import { pageImageGet } from "@/lib/forms/page-image-http";

type Ctx = { params: Promise<{ id: string; page: string }> };

// 様式の頁の画像（T86）。場所の確かめの画面と、元の様式の上に値を置く紙の下に敷く画像。
// 自分の事業所の対応表だけ（ほかは 404）。ケアマネの役でなければ 403。中身は lib/forms/page-image-http.ts
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { id, page } = await params;
  return pageImageGet(env.DB, { get: (key) => env.RECORDINGS.get(key) }, principal, id, page);
}
