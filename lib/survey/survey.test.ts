// アンケートの Web 版（docs/tasks/T42.md）: リンクを作る・開く・送る・ボットの守り・答えの保存・写しの形・ログインなしの壁の例外。
// D1 は node:sqlite（lib/db/test-d1.ts）に種と migrations。答えは全部作り物。

import { readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { parseAnswers } from "../../tools/survey/answers.ts";
import { CHOICE_QUESTIONS, COLUMNS, FREE_QUESTIONS } from "../../tools/survey/questions.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { answerId, answerLine, answerRisks, parseSurveyAnswers, type SurveyAnswers } from "./answer.ts";
import { createLinkRequest, parseMemo } from "./links.ts";
import { SURVEY_PAGE_PREFIX, surveySubmitPath, surveyUrl } from "./paths.ts";
import { createSurveyLink, loadSurveyOverview, openSurveyLink } from "./store.ts";
import { HONEYPOT_FIELD, submitSurvey, type SubmitInput } from "./submit.ts";
import { SURVEY_INVITATION, SURVEY_LABELS, SURVEY_LINK_STATE_LABELS, SURVEY_OFFICE_LABELS, SURVEY_TITLE } from "./text.ts";
import { isSurveyTokenShape, MIN_FILL_SEC, newSurveyToken, RATE_LIMIT_PER_HOUR, sourceHash } from "./token.ts";
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
const partnerCm = () => yamamoto({ accountId: "acct-partner-cm", office: PARTNER, caseloadOf: "acct-partner-cm" });

const T0 = new Date("2026-11-04T01:00:00.000Z");
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);
const SECRET = "test-secret-for-survey-source-hash-0123456789";

const count = (sql: string, ...args: string[]) => (sqlite.prepare(sql).get(...args) as { n: number }).n;

const ANSWERS = {
  role: "a",
  experience: "c",
  q1: "b",
  q2: "d",
  q3: ["f", "b", "c"],
  q4: "書く時間が取れない",
  q5: "c",
  q6: "b",
  q7: "a",
  q7reason: "話すだけなら続けられる",
  quote: "a",
};

/** 作ったリンクを開いた（頁を出した）ところ */
async function opened(openAt = T0, role: "care_manager" | "judge" = "care_manager", office = "office-demo"): Promise<string> {
  const { token } = await createSurveyLink(db, { officeId: office, memo: "ケアマネA", createdBy: "acct-yamamoto", createdRole: role }, openAt);
  expect(await openSurveyLink(db, token, openAt.toISOString())).not.toBeNull();
  return token;
}

function input(token: string, body: unknown, over: Partial<SubmitInput> = {}): SubmitInput {
  return {
    token,
    contentType: "application/json",
    body: typeof body === "string" ? body : JSON.stringify(body),
    ip: "203.0.113.5",
    now: at(MIN_FILL_SEC + 30),
    secret: SECRET,
    turnstile: null,
    ...over,
  };
}

describe("token", () => {
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
});

describe("リンクを作る（事業所の画面）", () => {
  it("ケアマネの役だけ。ログインなし 401、医療班・家族 403、長すぎる控え 400", async () => {
    expect((await createLinkRequest(db, null, { memo: "" }, T0, "https://care72.app")).status).toBe(401);
    expect((await createLinkRequest(db, medical(), { memo: "" }, T0, "https://care72.app")).status).toBe(403);
    expect((await createLinkRequest(db, family(), { memo: "" }, T0, "https://care72.app")).status).toBe(403);
    expect((await createLinkRequest(db, yamamoto(), { memo: "あ".repeat(41) }, T0, "https://care72.app")).status).toBe(400);
    expect(count("SELECT count(*) AS n FROM survey_links")).toBe(0);
  });

  it("URL は要求の origin と /survey/<token>。期限は 14 日。作った人の役（山本はケアマネ、審査員は judge）", async () => {
    const r = await createLinkRequest(db, yamamoto(), { memo: " ケアマネA " }, T0, "http://localhost:3074");
    expect(r.status).toBe(200);
    const url = String(r.body.url);
    expect(url.startsWith(`http://localhost:3074${SURVEY_PAGE_PREFIX}`)).toBe(true);
    const token = url.slice(`http://localhost:3074${SURVEY_PAGE_PREFIX}`.length);
    expect(isSurveyTokenShape(token)).toBe(true);
    expect(r.body.expiresAt).toBe("2026-11-18T01:00:00.000Z");
    const row = sqlite.prepare("SELECT * FROM survey_links WHERE token = ?").get(token) as Record<string, unknown>;
    expect(row).toMatchObject({ office_id: "office-demo", memo: "ケアマネA", created_by: "acct-yamamoto", created_role: "care_manager" });
    expect(row.opened_at).toBeNull();
    expect(row.used_at).toBeNull();

    const j = await createLinkRequest(db, judgeCm(), {}, T0, "https://care72.app");
    expect(j.status).toBe(200);
    expect(count("SELECT count(*) AS n FROM survey_links WHERE created_role = 'judge' AND created_by = 'acct-judge'")).toBe(1);
  });

  it("控えは空でよい。制御文字は空白に、40 字まで", () => {
    expect(parseMemo(undefined)).toBe("");
    expect(parseMemo("ケアマネ\nB")).toBe("ケアマネ B");
    expect(parseMemo("あ".repeat(40))).toHaveLength(40);
    expect(parseMemo("あ".repeat(41))).toBeNull();
    expect(parseMemo(3)).toBeNull();
  });

  it("URL の形", () => {
    expect(surveyUrl("https://care72.app", "abc")).toBe("https://care72.app/survey/abc");
    expect(surveySubmitPath("abc")).toBe("/api/survey/abc");
  });
});

describe("頁を開く", () => {
  it("最初に開いた時刻だけを残す（2 度目は変えない）", async () => {
    const { token } = await createSurveyLink(db, { officeId: "office-demo", memo: "", createdBy: null, createdRole: "care_manager" }, T0);
    await openSurveyLink(db, token, at(5).toISOString());
    await openSurveyLink(db, token, at(60).toISOString());
    expect(sqlite.prepare("SELECT opened_at AS o FROM survey_links WHERE token = ?").get(token)).toEqual({ o: at(5).toISOString() });
  });

  it("無い・形の違う・使用済み・期限切れの token は開けない（頁は 404）", async () => {
    expect(await openSurveyLink(db, newSurveyToken(), T0.toISOString())).toBeNull();
    expect(await openSurveyLink(db, "x", T0.toISOString())).toBeNull();
    const token = await opened();
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }))).status).toBe(200);
    expect(await openSurveyLink(db, token, at(120).toISOString())).toBeNull();
    const late = await opened();
    expect(await openSurveyLink(db, late, new Date(T0.getTime() + 14 * 86400_000).toISOString())).toBeNull();
    expect(await openSurveyLink(db, late, new Date(T0.getTime() + 14 * 86400_000 - 1000).toISOString())).not.toBeNull();
  });
});

describe("送信と保存", () => {
  it("7 問の答えを 1 行に保存し、token を使用済みに。送信元はハッシュだけで、生の IP は残らない", async () => {
    const token = await opened();
    const out = await submitSurvey(db, input(token, { answers: ANSWERS, [HONEYPOT_FIELD]: "" }));
    expect(out).toEqual({ status: 200, body: { ok: true } });
    const row = sqlite.prepare("SELECT * FROM survey_answers WHERE token = ?").get(token) as Record<string, unknown>;
    expect(row).toMatchObject({
      role: "a",
      experience: "c",
      q1: "b",
      q2: "d",
      q3: "bcf",
      q4: "書く時間が取れない",
      q5: "c",
      q6: "b",
      q7: "a",
      q7_reason: "話すだけなら続けられる",
      quote: "a",
      submitted_at: at(MIN_FILL_SEC + 30).toISOString(),
    });
    expect(row.source_hash).toBe(await sourceHash("203.0.113.5", SECRET));
    const all = JSON.stringify(sqlite.prepare("SELECT * FROM survey_answers").all()) + JSON.stringify(sqlite.prepare("SELECT * FROM survey_attempts").all());
    expect(all).not.toContain("203.0.113.5");
    expect(sqlite.prepare("SELECT used_at AS u FROM survey_links WHERE token = ?").get(token)).toEqual({ u: at(MIN_FILL_SEC + 30).toISOString() });
  });

  it("1 つの token で 1 回だけ。2 度目は 404 で、答えは 1 行のまま", async () => {
    const token = await opened();
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }))).status).toBe(200);
    const again = await submitSurvey(db, input(token, { answers: { ...ANSWERS, q1: "a" } }, { now: at(MIN_FILL_SEC + 60) }));
    expect(again.status).toBe(404);
    expect(again.body.error).toBe("gone");
    expect(count("SELECT count(*) AS n FROM survey_answers")).toBe(1);
    expect(count("SELECT count(*) AS n FROM survey_answers WHERE q1 = 'b'")).toBe(1);
  });

  it("無い token・期限切れの token は 404。何も残さない", async () => {
    expect((await submitSurvey(db, input(newSurveyToken(), { answers: ANSWERS }))).status).toBe(404);
    expect((await submitSurvey(db, input("not-a-token", { answers: ANSWERS }))).status).toBe(404);
    const token = await opened();
    const expired = await submitSurvey(db, input(token, { answers: ANSWERS }, { now: new Date(T0.getTime() + 15 * 86400_000) }));
    expect(expired.status).toBe(404);
    expect(count("SELECT count(*) AS n FROM survey_answers")).toBe(0);
    expect(count("SELECT count(*) AS n FROM survey_links WHERE used_at IS NOT NULL")).toBe(0);
  });

  it("答えたくない問いは空けてよい。何も答えていなければ 400（未回答）", async () => {
    const token = await opened();
    const none = await submitSurvey(db, input(token, { answers: { q4: "   " } }));
    expect(none.status).toBe(400);
    expect(none.body).toMatchObject({ error: "empty", label: SURVEY_LABELS.empty });
    const some = await submitSurvey(db, input(token, { answers: { q5: "b" } }, { now: at(MIN_FILL_SEC + 60) }));
    expect(some.status).toBe(200);
    const row = sqlite.prepare("SELECT role, q3, q4, q5 FROM survey_answers WHERE token = ?").get(token);
    expect(row).toEqual({ role: null, q3: null, q4: null, q5: "b" });
  });

  it("答えの形: 知らない記号・単一選択に 2 つ・400 字を超える文・文字でない文は 400。何も残さない", async () => {
    const token = await opened();
    for (const bad of [
      { ...ANSWERS, q1: "z" },
      { ...ANSWERS, q1: ["a", "b"] },
      { ...ANSWERS, q3: ["a", "h"] },
      { ...ANSWERS, q4: "あ".repeat(401) },
      { ...ANSWERS, q4: 5 },
      "文字",
      [1, 2],
    ]) {
      const out = await submitSurvey(db, input(token, { answers: bad }));
      expect(out.status, JSON.stringify(bad)).toBe(400);
      expect(out.body.error).toBe("invalid");
    }
    expect(count("SELECT count(*) AS n FROM survey_answers")).toBe(0);
  });

  it("自由記述は前後の空白と制御文字を落とし、改行は残す。400 字ちょうどは通る", async () => {
    const p = parseSurveyAnswers({ q4: "  一行目\r\n二行目\u0007 ", q7reason: "あ".repeat(400) });
    expect(p.ok && p.value.free.q4).toBe("一行目\n二行目");
    expect(p.ok && p.value.free.q7reason).toHaveLength(400);
  });
});

describe("ボットの守り", () => {
  it("見えない欄（honeypot）に何か入っていれば、200 を返して何も残さない（token も使える）", async () => {
    const token = await opened();
    const out = await submitSurvey(db, input(token, { answers: ANSWERS, [HONEYPOT_FIELD]: "https://spam.example" }));
    expect(out).toEqual({ status: 200, body: { ok: true } });
    expect(count("SELECT count(*) AS n FROM survey_answers")).toBe(0);
    expect(count("SELECT count(*) AS n FROM survey_links WHERE used_at IS NULL")).toBe(1);
    // 人の送信はあとで通る
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }, { now: at(MIN_FILL_SEC + 60) }))).status).toBe(200);
  });

  it("開いてから 15 秒未満の送信と、頁を開かずに送った物は断る。15 秒ちょうどからは通る", async () => {
    const token = await opened();
    const early = await submitSurvey(db, input(token, { answers: ANSWERS }, { now: at(MIN_FILL_SEC - 1) }));
    expect(early.status).toBe(400);
    expect(early.body).toMatchObject({ error: "too_fast", label: SURVEY_LABELS.tooFast });
    expect(count("SELECT count(*) AS n FROM survey_answers")).toBe(0);
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }, { now: at(MIN_FILL_SEC) }))).status).toBe(200);

    const { token: unopened } = await createSurveyLink(db, { officeId: "office-demo", memo: "", createdBy: null, createdRole: "care_manager" }, T0);
    const direct = await submitSurvey(db, input(unopened, { answers: ANSWERS }, { now: at(3600) }));
    expect(direct.body.error).toBe("too_fast");
  });

  it("同じ送信元は 1 時間に 20 回まで（断った送信も数える）。21 回目は 429、1 時間たてば戻る。別の送信元は数えが別", async () => {
    const token = await opened();
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      const out = await submitSurvey(db, input(token, { answers: ANSWERS }, { now: at(1 + i / 2) }));
      expect(out.body.error).toBe("too_fast");
    }
    // 15 秒たって人の送信の形でも、上限を超えた送信元は断る
    const over = await submitSurvey(db, input(token, { answers: ANSWERS }, { now: at(30) }));
    expect(over.status).toBe(429);
    expect(over.body).toMatchObject({ error: "limited", label: SURVEY_LABELS.limited });
    expect(count("SELECT count(*) AS n FROM survey_answers")).toBe(0);
    // 別の送信元
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }, { now: at(31), ip: "198.51.100.7" }))).status).toBe(200);
    // 1 時間たてば古い数えは消える
    const other = await opened(at(3600));
    expect((await submitSurvey(db, input(other, { answers: ANSWERS }, { now: at(3602 + MIN_FILL_SEC) }))).status).toBe(200);
    expect(count("SELECT count(*) AS n FROM survey_attempts WHERE at <= ?", at(2).toISOString())).toBe(0);
  });

  it("Content-Type が JSON でなければ 415、本文が大きすぎれば 413、JSON でなければ 400", async () => {
    const token = await opened();
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }, { contentType: "text/plain" }))).status).toBe(415);
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }, { contentType: null }))).status).toBe(415);
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }, { contentType: "application/json; charset=utf-8" }))).status).toBe(200);
    const token2 = await opened();
    expect((await submitSurvey(db, input(token2, { answers: ANSWERS, pad: "x".repeat(9000) }))).status).toBe(413);
    expect((await submitSurvey(db, input(token2, "{not json"))).status).toBe(400);
    expect((await submitSurvey(db, input(token2, "[]"))).status).toBe(400);
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
    const token = await opened();
    expect((await submitSurvey(db, input(token, { answers: ANSWERS }, { turnstile }))).body.error).toBe("turnstile");
    expect((await submitSurvey(db, input(token, { answers: ANSWERS, turnstile: "fail" }, { turnstile }))).body.error).toBe("turnstile");
    expect((await submitSurvey(db, input(token, { answers: ANSWERS, turnstile: "pass" }, { turnstile }))).status).toBe(200);
    expect(seen).toEqual(["fail", "pass"]);
  });
});

describe("事業所の画面の一覧と写し", () => {
  it("リンクの状態（未開封・開封済・回答済・期限切れ）と、答えの番号（本物は W、審査員の試しは T）", async () => {
    const { token: unopened } = await createSurveyLink(db, { officeId: "office-demo", memo: "未", createdBy: null, createdRole: "care_manager" }, T0);
    const openedToken = await opened(at(10));
    const answered = await opened();
    const judge = await opened(T0, "judge");
    const partner = await opened(T0, "care_manager", "office-partner");
    await submitSurvey(db, input(answered, { answers: ANSWERS }));
    await submitSurvey(db, input(judge, { answers: { ...ANSWERS, q1: "c" } }, { now: at(MIN_FILL_SEC + 40) }));
    await submitSurvey(db, input(partner, { answers: ANSWERS }, { now: at(MIN_FILL_SEC + 50) }));

    const now = at(100).toISOString();
    const all = await loadSurveyOverview(db, "office-demo", { judge: false }, now);
    const state = (t: string) => all.links.find((l) => l.token === t)?.state;
    expect(state(unopened)).toBe("unopened");
    expect(state(openedToken)).toBe("opened");
    expect(state(answered)).toBe("answered");
    expect(all.links).toHaveLength(4);
    expect(all.answers.map((a) => [a.id, a.judge])).toEqual([
      ["W001", false],
      ["T001", true],
    ]);
    const later = await loadSurveyOverview(db, "office-demo", { judge: false }, new Date(T0.getTime() + 15 * 86400_000).toISOString());
    expect(later.links.find((l) => l.token === unopened)?.state).toBe("expired");
    expect(later.links.find((l) => l.token === answered)?.state).toBe("answered");

    // 審査員は審査員が作った物だけ（本物のケアマネの答えを読めない）
    const forJudge = await loadSurveyOverview(db, "office-demo", { judge: true }, now);
    expect(forJudge.links.map((l) => l.token)).toEqual([judge]);
    expect(forJudge.answers.map((a) => a.id)).toEqual(["T001"]);
    // 協力事業所は自分の事業所の物だけ
    const p = await loadSurveyOverview(db, "office-partner", { judge: false }, now);
    expect(p.answers.map((a) => a.id)).toEqual(["W001"]);
    expect(p.links.map((l) => l.token)).toEqual([partner]);
    // 状態の言葉
    expect(Object.values(SURVEY_LINK_STATE_LABELS)).toEqual(["未開封", "開封済", "回答済", "期限切れ"]);
  });

  it("写しの行は docs/survey/README.md の形で、tools/survey/answers.ts の parseAnswers がそのまま読める", async () => {
    const token = await opened();
    await submitSurvey(db, input(token, { answers: { ...ANSWERS, q4: "様式が|多い\n二行目" } }));
    const [item] = (await loadSurveyOverview(db, "office-demo", { judge: false }, at(100).toISOString())).answers;
    const line = answerLine(item.id, item.answers);
    expect(line).toBe("| W001 | a | c | b | d | b,c,f | 様式が、多い 二行目 | c | b | a | 話すだけなら続けられる | a |");

    const table = [`| ${COLUMNS.join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`, line].join("\n");
    const [r] = parseAnswers(table);
    expect(r.id).toBe("W001");
    expect(r.choices).toEqual({ role: ["a"], experience: ["c"], q1: ["b"], q2: ["d"], q3: ["b", "c", "f"], q5: ["c"], q6: ["b"], q7: ["a"], quote: ["a"] });
    expect(r.free).toEqual({ q4: "様式が、多い 二行目", q7reason: "話すだけなら続けられる" });
  });

  it("引用が「よい」でない人（よくない・空）は、問 4・問 7 の理由の文を写さない。空の問いは空のまま読める", () => {
    const base = parseSurveyAnswers({ q1: "a", q4: "書いた文", q7reason: "理由", quote: "b" });
    expect(base.ok).toBe(true);
    const a = (base as { ok: true; value: SurveyAnswers }).value;
    const line = answerLine("W002", a);
    expect(line).not.toContain("書いた文");
    expect(line).not.toContain("理由");
    const noQuote = parseSurveyAnswers({ q1: "a", q4: "書いた文" });
    expect(answerLine("W003", (noQuote as { ok: true; value: SurveyAnswers }).value)).not.toContain("書いた文");

    const table = [`| ${COLUMNS.join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`, line].join("\n");
    const [r] = parseAnswers(table);
    expect(r.free).toEqual({ q4: null, q7reason: null });
    expect(r.choices.q3).toEqual([]);
    expect(r.choices.quote).toEqual(["b"]);
  });

  it("自由記述に名前・電話らしい物があれば要確認の印（疑った文字は返さない）", () => {
    const p = parseSurveyAnswers({ q4: "田中さんに聞いた 090-0000-0001", quote: "a" });
    const risks = answerRisks((p as { ok: true; value: SurveyAnswers }).value);
    expect(risks.length).toBeGreaterThan(0);
    expect(risks.join("")).not.toContain("田中");
    expect(answerId(12, false)).toBe("W012");
    expect(answerId(1, true)).toBe("T001");
  });

  it("選択の問いは tools/survey/questions.ts の記号と同じ（二重に持たない）", () => {
    for (const q of CHOICE_QUESTIONS) {
      for (const c of q.choices) {
        const p = parseSurveyAnswers({ [q.key]: q.multi ? [c.code] : c.code });
        expect(p.ok && p.value.choices[q.key]).toEqual([c.code]);
      }
    }
    expect(FREE_QUESTIONS.map((q) => q.key)).toEqual(["q4", "q7reason"]);
  });
});

describe("案内の文と言葉", () => {
  const all = [SURVEY_TITLE, ...SURVEY_INVITATION, ...Object.values(SURVEY_LABELS), ...Object.values(SURVEY_OFFICE_LABELS)].join("\n");

  it("頼み・事情・触らなくてよいこと・名前は要らない・使い道・お礼が入っている。10 行まで", () => {
    const text = SURVEY_INVITATION.join("\n");
    for (const w of ["お時間のあるときに", "5 分", "Built with Claude: Japan 2026", "医学部の学生", "家族にケアマネ", "11 月 8 日", "訓練", "書かないでください", "README", "動画", "引用"]) {
      expect(text, w).toContain(w);
    }
    expect(SURVEY_INVITATION.length).toBeLessThanOrEqual(10);
  });

  it("言葉の決まり: 診断・判定・重症・病気がわかる、を使わない。見出しに読点・句点を付けない", () => {
    for (const w of ["診断", "判定", "重症", "病気がわかる"]) expect(all).not.toContain(w);
    expect(SURVEY_TITLE).not.toMatch(/[、。]/);
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
    expect(page).toContain("openSurveyLink");
    expect(page).toContain("notFound");
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
    // /login と /q/<token>（QR の頁、T16）もログインなしで開くが、ログインしているかは見る（getPrincipal）
    const open = pages.filter((p) => !/requirePage|getPrincipal/.test(read(p)));
    expect(pages.length).toBeGreaterThan(10);
    expect(open).toEqual(["app/survey/[token]/page.tsx"]);
  });
});
