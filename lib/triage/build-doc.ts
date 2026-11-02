// node lib/triage/build-doc.ts（npm run docs:triage）で docs/TRIAGE.md と docs/SOURCES.md を書く（Node の型の取り除きで動く）。
// SOURCES.md の「引く行・段」はルールの表から引くので、表か登録簿のどちらを直してもこれを流す。
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sourcesDoc } from "../sources/doc.ts";
import { triageDoc } from "./doc.ts";

for (const [name, body] of [
  ["TRIAGE.md", triageDoc()],
  ["SOURCES.md", sourcesDoc()],
] as const) {
  const outFile = fileURLToPath(new URL(`../../docs/${name}`, import.meta.url));
  writeFileSync(outFile, body, "utf8");
  console.log(`書いた: ${outFile}`);
}
