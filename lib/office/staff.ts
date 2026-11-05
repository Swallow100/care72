// ケアマネの追加（docs/tasks/T30.md）。事業所の管理者だけ。D1 と OfficeActor を引数で受け取る（テストで node:sqlite を渡す）。
//
// 初期パスワードはサーバーが作る（でたらめな 12 字＋区切り。見分けにくい 0・o・1・l・i・I・L・O を使わない。大文字・小文字・区切りの記号を
// 必ず含み、lib/auth/password-rule.ts の決まりを通る。T148）。管理者がパスワードを決めて足すこともできる（T148。決まりは同じ 1 か所）。
// 表に入れるのは lib/auth/password.ts のハッシュだけ。作った平文はこの関数の返り値にだけあり、応答で画面に 1 回だけ出す。
// 管理者が決めたパスワードは返さない（管理者はもう知っている。応答・画面・ログに平文を残さない）。どちらも初期パスワードの印（T114）は 1。
// 平文は表・経過・ログ・URL に出さない。ファイルにも書かない。
// 足したケアマネは管理者でない（is_office_admin 0）。ログインは ID と初期パスワード（lib/auth/principal.ts の login）。
// 審査員（壁の中、lib/auth/wall.ts）が足した人には印（judge_made、T81）を付ける。その人で入っても審査員と同じ壁。
// ID の重なり（T81）: login_id は全事業所で 1 つ（ログインは ID だけで引く）。同じ事業所の重なりは「ID 使用中」、
// ほかの事業所の ID と重なるときは別の言い方（login_unavailable「ID 不可」）で断り、ほかの事業所の ID を「使用中」と言わない。

import type { D1Database } from "@cloudflare/workers-types";
import { isFixedAccount } from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { passwordProblems } from "../auth/password-rule.ts";
import type { StaffInput } from "./forms.ts";
import { careManagerName } from "./people.ts";
import type { OfficeActor } from "./scope.ts";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUPS = 3;
const GROUP_LEN = 4;

/**
 * 初期パスワード（例の形 aBcd-eFgh-jkm2）。一様に選ぶため、ALPHABET の長さの倍数を超えるバイトは捨てる。
 * 大文字か小文字が 1 字も無い物（12 字で千に 1 ほど）は作り直し、決まり（lib/auth/password-rule.ts）を必ず通す
 */
export function generateInitialPassword(): string {
  for (;;) {
    const p = randomPassword();
    if (passwordProblems(p).length === 0) return p;
  }
}

function randomPassword(): string {
  const limit = 256 - (256 % ALPHABET.length);
  const out: string[] = [];
  while (out.length < GROUPS * GROUP_LEN) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < GROUPS * GROUP_LEN) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) groups.push(out.slice(i * GROUP_LEN, (i + 1) * GROUP_LEN).join(""));
  return groups.join("-");
}

/**
 * password は表に入れたパスワードの平文（作った物か、管理者が決めた物）。chosen は管理者が決めたか。
 * 応答に載せるのは作った物だけ（lib/office/http.ts。決めた物は管理者が知っているので返さない）
 */
export type AddCareManagerResult =
  | { ok: true; account: { id: string; displayName: string; loginId: string }; password: string; chosen: boolean }
  | { ok: false; error: "forbidden" | "login_taken" | "login_unavailable" };

/** ID がもう使われているときの断り。同じ事業所なら login_taken、ほかの事業所（事業所なしの行も）なら login_unavailable。空いていれば null */
async function loginIdRefusal(db: D1Database, officeId: string, loginId: string): Promise<"login_taken" | "login_unavailable" | null> {
  const row = await db.prepare("SELECT office_id FROM accounts WHERE login_id = ?1").bind(loginId).first<{ office_id: string | null }>();
  if (!row) return null;
  return row.office_id === officeId ? "login_taken" : "login_unavailable";
}

/**
 * ケアマネを 1 人足す。管理者でなければ forbidden、ID が同じ事業所で使われていれば login_taken、ほかの事業所なら login_unavailable。
 * 事業所の経過に「ケアマネ追加 佐藤」。壁の中の人が足すと印（judge_made）。opts.iterations はテストだけ（ハッシュの回数を減らして速くする）
 */
export async function addCareManager(
  db: D1Database,
  actor: OfficeActor,
  input: StaffInput,
  at: string,
  opts: { iterations?: number } = {},
): Promise<AddCareManagerResult> {
  if (!actor.admin) return { ok: false, error: "forbidden" };
  const taken = await loginIdRefusal(db, actor.officeId, input.loginId);
  if (taken) return { ok: false, error: taken };

  // 決めたパスワードがあればそれ（parseStaffInput が決まりで確かめた値）、無ければ作る
  const chosen = input.password ?? null;
  const password = chosen ?? generateInitialPassword();
  const hash = await hashPassword(password, opts.iterations ? { iterations: opts.iterations } : {});
  const id = `acct-${crypto.randomUUID()}`;
  let inserted: number;
  try {
    const [r] = await db.batch([
      db
        .prepare(
          `INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at, judge_made)
           SELECT ?1, o.id, 'care_manager', 0, ?3, ?4, ?5, ?6, ?7 FROM offices o
            WHERE o.id = ?2 AND NOT EXISTS (SELECT 1 FROM accounts WHERE login_id = ?4)`,
        )
        .bind(id, actor.officeId, input.displayName, input.loginId, hash, at, actor.walled ? 1 : 0),
      db
        .prepare(
          `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
           SELECT ?1, a.office_id, ?3, ?4, 'care_manager_added', a.display_name, ?5, ?6 FROM accounts a WHERE a.id = ?2`,
        )
        .bind(crypto.randomUUID(), id, actor.authorId, actor.authorRole, JSON.stringify({ accountId: id }), at),
    ]);
    inserted = r.meta.changes ?? 0;
  } catch (e) {
    // 同時に同じ ID を足したとき（UNIQUE）。ほかの誤りはそのまま投げる。断り方は先に入った行の事業所で
    if (e instanceof Error && /UNIQUE/i.test(e.message)) {
      return { ok: false, error: (await loginIdRefusal(db, actor.officeId, input.loginId)) ?? "login_taken" };
    }
    throw e;
  }
  if (inserted === 0) return { ok: false, error: (await loginIdRefusal(db, actor.officeId, input.loginId)) ?? "login_taken" };
  return { ok: true, account: { id, displayName: input.displayName, loginId: input.loginId }, password, chosen: chosen !== null };
}

// ---------- 名前の変更・管理者の付け外し・停止と再開・パスワードの再発行（T61） ----------
//
// どれも事業所の管理者だけ・同じ事業所のケアマネだけ。種のデモ事業所のアカウント（山本・審査員）は固定で断る（lib/auth/demo.ts）。
// 審査員（壁の中）は印（judge_made）の付いたアカウントだけ。ほかは固定と同じ断り（T81）。
// 書くのは事業所の経過の 1 行（care_manager_changed）とアカウントの行を 1 つの batch で。経過の行を「読んだ時の条件のまま」のときだけ入れ、
// アカウントの行の書き換えはその経過の行があるときだけ（lib/office/people.ts の guardedWrite と同じ作り）。
// 自分の停止・管理者解除・再発行は断る（self。自分のパスワードは lib/auth/password-change.ts）。
// 事業所の最後の使える管理者は停止・管理者解除できない（last_admin）。一覧にいる担当の人がいる間は停止できない（has_people）。

/** 経過の payload の change（何を変えたか） */
export const STAFF_CHANGES = ["rename", "admin", "admin_off", "disable", "enable", "reset_password", "password"] as const;
export type StaffChange = (typeof STAFF_CHANGES)[number];

/** 経過の 1 行の言葉（「佐藤 停止」）。改名は「佐藤 改名 → 佐藤 花子」 */
export const STAFF_CHANGE_LABELS: Record<StaffChange, string> = {
  rename: "改名",
  admin: "管理者",
  admin_off: "管理者解除",
  disable: "停止",
  enable: "再開",
  reset_password: "再発行",
  password: "パスワード変更",
};

/** 経過の body（「佐藤 停止」「佐藤 改名 → 佐藤 花子」）。name は今の名前 */
export function staffChangeBody(name: string, change: StaffChange, renamed?: string): string {
  const head = `${careManagerName(name)} ${STAFF_CHANGE_LABELS[change]}`;
  return change === "rename" && renamed !== undefined ? `${head} → ${renamed}` : head;
}

/** 経過の payload（平文のパスワードは書かない） */
export function staffChangePayload(accountId: string, change: StaffChange): string {
  return JSON.stringify({ accountId, change });
}

export type StaffChangeError = "forbidden" | "fixed" | "self" | "last_admin" | "has_people" | "not_found" | "conflict";
export type StaffChangeResult = { ok: true; changed: boolean } | { ok: false; error: StaffChangeError };

type Target = {
  id: string;
  display_name: string;
  /** 審査員が足した・再発行した（T81） */
  judge_made: 0 | 1;
  is_office_admin: 0 | 1;
  disabled_at: string | null;
  /** 一覧にいる担当の人数（listCareManagers の people と同じ数え方） */
  people: number;
  /** この人のほかの、事業所の使える（停止していない）管理者の数 */
  other_admins: number;
};

/** 一覧にいる担当の人がいない（停止の条件。listCareManagers の people と同じ数え方） */
const NO_PEOPLE = `NOT EXISTS (SELECT 1 FROM people p
  WHERE p.care_manager_id = a.id AND p.office_id = a.office_id AND p.unlisted_at IS NULL)`;
/** この人のほかに使える管理者がいる */
const OTHER_ADMIN = `EXISTS (SELECT 1 FROM accounts o
  WHERE o.office_id = a.office_id AND o.role = 'care_manager' AND o.is_office_admin = 1 AND o.disabled_at IS NULL AND o.id <> a.id)`;

/** 管理者だけ・固定は断る。通れば null */
function refuse(actor: OfficeActor, accountId: string): StaffChangeError | null {
  if (!actor.admin) return "forbidden";
  if (isFixedAccount(accountId)) return "fixed";
  return null;
}

/**
 * 壁の中の人（審査員と審査員が足したアカウント、T81）が変えられるのは印（judge_made）の付いたアカウントだけ。
 * 審査員でない人が足した本物のアカウントの再発行で、その人として入り直せないように（断りは固定のアカウントと同じ fixed）
 */
function outOfReach(actor: OfficeActor, t: Pick<Target, "judge_made">): boolean {
  return actor.walled === true && Number(t.judge_made) !== 1;
}

/** 同じ事業所のケアマネ。違う事業所・ケアマネでない（審査員の行・医療班）・無ければ null */
async function targetOf(db: D1Database, actor: OfficeActor, accountId: string): Promise<Target | null> {
  const row = await db
    .prepare(
      `SELECT a.id, a.display_name, a.is_office_admin, a.disabled_at, a.judge_made,
              (SELECT count(*) FROM people p
                WHERE p.care_manager_id = a.id AND p.office_id = a.office_id AND p.unlisted_at IS NULL) AS people,
              (SELECT count(*) FROM accounts o
                WHERE o.office_id = a.office_id AND o.role = 'care_manager' AND o.is_office_admin = 1
                  AND o.disabled_at IS NULL AND o.id <> a.id) AS other_admins
         FROM accounts a WHERE a.id = ?1 AND a.office_id = ?2 AND a.role = 'care_manager'`,
    )
    .bind(accountId, actor.officeId)
    .first<Target>();
  return row ? { ...row, people: Number(row.people), other_admins: Number(row.other_admins) } : null;
}

/**
 * 経過の行（care_manager_changed）を、アカウントの行が guard の条件のときだけ入れ、アカウントの行の書き換えはその経過の行があるときだけ。
 * guard は a（accounts）の条件で ?9 を使える。set は SET の中で ?4 を使える。書けたら true
 */
async function guardedChange(
  db: D1Database,
  actor: OfficeActor,
  input: {
    accountId: string;
    change: StaffChange;
    body: string;
    guard: string;
    guardArg?: string | null;
    set: string;
    setArg?: string | null;
    at: string;
  },
): Promise<boolean> {
  const logId = crypto.randomUUID();
  const [logged] = await db.batch([
    db
      .prepare(
        `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
         SELECT ?1, a.office_id, ?3, ?4, 'care_manager_changed', ?5, ?6, ?7 FROM accounts a
          WHERE a.id = ?2 AND a.office_id = ?8 AND a.role = 'care_manager' AND (${input.guard}) AND (?9 IS NULL OR ?9 IS NOT NULL)`,
      )
      .bind(
        logId,
        input.accountId,
        actor.authorId,
        actor.authorRole,
        input.body,
        staffChangePayload(input.accountId, input.change),
        input.at,
        actor.officeId,
        input.guardArg ?? null,
      ),
    db
      .prepare(
        `UPDATE accounts SET ${input.set}
          WHERE id = ?1 AND office_id = ?2 AND EXISTS (SELECT 1 FROM office_timeline_entries WHERE id = ?3)
            AND (?4 IS NULL OR ?4 IS NOT NULL)`,
      )
      .bind(input.accountId, actor.officeId, logId, input.setArg ?? null),
  ]);
  return (logged.meta.changes ?? 0) > 0;
}

/** 名前を変える（login_id は変えない）。名前は parseDisplayName でそろえた物。同じ名前なら何も書かない */
export async function renameCareManager(
  db: D1Database,
  actor: OfficeActor,
  accountId: string,
  displayName: string,
  at: string,
): Promise<StaffChangeResult> {
  const no = refuse(actor, accountId);
  if (no) return { ok: false, error: no };
  const t = await targetOf(db, actor, accountId);
  if (!t) return { ok: false, error: "not_found" };
  if (outOfReach(actor, t)) return { ok: false, error: "fixed" };
  if (t.display_name === displayName) return { ok: true, changed: false };
  const ok = await guardedChange(db, actor, {
    accountId,
    change: "rename",
    body: staffChangeBody(t.display_name, "rename", displayName),
    // 読んだあとにほかの人が名前を変えていれば競合（経過の「前 → 後」が食い違わないように）
    guard: "a.display_name = ?9",
    guardArg: t.display_name,
    set: "display_name = ?4",
    setArg: displayName,
    at,
  });
  return ok ? { ok: true, changed: true } : { ok: false, error: "conflict" };
}

/** 管理者を付ける（admin: true）・外す（false）。自分の管理者は外せない、最後の使える管理者は外せない */
export async function setCareManagerAdmin(
  db: D1Database,
  actor: OfficeActor,
  accountId: string,
  admin: boolean,
  at: string,
): Promise<StaffChangeResult> {
  const no = refuse(actor, accountId);
  if (no) return { ok: false, error: no };
  const t = await targetOf(db, actor, accountId);
  if (!t) return { ok: false, error: "not_found" };
  if (outOfReach(actor, t)) return { ok: false, error: "fixed" };
  if ((t.is_office_admin === 1) === admin) return { ok: true, changed: false };
  if (!admin && accountId === actor.authorId) return { ok: false, error: "self" };
  if (!admin && t.other_admins === 0) return { ok: false, error: "last_admin" };
  const change: StaffChange = admin ? "admin" : "admin_off";
  const ok = await guardedChange(db, actor, {
    accountId,
    change,
    body: staffChangeBody(t.display_name, change),
    // 外すのは、ほかに使える管理者がいるときだけ（同時に 2 人が互いを外しても 0 人にならない）
    guard: admin ? "a.is_office_admin = 0" : `a.is_office_admin = 1 AND ${OTHER_ADMIN}`,
    set: `is_office_admin = ${admin ? 1 : 0}`,
    at,
  });
  return ok ? { ok: true, changed: true } : { ok: false, error: "conflict" };
}

/**
 * 停止（disabled: true、退職）・再開（false）。停止した人はログインできず、今あるセッションも次の要求で切れる（lib/auth/principal.ts）。
 * 自分は停止できない、一覧にいる担当の人がいる間は停止できない（担当を先に移す。一括変更 T60）、最後の使える管理者は停止できない
 */
export async function setCareManagerDisabled(
  db: D1Database,
  actor: OfficeActor,
  accountId: string,
  disabled: boolean,
  at: string,
): Promise<StaffChangeResult> {
  const no = refuse(actor, accountId);
  if (no) return { ok: false, error: no };
  const t = await targetOf(db, actor, accountId);
  if (!t) return { ok: false, error: "not_found" };
  if (outOfReach(actor, t)) return { ok: false, error: "fixed" };
  if ((t.disabled_at !== null) === disabled) return { ok: true, changed: false };
  if (disabled && accountId === actor.authorId) return { ok: false, error: "self" };
  if (disabled && t.people > 0) return { ok: false, error: "has_people" };
  if (disabled && t.is_office_admin === 1 && t.other_admins === 0) return { ok: false, error: "last_admin" };
  const change: StaffChange = disabled ? "disable" : "enable";
  const ok = await guardedChange(db, actor, {
    accountId,
    change,
    body: staffChangeBody(t.display_name, change),
    // 停止は、読んだあとに担当が入った・ほかの管理者がいなくなったときも書かない
    guard: disabled ? `a.disabled_at IS NULL AND ${NO_PEOPLE} AND (a.is_office_admin = 0 OR ${OTHER_ADMIN})` : "a.disabled_at IS NOT NULL",
    set: disabled ? "disabled_at = ?4" : "disabled_at = NULL",
    setArg: disabled ? at : null,
    at,
  });
  return ok ? { ok: true, changed: true } : { ok: false, error: "conflict" };
}

/** password は表に入れたパスワードの平文、chosen は管理者が決めたか（応答に載せるのは作った物だけ。lib/office/http.ts） */
export type ResetPasswordResult =
  | { ok: true; account: { id: string; displayName: string }; password: string; chosen: boolean }
  | { ok: false; error: StaffChangeError };

/**
 * 初期パスワードを作り直す（忘れた人に）。ハッシュを入れ、平文はこの返り値にだけ（応答で 1 回だけ出す。表・経過・ログ・URL に出さない）。
 * パスワードの指紋（pv）が変わるので、その人の今のセッションは次の要求で切れる。自分は断る（自分のパスワードは変更の欄から）。
 * chosen は管理者が決めたパスワード（再設定、T148。決まりで確かめた値）。あればそれをハッシュにし、平文は返さない。
 * 経過の言葉はどちらも「再発行」（平文は書かない）。opts.iterations はテストだけ
 */
export async function resetCareManagerPassword(
  db: D1Database,
  actor: OfficeActor,
  accountId: string,
  at: string,
  opts: { iterations?: number; chosen?: string } = {},
): Promise<ResetPasswordResult> {
  const no = refuse(actor, accountId);
  if (no) return { ok: false, error: no };
  const t = await targetOf(db, actor, accountId);
  if (!t) return { ok: false, error: "not_found" };
  if (outOfReach(actor, t)) return { ok: false, error: "fixed" };
  if (accountId === actor.authorId) return { ok: false, error: "self" };
  const chosen = opts.chosen ?? null;
  const password = chosen ?? generateInitialPassword();
  const hash = await hashPassword(password, opts.iterations ? { iterations: opts.iterations } : {});
  const ok = await guardedChange(db, actor, {
    accountId,
    change: "reset_password",
    body: staffChangeBody(t.display_name, "reset_password"),
    guard: "1 = 1",
    // 人が作ったパスワードに戻るので、初期パスワードの印も戻す（T114。本人が変えると外れる）
    set: "password_hash = ?4, password_initial = 1",
    setArg: hash,
    at,
  });
  if (!ok) return { ok: false, error: "conflict" };
  return { ok: true, account: { id: t.id, displayName: careManagerName(t.display_name) }, password, chosen: chosen !== null };
}
