// 初めて入った管理者の準備の欄（docs/tasks/T98.md）と、担当一覧の 0 人のとき。
// 数える関数（lib/office/setup.ts）・事業所の画面の欄（components/office/SetupPanel.tsx）・担当一覧の「なし」（components/office/CaseloadEmpty.tsx）。
// 手元の D1（node:sqlite）に new-office.ts の事業所を入れ、地域・ケアマネ・利用者を 1 つずつ済ませて行が消えるのを見る。

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CaseloadEmpty } from "../../components/office/CaseloadEmpty.tsx";
import { SetupPanel } from "../../components/office/SetupPanel.tsx";
import { chooseJudgeRole, login, type Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { SEED_ACCOUNTS, SEED_OFFICES, SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import { listCareManagers, listOfficePeople, createPerson } from "./people.ts";
import { savePlace } from "./place.ts";
import { officeActor } from "./scope.ts";
import {
  canSeeSetup,
  isSetupLater,
  loadOfficeCenter,
  SETUP_LATER_COOKIE,
  setupItems,
  setupLaterCookie,
  type SetupInput,
  type SetupItem,
} from "./setup.ts";
import { addCareManager } from "./staff.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const SECRET = "test-secret-0123456789-0123456789-abcdef";
const NOW = 1_800_000_000;
const AT = "2026-11-04T09:00:00.000Z";
const TODAY = "2026-11-04";

const cm = (disabled = false) => ({ disabled });
const person = (careManagerId: string | null, unlistedAt: string | null = null) => ({ careManagerId, unlistedAt });
const input = (p: Partial<SetupInput> = {}): SetupInput => ({
  center: { lat: 33.9, lng: 133.0 },
  careManagers: [cm(), cm()],
  people: [person("acct-a")],
  careManagerLater: false,
  ...p,
});
const kinds = (items: SetupItem[]) => items.map((i) => i.kind);

describe("準備の残りを数える（lib/office/setup.ts）", () => {
  it("全部済み: 何も出さない", () => {
    expect(setupItems(input())).toEqual([]);
  });

  it("地域なし: 「地域 未設定」で地域の区分へ", () => {
    expect(setupItems(input({ center: null }))).toEqual([
      { kind: "place", label: "地域", status: "未設定", count: null, href: "#office-place" },
    ]);
  });

  it("ケアマネ 1（管理者だけ）: 「ケアマネ追加」でケアマネの区分へ。停止した人は数えない。後でを押せば出さない", () => {
    expect(setupItems(input({ careManagers: [cm()] }))).toEqual([
      { kind: "care_manager", label: "ケアマネ追加", status: null, count: null, href: "#care-managers" },
    ]);
    expect(kinds(setupItems(input({ careManagers: [cm(), cm(true)] })))).toEqual(["care_manager"]);
    expect(setupItems(input({ careManagers: [cm()], careManagerLater: true }))).toEqual([]);
  });

  it("利用者 0: 「利用者追加」で担当の区分へ。外した人だけなら 0 と数える", () => {
    expect(setupItems(input({ people: [] }))).toEqual([
      { kind: "people", label: "利用者追加", status: null, count: null, href: "#assign" },
    ]);
    expect(kinds(setupItems(input({ people: [person("acct-a", AT)] })))).toEqual(["people"]);
  });

  it("担当なし N: 「担当 未割当 N」。外した人は数えない", () => {
    expect(setupItems(input({ people: [person(null), person("acct-a"), person(null), person(null, AT)] }))).toEqual([
      { kind: "assign", label: "担当", status: "未割当", count: 2, href: "#assign" },
    ]);
  });

  it("まっさらの事業所: 地域・ケアマネ・利用者の順に 3 つ（担当は利用者がいないので出ない）", () => {
    expect(kinds(setupItems({ center: null, careManagers: [cm()], people: [], careManagerLater: false }))).toEqual([
      "place",
      "care_manager",
      "people",
    ]);
  });

  it("デモ事業所の種は全部済んでいる（中心あり・ケアマネ 2・10 人全員に担当）", () => {
    const demo = SEED_OFFICES.find((o) => o.id === "office-demo")!;
    const items = setupItems({
      center: demo.center_lat != null && demo.center_lng != null ? { lat: demo.center_lat, lng: demo.center_lng } : null,
      careManagers: SEED_ACCOUNTS.filter((a) => a.office_id === demo.id && a.role === "care_manager").map(() => cm()),
      people: SEED_PEOPLE.filter((p) => p.person.office_id === demo.id).map((p) => person(p.person.care_manager_id ?? null)),
      careManagerLater: false,
    });
    expect(items).toEqual([]);
  });

  it("後での cookie: 同じ事業所の id のときだけ効く。/office の下だけに送る", () => {
    expect(isSetupLater("office-abc", "office-abc")).toBe(true);
    expect(isSetupLater("office-other", "office-abc")).toBe(false);
    expect(isSetupLater(undefined, "office-abc")).toBe(false);
    const c = setupLaterCookie("office-abc");
    expect(c.startsWith(`${SETUP_LATER_COOKIE}=office-abc;`)).toBe(true);
    expect(c).toContain("Path=/office");
    expect(c).toMatch(/Max-Age=\d+/);
  });
});

describe("準備の欄の描き（components/office/SetupPanel.tsx）", () => {
  const render = (items: SetupItem[]) => renderToStaticMarkup(createElement(SetupPanel, { items, laterCookie: setupLaterCookie("office-x") }));

  it("全部済みなら欄ごと出さない", () => {
    expect(render([])).toBe("");
  });

  it("残りの行を言葉と数で、押すと区分の id へ。後ではケアマネの行だけ。色の枠・黄の印・印刷は無し", () => {
    const html = render(setupItems({ center: null, careManagers: [cm()], people: [person(null)], careManagerLater: false }));
    expect(html).toContain("data-setup");
    expect(html).toContain("print:hidden");
    expect(html).toMatch(/準備<\/h2>/);
    expect(html).toMatch(/残り <span[^>]*>3<\/span>/);
    const rows = [...html.matchAll(/<li[^>]*data-setup-item="([a-z_]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
      kind: m[1],
      href: /href="([^"]+)"/.exec(m[2])?.[1],
      text: m[2].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      later: m[2].includes("data-setup-later"),
    }));
    expect(rows).toEqual([
      { kind: "place", href: "#office-place", text: "地域 未設定", later: false },
      { kind: "care_manager", href: "#care-managers", text: "ケアマネ追加 後で", later: true },
      { kind: "assign", href: "#assign", text: "担当 未割当 1", later: false },
    ]);
    expect(html).not.toContain("tone-check");
    expect(html).not.toContain('data-tone="check"');
    expect(html).not.toContain("style=");
    expect(html).not.toMatch(/\b(outline|ring|border)-/);
    // 番号のラベル（01・02）を付けない
    expect(html).not.toMatch(/>0\d</);
  });
});

describe("担当一覧の 0 人（components/office/CaseloadEmpty.tsx）", () => {
  it("管理者で 0 人なら「なし」の横に「利用者追加」の主のボタン、ほかは「なし」だけ", () => {
    const add = renderToStaticMarkup(createElement(CaseloadEmpty, { addPerson: true }));
    expect(add).toContain('data-empty="add"');
    expect(add).toContain("なし");
    expect(add).toMatch(/<a[^>]*href="\/people\/new"[^>]*>[\s\S]*利用者追加[\s\S]*<\/a>/);
    expect(add).toContain("bg-accent-fill");

    const none = renderToStaticMarkup(createElement(CaseloadEmpty, { addPerson: false }));
    expect(none).toMatch(/<p[^>]*data-empty="true"[^>]*>なし<\/p>/);
    expect(none).not.toContain("<a");
  });
});

describe("準備の欄を見る人", () => {
  it("事業所の管理者だけ。管理者でないケアマネ・医療班・審査員のケアマネの役には出さない", async () => {
    expect(canSeeSetup({ role: "care_manager", admin: true })).toBe(true);
    expect(canSeeSetup({ role: "care_manager", admin: false })).toBe(false);
    expect(canSeeSetup({ role: "medical", admin: true })).toBe(false);
    expect(canSeeSetup(null)).toBe(false);

    // 審査員のケアマネの役: 事業所の画面の officeActor の admin は真（ケアマネの管理はできる）が、準備の欄は出さない
    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    const env = { JUDGE_PASSWORD: "judge-plain-password-01" };
    const r = await login(d1FromSqlite(db), env, SECRET, { loginId: "judge", password: env.JUDGE_PASSWORD }, NOW);
    if (!r.ok) throw new Error("審査員で入れない");
    const chosen = await chooseJudgeRole(d1FromSqlite(db), env, SECRET, r.token, "care_manager", NOW);
    const judge = chosen!.principal;
    expect(judge.role).toBe("care_manager");
    expect(officeActor(judge)?.admin).toBe(true);
    expect(canSeeSetup(judge)).toBe(false);
  });
});

describe("手元の D1 で 1 つずつ済ませる（new-office.ts の試しの事業所）", () => {
  it("地域・ケアマネ・利用者の順に済ませると行が消え、最後に欄が出なくなる", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "t98-office-")), "office.sql");
    const script = fileURLToPath(new URL("../../tools/office/new-office.ts", import.meta.url));
    const made = spawnSync(
      process.execPath,
      [script, "--name", "架空居宅介護支援", "--city", "今治市", "--login-id", "sato", "--display-name", "佐藤", "--id", "office-t98", "--out", out],
      { encoding: "utf8", timeout: 60_000 },
    );
    expect(made.status, made.stderr).toBe(0);
    const password = /: (\S+)$/.exec(made.stdout.trim())![1];

    const db = migratedSqlite();
    for (const s of seedStatements()) db.exec(s);
    db.exec(readFileSync(out, "utf8"));
    const d1 = d1FromSqlite(db);
    const res = await login(d1, {}, SECRET, { loginId: "sato", password }, NOW);
    if (!res.ok) throw new Error("管理者で入れない");
    const admin: Principal = res.principal;
    expect(canSeeSetup(admin)).toBe(true);
    const actor = officeActor(admin)!;

    const now = async (later = false) =>
      kinds(
        setupItems({
          center: await loadOfficeCenter(d1, "office-t98"),
          careManagers: await listCareManagers(d1, "office-t98"),
          people: await listOfficePeople(d1, "office-t98", TODAY),
          careManagerLater: later,
        }),
      );

    expect(await now()).toEqual(["place", "care_manager", "people"]);

    // 地域（事業所の画面の「地域」の保存と同じ関数）
    expect(await savePlace(d1, admin, { city: "今治市", center: { lat: 34.066, lng: 132.998 } })).toEqual({ ok: true });
    expect(await now()).toEqual(["care_manager", "people"]);

    // 1 人で回すなら後で（ケアマネの行だけ消える）
    expect(await now(true)).toEqual(["people"]);

    // ケアマネ追加
    const added = await addCareManager(d1, actor, { displayName: "田中", loginId: "tanaka" }, AT, { iterations: 1000 });
    expect(added.ok).toBe(true);
    expect(await now()).toEqual(["people"]);

    // 利用者追加（担当は自分）
    const p = await createPerson(d1, actor, { name: "架空 太郎", kana: "カクウ タロウ", birthDate: "1940-01-01", sex: "male", careManagerId: admin.accountId! }, AT);
    expect(p.ok).toBe(true);
    expect(await now()).toEqual([]);

    // 担当の無い人（担当の列が空の行）が出れば「担当 未割当」
    db.prepare("UPDATE people SET care_manager_id = NULL WHERE office_id = 'office-t98'").run();
    expect(await now()).toEqual(["assign"]);
  });
});
