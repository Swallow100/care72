// 評価の台（T107）の数え方。どれも正解と比べ、1 件ずつの判定と理由（judgement）を返す。数は判定を数えた物だけ。
//
// 1. 様式の読み取り（scoreRead）: 正解の欄と AI の欄を、名前・段・頁・場所で 1 対 1 に合わせ（greedy）、
//    当たり（項目が同じ・別解）・外れ（違う項目）・取りこぼし（正解は項目あり、AI は null）・欄の読み落とし・余分な欄・台帳に無い項目名、
//    場所（AI の矩形の真ん中が正解の矩形の中か）
// 2. 入れる欄（scoreIntake）: 正解どおりに分けたときの変更（同じ道を通した物）と、AI の変更を、変更の種類と相手（欄・薬の名前・機器・
//    ハザード・連絡先・特記・分からない）で合わせ、値が同じか
// 3. 紙の値（scorePaper）: 正解の対応表 × 正解どおりの台帳で作った紙と、AI の対応表 × AI の分けた台帳で作った紙を、正解の欄ごとに
//    書く字で比べる（当たり・取りこぼし・置き間違い〔違う字・余分な字〕・場所違い）。別紙の数、未記入の数え方（紙に何も書かない欄が
//    帯の未確認に入っているか）と、正解との未確認の差

import type { FieldBox, FormMapping, MappingField } from "../../../lib/forms/mapping.ts";
import { normalizeWord, type MappedSheet } from "../../../lib/forms/mapped-sheet.ts";
import type { Cell } from "../../../lib/forms/matsuyama.ts";
import { cellLines, type OverlaySheet } from "../../../lib/forms/overlay-sheet.ts";
import { isUnconfirmedCell } from "../../../lib/forms/unconfirmed.ts";
import type { DiffItem } from "../../../lib/intake/diff.ts";
import type { IntakeChange } from "../../../lib/intake/changes.ts";
import { hasAnyMark } from "../../../lib/pseudonym/index.ts";
import type { GoldField, GoldForm } from "./gold.ts";

export type Judgement = {
  /** read・intake・paper */
  stage: string;
  input?: string;
  form?: string;
  /** 正解の欄・変更の相手 */
  target: string;
  verdict: string;
  /** なぜその判定か（短い） */
  reason: string;
  expected?: unknown;
  actual?: unknown;
};

const norm = (s: string) => normalizeWord(s).toLowerCase();

// ---------- 1. 様式の読み取り ----------

export type ReadScore = {
  goldFields: number;
  aiFields: number;
  matched: number;
  /** 項目が同じ（null どうしを含む） */
  hit: number;
  /** 別解で当たり */
  alt: number;
  wrong: number;
  missItem: number;
  missField: number;
  extraField: number;
  rejected: number;
  boxHit: number;
  boxMiss: number;
  boxNone: number;
};

export const emptyReadScore = (): ReadScore => ({ goldFields: 0, aiFields: 0, matched: 0, hit: 0, alt: 0, wrong: 0, missItem: 0, missField: 0, extraField: 0, rejected: 0, boxHit: 0, boxMiss: 0, boxNone: 0 });

const center = (b: FieldBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const iou = (a: FieldBox, b: FieldBox) => {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};
/** 場所が合うか: AI の矩形の真ん中が、正解の矩形を 0.01 広げた中 */
export function boxInside(ai: FieldBox, gold: FieldBox, pad = 0.01): boolean {
  const c = center(ai);
  return c.x >= gold.x - pad && c.x <= gold.x + gold.w + pad && c.y >= gold.y - pad && c.y <= gold.y + gold.h + pad;
}

/** 合わせの点数（名前 4・一部 2、段 2・一部 1、頁 1、場所 3） */
export function matchScore(g: GoldField, a: MappingField): number {
  let s = 0;
  const gl = norm(g.label);
  const al = norm(a.label);
  if (gl === al) s += 4;
  else if (gl && al && (gl.includes(al) || al.includes(gl))) s += 2;
  const gs = norm(g.section);
  const as = norm(a.section);
  if (gs === as) s += gs ? 2 : 1;
  else if (gs && as && (gs.includes(as) || as.includes(gs))) s += 1;
  if (g.page === a.page) s += 1;
  if (g.box && a.box && g.page === a.page) {
    if (iou(g.box, a.box) >= 0.3) s += 3;
    else if (boxInside(a.box, g.box, 0.005)) s += 2;
  }
  return s;
}

const MATCH_MIN = 4;

/** 正解の欄（index）→ AI の欄の id。合わなかった欄は無い */
export function matchFields(gold: readonly GoldField[], ai: readonly MappingField[]): Map<number, string> {
  const pairs: Array<{ g: number; a: string; s: number; shape: boolean }> = [];
  gold.forEach((g, gi) => {
    for (const a of ai) {
      if (a.removed) continue;
      const s = matchScore(g, a);
      if (s >= MATCH_MIN) pairs.push({ g: gi, a: a.id, s, shape: a.shape === g.shape });
    }
  });
  // 点の高い順、同点は形の同じ欄（T122: 同じ名前の欄を元号の選ぶ欄と日付の欄に分けて読んだとき、日付の欄と合わせる）・正解の順・AI の順
  pairs.sort((x, y) => y.s - x.s || Number(y.shape) - Number(x.shape) || x.g - y.g || Number(x.a.slice(1)) - Number(y.a.slice(1)));
  const out = new Map<number, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.g) || used.has(p.a)) continue;
    out.set(p.g, p.a);
    used.add(p.a);
  }
  return out;
}

const itemName = (k: string | null) => k ?? "（対応なし）";

export function scoreRead(form: GoldForm, mapping: FormMapping, rejected: number): { score: ReadScore; pairs: Map<number, string>; judgements: Judgement[] } {
  const gold = form.fields.filter((f) => form.pages.includes(f.page) && f.page <= mapping.pages);
  const goldIndex = gold.map((g) => form.fields.indexOf(g));
  const ai = mapping.fields.filter((f) => !f.removed && form.pages.includes(f.page));
  const local = matchFields(gold, ai);
  const pairs = new Map<number, string>();
  for (const [gi, aid] of local) pairs.set(goldIndex[gi], aid);
  const score = emptyReadScore();
  score.goldFields = gold.length;
  score.aiFields = ai.length;
  score.rejected = rejected;
  const judgements: Judgement[] = [];
  const j = (target: string, verdict: string, reason: string, expected?: unknown, actual?: unknown) =>
    judgements.push({ stage: "read", form: form.id, target, verdict, reason, expected, actual });
  gold.forEach((g, gi) => {
    const name = `${g.page}頁 ${g.section ? `${g.section} ` : ""}${g.label}`;
    const aid = local.get(gi);
    const a = aid ? ai.find((x) => x.id === aid)! : null;
    if (!a) {
      score.missField += 1;
      j(name, "欄の読み落とし", "名前・段・場所の合う欄が無い", itemName(g.item), null);
      return;
    }
    score.matched += 1;
    const accept = g.accept ?? [];
    if (a.item === g.item) {
      score.hit += 1;
      j(name, "当たり", g.item ? "項目が同じ" : "どちらも対応なし", itemName(g.item), itemName(a.item));
    } else if (accept.includes(a.item)) {
      score.alt += 1;
      j(name, "当たり（別解）", a.item === null && a.ai?.candidate === g.item ? "項目なし（同意の欄。候補が正解の項目で、人が採用する。T120）" : "決めきれない欄の別の答え", itemName(g.item), itemName(a.item));
    } else if (g.item && a.item === null) {
      score.missItem += 1;
      j(name, "取りこぼし", a.ai?.rejected ? `台帳に無い項目名 ${a.ai.rejected}` : "AI が対応なしにした", itemName(g.item), itemName(a.item));
    } else {
      score.wrong += 1;
      j(name, "外れ", g.item ? "違う項目" : "対応なしの欄に項目を当てた", itemName(g.item), itemName(a.item));
    }
    if (g.box && g.shape !== "handwrite") {
      if (!a.box) {
        score.boxNone += 1;
        j(name, "位置なし", "AI が場所を読まなかった", g.box, null);
      } else if (boxInside(a.box, g.box) && a.page === g.page) {
        score.boxHit += 1;
      } else {
        score.boxMiss += 1;
        j(name, "位置違い", a.page !== g.page ? `頁が違う（${a.page}）` : "矩形の真ん中が正解の欄の外", g.box, a.box);
      }
    }
  });
  const used = new Set(local.values());
  for (const a of ai) {
    if (used.has(a.id)) continue;
    score.extraField += 1;
    j(`${a.page}頁 ${a.section ? `${a.section} ` : ""}${a.label}`, "余分な欄", "正解の表に合う欄が無い", null, itemName(a.item));
  }
  return { score, pairs, judgements };
}

// ---------- 2. 入れる欄 ----------

export type IntakeScore = { expected: number; actual: number; hit: number; wrong: number; miss: number; extra: number; masked: number; dropped: number };
export const emptyIntakeScore = (): IntakeScore => ({ expected: 0, actual: 0, hit: 0, wrong: 0, miss: 0, extra: 0, masked: 0, dropped: 0 });

const n = (s: string | undefined | null) => norm(s ?? "");
const listValue = (v: unknown) => (Array.isArray(v) ? [...v].map((x) => n(String(x))).sort().join("|") : n(String(v)));

/** 変更の相手（id）と値 */
export function canonical(c: IntakeChange): { id: string; value: string } | null {
  switch (c.t) {
    case "field":
      return { id: `欄 ${c.key}`, value: listValue(c.value) };
    case "medication":
      return { id: `薬 ${n(c.value.name)}`, value: [c.value.category, n(c.value.schedule), n(c.value.amount), n(c.value.storage)].join("|") };
    case "device":
      return { id: `機器 ${c.value.kind}`, value: [n(c.value.detail), n(c.value.schedule)].join("|") };
    case "hazard":
      return { id: `ハザード ${c.value.kind}`, value: String(c.value.depthM ?? "") };
    case "note":
      return { id: `特記 ${n(c.value)}`, value: "" };
    case "pending":
      return { id: `不明 ${c.field}`, value: c.status };
    case "contact":
      return { id: `連絡先 ${c.value.kind} ${n(c.value.relation)} ${c.id ? "既存" : "新"}`, value: [String(c.value.nightOk ?? ""), n(c.value.note)].join("|") };
    default:
      return null;
  }
}

export function scoreIntake(input: string, expected: readonly DiffItem[], actual: readonly DiffItem[], dropped: number): { score: IntakeScore; judgements: Judgement[] } {
  const score = emptyIntakeScore();
  const judgements: Judgement[] = [];
  const exp = expected.map((d) => (d.change ? canonical(d.change) : null)).filter((x): x is { id: string; value: string } => x !== null);
  // 伏せ字の残り: 画面の印（masked）のほか、値に伏せ字の形（崩れた形も。T122）が残る物
  const act = actual.map((d) => ({ c: d.change ? canonical(d.change) : null, masked: d.masked || hasAnyMark(d.next) })).filter((x) => x.c !== null) as Array<{ c: { id: string; value: string }; masked: boolean }>;
  score.expected = exp.length;
  score.actual = act.length;
  score.dropped = dropped;
  score.masked = act.filter((a) => a.masked).length;
  const left = [...act];
  for (const e of exp) {
    const same = left.findIndex((a) => a.c.id === e.id && a.c.value === e.value);
    if (same >= 0) {
      score.hit += 1;
      left.splice(same, 1);
      judgements.push({ stage: "intake", input, target: e.id, verdict: "当たり", reason: "相手と値が同じ", expected: e.value });
      continue;
    }
    const near = left.findIndex((a) => a.c.id === e.id);
    if (near >= 0) {
      score.wrong += 1;
      judgements.push({ stage: "intake", input, target: e.id, verdict: "外れ", reason: "相手は同じで値が違う", expected: e.value, actual: left[near].c.value });
      left.splice(near, 1);
      continue;
    }
    score.miss += 1;
    judgements.push({ stage: "intake", input, target: e.id, verdict: "取りこぼし", reason: "AI の変更に無い", expected: e.value });
  }
  for (const a of left) {
    score.extra += 1;
    judgements.push({ stage: "intake", input, target: a.c.id, verdict: "余分", reason: "正解の変更に無い", actual: a.c.value });
  }
  return { score, judgements };
}

// ---------- 3. 紙の値 ----------

export type PaperScore = {
  /** 比べた正解の欄（手書きを除く） */
  judged: number;
  /** 正解に字のある欄 */
  filled: number;
  hit: number;
  miss: number;
  wrong: number;
  extra: number;
  boxMiss: number;
  annexOverflow: number;
  annexUnplaced: number;
  expectedAnnex: number;
  unconfirmedActual: number;
  unconfirmedExpected: number;
  /** 正解の欄で、未確認かどうかが正解の紙と違う数 */
  unconfirmedDiff: number;
  /** 紙に何も書かないのに未確認に数えていない欄（数え方の不具合） */
  uncountedBlank: number;
};
export const emptyPaperScore = (): PaperScore => ({
  judged: 0,
  filled: 0,
  hit: 0,
  miss: 0,
  wrong: 0,
  extra: 0,
  boxMiss: 0,
  annexOverflow: 0,
  annexUnplaced: 0,
  expectedAnnex: 0,
  unconfirmedActual: 0,
  unconfirmedExpected: 0,
  unconfirmedDiff: 0,
  uncountedBlank: 0,
});

/** 欄に書く字（□ は ■ か空、同意の無い・手書きは空） */
export function paperText(field: MappingField, cell: Cell): string {
  if (cell.kind === "withheld" || cell.kind === "handwrite") return "";
  if (field.shape === "check") return cell.kind === "choice" && cell.options.some((o) => o.on) ? "■" : "";
  return cellLines(cell, field.shape === "phone").join("／");
}

/** 欄の値を引く物（mapped-sheet の mappedCell と同じ文脈で作った物を渡す） */
export type CellOf = (f: MappingField) => Cell;

/**
 * 紙に何も書かないのに、帯の未確認に数えていない欄（□ 1 つの欄は「当てはまらない」も答えなので除く）。
 * 空き枠（T111 の決め: 居ない人の 2 人目以降の欄・1 人目の氏名のほかの欄・値の無い特記の段。刷らず、未確認に数えない）は除く
 * （T120。評価の 1 回目の 173 件は全部この空き枠だった。支援者 1 の電話〔支援者の居ない人〕・支援者 2・本人の希望の段）
 */
export function uncountedBlanks(mapping: FormMapping, cellOf: CellOf): string[] {
  const out: string[] = [];
  for (const f of mapping.fields) {
    if (f.removed || f.shape === "handwrite" || f.shape === "check") continue;
    const cell = cellOf(f);
    // 選ぶ欄で何も選んでいない値（自宅のリスクが無いと分かっている人の「複数選択可」）も答え。分からない値は未確認の値になる
    if (cell.kind === "withheld" || cell.kind === "handwrite" || cell.kind === "empty" || cell.kind === "choice") continue;
    if (paperText(f, cell) === "" && !isUnconfirmedCell(cell)) out.push(f.id);
  }
  return out;
}

export function scorePaper(o: {
  form: GoldForm;
  input: string;
  pairs: ReadonlyMap<number, string>;
  goldMapping: FormMapping;
  aiMapping: FormMapping;
  expectedCell: CellOf;
  actualCell: CellOf;
  expected: { mapped: MappedSheet; overlay: OverlaySheet | null };
  actual: { mapped: MappedSheet; overlay: OverlaySheet | null };
}): { score: PaperScore; judgements: Judgement[]; rows: PaperRow[] } {
  const score = emptyPaperScore();
  const judgements: Judgement[] = [];
  const rows: PaperRow[] = [];
  const j = (target: string, verdict: string, reason: string, expected?: unknown, actual?: unknown) =>
    judgements.push({ stage: "paper", form: o.form.id, input: o.input, target, verdict, reason, expected, actual });
  o.form.fields.forEach((g, gi) => {
    if (!o.form.pages.includes(g.page) || g.page > o.goldMapping.pages || g.shape === "handwrite") return;
    const gf = o.goldMapping.fields.find((f) => f.id === `g${gi + 1}`);
    if (!gf) return;
    const name = `${g.page}頁 ${g.section ? `${g.section} ` : ""}${g.label}`;
    const expCell = o.expectedCell(gf);
    const exp = paperText(gf, expCell);
    const aid = o.pairs.get(gi);
    const af = aid ? o.aiMapping.fields.find((f) => f.id === aid) : undefined;
    const actCell = af ? o.actualCell(af) : null;
    const act = af && actCell ? paperText(af, actCell) : "";
    score.judged += 1;
    if (exp !== "") score.filled += 1;
    const expU = isUnconfirmedCell(expCell);
    const actU = actCell ? isUnconfirmedCell(actCell) : true;
    if (expU !== actU) score.unconfirmedDiff += 1;
    let verdict: string;
    if (exp === "" && act === "") verdict = "空";
    else if (norm(exp) === norm(act)) verdict = "当たり";
    else if (act === "") verdict = "取りこぼし";
    else if (exp === "") verdict = "余分";
    else verdict = "置き間違い";
    if (verdict === "当たり") score.hit += 1;
    else if (verdict === "取りこぼし") {
      score.miss += 1;
      j(name, verdict, af ? "欄はあるが字が無い（項目が違う・台帳に値が無い）" : "AI の対応表にこの欄が無い", exp, act);
    } else if (verdict === "余分") {
      score.extra += 1;
      j(name, "置き間違い（余分）", "正解は空の欄に字を書いた", exp, act);
    } else if (verdict === "置き間違い") {
      score.wrong += 1;
      j(name, verdict, "正解と違う字", exp, act);
    }
    // 場所（元の様式の上の紙のとき）
    if (o.actual.overlay && af && g.box && act !== "" && af.box && !(af.page === g.page && boxInside(af.box, g.box))) {
      score.boxMiss += 1;
      j(name, "場所違い", "正解の欄の外に字を置いた", g.box, af.box);
    }
    rows.push({ field: name, expected: exp, actual: act, verdict });
  });
  if (o.actual.overlay) {
    score.annexOverflow = o.actual.overlay.annex.filter((a) => a.reason === "overflow").length;
    score.annexUnplaced = o.actual.overlay.annex.filter((a) => a.reason === "unplaced").length;
    for (const a of o.actual.overlay.annex) j(a.label, a.reason === "overflow" ? "別紙（収まらない）" : "別紙（場所なし）", a.reason === "overflow" ? "6pt でも欄に収まらない" : "欄の場所が無い");
  }
  if (o.expected.overlay) score.expectedAnnex = o.expected.overlay.annex.length;
  score.unconfirmedActual = o.actual.mapped.unconfirmed.length;
  score.unconfirmedExpected = o.expected.mapped.unconfirmed.length;
  const blanks = uncountedBlanks(o.aiMapping, o.actualCell);
  score.uncountedBlank = blanks.length;
  for (const id of blanks) j(id, "未記入の数え漏れ", "紙に何も書かないのに未確認に数えていない");
  return { score, judgements, rows };
}

export type PaperRow = { field: string; expected: string; actual: string; verdict: string };

/** mapped-sheet と同じ文脈で欄の値を作る物（buildMappedSheet は文脈を返さないので、欄ごとに 1 欄の対応表で引く） */
export function cellOfSheet(sheet: MappedSheet): CellOf {
  const byId = new Map<string, Cell>();
  for (const p of sheet.pages) for (const s of p.sections) for (const r of s.rows) byId.set(r.field.id, r.cell);
  return (f) => byId.get(f.id) ?? { kind: "unconfirmed" };
}

