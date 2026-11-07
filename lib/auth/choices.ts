// 審査員の役選択の画面に出す 4 つ。名前は種（D1）から読む（ケアマネ 山本・本人 山田 ハナ・家族 山田の娘）。
// 見本のケアマネの山本の役変更も同じ 4 つ（T95）。審査員だけ、その下に「新規事業所」（T115、roleChoicesFor）と、
// その事業所の中の役（足したケアマネ・医療班・足した利用者ごとの本人と家族。T180）。
// 名前は種の事業所ごと（T144）: 審査員はデモ事業所、山本は確認用の事業所の行から読む（中身は同じ写し）。

import type { D1Database } from "@cloudflare/workers-types";
import { DEMO_TARGETS, seedTargets, type SeedOfficeTargets } from "./demo.ts";
import { CUSTODY_LABELS } from "../custody/labels.ts";
import { loadSandboxAdmin, type SandboxAdmin } from "../office/sandbox.ts";
import { SIGNAL_WRITER_KINDS } from "../signals/labels.ts";
import {
  JUDGE_ROLE_LABELS,
  JUDGE_ROLES,
  ROLE_LABELS,
  SANDBOX_CHOICE,
  SANDBOX_LABELS,
  sandboxChoiceValue,
  type JudgeRole,
  type JudgeSessionRole,
} from "./roles.ts";

export type JudgeChoice = { role: JudgeRole; label: string; sub: string | null };

export async function judgeChoices(db: D1Database, t: SeedOfficeTargets = DEMO_TARGETS): Promise<JudgeChoice[]> {
  const [cm, person, contact] = await Promise.all([
    db
      .prepare("SELECT display_name FROM accounts WHERE id = ?1 AND office_id = ?2")
      .bind(t.careManagerId, t.officeId)
      .first<{ display_name: string }>(),
    db
      .prepare("SELECT name FROM people WHERE id = ?1 AND office_id = ?2")
      .bind(t.selfPersonId, t.officeId)
      .first<{ name: string }>(),
    db
      .prepare(
        `SELECT c.relation, c.name FROM contacts c JOIN people p ON p.id = c.person_id
          WHERE c.id = ?1 AND p.id = ?2 AND p.office_id = ?3`,
      )
      .bind(t.familyContactId, t.selfPersonId, t.officeId)
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

/**
 * 役の一覧の項目（4 つの役と、審査員だけの「新規事業所」T115、その下の新規事業所の中の役 T180）。
 * role はフォームの値（lib/auth/roles.ts の JudgeSessionRole か sandboxChoiceValue）。row のある項目は同じ row の項目と 1 行に並べる
 * （左に row の言葉、右に項目のボタン。利用者ごとに本人と家族をまとめる）。name は読み上げと title（「〇〇さんの娘 〇〇」）。
 * note は押せない 1 行（上限を越えた人の数）で、role は空
 */
export type RoleChoiceItem = { role: JudgeSessionRole | string; label: string; sub: string | null; row?: string; name?: string; note?: true };

/** 一覧に並べる利用者の上限（毎朝 4 時に消える試し。越えた分は「ほか N人」の 1 行。役の一覧が画面より長くならないように） */
export const SANDBOX_PEOPLE_MAX = 20;

/**
 * 役を選べる人（lib/auth/wall.ts の canChooseRole）に出す一覧。審査員には 4 つの役の下に「新規事業所」（T115。試用事業所の管理者の役）を足す。
 * 見本のケアマネ（山本、T95）は 4 つだけ。審査員のセッションに試用事業所があれば（どの役のときも）、その項目の右に事業所の名前と、
 * その下に新規事業所の中の役（T180、sandboxChoices）
 */
export async function roleChoicesFor(
  db: D1Database,
  p: { judge: boolean; sandbox?: boolean; sandboxAdmin?: string; office: { id?: string; name: string } | null },
): Promise<RoleChoiceItem[]> {
  // 審査員はいつもデモ事業所（試用事業所の中にいても）、山本は確認用の事業所（T144）
  const base: RoleChoiceItem[] = await judgeChoices(db, (!p.judge && seedTargets(p.office?.id)) || DEMO_TARGETS);
  if (!p.judge) return base;
  // セッションの b は署名の中だが、毎朝 4 時に消えるので確かめてから並べる
  const admin = p.sandboxAdmin ? await loadSandboxAdmin(db, p.sandboxAdmin) : null;
  const head: RoleChoiceItem = { role: SANDBOX_CHOICE, label: SANDBOX_LABELS.choice, sub: admin ? admin.office.name : null };
  return admin ? [...base, head, ...(await sandboxChoices(db, admin))] : [...base, head];
}

/**
 * 新規事業所の中の役（T180）。管理者のほかのケアマネ（停止していない、審査員が足した物）・医療班・一覧にいる利用者ごとの本人と、
 * 家族の画面を出せる連絡先（家族・支援者・民生委員。lib/signals/labels.ts の SIGNAL_WRITER_KINDS）。管理者は上の「新規事業所」の項目
 */
async function sandboxChoices(db: D1Database, admin: SandboxAdmin): Promise<RoleChoiceItem[]> {
  const officeId = admin.office.id;
  const kinds = SIGNAL_WRITER_KINDS.map((k) => `'${k}'`).join(", ");
  const [cms, people, contacts, total] = await Promise.all([
    db
      .prepare(
        `SELECT id, display_name FROM accounts
          WHERE office_id = ?1 AND role = 'care_manager' AND judge_made = 1 AND disabled_at IS NULL AND id <> ?2
          ORDER BY created_at, id`,
      )
      .bind(officeId, admin.accountId)
      .all<{ id: string; display_name: string }>(),
    db
      .prepare(`SELECT id, name FROM people WHERE office_id = ?1 AND unlisted_at IS NULL ORDER BY kana, id LIMIT ?2`)
      .bind(officeId, SANDBOX_PEOPLE_MAX)
      .all<{ id: string; name: string }>(),
    db
      .prepare(
        `SELECT c.id, c.person_id, c.relation, c.name FROM contacts c JOIN people p ON p.id = c.person_id
          WHERE p.office_id = ?1 AND p.unlisted_at IS NULL AND c.kind IN (${kinds})
          ORDER BY c.sort, c.created_at, c.id`,
      )
      .bind(officeId)
      .all<{ id: string; person_id: string; relation: string | null; name: string | null }>(),
    db.prepare("SELECT count(*) AS n FROM people WHERE office_id = ?1 AND unlisted_at IS NULL").bind(officeId).first<{ n: number }>(),
  ]);
  const out: RoleChoiceItem[] = cms.results.map((c) => ({
    role: sandboxChoiceValue({ role: "care_manager", id: c.id }),
    label: c.display_name,
    sub: null,
    row: ROLE_LABELS.care_manager,
    name: `${ROLE_LABELS.care_manager} ${c.display_name}`,
  }));
  out.push({
    role: sandboxChoiceValue({ role: "medical" }),
    label: CUSTODY_LABELS.page,
    sub: null,
    row: ROLE_LABELS.medical,
    name: `${ROLE_LABELS.medical} ${CUSTODY_LABELS.page}`,
  });
  for (const person of people.results) {
    out.push({
      role: sandboxChoiceValue({ role: "self", id: person.id }),
      label: ROLE_LABELS.self,
      sub: null,
      row: person.name,
      name: `${person.name} ${ROLE_LABELS.self}`,
    });
    const mine = contacts.results.filter((c) => c.person_id === person.id);
    const relationOf = (c: (typeof mine)[number]) => c.relation?.trim() || ROLE_LABELS.family;
    for (const c of mine) {
      // 同じ続柄が 2 人以上いれば名前を添える（「娘」「娘」で見分けが付かないように）
      const relation = relationOf(c);
      const twin = mine.filter((x) => relationOf(x) === relation).length > 1;
      const label = twin && c.name ? `${relation} ${c.name}` : relation;
      out.push({
        role: sandboxChoiceValue({ role: "family", id: c.id }),
        label,
        sub: null,
        row: person.name,
        name: [`${person.name}さんの${relation}`, c.name].filter(Boolean).join(" "),
      });
    }
  }
  const more = Number(total?.n ?? 0) - people.results.length;
  if (more > 0) out.push({ role: "", label: `ほか ${more}人`, sub: null, note: true });
  return out;
}

/** 一覧で今の項目（試用事業所の管理者の役はケアマネの役なので、印で分ける。新規事業所の中の役はその値、T180） */
export function currentChoice(p: {
  role: string;
  sandbox?: boolean;
  sandboxAdmin?: string;
  accountId?: string | null;
  personId?: string | null;
  contactId?: string | null;
}): string {
  if (!p.sandbox) return p.role;
  switch (p.role) {
    case "care_manager":
      return p.accountId && p.accountId !== p.sandboxAdmin ? sandboxChoiceValue({ role: "care_manager", id: p.accountId }) : SANDBOX_CHOICE;
    case "medical":
      return sandboxChoiceValue({ role: "medical" });
    case "self":
      return p.personId ? sandboxChoiceValue({ role: "self", id: p.personId }) : SANDBOX_CHOICE;
    case "family":
      return p.contactId ? sandboxChoiceValue({ role: "family", id: p.contactId }) : SANDBOX_CHOICE;
    default:
      return SANDBOX_CHOICE;
  }
}
