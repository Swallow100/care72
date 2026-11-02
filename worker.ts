// Workers の入口（wrangler.jsonc の main）。OpenNext が作る .open-next/worker.js の fetch をそのまま使い、
// 毎日 4 時（日本の時刻）の cron の scheduled を足す（OpenNext の文書「Custom Worker」の形）。
// .open-next/worker.js は npm run cf:build で作られる（build の前は無いので型の検査を外す）。
// Durable Objects（OpenNext のキャッシュの DO）は使っていないので再輸出しない。使うときはここで再輸出する。

import type { ExecutionContext, ExportedHandler, ScheduledController } from "@cloudflare/workers-types";
// @ts-ignore build で作られる
import { default as handler } from "./.open-next/worker.js";
import { scheduledReset } from "./lib/seed/cron.ts";

export default {
  fetch: handler.fetch,
  async scheduled(controller: ScheduledController, env: CloudflareEnv, _ctx: ExecutionContext) {
    await scheduledReset(env, controller.cron, controller.scheduledTime);
  },
} satisfies ExportedHandler<CloudflareEnv>;
