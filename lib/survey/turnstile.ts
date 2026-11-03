// Cloudflare Turnstile（ボットの確かめ）。TURNSTILE_SITE_KEY と TURNSTILE_SECRET_KEY の両方があるときだけ効く。
// 無ければ頁に何も出さず、送信でも確かめない（ほかの守り〔token・見えない欄・15 秒・回数〕だけ）。鍵はリポジトリに書かない。

export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileKeys = { siteKey: string; secretKey: string };

export function turnstileKeys(env: { TURNSTILE_SITE_KEY?: string; TURNSTILE_SECRET_KEY?: string }): TurnstileKeys | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim();
  return siteKey && secretKey ? { siteKey, secretKey } : null;
}

export type TurnstileVerify = (secretKey: string, response: string, ip: string) => Promise<boolean>;

/** Turnstile の答え（頁の部品が作る 1 回きりの文字）を Cloudflare に確かめる。通らない・届かないは false */
export const verifyTurnstile: TurnstileVerify = async (secretKey, response, ip) => {
  try {
    const form = new URLSearchParams({ secret: secretKey, response });
    if (ip !== "local") form.set("remoteip", ip);
    const res = await fetch(SITEVERIFY, { method: "POST", body: form, redirect: "manual" });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { success?: unknown } | null;
    return data?.success === true;
  } catch {
    return false;
  }
};
