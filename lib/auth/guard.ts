// API の守り。保存・Claude の呼び出し・録音の送信は、役で断る（ゲストは読むだけ）。
// 使い方（route の中で）:
//   const { principal } = await principalFromRequest(request);   // lib/auth/server.ts
//   const no = denied(principal, "save"); if (no) return no;

import type { Principal } from "./principal.ts";
import { roleAllows, type Need } from "./roles.ts";

export function allows(p: Principal, need: Need): boolean {
  return roleAllows(p.role, need);
}

/** できなければ断りの応答。ゲストは 401（ログイン要）、ほかは 403。できれば null */
export function denied(p: Principal, need: Need): Response | null {
  if (allows(p, need)) return null;
  if (p.role === "guest") return Response.json({ error: "login_required", label: "ログイン要" }, { status: 401 });
  return Response.json({ error: "forbidden", label: "権限なし" }, { status: 403 });
}
