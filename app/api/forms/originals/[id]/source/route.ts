import { principalFromRequest } from "@/lib/auth/server";
import { originalSourceGet } from "@/lib/forms/originals-http";

type Ctx = { params: Promise<{ id: string }> };

// 元の様式の原本を公式の URL から取る（T101）。取る先は lib/forms/originals.ts の ORIGINALS の url だけ（要求から URL を受けない）。
// 版のハッシュが違えば 409。事業所には置かない（置くのは取り込みの POST）
export async function GET(request: Request, { params }: Ctx) {
  const { principal } = await principalFromRequest(request);
  const { id } = await params;
  return originalSourceGet((url) => fetch(url, { redirect: "follow" }), principal, id);
}
