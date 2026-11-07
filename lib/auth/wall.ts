// 審査員の壁（T81、朝の見直し 11/4 の安全 高 1・高 2・中 3）。審査員は皆で 1 つのパスワードを使うので、
// 審査員が触れるのはデモの物だけにし、協力してくれる人の本物（ほかの事業所の人・本物のアンケート）には届かせない。
//
// 壁の中の人（isWalled）: 審査員のログイン（どの役でも。3 つのアカウント、T144）と、審査員が足した・再発行したアカウント
// （accounts.judge_made、migration 0025）。後者は自分のパスワードで入るので judge の印は付かない（役変更・役選択の画面は出ない）が、
// 壁は審査員と同じ。見本のケアマネ（山本）が役変更で医療班・本人・家族の役にしている間も壁の中（T95。ケアマネの役に戻れば壁の外）。
//
// 壁の中身は種の事業所ごと（T144）: 審査員と審査員が足したアカウントはデモ事業所、山本（確認用の事業所）は確認用の事業所。
// 確認用の山本が医療班の役で受け入れても、審査員の見るデモ事業所の人に受け持ちが付かないように。
//
// デモの人（demoPersonSql）: その種の事業所の人と、その事業所のアカウントがその場で登録した所属なしの人。
// 毎朝 4 時の戻し（lib/seed/reset.ts）が消す人と同じ範囲（戻しの ADOPT_UNAFFILIATED もここから作る）。

import { CHECK_OFFICE_ID, DEMO_OFFICE_ID, isRoleSwitchAccount, isSeedOfficeId, UNAFFILIATED_OFFICE_ID } from "./demo.ts";

/**
 * 壁の中の人か。judge は審査員のログイン、judgeMade は審査員が足したアカウント、switched は役を替えた山本（T95。ケアマネ以外の役のときだけ付く。
 * ケアマネの役の山本は壁の外のまま）。どれも lib/auth/principal.ts
 */
export function isWalled(p: { judge: boolean; judgeMade?: boolean; switched?: boolean } | null | undefined): boolean {
  return !!p && (p.judge || p.judgeMade === true || p.switched === true);
}

/**
 * 壁の中の人が見る事業所（T144）。自分の事業所が種の事業所ならそこ（審査員はデモ事業所、役を替えた山本は確認用の事業所）。
 * 審査員の新規事業所の中の役（T180。principal の sandbox が付く。医療班・本人・家族・ケアマネのどれも）はその試用事業所: 医療班が探す・受け入れる・
 * 依頼を受ける人は試用事業所の人と、試用事業所のアカウントがその場で登録した人だけ（デモの人は出さない。デモの医療班にも試用事業所の人は出ない）。
 * そうでなければデモ事業所（試用事業所で足したアカウントが自分のパスワードで入ったとき。前と同じ）
 */
export function wallOfficeOf(p: { office: { id: string } | null; sandbox?: boolean } | null | undefined): string {
  const id = p?.office?.id;
  if (id && p?.sandbox === true) return id;
  return id && isSeedOfficeId(id) ? id : DEMO_OFFICE_ID;
}

/**
 * 役を選べる人か（ヘッダーの役変更・/login/role）。審査員と、確認用の事業所（kind が demo）の見本のケアマネ（山本、T95・T144。どの役のときも）。
 * 選べる役はどちらも同じ（lib/auth/roles.ts の JUDGE_ROLES）
 */
export function canChooseRole(
  p: { judge: boolean; accountId: string | null; office: { id: string; kind: string } | null } | null | undefined,
): boolean {
  if (!p) return false;
  if (p.judge) return true;
  return isRoleSwitchAccount(p.accountId) && p.office?.id === CHECK_OFFICE_ID && p.office.kind === "demo";
}

/** SQL の文字（id の決まった値。入力は入らない） */
const q = (s: string) => `'${s}'`;

/**
 * SQL の条件: 本人（alias の表の行）が種の事業所のアカウントにその場で登録された（受け持ちの via が on_site で、受け持つ人がその事業所の
 * アカウント）。引き受けたあと（所属が変わったあと）も真のまま。officeIds は 1 つか、全部の種の事業所（ほかの事業所から除くとき）。
 * 中の別名は外の問い合わせと重ならない名前
 */
export function demoRegisteredSql(alias: string, officeIds: string | readonly string[]): string {
  const ids = (typeof officeIds === "string" ? [officeIds] : officeIds).map(q).join(", ");
  return `EXISTS (SELECT 1 FROM custody wall_c JOIN accounts wall_a ON wall_a.id = wall_c.holder_id
    WHERE wall_c.person_id = ${alias}.id AND wall_c.via = 'on_site' AND wall_a.office_id IN (${ids}))`;
}

/**
 * SQL の条件: 本人（alias の表の行）が審査員の試用事業所（T115）のどれかのアカウントにその場で登録された（T180。新規事業所の医療班の役）。
 * 本物の事業所の所属なしの引受に出さない・毎朝 4 時の掃除で試用事業所へ移して消すため
 */
export function sandboxRegisteredSql(alias: string): string {
  return `EXISTS (SELECT 1 FROM custody wall_c JOIN accounts wall_a ON wall_a.id = wall_c.holder_id JOIN offices wall_o ON wall_o.id = wall_a.office_id
    WHERE wall_c.person_id = ${alias}.id AND wall_c.via = 'on_site' AND wall_o.judge_sandbox = 1)`;
}

/**
 * SQL の条件: 本人（alias の表の行）がその種の事業所のデモの人（その事業所の人か、その事業所のアカウントが登録した所属なしの人）。
 * officeId は壁の中の人の wallOfficeOf
 */
export function demoPersonSql(alias: string, officeId: string): string {
  return `(${alias}.office_id = ${q(officeId)} OR (${alias}.office_id = ${q(UNAFFILIATED_OFFICE_ID)} AND ${demoRegisteredSql(alias, officeId)}))`;
}
