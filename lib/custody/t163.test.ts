// T163: 医療班への受入依頼。ケアマネが送る → 医療班の一覧 → 受入・受入不可 → 本人のページの返事。
// 同意の無い人は送れない・受け入れる前は本人確認の範囲だけ・受入は今の受け入れ（受け持ち・提供の記録・経過）を通す・審査員の壁・
// 種の発災開始でルールの表の連絡順の上から依頼が入り、戻しで消える。
// D1 は node:sqlite に種の全部（seed/full.ts）と、審査員でない医療班・行政のアカウント（テストだけ）。パスワードはテストだけの値。

import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
import { fullSeedStatements } from "../../seed/full.ts";
import { RequestSection } from "../../components/person/RequestSection.tsx";
import { StaffRequests } from "../../components/staff/StaffRequests.tsx";
import { CHECK_OFFICE_ID, DEMO_OFFICE_ID, JUDGE_ACCOUNTS, LOGIN_CARE_MANAGER_ID, checkSeedId } from "../auth/demo.ts";
import { hashPassword } from "../auth/password.ts";
import { chooseRole, login, type Principal } from "../auth/principal.ts";
import { personInScope } from "../auth/scope.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadDisasterState } from "../disaster/db.ts";
import { loadForm9, loadSituation } from "../forms/form9-db.ts";
import { officeActor } from "../office/scope.ts";
import { resetPost, startPost } from "../seed/http.ts";
import type { SeedBucket } from "../seed/reset.ts";
import { SEED_REQUEST_MAX, seedRequestId } from "../seed/requests.ts";
import { staffActor } from "./actor.ts";
import { loadStaffBoard } from "./board.ts";
import { REQUEST_LABELS, SHOWN_VIA_LABELS } from "./labels.ts";
import { openCustodyOf } from "./received.ts";
import { replyRequestPost, sendRequestPost, withdrawRequestPost } from "./request-http.ts";
import { acceptRequest, declineRequest, latestRequestOf, openRequests, requestPanelOf, sendRequest } from "./requests.ts";

const SECRET = "test-secret-t163-0123456789-0123456789-abcdef";
const NOW_SEC = 1_800_000_000;
const SEED_NOW = "2026-11-06T00:00:00.000Z";
const AT = "2026-11-06T02:00:00.000Z";
const LATER = "2026-11-06T02:30:00.000Z";
const TODAY = "2026-11-06";
const SHELTER = "かわなぎ小学校";
const JUDGE_PW = "test-judge-pass-t163";
const CM_PW = "test-cm-pass-t163";

let judgeHash: string;
let statements: string[];
beforeAll(async () => {
  let cmHash: string;
  [judgeHash, cmHash] = await Promise.all([JUDGE_PW, CM_PW].map((pw) => hashPassword(pw, { iterations: 1000 })));
  statements = await fullSeedStatements({ now: SEED_NOW, passwordHashes: { [LOGIN_CARE_MANAGER_ID]: cmHash } });
}, 60_000);

let sqlite: DatabaseSync;
let db: D1Database;
const env = () => ({ JUDGE_PASSWORD_HASH: judgeHash });

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const x of statements) sqlite.exec(x);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-2', NULL, 'medical', '医療班 2')`).run();
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-gov-2', NULL, 'government', '行政 2')`).run();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const bucket = (): SeedBucket => ({ head: async () => null, list: async () => ({ objects: [], truncated: false }), delete: async () => {} });
const form = (fields: Record<string, string>) => ({ get: (k: string) => fields[k] ?? null, getAll: (k: string) => (k in fields ? [fields[k]!] : []) });

async function judgeAs(role: "care_manager" | "medical", n: 1 | 2 | 3 = 1): Promise<Principal> {
  const r = await login(db, env(), SECRET, { loginId: JUDGE_ACCOUNTS[n - 1].loginId, password: JUDGE_PW }, NOW_SEC);
  if (!r.ok) throw new Error("ログインできない");
  const c = await chooseRole(db, env(), SECRET, r.token, role, NOW_SEC);
  if (!c) throw new Error("役を選べない");
  return c.principal;
}
async function yamamotoAs(role: "care_manager" | "medical"): Promise<Principal> {
  const r = await login(db, env(), SECRET, { loginId: "yamamoto", password: CM_PW }, NOW_SEC);
  if (!r.ok) throw new Error("ログインできない");
  if (role === "care_manager" && r.principal.role === "care_manager") return r.principal;
  const c = await chooseRole(db, env(), SECRET, r.token, role, NOW_SEC);
  if (!c) throw new Error("役を選べない");
  return c.principal;
}
const plainStaff = (role: "medical" | "government"): Principal => ({
  role,
  judge: false,
  admin: false,
  accountId: role === "medical" ? "acct-med-2" : "acct-gov-2",
  displayName: role === "medical" ? "医療班 2" : "行政 2",
  office: null,
  caseloadOf: null,
  personId: null,
  contactId: null,
});

const count = (sql: string, ...args: string[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;
const cm = async () => officeActor(await judgeAs("care_manager"))!;

async function start(p: Principal, at = AT) {
  const version = (await loadDisasterState(db, p.office!.id)).version;
  return startPost(db, bucket(), p, form({ version: String(version) }), at);
}

describe("T163 送る（ケアマネ）", () => {
  it("医療班への提供に同意のある人だけ送れる。不同意・未確認は consent、依頼中が既にあれば pending、事業所の外は not_found", async () => {
    const a = await cm();
    expect(await sendRequest(db, a, { personId: "p-01", shelter: SHELTER }, AT)).toMatchObject({ ok: true });
    expect(await sendRequest(db, a, { personId: "p-01", shelter: SHELTER }, LATER)).toEqual({ ok: false, error: "pending" });
    // p-09 は医療班への提供に同意していない（種）
    expect(await sendRequest(db, a, { personId: "p-09", shelter: SHELTER }, AT)).toEqual({ ok: false, error: "consent" });
    sqlite.prepare("UPDATE consents SET status = 'unconfirmed' WHERE person_id = 'p-02' AND kind = 'medical'").run();
    expect(await sendRequest(db, a, { personId: "p-02", shelter: SHELTER }, AT)).toEqual({ ok: false, error: "consent" });
    // 確認用の事業所の人はデモ事業所のケアマネから見えない
    expect(await sendRequest(db, a, { personId: checkSeedId("p-03"), shelter: SHELTER }, AT)).toEqual({ ok: false, error: "not_found" });
    expect(count("SELECT count(*) AS n FROM custody_requests")).toBe(1);
  });

  it("受け口: ケアマネの役だけ。医療班は 403、ログインなしは 401、行き先が空は断る", async () => {
    const cmP = await judgeAs("care_manager");
    expect((await sendRequestPost(db, null, { personId: "p-01", shelter: SHELTER }, AT)).status).toBe(401);
    expect((await sendRequestPost(db, plainStaff("medical"), { personId: "p-01", shelter: SHELTER }, AT)).status).toBe(403);
    expect((await sendRequestPost(db, cmP, { personId: "p-01", shelter: "  " }, AT)).status).toBe(400);
    const ok = await sendRequestPost(db, cmP, { personId: "p-01", shelter: SHELTER }, AT);
    expect(ok.status).toBe(200);
    // 応答に人の物を入れない
    expect(JSON.stringify(ok.body)).not.toMatch(/山田|ヤマダ/);
    expect((await sendRequestPost(db, cmP, { personId: "p-09", shelter: SHELTER }, AT)).body).toMatchObject({ error: "consent", label: "同意なし" });
    expect((await withdrawRequestPost(db, cmP, { requestId: ok.body.requestId }, LATER)).status).toBe(200);
    expect((await latestRequestOf(db, "p-01"))?.state).toBe("withdrawn");
  });
});

describe("T163 医療班の一覧と返事", () => {
  it("一覧は医療班の役だけ。行政は空。行はカナ・年齢・依頼元・行き先・時刻だけ（漢字の氏名・薬・機器を持たない）", async () => {
    await sendRequest(db, await cm(), { personId: "p-01", shelter: SHELTER }, AT);
    const med = staffActor(plainStaff("medical"))!;
    const list = await openRequests(db, med, TODAY);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!).sort()).toEqual(["age", "id", "kana", "office", "personId", "requestedAt", "shelter"]);
    expect(list[0]).toMatchObject({ kana: "ヤマダ ハナ", shelter: SHELTER, office: "デモ事業所" });
    expect(JSON.stringify(list)).not.toMatch(/山田|酸素|ワーファリン|090-/);
    expect(await openRequests(db, staffActor(plainStaff("government"))!, TODAY)).toEqual([]);
    expect((await replyRequestPost(db, plainStaff("government"), { requestId: list[0]!.id, answer: "accept" }, LATER)).status).toBe(403);
  });

  it("審査員の医療班はデモ事業所の人の依頼だけ、役を替えた山本は確認用の事業所の人の依頼だけ", async () => {
    await sendRequest(db, await cm(), { personId: "p-01", shelter: SHELTER }, AT);
    const chkCm = officeActor(await yamamotoAs("care_manager"))!;
    await sendRequest(db, chkCm, { personId: checkSeedId("p-01"), shelter: SHELTER }, AT);
    const judge = staffActor(await judgeAs("medical"))!;
    const yama = staffActor(await yamamotoAs("medical"))!;
    expect((await openRequests(db, judge, TODAY)).map((r) => r.personId)).toEqual(["p-01"]);
    expect((await openRequests(db, yama, TODAY)).map((r) => r.personId)).toEqual([checkSeedId("p-01")]);
    // 壁の外の依頼は無いのと同じ
    const other = (await openRequests(db, yama, TODAY))[0]!.id;
    expect(await acceptRequest(db, judge, other, LATER)).toEqual({ ok: false, error: "not_found" });
  });

  it("受入: 受け持ち・提供の記録（同意）・経過の受入を書き、依頼に受け持ちを結ぶ。本人のページを開ける。2 回目は answered", async () => {
    const sent = await sendRequest(db, await cm(), { personId: "p-01", shelter: SHELTER }, AT);
    if (!sent.ok) throw new Error("送れない");
    const p = plainStaff("medical");
    const med = staffActor(p)!;
    expect(await personInScope(db, p, "p-01")).toBeNull();
    const r = await replyRequestPost(db, p, { requestId: sent.requestId, answer: "accept" }, LATER);
    expect(r.status).toBe(200);
    const custodyId = r.body.custodyId as string;
    expect(custodyId).toMatch(/^cu-/);
    expect(sqlite.prepare("SELECT holder_id, shelter FROM custody WHERE id = ?").get(custodyId)).toMatchObject({ holder_id: "acct-med-2", shelter: SHELTER });
    expect(sqlite.prepare("SELECT basis, custody_id FROM third_party_provisions WHERE person_id = 'p-01'").get()).toMatchObject({ basis: "consent", custody_id: custodyId });
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = 'p-01' AND kind = 'received'")).toBe(1);
    expect(sqlite.prepare("SELECT state, custody_id, replied_by FROM custody_requests WHERE id = ?").get(sent.requestId)).toEqual({
      state: "accepted",
      custody_id: custodyId,
      replied_by: "acct-med-2",
    });
    expect(await personInScope(db, p, "p-01")).not.toBeNull();
    expect(await openRequests(db, med, TODAY)).toEqual([]);
    expect(await acceptRequest(db, med, sent.requestId, LATER)).toEqual({ ok: false, error: "answered" });
    // 事業所の側の返事: 受入済と医療班の名前
    expect(await latestRequestOf(db, "p-01")).toMatchObject({ state: "accepted", repliedName: "医療班 2", repliedAt: LATER });
    // 受入一覧と受け入れた人の画面の入り方は「依頼」（表の via は search のまま）
    const board = await loadStaffBoard(db, med, TODAY, LATER);
    expect(board.rows.map((x) => [x.personId, x.via])).toEqual([["p-01", "request"]]);
    expect(SHOWN_VIA_LABELS[board.rows[0]!.via]).toBe("依頼");
    expect((await openCustodyOf(db, med, "p-01"))?.via).toBe("request");
  });

  it("もう自分が受け入れている人の依頼は、その受け持ちを結ぶ。送ったあとに同意が変わった人は受け入れない", async () => {
    const a = await cm();
    const med = staffActor(plainStaff("medical"))!;
    const one = await sendRequest(db, a, { personId: "p-01", shelter: SHELTER }, AT);
    const two = await sendRequest(db, a, { personId: "p-02", shelter: SHELTER }, AT);
    if (!one.ok || !two.ok) throw new Error("送れない");
    const { receive } = await import("./store.ts");
    const pre = await receive(db, med, { personId: "p-01", shelter: SHELTER, via: "search" }, AT);
    if (!pre.ok) throw new Error("受け入れられない");
    expect(await acceptRequest(db, med, one.requestId, LATER)).toEqual({ ok: true, personId: "p-01", custodyId: pre.custodyId });
    sqlite.prepare("UPDATE consents SET status = 'refused' WHERE person_id = 'p-02' AND kind = 'medical'").run();
    expect(await acceptRequest(db, med, two.requestId, LATER)).toEqual({ ok: false, error: "consent" });
    expect((await latestRequestOf(db, "p-02"))?.state).toBe("open");
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = 'p-02'")).toBe(0);
  });

  it("受入不可: 依頼から消え、本人のページに受入不可。受け持ちは作らない。送り直せる", async () => {
    const a = await cm();
    const sent = await sendRequest(db, a, { personId: "p-01", shelter: SHELTER }, AT);
    if (!sent.ok) throw new Error("送れない");
    const med = staffActor(plainStaff("medical"))!;
    expect(await declineRequest(db, med, sent.requestId, LATER)).toMatchObject({ ok: true });
    expect(await openRequests(db, med, TODAY)).toEqual([]);
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = 'p-01'")).toBe(0);
    const panel = await requestPanelOf(db, "p-01", SHELTER);
    expect(panel).toMatchObject({ canSend: true, latest: { state: "declined", repliedName: "医療班 2" } });
    expect(await sendRequest(db, a, { personId: "p-01", shelter: SHELTER }, LATER)).toMatchObject({ ok: true });
  });
});

describe("T163 画面", () => {
  it("医療班の一覧は返事の 2 つだけ（自由文の欄なし）。漢字の氏名を出さない。依頼が無ければ面を出さない", async () => {
    await sendRequest(db, await cm(), { personId: "p-01", shelter: SHELTER }, AT);
    const list = await openRequests(db, staffActor(plainStaff("medical"))!, TODAY);
    const html = renderToStaticMarkup(createElement(StaffRequests, { requests: list }));
    expect(html).toContain(REQUEST_LABELS.list);
    expect(html).toContain(`>${REQUEST_LABELS.accept}<`);
    expect(html).toContain(`>${REQUEST_LABELS.decline}<`);
    // 文の欄は無い。入れられるのは選ぶ欄と、一括受入の避難所の 1 つだけ（T172）
    expect(html).not.toContain("<textarea");
    const inputs = [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]);
    expect(inputs.filter((i) => !i.includes('type="checkbox"'))).toHaveLength(1);
    expect(inputs.filter((i) => !i.includes('type="checkbox"'))[0]).toContain('data-field="bulk-shelter"');
    expect(html).not.toContain("山田");
    expect(renderToStaticMarkup(createElement(StaffRequests, { requests: [] }))).toBe("");
  });

  it("本人のページ: 同意の無い人は「同意なし」だけで送れない。依頼中は取消、返事は状態の言葉", async () => {
    const none = await requestPanelOf(db, "p-09", "");
    const a = renderToStaticMarkup(createElement(RequestSection, { personId: "p-09", panel: none, level: 1 }));
    expect(a).toContain(REQUEST_LABELS.noConsent);
    expect(a).not.toContain(REQUEST_LABELS.send);
    const fresh = renderToStaticMarkup(createElement(RequestSection, { personId: "p-01", panel: await requestPanelOf(db, "p-01", SHELTER), level: 1 }));
    expect(fresh).toContain(REQUEST_LABELS.send);
    expect(fresh).toContain(`value="${SHELTER}"`);
    await sendRequest(db, await cm(), { personId: "p-01", shelter: SHELTER }, AT);
    const open = renderToStaticMarkup(createElement(RequestSection, { personId: "p-01", panel: await requestPanelOf(db, "p-01", SHELTER), level: 1 }));
    expect(open).toContain("依頼中");
    expect(open).toContain(REQUEST_LABELS.withdraw);
    expect(open).not.toContain(REQUEST_LABELS.send);
  });
});

describe("T163 種の発災開始", () => {
  it("発災開始で、連絡順の上から赤・黄で同意のある人の依頼が入る（山田の赤を含む、同意なしの人は入らない）。審査員の医療班に出る", async () => {
    expect(count("SELECT count(*) AS n FROM custody_requests")).toBe(0);
    const p = await judgeAs("care_manager");
    expect((await start(p)).outcome).toMatchObject({ status: 303 });
    const rows = sqlite.prepare("SELECT person_id, seed, state, requested_at FROM custody_requests WHERE office_id = ? ORDER BY requested_at").all(DEMO_OFFICE_ID) as Array<{ person_id: string; seed: number; state: string; requested_at: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(SEED_REQUEST_MAX);
    expect(rows.map((r) => r.person_id)).toContain("p-01");
    expect(rows.map((r) => r.person_id)).not.toContain("p-09");
    expect(rows.every((r) => r.seed === 1 && r.state === "open" && r.requested_at < AT)).toBe(true);
    // 連絡順（様式 9 の自動の順位）の順に古い
    const s = await loadSituation(db, DEMO_OFFICE_ID, AT);
    const sheet = (await loadForm9(db, { officeId: DEMO_OFFICE_ID }, { today: TODAY, situation: s }))!.sheet;
    const rank = new Map(sheet.rows.map((r) => [r.id, r]));
    const ranks = rows.map((r) => rank.get(r.person_id)!.autoRank);
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
    expect(rows.every((r) => ["red", "yellow"].includes(rank.get(r.person_id)!.color ?? ""))).toBe(true);
    // 審査員の医療班の受入一覧に出る。確認用の事業所には入らない
    const judge = staffActor(await judgeAs("medical", 2))!;
    expect((await openRequests(db, judge, TODAY)).map((r) => r.personId)).toEqual(rows.map((r) => r.person_id));
    expect(count("SELECT count(*) AS n FROM custody_requests WHERE office_id = ?", CHECK_OFFICE_ID)).toBe(0);
  });

  it("受け入れたあと最初に戻すと依頼も受け持ちも消える。もう一度の発災開始で二重にしない", async () => {
    const p = await judgeAs("care_manager");
    await start(p);
    const judge = staffActor(await judgeAs("medical"))!;
    const first = (await openRequests(db, judge, TODAY))[0]!;
    expect(await acceptRequest(db, judge, first.id, LATER)).toMatchObject({ ok: true });
    const n = count("SELECT count(*) AS n FROM custody_requests WHERE office_id = ?", DEMO_OFFICE_ID);
    // 平時に戻さずにもう一度押しても入らない（災害モードの間は断る）。戻したあとの発災開始は種の依頼を入れ直す
    await resetPost(db, bucket(), p, form({ confirm: "1" }), LATER);
    expect(count("SELECT count(*) AS n FROM custody_requests WHERE office_id = ?", DEMO_OFFICE_ID)).toBe(0);
    expect(count("SELECT count(*) AS n FROM custody WHERE holder_id = 'acct-judge' AND released_at IS NULL")).toBe(0);
    await start(p, LATER);
    await start(p, LATER);
    expect(count("SELECT count(*) AS n FROM custody_requests WHERE office_id = ?", DEMO_OFFICE_ID)).toBe(n);
    expect(count("SELECT count(*) AS n FROM custody_requests WHERE id = ?", seedRequestId("p-01"))).toBe(1);
  });

  it("確認用の事業所（山本）の発災開始は確認用の人の依頼を入れ、役を替えた山本の医療班に出る", async () => {
    const p = await yamamotoAs("care_manager");
    await start(p);
    const yama = staffActor(await yamamotoAs("medical"))!;
    const list = await openRequests(db, yama, TODAY);
    expect(list.map((r) => r.personId)).toContain(checkSeedId("p-01"));
    expect(list.every((r) => r.personId.startsWith("chk-"))).toBe(true);
  });
});
