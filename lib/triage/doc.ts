// docs/TRIAGE.md の中身を、ルールの表のコード（RULES・QUALIFIERS・ORDER・READING・TIERS）から作る。
// 書き出しは build-doc.ts（npm run docs:triage。docs/SOURCES.md も一緒に書く）。ファイルとコードの一致は doc.test.ts で確かめる。
// 表の行を足したら npm run docs:triage を流す。流し忘れると npm test が止まる。

import { TIER_LABELS } from "../labels.ts";
import { sourceLinks } from "../sources/doc.ts";
import { ORDER, QUALIFIERS, READING, RULES, TIERS, type Color, type Rule } from "./index.ts";

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
    "<!-- このファイルは npm run docs:triage が lib/triage/index.ts と lib/sources/index.ts から作る。手で直さない。コードと違うと npm test が止まる -->",
    "",
    "安否の色と連絡の順番はこの表で出す。Claude は決めない（録音と自由文を 6 つに分けるだけ。分類は理由の 1 行に AI の印つきで添えるだけで、順を動かさない）。",
    "条件は事実（機器・停電・時計の残り・連絡の有無・本人と家族の答え）だけで、症状を点数にしない（アドバイザーの返事 11/3 14:1x）。",
    "元が「案」の行は docs/DECISIONS.md の案で、作者の確認待ち。案のままでは本運用に使わない。",
    "10 人に大雨の筋を流した結果は lib/triage/heavy-rain.test.ts。",
    "「なぜ」はその行がある理由の 1 文で、ケアマネと主治医が見る（本人・家族の 1 枚には出さない）。「出典」は docs/SOURCES.md の登録簿の id で、押すとその出典に飛ぶ。「未確認」は作者がまだ本文を確かめていない出典。",
    "",
    "## 色と理由の 1 行",
    "",
    "上から順に当て、最初に当たった行で色と理由の 1 行が決まる。",
    "",
    ...table(
      ["入力", "色", "理由の 1 行（例）", "元", "なぜ", "出典"],
      RULES.map((r) => [r.input, colorCell(r), r.example, r.origin, r.why, sourceLinks(r.sourceIds)]),
    ),
    "",
    "## 理由に足す言葉",
    "",
    "色は変えない。当たる物を上から順に「、」でつなぐ。",
    "",
    ...table(
      ["足すとき", "足す言葉（例）", "元", "なぜ", "出典"],
      QUALIFIERS.map((q) => [q.when, q.text, q.origin, q.why, sourceLinks(q.sourceIds)]),
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
    "## 順番の骨格の段",
    "",
    "何で時間が決まるかの段。いちばん上の段を取る（病名でなく、時計の区分と暮らしの形で決まる）。並びの 4 番目に使う。",
    "",
    ...table(
      ["段", "何で時間が決まるか", "なぜ", "出典"],
      TIERS.map((t) => [String(t.tier), TIER_LABELS[t.tier], t.why, sourceLinks(t.sourceIds)]),
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
