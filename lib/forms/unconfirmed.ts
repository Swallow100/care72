// 紙面が「未確認」と刷る欄を数える（docs/tasks/T87.md の 3）。出す前に、どの欄が空くかを画面の帯と書類の一覧に出す。
// 数えるのは欄（1 つの欄に未確認が 2 つあっても 1）。紙には刷らない（帯は PaperBar の中、印刷で消える）。
//
// - 未確認の欄: 値の無い欄（kind unconfirmed）・選ぶ欄の未確認（choice の unconfirmed）・値の中に未確認のある欄（薬の用量など）。
//   判定は文字（「未確認」を含むか）でなく欄の値の形で見る（注の字に「未確認」が入ることがあるため）
// - 数えない: 手で書く欄（番号・自署・代理人・市受付印。紙面でも空けている）・同意の無い範囲（省略）・「なし」
// - 未入力（台帳に項目はあるが値が無い。本人のページで直せる）と、対応なし（台帳に項目の無い欄。紙に手で書くか対応表で）を分ける
// - 松山市の計画書は buildMatsuyamaSheet の欄、対応表の紙（内閣府の様式例・事業所の対応表）は buildMappedSheet の欄。
//   T86 の元の様式の上の紙は同じ欄を空けて刷る（未確認と刷らない）が、空く欄は同じなので同じ数え方
// どちらも定型の計算で、Claude は呼ばない。

import type { PendingStatus } from "../db/types.ts";
import { PENDING_STATUS_LABELS } from "../labels.ts";
import type { MappedSheet } from "./mapped-sheet.ts";
import {
  MATSUYAMA_BLOCKS,
  MATSUYAMA_FIELDS,
  type Cell,
  type MatsuyamaBlock,
  type MatsuyamaFieldDef,
  type MatsuyamaSheet,
  type Piece,
} from "./matsuyama.ts";

/** 未確認の欄 1 つ */
export type UnconfirmedField = {
  /** 欄の名前（同じ名前の欄が 2 つ以上なら段を添える。「近親者 フリガナ」） */
  name: string;
  /** 欄の中の未確認の所（「用量」「残り」）。欄全体が未確認なら空 */
  parts: string[];
  /** 台帳の pending の理由（いちばん初めの物） */
  reason: PendingStatus | null;
  /** 台帳に項目の無い欄（対応なし） */
  noSource: boolean;
};

export type UnconfirmedSummary = {
  /** 未確認の欄の数 */
  count: number;
  /** 欄（紙の順） */
  fields: UnconfirmedField[];
};

/** 帯と一覧に出す言葉 */
export const UNCONFIRMED_LABELS = { unconfirmed: "未確認", blank: "未入力", noSource: "対応なし" } as const;

/** 紙に「未確認」と刷る欄か（値の形で見る。lib/forms/mapped-sheet.ts の未確認の判定と同じ） */
export function isUnconfirmedCell(cell: Cell): boolean {
  switch (cell.kind) {
    case "unconfirmed":
      return true;
    case "choice":
      return cell.unconfirmed !== undefined;
    case "value":
      return cell.lines.some((l) => l.some((p) => p.unconfirmed));
    default:
      return false;
  }
}

const SEPARATOR = "／";
/** 欄の中の所の名前の長さの上限（長い値の字を所の名前にしない） */
const PART_MAX = 20;

/** 欄の中の未確認の所（未確認の直前の小さな添え・言葉）と、pending の理由 */
function partsOf(cell: Cell): { parts: string[]; reason: PendingStatus | null } {
  if (cell.kind === "unconfirmed") return { parts: [], reason: cell.reason ?? null };
  if (cell.kind === "choice") return { parts: [], reason: cell.unconfirmed?.reason ?? null };
  if (cell.kind !== "value") return { parts: [], reason: null };
  const parts: string[] = [];
  let reason: PendingStatus | null = null;
  for (const line of cell.lines) {
    line.forEach((p: Piece, i) => {
      if (!p.unconfirmed) return;
      reason ??= p.reason ?? null;
      const before = i > 0 ? line[i - 1] : undefined;
      const name = before && !before.unconfirmed ? before.text.trim() : "";
      if (name && name !== SEPARATOR && name.length <= PART_MAX && !parts.includes(name)) parts.push(name);
    });
  }
  return { parts, reason };
}

/** 一覧に出す 1 つの言葉。「医薬品情報（用量・残り）」「かかりつけ医・薬局（未聴取）」 */
export function unconfirmedText(f: UnconfirmedField): string {
  const inner = f.parts.length > 0 ? f.parts.join("・") : f.reason ? PENDING_STATUS_LABELS[f.reason] : "";
  return inner ? `${f.name}（${inner}）` : f.name;
}

/** 帯・一覧に渡す形（文字だけ。client の部品に渡せる） */
export type UnconfirmedView = { count: number; blank: string[]; noSource: string[] };

export function unconfirmedView(s: UnconfirmedSummary): UnconfirmedView {
  return {
    count: s.count,
    blank: s.fields.filter((f) => !f.noSource).map(unconfirmedText),
    noSource: s.fields.filter((f) => f.noSource).map(unconfirmedText),
  };
}

// ---------- 松山市の計画書 ----------

/** 段の短い呼び名（同じ名前の欄に添える） */
const BLOCK_SHORT: Partial<Record<MatsuyamaBlock, string>> = {
  target: "本人",
  local: "地域",
  kin: "近親者",
  supporter1: "実施者1",
  supporter2: "実施者2",
  org: "実施組織",
  housing: "住居",
  notes: "特記",
};

/** 様式の字の飾り（【】・末尾の：・（複数選択可）・※）を落とした欄の名前 */
function plainLabel(label: string): string {
  return label
    .replace(/[【】※]/g, "")
    .replace(/（複数選択可）$/, "")
    .replace(/[：:]+$/, "")
    .trim();
}

const NO_SOURCE = "台帳に無い";
const PLAIN_COUNT = new Map<string, number>();
for (const f of MATSUYAMA_FIELDS) PLAIN_COUNT.set(plainLabel(f.label), (PLAIN_COUNT.get(plainLabel(f.label)) ?? 0) + 1);

/** 欄の名前（一覧の言葉）。同じ名前の欄が 2 つ以上なら段を添える。避難場所の手段・時間はその避難場所の名前を添える */
export function matsuyamaFieldName(f: MatsuyamaFieldDef): string {
  const plain = plainLabel(f.label);
  const shelter = /^shelter\.(pre|near|city)\.(means|minutes)$/.exec(f.key);
  if (shelter) {
    const place = MATSUYAMA_FIELDS.find((x) => x.key === `shelter.${shelter[1]}.place`)!;
    return `${place.label} ${plain}`;
  }
  // 住居の【種別】【階層】と特記の「医療」は、名前だけでは何の欄か分からないので段を添える
  if ((PLAIN_COUNT.get(plain) ?? 0) > 1 || f.block === "housing" || f.key === "notes.medical") {
    return `${BLOCK_SHORT[f.block] ?? MATSUYAMA_BLOCKS[f.block]} ${plain}`;
  }
  return plain;
}

/** 松山市の計画書の未確認の欄（紙の順） */
export function matsuyamaUnconfirmed(sheet: MatsuyamaSheet): UnconfirmedSummary {
  const fields: UnconfirmedField[] = [];
  for (const def of MATSUYAMA_FIELDS) {
    if (def.shape === "handwrite") continue;
    const cell = sheet.cells[def.key];
    if (!cell || !isUnconfirmedCell(cell)) continue;
    fields.push({ name: matsuyamaFieldName(def), ...partsOf(cell), noSource: def.source === NO_SOURCE });
  }
  return { count: fields.length, fields };
}

// ---------- 対応表の紙（内閣府の様式例・事業所の対応表） ----------

/** 対応表の紙の未確認の欄（紙の順）。欄の名前は差し込みの帯と同じ「段 欄」 */
export function mappedUnconfirmed(sheet: MappedSheet): UnconfirmedSummary {
  const fields: UnconfirmedField[] = [];
  for (const page of sheet.pages) {
    for (const section of page.sections) {
      for (const { field, cell } of section.rows) {
        if (field.shape === "handwrite" || !isUnconfirmedCell(cell)) continue;
        const name = field.section ? `${field.section} ${field.label}` : field.label;
        fields.push({ name, ...partsOf(cell), noSource: field.item === null });
      }
    }
  }
  return { count: fields.length, fields };
}
