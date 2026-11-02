import { clearSessionCookie, isSameOrigin, seeOther } from "@/lib/auth/cookie";

// ログアウト。cookie を消してゲストの入口（担当一覧）へ。GET では消さない（リンクの先読みで抜けないように）
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });
  return seeOther(request, "/", clearSessionCookie(request.url));
}
