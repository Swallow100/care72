// T149: 本人・家族のスマホの入口。ID とパスワード（lib/phone/account.ts）とその決まり、ログインとセッション（lib/auth の phone の形）と壁、
// 同意の決まり（lib/phone/consent.ts）、本人のページのスマホの面（lib/phone/summary.ts）、準備の欄の決まり（lib/phone/setup.ts）、
// 通知の購読と送る時（lib/push/http.ts。偽の送り先）、災害モードに入った時（lib/disaster/http.ts の modePostEntered）、
// Service Worker の通知の決まり（lib/offline/sw-core.js）、migration 0035。D1 は node:sqlite に種の 10 人。鍵はテストの中で作る。Claude は呼ばない。

import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { readCookie, SESSION_COOKIE } from "../auth/cookie.ts";
import { DEMO_CARE_MANAGER_ID, JUDGE_LOGIN_ID } from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { PASSWORD_RULE_LABELS, passwordRuleProblems } from "../auth/password-rule.ts";
import { pageExit } from "../auth/phone-gate.ts";
import { chooseJudgeRole, login, resolvePrincipal, type Principal } from "../auth/principal.ts";
import { LOGIN_PATH } from "../auth/roles.ts";
import { personInScope } from "../auth/scope.ts";
import { decodeSession, PHONE_SESSION_TTL_SEC, verifySession } from "../auth/session.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { modePostEntered } from "../disaster/http.ts";
import { disasterScope } from "../disaster/scope.ts";
import { loadPersonPage } from "../person.ts";
import { addCareManager } from "../office/staff.ts";
import { officeActor } from "../office/scope.ts";
import { NOTIFY_DEFAULT, notificationOf, notifyTarget } from "../offline/sw-core.js";
import { officeSafety, safetyPost, subscribePost, unsubscribePost } from "../push/http.ts";
import { pushMessage } from "../push/message.ts";
import type { PushFetch } from "../push/send.ts";
import { liveSubscriptionsOf } from "../push/store.ts";
import { safetyLabel } from "../push/view.ts";
import { loadVapid, type Vapid } from "../push/vapid.ts";
import { testReceiver, testVapidEnv } from "../push/test-keys.ts";
import { currentPhoneLinkToken, issuePhoneLink } from "../qr/phone-link-store.ts";
import { openPhoneLink } from "../qr/phone-open.ts";
import { buildPhoneLinkView } from "../qr/phone-link-view.ts";
import { loadPhoneLinkRow } from "../qr/phone-link-store.ts";
import { livePhoneAccountKeys, parsePhoneLoginId, savePhoneAccount } from "./account.ts";
import { phoneEntryAllowed } from "./consent.ts";
import { phoneAccountErrorWords } from "./labels.ts";
import { currentStep, keyBytes, sameKey, setupSteps, setupVisible, type SetupInput } from "./setup.ts";
import { setupAccountOf } from "./setup-props.ts";
import { loadPhoneSummary } from "./summary.ts";

const SECRET = "test-secret-for-t149-phone-0123456789abcdef";
const NOW = Math.floor(Date.parse("2026-11-04T00:00:00.000Z") / 1000);
const ISO = (sec: number) => new Date(sec * 1000).toISOString();
const ISSUER = { officeId: "office-demo", authorId: DEMO_CARE_MANAGER_ID };
const GOOD_PW = "Kaze-no-hi1";
const IT = { iterations: 1000 };
const JUDGE_PW = "test-judge-pass-t149";

let judgeHash: string;
beforeAll(async () => {
  judgeHash = await hashPassword(JUDGE_PW, IT);
});

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });
const one = <T>(sql: string, ...args: Array<string | number | null>) => sqlite.prepare(sql).get(...args) as T;

const cm = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: DEMO_CARE_MANAGER_ID,
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: DEMO_CARE_MANAGER_ID,
  personId: null,
  contactId: null,
  ...p,
});

/** p-01 に発行して、リンクを開いたセッションの cookie と Principal（本人用は contactId null） */
async function linkSession(personId = "p-01", contactId: string | null = null, issuedAt = NOW - 3600) {
  const row = (await loadPhoneLinkRow(db, personId))!;
  const r = row.phone_link_generation > 0 ? row : (await issuePhoneLink(db, ISSUER, personId, ISO(issuedAt)))!;
  const token = (await currentPhoneLinkToken(personId, contactId, r, SECRET))!;
  const res = await openPhoneLink(new Request("http://localhost:3072/s/x"), db, SECRET, token, NOW);
  const cookie = readCookie(res.headers.get("set-cookie"), SESSION_COOKIE)!;
  const principal = (await resolvePrincipal(db, env(), SECRET, cookie, NOW))!;
  return { cookie, principal };
}

async function judgeAs(role: "self" | "family" | "care_manager") {
  const r = await login(db, env(), SECRET, { loginId: JUDGE_LOGIN_ID, password: JUDGE_PW }, NOW);
  if (!r.ok) throw new Error("審査員で入れない");
  return (await chooseJudgeRole(db, env(), SECRET, r.token, role, NOW))!.principal;
}

const input = (loginId: string, password = GOOD_PW, password2 = password) => ({ loginId, password, password2 });

describe("パスワードの決まり（ケアマネと同じ。lib/auth/password-rule.ts）", () => {
  it("10 字以上・大文字・小文字・記号。足りない物を全部返す", () => {
    expect(passwordRuleProblems(GOOD_PW)).toEqual([]);
    expect(passwordRuleProblems("Aa!4567")).toEqual(["length"]);
    expect(passwordRuleProblems("abcdefghij!")).toEqual(["upper"]);
    expect(passwordRuleProblems("ABCDEFGHIJ!")).toEqual(["lower"]);
    expect(passwordRuleProblems("Abcdefghijk")).toEqual(["symbol"]);
    expect(passwordRuleProblems("")).toEqual(["length", "upper", "lower", "symbol"]);
    expect(passwordRuleProblems(`Aa!${"x".repeat(62)}`)).toEqual(["length"]);
    // 全角の記号は記号に数えない（ASCII の記号だけ）
    expect(passwordRuleProblems("Abcdefghij！")).toEqual(["symbol"]);
    expect(Object.values(PASSWORD_RULE_LABELS)).toEqual(["10字以上", "大文字", "小文字", "記号"]);
  });

  it("ID はケアマネの ID と同じ形（小文字にそろえる・3〜32 字・審査員の ID は使えない）", () => {
    expect(parsePhoneLoginId(" Yamada.Hana ")).toBe("yamada.hana");
    expect(parsePhoneLoginId("ab")).toBeNull();
    expect(parsePhoneLoginId("やまだ")).toBeNull();
    expect(parsePhoneLoginId(JUDGE_LOGIN_ID)).toBeNull();
    expect(parsePhoneLoginId(42)).toBeNull();
  });

  it("断りの言葉はやさしい日本語で、パスワードの足りない物を並べる", () => {
    expect(phoneAccountErrorWords("password", ["upper", "symbol"])).toContain("{大文字|おおもじ}・{記号|きごう}");
    expect(phoneAccountErrorWords("consent")).toContain("{同意|どうい}");
  });
});

describe("ID とパスワードを作る（リンクで開いた本人・家族だけ）", () => {
  it("リンクで開いた本人が作り、次からその ID でログインできる（役は本人スマホ、180 日のセッション、/me へ）", async () => {
    const { principal } = await linkSession();
    expect(principal).toMatchObject({ role: "self", personId: "p-01", phoneEntry: "link", accountId: null });
    const r = await savePhoneAccount(db, principal, input("Hana01"), ISO(NOW), IT);
    expect(r).toEqual({ ok: true, loginId: "hana01", created: true });
    // 平文は表に無い
    const row = one<{ password_hash: string; contact_id: string | null; link_generation: number }>("SELECT * FROM phone_accounts");
    expect(row.password_hash).toMatch(/^pbkdf2-sha256:/);
    expect(row.password_hash).not.toContain(GOOD_PW);
    expect(row).toMatchObject({ contact_id: null, link_generation: 1 });

    const l = await login(db, env(), SECRET, { loginId: "HANA01", password: GOOD_PW }, NOW + 10);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.path).toBe("/me");
    expect(l.maxAge).toBe(PHONE_SESSION_TTL_SEC);
    expect(l.principal).toMatchObject({ role: "self", personId: "p-01", phoneEntry: "account", accountId: null, judge: false });
    const s = await verifySession(l.token, SECRET, NOW + 10);
    expect(s).toMatchObject({ k: "phone" });
    // 179 日目も通り、181 日目は通らない
    expect(await resolvePrincipal(db, env(), SECRET, l.token, NOW + 179 * 86400)).toMatchObject({ role: "self" });
    expect(await resolvePrincipal(db, env(), SECRET, l.token, NOW + 181 * 86400)).toBeNull();
    // 違うパスワードは同じ失敗
    expect((await login(db, env(), SECRET, { loginId: "hana01", password: "Kaze-no-hi2" }, NOW)).ok).toBe(false);
  });

  it("リンクの期限（180 日）が過ぎても、版が同じなら ID で入れる", async () => {
    const { principal } = await linkSession("p-01", null, NOW - 3600);
    await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT);
    const later = NOW + 200 * 86400;
    const l = await login(db, env(), SECRET, { loginId: "hana01", password: GOOD_PW }, later);
    expect(l.ok).toBe(true);
  });

  it("家族用のリンクの家族が作ると、家族スマホの役で /family。見られるのはその本人だけ（壁）", async () => {
    const { principal } = await linkSession("p-01", "c-01-1");
    expect(principal).toMatchObject({ role: "family", contactId: "c-01-1", phoneEntry: "link" });
    expect(await savePhoneAccount(db, principal, input("musume.y"), ISO(NOW), IT)).toMatchObject({ ok: true });
    const l = await login(db, env(), SECRET, { loginId: "musume.y", password: GOOD_PW }, NOW);
    if (!l.ok) throw new Error("入れない");
    expect(l.path).toBe("/family");
    expect(l.principal).toMatchObject({ role: "family", personId: "p-01", contactId: "c-01-1", phoneEntry: "account" });
    expect(await loadPersonPage(db, l.principal, "p-01")).not.toBeNull();
    expect(await loadPersonPage(db, l.principal, "p-02")).toBeNull();
    expect(await personInScope(db, l.principal, "p-02")).toBeNull();
    // 本人用と家族用は別の行（1 本人・1 連絡先に 1 つ）
    const self = await linkSession("p-01", null);
    expect(await savePhoneAccount(db, self.principal, input("hana01"), ISO(NOW), IT)).toMatchObject({ ok: true });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM phone_accounts").n).toBe(2);
  });

  it("作り直すと ID とパスワードが替わり、前のパスワードのセッションは切れる", async () => {
    const { principal } = await linkSession();
    await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT);
    const first = await login(db, env(), SECRET, { loginId: "hana01", password: GOOD_PW }, NOW);
    if (!first.ok) throw new Error("入れない");
    expect(await savePhoneAccount(db, principal, input("hana02", "Umi-no-hi22"), ISO(NOW + 5), IT)).toEqual({
      ok: true,
      loginId: "hana02",
      created: false,
    });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM phone_accounts").n).toBe(1);
    expect(await resolvePrincipal(db, env(), SECRET, first.token, NOW + 10)).toBeNull();
    expect((await login(db, env(), SECRET, { loginId: "hana01", password: GOOD_PW }, NOW)).ok).toBe(false);
    expect((await login(db, env(), SECRET, { loginId: "hana02", password: "Umi-no-hi22" }, NOW)).ok).toBe(true);
  });

  it("再発行・一覧から外すと、ID のログインもセッションも通らない", async () => {
    const { principal } = await linkSession();
    await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT);
    const l = await login(db, env(), SECRET, { loginId: "hana01", password: GOOD_PW }, NOW);
    if (!l.ok) throw new Error("入れない");
    await issuePhoneLink(db, ISSUER, "p-01", ISO(NOW + 60));
    expect(await resolvePrincipal(db, env(), SECRET, l.token, NOW + 120)).toBeNull();
    expect((await login(db, env(), SECRET, { loginId: "hana01", password: GOOD_PW }, NOW + 120)).ok).toBe(false);
    // 通らなくなったセッションで本人の頁を開くとログイン欄へ（ID を持っているので「無効」の頁でない）
    const lost = await decodeSession(l.token, SECRET);
    expect(pageExit("me", null, lost)).toBe(LOGIN_PATH);
  });

  it("作れない: ログインなし・ケアマネ・審査員と山本の本人の役・ID で入ったセッション", async () => {
    expect(await savePhoneAccount(db, null, input("x123"), ISO(NOW), IT)).toEqual({ ok: false, error: "login_required" });
    expect(await savePhoneAccount(db, cm(), input("x123"), ISO(NOW), IT)).toEqual({ ok: false, error: "forbidden" });
    const judgeSelf = await judgeAs("self");
    expect(judgeSelf).toMatchObject({ role: "self", personId: "p-01" });
    expect(judgeSelf.phoneEntry).toBeUndefined();
    expect(await savePhoneAccount(db, judgeSelf, input("x123"), ISO(NOW), IT)).toEqual({ ok: false, error: "forbidden" });
    const { principal } = await linkSession();
    await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT);
    const l = await login(db, env(), SECRET, { loginId: "hana01", password: GOOD_PW }, NOW);
    if (!l.ok) throw new Error("入れない");
    expect(await savePhoneAccount(db, l.principal, input("hana09"), ISO(NOW), IT)).toEqual({ ok: false, error: "forbidden" });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM phone_accounts").n).toBe(1);
  });

  it("同意の無い人は作れない（計画共有が「同意」でない）", async () => {
    const { principal } = await linkSession();
    sqlite.prepare("UPDATE consents SET status = 'unconfirmed' WHERE person_id = 'p-01' AND kind = 'plan_share'").run();
    expect(await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT)).toEqual({ ok: false, error: "consent" });
    sqlite.prepare("DELETE FROM consents WHERE person_id = 'p-01' AND kind = 'plan_share'").run();
    expect(await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT)).toEqual({ ok: false, error: "consent" });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM phone_accounts").n).toBe(0);
  });

  it("ID とパスワードの決まり: 形・決まり・2 回の一致", async () => {
    const { principal } = await linkSession();
    expect(await savePhoneAccount(db, principal, input("ab"), ISO(NOW), IT)).toEqual({ ok: false, error: "login_id" });
    expect(await savePhoneAccount(db, principal, input("hana01", "short"), ISO(NOW), IT)).toEqual({
      ok: false,
      error: "password",
      problems: ["length", "upper", "symbol"],
    });
    expect(await savePhoneAccount(db, principal, input("hana01", GOOD_PW, "Kaze-no-hi2"), ISO(NOW), IT)).toEqual({
      ok: false,
      error: "mismatch",
    });
  });

  it("ケアマネの ID・ほかの本人と家族の ID と重ならない。ケアマネを足す時も本人・家族の ID を使えない", async () => {
    const a = await linkSession("p-01");
    expect(await savePhoneAccount(db, a.principal, input("yamamoto"), ISO(NOW), IT)).toEqual({ ok: false, error: "login_taken" });
    expect(await savePhoneAccount(db, a.principal, input("hana01"), ISO(NOW), IT)).toMatchObject({ ok: true });
    const b = await linkSession("p-02");
    expect(await savePhoneAccount(db, b.principal, input("hana01"), ISO(NOW), IT)).toEqual({ ok: false, error: "login_taken" });
    const actor = officeActor(cm())!;
    expect(await addCareManager(db, actor, { displayName: "佐藤", loginId: "hana01" }, ISO(NOW), IT)).toEqual({
      ok: false,
      error: "login_unavailable",
    });
  });
});

describe("本人のページのスマホの面・スマホ入口の画面", () => {
  it("未発行・同意あり → 入口は未発行、本人用と家族用の行に ID と通知の印", async () => {
    const s = (await loadPhoneSummary(db, "p-01", NOW))!;
    expect(s).toMatchObject({ personId: "p-01", href: "/people/p-01/phone", status: "none", allowed: true, unlisted: false });
    expect(s.rows[0]).toEqual({ key: "self", kind: "self", name: null, relation: null, account: false, notify: 0 });
    expect(s.rows.some((r) => r.key === "c-01-1" && r.kind === "family")).toBe(true);
  });

  it("作った ID と許可した端末の数が行に出る", async () => {
    const { principal } = await linkSession();
    await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT);
    const r = await testReceiver();
    await subscribePost(db, principal, { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: r.json }, ISO(NOW));
    const s = (await loadPhoneSummary(db, "p-01", NOW))!;
    expect(s.status).toBe("active");
    expect(s.rows[0]).toMatchObject({ key: "self", account: true, notify: 1 });
    expect([...(await livePhoneAccountKeys(db, "p-01"))]).toEqual(["self"]);
  });

  it("同意の無い人は「同意なし」: 面は allowed false、スマホ入口の画面は URL と QR を出さず発行も押せない", async () => {
    sqlite.prepare("UPDATE consents SET status = 'refused' WHERE person_id = 'p-01' AND kind = 'plan_share'").run();
    expect(phoneEntryAllowed([{ kind: "plan_share", status: "refused" }])).toBe(false);
    expect(phoneEntryAllowed([{ kind: "plan_share", status: "granted" }])).toBe(true);
    expect((await loadPhoneSummary(db, "p-01", NOW))!.allowed).toBe(false);
    await issuePhoneLink(db, ISSUER, "p-01", ISO(NOW - 60));
    const rows = (await loadPersonPage(db, cm(), "p-01"))!;
    const view = await buildPhoneLinkView(rows, (await loadPhoneLinkRow(db, "p-01"))!, {
      now: NOW,
      origin: "http://localhost:3072",
      secret: SECRET,
      phone: { allowed: phoneEntryAllowed(rows.consents), accounts: new Set(), notify: new Map() },
    });
    expect(view.allowed).toBe(false);
    expect(view.self.url).toBeNull();
    expect(view.family.every((f) => f.url === null)).toBe(true);
  });

  it("新しく足した人（同意は全部「未確認」）は作れない", () => {
    expect(phoneEntryAllowed([{ kind: "plan_share", status: "unconfirmed" }])).toBe(false);
    expect(phoneEntryAllowed([])).toBe(false);
  });

  it("書類の行にスマホ入口を出さない（スマホの面に移した）", async () => {
    const { toPersonView } = await import("../person.ts");
    const rows = (await loadPersonPage(db, cm(), "p-01"))!;
    const view = toPersonView(rows, { today: "2026-11-04" });
    const docs = view.sections.find((s) => s.id === "documents")!;
    const keys = docs.blocks.flatMap((b) => (b.type === "documents" ? b.documents.map((d) => d.key) : []));
    expect(keys).not.toContain("phone");
    expect(keys).toContain("qr");
  });

  it("準備の欄の ID の段: リンクで開いた人は作る欄、作れば済み、審査員の役は出さない、同意が無ければ出さない", async () => {
    const { principal } = await linkSession();
    const rows = (await loadPersonPage(db, principal, "p-01"))!;
    expect(await setupAccountOf(db, principal, rows.consents)).toEqual({ kind: "create" });
    await savePhoneAccount(db, principal, input("hana01"), ISO(NOW), IT);
    expect(await setupAccountOf(db, principal, rows.consents)).toEqual({ kind: "done", loginId: "hana01" });
    expect(await setupAccountOf(db, await judgeAs("self"), rows.consents)).toEqual({ kind: "hidden" });
    const other = await linkSession("p-02");
    expect(await setupAccountOf(db, other.principal, [{ kind: "plan_share", status: "refused" }])).toEqual({ kind: "hidden" });
  });
});

describe("準備の欄の決まり（ID → ホーム画面 → 通知）", () => {
  const base: SetupInput = { account: "create", installDone: false, notify: "todo", skipped: [] };
  it("まだの最初の段を案内し、済んだら出さない", () => {
    expect(currentStep(base)).toBe("account");
    expect(currentStep({ ...base, account: "done" })).toBe("install");
    expect(currentStep({ ...base, account: "done", installDone: true })).toBe("notify");
    expect(currentStep({ ...base, account: "done", installDone: true, notify: "done" })).toBeNull();
    expect(setupVisible({ ...base, account: "done", installDone: true, notify: "done" }, false)).toBe(false);
    // 審査員の役は ID の段を並べない
    expect(setupSteps({ ...base, account: "hidden" }).map((s) => s.step)).toEqual(["install", "notify"]);
  });

  it("ID の段は後に回せる（この表示の間だけ）。未設定でも通知の段は残る（「通知 未設定」）", () => {
    expect(currentStep({ ...base, skipped: ["account"] })).toBe("install");
    expect(currentStep({ ...base, account: "hidden", installDone: true, notify: "off" })).toBe("notify");
    expect(setupVisible({ ...base, account: "hidden", installDone: true, notify: "off" }, false)).toBe(true);
  });

  it("災害モード（compact）はホーム画面か通知がまだで押せる・案内できる時だけ（未設定・非対応だけなら出さない）", () => {
    expect(setupVisible({ ...base, installDone: true, notify: "todo" }, true)).toBe(true);
    expect(setupVisible({ ...base, installDone: true, notify: "off" }, true)).toBe(false);
    expect(setupVisible({ ...base, installDone: true, notify: "unsupported" }, true)).toBe(false);
    expect(setupVisible({ ...base, installDone: false, notify: "done" }, true)).toBe(true);
  });

  it("購読の鍵のバイト列と、鍵を替えたかの比べ", async () => {
    const e = await testVapidEnv();
    const bytes = keyBytes(e.VAPID_PUBLIC_KEY);
    expect(bytes.length).toBe(65);
    expect(sameKey(bytes.buffer, e.VAPID_PUBLIC_KEY)).toBe(true);
    expect(sameKey(keyBytes((await testVapidEnv()).VAPID_PUBLIC_KEY).buffer, e.VAPID_PUBLIC_KEY)).toBe(false);
    expect(sameKey(null, e.VAPID_PUBLIC_KEY)).toBe(false);
  });
});

describe("通知の購読と送る時（偽の送り先）", () => {
  let vapid: Vapid;
  beforeAll(async () => {
    vapid = (await loadVapid(await testVapidEnv()))!;
  });

  type Sent = { url: string; body: Uint8Array };
  function fakeFetch(status = 201) {
    const sent: Sent[] = [];
    const fn: PushFetch = async (url, init) => {
      sent.push({ url, body: init.body as Uint8Array });
      return new Response(null, { status });
    };
    return { sent, fn };
  }
  const sub = async (n: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: (await testReceiver()).json });

  async function disaster() {
    expect(await switchDisasterMode(db, disasterScope(cm())!, { kind: "heavy_rain", version: 0, at: ISO(NOW - 60) })).toMatchObject({
      ok: true,
    });
  }

  it("購読: 本人・家族の役だけ、本人と連絡先はセッションから。端末の値は確かめて入れる", async () => {
    const { principal } = await linkSession();
    expect(await subscribePost(db, null, await sub("a"), ISO(NOW))).toEqual({ ok: false, error: "login_required" });
    expect(await subscribePost(db, cm(), await sub("a"), ISO(NOW))).toEqual({ ok: false, error: "forbidden" });
    expect(await subscribePost(db, principal, { endpoint: "https://example.com/x", keys: (await testReceiver()).json }, ISO(NOW))).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(await subscribePost(db, principal, await sub("a"), ISO(NOW))).toEqual({ ok: true });
    const row = one<{ person_id: string; contact_id: string | null; link_generation: number | null }>("SELECT * FROM push_subscriptions");
    expect(row).toMatchObject({ person_id: "p-01", contact_id: null, link_generation: 1 });
    // 同じ端末を家族の役で入れ直すと、後勝ちで持ち主が替わる（1 行のまま）
    const fam = await linkSession("p-01", "c-01-1");
    const same = { endpoint: "https://fcm.googleapis.com/fcm/send/a", keys: (await testReceiver()).json };
    expect(await subscribePost(db, fam.principal, same, ISO(NOW))).toEqual({ ok: true });
    expect(one<{ n: number; c: string }>("SELECT count(*) AS n, max(contact_id) AS c FROM push_subscriptions")).toEqual({ n: 1, c: "c-01-1" });
    // 外す（本人の物だけ）
    expect(await unsubscribePost(db, fam.principal, { endpoint: same.endpoint })).toEqual({ ok: true });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM push_subscriptions").n).toBe(0);
  });

  it("審査員の本人スマホの役で購読し、ケアマネの役で安否確認を送ると届く（中身は固定の文）", async () => {
    await disaster();
    const judgeSelf = await judgeAs("self");
    const r = await testReceiver();
    expect(await subscribePost(db, judgeSelf, { endpoint: "https://fcm.googleapis.com/fcm/send/j", keys: r.json }, ISO(NOW))).toEqual({ ok: true });
    expect(one<{ g: number | null }>("SELECT link_generation AS g FROM push_subscriptions").g).toBeNull();
    const judgeCm = await judgeAs("care_manager");
    const { sent, fn } = fakeFetch();
    const res = await safetyPost(db, vapid, fn, judgeCm, "p-01", NOW);
    expect(res).toEqual({ ok: true, sent: 1, total: 1 });
    expect(safetyLabel(res)).toBe("送信 1");
    expect(sent.map((s) => s.url)).toEqual(["https://fcm.googleapis.com/fcm/send/j"]);
    // 経過に 1 行（名前・端末は書かない）
    const log = one<{ body: string; kind: string; payload: string }>(
      "SELECT body, kind, payload FROM timeline_entries WHERE person_id = 'p-01' AND json_extract(payload, '$.source') = 'push'",
    );
    expect(log).toMatchObject({ body: "安否確認 通知", kind: "note" });
    expect(JSON.parse(log.payload)).toEqual({ source: "push", sent: 1, total: 1 });
    expect(one<{ t: string | null }>("SELECT last_sent_at AS t FROM push_subscriptions").t).not.toBeNull();
  });

  it("安否確認: ケアマネだけ・壁の中だけ・平時は送らない・鍵が無ければ未設定・1 分に 1 回・通知先なし", async () => {
    const { principal } = await linkSession();
    await subscribePost(db, principal, await sub("a"), ISO(NOW));
    const { sent, fn } = fakeFetch();
    expect(await safetyPost(db, vapid, fn, null, "p-01", NOW)).toEqual({ ok: false, error: "login_required" });
    expect(await safetyPost(db, vapid, fn, principal, "p-01", NOW)).toEqual({ ok: false, error: "forbidden" });
    const medical = cm({ role: "medical", admin: false, caseloadOf: null, office: null });
    expect(await safetyPost(db, vapid, fn, medical, "p-01", NOW)).toEqual({ ok: false, error: "forbidden" });
    const partner = cm({ office: { id: "office-partner", name: "協力事業所", kind: "partner" }, accountId: "acct-partner-cm", caseloadOf: "acct-partner-cm" });
    expect(await safetyPost(db, vapid, fn, partner, "p-01", NOW)).toEqual({ ok: false, error: "not_found" });
    const normal = await safetyPost(db, vapid, fn, cm(), "p-01", NOW);
    expect(normal).toEqual({ ok: false, error: "normal" });
    expect(safetyLabel(normal)).toBe("平時 不可");
    await disaster();
    const off = await safetyPost(db, null, fn, cm(), "p-01", NOW);
    expect(off).toEqual({ ok: false, error: "not_configured" });
    expect(safetyLabel(off)).toBe("通知 未設定");
    expect(sent).toHaveLength(0);
    expect(await safetyPost(db, vapid, fn, cm(), "p-01", NOW)).toEqual({ ok: true, sent: 1, total: 1 });
    const wait = await safetyPost(db, vapid, fn, cm(), "p-01", NOW + 30);
    expect(wait).toEqual({ ok: false, error: "wait" });
    expect(safetyLabel(wait)).toBe("送信済 待機");
    expect(await safetyPost(db, vapid, fn, cm(), "p-01", NOW + 61)).toEqual({ ok: true, sent: 1, total: 1 });
    const none = await safetyPost(db, vapid, fn, cm(), "p-02", NOW);
    expect(none).toEqual({ ok: true, sent: 0, total: 0 });
    expect(safetyLabel(none)).toBe("通知先なし");
  });

  it("無くなった購読（410）は消し、再発行のあとはリンクで入れた購読に送らない", async () => {
    await disaster();
    const { principal } = await linkSession();
    await subscribePost(db, principal, await sub("a"), ISO(NOW));
    const gone = fakeFetch(410);
    expect(await safetyPost(db, vapid, gone.fn, cm(), "p-01", NOW)).toEqual({ ok: true, sent: 0, total: 1 });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM push_subscriptions").n).toBe(0);
    await subscribePost(db, principal, await sub("b"), ISO(NOW));
    expect(await liveSubscriptionsOf(db, "p-01")).toHaveLength(1);
    await issuePhoneLink(db, ISSUER, "p-01", ISO(NOW + 60));
    expect(await liveSubscriptionsOf(db, "p-01")).toHaveLength(0);
  });

  it("届いた中身を受け手の鍵で戻すと、本人には「大丈夫ですか」と /me、家族には /family（名前は無い）", async () => {
    await disaster();
    const self = await linkSession();
    const fam = await linkSession("p-01", "c-01-1");
    const rs = await testReceiver();
    const rf = await testReceiver();
    await subscribePost(db, self.principal, { endpoint: "https://fcm.googleapis.com/fcm/send/s", keys: rs.json }, ISO(NOW));
    await subscribePost(db, fam.principal, { endpoint: "https://fcm.googleapis.com/fcm/send/f", keys: rf.json }, ISO(NOW));
    const { sent, fn } = fakeFetch();
    expect(await safetyPost(db, vapid, fn, cm(), "p-01", NOW)).toEqual({ ok: true, sent: 2, total: 2 });
    // 中身の暗号は lib/push/push.test.ts で戻して確かめる。ここは送り先ごとに違う本文（受け手ごとに包む）であること
    expect(sent).toHaveLength(2);
    expect(Buffer.from(sent[0].body).equals(Buffer.from(sent[1].body))).toBe(false);
    for (const m of [pushMessage("self"), pushMessage("family")]) {
      expect(JSON.stringify(m)).not.toContain("山田");
    }
  });

  it("災害モードに入った時だけ事業所の全員へ送る（大雨 → 地震の切替・平時に戻すは送らない）", async () => {
    const { principal } = await linkSession();
    await subscribePost(db, principal, await sub("a"), ISO(NOW));
    const form = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    const first = await modePostEntered(db, cm(), form({ kind: "heavy_rain", version: "0" }), ISO(NOW));
    expect(first).toEqual({ outcome: { status: 303, location: "/office" }, entered: "office-demo" });
    const again = await modePostEntered(db, cm(), form({ kind: "earthquake", version: "1" }), ISO(NOW + 60));
    expect(again.entered).toBeNull();
    expect((await modePostEntered(db, principal, form({ kind: "earthquake", version: "2" }), ISO(NOW + 120))).entered).toBeNull();
    const { sent, fn } = fakeFetch();
    expect(await officeSafety(db, vapid, fn, "office-demo", NOW)).toEqual({ sent: 1, total: 1 });
    expect(sent).toHaveLength(1);
    expect(await officeSafety(db, null, fn, "office-demo", NOW)).toEqual({ sent: 0, total: 0 });
  });
});

describe("Service Worker の通知（lib/offline/sw-core.js）", () => {
  it("中身の文と押した先。読めない・決まりの外の道は固定の文と /me", () => {
    expect(notificationOf(JSON.stringify(pushMessage("family")))).toEqual({
      title: "ケア72",
      body: "ご本人は 大丈夫ですか",
      url: "/family",
      tag: "care72-safety",
    });
    expect(notificationOf("{")).toEqual(NOTIFY_DEFAULT);
    expect(notificationOf(null)).toEqual(NOTIFY_DEFAULT);
    expect(notificationOf(JSON.stringify({ t: "x", b: "y", u: "https://example.com/" })).url).toBe("/me");
    expect(notificationOf(JSON.stringify({ t: "x".repeat(41), b: "y", u: "/me" })).title).toBe("ケア72");
    expect(notifyTarget("/family")).toBe("/family");
    expect(notifyTarget("//evil.example/")).toBe("/me");
    expect(notifyTarget(undefined)).toBe("/me");
  });

  it("public/sw.js に push と notificationclick がある", () => {
    const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
  });
});

describe("migration 0035", () => {
  it("本人用の ID は 1 本人に 1 つ（連絡先なしの重なりも断る）。購読の endpoint は 1 行", () => {
    const ins = (id: string, login: string, contact: string | null) =>
      sqlite
        .prepare(
          `INSERT INTO phone_accounts (id, person_id, contact_id, login_id, password_hash, link_generation, link_issued_at, created_at, updated_at)
           VALUES (?, 'p-01', ?, ?, 'h', 1, 't', 't', 't')`,
        )
        .run(id, contact, login);
    ins("a1", "aaa", null);
    expect(() => ins("a2", "bbb", null)).toThrow();
    ins("a3", "ccc", "c-01-1");
    expect(() => ins("a4", "aaa", "c-01-1")).toThrow();
    // 連絡先を消すと一緒に消える
    sqlite.prepare("DELETE FROM contacts WHERE id = 'c-01-1'").run();
    expect(one<{ n: number }>("SELECT count(*) AS n FROM phone_accounts").n).toBe(1);
  });
});
