import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { summaryPost } from "@/lib/classify/summary-http";
import { signalError } from "@/lib/signals/http";

type Ctx = { params: Promise<{ id: string }> };

// 録音のまとめ（T69b）。ケアマネが直す（JSON { text }。人の文になり AI の印が外れ、経過に「まとめ修正」）か、
// まとめがまだ無い信号で「生成」（text 無し。Claude〔Haiku〕をもう一度 1 回、待ちは 20 秒）。ケアマネの役だけ。
// まとめは色と連絡の順に使わない（ルールの表に渡さない）。事業所の外の信号・訓練の信号は 404
export async function POST(request: Request, { params }: Ctx) {
  if (!isSameOrigin(request)) return signalError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  const { id } = await params;
  const json = await request.json().catch(() => null);
  return summaryPost(env.DB, principal, id, json, new Date().toISOString(), { ai: (officeId) => aiContextFor(officeId) });
}
