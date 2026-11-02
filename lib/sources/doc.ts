// docs/SOURCES.md の中身を、登録簿（lib/sources/index.ts）と、それを引くルールの表（lib/triage）から作る。
// 書き出しは lib/triage/build-doc.ts（npm run docs:triage が TRIAGE.md と一緒に書く）。一致は lib/sources/sources.test.ts で確かめる。
// 「引く行・段」は登録簿に持たず、lib/triage の sourceIds から逆に引く（二重に持たない）。

import { TIER_LABELS } from "../labels.ts";
import { QUALIFIERS, RULES, TIERS } from "../triage/index.ts";
import { checkMark, QUOTE_MAX, SOURCES, type SourceEntry, type SourceId } from "./index.ts";

/** Markdown のリンク。base は SOURCES.md への相対パス（同じファイルの中なら ""）。未確認の物は印を添える */
export function sourceLinks(ids: ReadonlyArray<SourceId>, base = "SOURCES.md"): string {
  return ids
    .map((id) => {
      const mark = checkMark(id) === "未確認" ? " 未確認" : "";
      return `[${id}](${base}#${id})${mark}`;
    })
    .join("、");
}

/** その出典を引く表の行・足す言葉・骨格の段 */
export function citedBy(id: SourceId): string[] {
  return [
    ...RULES.filter((r) => r.sourceIds.includes(id)).map((r) => `表の行 ${r.id}（${r.input}）`),
    ...QUALIFIERS.filter((q) => q.sourceIds.includes(id)).map((q) => `足す言葉 ${q.id}（${q.text}）`),
    ...TIERS.filter((t) => t.sourceIds.includes(id)).map((t) => `骨格の段 ${t.tier}（${TIER_LABELS[t.tier]}）`),
  ];
}

function checkCell(s: SourceEntry): string {
  return s.checkedOn ? `確認済（${s.checkedOn}）` : "未確認";
}

function table(head: string[], rows: string[][]): string[] {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)];
}

function entry(s: SourceEntry): string[] {
  const cited = citedBy(s.id);
  return [
    `### ${s.id}`,
    "",
    `- 発行元: ${s.publisher}`,
    `- 題名: ${s.title}`,
    `- 年・版: ${s.year}。${s.edition}`,
    `- 文書: <${s.url}>`,
    ...(s.page ? [`- 載っている頁: <${s.page}>`] : []),
    `- 要旨: ${s.summary}`,
    `- この作品で使う範囲: ${s.scope}`,
    ...(s.quote ? [`- 引用: 「${s.quote.text}」（${s.quote.where}）`] : []),
    ...(s.note ? [`- 気を付ける所: ${s.note}`] : []),
    `- 引く行・段: ${cited.length > 0 ? cited.join("、") : "まだ無い"}`,
    `- 確認: ${checkCell(s)}`,
    "",
  ];
}

export function sourcesDoc(): string {
  const sources: ReadonlyArray<SourceEntry> = SOURCES;
  const out: string[] = [
    "# 出典の登録簿",
    "",
    "<!-- このファイルは npm run docs:triage が lib/sources/index.ts と lib/triage/index.ts から作る。手で直さない。コードと違うと npm test が止まる -->",
    "",
    "ルールの表の行・足す言葉・優先の骨格の段（docs/TRIAGE.md）と、Claude に渡す根拠は、この一覧の id だけを指す。一覧に無い根拠は作らない。",
    `文書はリンクだけで、PDF はリポジトリに入れない。要旨は作者の言葉で、引用は ${QUOTE_MAX} 字まで。`,
    "「確認」は作者（医学生）が本文を読んで確かめた日。未確認の出典は画面にも「未確認」と出る。確かめたら lib/sources/index.ts の checkedOn に日付を入れ、npm run docs:triage を流す。",
    "",
    "## 一覧",
    "",
    ...table(
      ["id", "発行元", "題名", "年", "確認"],
      sources.map((s) => [`[${s.id}](#${s.id})`, s.publisher, s.title, String(s.year), checkCell(s)]),
    ),
    "",
    "## 出典ごと",
    "",
    ...sources.flatMap(entry),
  ];
  return out.join("\n");
}
