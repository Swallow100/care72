// アンケートの Web 版（docs/tasks/T42.md・T65.md）: 共有のリンクを作る・開く・送る・受付の締切と件数・ボットの守り・答えの保存・
// 写しの形・ログインなしの壁の例外。D1 は node:sqlite（lib/db/test-d1.ts）に種と migrations。答えは全部作り物。

import { readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { parseAnswers } from "../../tools/survey/answers.ts";
import { CHOICE_QUESTIONS, COLUMNS, FREE_QUESTIONS, OTHER_FIELDS } from "../../tools/survey/questions.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { answerId, answerLine, answerRisks, choiceText, parseSurveyAnswers, type SurveyAnswers } from "./answer.ts";
import { createLinkRequest, parseMemo } from "./links.ts";
import { SURVEY_DONE_COOKIE, SURVEY_PAGE_PREFIX, surveyDoneCookie, surveySubmitPath, surveyUrl } from "./paths.ts";
import { lastMoment, shareExpiresAt, SURVEY_DEADLINE_ISO, SURVEY_MAX_ANSWERS } from "./share.ts";
import { createSurveyShare, loadSurveyOverview, lookupSurveyShare } from "./store.ts";
import { HONEYPOT_FIELD, submitSurvey, type SubmitInput } from "./submit.ts";
import {
  SURVEY_DEADLINE_PARTS,
  SURVEY_FEATURES,
  SURVEY_HANDLING,
  SURVEY_INTRO,
  SURVEY_LABELS,
  SURVEY_OFFICE_LABELS,
  SURVEY_PURPOSE,
  SURVEY_SHARE_STATE_LABELS,
  SURVEY_TITLE,
} from "./text.ts";
import { isSurveyTokenShape, MIN_FILL_SEC, newSurveyToken, openStamp, RATE_LIMIT_PER_HOUR, sourceHash, stampTime } from "./token.ts";
import { turnstileKeys } from "./turnstile.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const PARTNER = { id: "office-partner", name: "協力事業所", kind: "regular" as const };

const yamamoto = (p: Partial<Principal> = {}): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
  ...p,
});
const judgeCm = () => yamamoto({ judge: true, admin: false, accountId: "acct-judge" });
const medical = () => yamamoto({ role: "medical", admin: false, office: null, caseloadOf: null });
const family = () => yamamoto({ role: "family", admin: false, accountId: null, caseloadOf: null, personId: "p-01", contactId: "c-01-1" });

/** 受付の中（11/4 10:00 JST） */
const T0 = new Date("2026-11-04T01:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const AFTER_DEADLINE = new Date(Date.parse(SURVEY_DEADLINE_ISO) + 1000);
const SECRET = "test-secret-for-survey-source-hash-0123456789";

const count = (sql: string, ...args: string[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;

const ANSWERS = {
  role: "a",
  experience: "c",
  q1: "b",
  q2: "d",
  q3: "b",
  q4: ["f", "b", "c"],
  q5: "書く時間が取れない",
  q6: ["a", "b"],
  q7: "c",
  q8: "b",
  q9: "a",
  q9reason: "話すだけなら続けられる",
  comment: "応援しています",
  quote: "a",
};

/** 共有のリンクを作る */
async function share(role: "care_manager" | "judge" = "care_manager", office = "office-demo", now = T0): Promise<string> {
  const { token } = await createSurveyShare(db, { officeId: office, memo: "包括配布", createdBy: "acct-yamamoto", createdRole: role }, now);
  return token;
}

/** 頁を開いたときの印（T0 に開いた） */
const stampOf = (token: string, openedAt = T0) => openStamp(token, openedAt, SECRET);

async function input(token: string, body: Record<string, unknown> | string, over: Partial<SubmitInput> = {}, openedAt = T0): Promise<SubmitInput> {
  const withStamp = typeof body === "string" ? body : JSON.stringify({ opened: await stampOf(token, openedAt), ...body });
  return {
    token,
    contentType: "application/json",
    body: withStamp,
    ip: "203.0.113.5",
    now: at(MIN_FILL_SEC + 30),
    secret: SECRET,
    turnstile: null,
    ...over,
  };
}

const send = async (token: string, body: Record<string, unknown> | string, over: Partial<SubmitInput> = {}, openedAt = T0) =>
  submitSurvey(db, await input(token, body, over, openedAt));

describe("token と開いた時刻の印", () => {
  it("crypto の乱数 32 バイト（43 文字の base64url）。毎回違う。形の違う物は通さない", () => {
    const a = newSurveyToken();
    const b = newSurveyToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isSurveyTokenShape(a)).toBe(true);
    expect(isSurveyTokenShape("short")).toBe(false);
    expect(isSurveyTokenShape(`${a}/../x`)).toBe(false);
    expect(isSurveyTokenShape(undefined)).toBe(false);
  });

  it("送信元のハッシュは鍵付きで、生の IP を含まない。同じ IP と鍵なら同じ、鍵が違えば違う", async () => {
    const h = await sourceHash("203.0.113.5", SECRET);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(h).not.toContain("203");
    expect(await sourceHash("203.0.113.5", SECRET)).toBe(h);
    expect(await sourceHash("203.0.113.5", `${SECRET}x`)).not.toBe(h);
    expect(await sourceHash("203.0.113.6", SECRET)).not.toBe(h);
  });

  it("印は token と時刻を SESSION_SECRET で署名した物。別の token・書き換え・別の鍵・先の時刻・形の違いは通さない", async () => {
    const token = newSurveyToken();
    const stamp = await openStamp(token, T0, SECRET);
    expect(await stampTime(stamp, token, at(20), SECRET)).toBe(T0.getTime());
    expect(await stampTime(stamp, newSurveyToken(), at(20), SECRET)).toBeNull();
    expect(await stampTime(stamp, token, at(20), `${SECRET}x`)).toBeNull();
    const [ms, mac] = stamp.split(".");
    expect(await stampTime(`${Number(ms) - 60_000}.${mac}`, token, at(20), SECRET)).toBeNull();
    expect(await stampTime(stamp, token, at(-1), SECRET)).toBeNull();
    for (const bad of [undefined, "", "x.y", 5, `${ms}`, `${stamp}x`]) expect(await stampTime(bad, token, at(20), SECRET)).toBeNull();
  });
});

describe("共有のリンクを作る（事業所の画面）", () => {
  it("ケアマネの役だけ。ログインなし 401、医療班・家族 403、長すぎる控え 400", async () => {
    expect((await createLinkRequest(db, null, { memo: "" }, T0, "https://care72.app")).status).toBe(401);
    expect((await createLinkRequest(db, medical(), { memo: "" }, T0, "https://care72.app")).status).toBe(403);
    expect((await createLinkRequest(db, family(), { memo: "" }, T0, "https://care72.app")).status).toBe(403);
    expect((await createLinkRequest(db, yamamoto(), { memo: "あ".repeat(41) }, T0, "https://care72.app")).status).toBe(400);
    expect(count("SELECT count(*) AS n FROM survey_shares")).toBe(0);
  });

  it("URL は要求の origin と /survey/<token>。受付は 11/5 23:59 JST まで、30 件まで。1 人 1 本のリンクは作らない", async () => {
    const r = await createLinkRequest(db, yamamoto(), { memo: " 包括配布 " }, T0, "http://localhost:3072");
    expect(r.status).toBe(200);
    const url = String(r.body.url);
    expect(url.startsWith(`http://localhost:3072${SURVEY_PAGE_PREFIX}`)).toBe(true);
    const token = url.slice(`http://localhost:3072${SURVEY_PAGE_PREFIX}`.length);
    expect(isSurveyTokenShape(token)).toBe(true);
    expect(r.body).toMatchObject({ expiresAt: "2026-11-05T15:00:00.000Z", maxAnswers: 30 });
    expect(SURVEY_MAX_ANSWERS).toBe(30);
    // 画面に出す期限は 11/5 23:59（JST）
    expect(lastMoment(SURVEY_DEADLINE_ISO)).toBe("2026-11-05T14:59:59.999Z");
    const row = sqlite.prepare("SELECT * FROM survey_shares WHERE token = ?").get(token) as Record<string, unknown>;
    expect(row).toMatchObject({ office_id: "office-demo", memo: "包括配布", created_by: "acct-yamamoto", created_role: "care_manager", max_answers: 30 });
    expect(count("SELECT count(*) AS n FROM survey_links")).toBe(0);

    const j = await createLinkRequest(db, judgeCm(), {}, T0, "https://care72.app");
    expect(j.status).toBe(200);
    expect(count("SELECT count(*) AS n FROM survey_shares WHERE created_role = 'judge' AND created_by = 'acct-judge'")).toBe(1);
  });

  it("審査員の物だけ、締切のあとに作っても作ってから 24 時間は受ける（本物の締切は動かない）", () => {
    expect(shareExpiresAt(T0, false)).toBe(SURVEY_DEADLINE_ISO);
    expect(shareExpiresAt(T0, true)).toBe(SURVEY_DEADLINE_ISO);
    const judging = new Date("2026-11-09T01:00:00.000Z");
    expect(shareExpiresAt(judging, false)).toBe(SURVEY_DEADLINE_ISO);
    expect(shareExpiresAt(judging, true)).toBe("2026-11-10T01:00:00.000Z");
  });

  it("控えは空でよい。制御文字は空白に、40 字まで", () => {
    expect(parseMemo(undefined)).toBe("");
    expect(parseMemo("ケアマネ\nB")).toBe("ケアマネ B");
    expect(parseMemo("あ".repeat(40))).toHaveLength(40);
    expect(parseMemo("あ".repeat(41))).toBeNull();
    expect(parseMemo(3)).toBeNull();
  });

  it("URL・送信の道・端末の印の cookie の形", () => {
    expect(surveyUrl("https://care72.app", "abc")).toBe("https://care72.app/survey/abc");
    expect(surveySubmitPath("abc")).toBe("/api/survey/abc");
    const cookie = surveyDoneCookie("abc", true);
    expect(cookie).toContain(`${SURVEY_DONE_COOKIE}=1`);
    expect(cookie).toContain("Path=/survey/abc");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(surveyDoneCookie("abc", false)).not.toContain("Secure");
  });
});

describe("頁を開く（受付の状態）", () => {
  it("受付中なら open。無い・形の違う token は missing（頁は 404）", async () => {
    const token = await share();
    const found = await lookupSurveyShare(db, token, T0.toISOString());
    expect(found.kind).toBe("open");
    expect(found.kind === "open" && found.answers).toBe(0);
    expect((await lookupSurveyShare(db, newSurveyToken(), T0.toISOString())).kind).toBe("missing");
    expect((await lookupSurveyShare(db, "x", T0.toISOString())).kind).toBe("missing");
  });

  it("締切を過ぎたら受付終了。11/5 23:59:59 JST までは受ける", async () => {
    const token = await share();
    expect((await lookupSurveyShare(db, token, new Date("2026-11-05T14:59:59.000Z").toISOString())).kind).toBe("open");
    expect((await lookupSurveyShare(db, token, SURVEY_DEADLINE_ISO)).kind).toBe("closed");
  });

  it("T42 の 1 人 1 本のリンク（もう作らない。行は残す）は受付終了", async () => {
    const old = newSurveyToken();
    sqlite.exec(
      `INSERT INTO survey_links (token, office_id, created_role, created_at, expires_at) VALUES ('${old}', 'office-demo', 'care_manager', '${T0.toISOString()}', '2026-11-18T01:00:00.000Z')`,
    );
    expect((await lookupSurveyShare(db, old, T0.toISOString())).kind).toBe("closed");
    expect((await send(old, { answers: ANSWERS })).status).toBe(410);
  });
});

describe("送信と保存", () => {
  it("9 問の答えを 1 行に保存する。送信元はハッシュだけで、生の IP は残らない", async () => {
    const token = await share();
    const out = await send(token, { answers: { ...ANSWERS, role: "d", roleOther: "相談員" }, [HONEYPOT_FIELD]: "" });
    expect(out).toEqual({ status: 200, body: { ok: true } });
    const row = sqlite.prepare("SELECT * FROM survey_responses WHERE token = ?").get(token) as Record<string, unknown>;
    expect(row).toMatchObject({
      role: "d",
      role_other: "相談員",
      experience: "c",
      q1: "b",
      q2: "d",
      q3: "b",
      q3_other: null,
      q4: "bcf",
      q5: "書く時間が取れない",
      q6: "ab",
      q7: "c",
      q8: "b",
      q9: "a",
      q9_reason: "話すだけなら続けられる",
      comment: "応援しています",
      quote: "a",
      submitted_at: at(MIN_FILL_SEC + 30).toISOString(),
    });
    expect(row.source_hash).toBe(await sourceHash("203.0.113.5", SECRET));
    const all = JSON.stringify(sqlite.prepare("SELECT * FROM survey_responses").all()) + JSON.stringify(sqlite.prepare("SELECT * FROM survey_attempts").all());
    expect(all).not.toContain("203.0.113.5");
  });

  it("1 本のリンクで何人でも答えられる。同じ送信元（同じ職場の Wi-Fi）からでも件数の上限は付けない", async () => {
    const token = await share();
    expect((await send(token, { answers: ANSWERS })).status).toBe(200);
    expect((await send(token, { answers: { ...ANSWERS, q1: "a" } }, { now: at(MIN_FILL_SEC + 40) })).status).toBe(200);
    expect((await send(token, { answers: { ...ANSWERS, q1: "c" } }, { now: at(MIN_FILL_SEC + 50), ip: "198.51.100.7" })).status).toBe(200);
    expect(count("SELECT count(*) AS n FROM survey_responses WHERE token = ?", token)).toBe(3);
    const found = await lookupSurveyShare(db, token, at(100).toISOString());
    expect(found.kind === "open" && found.answers).toBe(3);
  });

  it("30 件まで。31 件目は受付終了（410）で、頁も受付終了", async () => {
    const token = await share();
    for (let i = 0; i < SURVEY_MAX_ANSWERS; i++) {
      const out = await send(token, { answers: { q1: "a" } }, { ip: `198.51.100.${i}`, now: at(MIN_FILL_SEC + 30 + i) });
      expect(out.status, `${i + 1} 件目`).toBe(200);
    }
    const over = await send(token, { answers: { q1: "a" } }, { ip: "192.0.2.1", now: at(200) });
    expect(over.status).toBe(410);
    expect(over.body).toMatchObject({ error: "closed", label: SURVEY_LABELS.closed });
    expect(count("SELECT count(*) AS n FROM survey_responses")).toBe(30);
    expect((await lookupSurveyShare(db, token, at(200).toISOString())).kind).toBe("closed");
    // 別のリンクの件数とは別
    expect((await send(await share(), { answers: { q1: "a" } }, { ip: "192.0.2.2", now: at(201) })).status).toBe(200);
  });

  it("締切のあとは断る（410）。無い token は 404。何も残さない", async () => {
    const token = await share();
    const late = await send(token, { answers: ANSWERS }, { now: AFTER_DEADLINE });
    expect(late.status).toBe(410);
    expect(late.body.error).toBe("closed");
    expect((await send(newSurveyToken(), { answers: ANSWERS })).status).toBe(404);
    expect((await send("not-a-token", { answers: ANSWERS })).status).toBe(404);
    expect(count("SELECT count(*) AS n FROM survey_responses")).toBe(0);
  });

  it("答えたくない問いは空けてよい。何も答えていなければ 400（未回答）", async () => {
    const token = await share();
    const none = await send(token, { answers: { q5: "   " } });
    expect(none.status).toBe(400);
    expect(none.body).toMatchObject({ error: "empty", label: SURVEY_LABELS.empty });
    const some = await send(token, { answers: { q7: "b" } }, { now: at(MIN_FILL_SEC + 60) });
    expect(some.status).toBe(200);
    const row = sqlite.prepare("SELECT role, q4, q5, q7 FROM survey_responses WHERE token = ?").get(token);
    expect(row).toEqual({ role: null, q4: null, q5: null, q7: "b" });
  });

  it("答えの形: 知らない記号・単一選択に 2 つ・400 字を超える文・60 字を超えるその他・文字でない文は 400。何も残さない", async () => {
    const token = await share();
    for (const bad of [
      { ...ANSWERS, q1: "z" },
      { ...ANSWERS, q1: ["a", "b"] },
      { ...ANSWERS, q3: "f" },
      { ...ANSWERS, q4: ["a", "h"] },
      { ...ANSWERS, role: "e" },
      { ...ANSWERS, q5: "あ".repeat(401) },
      { ...ANSWERS, comment: "あ".repeat(401) },
      { ...ANSWERS, q4: ["g"], q4Other: "あ".repeat(61) },
      { ...ANSWERS, q5: 5 },
      "文字",
      [1, 2],
    ]) {
      const out = await send(token, { answers: bad });
      expect(out.status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      expect(out.body.error).toBe("invalid");
    }
    expect(count("SELECT count(*) AS n FROM survey_responses")).toBe(0);
  });

  it("その他の記入は、その他を選んだときだけ残す。60 字ちょうどは通る。記入欄は前後の空白と制御文字を落とす", () => {
    const p = parseSurveyAnswers({ q3: "e", q3Other: "  人による\u0007 ", q4: ["a"], q4Other: "選んでいない", q6: ["g"], q6Other: "あ".repeat(60) });
    expect(p.ok).toBe(true);
    const v = (p as { ok: true; value: SurveyAnswers }).value;
    expect(v.free.q3Other).toBe("人による");
    expect(v.free.q4Other).toBeNull();
    expect(v.free.q6Other).toHaveLength(60);
    const q = parseSurveyAnswers({ q5: "  一行目\r\n二行目 ", q9reason: "あ".repeat(400) });
    expect(q.ok && q.value.free.q5).toBe("一行目\n二行目");
    expect(q.ok && q.value.free.q9reason).toHaveLength(400);
    // その他の記入だけで、その他を選んでいなければ未回答
    expect(parseSurveyAnswers({ roleOther: "相談員" })).toEqual({ ok: false, error: "empty" });
  });
});

describe("ボットの守り", () => {
  it("見えない欄（honeypot）に何か入っていれば、200 を返して何も残さない", async () => {
    const token = await share();
    const out = await send(token, { answers: ANSWERS, [HONEYPOT_FIELD]: "https://spam.example" });
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect(count("SELECT count(*) AS n FROM survey_responses")).toBe(0);
  });

  it("頁を開いてから 15 秒未満は断る。印の無い・別の token の印・書き換えた印も断る。15 秒ちょうどからは通る", async () => {
    const token = await share();
    const early = await send(token, { answers: ANSWERS }, { now: at(MIN_FILL_SEC - 1) });
    expect(early.status).toBe(400);
    expect(early.body).toMatchObject({ error: "too_fast", label: SURVEY_LABELS.tooFast });
    expect((await send(token, JSON.stringify({ answers: ANSWERS }))).body.error).toBe("too_fast");
    const other = await share("judge");
    expect((await send(token, JSON.stringify({ answers: ANSWERS, opened: await stampOf(other) }))).body.error).toBe("too_fast");
    expect((await send(token, JSON.stringify({ answers: ANSWERS, opened: `${T0.getTime()}.${"A".repeat(43)}` }))).body.error).toBe("too_fast");
    expect(count("SELECT count(*) AS n FROM survey_responses")).toBe(0);
    expect((await send(token, { answers: ANSWERS }, { now: at(MIN_FILL_SEC) })).status).toBe(200);
  });

  it("同じ送信元は 1 時間に 20 回まで（断った送信も数える）。21 回目は 429、1 時間たてば戻る。別の送信元は数えが別", async () => {
    const token = await share();
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      const out = await send(token, { answers: ANSWERS }, { now: at(1 + i / 2) });
      expect(out.body.error).toBe("too_fast");
    }
    const over = await send(token, { answers: ANSWERS }, { now: at(30) });
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: "limited", label: SURVEY_LABELS.limited });
    expect(count("SELECT count(*) AS n FROM survey_responses")).toBe(0);
    expect((await send(token, { answers: ANSWERS }, { now: at(31), ip: "198.51.100.7" })).status).toBe(200);
    expect((await send(token, { answers: ANSWERS }, { now: at(3602 + MIN_FILL_SEC) })).status).toBe(200);
    expect(count("SELECT count(*) AS n FROM survey_attempts WHERE at <= ?", at(2).toISOString())).toBe(0);
  });

  it("Content-Type が JSON でなければ 415、本文が大きすぎれば 413、JSON でなければ 400", async () => {
    const token = await share();
    expect((await send(token, { answers: ANSWERS }, { contentType: "text/plain" })).status).toBe(415);
    expect((await send(token, { answers: ANSWERS }, { contentType: null })).status).toBe(415);
    expect((await send(token, { answers: ANSWERS }, { contentType: "application/json; charset=utf-8" })).status).toBe(200);
    expect((await send(token, { answers: ANSWERS, pad: "x".repeat(13000) })).status).toBe(413);
    expect((await send(token, "{not json")).status).toBe(400);
    expect((await send(token, "[]")).status).toBe(400);
  });

  it("全部の記入欄とその他を上限まで埋めても本文の上限に収まる", async () => {
    const token = await share();
    const full = {
      ...ANSWERS,
      role: "d",
      roleOther: "あ".repeat(60),
      q3: "e",
      q3Other: "あ".repeat(60),
      q4: ["a", "b", "c", "d", "e", "f", "g"],
      q4Other: "あ".repeat(60),
      q6: ["a", "b", "c", "d", "e", "f", "g"],
      q6Other: "あ".repeat(60),
      q5: "あ".repeat(400),
      q9reason: "あ".repeat(400),
      comment: "あ".repeat(400),
    };
    expect((await send(token, { answers: full })).status).toBe(200);
  });

  it("Turnstile は鍵が両方あるときだけ。あれば確かめが通った物だけを受ける", async () => {
    expect(turnstileKeys({})).toBeNull();
    expect(turnstileKeys({ TURNSTILE_SITE_KEY: "site" })).toBeNull();
    expect(turnstileKeys({ TURNSTILE_SITE_KEY: " site ", TURNSTILE_SECRET_KEY: "secret" })).toEqual({ siteKey: "site", secretKey: "secret" });

    const seen: string[] = [];
    const turnstile = {
      keys: { siteKey: "site", secretKey: "secret" },
      verify: async (_s: string, response: string) => {
        seen.push(response);
        return response === "pass";
      },
    };
    const token = await share();
    expect((await send(token, { answers: ANSWERS }, { turnstile })).body.error).toBe("turnstile");
    expect((await send(token, { answers: ANSWERS, turnstile: "fail" }, { turnstile })).body.error).toBe("turnstile");
    expect((await send(token, { answers: ANSWERS, turnstile: "pass" }, { turnstile })).status).toBe(200);
    expect(seen).toEqual(["fail", "pass"]);
  });
});

describe("事業所の画面の一覧と写し", () => {
  it("リンクの受付の状態と件数、答えの番号（本物は W、審査員の試しは T）", async () => {
    const real = await share();
    const judge = await share("judge");
    const partner = await share("care_manager", "office-partner");
    await send(real, { answers: ANSWERS });
    await send(real, { answers: { q1: "a" } }, { now: at(MIN_FILL_SEC + 35) });
    await send(judge, { answers: { ...ANSWERS, q1: "c" } }, { now: at(MIN_FILL_SEC + 40) });
    await send(partner, { answers: ANSWERS }, { now: at(MIN_FILL_SEC + 50) });

    const now = at(100).toISOString();
    const all = await loadSurveyOverview(db, "office-demo", { judge: false }, now);
    expect(all.shares).toHaveLength(2);
    expect(all.shares.find((s) => s.token === real)).toMatchObject({ state: "open", answers: 2, maxAnswers: 30, judge: false });
    expect(all.answers.map((a) => [a.id, a.judge])).toEqual([
      ["W001", false],
      ["W002", false],
      ["T001", true],
    ]);
    const later = await loadSurveyOverview(db, "office-demo", { judge: false }, AFTER_DEADLINE.toISOString());
    expect(later.shares.find((s) => s.token === real)?.state).toBe("closed");

    // 審査員は審査員が作った物だけ（本物の答えを読めない）
    const forJudge = await loadSurveyOverview(db, "office-demo", { judge: true }, now);
    expect(forJudge.shares.map((s) => s.token)).toEqual([judge]);
    expect(forJudge.answers.map((a) => a.id)).toEqual(["T001"]);
    // 協力事業所は自分の事業所の物だけ
    const p = await loadSurveyOverview(db, "office-partner", { judge: false }, now);
    expect(p.answers.map((a) => a.id)).toEqual(["W001"]);
    expect(p.shares.map((s) => s.token)).toEqual([partner]);
    expect(Object.values(SURVEY_SHARE_STATE_LABELS)).toEqual(["受付中", "上限到達", "受付終了"]);
  });

  it("写しの行は docs/survey/README.md の形で、tools/survey/answers.ts の parseAnswers がそのまま読める", async () => {
    const token = await share();
    await send(token, { answers: { ...ANSWERS, q5: "様式が|多い\n二行目", q4: ["b", "g"], q4Other: "電話が多い" } });
    const [item] = (await loadSurveyOverview(db, "office-demo", { judge: false }, at(100).toISOString())).answers;
    const line = answerLine(item.id, item.answers);
    expect(line).toBe(
      "| W001 | a |  | c | b | d | b |  | b,g | 電話が多い | 様式が、多い 二行目 | a,b |  | c | b | a | 話すだけなら続けられる | 応援しています | a |",
    );

    const table = [`| ${COLUMNS.join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`, line].join("\n");
    const [r] = parseAnswers(table);
    expect(r.id).toBe("W001");
    expect(r.choices).toEqual({
      role: ["a"],
      experience: ["c"],
      q1: ["b"],
      q2: ["d"],
      q3: ["b"],
      q4: ["b", "g"],
      q6: ["a", "b"],
      q7: ["c"],
      q8: ["b"],
      q9: ["a"],
      quote: ["a"],
    });
    expect(r.free).toMatchObject({ q5: "様式が、多い 二行目", q9reason: "話すだけなら続けられる", comment: "応援しています", q4Other: "電話が多い", roleOther: null });
    expect(choiceText("q4", item.answers.choices.q4, item.answers.free.q4Other)).toBe("書く時間が無い・その他（電話が多い）");
  });

  it("引用が「よい」でない人（よくない・空）は、文の欄（その他の記入も）を写さない", () => {
    const base = parseSurveyAnswers({ q1: "a", q3: "e", q3Other: "人による", q5: "書いた文", q9reason: "理由", comment: "意見", quote: "b" });
    expect(base.ok).toBe(true);
    const a = (base as { ok: true; value: SurveyAnswers }).value;
    const line = answerLine("W002", a);
    for (const t of ["書いた文", "理由", "意見", "人による"]) expect(line).not.toContain(t);
    const noQuote = parseSurveyAnswers({ q1: "a", q5: "書いた文" });
    expect(answerLine("W003", (noQuote as { ok: true; value: SurveyAnswers }).value)).not.toContain("書いた文");

    const table = [`| ${COLUMNS.join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`, line].join("\n");
    const [r] = parseAnswers(table);
    expect(r.free).toEqual({ q5: null, q9reason: null, comment: null, roleOther: null, q3Other: null, q4Other: null, q6Other: null });
    expect(r.choices.q3).toEqual(["e"]);
    expect(r.choices.quote).toEqual(["b"]);
  });

  it("文の欄に名前・電話らしい物があれば要確認の印（疑った文字は返さない）", () => {
    const p = parseSurveyAnswers({ q5: "田中さんに聞いた 090-0000-0001", quote: "a" });
    const risks = answerRisks((p as { ok: true; value: SurveyAnswers }).value);
    expect(risks.length).toBeGreaterThan(0);
    expect(risks.join("")).not.toContain("田中");
    const q = parseSurveyAnswers({ q6: ["g"], q6Other: "山田さんに渡した" });
    expect(answerRisks((q as { ok: true; value: SurveyAnswers }).value).length).toBeGreaterThan(0);
    expect(answerId(12, false)).toBe("W012");
    expect(answerId(1, true)).toBe("T001");
  });

  it("選択の問いは tools/survey/questions.ts の記号と同じ（二重に持たない）。表の CHECK も通る", async () => {
    for (const q of CHOICE_QUESTIONS) {
      for (const c of q.choices) {
        const p = parseSurveyAnswers({ [q.key]: q.multi ? [c.code] : c.code });
        expect(p.ok && p.value.choices[q.key]).toEqual([c.code]);
      }
    }
    // 全部の選択肢の最後の記号で保存できる（migrations/0016 の CHECK と表が合っている）
    const token = await share();
    const last = Object.fromEntries(CHOICE_QUESTIONS.map((q) => [q.key, q.multi ? q.choices.map((c) => c.code) : q.choices.at(-1)!.code]));
    expect((await send(token, { answers: last })).status).toBe(200);
    expect(FREE_QUESTIONS.map((q) => q.key)).toEqual(["q5", "q9reason", "comment"]);
    expect(OTHER_FIELDS.map((o) => `${o.of}:${o.code}`)).toEqual(["role:d", "q3:e", "q4:g", "q6:g"]);
  });
});

describe("案内の文と言葉", () => {
  const invitation = [
    ...SURVEY_INTRO,
    ...SURVEY_FEATURES.flatMap((g) => [g.heading, ...g.items]),
    SURVEY_PURPOSE,
    ...SURVEY_HANDLING,
    SURVEY_DEADLINE_PARTS.join(""),
  ].join("\n");
  const all = [SURVEY_TITLE, invitation, ...Object.values(SURVEY_LABELS), ...Object.values(SURVEY_OFFICE_LABELS)].join("\n");

  it("自己紹介と事情・ハッカソンの説明・作っている機能 3 つ・答えの扱い・受付が入っている", () => {
    for (const w of [
      "お時間のあるときに",
      "5 分ほど",
      "医学部の学生",
      "Built with Claude: Japan 2026",
      "ハッカソンは、決まった期間",
      "11 月 8 日",
      "ケア72",
      "お名前・事業所名は聞きません",
      "人数にまとめ",
      "公開します",
      "「よい」を選んだ方",
      "11 月末までに消します",
      "11 月 5 日（木）まで",
      "AI は順番を決めません",
      "すぐ119番へ",
      "答えたくない問いは空けて構いません",
    ]) {
      expect(invitation, w).toContain(w);
    }
    expect(SURVEY_FEATURES.map((g) => g.heading)).toEqual(["平時（計画づくり）", "訓練", "災害のとき"]);
  });

  it("家族の話と「アプリを触る必要はありません」は外した（DECISIONS 11/3 23:1x）", () => {
    expect(invitation).not.toContain("家族にケアマネ");
    expect(invitation).not.toContain("触る必要");
  });

  it("言葉の決まり: 診断・判定・重症・病気がわかる、を使わない。見出しに読点・句点を付けない", () => {
    for (const w of ["診断", "判定", "重症", "病気がわかる"]) expect(all).not.toContain(w);
    for (const h of [SURVEY_TITLE, ...SURVEY_FEATURES.map((g) => g.heading)]) expect(h).not.toMatch(/[、。]/);
  });
});

describe("ログインなしの壁の例外", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const exists = (dir: string, name: string) => readdirSync(new URL(`../../${dir}`, import.meta.url)).includes(name);

  it("/survey/<token> の頁と送信の API はログインを見ない（壁は token）。リンクを作る API はログインと役を見る", () => {
    const page = read("app/survey/[token]/page.tsx");
    const submit = read("app/api/survey/[token]/route.ts");
    for (const src of [page, submit]) {
      expect(src).not.toMatch(/requirePage|getPrincipal|principalFromRequest/);
    }
    expect(page).toContain("lookupSurveyShare");
    expect(page).toContain("notFound");
    expect(page).toContain("openStamp");
    expect(submit).toContain("submitSurvey");
    const links = read("app/api/survey/links/route.ts");
    expect(links).toContain("principalFromRequest");
  });

  it("/survey（token なし）には頁が無い（404）。/survey の下は [token] だけ", () => {
    expect(exists("app/survey", "page.tsx")).toBe(false);
    expect(readdirSync(new URL("../../app/survey", import.meta.url))).toEqual(["[token]"]);
    expect(readdirSync(new URL("../../app/api/survey", import.meta.url)).sort()).toEqual(["[token]", "links"]);
  });

  it("ほかの頁はこれまで通りログインを見る（/office は requirePage でログインへ）。ログインを全く見ない頁は /survey/<token> だけ", () => {
    expect(read("app/office/page.tsx")).toContain('requirePage("caseload")');
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true })) {
        if (e.isDirectory()) walk(`${dir}/${e.name}`);
        else if (e.name === "page.tsx") pages.push(`${dir}/${e.name}`);
      }
    };
    walk("app");
    const open = pages.filter((p) => !/requirePage|getPrincipal/.test(read(p)));
    expect(pages.length).toBeGreaterThan(10);
    expect(open).toEqual(["app/survey/[token]/page.tsx"]);
  });
});
