// T174: 評価の 9 回目で人ごとの筋に残った形（機器が切れたあと・出られない人の電話・道の開通と理由）。文は作った文で書く（記録の言葉を写さない）

import { describe, expect, it } from "vitest";
import { CALL_FIXED_SPEECH } from "./labels.ts";
import { sentenceSlip, type SlipContext } from "./person-facts.ts";
import { TALK_REPEAT_ACKS } from "./persona.ts";
import { QUICK_REPLIES } from "./talk-quick.ts";

const ctx = (over: Partial<SlipContext> = {}): SlipContext => ({ place: "home", together: [], kin: null, powerBack: false, noSpare: false, down: false, ...over });

describe("コードの短い返事（門を通らない文）", () => {
  const fixed = [...Object.values(QUICK_REPLIES).flat(), ...TALK_REPEAT_ACKS, CALL_FIXED_SPEECH];
  const sentences = fixed.flatMap((t) => t.split(/(?<=[。！？!?])/u)).filter(Boolean);

  it.each(["home", "shelter", "other", null] as const)("機器が止まったままでも帳面と食い違わない（いる所 %s）", (place) => {
    for (const s of sentences) expect([s, sentenceSlip(s, ctx({ down: true, place }))]).toEqual([s, null]);
  });
});
