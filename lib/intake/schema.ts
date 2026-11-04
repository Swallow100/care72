// Claude（Sonnet）が返す入れる欄の分け方の形。構造化出力（askJson の output_config.format）でこの形に縛る。
// 値は全部文字（空文字は「書かれていない」）にし、null・省略・union を使わない。形を単純にして、検査は
// lib/intake/fields.ts の normalizeValue で欄ごとに行う（選択肢に無い値は捨てて数える）。

import * as z from "zod";
import { CONTACT_KINDS, DEVICE_KINDS, HAZARD_KINDS, MEDICATION_CATEGORIES } from "../db/types.ts";
import { AI_INTAKE_KEYS, EXTRA_PENDING_KEYS } from "./fields.ts";

/** AI が「分からない」を残せる場所。AI で埋めない欄（ai: false。T117 の問い 5）は AI の分け方に出さないので、ここにも無い */
export const PENDING_KEYS = [...AI_INTAKE_KEYS, ...EXTRA_PENDING_KEYS] as [string, ...string[]];

/**
 * 保存（lib/intake/save.ts）が受ける連絡先の種類。本人の電話（self）は本人のページの面の編集でだけ作る・直す（T68）。
 * AI の分け方・問いの答えの保存に self が混ざると、保存が断る（save.ts の editOnly）
 */
export const CONTACT_KINDS_FOR_EDIT = [...CONTACT_KINDS] as [(typeof CONTACT_KINDS)[number], ...Array<(typeof CONTACT_KINDS)[number]>];

/**
 * AI の分け方の連絡先の種類。本人の電話（self）は手入力だけ（T68。住所・位置と同じく、AI の分け方に足さない）。
 * その他（T57）は続柄が無いと誰か分からないので、機器・ハザードのその他と同じく AI は作らない（人が編集の画面で続柄を書いて足す）
 */
export const CONTACT_KINDS_FOR_INTAKE = CONTACT_KINDS.filter((k) => k !== "self" && k !== "other") as [
  Exclude<(typeof CONTACT_KINDS)[number], "self" | "other">,
  ...Array<Exclude<(typeof CONTACT_KINDS)[number], "self" | "other">>,
];

/**
 * 機器・ハザードの「その他」（T57）は AI の分け方で作らない。名前・中身は人が編集の画面で書く
 * （その他の機器は中身が空なら保存しない決め。AI の分け方は中身の無いその他を作りうるので、選択肢から外す）
 */
export const DEVICE_KINDS_FOR_INTAKE = DEVICE_KINDS.filter((k) => k !== "other") as [
  Exclude<(typeof DEVICE_KINDS)[number], "other">,
  ...Array<Exclude<(typeof DEVICE_KINDS)[number], "other">>,
];
export const HAZARD_KINDS_FOR_INTAKE = HAZARD_KINDS.filter((k) => k !== "other") as [
  Exclude<(typeof HAZARD_KINDS)[number], "other">,
  ...Array<Exclude<(typeof HAZARD_KINDS)[number], "other">>,
];

export const ExtractSchema = z.object({
  /** 欄の表（lib/intake/fields.ts）の欄のうち AI で埋めてよい物（AI_INTAKE_KEYS。T117）。配列の欄は 1 つずつ別の行 */
  items: z.array(z.object({ field: z.enum(AI_INTAKE_KEYS), value: z.string() })),
  medications: z.array(
    z.object({
      name: z.string(),
      category: z.enum(MEDICATION_CATEGORIES),
      schedule: z.string(),
      amount: z.string(),
      storage: z.string(),
    }),
  ),
  devices: z.array(z.object({ kind: z.enum(DEVICE_KINDS_FOR_INTAKE), detail: z.string(), schedule: z.string() })),
  hazards: z.array(z.object({ kind: z.enum(HAZARD_KINDS_FOR_INTAKE), depth_m: z.string() })),
  contacts: z.array(
    z.object({
      kind: z.enum(CONTACT_KINDS_FOR_INTAKE),
      relation: z.string(),
      night: z.enum(["yes", "no", "unknown"]),
      note: z.string(),
    }),
  ),
  /** 特記。入力の 1 文をそのまま */
  notes: z.array(z.string()),
  /** 入力に「分からない」「答えない」とあった欄 */
  unknowns: z.array(z.object({ field: z.enum(PENDING_KEYS), status: z.enum(["unknown", "declined"]) })),
});

export type ExtractOutput = z.output<typeof ExtractSchema>;
