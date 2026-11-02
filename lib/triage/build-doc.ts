// node lib/triage/build-doc.ts（npm run docs:triage）で docs/TRIAGE.md を書く（Node の型の取り除きで動く）。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { triageDoc } from "./doc.ts";

const outFile = fileURLToPath(new URL("../../docs/TRIAGE.md", import.meta.url));
writeFileSync(outFile, triageDoc(), "utf8");
console.log(`書いた: ${outFile}`);
