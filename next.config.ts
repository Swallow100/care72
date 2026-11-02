import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // next dev が根に AGENTS.md を書くのを止める。リポジトリの決まりは CLAUDE.md にある。
  agentRules: false,
};

export default nextConfig;

// next dev でも getCloudflareContext() から D1・R2 を手元の模擬で使えるようにする。
// wrangler.jsonc の binding を読み、.wrangler/state に置く。ネットには出ない。
initOpenNextCloudflareForDev();
