// docs/TRIAGE.md の中身を、ルールの表のコード（RULES・QUALIFIERS・ORDER・READING）から作る。
// 書き出しは build-doc.ts（npm run docs:triage）。ファイルとコードの一致は doc.test.ts で確かめる。
// 表の行を足したら npm run docs:triage を流す。流し忘れると npm test が止まる。

import { ORDER, QUALIFIERS, READING, RULES, type Color, type Rule } from "./index.ts";

const COLOR_WORD: Record<Color, string> = { red: "赤", yellow: "黄", gray: "灰", green: "緑" };

function colorCell(rule: Rule): string {
  if (rule.id === "red_injury") return "赤（最上位）";
  if (rule.id === "green") return "緑（一番下）";
  return COLOR_WORD[rule.color];
}

function table(head: string[], rows: string[][]): string[] {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)];
}

export function triageDoc(): string {
  const out: string[] = [
    "# ルールの表",
    "",
    "<!-- このファイルは npm run docs:triage が lib/triage/index.ts から作る。手で直さない。コードと違うと npm test が止まる -->",
    "",
    "安否の色と連絡の順位はこの表で出す。Claude は決めない（録音と自由文を 5 つに分けるだけ）。",
    "元が「案」の行は docs/DECISIONS.md の案で、作者の確認待ち。案のままでは本運用に使わない。",
    "10 人に大雨の筋を流した結果は lib/triage/heavy-rain.test.ts。",
    "",
    "## 色と理由の 1 行",
    "",
    "上から順に当て、最初に当たった行で色と理由の 1 行が決まる。",
    "",
    ...table(
      ["入力", "色", "理由の 1 行（例）", "元"],
      RULES.map((r) => [r.input, colorCell(r), r.example, r.origin]),
    ),
    "",
    "## 理由に足す言葉",
    "",
    "色は変えない。当たる物を上から順に「、」でつなぐ。",
    "",
    ...table(
      ["足すとき", "足す言葉（例）", "元"],
      QUALIFIERS.map((q) => [q.when, q.text, q.origin]),
    ),
    "",
    "## 並び",
    "",
    "上から順に比べ、同じなら次で比べる。",
    "",
    ...table(
      ["比べる物", "元"],
      ORDER.map((k) => [k.label, k.origin]),
    ),
    "",
    "## 読み方",
    "",
    ...table(
      ["読み方", "元"],
      READING.map((r) => [r.text, r.origin]),
    ),
    "",
    "元の「決めた所」は、表と案から読み方を決めた所。docs/PROGRESS.md に書いてある。",
    "",
    "## ケアマネの上書き",
    "",
    "- 上げる・下げるで手で直せる。理由が要り、経過に残す",
    "- 上書きしたあとに表の色が悪くなったら、上書きは切れて表の色に戻る。上げてあった色より下げはしない",
    "",
  ];
  return out.join("\n");
}
