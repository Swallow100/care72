// 審査員の役選択の画面に出す 4 つ。名前は種（D1）から読む（ケアマネ 山本・本人 山田 ハナ・家族 山田の娘）。
// 見本のケアマネの山本の役変更も同じ 4 つ（T95）。審査員だけ、その下に「新規事業所」（T115、roleChoicesFor）。

import type { D1Database } from "@cloudflare/workers-types";
import { DEMO_CARE_MANAGER_ID, DEMO_FAMILY_CONTACT_ID, DEMO_OFFICE_ID, DEMO_SELF_PERSON_ID } from "./demo.ts";
import { CUSTODY_LABELS } from "../custody/labels.ts";
import { JUDGE_ROLE_LABELS, JUDGE_ROLES, SANDBOX_CHOICE, SANDBOX_LABELS, type JudgeRole, type JudgeSessionRole } from "./roles.ts";

export type JudgeChoice = { role: JudgeRole; label: string; sub: string | null };

export async function judgeChoices(db: D1Database): Promise<JudgeChoice[]> {
  const [cm, person, contact] = await Promise.all([
    db
      .prepare("SELECT display_name FROM accounts WHERE id = ?1 AND office_id = ?2")
      .bind(DEMO_CARE_MANAGER_ID, DEMO_OFFICE_ID)
      .first<{ display_name: string }>(),
    db
      .prepare("SELECT name FROM people WHERE id = ?1 AND office_id = ?2")
      .bind(DEMO_SELF_PERSON_ID, DEMO_OFFICE_ID)
      .first<{ name: string }>(),
    db
      .prepare(
        `SELECT c.relation, c.name FROM contacts c JOIN people p ON p.id = c.person_id
          WHERE c.id = ?1 AND p.id = ?2 AND p.office_id = ?3`,
      )
      .bind(DEMO_FAMILY_CONTACT_ID, DEMO_SELF_PERSON_ID, DEMO_OFFICE_ID)
      .first<{ relation: string | null; name: string | null }>(),
  ]);
  const subs: Record<JudgeRole, string | null> = {
    care_manager: cm?.display_name || null,
    medical: CUSTODY_LABELS.page,
    self: person?.name ?? null,
    family: contact ? [contact.relation, contact.name].filter(Boolean).join(" ") || null : null,
  };
  return JUDGE_ROLES.map((role) => ({ role, label: JUDGE_ROLE_LABELS[role], sub: subs[role] }));
}

/** 役の一覧の項目（4 つの役と、審査員だけの「新規事業所」T115） */
export type RoleChoiceItem = { role: JudgeSessionRole; label: string; sub: string | null };

/**
 * 役を選べる人（lib/auth/wall.ts の canChooseRole）に出す一覧。審査員には 4 つの役の下に「新規事業所」（T115。試用事業所の管理者の役）を足す。
 * 見本のケアマネ（山本、T95）は 4 つだけ。試用事業所にいる間は、その項目の右に事業所の名前
 */
export async function roleChoicesFor(
  db: D1Database,
  p: { judge: boolean; sandbox?: boolean; office: { name: string } | null },
): Promise<RoleChoiceItem[]> {
  const base: RoleChoiceItem[] = await judgeChoices(db);
  if (!p.judge) return base;
  return [...base, { role: SANDBOX_CHOICE, label: SANDBOX_LABELS.choice, sub: p.sandbox ? (p.office?.name ?? null) : null }];
}

/** 一覧で今の項目（試用事業所の管理者の役はケアマネの役なので、印で分ける） */
export function currentChoice(p: { role: string; sandbox?: boolean }): string {
  return p.sandbox ? SANDBOX_CHOICE : p.role;
}
