// 誰が・どの事業所の・何の役で開いているか（Principal）。cookie のセッションと D1 から作る。
// cookie が無い・壊れている・切れているときは null（ログインしていない。画面は /login へ、API は 401）。
// ここは D1 と env を引数で受け取るだけで、Next と Cloudflare には触らない（テストで node:sqlite を渡す）。
// Next から使うのは lib/auth/server.ts。

import type { D1Database } from "@cloudflare/workers-types";
import type { AccountRole, OfficeKind } from "../db/types.ts";
import {
  accountCredential,
  credentialVersion,
  judgeCredential,
  verifyCredential,
  type CredentialEnv,
} from "./credential.ts";
import {
  DEMO_CARE_MANAGER_ID,
  DEMO_FAMILY_CONTACT_ID,
  DEMO_JUDGE_ACCOUNT_ID,
  DEMO_OFFICE_ID,
  DEMO_SELF_PERSON_ID,
  JUDGE_LOGIN_ID,
} from "./demo.ts";
import { issuedSec, linkTarget } from "../qr/phone-link-store.ts";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "./password.ts";
import { homePath, type JudgeRole, type Role } from "./roles.ts";
import { sessionTimes, signSession, verifySession, type SessionPayload } from "./session.ts";
import { canChooseRole } from "./wall.ts";

export type OfficeRef = { id: string; name: string; kind: OfficeKind };

export type Principal = {
  role: Role;
  /** 審査員のログイン（役は role） */
  judge: boolean;
  /**
   * 審査員が足した・再発行したアカウント（accounts.judge_made、T81）。自分のパスワードで入るので judge は付かない（役変更は出ない）が、
   * 壁は審査員と同じ（lib/auth/wall.ts の isWalled: デモの人だけ・本物のアンケートは見えない・作るリンクは審査員の物）。無いのは false
   */
  judgeMade?: boolean;
  /**
   * 役を替えた見本のケアマネ（山本、T95）。役変更で医療班・本人・家族を選んでいる間だけ付く（ケアマネの役では付かない）。
   * judge は付かず書き手も山本のままだが、壁は審査員と同じ（lib/auth/wall.ts の isWalled）。役を選べるかは canChooseRole（同じ所）。無いのは false
   */
  switched?: boolean;
  /** 事業所の管理者（ケアマネの印） */
  admin: boolean;
  /** 書き手（経過の author_id）。審査員は審査員のアカウント */
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

/** ここで読む env（審査員と山本のパスワード。lib/auth/credential.ts）。値は画面・ログ・応答に出さない */
export type AuthEnv = CredentialEnv;

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

/** デモ事業所。kind が demo でなければ無いと同じ（審査員に協力事業所を開かせない） */
async function demoOffice(db: D1Database): Promise<OfficeRef | null> {
  return db
    .prepare("SELECT id, name, kind FROM offices WHERE id = ?1 AND kind = 'demo'")
    .bind(DEMO_OFFICE_ID)
    .first<OfficeRef>();
}

/** 審査員と山本が役変更で選ぶ、ケアマネでない役 */
type DemoRole = Exclude<JudgeRole, "care_manager">;

/**
 * 見本の事業所の医療班・本人・家族の役の形（審査員と、役を替えた山本で同じ。T95）。p は役を付ける前の形（書き手・名前・事業所）。
 * 医療班は p のまま（受け持ちは書き手のアカウントごと）、本人・家族は山田 ハナと山田の娘の行
 */
async function demoRolePrincipal(db: D1Database, office: OfficeRef, p: Principal, role: DemoRole): Promise<Principal> {
  switch (role) {
    case "medical":
      return { ...p, role };
    case "self": {
      const person = await db
        .prepare("SELECT name FROM people WHERE id = ?1 AND office_id = ?2")
        .bind(DEMO_SELF_PERSON_ID, office.id)
        .first<{ name: string }>();
      return { ...p, role, personId: DEMO_SELF_PERSON_ID, displayName: person?.name ?? null };
    }
    case "family": {
      const contact = await db
        .prepare(
          `SELECT c.name FROM contacts c JOIN people pe ON pe.id = c.person_id
            WHERE c.id = ?1 AND pe.id = ?2 AND pe.office_id = ?3`,
        )
        .bind(DEMO_FAMILY_CONTACT_ID, DEMO_SELF_PERSON_ID, office.id)
        .first<{ name: string | null }>();
      return { ...p, role, personId: DEMO_SELF_PERSON_ID, contactId: DEMO_FAMILY_CONTACT_ID, displayName: contact?.name ?? null };
    }
  }
}

/** 審査員の役ごとの形。役を選ぶ前は unselected（役選択の画面へ） */
async function judgePrincipal(db: D1Database, role: JudgeRole | null): Promise<Principal | null> {
  const office = await demoOffice(db);
  if (!office) return null;
  const p: Principal = { ...NOBODY, role: role ?? "unselected", judge: true, accountId: DEMO_JUDGE_ACCOUNT_ID, office };
  switch (role) {
    case null:
      return p;
    case "care_manager": {
      const cm = await db
        .prepare("SELECT display_name FROM accounts WHERE id = ?1 AND office_id = ?2 AND role = 'care_manager'")
        .bind(DEMO_CARE_MANAGER_ID, office.id)
        .first<{ display_name: string }>();
      return { ...p, caseloadOf: DEMO_CARE_MANAGER_ID, displayName: cm?.display_name || null };
    }
    default:
      return demoRolePrincipal(db, office, p, role);
  }
}

/**
 * 役を替えた山本の形（T95）。cm はケアマネの役の山本（accountPrincipal）。役を選べない人（canChooseRole）なら null。
 * 書き手・名前・事業所は山本のまま、管理者・担当一覧は外し、switched の印（壁は審査員と同じ）
 */
async function switchedPrincipal(db: D1Database, cm: Principal, role: DemoRole): Promise<Principal | null> {
  if (!canChooseRole(cm) || !cm.office) return null;
  const p: Principal = { ...NOBODY, role, switched: true, accountId: cm.accountId, displayName: cm.displayName, office: cm.office };
  return demoRolePrincipal(db, cm.office, p, role);
}

type AccountJoin = {
  id: string;
  role: AccountRole;
  is_office_admin: 0 | 1;
  display_name: string;
  password_hash: string | null;
  /** 停止（T61）。あればログインもセッションも通さない */
  disabled_at: string | null;
  /** 審査員が足した・再発行した（T81、migration 0025） */
  judge_made: 0 | 1;
  office_id: string | null;
  office_name: string | null;
  office_kind: OfficeKind | null;
};

const ACCOUNT_SELECT = `SELECT a.id, a.role, a.is_office_admin, a.display_name, a.password_hash, a.disabled_at, a.judge_made,
         o.id AS office_id, o.name AS office_name, o.kind AS office_kind
    FROM accounts a LEFT JOIN offices o ON o.id = a.office_id`;

async function accountById(db: D1Database, id: string): Promise<AccountJoin | null> {
  return db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?1`).bind(id).first<AccountJoin>();
}

async function accountByLoginId(db: D1Database, loginId: string): Promise<AccountJoin | null> {
  return db.prepare(`${ACCOUNT_SELECT} WHERE a.login_id = ?1`).bind(loginId).first<AccountJoin>();
}

/**
 * アカウントの行から。審査員の行（書き手のための行）はログインに使わない。
 * 停止した人（T61）も null: ログインは同じ失敗、今あるセッションも次の要求で切れる（停止ではパスワードの指紋 pv が変わらないので、ここで止める）
 */
function accountPrincipal(a: AccountJoin): Principal | null {
  if (a.role === "judge" || a.disabled_at !== null) return null;
  const office: OfficeRef | null =
    a.office_id && a.office_name !== null && a.office_kind !== null
      ? { id: a.office_id, name: a.office_name, kind: a.office_kind }
      : null;
  const base = { ...NOBODY, accountId: a.id, displayName: a.display_name || null, office, judgeMade: a.judge_made === 1 };
  if (a.role === "care_manager") {
    if (!office) return null;
    return { ...base, role: "care_manager", admin: a.is_office_admin === 1, caseloadOf: a.id };
  }
  return { ...base, role: a.role };
}

/**
 * スマホ入口のリンクで開いたセッション（T69a）。本人用は役 self、家族用は役 family。アカウントは無い（accountId null。
 * 経過の author_id は NULL になる）。版が違う（作り直した）・本人を一覧から外した・事業所が無い・連絡先が答えられる種類でないときは null。
 * 確かめ方はリンクを開くとき（lib/qr/phone-link-store.ts の resolvePhoneLink）と同じ linkTarget。
 * 版に加えて、リンクを作った時刻（li）も D1 と比べる（T81）: 毎朝 4 時の戻しで版が 0 に戻り、次に作ると版 1 になるので、
 * 版だけだと前の日の版 1 のセッションが生き返る。li の無い前のセッション（T81 の前に開いた物）は iat で比べる
 * （開く口 lib/qr/phone-open.ts はセッションの iat を「開いた時刻とリンクの時刻の小さい方」にするので、ふつうはリンクの時刻と同じ）
 */
async function linkPrincipal(db: D1Database, s: Extract<SessionPayload, { k: "link" }>): Promise<Principal | null> {
  const t = await linkTarget(db, { personId: s.p, contactId: s.c, generation: s.g });
  if (!t) return null;
  const issued = issuedSec(t.issuedAt);
  if (issued === null || issued !== (s.li ?? s.iat)) return null;
  const base = { ...NOBODY, office: t.office, personId: t.personId };
  if (t.contact === null) return { ...base, role: "self", displayName: t.personName };
  return { ...base, role: "family", contactId: t.contact.id, displayName: t.contact.name };
}

/**
 * セッションの中身から。パスワードが変わった・アカウントが無い・審査員のパスワードが env に無いときは null。
 * 確かめ方はログインと同じ所（lib/auth/credential.ts）から取る（env の平文で入った山本も次の要求で切れない）。
 */
async function principalOf(db: D1Database, env: AuthEnv, secret: string, s: SessionPayload): Promise<Principal | null> {
  if (s.k === "judge") {
    const c = judgeCredential(env);
    if (!c || (await credentialVersion(c, secret)) !== s.pv) return null;
    return judgePrincipal(db, s.r);
  }
  if (s.k === "link") return linkPrincipal(db, s);
  const a = await accountById(db, s.a);
  const c = a ? accountCredential(env, a) : null;
  if (!a || !c || (await credentialVersion(c, secret)) !== s.pv) return null;
  const p = accountPrincipal(a);
  // 役の印（T95）が付いていれば、役を替えた山本。役を選べないアカウント・デモでない事業所なら通さない
  if (!p || s.r === undefined || s.r === "care_manager") return p;
  return switchedPrincipal(db, p, s.r);
}

/** cookie の文字列から。確かめられなければ null（ログインしていない）。now は秒 */
export async function resolvePrincipal(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  token: string | null | undefined,
  now: number,
): Promise<Principal | null> {
  const s = await verifySession(token, secret, now);
  return s ? principalOf(db, env, secret, s) : null;
}

export type LoginResult = { ok: true; token: string; principal: Principal; path: string } | { ok: false };
const FAIL: LoginResult = { ok: false };

/**
 * ID とパスワードで入る。審査員の ID なら env の JUDGE_PASSWORD_HASH か JUDGE_PASSWORD、
 * 山本は env（ハッシュか平文）か種のハッシュ、ほかはアカウントの表の password_hash（lib/auth/credential.ts）。
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
    const c = judgeCredential(env);
    if (!(await verifyCredential(password, c)) || !c) return FAIL;
    const principal = await judgePrincipal(db, null);
    if (!principal) return FAIL;
    const token = await signSession(
      { v: 1, k: "judge", r: null, pv: await credentialVersion(c, secret), ...sessionTimes(now) },
      secret,
    );
    return { ok: true, token, principal, path: homePath(principal.role) };
  }

  const a = await accountByLoginId(db, loginId);
  const c = a ? accountCredential(env, a) : null;
  if (!(await verifyCredential(password, c)) || !a || !c) return FAIL;
  const principal = accountPrincipal(a);
  if (!principal) return FAIL;
  const token = await signSession(
    { v: 1, k: "account", a: a.id, pv: await credentialVersion(c, secret), ...sessionTimes(now) },
    secret,
  );
  return { ok: true, token, principal, path: homePath(principal.role) };
}

/** 審査員が役を選ぶ・選び直す。審査員のセッションでなければ null（山本も。山本と審査員の両方は chooseRole） */
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
  if (!(await principalOf(db, env, secret, s))) return null;
  const principal = await judgePrincipal(db, role);
  if (!principal) return null;
  const next = await signSession({ ...s, r: role, ...sessionTimes(now) }, secret);
  return { token: next, principal, path: homePath(role) };
}

/**
 * 役を選ぶ・選び直す（ヘッダーの役変更・/login/role の送り先。app/api/auth/role）。審査員は chooseJudgeRole と同じ。
 * 見本のケアマネ（山本、T95）は自分のセッションのまま役の印だけ替える（パスワードの指紋も書き手も山本のまま）。ケアマネの役に戻すと印を外し、
 * ログインしたときと同じ形。ほかのアカウント・本人と家族のリンク・ログインなしは null（403）
 */
export async function chooseRole(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  token: string | null | undefined,
  role: JudgeRole,
  now: number,
): Promise<{ token: string; principal: Principal; path: string } | null> {
  const s = await verifySession(token, secret, now);
  if (!s) return null;
  if (s.k === "judge") return chooseJudgeRole(db, env, secret, token, role, now);
  if (s.k !== "account") return null;
  const current = await principalOf(db, env, secret, s);
  if (!current || !canChooseRole(current)) return null;
  const payload: SessionPayload = {
    v: 1,
    k: "account",
    a: s.a,
    pv: s.pv,
    ...(role === "care_manager" ? {} : { r: role }),
    ...sessionTimes(now),
  };
  const principal = await principalOf(db, env, secret, payload);
  if (!principal) return null;
  return { token: await signSession(payload, secret), principal, path: homePath(principal.role) };
}
