// 審査員の役選択の画面に出す 4 つ。名前は種（D1）から読む（ケアマネ 山本・本人 山田 ハナ・家族 山田の娘）。

import type { D1Database } from "@cloudflare/workers-types";
import { DEMO_CARE_MANAGER_ID, DEMO_FAMILY_CONTACT_ID, DEMO_OFFICE_ID, DEMO_SELF_PERSON_ID } from "./demo.ts";
import { JUDGE_ROLE_LABELS, JUDGE_ROLES, type JudgeRole } from "./roles.ts";

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
    medical: "受け持ち",
    self: person?.name ?? null,
    family: contact ? [contact.relation, contact.name].filter(Boolean).join(" ") || null : null,
  };
  return JUDGE_ROLES.map((role) => ({ role, label: JUDGE_ROLE_LABELS[role], sub: subs[role] }));
}
