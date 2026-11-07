// □ 1 つに読んだ選択肢の並びを選ぶ欄に分ける（T179）。様式の読み取りの補いの 1 つで、Claude を呼ばない（lib/forms/trailing-field.ts と同じく頁の印刷の字の位置を使う）。
//
// 評価の 11 回目で、「□木造 □その他（　）」を、前の回は □ 2 つの選ぶ欄に読み、この回は「木造」の □ 1 つと項目なしの「その他（　）」に読んだ。
// 項目は同じなので様式の当たりは当たりのまま数え、紙は □ 1 つの欄の値が何の印にもならず、値のある入力の全部で空いた。読み取りの決まり 2 の形に後から寄せる。
//
// 全部そろった時だけ分ける（確かでなければ今のまま。違う欄に書くくらいなら空ける）:
// - 欄は □ 1 つで、項目が値の表を持ち（lib/forms/option-values.ts）、□ の名前が項目の種類の 1 つ（「その他」「なし」は種類でない）。種類ごとの □ の項目（読み取りの決まり 12 の例外）は除く
// - 同じ頁に同じ項目の欄がほかに無い（外した欄も数える。□ と括弧の組はそちらの決まりで動いている）
// - 同じ行で、□ の左右を縦の罫線かほかの欄の枠で切った範囲に、印刷の □ が自分と、どの欄にも読まれていない □ の 2 つだけ
// - 読まれていない □ は自分より右で、範囲の右の端の欄が項目なしの括弧の欄（「その他（　）」）。その名前が □ の名前で、□ と括弧の間に名前の字が刷ってある
// - 読まれていない □ が 2 つ以上は名前が分からないので分けない。項目なしの隣の □（AI が別の □ に読んだ物）は混ぜない（別の意味のことがある）
// 括弧の欄はそのまま残す（選ぶ欄の「その他」の中身の置き場。lib/forms/overlay-sheet.ts の placeChoice）。
// 分けた欄は AI の読んだ物と同じく確かめの画面で人が見る（理由に「（補）」）。ここは純な計算だけ。読み取りの受け口（lib/forms/read-post.ts）が対応表を保存する前に通す。

import { bracketBase } from "./form-shape.ts";
import type { InkBlob } from "./ink.ts";
import { clean, LIMITS, type FieldBox, type MappingField } from "./mapping.ts";
import { codeOfOption, hasCodes, NONE_CODE, OTHER_CODE } from "./option-values.ts";
import { PER_MARK_ITEMS } from "./read-settle.ts";
import type { TrailingPage } from "./trailing-field.ts";

/** 括弧の前の名前の字 1 字あたりの幅の上限（mm）。これより離れた括弧は □ の名前の括弧と見ない */
const NAME_CHAR_MM = 7;

const center = (b: FieldBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const yOverlap = (a: FieldBox, b: FieldBox) => Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inRowOf = (mark: FieldBox) => (b: FieldBox) => yOverlap(b, mark) >= 0.5 * Math.min(b.h, mark.h);
const meets = (a: FieldBox, b: FieldBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const holds = (o: FieldBox, p: { x: number; y: number }) => o.x <= p.x && p.x <= o.x + o.w && o.y <= p.y && p.y <= o.y + o.h;

const unionOf = (boxes: ReadonlyArray<FieldBox>): FieldBox => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

/** □ の名前が項目の種類か（値の表に当たり、「その他」「なし」でない） */
function namesKind(f: MappingField): boolean {
  const codes = codeOfOption(f.item!, f.label, f);
  return !!codes && codes.length > 0 && !codes.includes(OTHER_CODE) && !codes.includes(NONE_CODE);
}

/** 分けた欄。分けられなければ null */
function splitOne(f: MappingField, fields: readonly MappingField[], ink: readonly InkBlob[], image: TrailingPage["image"]): MappingField | null {
  const box = f.box!;
  const c = center(box);
  const inRow = inRowOf(box);
  // ほかの欄（□ を中に持つ欄は外の段なので範囲を切らない。□ を覆うかは下で見る）
  const others = fields.filter((g) => g !== f && !g.removed && g.page === f.page && g.box);
  const beside = others.filter((g) => !holds(g.box!, c) && inRow(g.box!));
  const rightField = beside.filter((g) => g.box!.x >= c.x).sort((a, b) => a.box!.x - b.box!.x)[0];
  // 右の端の欄が名前の元。項目なしの括弧の欄でなければ分けない
  if (!rightField || rightField.item !== null || !(rightField.shape === "text" || rightField.shape === "lines")) return null;
  const base = bracketBase(rightField);
  if (!base) return null;
  const rules = ink.filter((b) => b.line && b.h > b.w && yOverlap(b, box) > 0);
  // 右の端の欄より手前に縦の罫線があれば別の枠
  if (rules.some((r) => r.x >= c.x && r.x < rightField.box!.x)) return null;
  const left = Math.max(0, ...beside.filter((g) => g.box!.x + g.box!.w <= c.x).map((g) => g.box!.x + g.box!.w), ...rules.filter((r) => r.x + r.w <= c.x).map((r) => r.x + r.w));
  const marks = ink.filter((b) => b.box && inRow(b)).filter((b) => center(b).x >= left && center(b).x <= rightField.box!.x);
  // 印刷の □ が自分と、読まれていない □ の 2 つだけ
  const own = marks.filter((b) => meets(b, box));
  if (own.length !== 1) return null;
  const rest = marks.filter((b) => b !== own[0]);
  if (rest.length !== 1) return null;
  const blank = rest[0];
  if (blank.x <= own[0].x) return null;
  // どの欄にも読まれていない（外の段の枠は □ を持つのが普通なので、選択肢の □ と □ の欄だけ見る）
  const covered = (b: FieldBox) => others.some((g) => (g.optionBoxes ?? []).some((o) => !!o && meets(o, b)) || (g.box && g.shape !== "handwrite" && meets(g.box, b)));
  if (covered(blank) || covered(own[0])) return null;
  // □ と括弧の間に名前の字が刷ってあり、その幅が名前の長さに見合う
  const start = blank.x + blank.w;
  const end = rightField.box!.x;
  if ((end - start) * image.w > (base.length + 1) * NAME_CHAR_MM) return null;
  if (!ink.some((b) => !b.line && !b.box && inRow(b) && center(b).x > start && center(b).x < end)) return null;
  // 全部の選択肢が値の表に当たる
  const options = [f.label.trim(), base];
  if (options.some((o) => !codeOfOption(f.item!, o, f)?.length)) return null;
  const optionBoxes: FieldBox[] = [own[0], blank].map(({ x, y, w, h }) => ({ x, y, w, h }));
  const whole = unionOf([...optionBoxes, rightField.box!]);
  return {
    ...f,
    label: clean(options.join("・"), LIMITS.label),
    shape: "choice",
    options,
    optionBoxes,
    box: whole,
    ai: f.ai ? { ...f.ai, reason: `${f.ai.reason}（補）`, box: whole } : f.ai,
  };
}

/**
 * 対応表の、□ 1 つに読んだ選択肢の並びを選ぶ欄に分ける（欄の id は変えない）。pages は頁の番号（1 から）→ 頁。印刷の字の位置の無い頁は今のまま。
 * only があればその頁だけ（読み直した頁）
 */
export function splitLoneMarks(fields: readonly MappingField[], pages: ReadonlyMap<number, TrailingPage>, only?: ReadonlySet<number>): MappingField[] {
  return fields.map((f) => {
    if (f.removed || f.shape !== "check" || !f.box || !f.item || !hasCodes(f.item) || PER_MARK_ITEMS.has(f.item) || !namesKind(f)) return f;
    if (only && !only.has(f.page)) return f;
    if (fields.some((g) => g !== f && g.page === f.page && g.item === f.item)) return f;
    const page = pages.get(f.page);
    if (!page?.ink) return f;
    return splitOne(f, fields, page.ink, page.image) ?? f;
  });
}
