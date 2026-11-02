import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { abandonPost, drillError } from "@/lib/drill/http";

type Ctx = { params: Promise<{ id: string }> };

// 中断（進行中だけ）。記録は残り、再生できる
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return drillError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  return abandonPost(env.DB, principal, id, new Date().toISOString());
}
