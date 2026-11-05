// 本人・家族の頁（app/me・app/family）の「準備」の欄に渡す物（T149）。D1・env・Principal を引数で受ける。
// - 通知の公開鍵: env の VAPID の 3 つが揃っているときだけ（lib/push/vapid.ts）。無ければ null（画面は「通知 未設定」）
// - ID の段: 審査員・役を替えた山本の本人・家族の役は出さない。ID で入った人とリンクで入って作った人は「済み」と ID。
//   リンクで入ってまだの人は作る欄（同意の決まり〔lib/phone/consent.ts〕に合わない人には出さない。作る API も断る）

import type { D1Database } from "@cloudflare/workers-types";
import type { Principal } from "../auth/principal.ts";
import type { ConsentKind, ConsentStatus } from "../db/types.ts";
import { vapidPublicKey, type VapidEnv } from "../push/vapid.ts";
import { livePhoneLoginId } from "./account.ts";
import { phoneEntryAllowed } from "./consent.ts";

export type SetupAccount = { kind: "hidden" } | { kind: "create" } | { kind: "done"; loginId: string };

export async function setupAccountOf(
  db: D1Database,
  p: Principal,
  consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>,
): Promise<SetupAccount> {
  if (!p.phoneEntry || !p.personId) return { kind: "hidden" };
  const contactId = p.role === "family" ? p.contactId : null;
  const loginId = await livePhoneLoginId(db, p.personId, contactId);
  if (loginId) return { kind: "done", loginId };
  if (p.phoneEntry !== "link" || !phoneEntryAllowed(consents)) return { kind: "hidden" };
  return { kind: "create" };
}

export async function phoneSetupProps(
  db: D1Database,
  env: VapidEnv,
  p: Principal,
  consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>,
): Promise<{ vapidKey: string | null; account: SetupAccount }> {
  return { vapidKey: vapidPublicKey(env), account: await setupAccountOf(db, p, consents) };
}
