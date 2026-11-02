// API の守り。読む・保存・Claude の呼び出し・録音の送信は、ログインと役で断る。
// 使い方（route の中で）:
//   const { principal } = await principalFromRequest(request);   // lib/auth/server.ts
//   const no = denied(principal, "save"); if (no) return no;

import type { Principal } from "./principal.ts";
import { roleAllows, type Need } from "./roles.ts";

export function allows(p: Principal | null, need: Need): boolean {
  return p !== null && roleAllows(p.role, need);
}

/** できなければ断りの応答。ログインしていなければ 401（ログイン要）、役で持たない物は 403。できれば null */
export function denied(p: Principal | null, need: Need): Response | null {
  if (allows(p, need)) return null;
  if (p === null) return Response.json({ error: "login_required", label: "ログイン要" }, { status: 401 });
  return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
}
