import { isSameOrigin } from "@/lib/auth/cookie";
import { allows } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { promptVoice } from "@/lib/signals/voice";

// 定型文「大丈夫ですか。状況を説明してください」の声（WAV）。本人・家族のスマホ（録音を持つ役）だけ。
// Gemini TTS の鍵があれば 1 回だけ作って R2 に置き、次からはそれを返す。鍵が無い・作れないときは 404
// （端末はブラウザの speechSynthesis で同じ文を読む）。名前は入れない
export async function GET(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  if (!principal) return new Response(null, { status: 401 });
  if (!allows(principal, "recording") || !principal.office) return new Response(null, { status: 403 });
  const audio = await promptVoice(env.RECORDINGS, await aiContextFor(principal.office.id));
  if (!audio) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(audio.slice(), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" },
  });
}
