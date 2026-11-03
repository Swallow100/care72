// 配役（lib/drill/cast.ts）に使う台帳の事実を台帳から作る所（サーバーの中だけ。T70）。cast.ts は台帳を読まない純な所に残し、
// 押せる人の判定は本人役と同じ reportersOf（lib/drill/persona.ts）を通す。

import type { PseudonymInput } from "../pseudonym/index.ts";
import type { CastFacts } from "./cast.ts";
import { reportersOf } from "./persona.ts";

/** 台帳（仮名化の前）から配役の事実 */
export function castFactsOf(src: Pick<PseudonymInput, "ledger" | "contacts" | "clocks">): CastFacts {
  const l = src.ledger;
  return {
    devices: l.medical.devices.map((d) => d.kind),
    clocks: [...src.clocks.map((k) => k.category), ...l.medical.medications.map((m) => m.category)],
    hazards: l.evacuation.hazards.map((h) => ({ kind: h.kind, depthM: h.depthM ?? null })),
    household: l.basic.household ?? null,
    canPress: reportersOf(src).some((r) => r.canPress),
  };
}

/** 事業所の人ごとの配役の事実 */
export function castFactsMap(sources: ReadonlyMap<string, PseudonymInput>): Map<string, CastFacts> {
  return new Map([...sources].map(([id, src]) => [id, castFactsOf(src)]));
}
