// パスワードの受け口。ログイン（login）とセッションの確かめ（principalOf）の両方がここを通る（2 か所で食い違わないように）。
//
// 審査員: env の JUDGE_PASSWORD_HASH（npm run hash-password の 1 行）。無ければ JUDGE_PASSWORD（平文）。
// 山本（確認用の事業所のケアマネ、T144。前はデモ事業所の acct-yamamoto）: env の CAREMANAGER_DEMO_PASSWORD_HASH → CAREMANAGER_DEMO_PASSWORD（平文）→ 種の accounts.password_hash の順。
//   env を先にするのは、作者がダッシュボードの Secrets に貼った値が必ず効くように（種にハッシュが残っていても）。
// ほかのアカウント: accounts.password_hash だけ。
//
// 平文はスマホからダッシュボードの Secrets に貼れるようにするための道。平文は Cloudflare の secret（手元は .dev.vars）にだけあり、
// DB・コード・ログ・画面・応答に出さない。env の値の前後の空白は落とす（貼ったときの改行）。打ったパスワードは落とさない。

import { LOGIN_CARE_MANAGER_ID } from "./demo.ts";
import { verifyPassword, verifyPlainPassword } from "./password.ts";
import { passwordVersion, plainPasswordVersion } from "./session.ts";

export type CredentialEnv = {
  JUDGE_PASSWORD_HASH?: string;
  JUDGE_PASSWORD?: string;
  CAREMANAGER_DEMO_PASSWORD_HASH?: string;
  CAREMANAGER_DEMO_PASSWORD?: string;
};

/** 確かめ方。hash は PBKDF2 のハッシュ、plain は平文の secret */
export type Credential = { kind: "hash"; hash: string } | { kind: "plain"; password: string };

function setting(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** ハッシュが有ればハッシュ、無ければ平文。どちらも無ければ null */
function fromEnv(hash: string | undefined, plain: string | undefined): Credential | null {
  const h = setting(hash);
  if (h) return { kind: "hash", hash: h };
  const p = setting(plain);
  return p ? { kind: "plain", password: p } : null;
}

export function judgeCredential(env: CredentialEnv): Credential | null {
  return fromEnv(env.JUDGE_PASSWORD_HASH, env.JUDGE_PASSWORD);
}

/** アカウントの確かめ方。山本だけ env を先に見る */
export function accountCredential(
  env: CredentialEnv,
  account: { id: string; password_hash: string | null },
): Credential | null {
  if (account.id === LOGIN_CARE_MANAGER_ID) {
    const c = fromEnv(env.CAREMANAGER_DEMO_PASSWORD_HASH, env.CAREMANAGER_DEMO_PASSWORD);
    if (c) return c;
  }
  return account.password_hash ? { kind: "hash", hash: account.password_hash } : null;
}

/** 打ったパスワードが合うか。確かめ方が無くても同じだけ時間をかけて false */
export async function verifyCredential(password: string, c: Credential | null): Promise<boolean> {
  if (c?.kind === "plain") return verifyPlainPassword(password, c.password);
  return verifyPassword(password, c?.hash ?? null);
}

/** cookie に入れる指紋（pv）。確かめ方の値が変わると前のセッションは切れる */
export async function credentialVersion(c: Credential, secret: string): Promise<string> {
  return c.kind === "hash" ? passwordVersion(c.hash) : plainPasswordVersion(c.password, secret);
}
