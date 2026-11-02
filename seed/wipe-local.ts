// node seed/wipe-local.ts で手元の D1 の模擬（.wrangler/state/v3/d1）を消す。
// 配信の前なので migrations/0001_init.sql を直すことがあり、直したあとは migration 済みの扱いで流し直されない。
// そのときに npm run db:fresh（これのあとに db:reset）を使う。本物の D1 には触らない。
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, ".wrangler", "state", "v3", "d1");
rmSync(target, { recursive: true, force: true });
console.log(`消した: ${target}`);
