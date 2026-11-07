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
  DEMO_JUDGE_ACCOUNT_ID,
  DEMO_OFFICE_ID,
  isFixedAccount,
  isJudgeAccount,
  isNoLoginAccount,
  judgeAccountOfLogin,
  seedTargets,
} from "./demo.ts";
import { issuedSec, linkTarget, type LinkTarget } from "../qr/phone-link-store.ts";
import { phoneAccountById, phoneAccountByLoginId, phoneAccountTarget } from "../phone/account.ts";
import { MAX_PASSWORD_LENGTH, verifyPassword } from "./password.ts";
import { homePath, type JudgeRole, type JudgeSessionRole, type Role, type SandboxTarget } from "./roles.ts";
import { createSandbox, loadSandboxAdmin, SANDBOX_START_PATH, type SandboxAdmin } from "../office/sandbox.ts";
import type { ContactKind } from "../db/types.ts";
import { isSignalWriterKind } from "../signals/labels.ts";
import {
  passwordVersion,
  PHONE_SESSION_TTL_SEC,
  phoneSessionTimes,
  sessionTimes,
  signSession,
  verifySession,
  type SessionPayload,
} from "./session.ts";
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
  /**
   * 初期パスワード（ケアマネ追加・再発行・作者の道具で人が作った物）のまま（accounts.password_initial、T114）。ヘッダーの下に印と変更の入口。
   * 自分のパスワードで入ったアカウントだけ。種の固定のアカウント・審査員・審査員が足したアカウント（壁の中）には付けない。無いのは false
   */
  initialPassword?: boolean;
  /**
   * 審査員の試用事業所の管理者の役（T115、lib/office/sandbox.ts）。審査員のセッションで役の一覧の「新規事業所」を選んでいる間だけ付く。
   * judge も付いたまま（壁の中・役変更が出る）。事業所はその試用事業所、書き手と担当一覧の持ち主は試用事業所の管理者のアカウント。無いのは false
   */
  sandbox?: boolean;
  /**
   * このセッションの試用事業所の管理者のアカウント（judge の b、T180）。審査員のセッションに b があればどの役でも付く（役の一覧に
   * 新規事業所の中の役を並べるため）。デモの役のときは確かめていない id なので、使う所は loadSandboxAdmin を通す。新規事業所の中の役
   * （sandbox が付いている時）は確かめたあと
   */
  sandboxAdmin?: string;
  /**
   * 本人・家族の入り方（T149）。link はスマホ入口のリンク（T69a）、account は本人・家族の ID とパスワード（lib/phone/account.ts）。
   * 審査員・役を替えた山本の本人・家族の役とほかの役には付けない。ID を作れるのは link だけ
   */
  phoneEntry?: "link" | "account";
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
 * 医療班は p のまま（受け持ちは書き手のアカウントごと）、本人・家族は山田 ハナと山田の娘の行。
 * 本人と家族の行は事業所ごと（T144。審査員はデモ事業所の p-01・c-01-1、確認用の事業所の山本はその写し）。種の事業所でなければ null
 */
async function demoRolePrincipal(db: D1Database, office: OfficeRef, p: Principal, role: DemoRole): Promise<Principal | null> {
  const t = seedTargets(office.id);
  if (!t) return null;
  switch (role) {
    case "medical":
      return { ...p, role };
    case "self": {
      const person = await db
        .prepare("SELECT name FROM people WHERE id = ?1 AND office_id = ?2")
        .bind(t.selfPersonId, office.id)
        .first<{ name: string }>();
      return { ...p, role, personId: t.selfPersonId, displayName: person?.name ?? null };
    }
    case "family": {
      const contact = await db
        .prepare(
          `SELECT c.name FROM contacts c JOIN people pe ON pe.id = c.person_id
            WHERE c.id = ?1 AND pe.id = ?2 AND pe.office_id = ?3`,
        )
        .bind(t.familyContactId, t.selfPersonId, office.id)
        .first<{ name: string | null }>();
      return { ...p, role, personId: t.selfPersonId, contactId: t.familyContactId, displayName: contact?.name ?? null };
    }
  }
}

/**
 * 審査員の試用事業所の管理者の形（T115）。sandboxId はセッションの b。試用事業所が無い（毎朝 4 時に消えた・まだ作っていない）・
 * 管理者の形でないなら null（呼ぶ側は役選択へ送る）
 */
async function sandboxPrincipal(
  db: D1Database,
  sandboxId: string | undefined,
  target: SandboxTarget | null = null,
): Promise<Principal | null> {
  if (!sandboxId) return null;
  const a = await loadSandboxAdmin(db, sandboxId);
  if (!a) return null;
  const base: Omit<Principal, "role"> = { ...NOBODY, judge: true, sandbox: true, sandboxAdmin: sandboxId, office: a.office };
  if (target === null || (target.role === "care_manager" && target.id === a.accountId)) {
    return {
      ...base,
      role: "care_manager",
      admin: a.admin,
      accountId: a.accountId,
      displayName: a.displayName || null,
      caseloadOf: a.accountId,
    };
  }
  return sandboxTargetPrincipal(db, a, base, target);
}

/**
 * 新規事業所の中の役（T180）。相手は毎回 D1 で、b の試用事業所の中か・審査員が作った物か（ケアマネは judge_made の印・停止していない、
 * 本人は一覧にいる、家族は答えられる種類の連絡先）を確かめる。外れれば null（呼ぶ側は役選択へ）。
 * 試用事業所の中の物は審査員のセッションの b からしか入れないので、人と連絡先は事業所が合えば審査員が作った物。
 * 医療班・本人・家族の書き手は試用事業所の管理者のアカウント（受け持ち・経過・信号が試用事業所の中に残り、毎朝 4 時の掃除で消える）
 */
async function sandboxTargetPrincipal(
  db: D1Database,
  a: SandboxAdmin,
  base: Omit<Principal, "role">,
  target: SandboxTarget,
): Promise<Principal | null> {
  const officeId = a.office.id;
  switch (target.role) {
    case "care_manager": {
      const cm = await db
        .prepare(
          `SELECT id, display_name, is_office_admin FROM accounts
            WHERE id = ?1 AND office_id = ?2 AND role = 'care_manager' AND judge_made = 1 AND disabled_at IS NULL`,
        )
        .bind(target.id, officeId)
        .first<{ id: string; display_name: string; is_office_admin: 0 | 1 }>();
      if (!cm) return null;
      return {
        ...base,
        role: "care_manager",
        admin: Number(cm.is_office_admin) === 1,
        accountId: cm.id,
        displayName: cm.display_name || null,
        caseloadOf: cm.id,
      };
    }
    case "medical":
      return { ...base, role: "medical", accountId: a.accountId };
    case "self": {
      const person = await db
        .prepare("SELECT id, name FROM people WHERE id = ?1 AND office_id = ?2 AND unlisted_at IS NULL")
        .bind(target.id, officeId)
        .first<{ id: string; name: string }>();
      if (!person) return null;
      return { ...base, role: "self", accountId: a.accountId, personId: person.id, displayName: person.name };
    }
    case "family": {
      const c = await db
        .prepare(
          `SELECT c.id, c.name, c.kind, c.person_id FROM contacts c JOIN people p ON p.id = c.person_id
            WHERE c.id = ?1 AND p.office_id = ?2 AND p.unlisted_at IS NULL`,
        )
        .bind(target.id, officeId)
        .first<{ id: string; name: string | null; kind: ContactKind; person_id: string }>();
      if (!c || !isSignalWriterKind(c.kind)) return null;
      return { ...base, role: "family", accountId: a.accountId, personId: c.person_id, contactId: c.id, displayName: c.name };
    }
  }
}

/** セッションの sr・st から新規事業所の中の役（T180）。無いのは管理者。形が合わなければ invalid（役選択に落とす） */
function sessionTarget(s: Extract<SessionPayload, { k: "judge" }>): SandboxTarget | null | "invalid" {
  if (s.sr === undefined) return s.st === undefined ? null : "invalid";
  if (s.sr === "medical") return s.st === undefined ? { role: "medical" } : "invalid";
  return s.st === undefined ? "invalid" : { role: s.sr, id: s.st };
}

/** セッションに入れる sr・st（管理者の役は付けない。T115 と同じ形） */
function targetFields(t: SandboxTarget | null, adminId: string): { sr?: JudgeRole; st?: string } {
  if (t === null || (t.role === "care_manager" && t.id === adminId)) return {};
  return t.role === "medical" ? { sr: "medical" } : { sr: t.role, st: t.id };
}

/** 審査員のセッションから新規事業所の中の役の印（sr・st）を外す（デモの役・管理者の役に替えるとき） */
function withoutTarget(s: Extract<SessionPayload, { k: "judge" }>): Extract<SessionPayload, { k: "judge" }> {
  const { sr: _sr, st: _st, ...rest } = s;
  return rest;
}

/**
 * 審査員の役ごとの形。役を選ぶ前は unselected（役選択の画面へ）。試用事業所（T115）は sandboxId の事業所の管理者で、
 * 消えていれば役を選ぶ前と同じ unselected（役選択の画面で「新規事業所」を押すと作り直す）。
 * judgeAccount は書き手（審査員 1〜3、T144）。3 つとも同じデモ事業所・同じ担当一覧・同じ役の入口で、書き手だけが違う
 */
async function judgePrincipal(
  db: D1Database,
  role: JudgeSessionRole | null,
  sandboxId: string | undefined,
  judgeAccount: string,
  target: SandboxTarget | null | "invalid" = null,
): Promise<Principal | null> {
  if (!isJudgeAccount(judgeAccount)) return null;
  const office = await demoOffice(db);
  if (!office) return null;
  const unselected = role === null || role === "sandbox";
  const p: Principal = {
    ...NOBODY,
    role: unselected ? "unselected" : role,
    judge: true,
    accountId: judgeAccount,
    office,
    // 役の一覧に新規事業所の中の役を並べるため（T180。確かめるのは使う所）
    ...(sandboxId ? { sandboxAdmin: sandboxId } : {}),
  };
  switch (role) {
    case null:
      return p;
    case "sandbox":
      // 相手が外れた（消した・外した・形が違う）ときも、役を選ぶ前と同じ（役選択の画面へ）
      if (target === "invalid") return p;
      return (await sandboxPrincipal(db, sandboxId, target)) ?? p;
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
  /** 初期パスワードのまま（T114、migration 0028） */
  password_initial: 0 | 1;
  office_id: string | null;
  office_name: string | null;
  office_kind: OfficeKind | null;
};

const ACCOUNT_SELECT = `SELECT a.id, a.role, a.is_office_admin, a.display_name, a.password_hash, a.disabled_at, a.judge_made, a.password_initial,
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
  // ログインに使わない固定のアカウント（T144。審査員の担当一覧の持ち主 acct-yamamoto など）は、前からのセッションも通さない
  if (a.role === "judge" || a.disabled_at !== null || isNoLoginAccount(a.id)) return null;
  const office: OfficeRef | null =
    a.office_id && a.office_name !== null && a.office_kind !== null
      ? { id: a.office_id, name: a.office_name, kind: a.office_kind }
      : null;
  const judgeMade = Number(a.judge_made) === 1;
  // 初期パスワードの印（T114）。固定のアカウント（山本・西村）と審査員が足したアカウント（壁の中）は対象の外
  const initialPassword = Number(a.password_initial) === 1 && !judgeMade && !isFixedAccount(a.id);
  const base = {
    ...NOBODY,
    accountId: a.id,
    displayName: a.display_name || null,
    office,
    judgeMade,
    ...(initialPassword ? { initialPassword: true } : {}),
  };
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
  return targetPrincipal(t, "link");
}

/** リンク・ID で開く本人（と連絡先）から、本人スマホ・家族スマホの役の形（accountId は null） */
function targetPrincipal(t: LinkTarget, entry: "link" | "account"): Principal {
  const base = { ...NOBODY, office: t.office, personId: t.personId, phoneEntry: entry };
  if (t.contact === null) return { ...base, role: "self", displayName: t.personName };
  return { ...base, role: "family", contactId: t.contact.id, displayName: t.contact.name };
}

/**
 * 本人・家族の ID で入ったセッション（T149）。ID の行が無い（消えた・作り直して別の行）・パスワードが変わった（pv）・
 * 作った時のリンクの版と時刻が本人の行と違う（再発行・一覧から外した）・連絡先が答えられる種類でない、のどれでも null
 */
async function phoneSessionPrincipal(db: D1Database, s: Extract<SessionPayload, { k: "phone" }>): Promise<Principal | null> {
  const row = await phoneAccountById(db, s.a);
  if (!row || (await passwordVersion(row.password_hash)) !== s.pv) return null;
  const t = await phoneAccountTarget(db, row);
  return t ? targetPrincipal(t, "account") : null;
}

/**
 * セッションの中身から。パスワードが変わった・アカウントが無い・審査員のパスワードが env に無いときは null。
 * 確かめ方はログインと同じ所（lib/auth/credential.ts）から取る（env の平文で入った山本も次の要求で切れない）。
 */
async function principalOf(db: D1Database, env: AuthEnv, secret: string, s: SessionPayload): Promise<Principal | null> {
  if (s.k === "judge") {
    const c = judgeCredential(env);
    if (!c || (await credentialVersion(c, secret)) !== s.pv) return null;
    return judgePrincipal(db, s.r, s.b, judgeAccountOf(s), s.r === "sandbox" ? sessionTarget(s) : null);
  }
  if (s.k === "link") return linkPrincipal(db, s);
  if (s.k === "phone") return phoneSessionPrincipal(db, s);
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

/** 審査員のセッションの書き手（T144）。a が無いのは審査員 1 */
function judgeAccountOf(s: Extract<SessionPayload, { k: "judge" }>): string {
  return s.a ?? DEMO_JUDGE_ACCOUNT_ID;
}

/** maxAge は cookie の Max-Age（秒）。無ければ既定の 7 日。本人・家族の ID（T149）は 180 日 */
export type LoginResult = { ok: true; token: string; principal: Principal; path: string; maxAge?: number } | { ok: false };
const FAIL: LoginResult = { ok: false };

/**
 * ID とパスワードで入る。審査員の ID（3 つ、T144）なら env の JUDGE_PASSWORD_HASH か JUDGE_PASSWORD（3 つで同じ）、
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

  const judgeAccount = judgeAccountOfLogin(loginId);
  if (judgeAccount) {
    const c = judgeCredential(env);
    if (!(await verifyCredential(password, c)) || !c) return FAIL;
    const principal = await judgePrincipal(db, null, undefined, judgeAccount);
    if (!principal) return FAIL;
    const token = await signSession(
      {
        v: 1,
        k: "judge",
        r: null,
        pv: await credentialVersion(c, secret),
        // 審査員 1 は a を付けない（T144 の前の cookie と同じ形）
        ...(judgeAccount === DEMO_JUDGE_ACCOUNT_ID ? {} : { a: judgeAccount }),
        ...sessionTimes(now),
      },
      secret,
    );
    return { ok: true, token, principal, path: homePath(principal.role) };
  }

  const a = await accountByLoginId(db, loginId);
  // ケアマネなどの表に無い ID は、本人・家族の ID（T149）。どちらも PBKDF2 は 1 回（ID が有るかを時間で分からせない）
  const phone = a ? null : await phoneAccountByLoginId(db, loginId);
  if (phone) {
    if (!(await verifyPassword(password, phone.password_hash))) return FAIL;
    const t = await phoneAccountTarget(db, phone);
    if (!t) return FAIL;
    const principal = targetPrincipal(t, "account");
    const token = await signSession(
      { v: 1, k: "phone", a: phone.id, pv: await passwordVersion(phone.password_hash), ...phoneSessionTimes(now) },
      secret,
    );
    return { ok: true, token, principal, path: homePath(principal.role), maxAge: PHONE_SESSION_TTL_SEC };
  }
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
  // 試用事業所の b（T115）と書き手の a（T144）は残す（「新規事業所」を選び直すと同じ事業所へ戻る）
  const principal = await judgePrincipal(db, role, s.b, judgeAccountOf(s));
  if (!principal) return null;
  // 新規事業所の中の役の印（T180）は外す（デモの役は 4 つのまま）
  const next = await signSession({ ...withoutTarget(s), r: role, ...sessionTimes(now) }, secret);
  return { token: next, principal, path: homePath(role) };
}

export type SandboxChoice =
  | { ok: true; token: string; principal: Principal; path: string; created: boolean }
  | { ok: false; error: "forbidden" | "limit" };

/**
 * 審査員が役の一覧の「新規事業所」を選ぶ（T115、app/api/auth/role）。セッションの b の試用事業所が生きていれば作らずそこへ、
 * 無ければ作って b に付ける（lib/office/sandbox.ts の createSandbox。上限なら limit）。審査員のセッションでなければ forbidden
 * （山本・本人と家族のリンク・ログインなし）。送り先は事業所の画面（初めて入った管理者の準備の欄 T98 が一番上に出る）。at は作る時刻（ISO）
 */
export async function chooseSandbox(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  token: string | null | undefined,
  now: number,
  at: string,
): Promise<SandboxChoice> {
  const s = await verifySession(token, secret, now);
  if (!s || s.k !== "judge" || !(await principalOf(db, env, secret, s))) return { ok: false, error: "forbidden" };
  let sandboxId = s.b;
  let created = false;
  if (!sandboxId || !(await loadSandboxAdmin(db, sandboxId))) {
    const r = await createSandbox(db, at);
    if (!r.ok) return r;
    sandboxId = r.accountId;
    created = true;
  }
  const principal = await sandboxPrincipal(db, sandboxId);
  if (!principal) return { ok: false, error: "forbidden" };
  // 「新規事業所」は管理者の役（T180 の中の役の印は外す）
  const next = await signSession({ ...withoutTarget(s), r: "sandbox", b: sandboxId, ...sessionTimes(now) }, secret);
  return { ok: true, token: next, principal, path: SANDBOX_START_PATH, created };
}

/**
 * 新規事業所の中の役に替える（T180、app/api/auth/role）。審査員のセッションで、b の試用事業所が生きているときだけ。
 * 相手（ケアマネ・本人・家族の id）はここでも D1 で b の事業所の中かを確かめ、外なら forbidden（ほかの審査員の試用事業所・デモ・本物の事業所の id）。
 * 試用事業所が無ければ作らない（先に「新規事業所」を選ぶ）。送り先はその役の入口（ケアマネは担当一覧、医療班は受入一覧、本人・家族はスマホの頁）
 */
export async function chooseSandboxRole(
  db: D1Database,
  env: AuthEnv,
  secret: string,
  token: string | null | undefined,
  target: SandboxTarget,
  now: number,
): Promise<{ token: string; principal: Principal; path: string } | null> {
  const s = await verifySession(token, secret, now);
  if (!s || s.k !== "judge" || !s.b || !(await principalOf(db, env, secret, s))) return null;
  const principal = await sandboxPrincipal(db, s.b, target);
  if (!principal) return null;
  const fields = targetFields(target, s.b);
  const next = await signSession({ ...withoutTarget(s), r: "sandbox", b: s.b, ...fields, ...sessionTimes(now) }, secret);
  return { token: next, principal, path: homePath(principal.role) };
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
