// 避難所の医療班・行政のアカウントを作る SQL（docs/tasks/T97.md）。作者が端末で打つ。作る画面は作らない（README「本運用の条件」）。
// 医療班・行政は事業所に属さない（accounts.office_id が NULL）。受入一覧（/staff）の検索と避難所は事業所をまたぐので、
// 作れるのは事業所の管理者でなく作者だけにする（ケアマネは事業所の管理者が /office で足す。T30）。
//
// 使い方:
//   作る:   node tools/office/new-staff.ts --role medical|government --login-id <ID> --display-name <名前> [--out <ファイル>]
//   再発行: node tools/office/new-staff.ts --reissue --login-id <ID> [--out <ファイル>]
//   停止:   node tools/office/new-staff.ts --disable --login-id <ID> [--out <ファイル>]
//   再開:   node tools/office/new-staff.ts --enable --login-id <ID> [--out <ファイル>]
//
// 作り方は new-office.ts と同じ:
// - 書くのは SQL のファイルだけ（既定 $HOME/care72-staff-<動き>-<時刻>.sql。リポジトリの外。上書きしない）。中身はパスワードのハッシュで、平文は入れない
// - 初期パスワード（作る・再発行）は標準出力に 1 回だけ出す（ファイル・ログに書かない）。ほかの知らせは標準エラーへ
// - 入れるのは作者で、道具は打たない。終わりに打つ命令を出す（--file は D1 の取り込みの道で DB が止まるので、1 文を --command で）:
//     node node_modules/wrangler/bin/wrangler.js d1 execute care72 --remote --command="$(cat <ファイル>)"
//
// 確かめ: 名前と ID はケアマネ追加と同じ決まり（lib/office/forms.ts の parseStaffInput: 名前 20 字・ID の形・judge は予約）。種の ID（yamamoto）は断る。
// ID が本番で使われているかは道具では分からない。作るときに使われていれば UNIQUE で落ち、何も入らない。
// 再発行・停止・再開が変えるのは、事業所の無い医療班・行政の行だけ（ケアマネの行は /office の管理者の操作。T61）。
// 該当が無ければ（ID 違い・ケアマネの ID・もう停止済み）変わる行は 0 で、wrangler の結果の changes に出る。
// 再発行でハッシュが変わると、その人の今のセッションは切れる（lib/auth/principal.ts の指紋 pv）。停止はログインもセッションも通さない（T61）。
// 自分のパスワードの変更は lib/auth/password-change.ts（事業所の無いアカウントも変えられる。事業所の経過には書かない）。

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isReservedLoginId } from "../../lib/auth/demo.ts";
import { hashPassword } from "../../lib/auth/password.ts";
import { LOGIN_ID_PATTERN, normalizeLoginId, parseStaffInput } from "../../lib/office/forms.ts";
import { generateInitialPassword } from "../../lib/office/staff.ts";
import { SEED_ACCOUNTS } from "../../seed/people.ts";
import { insert, lit } from "../../seed/sql.ts";
import { fileStamp, insideRepo } from "./new-office.ts";

/** 作れる役。ケアマネは事業所の管理者が /office で、審査員は種の行だけ */
export const STAFF_ROLES = ["medical", "government"] as const;
export type NewStaffRole = (typeof STAFF_ROLES)[number];

/** 道具の動き。create のほかは今ある医療班・行政の行を 1 つ変える */
export const STAFF_ACTIONS = ["create", "reissue", "disable", "enable"] as const;
export type StaffAction = (typeof STAFF_ACTIONS)[number];

export type NewStaffInput =
  | { action: "create"; role: NewStaffRole; loginId: string; displayName: string; out: string | null }
  | { action: Exclude<StaffAction, "create">; loginId: string; out: string | null };

export type ParseResult = { ok: true; value: NewStaffInput } | { ok: false; error: string };

export const USAGE = [
  "使い方:",
  "  node tools/office/new-staff.ts --role medical|government --login-id <ID> --display-name <名前> [--out <ファイル>]",
  "  node tools/office/new-staff.ts --reissue|--disable|--enable --login-id <ID> [--out <ファイル>]",
].join("\n");

const ID_ERROR = "ID 不正（英小文字・数字・._- の 3〜32 字。judge は不可）";

function isStaffRole(v: string): v is NewStaffRole {
  return (STAFF_ROLES as readonly string[]).includes(v);
}

export function parseNewStaffArgs(argv: string[]): ParseResult {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        role: { type: "string" },
        "login-id": { type: "string" },
        "display-name": { type: "string" },
        reissue: { type: "boolean" },
        disable: { type: "boolean" },
        enable: { type: "boolean" },
        out: { type: "string" },
      },
    }));
  } catch (e) {
    return { ok: false, error: `引数 不正: ${e instanceof Error ? e.message : String(e)}` };
  }

  const flags = (["reissue", "disable", "enable"] as const).filter((k) => values[k] === true);
  if (flags.length > 1) return { ok: false, error: `動き 1 つだけ: ${flags.map((k) => `--${k}`).join(" ")}` };
  const action: StaffAction = flags.length > 0 ? flags[0] : "create";

  const out = typeof values.out === "string" ? values.out : null;
  if (out !== null && insideRepo(out)) return { ok: false, error: "出力先 不可（リポジトリの中）" };

  const rawId = values["login-id"];
  if (typeof rawId !== "string") return { ok: false, error: "足りない: --login-id" };

  if (action !== "create") {
    // 変える動きは ID だけで引く。役と名前は変えない（名前の変更は作者が SQL で）
    const extra = (["role", "display-name"] as const).filter((k) => values[k] !== undefined);
    if (extra.length) return { ok: false, error: `--${action} に不要: ${extra.map((k) => `--${k}`).join(" ")}` };
    const loginId = normalizeLoginId(rawId);
    if (!LOGIN_ID_PATTERN.test(loginId) || isReservedLoginId(loginId)) return { ok: false, error: ID_ERROR };
    if (SEED_ACCOUNTS.some((a) => a.login_id === loginId)) return { ok: false, error: "ID 不可（種）" };
    return { ok: true, value: { action, loginId, out } };
  }

  const missing = ["role", "display-name"].filter((k) => values[k] === undefined);
  if (missing.length) return { ok: false, error: `足りない: ${missing.map((k) => `--${k}`).join(" ")}` };
  const role = String(values.role);
  if (!isStaffRole(role)) return { ok: false, error: "役 不正（medical か government）" };

  const staff = parseStaffInput({ displayName: values["display-name"], loginId: rawId });
  if (!staff.ok) return { ok: false, error: staff.error === "display_name" ? "名前 不正（20 字まで）" : ID_ERROR };
  if (SEED_ACCOUNTS.some((a) => a.login_id === staff.value.loginId)) return { ok: false, error: "ID 使用中（種）" };

  return { ok: true, value: { action, role, loginId: staff.value.loginId, displayName: staff.value.displayName, out } };
}

/** 変える動きの条件: 事業所の無い医療班・行政の行だけ（ケアマネ・審査員の行には効かない） */
function staffRow(loginId: string): string {
  return `login_id = ${lit(loginId)} AND office_id IS NULL AND role IN (${STAFF_ROLES.map((r) => lit(r)).join(", ")})`;
}

/**
 * 1 文の SQL。注は付けない（先頭が -- だと --command の値が旗と読まれることがある。T73a）。
 * create と reissue は passwordHash が要る。at は作った・停止した時刻
 */
export function newStaffSql(
  v: NewStaffInput,
  o: { accountId: string; passwordHash: string | null; at: string },
): string {
  switch (v.action) {
    case "create":
      if (!o.passwordHash) throw new Error("ハッシュなし");
      return (
        insert("accounts", {
          id: o.accountId,
          office_id: null,
          role: v.role,
          is_office_admin: 0,
          display_name: v.displayName,
          login_id: v.loginId,
          password_hash: o.passwordHash,
          created_at: o.at,
        }) + "\n"
      );
    case "reissue":
      if (!o.passwordHash) throw new Error("ハッシュなし");
      return `UPDATE accounts SET password_hash = ${lit(o.passwordHash)} WHERE ${staffRow(v.loginId)};\n`;
    case "disable":
      return `UPDATE accounts SET disabled_at = ${lit(o.at)} WHERE ${staffRow(v.loginId)} AND disabled_at IS NULL;\n`;
    case "enable":
      return `UPDATE accounts SET disabled_at = NULL WHERE ${staffRow(v.loginId)} AND disabled_at IS NOT NULL;\n`;
  }
}

/** 既定の SQL のファイル（リポジトリの外）。動きごとに名前を分ける */
export function defaultStaffOutPath(action: StaffAction, now: Date, home: string = homedir()): string {
  const name = action === "create" ? "new" : action;
  return resolve(home, `care72-staff-${name}-${fileStamp(now)}.sql`);
}

const ACTION_LABELS: Record<StaffAction, string> = { create: "作成", reissue: "再発行", disable: "停止", enable: "再開" };
const ROLE_NAMES: Record<NewStaffRole, string> = { medical: "医療班", government: "行政" };

async function main(): Promise<void> {
  const parsed = parseNewStaffArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    process.exit(1);
  }
  const v = parsed.value;
  const now = new Date();
  const out = v.out ?? defaultStaffOutPath(v.action, now);

  const needsPassword = v.action === "create" || v.action === "reissue";
  const password = needsPassword ? generateInitialPassword() : null;
  const sql = newStaffSql(v, {
    accountId: `acct-${crypto.randomUUID()}`,
    passwordHash: password ? await hashPassword(password) : null,
    at: now.toISOString(),
  });
  try {
    writeFileSync(out, sql, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    process.stderr.write(code === "EEXIST" ? `出力先あり（上書きしない）: ${out}\n` : `書けない: ${out}\n`);
    process.exit(1);
  }

  const file = out.replaceAll("\\", "/");
  if (password) process.stdout.write(`初期パスワード（今回だけ表示）: ${password}\n`);
  const what =
    v.action === "create"
      ? `${ROLE_NAMES[v.role]} ${v.loginId} ${v.displayName}（事業所なし）`
      : `${ACTION_LABELS[v.action]} ${v.loginId}（事業所なしの医療班・行政だけ）`;
  const after =
    v.action === "create"
      ? "ID が使用中なら UNIQUE で落ち、何も入らない。入ったら /login から入り、受入一覧（/staff）が開く"
      : "結果の changes が 0 なら該当なし（ID 違い・ケアマネの ID・もう済み）";
  process.stderr.write(
    [
      `SQL: ${file}`,
      what,
      "入れる命令（作者の端末。DEPLOY_DIR など node_modules のある checkout で）:",
      `  node node_modules/wrangler/bin/wrangler.js d1 execute care72 --remote --command="$(cat '${file}')"`,
      `${after}。入れたら SQL のファイルは消してよい`,
    ].join("\n") + "\n",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    process.stderr.write(`失敗: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
