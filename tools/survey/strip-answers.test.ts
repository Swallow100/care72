// 公開してよい写し（文の列を空にした answers.md）を作る道具と、commit する answers.md に文が無いことの見張り（見直しの安全 中 7）。
// 例の回答は全部作り物（実在の人・事業所とは関係ない）。
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnswersError, collectFreeItems, isSeparator, parseAnswers, splitRow, tallyChoice } from "./answers.ts";
import { COLUMNS, TEXT_FIELDS } from "./questions.ts";
import { STRIPPED_COLUMNS, stripFreeText } from "./strip-answers.ts";
import { renderSummary } from "./summarize.ts";

const HEADER = `| ${COLUMNS.join(" | ")} |`;
const SEPARATOR = `| ${COLUMNS.map(() => "---").join(" | ")} |`;
const row = (r: Partial<Record<string, string>>) => `| ${COLUMNS.map((c) => r[c] ?? "").join(" | ")} |`;
const table = (...rows: Array<Partial<Record<string, string>>>) => ["# 答え", "", "説明の文", "", HEADER, SEPARATOR, ...rows.map(row), ""].join("\n");

const R1 = { 番号: "W001", 役: "d", 役その他: "相談員", 経験: "c", 問1: "b", 問2: "d", 問3: "e", 問3その他: "迷う", 問4: "b,g", 問4その他: "人手", 問5: "書く時間が取れない", 問6: "g", 問6その他: "棚にある", 問7: "c", 問8: "b", 問9: "a", 問9理由: "話すだけなら続けられる", ご意見: "ありがとう", 引用: "a" };
const R2 = { 番号: "W002", 役: "a", 経験: "a", 問1: "a", 問2: "g", 問3: "d", 問6: "f", 問7: "b", 問8: "c", 問9: "b", 引用: "b" };

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const script = fileURLToPath(new URL("./strip-answers.ts", import.meta.url));

describe("文の列を空にした写し", () => {
  it("空にするのは記入欄とその他の記入の列（questions.ts の TEXT_FIELDS）", () => {
    expect([...STRIPPED_COLUMNS].sort()).toEqual(["ご意見", "問3その他", "問4その他", "問5", "問6その他", "問9理由", "役その他"].sort());
    expect(STRIPPED_COLUMNS).toEqual(TEXT_FIELDS.map((f) => f.column));
  });

  it("選択の記号・番号・表の外の文は残し、文の列だけ空にする。数えた結果は同じで、文は 1 つも残らない", () => {
    const full = table(R1, R2);
    const out = stripFreeText(full);
    expect(out.split("\n").slice(0, 6)).toEqual(full.split("\n").slice(0, 6));
    for (const t of Object.values(R1).filter((v) => /[^\x00-\x7f]{2,}/.test(v))) expect(out).not.toContain(t);
    const before = parseAnswers(full);
    const after = parseAnswers(out);
    expect(after.map((r) => r.id)).toEqual(["W001", "W002"]);
    for (const r of after) expect(Object.values(r.free).every((v) => v === null)).toBe(true);
    expect(after.map((r) => r.choices)).toEqual(before.map((r) => r.choices));
    expect(tallyChoice(after, "q4")).toEqual(tallyChoice(before, "q4"));
    expect(collectFreeItems(after)).toEqual({ items: [], held: [] });
    // 写しから作った集計にも文は載らない
    const md = renderSummary({ respondents: after, held: [], ai: { status: "skipped", reason: "--no-ai" }, now: new Date("2026-11-04T04:00:00Z") });
    expect(md).not.toMatch(/取れない|話すだけ|ありがとう|相談員|棚にある|迷う|人手/);
  });

  it("読めない表は書かない（AnswersError）", () => {
    expect(() => stripFreeText(table({ ...R1, 番号: "" }))).toThrow(AnswersError);
    expect(() => stripFreeText("表なし")).toThrow(AnswersError);
  });

  it("node tools/survey/strip-answers.ts --from 全部 --to 公開: 文の列を空にして書く", () => {
    const dir = mkdtempSync(join(tmpdir(), "t83-survey-"));
    const from = join(dir, "answers.local.md");
    const to = join(dir, "answers.md");
    writeFileSync(from, table(R1, R2));
    const r = spawnSync(process.execPath, [script, "--from", from, "--to", to], { encoding: "utf8", timeout: 30_000 });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain("2 人分");
    expect(readFileSync(to, "utf8")).toBe(stripFreeText(table(R1, R2)));
  });
});

describe("commit する物の見張り", () => {
  it("リポジトリの answers.md の答えの行は、文の列が空（全部の写しは answers.local.md に置いて commit しない）", () => {
    const lines = readFileSync(join(ROOT, "docs/survey/answers.md"), "utf8").split(/\r?\n/);
    let header: string[] | null = null;
    for (const line of lines) {
      if (!line.trim().startsWith("|")) continue;
      const cells = splitRow(line.trim());
      if (isSeparator(cells)) continue;
      if (!header) {
        header = cells;
        continue;
      }
      for (const col of STRIPPED_COLUMNS) {
        const v = cells[header.indexOf(col)] ?? "";
        expect(["", "-"], `${cells[0]} の ${col}`).toContain(v);
      }
    }
    expect(header).not.toBeNull();
  });

  it(".gitignore が手元の全部の写しを外し、README の手順が写しの道具を通す", () => {
    expect(readFileSync(join(ROOT, ".gitignore"), "utf8")).toMatch(/^docs\/survey\/\*\.local\.md$/m);
    const readme = readFileSync(join(ROOT, "docs/survey/README.md"), "utf8");
    expect(readme).toContain("node tools/survey/strip-answers.ts");
    expect(readme).toContain("answers.local.md");
    expect(readme).not.toContain("良ければ `answers.md` と `summary.md` を commit する");
  });
});
