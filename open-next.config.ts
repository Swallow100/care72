import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 既定のまま。キャッシュ（R2 の incremental cache など）は要るときに足す。
export default defineCloudflareConfig();
