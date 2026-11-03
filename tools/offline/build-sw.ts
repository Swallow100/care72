// public/sw.js の <core> の間を lib/offline/sw-core.js から写す（docs/tasks/T71.md）。
// 使い方: node tools/offline/build-sw.ts（sw-core.js を直したら打つ。lib/offline/sw.test.ts が写し忘れを見る）

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { embedCore } from "../../lib/offline/sw-build.ts";

const root = new URL("../../", import.meta.url);
const corePath = fileURLToPath(new URL("lib/offline/sw-core.js", root));
const swPath = fileURLToPath(new URL("public/sw.js", root));

const next = embedCore(readFileSync(corePath, "utf8"), readFileSync(swPath, "utf8"));
writeFileSync(swPath, next);
console.log(`写した: ${swPath}`);
