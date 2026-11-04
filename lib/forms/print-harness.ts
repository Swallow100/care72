// 紙面の印刷を確かめる道具（lib/forms/print-pages.test.ts）。サーバーも D1 も使わない。
// 種の 10 人から紙面の部品を renderToStaticMarkup で HTML にし、紙面の CSS（components/forms/*.css）を足した 1 枚の頁にする。
// その頁を headless Chrome の印刷（printToPDF、CSS の @page）で PDF にして頁を数える。
// 画面と同じにするため、画面の CSS の既定（Tailwind の preflight）と、上の帯・画面だけの操作の偽物を置く（印刷で消えるかを見る）。
// 書体は手元の BIZ UDPゴシックと BIZ UDP明朝（Windows に入っている。配信の画面は Google Fonts の同じ書体）。無ければテストは飛ばす。

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_AT, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { PersonPageRows } from "../person.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 紙面の CSS（読み込む順）。ページが読み込む物と同じ */
export const PAPER_CSS_FILES = [
  "components/forms/paper.css",
  "components/forms/medical-paper.css",
  "components/forms/own-paper.css",
  "components/forms/mapped-paper.css",
  "components/forms/form9-paper.css",
  "components/qr/qr-print.css",
] as const;

export function readRepoFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

/** 画面の既定（Tailwind の preflight）と紙面の CSS */
export function paperCss(): string {
  return [readRepoFile("node_modules/tailwindcss/preflight.css"), ...PAPER_CSS_FILES.map(readRepoFile)].join("\n");
}

/** 紙面の HTML を 1 枚の頁に。上の帯（header）と画面だけの操作（.screen-only）の偽物を置く */
export function paperPage(body: string, css = paperCss()): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>紙面</title><style>${css}</style></head>
<body style="font-family: sans-serif"><header data-test="app-header">ケア72 担当一覧</header>
<main><div class="screen-only" data-test="screen-bar">戻る 印刷</div>${body}</main></body></html>`;
}

/** 種の 1 人を、D1 から読んだのと同じ形にする（lib/forms/matsuyama.test.ts と同じ） */
export function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

/** 頁の中で書体が使えるかを測る（無い書体は既定の書体に替わり、幅が等幅の書体と同じになる） */
const probe = (family: string) => `(() => {
  const c = document.createElement("canvas").getContext("2d");
  const w = (f) => { c.font = f; return c.measureText("避難計画 0123456789 ヤマダ").width; };
  return w('20px "${family}", monospace') !== w("20px monospace");
})()`;
export const FONT_PROBE = probe("BIZ UDPGothic");
/** 明朝（T85。松山市の様式の題・同意の問い・注）。Windows の BIZ UDP明朝 Medium（BIZ-UDMinchoM.ttc）か Google Fonts の同じ書体 */
export const MINCHO_PROBE = probe("BIZ UDPMincho");
