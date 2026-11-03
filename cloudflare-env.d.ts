// wrangler.jsonc の binding と、secret・変数の型。binding や secret を足したらここにも足す。
// workers-types は全体に入れず、使う型だけ読む（DOM の Response などとぶつからないように）。
import type { D1Database, Fetcher, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    RECORDINGS: R2Bucket;
    ASSETS: Fetcher;
    // secret と変数。配信は Cloudflare の secret（T27）、手元は .dev.vars（.dev.vars.example を写す）。
    // 入っていないことがあるので全部 undefined を許す。値を画面・ログ・応答に出さない
    ANTHROPIC_API_KEY?: string;
    GEMINI_API_KEY?: string;
    /** 配信の Secret がこの名前で入っている（11/3）。GEMINI_API_KEY が正で、無ければこちらを読む */
    GEMINI_TTS?: string;
    // 審査員と山本のパスワード。ハッシュが先、無ければ平文（lib/auth/credential.ts）
    JUDGE_PASSWORD_HASH?: string;
    JUDGE_PASSWORD?: string;
    CAREMANAGER_DEMO_PASSWORD_HASH?: string;
    CAREMANAGER_DEMO_PASSWORD?: string;
    SESSION_SECRET?: string;
    /** デモ事業所の AI の 1 日の上限（回）。無ければ 200 */
    AI_DAILY_LIMIT?: string;
    // アンケートの頁（T42）の Cloudflare Turnstile。両方あるときだけ効く（lib/survey/turnstile.ts）
    TURNSTILE_SITE_KEY?: string;
    TURNSTILE_SECRET_KEY?: string;
  }
}

export {};
