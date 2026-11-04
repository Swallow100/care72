// 種の SQL の文は全部 ; で終わる（npm run db:seed は文をつないだ 1 つのファイルを wrangler d1 execute --local に渡すので、
// ; の無い文があると次の文とつながって流れない）。デモの QR の文に ; が無く、手元の種が入らなかった（T103 の作業中に見つけた）。

import { describe, expect, it } from "vitest";
import { demoExtraStatements } from "./demo.ts";
import { demoResetStatements } from "./reset.ts";

describe("種の SQL の文", () => {
  it("デモの足しの文と毎朝の戻しの文は全部 ; で終わる", () => {
    const now = "2026-11-05T00:00:00.000Z";
    for (const s of [...demoExtraStatements(now), ...demoResetStatements(now)]) expect(s.trim(), s.slice(0, 60)).toMatch(/;$/);
  });
});
