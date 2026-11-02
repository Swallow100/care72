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
import { fullSeedStatements, seedRecordingFile } from "./full.ts";

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

// デモ事業所の災害モード・山田の赤・終わった訓練（lib/seed）。時刻は今から数える（発災 4 時間前・停電 3 時間前・赤 1 時間前）。
// 種の録音（seed/recordings/p-01.webm か p-01.m4a）があれば信号に結ぶ。R2 に上げるのは seed/put-recording.ts
const now = new Date().toISOString();
const audio = seedRecordingFile(here);
const outDir = join(here, "generated");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "seed.sql");
const passwordHashes: Record<string, string> = demoHash ? { [DEMO_CARE_MANAGER_ID]: demoHash } : {};
const statements = await fullSeedStatements({ passwordHashes, now, recording: audio ? { key: audio.key, durationSec: null } : null });
writeFileSync(
  outFile,
  `-- npm run db:seed が seed/people.ts と lib/seed から作る。手で直さない。git に入れない（ハッシュが入ることがある）。\n${statements.join("\n")}\n`,
  "utf8",
);
console.log(`書いた: ${outFile}`);
console.log(`山本のパスワード: ${demoHash ? "設定済" : "未設定（ログイン不可）"}`);
console.log(`種の録音: ${audio ? audio.key : "なし（文字起こしと分類だけ）"}`);
