// 事業所と最初の管理者を作る SQL（docs/tasks/T73.md の 3）。作者が端末で打つ。新規登録の画面は作らない（docs/DECISIONS.md「アカウントと事業所」）。
// 使い方: node tools/office/new-office.ts --name <事業所名> --city <市町村> --login-id <ID> --display-name <管理者の名前>
//         [--id office-xxx] [--plan-form matsuyama|cao] [--out <ファイル>]
//
// 書くのは SQL のファイルだけ（既定 $HOME/care72-new-office-<時刻>.sql。リポジトリの外。上書きしない）。中身はパスワードのハッシュで、平文は入れない。
// 初期パスワードは標準出力に 1 回だけ出す（ファイル・ログに書かない）。ほかの知らせは標準エラーへ。
// 入れるのは作者で、道具は打たない。終わりに打つ命令を出す:
//   node node_modules/wrangler/bin/wrangler.js d1 execute care72 --remote --command="$(cat <ファイル>)"
//   --file でも入るが、remote の --file は D1 の取り込み（import）の道で、流している間 DB が止まる（docs/tasks/T27.md の守ること）。
//   2 行の INSERT なので --command（migrations apply と同じ道、1 つの取引）で入れる。npx は Windows で cmd.exe を通るので node で直に呼ぶ。
// 入れたあと、管理者は /office で自分のパスワードを変えられる（T61）。ケアマネを足すのも /office（T30）。
//
// 確かめ: 名前と ID は事業所の画面のケアマネ追加と同じ決まり（lib/office/forms.ts の parseStaffInput: 名前 20 字・ID の形・judge は予約）。
// 種の ID（yamamoto）と種の事業所の id は断る（種の事業所の id で作ると、作り直しの守り tools/deploy/guard.ts が種と見て消してしまう）。
// ID が本番で使われているかは道具では分からない。使われていれば UNIQUE で落ち、取引ごと巻き戻って何も入らない。
// 初期パスワードは lib/office/staff.ts の generateInitialPassword、ハッシュは lib/auth/password.ts の hashPassword（PBKDF2・100,000 回）。
// 様式の既定は lib/forms/plan-form.ts の defaultPlanForm（T68）。--plan-form で選べる。
// 事業所の中心（T68 の center_lat・center_lng、migration 0017）は入れない（NULL。管理者が /office の「地域」で置く）。

import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { hashPassword } from "../../lib/auth/password.ts";
import { defaultPlanForm } from "../../lib/forms/plan-form.ts";
import { newOfficeRows } from "../../lib/office/create.ts";
import { parseStaffInput, tidySpaces } from "../../lib/office/forms.ts";
import { isSandboxOfficeId } from "../../lib/office/sandbox-id.ts";
import { generateInitialPassword } from "../../lib/office/staff.ts";
import { SEED_ACCOUNTS, SEED_OFFICES } from "../../seed/people.ts";
import { insert } from "../../seed/sql.ts";

export const OFFICE_NAME_MAX = 40;
export const CITY_MAX = 20;
/** 事業所の id。既定は office-<randomUUID の頭 8 桁> */
export const OFFICE_ID_PATTERN = /^office-[a-z0-9_-]{1,57}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type PlanFormChoice = ReturnType<typeof defaultPlanForm>;

/** 様式の既定は T68 の決まり（lib/forms/plan-form.ts の defaultPlanForm: 松山市なら松山市の様式、ほかは内閣府の様式例）をそのまま使う */
export { defaultPlanForm };

export type NewOfficeInput = {
  officeId: string;
  name: string;
  city: string;
  planForm: PlanFormChoice;
  loginId: string;
  displayName: string;
  /** SQL のファイル。null なら既定（$HOME/care72-new-office-<時刻>.sql） */
  out: string | null;
};

export type ParseResult = { ok: true; value: NewOfficeInput } | { ok: false; error: string };

export const USAGE =
  "使い方: node tools/office/new-office.ts --name <事業所名> --city <市町村> --login-id <ID> --display-name <管理者の名前> [--id office-xxx] [--plan-form matsuyama|cao] [--out <ファイル>]";

/** 空白をそろえ、空・長い・制御文字なら null */
function text(raw: string | undefined, max: number): string | null {
  if (raw === undefined || CONTROL.test(raw)) return null;
  const v = tidySpaces(raw.normalize("NFC"));
  return v && v.length <= max ? v : null;
}

/** パスがリポジトリの中か（Windows は大文字小文字を区別しない）。医療班・行政の道具（new-staff.ts）も使う */
export function insideRepo(path: string): boolean {
  const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const root = norm(resolve(ROOT));
  const p = norm(resolve(path));
  return p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function parseNewOfficeArgs(argv: string[], newId: () => string = () => `office-${crypto.randomUUID().slice(0, 8)}`): ParseResult {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        name: { type: "string" },
        city: { type: "string" },
        "login-id": { type: "string" },
        "display-name": { type: "string" },
        id: { type: "string" },
        "plan-form": { type: "string" },
        out: { type: "string" },
      },
    }));
  } catch (e) {
    return { ok: false, error: `引数 不正: ${e instanceof Error ? e.message : String(e)}` };
  }
  const missing = ["name", "city", "login-id", "display-name"].filter((k) => values[k] === undefined);
  if (missing.length) return { ok: false, error: `足りない: ${missing.map((k) => `--${k}`).join(" ")}` };

  const name = text(values.name, OFFICE_NAME_MAX);
  if (!name) return { ok: false, error: `事業所名 不正（${OFFICE_NAME_MAX} 字まで）` };
  const city = text(values.city, CITY_MAX);
  if (!city) return { ok: false, error: `市町村 不正（${CITY_MAX} 字まで）` };

  const staff = parseStaffInput({ displayName: values["display-name"], loginId: values["login-id"] });
  if (!staff.ok) {
    return {
      ok: false,
      error: staff.error === "display_name" ? "名前 不正（20 字まで）" : "ID 不正（英小文字・数字・._- の 3〜32 字。judge は不可）",
    };
  }
  if (SEED_ACCOUNTS.some((a) => a.login_id === staff.value.loginId)) return { ok: false, error: "ID 使用中（種）" };

  const officeId = values.id ?? newId();
  if (!OFFICE_ID_PATTERN.test(officeId)) return { ok: false, error: "id 不正（office-英小文字・数字）" };
  if (SEED_OFFICES.some((o) => o.id === officeId)) return { ok: false, error: "id 使用中（種の事業所）" };
  // 審査員の試用事業所の id（T115。毎朝 4 時の掃除が R2 をこの頭で消す）を本物の事業所に使わない
  if (isSandboxOfficeId(officeId)) return { ok: false, error: "id 不可（試用事業所の頭）" };

  const planRaw = values["plan-form"];
  if (planRaw !== undefined && planRaw !== "matsuyama" && planRaw !== "cao") return { ok: false, error: "様式 不正（matsuyama か cao）" };
  const planForm: PlanFormChoice = planRaw ?? defaultPlanForm(city);

  const out = values.out ?? null;
  if (out !== null && insideRepo(out)) return { ok: false, error: "出力先 不可（リポジトリの中）" };

  return { ok: true, value: { officeId, name, city, planForm, loginId: staff.value.loginId, displayName: staff.value.displayName, out } };
}

/**
 * 事業所の 1 行と管理者の 1 行。注は付けない（先頭が -- だと --command の値が旗と読まれることがある）。
 * 行の形は審査員の試用事業所（lib/office/sandbox.ts、T115）と同じ所（lib/office/create.ts の newOfficeRows）から取る
 */
export function newOfficeSql(
  o: Omit<NewOfficeInput, "out"> & { accountId: string; passwordHash: string; at: string },
): string {
  const rows = newOfficeRows(o);
  return [insert("offices", rows.office), insert("accounts", rows.admin)].join("\n") + "\n";
}

/** ファイル名の時刻（20261104-153000）。端末の時計 */
export function fileStamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** 既定の SQL のファイル（リポジトリの外）。時刻は端末の時計 */
export function defaultOutPath(now: Date, home: string = homedir()): string {
  return resolve(home, `care72-new-office-${fileStamp(now)}.sql`);
}

async function main(): Promise<void> {
  const parsed = parseNewOfficeArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n${USAGE}\n`);
    process.exit(1);
  }
  const v = parsed.value;
  const now = new Date();
  const out = v.out ?? defaultOutPath(now);

  const password = generateInitialPassword();
  const sql = newOfficeSql({
    ...v,
    accountId: `acct-${crypto.randomUUID()}`,
    passwordHash: await hashPassword(password),
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
  process.stdout.write(`初期パスワード（今回だけ表示）: ${password}\n`);
  process.stderr.write(
    [
      `SQL: ${file}`,
      `事業所 ${v.officeId} ${v.name}（${v.city}、様式 ${v.planForm}）`,
      `管理者 ${v.loginId} ${v.displayName}`,
      "入れる命令（作者の端末。DEPLOY_DIR など node_modules のある checkout で）:",
      `  node node_modules/wrangler/bin/wrangler.js d1 execute care72 --remote --command="$(cat '${file}')"`,
      "ID が使用中なら UNIQUE で落ち、何も入らない。入れたら SQL のファイルは消してよい",
    ].join("\n") + "\n",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    process.stderr.write(`失敗: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
