import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    // PC が混んでいる（複数の worktree でテストと Chrome が同時に動く）と、描くテストが既定の 5 秒で時間切れになる。11/3
    testTimeout: 20_000,
    hookTimeout: 60_000,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".open-next/**", ".wrangler/**", "video/**"],
  },
});
