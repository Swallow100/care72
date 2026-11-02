// node seed/build-sql.ts で seed/generated/seed.sql を書く（Node の型の取り除きで動く）。
// 山本（デモ事業所のケアマネ）のパスワードのハッシュは CAREMANAGER_DEMO_PASSWORD_HASH から入れる。
// 環境変数を先に見て、無ければ手元の .dev.vars から、この 1 つだけを取り出す（ほかの値は使わない・出さない）。
// 無ければ種の山本はハッシュなし（審査員では開ける）。ハッシュは npm run hash-password で作る。
// 種にハッシュが無くても、Worker の env に CAREMANAGER_DEMO_PASSWORD_HASH か CAREMANAGER_DEMO_PASSWORD（平文）があれば
// 山本は入れる（lib/auth/credential.ts。env が種より先）。平文はここでは読まない（種に入れない）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { DEMO_CARE_MANAGER_ID } from "../lib/auth/demo.ts";
import { isPasswordHash } from "../lib/auth/password.ts";
import { seedSql } from "./sql.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const HASH_NAME = "CAREMANAGER_DEMO_PASSWORD_HASH";

function readSetting(name: string): string | null {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;
  const file = join(root, ".dev.vars");
  if (!existsSync(file)) return null;
  const value = parseEnv(readFileSync(file, "utf8"))[name]?.trim();
  return value ? value : null;
}

const demoHash = readSetting(HASH_NAME);
if (demoHash && !isPasswordHash(demoHash)) {
  console.error(`${HASH_NAME} の形が違う。npm run hash-password で作った 1 行をそのまま入れる`);
  process.exit(1);
}

const outDir = join(here, "generated");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "seed.sql");
const passwordHashes: Record<string, string> = demoHash ? { [DEMO_CARE_MANAGER_ID]: demoHash } : {};
writeFileSync(outFile, seedSql({ passwordHashes }), "utf8");
console.log(`書いた: ${outFile}`);
console.log(`山本のパスワード: ${demoHash ? "設定済" : "未設定（ログイン不可）"}`);
