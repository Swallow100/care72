// アンケートの答えの写しから、文の列（記入欄とその他の記入）を空にした写しを作る（見直しの安全 中 7）。
// 使い方: node tools/survey/strip-answers.ts [--from 全部の写し] [--to 公開してよい写し]
//   既定は docs/survey/answers.local.md（手元だけ。.gitignore にある）→ docs/survey/answers.md（commit する物）
//
// リポジトリは公開なので、commit するのは選択の問いの記号だけの写し。文の列（問5・問9理由・ご意見・役・問3・問4・問6 のその他）は
// 引用が「よい」の人の物でも空にする（引用に使う 1〜2 文は、作者が README・動画に選んで書く。docs/survey/README.md の 3 節）。
// 表が読めなければ（parseAnswers が断れば）何も書かない。Claude は呼ばない。

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AnswersError, isSeparator, parseAnswers, splitRow } from "./answers.ts";
import { TEXT_FIELDS } from "./questions.ts";

/** 空にする列の名前（questions.ts の TEXT_FIELDS） */
export const STRIPPED_COLUMNS: ReadonlyArray<string> = TEXT_FIELDS.map((f) => f.column);

/** 表の文の列を空にした写し。表の外の文・見出し・区切りの行はそのまま。読めない表は AnswersError を投げる */
export function stripFreeText(markdown: string): string {
  parseAnswers(markdown);
  const strip = new Set(STRIPPED_COLUMNS);
  let header: string[] | null = null;
  return markdown
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line.startsWith("|")) return raw;
      const cells = splitRow(line);
      if (isSeparator(cells)) return raw;
      if (!header) {
        header = cells;
        return raw;
      }
      const names = header;
      return `| ${cells.map((c, i) => (strip.has(names[i]) ? "" : c)).join(" | ")} |`;
    })
    .join("\n");
}

const ROOT = new URL("../../", import.meta.url);

function parseArgs(argv: string[]): { from: string; to: string } {
  const opts = {
    from: fileURLToPath(new URL("docs/survey/answers.local.md", ROOT)),
    to: fileURLToPath(new URL("docs/survey/answers.md", ROOT)),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--from" || a === "--to") && argv[i + 1]) opts[a === "--from" ? "from" : "to"] = argv[++i];
    else throw new Error(`知らない引数: ${a}（使えるのは --from 全部の写し、--to 公開してよい写し）`);
  }
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const out = stripFreeText(readFileSync(opts.from, "utf8"));
  writeFileSync(opts.to, out, "utf8");
  process.stderr.write(`${parseAnswers(out).length} 人分の文の列（${STRIPPED_COLUMNS.join("・")}）を空にして ${opts.to} に書いた\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`${e instanceof AnswersError ? e.message : e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
