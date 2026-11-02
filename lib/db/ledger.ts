import type { Ledger } from "./types.ts";

/** people.ledger の JSON を読む。欠けた群は空で補う */
export function parseLedger(text: string): Ledger {
  const raw = JSON.parse(text) as Partial<Ledger>;
  return {
    basic: raw.basic ?? {},
    care: raw.care ?? {},
    medical: { devices: [], medications: [], ...raw.medical },
    evacuation: { hazards: [], ...raw.evacuation },
    ...(raw.local ? { local: raw.local } : {}),
    notes: raw.notes ?? [],
    pending: raw.pending ?? [],
  };
}
