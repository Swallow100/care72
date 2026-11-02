import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPasswordHash, verifyPassword } from "../lib/auth/password.ts";

const script = fileURLToPath(new URL("./hash-password.ts", import.meta.url));

/** 管から渡して動かす（端末の 2 回入力はここでは見ない） */
function run(input: string) {
  return spawnSync(process.execPath, [script], { input, encoding: "utf8", timeout: 30_000 });
}

// テストだけの値（本物のパスワードではない）
const PW = "test-only-pass-0002";

describe("npm run hash-password", () => {
  it("標準入力の 1 行目からハッシュを作り、標準出力にはハッシュの 1 行だけ", async () => {
    const r = run(`${PW}\nsecond line\n`);
    expect(r.status).toBe(0);
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(isPasswordHash(lines[0])).toBe(true);
    expect(await verifyPassword(PW, lines[0])).toBe(true);
    // パスワードはどこにも出さない
    expect(r.stdout).not.toContain(PW);
    expect(r.stderr).not.toContain(PW);
  });

  it("CRLF の改行も落とす", async () => {
    const r = run(`${PW}\r\n`);
    expect(r.status).toBe(0);
    expect(await verifyPassword(PW, r.stdout.trim())).toBe(true);
  });

  it("短い・空は作らない", () => {
    for (const input of ["", "\n", "short\n"]) {
      const r = run(input);
      expect(r.status, JSON.stringify(input)).toBe(1);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain("短い");
    }
  });
});
