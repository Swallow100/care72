import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { locationPost, signalError } from "@/lib/signals/http";

type Ctx = { params: Promise<{ id: string }> };

// 本人のスマホの端末の位置（T69b）。赤のあとの「いまの 場所を おくりますか」で はい を押したときだけ、自分の赤の信号に添える。
// 位置は本文の JSON で受け、URL に載せない。台帳の位置とは別の列（本人が今いる所）。Claude には渡さない。
// 色と順は変わらない（ルールの表に渡さない）。本人の役だけ（家族・ケアマネは 404・403）。平時は 409
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return locationPost(env.DB, principal, id, json);
}
