// 読み取りの答えの形をそろえる（T175）。同じ様式でも Opus の読み取りは回ごとに分け方が違う（評価の 8 回目と 9 回目の差。docs/progress/t175.md）。
// 読み取りの決まりの形（lib/forms/form-read.ts の決まり 2・12）に、後からコードで寄せる。どちらの読み方でも紙と見直しの数が同じになるように。
// 決めるのはコード（Claude を呼ばない）。欄の項目を増やさない（当てた項目を 1 つにまとめるだけ）。読み取りの補い（lib/forms/item-hints.ts）の前に通す。
//
// 1. 同じ項目の □ の並び: 決まり 2 の「1 つの項目の種類の □ の並びは 1 欄」に。□ ごとに読むと、種類に関係なく全部の □ に印が付く（手帳の 3 つの □）。
//    医療機器・常用薬の □ は決まり 12 の例外（□ ごとに同じ項目を当て、紙が種類を照らす）なのでまとめない
// 2. 並びの中の括弧: □ の並びの間の「部位（　）」のように、同じ項目を当てた括弧の欄は項目なしの書く所に（項目の値を丸ごと書かない）
// 3. 同じ項目の字の欄が 2 つ以上: 決まり 12 の「同じ項目を 2 つの欄に重ねない」に。項目の名前の言葉を持つ欄か、いちばん広い欄に残し、ほかは項目なし（候補に残す。確かめの画面で人が選べる）。
//    狭い欄（表の 1 列目の「持ち出し品」）に当たって置けない形と、「自由記述」と「その他」に同じ値が 2 回出る形が揺れていた
// 4. 署名の隣の日付の作成日は外す（署名した日は本人が書く）

import { bracketOwner, bracketBase, extraItemFields } from "./form-shape.ts";
import { ledgerItem, type FieldBox, type LedgerItemKey, type MappingField } from "./mapping.ts";

/** □ ごとに同じ項目を当てる種類の項目（読み取りの決まり 12 の例外。紙は □ の名前と台帳の種類を照らす） */
const PER_MARK_ITEMS: ReadonlySet<LedgerItemKey> = new Set<LedgerItemKey>(["medical.devices", "medical.medications"]);

const area = (b: FieldBox | null | undefined) => (b ? b.w * b.h : 0);
const isText = (f: MappingField) => f.shape === "text" || f.shape === "lines";

const unionOf = (boxes: ReadonlyArray<FieldBox>): FieldBox => {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
};

/** 項目を外す（AI の読んだ項目は候補に残す） */
function freed(f: MappingField, reason: string): MappingField {
  const item = f.item;
  return { ...f, item: null, ai: f.ai ? { ...f.ai, item: null, ...(item ? { candidate: item } : {}), reason: `${f.ai.reason}（${reason}）` } : f.ai };
}

/** 同じ段に並ぶ同じ項目の □ を 1 つの選ぶ欄に。間の括弧の欄は項目なしに */
function mergeMarks(fields: readonly MappingField[]): MappingField[] {
  const out: MappingField[] = [];
  const done = new Set<string>();
  for (const f of fields) {
    if (done.has(f.id)) continue;
    if (f.removed || f.shape !== "check" || !f.item || !f.box || PER_MARK_ITEMS.has(f.item)) {
      out.push(f);
      continue;
    }
    // 同じ頁・同じ段の連続する並び（間の欄は、同じ項目の括弧の欄だけ飛ばす）
    const at = fields.indexOf(f);
    const marks: MappingField[] = [f];
    const between: MappingField[] = [];
    for (const g of fields.slice(at + 1)) {
      if (g.page !== f.page || g.section !== f.section) break;
      if (g.shape === "check" && g.item === f.item && g.box) marks.push(g);
      else if (g.item === f.item && isText(g) && bracketBase(g) !== null) between.push(g);
      else break;
    }
    // 名前の無い □・種類の幅の □（要介護 3〜5 の □ は 1 つなので並びにならない）はまとめない
    if (marks.length < 2 || marks.some((m) => m.label.trim() === "")) {
      out.push(f);
      continue;
    }
    for (const g of [...marks, ...between]) done.add(g.id);
    const boxes = marks.map((m) => m.box!);
    const box = unionOf(boxes);
    out.push({
      ...f,
      label: f.section || marks.map((m) => m.label).join("・"),
      shape: "choice",
      options: marks.map((m) => m.label),
      optionBoxes: boxes,
      box,
      ai: f.ai ? { ...f.ai, reason: `${f.ai.reason}（□ の並び）`, box } : f.ai,
    });
    // 括弧の欄を並びの後ろに（読みの順は確かめの画面の順だけで、紙の場所は box）
    for (const g of between) out.push(freed(g, "□ の並びの括弧"));
  }
  return out;
}

/** 欄の名前が項目の名前の言葉（2 字以上。「その他」は除く）を含むか */
function namesItem(f: MappingField, item: LedgerItemKey): boolean {
  const label = f.label.normalize("NFKC");
  return ledgerItem(item)
    .label.normalize("NFKC")
    .split(/[の・、（）()s]+/)
    .some((w) => w.length >= 2 && w !== "その他" && label.includes(w));
}

/** 同じ項目の字の欄が 2 つ以上あれば、いちばん広い欄に残す。ほかは項目なし */
function keepWidest(fields: readonly MappingField[]): MappingField[] {
  const extra = extraItemFields(fields.filter((f) => !f.removed && f.shape !== "handwrite" && !bracketOwner(f, fields)).map((f) => ({ ...f, box: f.box ?? null })));
  if (extra.size === 0) return [...fields];
  const drop = new Set<string>();
  const items = new Set([...extra.keys()].map((id) => fields.find((f) => f.id === id)!.item!));
  for (const item of items) {
    const same = fields.filter((f) => f.item === item && !f.removed && !bracketOwner(f, fields));
    const ids = new Set<string>([...extra].filter(([id]) => fields.find((f) => f.id === id)!.item === item).flatMap(([id, first]) => [id, first.id]));
    const group = same.filter((f) => ids.has(f.id));
    // 選ぶ欄・□ のある組は字の欄の重なりでない（□ に印、字の欄に中身）
    if (group.length < 2 || !group.every(isText)) continue;
    const wide = group.reduce((a, b) => (area(b.box) > area(a.box) ? b : a));
    // 項目の名前の言葉を持つ欄が狭すぎなければそちら（「特記事項」と「助けてほしいこと」に「その他の特記」）
    const named = group.find((f) => namesItem(f, item) && area(f.box) * 10 >= area(wide.box));
    const keep = named ?? wide;
    for (const f of group) if (f !== keep) drop.add(f.id);
  }
  return fields.map((f) => (drop.has(f.id) ? freed(f, "同じ項目の欄") : f));
}

const SIGN_WORD = /署名|自署|押印|記名|同意|承諾/;

/** 署名・同意の欄の隣の日付に当てた作成日を外す（署名した日は本人が書く。読み取りの回で作成日を当てたり項目なしにしたりで、置けない日付も揺れた） */
function freeSignDates(fields: readonly MappingField[]): MappingField[] {
  return fields.map((f, i) => {
    if (f.removed || f.shape !== "date" || f.item !== "plan.date") return f;
    const near = [fields[i - 2], fields[i - 1], fields[i + 1], fields[i + 2]].filter((g): g is MappingField => !!g && g.page === f.page && !g.removed);
    return near.some((g) => (g.shape === "handwrite" && SIGN_WORD.test(`${g.label}`)) || (g.shape !== "handwrite" && g.item === null && SIGN_WORD.test(`${g.label}${g.options.join("")}`))) ? freed(f, "署名の隣の日付") : f;
  });
}

/** 読み取りの答えの形をそろえる（欄の id は変えない。まとめた □ は最初の □ の id） */
export function settleRead(fields: readonly MappingField[]): MappingField[] {
  return keepWidest(mergeMarks(freeSignDates(fields)));
}
