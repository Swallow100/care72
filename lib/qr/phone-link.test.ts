// T69a: 本人・家族のスマホ入口。署名つきのリンク（lib/qr/phone-link.ts）、版と発行（phone-link-store.ts）、
// 開く口（phone-open.ts。app/s/[token]/route.ts の中身）、開いたあとのセッション（lib/auth の link の形）で、
// 本人・家族が今の信号・答え・録音の API をそのまま使えること。D1 は node:sqlite に種の 10 人。Claude は呼ばない。

import type { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { readCookie, SESSION_COOKIE } from "../auth/cookie.ts";
import { resolvePrincipal, type Principal } from "../auth/principal.ts";
import { LINK_SESSION_PV, signSession, verifySession } from "../auth/session.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { NO_ANSWERS, type FamilySignalBody, type SignalBody } from "../signals/body.ts";
import { answersPost, recordingPost, signalPost } from "../signals/http.ts";
import { setUnlisted } from "../office/people.ts";
import { resetDemoOffice, type SeedBucket } from "../seed/reset.ts";
import { retractableRow } from "../timeline/retract.ts";
import { issueQr } from "./store.ts";
import { signQrToken, qrTimes } from "./token.ts";
import {
  PHONE_LINK_INVALID_PATH,
  PHONE_LINK_TTL_DAYS,
  PHONE_LINK_TTL_SEC,
  phoneLinkTimes,
  phoneLinkUrl,
  signPhoneLink,
  verifyPhoneLink,
  type PhoneLinkPayload,
} from "./phone-link.ts";
import {
  currentPhoneLinkToken,
  issuePhoneLink,
  loadPhoneLinkRow,
  PHONE_LINK_LOG,
  PHONE_LINK_SOURCE,
  phoneLinkState,
  resolvePhoneLink,
} from "./phone-link-store.ts";
import {
  linkReplacesLogin,
  openPhoneLink,
  PHONE_OPEN_HEADERS,
  phoneLinkOpenPath,
  phoneLinkSwitchPath,
  switchPhoneLink,
} from "./phone-open.ts";

const SECRET = "test-secret-for-phone-link-0123456789abcdef";
const DAY = 24 * 60 * 60;
/** 発災 2026-11-04 10:00 JST。発行はその 1 日前 */
const QUAKE = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(QUAKE + h * 3_600_000).toISOString();
const ISSUED_ISO = at(-24);
const ISSUED = Math.floor(Date.parse(ISSUED_ISO) / 1000);
const NOW = ISSUED + 3600;
const ISSUER = { officeId: "office-demo", authorId: "acct-yamamoto" };

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const one = <T>(sql: string, ...args: Array<string | number | null>) => sqlite.prepare(sql).get(...args) as T;

/** 同じ鍵で署名だけ合わせた偽物（signPhoneLink が作らない物を作る） */
async function forge(p: object, prefix = "care72-phone-v1:"): Promise<string> {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${prefix}${body}`));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

/** p-01 に発行して、本人用（contactId null）か家族用のトークン */
async function issued(personId = "p-01", contactId: string | null = null, nowIso = ISSUED_ISO): Promise<string> {
  const row = await issuePhoneLink(db, ISSUER, personId, nowIso);
  if (!row) throw new Error("発行できない");
  const t = await currentPhoneLinkToken(personId, contactId, row, SECRET);
  if (!t) throw new Error("トークンが無い");
  return t;
}

const req = (url = "http://localhost:3072/s/x") => new Request(url);

/** 開く口に渡して、cookie の値と応答 */
async function open(token: string, now = NOW, url?: string) {
  const res = await openPhoneLink(req(url), db, SECRET, token, now);
  const set = res.headers.get("set-cookie");
  return { res, set, cookie: set ? readCookie(set, SESSION_COOKIE) : null, location: res.headers.get("location") };
}

describe("リンクのトークン", () => {
  it("本人用と家族用の往復。期限は 180 日で、直前まで通り、ちょうどで通らない", async () => {
    expect(PHONE_LINK_TTL_DAYS).toBe(180);
    for (const c of [null, "c-01-1"]) {
      const p: PhoneLinkPayload = { v: 1, p: "p-01", c, g: 1, ...phoneLinkTimes(ISSUED) };
      expect(p.exp - p.iat).toBe(180 * DAY);
      const t = await signPhoneLink(p, SECRET);
      expect(await verifyPhoneLink(t, SECRET, ISSUED + 180 * DAY - 1)).toEqual(p);
      expect(await verifyPhoneLink(t, SECRET, ISSUED + 180 * DAY)).toBeNull();
    }
  });

  it("期限なし・0 日・180 日より長い物は作らない。署名だけ合わせた 181 日・期限なしも通さない", async () => {
    const base = { v: 1 as const, p: "p-01", c: null, g: 1, iat: ISSUED };
    await expect(signPhoneLink({ ...base, exp: ISSUED + 180 * DAY + 1 }, SECRET)).rejects.toThrow();
    await expect(signPhoneLink({ ...base, exp: ISSUED }, SECRET)).rejects.toThrow();
    await expect(signPhoneLink(base as unknown as PhoneLinkPayload, SECRET)).rejects.toThrow();
    expect(await verifyPhoneLink(await forge({ ...base, exp: ISSUED + 181 * DAY }), SECRET, NOW)).toBeNull();
    expect(await verifyPhoneLink(await forge(base), SECRET, NOW)).toBeNull();
    expect(await verifyPhoneLink(await forge({ ...base, exp: ISSUED + 10 * DAY }), SECRET, NOW)).not.toBeNull();
  });

  it("中身は本人の id・連絡先の id・版・時刻だけ。氏名・カナ・生年月日・電話を足した物は通さない", async () => {
    const t = await issued("p-01", "c-01-1");
    const json = JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(Object.keys(json).sort()).toEqual(["c", "exp", "g", "iat", "p", "v"]);
    for (const word of ["山田", "ヤマダ", "1940", "090-"]) expect(t + JSON.stringify(json)).not.toContain(word);
    const base = { v: 1, p: "p-01", c: null, g: 1, ...phoneLinkTimes(ISSUED) };
    expect(await verifyPhoneLink(await forge({ ...base, name: "山田 ハナ" }), SECRET, NOW)).toBeNull();
    expect(await verifyPhoneLink(await forge({ ...base, phone: "090-0000-0001" }), SECRET, NOW)).toBeNull();
  });

  it("ほかの鍵・書き換え・形の違う物は通さない。QR のトークンとセッションの cookie とも取り違えない", async () => {
    const p: PhoneLinkPayload = { v: 1, p: "p-01", c: null, g: 1, ...phoneLinkTimes(ISSUED) };
    const t = await signPhoneLink(p, SECRET);
    expect(await verifyPhoneLink(t, "another-secret-0123456789-abcdefghij", NOW)).toBeNull();
    const [body, sig] = t.split(".");
    const other = Buffer.from(JSON.stringify({ ...p, p: "p-02" })).toString("base64url");
    expect(await verifyPhoneLink(`${other}.${sig}`, SECRET, NOW)).toBeNull();
    for (const bad of ["", "x", `${body}`, `${body}.${sig}.x`, ".", "a".repeat(600)]) expect(await verifyPhoneLink(bad, SECRET, NOW), bad).toBeNull();
    // QR の頭・頭なし（セッション）で署名した同じ中身は通らない
    expect(await verifyPhoneLink(await forge(p, "care72-qr-v1:"), SECRET, NOW)).toBeNull();
    expect(await verifyPhoneLink(await forge(p, ""), SECRET, NOW)).toBeNull();
    // 本物の QR のトークンとセッションの cookie
    const qr = await signQrToken({ v: 1, p: "p-01", g: 1, ...qrTimes(ISSUED) }, SECRET);
    expect(await verifyPhoneLink(qr, SECRET, NOW)).toBeNull();
    const session = await signSession({ v: 1, k: "judge", r: "self", pv: "x", iat: NOW, exp: NOW + 3600 }, SECRET);
    expect(await verifyPhoneLink(session, SECRET, NOW)).toBeNull();
    // 逆に、スマホ入口のトークンはセッションの cookie として通らない
    expect(await verifySession(t, SECRET, NOW)).toBeNull();
  });

  it("URL は /s/<token>", () => {
    expect(phoneLinkUrl("https://care72.app", "abc.def")).toBe("https://care72.app/s/abc.def");
  });
});

describe("版と発行（migration 0018）", () => {
  it("列は 2 つ。前からある行は版 0・時刻なし。版は 0 より小さくできない", () => {
    const sql = readFileSync(new URL("../../migrations/0018_phone_link.sql", import.meta.url), "utf8");
    expect(sql).toContain("ADD COLUMN phone_link_generation INTEGER NOT NULL DEFAULT 0 CHECK (phone_link_generation >= 0)");
    expect(sql).toContain("ADD COLUMN phone_link_issued_at TEXT");
    const cols = (sqlite.prepare("PRAGMA table_info(people)").all() as Array<{ name: string; dflt_value: unknown; notnull: number }>).filter((c) =>
      c.name.startsWith("phone_link_"),
    );
    expect(cols.map((c) => [c.name, c.notnull, c.dflt_value])).toEqual([
      ["phone_link_generation", 1, "0"],
      ["phone_link_issued_at", 0, null],
    ]);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM people WHERE phone_link_generation <> 0 OR phone_link_issued_at IS NOT NULL").n).toBe(0);
    expect(() => sqlite.exec("UPDATE people SET phone_link_generation = -1 WHERE id = 'p-01'")).toThrow();
  });

  it("発行で版 1、再発行で版 2。台帳の version・updated_at と QR の版は変えない。経過に「スマホ入口 発行」「再発行」", async () => {
    const before = one<Record<string, unknown>>("SELECT version, updated_at, qr_generation FROM people WHERE id = 'p-01'");
    const r1 = await issuePhoneLink(db, ISSUER, "p-01", at(-24));
    expect(r1).toEqual({ phone_link_generation: 1, phone_link_issued_at: at(-24), unlisted_at: null });
    const r2 = await issuePhoneLink(db, { officeId: "office-demo", authorId: "acct-judge" }, "p-01", at(-12));
    expect(r2?.phone_link_generation).toBe(2);
    expect(one("SELECT version, updated_at, qr_generation FROM people WHERE id = 'p-01'")).toEqual(before);
    const log = sqlite
      .prepare("SELECT author_id, author_role, kind, body, payload, occurred_at FROM timeline_entries WHERE person_id = 'p-01' AND payload LIKE '%phone_link%' ORDER BY occurred_at")
      .all() as Array<Record<string, unknown>>;
    expect(log).toEqual([
      {
        author_id: "acct-yamamoto",
        author_role: "care_manager",
        kind: "note",
        body: PHONE_LINK_LOG.issued,
        payload: JSON.stringify({ source: PHONE_LINK_SOURCE, generation: 1 }),
        occurred_at: at(-24),
      },
      {
        author_id: "acct-judge",
        author_role: "care_manager",
        kind: "note",
        body: PHONE_LINK_LOG.reissued,
        payload: JSON.stringify({ source: PHONE_LINK_SOURCE, generation: 2 }),
        occurred_at: at(-12),
      },
    ]);
    expect(PHONE_LINK_LOG).toEqual({ issued: "スマホ入口 発行", reissued: "スマホ入口 再発行" });
    // 仕組みが書いた行なので撤回の対象にしない（payload を持つ。T63 の人が書いた行だけ）
    for (const l of log) expect(retractableRow({ ...(l as Parameters<typeof retractableRow>[0]), retracted_at: null })).toBe(false);
    // 同じ形で payload が無ければ撤回できる行（上の false は payload で落ちている）
    expect(retractableRow({ ...(log[0] as Parameters<typeof retractableRow>[0]), payload: null, retracted_at: null })).toBe(true);
  });

  it("事業所の外の本人・無い本人には書かない", async () => {
    sqlite.exec(
      "INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date) VALUES ('p-partner-1', 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01')",
    );
    expect(await issuePhoneLink(db, ISSUER, "p-partner-1", at(0))).toBeNull();
    expect(await issuePhoneLink(db, ISSUER, "p-99", at(0))).toBeNull();
    expect(one("SELECT phone_link_generation AS g FROM people WHERE id = 'p-partner-1'")).toEqual({ g: 0 });
    expect(one<{ n: number }>("SELECT count(*) AS n FROM timeline_entries WHERE payload LIKE '%phone_link%'").n).toBe(0);
  });

  it("QR を作り直してもスマホ入口は消えず、その逆も", async () => {
    const t = await issued();
    await issueQr(db, "p-01", at(-20));
    expect(await resolvePhoneLink(db, SECRET, t, NOW)).not.toBeNull();
    expect(one("SELECT qr_generation AS q, phone_link_generation AS s FROM people WHERE id = 'p-01'")).toEqual({ q: 1, s: 1 });
  });

  it("状態: 未発行・有効（期限は発行から 180 日）・期限切れ", async () => {
    expect(phoneLinkState({ phone_link_generation: 0, phone_link_issued_at: null }, NOW).status).toBe("none");
    const row = { phone_link_generation: 3, phone_link_issued_at: ISSUED_ISO };
    expect(phoneLinkState(row, NOW)).toEqual({
      status: "active",
      generation: 3,
      issuedAt: ISSUED_ISO,
      expiresAt: new Date((ISSUED + PHONE_LINK_TTL_SEC) * 1000).toISOString(),
    });
    expect(phoneLinkState(row, ISSUED + PHONE_LINK_TTL_SEC).status).toBe("expired");
    expect(await currentPhoneLinkToken("p-01", null, { phone_link_generation: 0, phone_link_issued_at: null }, SECRET)).toBeNull();
  });
});

describe("リンクを確かめる（resolvePhoneLink）", () => {
  it("本人用・家族（娘）・支援者の連絡先は通る", async () => {
    for (const c of [null, "c-01-1", "c-01-2"]) {
      sqlite.exec("UPDATE people SET phone_link_generation = 0, phone_link_issued_at = NULL WHERE id = 'p-01'");
      const hit = await resolvePhoneLink(db, SECRET, await issued("p-01", c), NOW);
      expect(hit?.payload).toMatchObject({ p: "p-01", c, g: 1 });
      expect(hit?.target.office).toEqual({ id: "office-demo", name: "デモ事業所", kind: "demo" });
    }
  });

  it("期限切れ・再発行した前の版・一覧から外した本人は通らない", async () => {
    const t = await issued();
    expect(await resolvePhoneLink(db, SECRET, t, ISSUED + PHONE_LINK_TTL_SEC)).toBeNull();
    // 表の印だけ（版はそのまま）でも通らない。外す操作（setUnlisted）は版も上げる（下の「一覧から外す」）
    sqlite.exec(`UPDATE people SET unlisted_at = '${at(-1)}' WHERE id = 'p-01'`);
    expect(await resolvePhoneLink(db, SECRET, t, NOW)).toBeNull();
    sqlite.exec("UPDATE people SET unlisted_at = NULL WHERE id = 'p-01'");
    const t2 = await issued("p-01", null, at(-23));
    expect(await resolvePhoneLink(db, SECRET, t, NOW)).toBeNull();
    expect(await resolvePhoneLink(db, SECRET, t2, NOW)).not.toBeNull();
  });

  it("ほかの本人の連絡先・機関の連絡先・本人の電話（self）・無い連絡先は通らない", async () => {
    for (const [p, c] of [
      ["p-01", "c-02-1"], // 2 の家族
      ["p-01", "c-01-0"], // 本人の電話
      ["p-01", "c-99"],
      ["p-02", "c-02-3"], // 酸素の業者
      ["p-02", "c-02-2"], // 訪問看護
    ] as const) {
      sqlite.exec(`UPDATE people SET phone_link_generation = 0, phone_link_issued_at = NULL WHERE id = '${p}'`);
      expect(await resolvePhoneLink(db, SECRET, await issued(p, c), NOW), `${p} ${c}`).toBeNull();
    }
  });

  it("版が同じでも時刻・期限が表と合わない物（署名は合う）は通らない", async () => {
    await issued();
    const base = { v: 1, p: "p-01", c: null, g: 1 };
    expect(await resolvePhoneLink(db, SECRET, await forge({ ...base, ...phoneLinkTimes(ISSUED + 60) }), NOW)).toBeNull();
    expect(await resolvePhoneLink(db, SECRET, await forge({ ...base, iat: ISSUED, exp: ISSUED + 90 * DAY }), NOW)).toBeNull();
    expect(await resolvePhoneLink(db, SECRET, await forge({ ...base, ...phoneLinkTimes(ISSUED) }), NOW)).not.toBeNull();
  });
});

describe("開く口（/s/<token>）", () => {
  it("本人用: cookie を付けて /me へ 303。cookie の期限はリンクの残り。保存させない・Referer に載せない・検索に載せない", async () => {
    const t = await issued();
    const { res, set, cookie, location } = await open(t);
    expect(res.status).toBe(303);
    expect(location).toBe("http://localhost:3072/me");
    for (const [k, v] of Object.entries(PHONE_OPEN_HEADERS)) expect(res.headers.get(k), k).toBe(v);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain(`Max-Age=${ISSUED + PHONE_LINK_TTL_SEC - NOW}`);
    expect(set).not.toContain("Secure");
    const p = await resolvePrincipal(db, {}, SECRET, cookie, NOW);
    expect(p).toEqual({
      role: "self",
      judge: false,
      admin: false,
      accountId: null,
      displayName: "山田 ハナ",
      office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
      caseloadOf: null,
      personId: "p-01",
      contactId: null,
    } satisfies Principal);
    // https では Secure
    expect((await open(t, NOW, "https://care72.app/s/x")).set).toContain("Secure");
  });

  it("家族用: /family へ。役は家族、名前は連絡先の名前", async () => {
    const { location, cookie } = await open(await issued("p-01", "c-01-1"));
    expect(location).toBe("http://localhost:3072/family");
    const name = one<{ name: string }>("SELECT name FROM contacts WHERE id = 'c-01-1'").name;
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).toMatchObject({
      role: "family",
      judge: false,
      accountId: null,
      personId: "p-01",
      contactId: "c-01-1",
      displayName: name,
    });
  });

  it("通らない物は「無効」の画面へ 303。cookie に触らない。QR のトークン・セッションの cookie を渡しても同じ", async () => {
    await issued();
    const qr = await signQrToken({ v: 1, p: "p-01", g: 1, ...qrTimes(ISSUED) }, SECRET);
    const session = await signSession({ v: 1, k: "link", p: "p-01", c: null, g: 1, pv: LINK_SESSION_PV, iat: NOW, exp: NOW + DAY }, SECRET);
    for (const bad of ["invalid", "x.y", qr, session]) {
      const { res, set, location } = await open(bad);
      expect(res.status, bad).toBe(303);
      expect(location, bad).toBe(`http://localhost:3072${PHONE_LINK_INVALID_PATH}`);
      expect(set, bad).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("再発行すると、前のリンクで開いたセッションは次の要求から通らない。一覧から外しても同じ", async () => {
    const { cookie } = await open(await issued());
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).not.toBeNull();
    await issuePhoneLink(db, ISSUER, "p-01", at(-23));
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).toBeNull();

    const { cookie: fam } = await open(await currentPhoneLinkToken("p-01", "c-01-1", (await loadPhoneLinkRow(db, "p-01"))!, SECRET) as string);
    expect(await resolvePrincipal(db, {}, SECRET, fam, NOW)).not.toBeNull();
    sqlite.exec(`UPDATE people SET unlisted_at = '${at(-1)}' WHERE id = 'p-01'`);
    expect(await resolvePrincipal(db, {}, SECRET, fam, NOW)).toBeNull();
  });

  it("連絡先を消す・種類を機関に変えると、家族のセッションは通らない", async () => {
    const { cookie } = await open(await issued("p-01", "c-01-2"));
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).not.toBeNull();
    sqlite.exec("UPDATE contacts SET kind = 'hospital' WHERE id = 'c-01-2'");
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).toBeNull();
  });
});

describe("リンクのセッションで今の API が動く（accountId null）", () => {
  const careManager: Principal = {
    role: "care_manager",
    judge: false,
    admin: true,
    accountId: "acct-yamamoto",
    displayName: "山本",
    office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
    caseloadOf: "acct-yamamoto",
    personId: null,
    contactId: null,
  };
  async function earthquake() {
    const r = await switchDisasterMode(db, disasterScope(careManager)!, { kind: "earthquake", version: 0, at: at(0) });
    expect(r).toEqual({ ok: true, changed: true });
  }
  /** 発行して、リンクを開き、発災の 1 時間後に cookie から Principal を読む（cookie は発行の 1 時間後に付いた物） */
  async function principalOfLink(contactId: string | null): Promise<Principal> {
    const row = (await issuePhoneLink(db, ISSUER, "p-01", ISSUED_ISO))!;
    const token = (await currentPhoneLinkToken("p-01", contactId, row, SECRET))!;
    const { cookie } = await open(token, NOW);
    const now = Math.floor(QUAKE / 1000) + 3600;
    const p = await resolvePrincipal(db, {}, SECRET, cookie, now);
    if (!p) throw new Error("セッションが通らない");
    return p;
  }
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

  it("本人: 赤・聞き取りの答え・録音が通り、経過の書き手は空（author_id NULL）・役は本人。担当一覧の色がルールの表で変わる", async () => {
    const self = await principalOfLink(null);
    await earthquake();
    const red: SignalBody = { id: id(), color: "red", whereNow: null, answers: { ...NO_ANSWERS }, occurredAt: at(1), sentAt: at(1) };
    expect(await json(await signalPost(db, self, red, at(1)))).toMatchObject({ status: 200, body: { ok: true } });
    expect(one("SELECT author_id, author_role FROM timeline_entries WHERE signal_id = ? AND kind = 'signal'", red.id)).toEqual({
      author_id: null,
      author_role: "self",
    });
    const answers = { injured: { choice: "yes", via: "press" } };
    expect((await answersPost(db, self, red.id, { answers })).status).toBe(200);
    expect(one("SELECT injured, source FROM signals WHERE id = ?", red.id)).toEqual({ injured: 1, source: "self" });
    const form = new FormData();
    for (const [k, v] of Object.entries({ signal: red.id, transcript: "あし", recordedAt: at(1.01), sentAt: at(1.01) })) form.set(k, v);
    expect((await recordingPost(db, { put: async () => null }, self, form, at(1.01))).status).toBe(200);
    const c = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, "2026-11-04", at(1.1));
    expect(c!.rows.find((r) => r.id === "p-01")!.triage!.color).toBe("red");
  });

  it("家族: 3 つの答え（無事・無事じゃない・分からない）が通る。録音は本人だけ", async () => {
    const family = await principalOfLink("c-01-1");
    await earthquake();
    let red = "";
    for (const color of ["green", "red", "unknown"] as const) {
      const body: FamilySignalBody = { id: id(), color, occurredAt: at(1), sentAt: at(1) };
      expect((await signalPost(db, family, body, at(1))).status, color).toBe(200);
      expect(one("SELECT source FROM signals WHERE id = ?", body.id)).toEqual({ source: "family" });
      if (color === "red") red = body.id;
    }
    // 赤のあとの聞き取りの答え（T49）も自分の赤に書ける
    expect((await answersPost(db, family, red, { answers: { canMove: { choice: "no", via: "press" } } })).status).toBe(200);
    expect(one("SELECT can_move FROM signals WHERE id = ?", red)).toEqual({ can_move: 0 });
    const form = new FormData();
    form.set("signal", id());
    expect((await recordingPost(db, { put: async () => null }, family, form, at(1))).status).toBe(403);
  });

  it("平時は今までどおり 409（平時の信号はサーバーが捨てる）", async () => {
    const self = await principalOfLink(null);
    const green: SignalBody = { id: id(), color: "green", whereNow: "home", answers: { ...NO_ANSWERS }, occurredAt: at(1), sentAt: at(1) };
    expect((await signalPost(db, self, green, at(1))).status).toBe(409);
  });
});

describe("毎朝 4 時の戻し（lib/seed/reset.ts は触らない）", () => {
  it("デモ事業所の本人の行は入り直るので版は 0 に戻り、前のリンクとそのセッションは通らない", async () => {
    const t = await issued("p-01", "c-01-1");
    const { cookie } = await open(t);
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).not.toBeNull();
    const bucket: SeedBucket = {
      head: async () => null,
      list: async () => ({ objects: [], truncated: false }),
      delete: async () => null,
    };
    await resetDemoOffice(db, bucket, at(-22));
    expect(one("SELECT phone_link_generation AS g, phone_link_issued_at AS t FROM people WHERE id = 'p-01'")).toEqual({ g: 0, t: null });
    expect(await resolvePhoneLink(db, SECRET, t, NOW)).toBeNull();
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).toBeNull();
  });
});

describe("ログイン中の端末で開いたとき（設計の答え 11/4）", () => {
  const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
  const login = (p: Partial<Principal>): Principal => ({
    role: "care_manager",
    judge: false,
    admin: false,
    accountId: "acct-yamamoto",
    displayName: "山本",
    office: DEMO,
    caseloadOf: "acct-yamamoto",
    personId: null,
    contactId: null,
    ...p,
  });
  const linkSelf = login({ role: "self", accountId: null, caseloadOf: null, personId: "p-01" });

  it("ケアマネ・行政・医療班・審査員（どの役でも）は黙って替えず、ログイン中の 1 枚へ。cookie は付けない", async () => {
    const t = await issued();
    const cases: Principal[] = [
      login({}),
      login({ admin: true }),
      login({ role: "government", accountId: "acct-gov", office: null, caseloadOf: null }),
      login({ role: "medical", accountId: "acct-med", office: null, caseloadOf: null }),
      ...(["unselected", "care_manager", "medical", "self", "family"] as const).map((role) => login({ role, judge: true, accountId: "acct-judge" })),
    ];
    for (const p of cases) {
      expect(linkReplacesLogin(p), `${p.role} ${p.judge}`).toBe(true);
      const res = await openPhoneLink(req(), db, SECRET, t, NOW, p);
      expect(res.status).toBe(303);
      expect(res.headers.get("location"), p.role).toBe(`http://localhost:3072${phoneLinkSwitchPath(t)}`);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("本人・家族のリンクのログイン中とログインなしは、そのまま開く。通らないリンクはログイン中でも無効の頁へ", async () => {
    const t = await issued("p-01", "c-01-1");
    for (const p of [null, linkSelf, login({ role: "family", accountId: null, caseloadOf: null, personId: "p-02", contactId: "c-02-1" })]) {
      expect(linkReplacesLogin(p)).toBe(false);
      const res = await openPhoneLink(req(), db, SECRET, t, NOW, p);
      expect(res.headers.get("location")).toBe("http://localhost:3072/family");
      expect(res.headers.get("set-cookie")).toContain("care72_session=");
    }
    const bad = await openPhoneLink(req(), db, SECRET, "x.y", NOW, login({}));
    expect(bad.headers.get("location")).toBe(`http://localhost:3072${PHONE_LINK_INVALID_PATH}`);
  });

  it("「切替」（POST /s/<token>）: 同じ所からのフォームだけ、今のログインを本人・家族のセッションに替える", async () => {
    const t = await issued();
    const post = (headers: Record<string, string>) => new Request(`http://localhost:3072${phoneLinkOpenPath(t)}`, { method: "POST", headers });
    const ok = await switchPhoneLink(post({ "sec-fetch-site": "same-origin" }), db, SECRET, t, NOW);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("http://localhost:3072/me");
    const cookie = readCookie(ok.headers.get("set-cookie"), SESSION_COOKIE);
    expect((await resolvePrincipal(db, {}, SECRET, cookie, NOW))?.role).toBe("self");
    const cross = await switchPhoneLink(post({ "sec-fetch-site": "cross-site" }), db, SECRET, t, NOW);
    expect(cross.status).toBe(403);
    expect(cross.headers.get("set-cookie")).toBeNull();
    const invalid = await switchPhoneLink(post({ "sec-fetch-site": "same-origin" }), db, SECRET, "x.y", NOW);
    expect(invalid.headers.get("location")).toBe(`http://localhost:3072${PHONE_LINK_INVALID_PATH}`);
    expect(invalid.headers.get("set-cookie")).toBeNull();
  });

  it("route と 1 枚の頁: GET は今のログインを渡す、POST は切替、頁は誰のリンクかを出さず検索に載せない", () => {
    const route = readFileSync(new URL("../../app/s/[token]/route.ts", import.meta.url), "utf8");
    expect(route).toContain("openPhoneLink(request, env.DB, sessionSecret(env), token, nowSec(), principal)");
    expect(route).toContain("export async function POST");
    expect(route).toContain("switchPhoneLink(");
    const page = readFileSync(new URL("../../app/s/[token]/switch/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("linkReplacesLogin(principal)");
    expect(page).toContain("index: false");
    expect(page).toContain('referrer: "no-referrer"');
    expect(page).not.toMatch(/person\.name|personName/);
  });
});

describe("一覧から外すとリンクを切る（設計の答え 11/4）", () => {
  const actor = { officeId: "office-demo", authorId: "acct-yamamoto", authorRole: "care_manager" as const, admin: true, defaultCareManagerId: "acct-yamamoto" };

  it("外すと版が上がって作った時刻が消え、前のリンクとセッションは通らない。戻しても通らず、新しく発行すれば通る", async () => {
    const t = await issued("p-01", "c-01-1");
    const { cookie } = await open(t);
    expect(await setUnlisted(db, actor, { personId: "p-01", unlisted: true }, at(-22))).toEqual({ ok: true, changed: true });
    expect(one("SELECT phone_link_generation AS g, phone_link_issued_at AS t FROM people WHERE id = 'p-01'")).toEqual({ g: 2, t: null });
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).toBeNull();
    expect(await setUnlisted(db, actor, { personId: "p-01", unlisted: false }, at(-21))).toEqual({ ok: true, changed: true });
    expect(one("SELECT phone_link_generation AS g, phone_link_issued_at AS t FROM people WHERE id = 'p-01'")).toEqual({ g: 2, t: null });
    expect(await resolvePhoneLink(db, SECRET, t, NOW)).toBeNull();
    expect(await resolvePrincipal(db, {}, SECRET, cookie, NOW)).toBeNull();
    expect(phoneLinkState((await loadPhoneLinkRow(db, "p-01"))!, NOW).status).toBe("none");
    expect(await currentPhoneLinkToken("p-01", null, (await loadPhoneLinkRow(db, "p-01"))!, SECRET)).toBeNull();
    const t2 = await issued("p-01", "c-01-1", at(-20));
    // 発行の時刻（at(-20)）のあとで確かめる
    expect(await resolvePhoneLink(db, SECRET, t2, Math.floor(Date.parse(at(-19)) / 1000))).not.toBeNull();
    expect(one("SELECT phone_link_generation AS g FROM people WHERE id = 'p-01'")).toEqual({ g: 3 });
  });

  it("まだ発行していない人（版 0）は外しても 0 のまま。台帳の version・QR の版は変えない", async () => {
    const before = one<Record<string, unknown>>("SELECT version, qr_generation FROM people WHERE id = 'p-02'");
    await setUnlisted(db, actor, { personId: "p-02", unlisted: true }, at(-22));
    expect(one("SELECT phone_link_generation AS g, phone_link_issued_at AS t FROM people WHERE id = 'p-02'")).toEqual({ g: 0, t: null });
    expect(one("SELECT version, qr_generation FROM people WHERE id = 'p-02'")).toEqual(before);
  });
});
