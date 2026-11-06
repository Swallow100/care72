import { isSameOrigin } from "@/lib/auth/cookie";
import { allows } from "@/lib/auth/guard";
import { principalFromRequest } from "@/lib/auth/server";
import { aiContextFor } from "@/lib/claude/cloudflare";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isTalkFixedId, isTalkHash, promptVoice, talkFixedVoice, talkVoiceByHash, warmTalkVoices } from "@/lib/signals/voice";

// 会話の決まった文の声を作り置く（T137b）。本人のスマホが赤を押した時に 1 回頼む。置いてある物は作らない。
// 応答はすぐ返し（202）、作るのは応答のあと（waitUntil）。本人・家族のスマホ（録音を持つ役）だけ
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  if (!principal) return new Response(null, { status: 401 });
  if (!allows(principal, "recording") || !principal.office) return new Response(null, { status: 403 });
  const { ctx } = await getCloudflareContext({ async: true });
  const officeId = principal.office.id;
  ctx.waitUntil(
    aiContextFor(officeId)
      .then((ai) => warmTalkVoices(env.RECORDINGS, ai))
      .catch((e) => console.error("会話の声を作り置けない", e instanceof Error ? e.name : typeof e)),
  );
  return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
}

// 定型文（AI の告知「これはAI、人ではないしくみが聞いています…」＋「大丈夫ですか。状況を説明してください」。lib/signals/phrases.ts の VOICE_PROMPT_TEXT）の声（WAV）。本人・家族のスマホ（録音を持つ役）だけ。
// Gemini TTS の鍵があれば 1 回だけ作って R2 に置き、次からはそれを返す。鍵が無い・作れないときは 404
// （端末はブラウザの speechSynthesis で同じ文を読む）。名前は入れない。
// 声の聞き取りの会話（T137）: ?fixed=id は会話の決まった文（文はサーバーの表から引く。作り方は定型文と同じ）、
// ?talk=hash は会話の API が作って置いた AI の 1 文（読むだけで作らない）
export async function GET(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  const { principal, env } = await principalFromRequest(request);
  if (!principal) return new Response(null, { status: 401 });
  if (!allows(principal, "recording") || !principal.office) return new Response(null, { status: 403 });
  const url = new URL(request.url);
  const fixed = url.searchParams.get("fixed");
  const talk = url.searchParams.get("talk");
  const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  let audio: Uint8Array | null;
  if (talk !== null) {
    if (!isTalkHash(talk)) return notFound();
    audio = await talkVoiceByHash(env.RECORDINGS, talk);
  } else if (fixed !== null) {
    if (!isTalkFixedId(fixed)) return notFound();
    audio = await talkFixedVoice(env.RECORDINGS, fixed, await aiContextFor(principal.office.id));
  } else {
    audio = await promptVoice(env.RECORDINGS, await aiContextFor(principal.office.id));
  }
  if (!audio) return notFound();
  return new Response(audio.slice(), {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "private, max-age=86400" },
  });
}
