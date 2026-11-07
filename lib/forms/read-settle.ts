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
//
// T176（評価の 10 回目。r9 の 1 頁に 0 欄だった形が読み取りで増え、要確認 591 → 1,463。docs/progress/t176.md）:
// 5. 親と同じ項目を当てた、名前に空きのある字の欄（「（　）級」「【　】」）で、選択肢や □ の子でない物は項目なし。空きは級・種類・深さを書く所で、項目の値を丸ごと書く所でない
// 6. 3 を □・選ぶ欄のある組にも。□ に印、字の欄に中身の組（1 つの字の欄）はそのまま、字の欄が 2 つ以上なら 1 つに
// 7. 同じ頁の同じ項目の選ぶ欄は 1 つ（2 つ目の選択肢は項目の種類でないので印が付かず、置けない）

import { allowedTwice, bracketOwner, bracketBase, extraItemFields } from "./form-shape.ts";
import { ledgerItem, type FieldBox, type LedgerItemKey, type MappingField } from "./mapping.ts";

/** □ ごとに同じ項目を当てる種類の項目（読み取りの決まり 12 の例外。紙は □ の名前と台帳の種類を照らす） */
const PER_MARK_ITEMS: ReadonlySet<LedgerItemKey> = new Set<LedgerItemKey>(["medical.devices", "medical.medications"]);

/** あり・なし の □ の名前（lib/forms/mapped-sheet.ts の YES・NO と同じ言葉） */
const YES_WORD = /^(あり|有|有り|はい)$/;
const NO_WORD = /^(なし|無|無し|いいえ)$/;

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
    // あり・なし の並びの後ろの空き（「□なし □あり 病名（　）」）は、あり の中身を書く所。外すかは空きの決まり（freeSlots）で、ほかに書く欄が無ければ残す（T181）
    const yesNo = marks.length === 2 && marks.some((m) => YES_WORD.test(squeeze(m.label))) && marks.some((m) => NO_WORD.test(squeeze(m.label)));
    const last = fields.indexOf(marks[marks.length - 1]);
    // 選択肢の名前の括弧（「あり（　）」「その他（　）」）は選ぶ欄の子（form-shape.ts の bracketOwner）で、項目を外さない。外すと子にならず、あり の中身が紙から消えた（T181）
    const optionName = (g: MappingField) => marks.some((m) => squeeze(m.label) === bracketBase(g));
    const keep = (g: MappingField) => optionName(g) || (yesNo && fields.indexOf(g) > last);
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
    for (const g of between) out.push(keep(g) ? g : freed(g, "□ の並びの括弧"));
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

/** 値を書く形の欄（□・選ぶ欄は印で、値を書かない） */
const carriesValue = (f: MappingField) => isText(f) || f.shape === "date" || f.shape === "phone";

/**
 * 同じ項目の字の欄が 2 つ以上あれば、いちばん広い欄に残す。ほかは項目なし。
 * □・選ぶ欄は組に入れない（□ に印、字の欄に中身）。外すのは字の欄だけ（日付・電話の形の欄は読み取りが形まで読んだ物なので外さない）
 */
function keepWidest(fields: readonly MappingField[]): MappingField[] {
  const extra = extraItemFields(fields.filter((f) => !f.removed && f.shape !== "handwrite" && !bracketOwner(f, fields)).map((f) => ({ ...f, box: f.box ?? null })));
  if (extra.size === 0) return [...fields];
  const drop = new Set<string>();
  const items = new Set([...extra.keys()].map((id) => fields.find((f) => f.id === id)!.item!));
  for (const item of items) {
    const same = fields.filter((f) => f.item === item && !f.removed && !bracketOwner(f, fields));
    // 組は、余った欄と、それより前で同じ所にならない最初の値の欄（□ が先にあると extra の first は □）。
    // 組は同じ頁の中だけ（T181。頁の頭の「氏名」「利用者名」・「作成日」「記入日」は頁ごとに名前と場所が違い、2 頁目の欄が空いた）。
    // 頁をまたぐのは、日付・電話の形の欄の項目を、別の頁のその形の言葉の無い字の欄に当てた読み（生年月日と識別番号。T176）だけ
    const pairs = [...extra.keys()]
      .map((id) => same.find((f) => f.id === id))
      .filter((f): f is MappingField => !!f)
      .map((f) => [f, ...same.filter((g) => g !== f && carriesValue(g) && same.indexOf(g) < same.indexOf(f) && (g.page === f.page || strayAcross(g, f)) && !allowedTwice({ ...g, box: g.box ?? null }, { ...f, box: f.box ?? null })).slice(0, 1)]);
    for (const group of joined(pairs).map((ids) => same.filter((f) => ids.has(f.id) && carriesValue(f)))) {
      if (group.length < 2) continue;
      const shaped = group.find((f) => !isText(f));
      const wide = group.reduce((a, b) => (area(b.box) > area(a.box) ? b : a));
      // 項目の名前の言葉を持つ欄が狭すぎなければそちら（「特記事項」と「助けてほしいこと」に「その他の特記」）
      const named = group.find((f) => namesItem(f, item) && area(f.box) * 10 >= area(wide.box));
      const keep = named ?? shaped ?? wide;
      for (const f of group) if (f !== keep && isText(f)) drop.add(f.id);
    }
  }
  return fields.map((f) => (drop.has(f.id) ? freed(f, "同じ項目の欄") : f));
}

const DATE_WORD = /日|年月|生年/;
const PHONE_WORD = /電話|TEL|携帯|連絡/i;
/** 別の頁の、日付・電話の形の欄 g の項目を当てた、その形の言葉の無い字の欄 f（頁をまたいで組にしてよい読み違い） */
function strayAcross(g: MappingField, f: MappingField): boolean {
  if (!isText(f) || (g.shape !== "date" && g.shape !== "phone")) return false;
  return !(g.shape === "date" ? DATE_WORD : PHONE_WORD).test(nfkc(f.label));
}

/** 組の並びを、欄を共にする組どうしでつなぐ（欄の id の集まり） */
function joined(pairs: ReadonlyArray<readonly MappingField[]>): Array<Set<string>> {
  const out: Array<Set<string>> = [];
  for (const p of pairs) {
    const ids = new Set(p.map((f) => f.id));
    const hit = out.filter((s) => [...ids].some((id) => s.has(id)));
    const merged = new Set([...ids, ...hit.flatMap((s) => [...s])]);
    for (const s of hit) out.splice(out.indexOf(s), 1);
    out.push(merged);
  }
  return out;
}

const nfkc = (s: string) => s.normalize("NFKC");
const squeeze = (s: string) => nfkc(s).replace(/\s/g, "");
/** 名前の中の空き: 空の括弧（「（　）」「【　】」「（～）」）か、中に空白のある括弧（「（浸水想定　m）」） */
const SLOT = /[(【[〔](?:[^)】\]〕]*\s[^)】\]〕]*|[~〜ー\-・…]*)[)】\]〕]/;

/** 欄の名前に空きがあるか（台の数える口も同じ物を使う。tools/eval/forms/drift.ts） */
export const hasSlot = (label: string) => SLOT.test(nfkc(label));

/**
 * 親の □ か選ぶ欄（同じ頁・同じ段・同じ項目）があり、選択肢や □ の子でない空きの字の欄は項目なし。
 * 外すのは、同じ頁・同じ項目で値を書く欄がほかにある時だけ（T181）。「□なし □あり 病名（　）」の空きは、ほかに書く欄が無ければ
 * 項目の値を書く所で、外すとアレルギーの名前・病名が紙から消えた（項目を外した欄は未確認になるだけで、落とした数に出ない）
 */
function freeSlots(fields: readonly MappingField[]): MappingField[] {
  return fields.map((f) => {
    if (f.removed || !f.item || !isText(f) || PER_MARK_ITEMS.has(f.item) || !hasSlot(f.label)) return f;
    const parents = fields.filter((g) => g !== f && !g.removed && g.page === f.page && g.section === f.section && g.item === f.item && (g.shape === "check" || g.shape === "choice"));
    if (parents.length === 0 || bracketOwner(f, fields)) return f;
    // 「要介護（　）級」と □ 要介護の組は □ の中身を書く所（読み取りの補いの括弧、item-hints.ts の 1）
    const head = squeeze(nfkc(f.label).split(SLOT)[0]);
    if (parents.some((g) => g.shape === "check" && squeeze(g.label) === head)) return f;
    const writers = fields.filter((g) => g !== f && !g.removed && g.page === f.page && g.item === f.item && carriesValue(g) && !bracketOwner(g, fields));
    if (writers.length === 0) return f;
    return freed(f, "親の項目の空き");
  });
}

/** 項目の名前そのものを持つ欄か（「支援の内容」と「支援内容」。部分の言葉だけの namesItem より強い） */
const fullName = (f: MappingField, item: LedgerItemKey) => squeeze(f.label).includes(squeeze(ledgerItem(item).label).replace(/の/g, ""));

/** 同じ頁の同じ項目の選ぶ欄は 1 つ（項目の名前そのものの欄か、最初の欄）。種類ごとの項目は決まり 12 の例外 */
function keepOneChoice(fields: readonly MappingField[]): MappingField[] {
  const groups = new Map<string, MappingField[]>();
  for (const f of fields) {
    if (f.removed || f.shape !== "choice" || !f.item || PER_MARK_ITEMS.has(f.item)) continue;
    const k = `${f.page}\u0000${f.item}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const drop = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = group.find((f) => fullName(f, f.item!)) ?? group[0];
    for (const f of group) if (f !== keep) drop.add(f.id);
  }
  return drop.size === 0 ? [...fields] : fields.map((f) => (drop.has(f.id) ? freed(f, "同じ項目の選ぶ欄") : f));
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
  return keepWidest(freeSlots(keepOneChoice(mergeMarks(freeSignDates(fields)))));
}
