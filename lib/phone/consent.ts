// スマホ入口（本人・家族のリンクと ID）を作ってよいかの同意の決まり（1 か所。T149）。
// 決め（案、docs/DECISIONS.md「本人・家族のスマホと聞き取り」）: 「計画共有」（計画を作り、避難支援等関係者と事前に共有）が「同意」の人だけ。
// 未確認・不同意・行なしは作れない（新しい人は全部「未確認」で入る。T69a）。
// 本人用と家族用で同じ決まり（家族の頁の経過は今どおり「支援者提供」の同意で出し分ける。lib/signals/family.ts）。
// 画面（本人のページのスマホの面・スマホ入口の画面）はこれで押せなくし、理由「同意なし」。本人・家族の ID 作り（lib/phone/account.ts）もこれで断る。
// 発行の API のサーバーの決まりは T147 が入れる（同じ関数を使うと揃う）。

import type { ConsentKind, ConsentStatus } from "../db/types.ts";

/** スマホ入口の前に要る同意の種類 */
export const PHONE_ENTRY_CONSENT: ConsentKind = "plan_share";

export function phoneEntryAllowed(consents: ReadonlyArray<{ kind: ConsentKind; status: ConsentStatus }>): boolean {
  return consents.some((c) => c.kind === PHONE_ENTRY_CONSENT && c.status === "granted");
}
