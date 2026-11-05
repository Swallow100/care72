import { isSameOrigin } from "@/lib/auth/cookie";
import { principalFromRequest } from "@/lib/auth/server";
import { entriesError, handleEntries } from "@/lib/forms/form-entries-http";

// 紙の手入れ（T135）: 様式だけの欄の値・文字の枠・画像を入れる・取り消す、紙から台帳に入れる。中身は lib/forms/form-entries-http.ts
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return entriesError("forbidden");
  const { principal, env } = await principalFromRequest(request);
  return handleEntries(env.DB, principal, await request.json().catch(() => null));
}
