import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { SECURITY_HEADERS } from "./lib/security/headers.ts";

const nextConfig: NextConfig = {
  // next dev が根に AGENTS.md を書くのを止める。リポジトリの決まりは CLAUDE.md にある。
  agentRules: false,
  // 安全のための見出しを全部の道に（中身と理由は lib/security/headers.ts）
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
};

export default nextConfig;

// next dev でも getCloudflareContext() から D1・R2 を手元の模擬で使えるようにする。
// wrangler.jsonc の binding を読み、.wrangler/state に置く。ネットには出ない。
initOpenNextCloudflareForDev();
