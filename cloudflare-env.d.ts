// wrangler.jsonc の binding の型。binding を足したらここにも足す。
// workers-types は全体に入れず、使う型だけ読む（DOM の Response などとぶつからないように）。
import type { D1Database, Fetcher, R2Bucket } from "@cloudflare/workers-types";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    RECORDINGS: R2Bucket;
    ASSETS: Fetcher;
  }
}

export {};
