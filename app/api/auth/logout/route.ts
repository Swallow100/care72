import { clearSessionCookie, isSameOrigin, seeOther } from "@/lib/auth/cookie";
import { LOGIN_PATH } from "@/lib/auth/roles";

// ログアウト。cookie を消してログインの画面へ。GET では消さない（リンクの先読みで抜けないように）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  return seeOther(request, LOGIN_PATH, clearSessionCookie(request.url));
}
