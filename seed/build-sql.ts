// node seed/build-sql.ts で seed/generated/seed.sql を書く（Node の型の取り除きで動く）。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedSql } from "./sql.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "generated");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "seed.sql");
writeFileSync(outFile, seedSql(), "utf8");
console.log(`書いた: ${outFile}`);
