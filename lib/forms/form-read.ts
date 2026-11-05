// 様式の読み取り（docs/tasks/T08.md）。写真（JPEG・PNG）か PDF の空の様式を Opus に読ませ、欄と台帳の項目の対応表（JSON）を出させる。
//
// - Claude に渡すのは様式の写真・PDF と、台帳の項目表（lib/forms/mapping.ts の key と名前。値は無い）だけ。
//   様式には人の値が無い前提だが、書き込みがあっても読まないよう指示する（FORM_READ_SYSTEM の 6）。
// - 上限は lib/claude/usage.ts（用途 form_read、Opus、effort high）。
// - 返った対応表は checkReadResult で台帳の一覧と照らし（無い項目名は弾く）、下書きとして保存する。使うのはケアマネが確かめてから。
// - 同じ写真・PDF（SHA-256 が同じ）は読み直さない（lib/forms/mapping-db.ts の findByHash を先に引く）。
// - T86: 欄ごとに値を書く場所（頁の画像の上の 0〜1 の矩形）と、様式の字の書体も返させる。場所は人が確かめる画面で重ねて見せ、直せる。
//   元の様式の頁の画像（受けた物そのまま）の上に値を置く紙（lib/forms/overlay-sheet.ts）に使う。
// - T83: 画面からは黒塗りの画面（components/person/RedactSheet.tsx）を通した頁の画像（JPEG）を頁の順に受ける（app/api/forms/read）。
//
// T120（評価の 1 回目で実在の様式の PDF 14 件のうち 12 件が読めなかった。2 頁を 1 回で読み、61〜82 欄の答えが出力の上限 16,000 で
// 切れるか、180 秒の待ちを 2 回続けて越えた。docs/progress/eval-r1-findings.md の 1・13）:
// - 1 頁 1 回で読み、頁を並べて呼ぶ（readForm の concurrency。Workers の 1 要求の外への接続は 6 本までで、頁は 3 まで）。
//   1 頁の答えは 30〜40 欄で、待ちは 1 頁の分だけ。読めなかった頁があっても、読めた頁の欄で対応表にする（unread に頁の番号）
// - 答えの形を短くした（PageReadSchema）: 頁の番号・位置の説明を返させず、段の見出しは段ごとに 1 回、場所は [x, y, w, h] の数の並び。
//   評価の 1 回目の本物の答え（65〜71 欄）をこの形に直すと 18〜22% 短い（欄 1 つ 125〜135 token → 100 token ほどの見積もり）
// - それでも出力の上限で切れたら（AiTruncated）、切れるまでの完全な欄を拾い（salvagePageRead）、読み済みの欄の名前を渡して
//   続きを 1 回だけ頼む（askJson の別の呼び出し。仮名化の門を通る。前の答えに付け足す形〔prefill〕は Opus 5.5 で使えない）。
//   続きも失敗すれば、拾えた欄だけで返す（partial に頁の番号）
// - 頁を分けたので、決まりの 12（同じ項目を 2 つの欄に重ねない）は頁の中だけで効く。頁をまたいだ重なりは確かめの画面で人が見る

import { Buffer } from "node:buffer";
import * as z from "zod";
import { askJson, type AiMark, type AskJsonContext, type AskJsonRequest, type ClaudeAttachment } from "../claude/call.ts";
import { AiNotConfigured, AiTruncated } from "../claude/errors.ts";
import { sealItemCatalog } from "../pseudonym/index.ts";
import {
  CONFIDENCES,
  FIELD_SHAPES,
  FORM_FILE_MAX_BYTES,
  LIMITS,
  TYPEFACES,
  checkReadResult,
  clean,
  itemCatalog,
  type CheckedRead,
  type FieldBox,
  type ReadResult,
  type Typeface,
} from "./mapping.ts";

export { FORM_FILE_MAX_BYTES };

// ---------- 受け取る写真・PDF ----------

export type FormFileKind = "image" | "pdf";
export type FormFile = { kind: FormFileKind; attachment: ClaudeAttachment; bytes: number };
export type FormFileError = "empty" | "too_large" | "type";

/** 中身の頭で形を決める（ブラウザの言う形は信じない）。JPEG・PNG・PDF のほかは断る */
export function sniffFormFile(bytes: Uint8Array): { kind: "image"; mediaType: "image/jpeg" | "image/png" } | { kind: "pdf" } | null {
  const head = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (head([0xff, 0xd8, 0xff])) return { kind: "image", mediaType: "image/jpeg" };
  if (head([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: "image", mediaType: "image/png" };
  if (head([0x25, 0x50, 0x44, 0x46, 0x2d])) return { kind: "pdf" };
  return null;
}

/** 受け取った物を確かめて、Claude に添える形にする */
export function toFormFile(bytes: Uint8Array): { ok: true; file: FormFile } | { ok: false; error: FormFileError } {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > FORM_FILE_MAX_BYTES) return { ok: false, error: "too_large" };
  const t = sniffFormFile(bytes);
  if (!t) return { ok: false, error: "type" };
  const data = Buffer.from(bytes).toString("base64");
  const attachment: ClaudeAttachment = t.kind === "pdf" ? { kind: "pdf", data } : { kind: "image", mediaType: t.mediaType, data };
  return { ok: true, file: { kind: t.kind, attachment, bytes: bytes.length } };
}

/** 同じ様式か見分ける印（SHA-256 の 16 進） */
export async function formHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Claude への頼み ----------

export const FORM_READ_SYSTEM = [
  "入力の画像・PDF は、日本の市町村などの個別避難計画・名簿登録の様式（空の書式）の 1 頁。入力の JSON の「頁」は全部の頁の数（of）とこの頁の番号（no）。「items」はケア72 の台帳の項目表（key と名前と説明だけで、値は無い）。",
  "1. この頁の記入欄を、上から下、左から右の順に全部挙げる。見出しだけの行・注意書き・説明文は欄にしない。",
  "   欄は段ごとにまとめる。sections の name は段の見出し（例「緊急時の連絡先①」）、見出しの無い所は空文字。同じ見出しの段を 2 つに分けない。",
  "   欄の名前の違う 2 つの枠は 1 つの欄にまとめず、別々の欄にする。書く所が 1 つの枠に欄の名前が 2 つ付く所（名前の列に「主治医」と「服薬の情報」のように 2 つの名前が並び、書く所は 1 つ）も、名前ごとに別々の欄にし、どちらの box も同じ書く所にする（中身が別の項目に当たるので、1 つの欄にまとめない）。",
  "2. □ の選択肢が並び 1 つを選ぶ欄は 1 欄（shape choice）にし、選択肢を様式の順に options に入れる。",
  "   「複数選択可」「あてはまるものすべて」の □ の並びでも、選択肢が台帳の 1 つの項目の種類（自宅のリスクの土砂災害・洪水・津波、支援の内容の声掛け・誘導・移動介助、既往症、予防接種、アレルギー）なら、1 欄（shape choice）にまとめて options に選択肢を並べ、その項目を当てる（□ ごとに分けると、2 つ目からの □ に項目が当たらない）。",
  "   □ ごとに別々の項目に当たる並び（独居・要介護・障害者手帳・難病のように中身の違う □）は、□ ごとに 1 欄（shape check）にする。",
  "3. label は様式に印刷された欄の名前のまま（言い換えない）。",
  "4. shape: text 文字・date 日付・choice 選ぶ・check □ 1 つ・phone 電話番号・lines 何行かの自由記入・handwrite 本人の署名・押印・受付印など人が手で書く欄。",
  "5. item はその欄に入れる値に合う台帳の項目の key を items から 1 つ。合う物が無い・決められない欄は null。items に無い key を作らない。手で書く欄は null。",
  "6. 様式に書き込まれた値（氏名・住所・電話番号・日付）があっても読まない。出力に書かない。黒く塗りつぶした四角は、ケアマネが隠した所。中身を推し量らない・出さない。",
  "7. confidence: high は名前も中身も合う、medium は中身は近いが範囲が違う、low は推測。reason は対応の理由を 20 字まで。",
  "8. box はその欄の値を書き込む空白の所（欄の名前の字や □ の印は含めない、書き込む枠の内側）。この頁の画像の左上を (0,0)、右下を (1,1) とした比で [左端 x, 上端 y, 幅 w, 高さ h] の 4 つの数（どれも 0〜1、小数 3 桁まで）。読み取れなければ null。",
  "9. check の box は □ の印そのものの場所。choice の box は選択肢が並ぶ所全体で、option_boxes に選択肢ごとの □（□ が無ければ選択肢の字）の場所を options と同じ順に入れる。handwrite の box は人が手で書く空白の所。",
  "10. 市・自治体・受付が書く欄（「市記入欄」「市使用欄」「受付」「受付日」「受付番号」「整理番号」「担当課」「処理欄」など）は item を null。欄としては挙げ、shape は欄の形のまま。",
  "11. 同意・署名・押印など本人の意思を示す欄（同意の □、「同意する・同意しない」の選択、署名）は item を null。本人の意思なので、対応はケアマネが確かめて選ぶ。",
  "    item を null にした欄でも、同意の欄のように中身が台帳の項目に当たる物は、その key を candidate に入れる（ケアマネが確かめて選ぶ候補）。ほかの欄の candidate は null。",
  "12. 同じ項目を 2 つの欄に重ねない。「電話番号１」「電話番号２」のように番号違いで並ぶ欄は、1 つ目に合う項目を当て、2 つ目は台帳に 2 番目の値の項目（携帯番号・緊急連絡先2 など）があるときだけそれを当て、無ければ null。頁ごとに繰り返す氏名の欄は同じ項目でよい。",
  "    ただし □ ごとに医療機器・薬の種類を問う欄（在宅酸素・人工呼吸器・吸引・透析の □、抗凝固薬・インスリンの □）は、□ ごとに同じ項目（医療機器・常用薬）を当てる。紙は □ の名前と台帳の種類を照らして、合う □ だけに印を付ける。",
  "13. 意味の違う欄に、名前の近い項目を当てない。欄が求める値と項目の中身が同じときだけ当てる。例: 「年築」「建築年」は建てた年で、木造・鉄骨などの種類（構造）とは違う。台帳の「構造・築年」は種類と年をまとめた物なので、年だけの欄には当てず null。",
  "14. 欄の中に「年」「月」「日」「歳」の字が刷ってあり、値をその字の前の空きに分けて書く欄（例「　年　月　日」「（　）年　月　日生」「（　歳）」）は、options にその字を左から並べ（例 [\"年\",\"月\",\"日\"]）、option_boxes にそれぞれの字の前の空き（数字を書く所）の場所を同じ順に入れる。年の前に元号（令和・昭和など）が刷ってあれば、options の 1 つ目を「令和年」のように元号を付けて書く。",
  "    電話番号の欄で「−」「（　）」が刷ってあり番号を空きに分けて書く欄（例「　−　−　」）は、options を [\"局番\",\"市内\",\"番号\"] にし、option_boxes に区切りの間の空きを左から入れる。空きに分けない欄の options と option_boxes は空の配列。",
  "15. 日付の前に元号の選択肢（大正・昭和・平成・令和を ○ で囲む・□）が刷ってある欄は、元号だけの欄を別に挙げない。元号から日までを 1 つの日付の欄（shape date）にし、box は元号から日までを囲む。",
  "16. 1 つの枠の中に種類の □（避難所・親族宅・車中泊など）と名前を書く所がある欄は、名前を書く所を、その行の欄の名前（左の名前の列の字。例「避難先１」）の 1 欄（shape text）にして項目を当てる。書く所のそばの小さな字（「名称」「施設名」など）を label にしない。種類の □ は「〇〇 種類」の名前の 1 欄（shape choice、options に □ の選択肢を全部。合う項目が無ければ null）にし、□ を 1 つずつ別の欄（check）に挙げない。",
  "17. 1 人 1 行の空の行が見出しの行の下に何行も並ぶ一覧の表（利用者の一覧・名簿・安否確認の表など）は、列ごとに 1 欄を挙げる。label はその列の見出しの字のまま、sections の name は 2 段の見出しの上の段の字（無ければ空文字）。行の番号（1・2・3）を段や欄の名前にしない。box は 1 行目（見出しのすぐ下の行）のその列の枠。番号が刷ってある列（No・番号）も欄に挙げ、item は null。表の外の欄（事業所名・作成日など）は今までどおり挙げる。",
  "    list には、その表の人を書く行の数（rows）と、1 行目の帯（first）と最後の行の帯（last）の場所を [x, y, w, h] で入れる。一覧の表の無い頁は list を null。",
  "18. 医師・看護師など医療の人や市の職員が書く欄が 1 つの段に何個も並ぶ所（診察・処置・症候の □ の並び、傷病名の行の繰り返しなど）は、□ や行ごとに挙げず、段ごとに 1 欄（label は段の見出しの字、shape handwrite、item null、box は段全体）にまとめる。台帳の項目に当たる欄（既往症・予防接種・アレルギー・常用薬など）が入っている段はまとめない。決まり 10 の欄が 1 つ 2 つなら、今までどおり欄ごとに挙げる。",
  "19. 避難場所が何行か並び、行ごとに【手段】【時間】の欄がある所は、その行の避難場所の手段・時間の項目を当てる（避難先1〔市の指定避難所など〕は「移動手段」「避難先1までの時間」、避難先2〔事前に行く所〕は「避難先2への手段」「避難先2までの時間」、最寄りの避難場所は「最寄りの避難場所への手段」「最寄りの避難場所までの時間」）。",
  "title は様式の題名、issuer は様式を出した所（この頁に無ければ空文字）。typeface は様式に印刷された字の書体（明朝なら mincho、ゴシックなら gothic）。",
  "入力に「読み済み」があれば、それはこの頁の頭から読み済みの欄（段と欄の名前、順のとおり）。読み済みの最後の欄の次の欄から、この頁の終わりまでを挙げる。読み済みの欄は挙げない。",
].join("\n");

/** 頁の中の場所（T120 から [x, y, w, h] の数の並び。範囲は受けたあと clampBox で 0〜1 に収める） */
const WireBox = z.array(z.number());

const WireField = z.object({
  label: z.string(),
  shape: z.enum(FIELD_SHAPES),
  options: z.array(z.string()),
  item: z.string().nullable(),
  candidate: z.string().nullable(),
  confidence: z.enum(CONFIDENCES),
  reason: z.string(),
  box: WireBox.nullable(),
  option_boxes: z.array(WireBox.nullable()),
});
type WireFieldValue = z.output<typeof WireField>;

/**
 * 1 頁の返事の形（T120）。いちばん外は object。item は文字のまま受け、台帳の一覧との照合は checkReadResult で
 * （無い名前で全体を落とさない）。頁の番号は呼ぶ側が知っているので返させない
 */
export const PageReadSchema = z.object({
  title: z.string(),
  issuer: z.string(),
  typeface: z.enum(TYPEFACES),
  sections: z.array(z.object({ name: z.string(), fields: z.array(WireField) })),
  /** 一覧の表（T131。決まり 17）。人を書く行の数と、1 行目と最後の行の帯。表の無い頁は null */
  list: z.object({ rows: z.number(), first: WireBox, last: WireBox }).nullable(),
});
export type PageRead = z.output<typeof PageReadSchema>;

/** 続きを頼むときに渡す読み済みの欄（段と欄の名前だけ。値・場所は渡さない） */
export type DoneField = { 段: string; 欄: string };

/**
 * 1 頁の頼み。様式の頁 1 つと、全部の頁の数・この頁の番号・台帳の項目表。done があれば続きの頼み（読み済みの欄の名前を渡す）
 */
export function buildPageRequest(file: FormFile, page: number, pages: number, done: ReadonlyArray<DoneField> | null = null): AskJsonRequest<typeof PageReadSchema> {
  // 読み済みの欄の名前は Claude が返した物。電話番号らしい並びを消し、長さを切ってから仮名化の門（印）を通す
  const doneList = done?.map((d) => ({ 段: clean(d.段, LIMITS.section), 欄: clean(d.欄, LIMITS.label) })) ?? null;
  return {
    purpose: "form_read",
    system: FORM_READ_SYSTEM,
    input: sealItemCatalog({ 頁: { no: page, of: pages }, items: itemCatalog(), ...(doneList ? { 読み済み: doneList } : {}) }),
    attachments: [file.attachment],
    schema: PageReadSchema,
  };
}

/** 1 頁目の頼み（前からの呼び方。テストと 1 頁の様式） */
export function buildReadRequest(file: FormFile): AskJsonRequest<typeof PageReadSchema> {
  return buildPageRequest(file, 1, 1);
}

// ---------- 返事を対応表の形に ----------

const boxOfWire = (b: ReadonlyArray<number> | null | undefined): FieldBox | null =>
  Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === "number" && Number.isFinite(n)) ? { x: b[0], y: b[1], w: b[2], h: b[3] } : null;

const wireOfBox = (b: FieldBox | null | undefined): number[] | null => (b ? [b.x, b.y, b.w, b.h] : null);

/** 1 頁の返事を、前からの返事の形（ReadResult の欄）に。頁の番号はここで付ける */
export function fieldsOfPage(read: PageRead, page: number): ReadResult["fields"] {
  return read.sections.flatMap((s) =>
    s.fields.map((f) => ({
      page,
      section: s.name,
      label: f.label,
      position: "",
      shape: f.shape,
      options: f.options,
      item: f.item,
      candidate: f.candidate,
      confidence: f.confidence,
      reason: f.reason,
      box: boxOfWire(f.box),
      option_boxes: f.option_boxes.map(boxOfWire),
    })),
  );
}

/**
 * 前からの返事の形（正解の表・固定の返事）を、1 頁の返事の形に（偽の client とテストが使う）。
 * 欄の頁が page の物だけを、段の続く所ごとにまとめる
 */
export function toPageRead(r: ReadResult, page: number): PageRead {
  const sections: PageRead["sections"] = [];
  for (const f of r.fields) {
    if (f.page !== page) continue;
    const last = sections[sections.length - 1];
    const field: WireFieldValue = {
      label: f.label,
      shape: f.shape,
      options: f.options,
      item: f.item,
      candidate: f.candidate ?? null,
      confidence: f.confidence,
      reason: f.reason,
      box: wireOfBox(f.box),
      option_boxes: (f.option_boxes ?? []).map(wireOfBox),
    };
    if (last && last.name === f.section) last.fields.push(field);
    else sections.push({ name: f.section, fields: [field] });
  }
  const list = r.list && r.list.page === page && r.list.first && r.list.last ? { rows: r.list.rows, first: wireOfBox(r.list.first)!, last: wireOfBox(r.list.last)! } : null;
  return { title: page === 1 ? r.title : "", issuer: page === 1 ? r.issuer : "", typeface: r.typeface ?? "gothic", sections, list };
}

// ---------- 切れた答えから読めた欄を拾う ----------

const PartialHead = z.object({ title: z.string().optional(), issuer: z.string().optional(), typeface: z.enum(TYPEFACES).optional() });

/**
 * 出力の上限で切れた答え（JSON の途中）から、終わりまで書けた欄だけを拾う（T120）。
 * 欄の閉じ括弧の所で切り、開いたままの括弧を閉じて読む。拾えなければ null
 */
export function salvagePageRead(text: string): PageRead | null {
  // 閉じ括弧の位置と、その時に開いている括弧の並び
  const closes: Array<{ at: number; open: string }> = [];
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      closes.push({ at: i, open: stack.join("") });
    }
  }
  // 後ろの閉じ括弧から順に、残りを閉じて読めるか試す（欄 1 つの終わり〔{[{[ の中の } 〕が見つかるまで）
  for (let k = closes.length - 1; k >= 0; k--) {
    const { at, open } = closes[k];
    if (open !== "{[{[") continue;
    const tail = [...open].reverse().map((c) => (c === "{" ? "}" : "]")).join("");
    let raw: unknown;
    try {
      raw = JSON.parse(text.slice(0, at + 1) + tail);
    } catch {
      continue;
    }
    const o = (raw ?? {}) as Record<string, unknown>;
    const head = PartialHead.safeParse(o);
    if (!head.success || !Array.isArray(o.sections)) continue;
    const sections: PageRead["sections"] = [];
    for (const s of o.sections as unknown[]) {
      const sec = (s ?? {}) as Record<string, unknown>;
      if (typeof sec.name !== "string" || !Array.isArray(sec.fields)) continue;
      const fields = sec.fields.flatMap((f) => {
        const ok = WireField.safeParse(f);
        return ok.success ? [ok.data] : [];
      });
      if (fields.length > 0) sections.push({ name: sec.name, fields });
    }
    if (sections.length === 0) return null;
    // 一覧の表（list）は答えの最後にあるので、切れた答えからは拾わない（続きの答えから）
    return { title: head.data.title ?? "", issuer: head.data.issuer ?? "", typeface: head.data.typeface ?? "gothic", sections, list: null };
  }
  return null;
}

/** 読み済みの欄（続きの頼みに渡す） */
export const doneFieldsOf = (r: PageRead): DoneField[] => r.sections.flatMap((s) => s.fields.map((f) => ({ 段: s.name, 欄: f.label })));

/** 拾えた欄と続きの答えをつなぐ。続きが読み済みの欄を繰り返したら落とす。段の見出しが続けば 1 つの段に */
export function joinPageReads(head: PageRead, more: PageRead): PageRead {
  const seen = new Set(doneFieldsOf(head).map((d) => `${d.段}\u0000${d.欄}`));
  const sections = head.sections.map((s) => ({ ...s, fields: [...s.fields] }));
  for (const s of more.sections) {
    const fields = s.fields.filter((f) => !seen.has(`${s.name}\u0000${f.label}`));
    if (fields.length === 0) continue;
    const last = sections[sections.length - 1];
    if (last && last.name === s.name) last.fields.push(...fields);
    else sections.push({ name: s.name, fields });
  }
  return { title: head.title || more.title, issuer: head.issuer || more.issuer, typeface: head.typeface, sections, list: head.list ?? more.list };
}

// ---------- 読む ----------

/** 1 頁の結果。partial は切れた答えから拾った欄だけ（続きも失敗） */
type PageOutcome = { page: number; ok: true; read: PageRead; model: string; continued: boolean; partial: boolean } | { page: number; ok: false; error: unknown };

/** 1 頁を読む。切れたら拾えた欄を残して続きを 1 回頼む */
async function readPage(file: FormFile, page: number, pages: number, ctx: AskJsonContext): Promise<PageOutcome> {
  try {
    const r = await askJson(buildPageRequest(file, page, pages), ctx);
    return { page, ok: true, read: r.value, model: r.model, continued: false, partial: false };
  } catch (e) {
    if (!(e instanceof AiTruncated)) return { page, ok: false, error: e };
    const got = salvagePageRead(e.partial);
    if (!got) return { page, ok: false, error: e };
    try {
      const more = await askJson(buildPageRequest(file, page, pages, doneFieldsOf(got)), ctx);
      return { page, ok: true, read: joinPageReads(got, more.value), model: more.model, continued: true, partial: false };
    } catch (e2) {
      // 続きも切れたら、続きの答えから拾えた欄も足す
      const tail = e2 instanceof AiTruncated ? salvagePageRead(e2.partial) : null;
      return { page, ok: true, read: tail ? joinPageReads(got, tail) : got, model: e.model, continued: true, partial: true };
    }
  }
}

/** 一覧の表（T131）: 表のある最初の頁の行の数と帯。形の確かめは checkReadResult（listShapeOf） */
function listOfPages(good: ReadonlyArray<{ page: number; read: PageRead }>): Pick<ReadResult, "list"> {
  const hit = good.find((o) => o.read.list !== null);
  if (!hit || !hit.read.list) return {};
  const { rows, first, last } = hit.read.list;
  return { list: { page: hit.page, rows, first: boxOfWire(first), last: boxOfWire(last) } };
}

/** 並べて回す（同時に limit 個まで）。順は入力のまま */
async function pool<T, R>(items: readonly T[], limit: number, f: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

export type FormReadResult = CheckedRead & {
  mark: AiMark;
  /** 読めなかった頁（読めた頁の欄だけで対応表にした） */
  unread: number[];
  /** 出力の上限で切れ、拾えた欄だけの頁（続きも失敗） */
  partial: number[];
  /** 続きを頼んだ頁 */
  continued: number[];
};

export type ReadFormOptions = {
  /**
   * 同時に読む頁の数。既定は全部（頁は 3 まで）。評価の台（tools/eval/forms）は 1（呼び出しの記録を順に結ぶため）
   */
  concurrency?: number;
  /** 読む頁の番号（files と同じ順。無ければ 1 から）。読めなかった頁を読み直すとき */
  pageNumbers?: readonly number[];
  /** 全部の頁の数（無ければ files の数） */
  pages?: number;
};

/**
 * 様式を頁ごとに読ませて対応表（下書き）にする。読めた頁が 1 つも無ければ、最初の頁の失敗を投げる
 * （AiNotConfigured・AiLimitReached・AiRefused・AiBadOutput・AiCallFailed）。鍵が無いときはどの頁も呼ばない
 */
export async function readForm(file: FormFile | ReadonlyArray<FormFile>, ctx: AskJsonContext, opts: ReadFormOptions = {}): Promise<FormReadResult> {
  const files: ReadonlyArray<FormFile> = Array.isArray(file) ? file : [file as FormFile];
  const pageNos = opts.pageNumbers ?? files.map((_, i) => i + 1);
  const pages = opts.pages ?? files.length;
  const outcomes = await pool(files, opts.concurrency ?? files.length, (f, i) => readPage(f, pageNos[i], pages, ctx));
  const good = outcomes.filter((o): o is Extract<PageOutcome, { ok: true }> => o.ok);
  const bad = outcomes.filter((o): o is Extract<PageOutcome, { ok: false }> => !o.ok);
  // 鍵が無い・読めた頁が無いときは、前と同じく失敗を投げる
  const notConfigured = bad.find((o) => o.error instanceof AiNotConfigured);
  if (notConfigured) throw notConfigured.error;
  if (good.length === 0) throw bad[0].error;
  const first = good[0].read;
  const typeface: Typeface = first.typeface;
  const read: ReadResult = {
    title: good.map((o) => o.read.title.trim()).find((t) => t !== "") ?? "",
    issuer: good.map((o) => o.read.issuer.trim()).find((t) => t !== "") ?? "",
    pages,
    typeface,
    fields: good.flatMap((o) => fieldsOfPage(o.read, o.page)),
    ...(bad.length > 0 ? { unread: bad.map((o) => o.page) } : {}),
    ...listOfPages(good),
  };
  const checked = checkReadResult(read);
  return {
    ...checked,
    mark: { ai: true, model: good[0].model, purpose: "form_read" },
    unread: bad.map((o) => o.page),
    partial: good.filter((o) => o.partial).map((o) => o.page),
    continued: good.filter((o) => o.continued).map((o) => o.page),
  };
}
