import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { classEditError, classEditPost } from "@/lib/classify/http";

type Ctx = { params: Promise<{ id: string }> };

// 信号の分類（T12）をケアマネが直す。分類と書き手（ケアマネ）を信号に書き、経過に「分類修正 動けない（AI） → けが」。
// 以後は人の分類が効く（lib/triage が読む）。ケアマネの役だけ。事業所の外の信号は 404
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return classEditError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return classEditPost(env.DB, principal, id, json, new Date().toISOString());
}
