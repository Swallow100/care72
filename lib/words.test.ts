// 画面・紙・文書の言葉の確かめ（T48。docs/DECISIONS.md「119 の案内と画面の言葉」）。
// 画面の言葉の定数（lib の *labels.ts・本人と家族のスマホの決まった言葉・本人の 1 枚の言葉）と、README・docs/TRIAGE.md・
// docs/SOURCES.md・動画の文書（docs/video）に「緊急度」「重症」「判定」「診断」が無いこと。文書は「〜しない」「使わない」と
// 禁じる行だけ通す。Claude への指示（prompt）の「書かない」の列挙は画面に出ないので見ない。
// 画面の言葉には「優先」も無いこと（「連絡順」「連絡の順番」にした。様式 9 の題と列「優先順位」は厚労省のひな形の字で、
// 定数でなく lib/forms/form9.ts にあるのでここでは見ない）。

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OWN_PHRASES } from "./forms/own-sheet.ts";
import { allPhoneWords } from "./signals/phrases.ts";

const BANNED = ["緊急度", "重症", "判定", "診断"] as const;

/** 定数の中の文字を全部（入れ子の物・配列も） */
function strings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === "object") return Object.values(v).flatMap(strings);
  return [];
}

const labelModules = import.meta.glob<Record<string, unknown>>(["./*labels.ts", "./*/*labels.ts"], { eager: true });

const screenWords = (): Array<{ where: string; text: string }> => [
  ...Object.entries(labelModules).flatMap(([file, mod]) =>
    Object.entries(mod).flatMap(([name, v]) => strings(v).map((text) => ({ where: `${file} ${name}`, text }))),
  ),
  ...strings(OWN_PHRASES).map((text) => ({ where: "OWN_PHRASES", text })),
  { where: "allPhoneWords", text: allPhoneWords().map((w) => w.text).join("") },
];

const repo = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const DOCS = [
  "README.md",
  "docs/TRIAGE.md",
  "docs/SOURCES.md",
  ...readdirSync(new URL("../docs/video/", import.meta.url))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `docs/video/${f}`),
];
/** 禁じる・使わないと書いた行（決まりの行）は通す */
const FORBIDS = /しない|しません|出さない|使わない|言わない|書かない|載せない|入れない|禁/;

describe("言葉（T48）", () => {
  it("画面の言葉の定数を集められている（labels のファイルが 10 以上）", () => {
    expect(Object.keys(labelModules).length).toBeGreaterThanOrEqual(10);
    expect(screenWords().length).toBeGreaterThan(200);
  });

  it("画面・紙の言葉に「緊急度」「重症」「判定」「診断」が無い", () => {
    for (const { where, text } of screenWords()) for (const w of BANNED) expect(text, `${where} ${w}`).not.toContain(w);
  });

  it("画面の言葉に「優先」が無い（「連絡順」「順番変更」）", () => {
    for (const { where, text } of screenWords()) expect(text, where).not.toContain("優先");
  });

  it("README・TRIAGE・SOURCES・動画の文書は、禁じる行のほかに「緊急度」「重症」「判定」「診断」を書かない", () => {
    for (const doc of DOCS) {
      const lines = repo(doc).split("\n");
      lines.forEach((line, i) => {
        if (FORBIDS.test(line)) return;
        for (const w of BANNED) expect(line, `${doc}:${i + 1} ${w}`).not.toContain(w);
      });
    }
  });
});
