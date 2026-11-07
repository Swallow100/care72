// 評価の台（docs/tasks/T108.md）: Claude への 1 回がどの役の物かを、送った system の文で見分ける。
// askJson は全部 ClaudeClient.beta.messages.create を通る（lib/claude/call.ts）ので、記録の層と偽の client が同じ見分け方を使う。
// 指示の文が変わって見分けられなければ other（偽の client は返事の形〔JSON Schema〕から空の返事を作る）。

import { DIRECTOR_SYSTEM } from "../../../lib/drill/director.ts";
import { FREE_SYSTEM } from "../../../lib/drill/free-action.ts";
import { CALL_SYSTEM, PERSONA_BATCH_HEAD, PERSONA_SYSTEM, PERSONA_VIRTUAL, TALK_SYSTEM, VISIT_SYSTEM } from "../../../lib/drill/persona.ts";
import { PERSON_REVIEW_SYSTEM } from "../../../lib/drill/person-review.ts";
import { REVIEW_SYSTEM } from "../../../lib/drill/review.ts";
import { WORLD_SYSTEM } from "../../../lib/drill/world-oneshot.ts";
import { JUDGE_SYSTEM } from "./judge.ts";

export const ROLES = [
  "persona",
  "persona_call",
  "persona_talk",
  "persona_visit",
  "director",
  "world",
  "world_room",
  "free",
  "review",
  // 人ごとの講評（T185。訓練の間に Haiku）
  "review_person",
  "judge",
  "other",
] as const;
export type Role = (typeof ROLES)[number];

/** 本人役（本人と周りの人の言葉を作る役） */
export const PERSONA_ROLES: ReadonlySet<Role> = new Set(["persona", "persona_call", "persona_talk", "persona_visit"]);

const BY_SYSTEM: ReadonlyArray<readonly [string, Role]> = [
  [PERSONA_SYSTEM, "persona"],
  // 本人役をまとめて呼ぶ（T121）。役は本人役のまま（返事は answers の並び。isPersonaBatch で見分ける）
  [PERSONA_BATCH_HEAD, "persona"],
  [CALL_SYSTEM, "persona_call"],
  [TALK_SYSTEM, "persona_talk"],
  [VISIT_SYSTEM, "persona_visit"],
  [DIRECTOR_SYSTEM, "director"],
  [WORLD_SYSTEM, "world"],
  [FREE_SYSTEM, "free"],
  [REVIEW_SYSTEM, "review"],
  [PERSON_REVIEW_SYSTEM, "review_person"],
  [JUDGE_SYSTEM, "judge"],
];

/** system の文の並び（文字の塊か、塊の配列） */
export function systemTexts(system: unknown): string[] {
  if (typeof system === "string") return [system];
  if (!Array.isArray(system)) return [];
  return system.flatMap((b) => (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string" ? [(b as { text: string }).text] : []));
}

/** 役。system の塊のどれかが、役の指示の文で始まれば、その役 */
export function roleOfSystem(system: unknown): Role {
  const texts = systemTexts(system);
  for (const [head, role] of BY_SYSTEM) if (texts.some((t) => t.startsWith(head))) return role;
  return "other";
}

/** 仮想モードの本人役か（本人役の指示に仮想の決まりが足されている。まとめて呼ぶ指示も同じ） */
export function isVirtualPersona(system: unknown): boolean {
  return systemTexts(system).some(
    (t) => (t.startsWith(PERSONA_SYSTEM) && t.length > PERSONA_SYSTEM.length) || (t.startsWith(PERSONA_BATCH_HEAD) && t.includes(PERSONA_VIRTUAL)),
  );
}

/** 本人役をまとめて呼んだ物か（T121） */
export function isPersonaBatch(system: unknown): boolean {
  return systemTexts(system).some((t) => t.startsWith(PERSONA_BATCH_HEAD));
}
