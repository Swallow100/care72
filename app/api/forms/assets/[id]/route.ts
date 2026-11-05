import { principalFromRequest } from "@/lib/auth/server";
import { assetGet } from "@/lib/forms/form-assets";

type Ctx = { params: Promise<{ id: string }> };

// 紙に置いた画像（T135）。自分の事業所の物だけ（ほかは 404）。中身は lib/forms/form-assets.ts
export async function GET(request: Request, { params }: Ctx) {
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  return assetGet(env.DB, { get: (key) => env.RECORDINGS.get(key) }, principal, id);
}
