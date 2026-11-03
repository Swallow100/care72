// 配信後の確かめ（tools/deploy/checks.ts）の判定。fetch を差し替えて、本物の URL には出ない。

import { describe, expect, it } from "vitest";
import { formatResults, isLocal, runChecks, sameCommit, sessionFrom, summarize, type CheckEnv, type CheckResult, type Fetch } from "./checks.ts";

const BASE = "https://care72.app";
const LOCAL = "http://localhost:3076";
// テストだけの値（本物の ID・パスワードではない）
const TEST_PASSWORD = "test-check-pass-0001";
const WORKERS_HOST = "care72.example-account.workers.dev";

type Call = { url: string; method: string; body: string; cookie: string | null };
type Route = (call: Call) => Response;

const json = (v: unknown, status = 200) => Response.json(v, { status });
const redirect = (location: string, status = 307, cookie?: string) => {
  const headers = new Headers({ location });
  if (cookie) headers.append("set-cookie", `care72_session=${cookie}; Path=/; HttpOnly`);
  return new Response(null, { status, headers });
};

const HEALTH = {
  ok: true,
  commit: "49c7627",
  builtAt: "2026-11-03T00:00:00.000Z",
  bindings: { DB: true, RECORDINGS: true },
  ai: { anthropic: true, gemini: true },
};

/** 配信が正しいときの返事。over で道ごとに差し替える */
function site(over: Record<string, Route> = {}): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  let drillStep = 0;
  const routes: Record<string, Route> = {
    [`${BASE}/api/health`]: () => json(HEALTH),
    [`${LOCAL}/api/health`]: () => json({ ...HEALTH, ai: { anthropic: false, gemini: false } }),
    "/": (c) => (c.cookie ? new Response("担当一覧", { status: 200 }) : redirect("/login")),
    "/me": (c) => (c.cookie?.includes("self") ? new Response("本人", { status: 200 }) : redirect("/login")),
    "/office": () => redirect("/login"),
    "/drill": () => redirect("/login"),
    "/api/drill": (c) =>
      c.method === "GET" ? json({ ok: false, error: "login_required" }, 401) : json({ ok: true, id: "drill-x" }),
    "/api/auth/login": (c) =>
      new URLSearchParams(c.body).get("password") === TEST_PASSWORD
        ? redirect("/login/role", 303, "judge-unselected")
        : redirect("/login?e=1", 303),
    "/api/auth/role": (c) => {
      const role = new URLSearchParams(c.body).get("role");
      return role === "self" ? redirect("/me", 303, "judge-self") : redirect("/", 303, "judge-cm");
    },
    "/api/drill/drill-x/step": () => {
      drillStep++;
      return json({ ok: true, step: drillStep, status: drillStep >= 3 ? "finished" : "running" });
    },
    "/office/reset": () => redirect("/office?reset=done", 303),
    [`https://${WORKERS_HOST}/api/health`]: () => new Response("error code: 1042", { status: 404 }),
    ...over,
  };
  const fetch: Fetch = async (input, init) => {
    const u = new URL(input);
    const headers = new Headers(init?.headers);
    const call: Call = {
      url: input,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : "",
      cookie: headers.get("cookie"),
    };
    calls.push(call);
    expect(init?.redirect).toBe("manual");
    const route = routes[`${u.origin}${u.pathname}`] ?? (u.origin === BASE || u.origin === LOCAL ? routes[u.pathname] : undefined);
    if (!route) throw new TypeError(`fetch failed: ${u.hostname}`);
    return route(call);
  };
  return { fetch, calls };
}

const byName = (results: CheckResult[], name: string) => results.find((r) => r.name === name);
const statusOf = (results: CheckResult[], name: string) => byName(results, name)?.status;

describe("ログインなし", () => {
  it("正しい配信: health・4 つの画面が /login・API が 401 で PASS。workers.dev とログインありは環境変数が無ければ SKIP", async () => {
    const { fetch } = site();
    const r = await runChecks(BASE, {}, fetch);
    expect(r.filter((x) => x.status === "FAIL")).toEqual([]);
    expect(r.filter((x) => x.status === "SKIP").map((x) => x.name)).toEqual(["workers.dev 閉", "ログインあり"]);
    for (const p of ["/", "/me", "/office", "/drill"]) expect(statusOf(r, `ログインなし ${p} → /login`)).toBe("PASS");
    expect(statusOf(r, "ログインなし /api/drill → 401")).toBe("PASS");
    expect(byName(r, "health commit")).toEqual({ name: "health commit", status: "PASS", detail: "49c7627" });
    expect(summarize(r).ok).toBe(true);
  });

  it("CHECK_COMMIT: 一致で PASS、違えば FAIL（長さの違う短い hash は先頭で比べる）", async () => {
    const { fetch } = site();
    expect(statusOf(await runChecks(BASE, { CHECK_COMMIT: "49c7627" }, fetch), "health commit")).toBe("PASS");
    expect(statusOf(await runChecks(BASE, { CHECK_COMMIT: "49c76270ab" }, fetch), "health commit")).toBe("PASS");
    const bad = await runChecks(BASE, { CHECK_COMMIT: "1234567" }, fetch);
    expect(byName(bad, "health commit")).toEqual({ name: "health commit", status: "FAIL", detail: "配信 49c7627 / 出した 1234567" });
    expect(summarize(bad).ok).toBe(false);
  });

  it("commit が unknown・無い、builtAt が無い、ok が false、binding が無いと FAIL", async () => {
    const { fetch } = site({
      [`${BASE}/api/health`]: () => json({ ok: false, commit: "unknown", bindings: { DB: true }, ai: HEALTH.ai }),
    });
    const r = await runChecks(BASE, {}, fetch);
    for (const n of ["health ok", "health commit", "health builtAt", "health bindings"]) expect(statusOf(r, n)).toBe("FAIL");
  });

  it("health が 500・つながらないと FAIL", async () => {
    const { fetch } = site({ [`${BASE}/api/health`]: () => new Response("x", { status: 500 }) });
    expect(byName(await runChecks(BASE, {}, fetch), "health")).toEqual({ name: "health", status: "FAIL", detail: "HTTP 500" });
  });

  it("ai: 配信先で鍵が見えなければ FAIL、手元（localhost）は SKIP", async () => {
    const { fetch } = site({ [`${BASE}/api/health`]: () => json({ ...HEALTH, ai: { anthropic: true, gemini: false } }) });
    expect(statusOf(await runChecks(BASE, {}, fetch), "health ai")).toBe("FAIL");
    const local = await runChecks(LOCAL, {}, site().fetch);
    expect(statusOf(local, "health ai")).toBe("SKIP");
    expect(summarize(local).ok).toBe(true);
  });

  it("ログインなしで画面が開く（200）・別の所へ送ると FAIL", async () => {
    const { fetch } = site({ "/me": () => new Response("本人", { status: 200 }), "/office": () => redirect("/elsewhere") });
    const r = await runChecks(BASE, {}, fetch);
    expect(byName(r, "ログインなし /me → /login")).toEqual({ name: "ログインなし /me → /login", status: "FAIL", detail: "HTTP 200 → なし" });
    expect(statusOf(r, "ログインなし /office → /login")).toBe("FAIL");
  });

  it("API がログインなしで 200 なら FAIL", async () => {
    const { fetch } = site({ "/api/drill": () => json({ ok: true, drills: [] }) });
    expect(statusOf(await runChecks(BASE, {}, fetch), "ログインなし /api/drill → 401")).toBe("FAIL");
  });
});

describe("workers.dev", () => {
  const env: CheckEnv = { CHECK_WORKERS_DEV_HOST: WORKERS_HOST };

  it("404 で PASS、本文の 1042 でも PASS。開いていて 200 なら FAIL。ホスト名は出力に出さない", async () => {
    expect(statusOf(await runChecks(BASE, env, site().fetch), "workers.dev 閉")).toBe("PASS");
    const r1042 = await runChecks(BASE, env, site({ [`https://${WORKERS_HOST}/api/health`]: () => new Response("error code: 1042", { status: 530 }) }).fetch);
    expect(statusOf(r1042, "workers.dev 閉")).toBe("PASS");
    const open = await runChecks(BASE, env, site({ [`https://${WORKERS_HOST}/api/health`]: () => json(HEALTH) }).fetch);
    expect(statusOf(open, "workers.dev 閉")).toBe("FAIL");
    for (const r of [r1042, open]) expect(formatResults(r).join("\n")).not.toContain(WORKERS_HOST);
  });

  it("つながらなければ FAIL（閉じているか確かめられない）。localhost でも環境変数が無ければ SKIP", async () => {
    const r = await runChecks(BASE, { CHECK_WORKERS_DEV_HOST: "nowhere.workers.dev" }, site().fetch);
    expect(statusOf(r, "workers.dev 閉")).toBe("FAIL");
    expect(formatResults(r).join("\n")).not.toContain("nowhere.workers.dev");
    expect(statusOf(await runChecks(LOCAL, {}, site().fetch), "workers.dev 閉")).toBe("SKIP");
  });
});

describe("ログインあり（偽の配信で。本物には流さない）", () => {
  const env: CheckEnv = { CHECK_LOGIN_ID: "judge", CHECK_LOGIN_PASSWORD: TEST_PASSWORD };

  it("審査員: ログイン → 役選択 → 担当一覧・本人のスマホ → 訓練 10 分版 → 最初に戻す が PASS。パスワードは出力に無く、ログインの要求にだけ載る", async () => {
    const { fetch, calls } = site();
    const r = await runChecks(BASE, env, fetch);
    for (const n of ["ログイン", "役選択 ケアマネ", "担当一覧", "本人のスマホ", "訓練 10 分版", "最初に戻す"]) {
      expect(statusOf(r, n), n).toBe("PASS");
    }
    expect(byName(r, "訓練 10 分版")?.detail).toBe("3 刻みで終了");
    expect(summarize(r).ok).toBe(true);
    expect(formatResults(r).join("\n")).not.toContain(TEST_PASSWORD);
    const withPw = calls.filter((c) => c.body.includes(TEST_PASSWORD));
    expect(withPw.map((c) => new URL(c.url).pathname)).toEqual(["/api/auth/login"]);
    // 訓練は 10 分版、最初に戻すは確認の欄を通った形、どちらもケアマネの役の cookie
    const start = calls.find((c) => c.url.endsWith("/api/drill") && c.method === "POST")!;
    expect(JSON.parse(start.body)).toEqual({ scenario: "short" });
    expect(start.cookie).toBe("care72_session=judge-cm");
    const reset = calls.find((c) => c.url.endsWith("/office/reset"))!;
    expect(reset.body).toBe("confirm=1");
    expect(reset.cookie).toBe("care72_session=judge-cm");
  });

  it("パスワードが違えば ログイン FAIL で、その先は流さない", async () => {
    const { fetch, calls } = site();
    const r = await runChecks(BASE, { ...env, CHECK_LOGIN_PASSWORD: "wrong" }, fetch);
    expect(byName(r, "ログイン")).toEqual({ name: "ログイン", status: "FAIL", detail: "HTTP 303 → /login" });
    expect(calls.some((c) => c.url.endsWith("/office/reset"))).toBe(false);
  });

  it("回数の制限（429）は ログイン FAIL に回数超過と出す", async () => {
    const { fetch } = site({ "/api/auth/login": () => json({ error: "too_many_attempts" }, 429) });
    expect(byName(await runChecks(BASE, env, fetch), "ログイン")?.detail).toBe("HTTP 429 → なし（回数超過）");
  });

  it("進行中の訓練があり開始が 409 なら 訓練 FAIL（最初に戻すは流す）", async () => {
    const { fetch } = site({ "/api/drill": (c) => (c.method === "GET" ? json({}, 401) : json({ ok: false, error: "running" }, 409)) });
    const r = await runChecks(BASE, env, fetch);
    expect(byName(r, "訓練 10 分版")).toEqual({ name: "訓練 10 分版", status: "FAIL", detail: "開始 HTTP 409 running" });
    expect(statusOf(r, "最初に戻す")).toBe("PASS");
  });

  it("山本（審査員でない）は役選択と本人のスマホを飛ばす", async () => {
    const { fetch } = site({ "/api/auth/login": () => redirect("/", 303, "yamamoto") });
    const r = await runChecks(BASE, { CHECK_LOGIN_ID: "yamamoto", CHECK_LOGIN_PASSWORD: TEST_PASSWORD }, fetch);
    expect(byName(r, "役選択 ケアマネ")).toBeUndefined();
    expect(statusOf(r, "本人のスマホ")).toBe("SKIP");
    expect(statusOf(r, "担当一覧")).toBe("PASS");
  });

  it("ID かパスワードの片方だけなら SKIP", async () => {
    expect(statusOf(await runChecks(BASE, { CHECK_LOGIN_ID: "judge" }, site().fetch), "ログインあり")).toBe("SKIP");
  });
});

describe("小さな部品", () => {
  it("sameCommit・isLocal・sessionFrom", () => {
    expect(sameCommit("49c7627", "49C7627")).toBe(true);
    expect(sameCommit("49c7627", "49c76")).toBe(false);
    expect(sameCommit("49c7627", "unknown")).toBe(false);
    expect(isLocal("http://localhost:3076")).toBe(true);
    expect(isLocal("http://127.0.0.1:3076")).toBe(true);
    expect(isLocal("http://[::1]:3076")).toBe(true);
    expect(isLocal("https://care72.app")).toBe(false);
    expect(sessionFrom(redirect("/", 303, "abc"))).toBe("care72_session=abc");
    expect(sessionFrom(redirect("/", 303))).toBeNull();
  });
});
