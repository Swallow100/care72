// 誰が・どの事業所の・何の役で開いているか（Principal）。cookie のセッションと D1 から作る。
// cookie が無い・壊れている・切れているときはゲスト（デモ事業所を見るだけ）。
// ここは D1 と env を引数で受け取るだけで、Next と Cloudflare には触らない（テストで node:sqlite を渡す）。
// Next から使うのは lib/auth/server.ts。

import type { D1Database } from "@cloudflare/workers-types";
import type { AccountRole, OfficeKind } from "../db/types.ts";
import {
  DEMO_CARE_MANAGER_ID,
  DEMO_FAMILY_CONTACT_ID,
  DEMO_JUDGE_ACCOUNT_ID,
  DEMO_OFFICE_ID,
  DEMO_SELF_PERSON_ID,
  JUDGE_LOGIN_ID,
} from "./demo.ts";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "./password.ts";
import { homePath, type JudgeRole, type Role } from "./roles.ts";
import { passwordVersion, sessionTimes, signSession, verifySession, type SessionPayload } from "./session.ts";

export type OfficeRef = { id: string; name: string; kind: OfficeKind };

export type Principal = {
  role: Role;
  /** 審査員のログイン（役は role） */
  judge: boolean;
  /** 事業所の管理者（ケアマネの印） */
  admin: boolean;
  /** 書き手（経過の author_id）。ゲストは null、審査員は審査員のアカウント */
  accountId: string | null;
  /** ヘッダーに出す名前（山本・山田 ハナ・森 恵子） */
  displayName: string | null;
  /** 事業所。行政・医療班は事業所をまたぐので無いことがある */
  office: OfficeRef | null;
  /** 担当一覧の持ち主（ケアマネのアカウント） */
  caseloadOf: string | null;
  /** 本人・家族のスマホの本人 */
  personId: string | null;
  /** 家族のスマホの連絡先の行 */
  contactId: string | null;
};

/** ここで読む env。値は画面・ログ・応答に出さない */
export type AuthEnv = { JUDGE_PASSWORD_HASH?: string };

const NOBODY = {
  judge: false,
  admin: false,
  accountId: null,
  displayName: null,
  office: null,
  caseloadOf: null,
  personId: null,
  contactId: null,
} satisfies Omit<Principal, "role">;

function judgeHash(env: AuthEnv): string | null {
  const v = env.JUDGE_PASSWORD_HASH?.trim();
  return v ? v : null;
}

/** デモ事業所。kind が demo でなければ無いと同じ（ゲスト・審査員に協力事業所を開かせない） */
async function demoOffice(db: D1Database): Promise<OfficeRef | null> {
  return db
    .prepare("SELECT id, name, kind FROM offices WHERE id = ?1 AND kind = 'demo'")
    .bind(DEMO_OFFICE_ID)
    .first<OfficeRef>();
}

export async function guestPrincipal(db: D1Database): Promise<Principal> {
  const office = await demoOffice(db);
  return { ...NOBODY, role: "guest", office, caseloadOf: office ? DEMO_CARE_MANAGER_ID : null };
}

/** 審査員の役ごとの形。役を選ぶ前は unselected（役選択の画面へ） */
async function judgePrincipal(db: D1Database, role: JudgeRole | null): Promise<Principal | null> {
  const office = await demoOffice(db);
  if (!office) return null;
  const p: Principal = { ...NOBODY, role: role ?? "unselected", judge: true, accountId: DEMO_JUDGE_ACCOUNT_ID, office };
  switch (role) {
    case null:
    case "medical":
      return p;
    case "care_manager": {
      const cm = await db
        .prepare("SELECT display_name FROM accounts WHERE id = ?1 AND office_id = ?2 AND role = 'care_manager'")
        .bind(DEMO_CARE_MANAGER_ID, office.id)
        .first<{ display_name: string }>();
      return { ...p, caseloadOf: DEMO_CARE_MANAGER_ID, displayName: cm?.display_name || null };
    }
    case "self": {
      const person = await db
        .prepare("SELECT name FROM people WHERE id = ?1 AND office_id = ?2")
        .bind(DEMO_SELF_PERSON_ID, office.id)
        .first<{ name: string }>();
      return { ...p, personId: DEMO_SELF_PERSON_ID, displayName: person?.name ?? null };
    }
    case "family": {
      const contact = await db
        .prepare(
          `SELECT c.name FROM contacts c JOIN people pe ON pe.id = c.person_id
            WHERE c.id = ?1 AND pe.id = ?2 AND pe.office_id = ?3`,
        )
        .bind(DEMO_FAMILY_CONTACT_ID, DEMO_SELF_PERSON_ID, office.id)
        .first<{ name: string | null }>();
      return { ...p, personId: DEMO_SELF_PERSON_ID, contactId: DEMO_FAMILY_CONTACT_ID, displayName: contact?.name ?? null };
    }
  }
}

type AccountJoin = {
  id: string;
  role: AccountRole;
  is_office_admin: 0 | 1;
  display_name: string;
  password_hash: string | null;
  office_id: string | null;
  office_name: string | null;
  office_kind: OfficeKind | null;
};

const ACCOUNT_SELECT = `SELECT a.id, a.role, a.is_office_admin, a.display_name, a.password_hash,
         o.id AS office_id, o.name AS office_name, o.kind AS office_kind
    FROM accounts a LEFT JOIN offices o ON o.id = a.office_id`;

async function accountById(db: D1Database, id: string): Promise<AccountJoin | null> {
  return db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?1`).bind(id).first<AccountJoin>();
}

async function accountByLoginId(db: D1Database, loginId: string): Promise<AccountJoin | null> {
  return db.prepare(`${ACCOUNT_SELECT} WHERE a.login_id = ?1`).bind(loginId).first<AccountJoin>();
}

/** アカウントの行から。審査員の行（書き手のための行）はログインに使わない */
function accountPrincipal(a: AccountJoin): Principal | null {
  if (a.role === "judge") return null;
  const office: OfficeRef | null =
    a.office_id && a.office_name !== null && a.office_kind !== null
      ? { id: a.office_id, name: a.office_name, kind: a.office_kind }
      : null;
  const base = { ...NOBODY, accountId: a.id, displayName: a.display_name || null, office };
  if (a.role === "care_manager") {
    if (!office) return null;
    return { ...base, role: "care_manager", admin: a.is_office_admin === 1, caseloadOf: a.id };
  }
  return { ...base, role: a.role };
}

/** セッションの中身から。パスワードが変わった・アカウントが無い・審査員のハッシュが無いときは null */
async function principalOf(db: D1Database, env: AuthEnv, s: SessionPayload): Promise<Principal | null> {
  if (s.k === "judge") {
    const h = judgeHash(env);
    if (!h || (await passwordVersion(h)) !== s.pv) return null;
    return judgePrincipal(db, s.r);
  }
  const a = await accountById(db, s.a);
  if (!a?.password_hash || (await passwordVersion(a.password_hash)) !== s.pv) return null;
  return accountPrincipal(a);
}

/** cookie の文字列から。確かめられなければゲスト。now は秒 */
export async function resolvePrincipal(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  token: string | null | undefined,
  now: number,
): Promise<Principal> {
  const s = await verifySession(token, secret, now);
  const p = s ? await principalOf(db, env, s) : null;
  return p ?? guestPrincipal(db);
}

export type LoginResult = { ok: true; token: string; principal: Principal; path: string } | { ok: false };
const FAIL: LoginResult = { ok: false };

/**
 * ID とパスワードで入る。審査員の ID なら env の JUDGE_PASSWORD_HASH、ほかはアカウントの表の password_hash。
 * どの失敗も同じ返事で、時間も同じだけかける（ID が有るかを分からせない）。
 */
export async function login(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  input: { loginId: string; password: string },
  now: number,
): Promise<LoginResult> {
  const loginId = input.loginId.trim();
  const { password } = input;
  if (!loginId || loginId.length > 128 || !password || password.length > MAX_PASSWORD_LENGTH) {
    await verifyPassword("-", null);
    return FAIL;
  }

  if (loginId === JUDGE_LOGIN_ID) {
    const h = judgeHash(env);
    if (!(await verifyPassword(password, h)) || !h) return FAIL;
    const principal = await judgePrincipal(db, null);
    if (!principal) return FAIL;
    const token = await signSession(
      { v: 1, k: "judge", r: null, pv: await passwordVersion(h), ...sessionTimes(now) },
      secret,
    );
    return { ok: true, token, principal, path: homePath(principal.role) };
  }

  const a = await accountByLoginId(db, loginId);
  if (!(await verifyPassword(password, a?.password_hash)) || !a?.password_hash) return FAIL;
  const principal = accountPrincipal(a);
  if (!principal) return FAIL;
  const token = await signSession(
    { v: 1, k: "account", a: a.id, pv: await passwordVersion(a.password_hash), ...sessionTimes(now) },
    secret,
  );
  return { ok: true, token, principal, path: homePath(principal.role) };
}

/** 審査員が役を選ぶ・選び直す。審査員のセッションでなければ null */
export async function chooseJudgeRole(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  token: string | null | undefined,
  role: JudgeRole,
  now: number,
): Promise<{ token: string; principal: Principal; path: string } | null> {
  const s = await verifySession(token, secret, now);
  if (!s || s.k !== "judge") return null;
  if (!(await principalOf(db, env, s))) return null;
  const principal = await judgePrincipal(db, role);
  if (!principal) return null;
  const next = await signSession({ ...s, r: role, ...sessionTimes(now) }, secret);
  return { token: next, principal, path: homePath(role) };
}
