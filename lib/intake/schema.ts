// Claude（Sonnet）が返す入れる欄の分け方の形。構造化出力（askJson の output_config.format）でこの形に縛る。
// 値は全部文字（空文字は「書かれていない」）にし、null・省略・union を使わない。形を単純にして、検査は
// lib/intake/fields.ts の normalizeValue で欄ごとに行う（選択肢に無い値は捨てて数える）。

import * as z from "zod";
import { CONTACT_KINDS, DEVICE_KINDS, HAZARD_KINDS, MEDICATION_CATEGORIES } from "../db/types.ts";
import { EXTRA_PENDING_KEYS, INTAKE_KEYS } from "./fields.ts";

export const PENDING_KEYS = [...INTAKE_KEYS, ...EXTRA_PENDING_KEYS] as [string, ...string[]];

/** 本人の電話（self）は入れる欄で作らない */
export const CONTACT_KINDS_FOR_INTAKE = CONTACT_KINDS.filter((k) => k !== "self") as [
  Exclude<(typeof CONTACT_KINDS)[number], "self">,
  ...Array<Exclude<(typeof CONTACT_KINDS)[number], "self">>,
];

export const ExtractSchema = z.object({
  /** 欄の表（lib/intake/fields.ts）の欄。配列の欄は 1 つずつ別の行 */
  items: z.array(z.object({ field: z.enum(INTAKE_KEYS), value: z.string() })),
  medications: z.array(
    z.object({
      name: z.string(),
      category: z.enum(MEDICATION_CATEGORIES),
      schedule: z.string(),
      amount: z.string(),
      storage: z.string(),
    }),
  ),
  devices: z.array(z.object({ kind: z.enum(DEVICE_KINDS), detail: z.string(), schedule: z.string() })),
  hazards: z.array(z.object({ kind: z.enum(HAZARD_KINDS), depth_m: z.string() })),
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
