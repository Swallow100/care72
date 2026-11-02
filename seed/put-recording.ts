// node seed/put-recording.ts で、作者が置いた種の録音（seed/recordings/p-01.webm か p-01.m4a）を手元の R2（--local）に上げる。
// 無ければ何もしない（種の信号は文字起こしと分類だけで、画面は「録音なし」）。音のファイルはコードで作らない（権利が作者にある物を作者が置く）。
// 鍵は lib/seed/demo.ts の SEED_RECORDING_KEYS。「最初に戻す」はこの鍵を消さず、R2 にあれば信号に結ぶ。
// 配信先の R2 には作者が同じ鍵で 1 回上げる（docs/progress/t26.md）。ここは --local しか打たない。
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seedRecordingFile } from "./full.ts";

const BUCKET = "care72-recordings";
const here = dirname(fileURLToPath(import.meta.url));
const audio = seedRecordingFile(here);
if (!audio) {
  console.log("種の録音: なし（seed/recordings/p-01.webm か p-01.m4a を置くと上げる）");
} else {
  const args = ["wrangler", "r2", "object", "put", `${BUCKET}/${audio.key}`, `--file=${audio.path}`, `--content-type=${audio.contentType}`, "--local"];
  const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error("種の録音を手元の R2 に上げられない");
    process.exit(r.status ?? 1);
  }
  console.log(`種の録音: ${audio.key}`);
}
