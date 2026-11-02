// ケアマネの追加（docs/tasks/T30.md）。事業所の管理者だけ。D1 と OfficeActor を引数で受け取る（テストで node:sqlite を渡す）。
//
// 初期パスワードはサーバーが作る（でたらめな 12 字＋区切り。見分けにくい 0・o・1・l・i を使わない）。
// 表に入れるのは lib/auth/password.ts のハッシュだけ。平文はこの関数の返り値にだけあり、応答で画面に 1 回だけ出す。
// 平文は表・経過・ログ・URL に出さない。ファイルにも書かない。
// 足したケアマネは管理者でない（is_office_admin 0）。ログインは ID と初期パスワード（lib/auth/principal.ts の login）。

import type { D1Database } from "@cloudflare/workers-types";
import { hashPassword } from "../auth/password.ts";
import type { StaffInput } from "./forms.ts";
import type { OfficeActor } from "./scope.ts";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUPS = 3;
const GROUP_LEN = 4;

/** 初期パスワード（例の形 abcd-efgh-jkmn）。一様に選ぶため、ALPHABET の長さの倍数を超えるバイトは捨てる */
export function generateInitialPassword(): string {
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

export type AddCareManagerResult =
  | { ok: true; account: { id: string; displayName: string; loginId: string }; password: string }
  | { ok: false; error: "forbidden" | "login_taken" };

/**
 * ケアマネを 1 人足す。管理者でなければ forbidden、ID が使われていれば login_taken。
 * 事業所の経過に「ケアマネ追加 佐藤」。opts.iterations はテストだけ（ハッシュの回数を減らして速くする）
 */
export async function addCareManager(
  db: D1Database,
  actor: OfficeActor,
  input: StaffInput,
  at: string,
  opts: { iterations?: number } = {},
): Promise<AddCareManagerResult> {
  if (!actor.admin) return { ok: false, error: "forbidden" };
  const taken = await db.prepare("SELECT 1 AS x FROM accounts WHERE login_id = ?1").bind(input.loginId).first();
  if (taken) return { ok: false, error: "login_taken" };

  const password = generateInitialPassword();
  const hash = await hashPassword(password, opts.iterations ? { iterations: opts.iterations } : {});
  const id = `acct-${crypto.randomUUID()}`;
  let inserted: number;
  try {
    const [r] = await db.batch([
      db
        .prepare(
          `INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id, password_hash, created_at)
           SELECT ?1, o.id, 'care_manager', 0, ?3, ?4, ?5, ?6 FROM offices o
            WHERE o.id = ?2 AND NOT EXISTS (SELECT 1 FROM accounts WHERE login_id = ?4)`,
        )
        .bind(id, actor.officeId, input.displayName, input.loginId, hash, at),
      db
        .prepare(
          `INSERT INTO office_timeline_entries (id, office_id, author_id, author_role, kind, body, payload, occurred_at)
           SELECT ?1, a.office_id, ?3, ?4, 'care_manager_added', a.display_name, ?5, ?6 FROM accounts a WHERE a.id = ?2`,
        )
        .bind(crypto.randomUUID(), id, actor.authorId, actor.authorRole, JSON.stringify({ accountId: id }), at),
    ]);
    inserted = r.meta.changes ?? 0;
  } catch (e) {
    // 同時に同じ ID を足したとき（UNIQUE）。ほかの誤りはそのまま投げる
    if (e instanceof Error && /UNIQUE/i.test(e.message)) return { ok: false, error: "login_taken" };
    throw e;
  }
  if (inserted === 0) return { ok: false, error: "login_taken" };
  return { ok: true, account: { id, displayName: input.displayName, loginId: input.loginId }, password };
}
