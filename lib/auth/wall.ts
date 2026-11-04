// 審査員の壁（T81、朝の見直し 11/4 の安全 高 1・高 2・中 3）。審査員は皆で 1 つのパスワードを使うので、
// 審査員が触れるのはデモの物だけにし、協力してくれる人の本物（ほかの事業所の人・本物のアンケート）には届かせない。
//
// 壁の中の人（isWalled）: 審査員のログイン（どの役でも）と、審査員が足した・再発行したアカウント（accounts.judge_made、migration 0025）。
// 後者は自分のパスワードで入るので judge の印は付かない（役変更・役選択の画面は出ない）が、壁は審査員と同じ。
// 見本のケアマネ（山本）が役変更で医療班・本人・家族の役にしている間も壁の中（T95。ケアマネの役に戻れば壁の外）。
//
// デモの人（demoPersonSql）: デモ事業所の人と、デモ事業所のアカウント（審査員など）がその場で登録した所属なしの人。
// 毎朝 4 時の戻し（lib/seed/reset.ts）が消す人と同じ範囲（戻しの ADOPT_UNAFFILIATED もここから作る）。

import { DEMO_OFFICE_ID, isRoleSwitchAccount, UNAFFILIATED_OFFICE_ID } from "./demo.ts";

/**
 * 壁の中の人か。judge は審査員のログイン、judgeMade は審査員が足したアカウント、switched は役を替えた山本（T95。ケアマネ以外の役のときだけ付く。
 * ケアマネの役の山本は壁の外のまま）。どれも lib/auth/principal.ts
 */
export function isWalled(p: { judge: boolean; judgeMade?: boolean; switched?: boolean } | null | undefined): boolean {
  return !!p && (p.judge || p.judgeMade === true || p.switched === true);
}

/**
 * 役を選べる人か（ヘッダーの役変更・/login/role）。審査員と、デモ事業所（kind が demo）の見本のケアマネ（山本、T95。どの役のときも）。
 * 選べる役はどちらも同じ（lib/auth/roles.ts の JUDGE_ROLES）
 */
export function canChooseRole(
  p: { judge: boolean; accountId: string | null; office: { id: string; kind: string } | null } | null | undefined,
): boolean {
  if (!p) return false;
  if (p.judge) return true;
  return isRoleSwitchAccount(p.accountId) && p.office?.id === DEMO_OFFICE_ID && p.office.kind === "demo";
}

/** SQL の文字（id の決まった値。入力は入らない） */
const q = (s: string) => `'${s}'`;

/**
 * SQL の条件: 本人（alias の表の行）がデモ事業所のアカウントにその場で登録された（受け持ちの via が on_site で、受け持つ人がデモ事業所の
 * アカウント）。引き受けたあと（所属が変わったあと）も真のまま。中の別名は外の問い合わせと重ならない名前
 */
export function demoRegisteredSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM custody wall_c JOIN accounts wall_a ON wall_a.id = wall_c.holder_id
    WHERE wall_c.person_id = ${alias}.id AND wall_c.via = 'on_site' AND wall_a.office_id = ${q(DEMO_OFFICE_ID)})`;
}

/** SQL の条件: 本人（alias の表の行）がデモの人（デモ事業所の人か、デモのアカウントが登録した所属なしの人） */
export function demoPersonSql(alias: string): string {
  return `(${alias}.office_id = ${q(DEMO_OFFICE_ID)} OR (${alias}.office_id = ${q(UNAFFILIATED_OFFICE_ID)} AND ${demoRegisteredSql(alias)}))`;
}
