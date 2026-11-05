// 書類の紙の AI の見直しと再考（T136、docs/DECISIONS.md「書類」の案（T136））。
//
// AI の見直し: 刷る紙の頁の絵（ブラウザが紙と同じ字の大きさと場所で描いた物）を Claude に見せ、置いた値の一覧（欄の名前と値）と見比べて
// 「違う欄に入っている・読めない・欄の名前と中身が合わない・伏字が出ている」を挙げてもらう。
// - 名前・住所・電話・生年月日などの欄（paintedFields）は、絵の上で黒く塗る。塗る所はサーバーが決め、ブラウザに渡す描く物（ComposePlan）には
//   その欄の字を入れない（字を描かずに黒い四角だけ）。下に敷く頁の画像は、元の様式の空の頁（取り込みのときに黒塗りの画面を通した物か、
//   公式の原本）。塗りはブラウザで lib/redact/paint.ts の paintRects（取り込みの黒塗りと同じ）、JPEG にして付け足しを外す
// - 塗る欄は、欄の名前・台帳の元の名前の形と、欄の値を仮名化の門（pseudonymizeText）に通して変わるか（伏せる物があるか）で決める。
//   日付・電話の部品ごとの字は欄ごとにまとめて見る（部品 1 つずつでは伏せる形にならない）
// - 値の一覧は仮名化の門を通す。塗った欄は値を「（塗り）」にし、AI が挙げても使わない（塗った欄は台帳の本当の値で置いてあり、決まりの見直しが見る）
// - 答えは決まった形（欄の id・種類・どこが・なぜ）。医療の判断を書かせない。理由は短く切り、医療の語と作った名前の形を落とす
//
// 再考: 見直しで直せそうな欄（対応表の紙の欄の場所・項目の読み違い）だけを、元の様式の空の頁の画像から読み直す（Opus、頁ごとに 1 回）。
// 答えは欄の場所・項目・区切りだけで、人の値は渡さない（台帳の項目表と欄の名前だけ。lib/forms/form-read.ts と同じ門）。

import * as z from "zod";
import { askJson, type AskJsonContext, type ClaudeAttachment } from "../claude/call.ts";
import { FORM_REVIEW, FORM_REREAD } from "../claude/models.ts";
import { maskReply, pseudonymizeText, sealItemCatalog, type PseudonymKey } from "../pseudonym/index.ts";
import { FORM_READ_SYSTEM } from "./form-read.ts";
import { clampBox, FIELD_SHAPE_LABELS, isLedgerItemKey, itemCatalog, LIMITS, clean, type FieldBox, type MappingField } from "./mapping.ts";
import type { OverlayItem, OverlaySheet } from "./overlay-sheet.ts";
import type { FieldFix } from "./review-db.ts";
import { AI_KINDS, REDO_KINDS, REVIEW_LABELS, type AiKind, type ReviewField, type ReviewFinding, type ReviewKind, type ReviewSubject } from "./review.ts";

// ---------- 塗る欄 ----------

/** 名前・住所・電話・生年月日の欄の名前 */
const SENSITIVE_LABEL = /氏名|名前|フリガナ|ふりがな|住所|所在地|電話|携帯|TEL|Tel|ＴＥＬ|FAX|ＦＡＸ|生年月日|メール|郵便|〒|連絡先|署名|自署|地区|町名/;
/** 台帳の元（対応表の項目・原本の枠の欄の key）の名前の形 */
const SENSITIVE_SOURCE = /(^|[.])(name|kana|address|phone|mobile|birth|town|district|tel|mail|postal|welfare|watcher|offices)\b/i;

/** 欄の紙の上の字（部品をまとめて 1 つに） */
function paperText(items: readonly OverlayItem[]): string {
  return items.flatMap((it) => (it.kind === "text" ? it.lines : [])).join(" ");
}

/** 字が仮名化の門で変わるか（伏せる物がある・漏れで止まる） */
function scrubs(text: string, key: PseudonymKey): boolean {
  if (!text.trim()) return false;
  try {
    return pseudonymizeText(text, key).text !== text;
  } catch {
    return true;
  }
}

/** 塗る欄（ReviewField の id）。名前・元の形・値の中身のどれかで決める。地図の画像（家の位置）も塗る */
export function paintedFields(s: ReviewSubject, key: PseudonymKey): Set<string> {
  const items = new Map<string, OverlayItem[]>();
  for (const p of s.sheet.pages) {
    for (const it of p.items) {
      const f = s.fieldOf(it.fieldId);
      if (!f) continue;
      items.set(f, [...(items.get(f) ?? []), it]);
    }
  }
  const out = new Set<string>();
  for (const f of s.fields) {
    const its = items.get(f.id) ?? [];
    if (its.length === 0) continue;
    if (
      SENSITIVE_LABEL.test(f.label) ||
      (f.source !== null && SENSITIVE_SOURCE.test(f.source)) ||
      its.some((it) => it.kind === "image") ||
      scrubs(paperText(its), key) ||
      scrubs(f.values.join(" "), key)
    ) {
      out.add(f.id);
    }
  }
  // 欄の分からない物（書き込みの欄など）は、字が門で変わるときだけ塗る（下の composePlan が欄の無い物も見る）
  return out;
}

// ---------- ブラウザで描く物 ----------

export type ComposeDraw =
  | { kind: "text"; box: FieldBox; lines: string[]; fontPt: number; top: boolean }
  | { kind: "mark"; box: FieldBox; mark: "check" | "circle" };

export type ComposePage = {
  page: number;
  /** 下に敷く頁の画像（同じ所の API） */
  href: string;
  landscape: boolean;
  /** 頁の画像の箱（mm。A4 の中） */
  image: { x: number; y: number; w: number; h: number };
  draws: ComposeDraw[];
  /** 黒く塗る所（頁の画像の比） */
  paints: FieldBox[];
};

export type ComposePlan = {
  hash: string;
  typeface: OverlaySheet["typeface"];
  pages: ComposePage[];
};

/** 塗る四角を少し広げる（字の端のにじみ・見積もりの誤差。頁の比） */
const PAINT_GROW = 0.004;
const grow = (b: FieldBox): FieldBox => ({ x: b.x - PAINT_GROW, y: b.y - PAINT_GROW, w: b.w + PAINT_GROW * 2, h: b.h + PAINT_GROW * 2 });

/**
 * ブラウザで描く物。塗る欄の字・印・画像は入れず、その場所（と欄の矩形）を paints に。欄の分からない字（書き込みの欄）も門で変われば塗る
 */
export function composePlan(s: ReviewSubject, painted: ReadonlySet<string>, key: PseudonymKey, hash: string, href: (page: number) => string): ComposePlan {
  const byId = new Map(s.fields.map((f) => [f.id, f]));
  const pages = s.sheet.pages.map((p): ComposePage => {
    const draws: ComposeDraw[] = [];
    const paints: FieldBox[] = [];
    for (const it of p.items) {
      const f = s.fieldOf(it.fieldId);
      const hide = (f !== null && painted.has(f)) || it.kind === "image" || (it.kind === "text" && scrubs(it.lines.join(" "), key));
      if (hide) {
        paints.push(grow(it.box));
        continue;
      }
      if (it.kind === "text") draws.push({ kind: "text", box: it.box, lines: it.lines, fontPt: it.fontPt, top: it.top });
      else if (it.kind === "mark") draws.push({ kind: "mark", box: it.box, mark: it.mark });
    }
    // 塗る欄の矩形も塗る（字が欄の中のどこにあっても隠れるように）
    for (const id of painted) {
      const f = byId.get(id);
      if (f?.box && f.page === p.page) paints.push(grow(f.box));
    }
    return { page: p.page, href: href(p.page), landscape: p.landscape, image: p.image, draws, paints };
  });
  return { hash, typeface: s.sheet.typeface, pages };
}

/** 頁ごとの塗る四角の数（受けた絵の印と照らす） */
export const paintCounts = (plan: ComposePlan): number[] => plan.pages.map((p) => p.paints.length);

// ---------- 値の一覧（Claude に渡す） ----------

export type ReviewListRow = { rid: string; field: string; page: number; label: string; value: string; box: [number, number, number, number] | null; painted: boolean };

const pct = (n: number) => Math.round(n * 1000) / 10;

/** 紙に置いた欄の一覧（紙の順）。塗った欄の値は「（塗り）」 */
export function reviewList(s: ReviewSubject, painted: ReadonlySet<string>): ReviewListRow[] {
  const placed = new Map<string, { page: number; items: OverlayItem[] }>();
  for (const p of s.sheet.pages) {
    for (const it of p.items) {
      const f = s.fieldOf(it.fieldId);
      if (!f) continue;
      const cur = placed.get(f) ?? { page: p.page, items: [] };
      cur.items.push(it);
      placed.set(f, cur);
    }
  }
  const rows: ReviewListRow[] = [];
  for (const f of s.fields) {
    const got = placed.get(f.id);
    if (!got) continue;
    const isPainted = painted.has(f.id);
    const texts = got.items.flatMap((it) => (it.kind === "text" ? [it.lines.join(" ")] : []));
    const marks = got.items.some((it) => it.kind === "mark") ? f.marked : [];
    const value = isPainted ? "（塗り）" : [...texts, ...marks.map((m) => `□${m}`)].join(" ／ ") || "（印）";
    const b = f.box ?? (got.items[0]?.box as FieldBox | undefined) ?? null;
    rows.push({ rid: `r${rows.length + 1}`, field: f.id, page: got.page, label: f.label, value, box: b ? [pct(b.x), pct(b.y), pct(b.w), pct(b.h)] : null, painted: isPainted });
  }
  return rows;
}

/** 一覧を 1 つの文に（1 行 1 欄。id｜頁｜欄の名前｜値｜場所 %） */
export function listText(rows: readonly ReviewListRow[]): string {
  return rows.map((r) => [r.rid, `${r.page}頁`, clean(r.label, LIMITS.label), r.value, r.box ? r.box.join(",") : "場所なし"].join("｜")).join("\n");
}

// ---------- AI の見直し ----------

export const FORM_REVIEW_SYSTEM = [
  "入力の画像は、日本の市町村などの様式（個別避難計画など）の頁に、ケア72 が台帳の値を置いた紙。刷る前の見直し。",
  "入力の「一覧」は紙に置いた欄の一覧で、1 行 1 欄（id｜頁｜欄の名前｜置いた値｜場所 [左 %,上 %,幅 %,高さ %]）。値の「（塗り）」の欄は、名前・住所・電話などを隠すために画像の上で黒く塗った欄。",
  "入力に「頁」があるときは、紙の一部の頁だけを見ている。画像はその頁の番号の順で、一覧はその頁の欄だけ。",
  "画像と一覧を見比べて、次の 4 つだけを挙げる。",
  "  misplaced: 値が欄の名前と違う欄・違う行・違う段に入っている（隣の欄にずれた、別の行の書く所に入った）",
  "  unreadable: 値が様式に刷ってある字・線・□ と重なって読めない、小さすぎて読めない、枠で切れている",
  "  mismatch: 欄の名前が求める物と、置いた値の中身が合わない（例: 日付の欄に名前、電話の欄に住所、種類の欄に関係ない言葉）",
  "  masked: 紙に（氏名）（町名）（電話）（住所）（生年月日）のような伏字や仮の言い方がそのまま出ている",
  "黒く塗った所・（塗り）の欄は見ない。空いている・読めないとして挙げない（塗った欄は別の仕組みが確かめる）。値の入っていない欄も挙げない。",
  "id は一覧の id。where はどこが（20 字まで、例「右の欄へずれ」）、why はなぜ（40 字まで）。値をそのまま書き写さない。",
  "病気・体の状態・薬の量・急ぐかどうかの判断や助言を書かない。問題が無ければ findings は空の配列。",
].join("\n");

export const ReviewReplySchema = z.object({
  findings: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(AI_KINDS),
      where: z.string(),
      why: z.string(),
    }),
  ),
});
export type ReviewReply = z.output<typeof ReviewReplySchema>;

/** 理由に書かせない医療の語（落とす） */
const MEDICAL_WORDS = /診断|判定|重症|緊急度|病名|投与|用量|処方|治療方針/;

function cleanWhy(text: string, key: PseudonymKey, max: number): string {
  const t = text.replace(/\s+/g, " ").trim().slice(0, max);
  if (!t || MEDICAL_WORDS.test(t)) return "";
  return maskReply(t, key) ?? "";
}

/** AI の答えを見直しの所に。一覧に無い id・塗った欄・値の無い欄は捨てる */
export function aiFindings(reply: ReviewReply, rows: readonly ReviewListRow[], s: ReviewSubject, key: PseudonymKey): ReviewFinding[] {
  const byRid = new Map(rows.map((r) => [r.rid, r]));
  const byId = new Map(s.fields.map((f) => [f.id, f]));
  const out: ReviewFinding[] = [];
  for (const f of reply.findings) {
    const row = byRid.get(f.id.trim());
    if (!row || row.painted) continue;
    const field = byId.get(row.field);
    if (!field) continue;
    const id = `ai:${f.kind}:${field.id}`;
    if (out.some((x) => x.id === id)) continue;
    const where = cleanWhy(f.where, key, 20);
    const why = cleanWhy(f.why, key, 40);
    out.push({
      id,
      by: "ai",
      kind: f.kind,
      level: "fix",
      field: field.id,
      label: field.label,
      page: field.page,
      box: field.box,
      items: [],
      why: [where, why].filter((x) => x).join("・") || REVIEW_LABELS[f.kind],
      ...(s.redoable && REDO_KINDS.has(f.kind) ? { redo: true } : {}),
    });
  }
  return out;
}

/** 受けた絵（塗った後の JPEG）を Claude に渡す形 */
export const jpegAttachment = (bytes: Uint8Array): ClaudeAttachment => ({ kind: "image", mediaType: "image/jpeg", data: base64(bytes) });

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * 1 回の見直しの呼び出しに付ける頁の数（T146）。頁の上限を 10 にしたが、1 回に付ける頁は前の上限（4）のままにする:
 * 1 回の要求の大きさ（Claude の 1 要求 32 MB。絵 1 枚 5 MB まで × 4 枚の base64 で 27 MB）・答えの長さ（指摘 20 件ほど、上限 8000）・
 * 待ち（120 秒）を前と同じに保つ。5 頁からは 4 頁ずつに分けて並べて呼び、指摘を結ぶ（10 頁で 3 回、待ちは 1 回分）
 */
export const REVIEW_PAGES_PER_CALL = 4;

/** 頁の並び（0 から）を REVIEW_PAGES_PER_CALL ずつに分ける */
export function reviewGroups(count: number, per: number = REVIEW_PAGES_PER_CALL): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < count; i += per) out.push(Array.from({ length: Math.min(per, count - i) }, (_, j) => i + j));
  return out;
}

/**
 * AI の見直し（Sonnet）。紙の頁を 4 頁までなら 1 回、5 頁からは 4 頁ずつ（reviewGroups）に分けて並べて呼ぶ。
 * 塗った絵と仮名の一覧だけを渡す（分けたときは、その頁の欄の行だけと頁の番号）。どれかの回が失敗したら全体を失敗にする（人が押し直す）。
 * calls は呼んだ回数（記録の calls と ai_calls に同じ数）
 */
export async function runAiReview(
  ctx: AskJsonContext,
  args: { subject: ReviewSubject; rows: readonly ReviewListRow[]; images: readonly Uint8Array[]; key: PseudonymKey },
): Promise<{ findings: ReviewFinding[]; model: string; calls: number }> {
  const sheetPages = args.subject.sheet.pages.map((p) => p.page);
  // 絵の順は紙の頁の順（composePlan）。数が合わなければ 1 から数える
  const pageOf = (i: number) => (sheetPages.length === args.images.length ? sheetPages[i] : i + 1);
  const groups = reviewGroups(args.images.length);
  const split = groups.length > 1;
  const results = await Promise.all(
    groups.map(async (g) => {
      const pages = g.map(pageOf);
      const rows = split ? args.rows.filter((r) => pages.includes(r.page)) : args.rows;
      const res = await askJson(
        {
          purpose: "form_read",
          spec: FORM_REVIEW,
          system: FORM_REVIEW_SYSTEM,
          // 頁の番号は数だけ（人の値は無い）。台帳の項目表と同じ門（sealItemCatalog。電話番号らしい並びで止まる）を通す
          input: { ...(split ? { 頁: sealItemCatalog(pages) } : {}), 一覧: pseudonymizeText(listText(rows), args.key) },
          attachments: g.map((i) => jpegAttachment(args.images[i])),
          schema: ReviewReplySchema,
        },
        ctx,
      );
      return { findings: aiFindings(res.value, rows, args.subject, args.key), model: res.model };
    }),
  );
  const findings: ReviewFinding[] = [];
  for (const r of results) for (const f of r.findings) if (!findings.some((x) => x.id === f.id)) findings.push(f);
  return { findings, model: results[0]?.model ?? "", calls: groups.length };
}

// ---------- 再考（その欄だけの読み直し） ----------

export const FORM_REREAD_SYSTEM = [
  FORM_READ_SYSTEM,
  "",
  "今回の頼み: この頁の全部の欄でなく、入力の「直す欄」に挙げた欄だけを読み直す。直す欄には、前に読んだ欄の名前・形・項目・場所と、見直しで見つかった問題（欄違い・判読難・不一致・重なり・枠外・未配置・日付形式・署名欄）がある。",
  "欄ごとに、正しい box（値を書く空白の内側。刷ってある字・□・罫線を含めない）、item（決まり 5・10・11 のとおり。署名・押印・同意の欄は null）、options と option_boxes（決まり 2・9・14・15）を決めて fields に返す。",
  "id は直す欄の id のまま。直す所が無ければ前の値をそのまま返す。reason は直した理由を 20 字まで。直す欄に無い欄は返さない。",
].join("\n");

const WireBox = z.array(z.number());
export const RereadReplySchema = z.object({
  fields: z.array(
    z.object({
      id: z.string(),
      item: z.string().nullable(),
      box: WireBox.nullable(),
      options: z.array(z.string()),
      option_boxes: z.array(WireBox.nullable()),
      reason: z.string(),
    }),
  ),
});
export type RereadReply = z.output<typeof RereadReplySchema>;

const boxOf = (b: readonly number[] | null | undefined): FieldBox | null => (Array.isArray(b) && b.length === 4 ? clampBox({ x: b[0], y: b[1], w: b[2], h: b[3] }) : null);
const wire = (b: FieldBox | null | undefined) => (b ? [b.x, b.y, b.w, b.h].map((n) => Math.round(n * 1000) / 1000) : null);

export type RedoTarget = { field: MappingField; kinds: ReviewKind[] };

/** 直す欄の頼みの中身（欄の名前・形・前の場所と項目・問題の種類だけ。人の値は入れない） */
export function rereadInput(page: number, pages: number, targets: readonly RedoTarget[]) {
  return sealItemCatalog({
    頁: { no: page, of: pages },
    items: itemCatalog(),
    直す欄: targets.map((t) => ({
      id: t.field.id,
      段: clean(t.field.section, LIMITS.section),
      欄: clean(t.field.label, LIMITS.label),
      形: FIELD_SHAPE_LABELS[t.field.shape],
      選択肢: t.field.options.map((o) => clean(o, LIMITS.option)),
      項目: t.field.item,
      box: wire(t.field.box),
      option_boxes: (t.field.optionBoxes ?? []).map(wire),
      問題: [...new Set(t.kinds.map((k) => REVIEW_LABELS[k]))],
    })),
  });
}

/** 読み直しの答えを直しに（変わった欄だけ。台帳に無い項目は前のまま） */
export function fixesOf(reply: RereadReply, targets: readonly RedoTarget[], round: number): FieldFix[] {
  const out: FieldFix[] = [];
  for (const r of reply.fields) {
    const t = targets.find((x) => x.field.id === r.id.trim());
    if (!t) continue;
    const f = t.field;
    const before = { item: f.item, box: f.box ?? null, options: [...f.options], ...(f.optionBoxes ? { optionBoxes: [...f.optionBoxes] } : {}) };
    const item = r.item === null ? null : isLedgerItemKey(r.item) ? r.item : f.item;
    const box = boxOf(r.box) ?? f.box ?? null;
    const options = r.options.map((o) => clean(o, LIMITS.option)).slice(0, LIMITS.options);
    const optionBoxes = r.option_boxes.slice(0, options.length).map(boxOf);
    const after = { item, box, options, ...(optionBoxes.length > 0 ? { optionBoxes } : {}) };
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    out.push({ field: f.id, before, after, reason: clean(r.reason, 40), round });
  }
  return out;
}

/** 1 頁の直す欄を読み直す（Opus。元の様式の空の頁の画像 1 枚と、台帳の項目表と欄の名前だけ） */
export async function rereadFields(
  ctx: AskJsonContext,
  args: { page: number; pages: number; image: ClaudeAttachment; targets: readonly RedoTarget[]; round: number },
): Promise<FieldFix[]> {
  const res = await askJson(
    {
      purpose: "form_read",
      spec: FORM_REREAD,
      system: FORM_REREAD_SYSTEM,
      input: rereadInput(args.page, args.pages, args.targets),
      attachments: [args.image],
      schema: RereadReplySchema,
    },
    ctx,
  );
  return fixesOf(res.value, args.targets, args.round);
}

/** 再考の回の上限（docs/DECISIONS.md「書類」の案（T136）の費用の見込みから） */
export const REDO_ROUNDS_MAX = 2;

/** 見直しの所から、再考する欄（対応表の紙の、再考で直せそうな種類の欄）と問題の種類 */
export function redoTargets(found: readonly ReviewFinding[], fields: readonly MappingField[], done: ReadonlySet<string> = new Set()): RedoTarget[] {
  const out = new Map<string, RedoTarget>();
  for (const f of found) {
    if (!f.redo || done.has(f.field)) continue;
    const field = fields.find((x) => x.id === f.field && !x.removed);
    if (!field) continue;
    const t = out.get(field.id) ?? { field, kinds: [] };
    t.kinds.push(f.kind);
    out.set(field.id, t);
  }
  return [...out.values()];
}

export { AI_KINDS };
export type { AiKind, ReviewField };
