// 配信後の確かめ（docs/tasks/T41.md）。tools/deploy/check-remote.mjs が流す中身で、テストは fetch を差し替えて確かめる。
//
// ログインなし（いつも）:
//   /api/health の ok・binding・ai・commit（CHECK_COMMIT があれば一致も）、
//   ログインなしの / ・/me・/office・/drill が /login へ、訓練の API が 401、
//   workers.dev が閉じている（CHECK_WORKERS_DEV_HOST があるときだけ。ホスト名はアカウント名を含むのでファイルに書かない）。
// ログインあり（CHECK_LOGIN_ID と CHECK_LOGIN_PASSWORD があるときだけ。作者が自分の端末で流す。エージェントは流さない）:
//   ログイン → 審査員なら役選択（ケアマネ）→ 担当一覧、本人のスマホ、訓練 10 分版を 1 回（AI を使う）、最初に戻す。
//   最初に戻すはデモ事業所を種に戻す（審査員が触っている時間には流さない）。
// パスワードは出力・エラーに出さない。lib を import しない（node でそのまま流すため。値は lib/auth/roles.ts と同じ）。

export type CheckStatus = "PASS" | "FAIL" | "SKIP";
export type CheckResult = { name: string; status: CheckStatus; detail: string };

export type CheckEnv = {
  /** 出した commit（短い hash）。あれば /api/health の commit と比べる */
  CHECK_COMMIT?: string;
  /** workers.dev のホスト名。あれば閉じているかを見る（無ければ飛ばす） */
  CHECK_WORKERS_DEV_HOST?: string;
  /** ログインが要る確かめの ID とパスワード（両方あるときだけ） */
  CHECK_LOGIN_ID?: string;
  CHECK_LOGIN_PASSWORD?: string;
};

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const DEFAULT_URL = "https://care72.app";
const LOGIN_PATH = "/login";
const ROLE_SELECT_PATH = "/login/role";
const SESSION_COOKIE = "care72_session";
/** ログインなしで /login へ送られるはずの画面（担当一覧・本人のスマホ・事業所・訓練記録） */
export const GUARDED_PAGES = ["/", "/me", "/office", "/drill"] as const;
/** 訓練の刻みの数の上限（10 分版は 4 刻み。止まらないように） */
const MAX_STEPS = 20;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLocal(base: string): boolean {
  const host = new URL(base).hostname;
  return LOCAL_HOSTS.has(host) || LOCAL_HOSTS.has(`[${host}]`) || host.endsWith(".localhost");
}

const pass = (name: string, detail = ""): CheckResult => ({ name, status: "PASS", detail });
const fail = (name: string, detail: string): CheckResult => ({ name, status: "FAIL", detail });
const skip = (name: string, detail: string): CheckResult => ({ name, status: "SKIP", detail });

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** 短い hash どうしの一致（長さが違っても先頭が同じなら同じ commit） */
export function sameCommit(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x.length < 7 || y.length < 7) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/** 3xx の Location の道（pathname）。3xx でなければ null */
function redirectPath(res: Response, base: string): string | null {
  if (res.status < 300 || res.status > 399) return null;
  const loc = res.headers.get("location");
  if (!loc) return null;
  return new URL(loc, base).pathname;
}

// ---------- ログインなし ----------

async function checkHealth(base: string, env: CheckEnv, f: Fetch): Promise<CheckResult[]> {
  let body: Record<string, unknown>;
  try {
    const res = await f(new URL("/api/health", base).toString(), { redirect: "manual" });
    if (res.status !== 200) return [fail("health", `HTTP ${res.status}`)];
    body = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    return [fail("health", errorText(e))];
  }
  const out: CheckResult[] = [];
  out.push(body.ok === true ? pass("health ok") : fail("health ok", `ok=${JSON.stringify(body.ok)}`));

  const bindings = (body.bindings ?? {}) as Record<string, unknown>;
  out.push(
    bindings.DB === true && bindings.RECORDINGS === true
      ? pass("health bindings", "DB・RECORDINGS")
      : fail("health bindings", JSON.stringify(bindings)),
  );

  const ai = (body.ai ?? {}) as Record<string, unknown>;
  if (ai.anthropic === true && ai.gemini === true) out.push(pass("health ai", "anthropic・gemini"));
  else if (isLocal(base)) out.push(skip("health ai", `手元（鍵なしでよい）: ${JSON.stringify(ai)}`));
  else out.push(fail("health ai", JSON.stringify(ai)));

  const commit = typeof body.commit === "string" ? body.commit : "";
  if (!/^[0-9a-f]{7,40}$/.test(commit)) out.push(fail("health commit", `commit=${JSON.stringify(body.commit)}`));
  else if (env.CHECK_COMMIT?.trim()) {
    out.push(
      sameCommit(commit, env.CHECK_COMMIT)
        ? pass("health commit", `${commit}（出した commit と一致）`)
        : fail("health commit", `配信 ${commit} / 出した ${env.CHECK_COMMIT.trim()}`),
    );
  } else out.push(pass("health commit", commit));

  const builtAt = typeof body.builtAt === "string" ? body.builtAt : "";
  out.push(
    builtAt && !Number.isNaN(Date.parse(builtAt)) ? pass("health builtAt", builtAt) : fail("health builtAt", JSON.stringify(body.builtAt)),
  );
  return out;
}

async function checkGuardedPage(base: string, path: string, f: Fetch): Promise<CheckResult> {
  const name = `ログインなし ${path} → ${LOGIN_PATH}`;
  try {
    const res = await f(new URL(path, base).toString(), { redirect: "manual" });
    const to = redirectPath(res, base);
    return to === LOGIN_PATH ? pass(name, `HTTP ${res.status}`) : fail(name, `HTTP ${res.status} → ${to ?? "なし"}`);
  } catch (e) {
    return fail(name, errorText(e));
  }
}

async function checkApiDenied(base: string, f: Fetch): Promise<CheckResult> {
  const name = "ログインなし /api/drill → 401";
  try {
    const res = await f(new URL("/api/drill", base).toString(), { redirect: "manual" });
    return res.status === 401 ? pass(name) : fail(name, `HTTP ${res.status}`);
  } catch (e) {
    return fail(name, errorText(e));
  }
}

/** workers.dev が閉じている（404 か Cloudflare の 1042）。ホスト名は出力に出さない */
async function checkWorkersDev(env: CheckEnv, f: Fetch): Promise<CheckResult> {
  const name = "workers.dev 閉";
  const host = env.CHECK_WORKERS_DEV_HOST?.trim();
  if (!host) return skip(name, "CHECK_WORKERS_DEV_HOST なし");
  try {
    const res = await f(`https://${host}/api/health`, { redirect: "manual" });
    const text = await res.text().catch(() => "");
    if (res.status === 404) return pass(name, "HTTP 404");
    if (/\b1042\b/.test(text)) return pass(name, `HTTP ${res.status}（1042）`);
    return fail(name, `HTTP ${res.status}`);
  } catch (e) {
    return fail(name, `つながらない（${e instanceof Error ? e.name : "error"}）`);
  }
}

// ---------- ログインあり ----------

/** Set-Cookie からセッションの cookie（名前=値）を取る */
export function sessionFrom(res: Response): string | null {
  const all = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  for (const c of all) {
    const first = c.split(";")[0]?.trim() ?? "";
    if (first.startsWith(`${SESSION_COOKIE}=`) && first.length > SESSION_COOKIE.length + 1) return first;
  }
  return null;
}

type Session = { cookie: string };

function postForm(base: string, path: string, fields: Record<string, string>, f: Fetch, s?: Session): Promise<Response> {
  const origin = new URL(base).origin;
  return f(new URL(path, base).toString(), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin,
      ...(s ? { cookie: s.cookie } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  });
}

function postJson(base: string, path: string, json: unknown, f: Fetch, s: Session): Promise<Response> {
  const origin = new URL(base).origin;
  return f(new URL(path, base).toString(), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", accept: "application/json", origin, cookie: s.cookie },
    body: JSON.stringify(json),
  });
}

async function getPage(base: string, path: string, f: Fetch, s: Session): Promise<Response> {
  return f(new URL(path, base).toString(), { redirect: "manual", headers: { cookie: s.cookie } });
}

/** 審査員の役を選ぶ。新しい cookie と行き先 */
async function chooseRole(base: string, role: string, f: Fetch, s: Session): Promise<{ s: Session; to: string | null; status: number }> {
  const res = await postForm(base, "/api/auth/role", { role }, f, s);
  const cookie = sessionFrom(res);
  return { s: cookie ? { cookie } : s, to: redirectPath(res, base), status: res.status };
}

async function loginChecks(base: string, env: CheckEnv, f: Fetch): Promise<CheckResult[]> {
  const id = env.CHECK_LOGIN_ID?.trim();
  const password = env.CHECK_LOGIN_PASSWORD;
  if (!id || !password) return [skip("ログインあり", "CHECK_LOGIN_ID・CHECK_LOGIN_PASSWORD なし")];
  const out: CheckResult[] = [];

  // ログイン
  let s: Session;
  let home: string | null;
  try {
    const res = await postForm(base, "/api/auth/login", { id, password }, f);
    home = redirectPath(res, base);
    const cookie = sessionFrom(res);
    if (!cookie || !home || home === LOGIN_PATH) {
      out.push(fail("ログイン", `HTTP ${res.status} → ${home ?? "なし"}${res.status === 429 ? "（回数超過）" : ""}`));
      return out;
    }
    s = { cookie };
    out.push(pass("ログイン", `→ ${home}`));
  } catch (e) {
    return [fail("ログイン", errorText(e))];
  }

  // 審査員は役選択から。ケアマネ → 担当一覧、本人 → 本人のスマホ、ケアマネに戻す
  const judge = home === ROLE_SELECT_PATH;
  try {
    if (judge) {
      const cm = await chooseRole(base, "care_manager", f, s);
      s = cm.s;
      out.push(cm.to === "/" ? pass("役選択 ケアマネ", "→ /") : fail("役選択 ケアマネ", `HTTP ${cm.status} → ${cm.to ?? "なし"}`));
    }
    const list = await getPage(base, "/", f, s);
    out.push(list.status === 200 ? pass("担当一覧", "HTTP 200") : fail("担当一覧", `HTTP ${list.status}`));

    if (judge) {
      const self = await chooseRole(base, "self", f, s);
      const me = await getPage(base, "/me", f, self.s);
      out.push(
        self.to === "/me" && me.status === 200 ? pass("本人のスマホ", "HTTP 200") : fail("本人のスマホ", `→ ${self.to ?? "なし"}、HTTP ${me.status}`),
      );
      const back = await chooseRole(base, "care_manager", f, self.s);
      s = back.s;
    } else out.push(skip("本人のスマホ", "審査員の ID でない"));
  } catch (e) {
    out.push(fail("役と画面", errorText(e)));
    return out;
  }

  // 訓練 10 分版を 1 回（AI を使う）
  try {
    const start = await postJson(base, "/api/drill", { scenario: "short" }, f, s);
    const started = (await start.json().catch(() => null)) as { ok?: boolean; id?: string; error?: string } | null;
    if (start.status !== 200 || !started?.ok || !started.id) {
      out.push(fail("訓練 10 分版", `開始 HTTP ${start.status} ${started?.error ?? ""}`.trim()));
    } else {
      let step = 0;
      let status = "running";
      let n = 0;
      while (status === "running" && n < MAX_STEPS) {
        const r = await postJson(base, `/api/drill/${started.id}/step`, { step }, f, s);
        const b = (await r.json().catch(() => null)) as { ok?: boolean; step?: number; status?: string; error?: string } | null;
        if (r.status !== 200 || !b?.ok || typeof b.step !== "number") {
          status = `HTTP ${r.status} ${b?.error ?? ""}`.trim();
          break;
        }
        step = b.step;
        status = b.status ?? "running";
        n++;
      }
      out.push(status === "finished" ? pass("訓練 10 分版", `${n} 刻みで終了`) : fail("訓練 10 分版", `${n} 刻みで ${status}`));
    }
  } catch (e) {
    out.push(fail("訓練 10 分版", errorText(e)));
  }

  // 最初に戻す（確認の欄を通った形）
  try {
    const r = await postForm(base, "/office/reset", { confirm: "1" }, f, s);
    const loc = r.headers.get("location");
    const done = loc ? new URL(loc, base) : null;
    out.push(
      done?.pathname === "/office" && done.searchParams.get("reset") === "done"
        ? pass("最初に戻す", "初期化済")
        : fail("最初に戻す", `HTTP ${r.status} → ${done ? `${done.pathname}${done.search}` : "なし"}`),
    );
  } catch (e) {
    out.push(fail("最初に戻す", errorText(e)));
  }
  return out;
}

// ---------- まとめ ----------

export async function runChecks(base: string, env: CheckEnv, f: Fetch): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  out.push(...(await checkHealth(base, env, f)));
  for (const path of GUARDED_PAGES) out.push(await checkGuardedPage(base, path, f));
  out.push(await checkApiDenied(base, f));
  out.push(await checkWorkersDev(env, f));
  out.push(...(await loginChecks(base, env, f)));
  return out;
}

export function summarize(results: ReadonlyArray<CheckResult>): { pass: number; fail: number; skip: number; ok: boolean } {
  const count = (s: CheckStatus) => results.filter((r) => r.status === s).length;
  return { pass: count("PASS"), fail: count("FAIL"), skip: count("SKIP"), ok: count("FAIL") === 0 };
}

/** 1 行ずつの出力。パスワードは入らない（detail に打った値を入れていない） */
export function formatResults(results: ReadonlyArray<CheckResult>): string[] {
  const lines = results.map((r) => `${r.status} ${r.name}${r.detail ? `  ${r.detail}` : ""}`);
  const s = summarize(results);
  lines.push(`${s.ok ? "PASS" : "FAIL"}（PASS ${s.pass} / FAIL ${s.fail} / SKIP ${s.skip}）`);
  return lines;
}
