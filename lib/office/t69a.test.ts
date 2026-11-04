// T69a: 新しい人の同意を「未確認」の行で作る（利用者追加と、医療班・行政がその場で作る人）と、
// 本人のページの「スマホ入口」（発行の可否・画面の形・描いた物）、本人・家族の平時の「ふだん」の印と無効の 1 画面。
// D1 は node:sqlite に種の 10 人。Claude は呼ばない。

import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import { PhoneLinkIssueForm, PhoneLinkPanel, PhoneLinkSwitch } from "../../components/phone/PhoneLinkPanel.tsx";
import { PhoneLinkInvalid, PhoneNormalMark } from "../../components/phone/PhoneMarks.tsx";
import type { Principal } from "../auth/principal.ts";
import { showsLogout } from "../auth/roles.ts";
import { loadPersonDocument } from "../consent/documents.ts";
import { scopeOfRows } from "../consent/scope.ts";
import { receive, registerOnSite } from "../custody/store.ts";
import { CONSENT_KINDS } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { easy, kanjiWithoutRuby, yomi } from "../forms/easy-words.ts";
import { loadPersonPage, timelineItems, toPersonView } from "../person.ts";
import { PHONE_EASY, PHONE_LINK_LABELS } from "../qr/phone-labels.ts";
import { issuePhoneLinkFor } from "../qr/phone-link-http.ts";
import { issuePhoneLink, loadPhoneLinkRow } from "../qr/phone-link-store.ts";
import { buildPhoneLinkView, familyLinkContacts } from "../qr/phone-link-view.ts";
import { PHONE_LINK_TTL_SEC } from "../qr/phone-link.ts";
import { createPerson } from "./people.ts";
import { officeActor } from "./scope.ts";

const AT = "2026-11-04T01:00:00.000Z";
const NOW = Math.floor(Date.parse(AT) / 1000) + 60;
const SECRET = "test-secret-for-t69a-0123456789abcdefghij";
const ORIGIN = "https://care72.app";
const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite.exec(
    "INSERT INTO people (id, office_id, care_manager_id, name, kana, birth_date) VALUES ('p-partner-1', 'office-partner', 'acct-partner-cm', '架空 太郎', 'カクウ タロウ', '1940-01-01')",
  );
  sqlite.exec("INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-1', NULL, 'medical', '医療班 1')");
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

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
const medical = (): Principal => ({ ...yamamoto(), role: "medical", admin: false, accountId: "acct-med-1", office: null, caseloadOf: null });
const self = (): Principal => ({ ...yamamoto(), role: "self", admin: false, accountId: null, caseloadOf: null, personId: "p-01" });

const consentRows = (personId: string) =>
  sqlite.prepare("SELECT kind, status, scope, recorded_by, recorded_at, expires_at, note FROM consents WHERE person_id = ? ORDER BY kind").all(personId);

const INPUT = { name: "架空 一郎", kana: "カクウ イチロウ", birthDate: "1941-04-01", sex: "male" as const, careManagerId: "acct-yamamoto" };

describe("新しい人の同意を「未確認」で作る", () => {
  it("利用者追加: 同意の種類の全部が未確認の行で入る（時刻は足した時刻、記録した人・範囲・期限・備考は空。設計の答え 11/4）", async () => {
    for (const p of [yamamoto(), judgeCm()]) {
      const r = await createPerson(db, officeActor(p)!, INPUT, AT);
      if (!r.ok) throw new Error("足せない");
      expect(consentRows(r.id)).toEqual(
        [...CONSENT_KINDS].sort().map((kind) => ({ kind, status: "unconfirmed", scope: null, recorded_by: null, recorded_at: AT, expires_at: null, note: null })),
      );
    }
  });

  it("見え方は前（行が無い）と同じ「未確認」: 同意の区分は未確認、家族は何も見えず、医療班は本人確認だけ、経過に「同意」の行を作らない", async () => {
    const r = await createPerson(db, officeActor(yamamoto())!, INPUT, AT);
    if (!r.ok) throw new Error("足せない");
    const rows = (await loadPersonPage(db, yamamoto(), r.id))!;
    const v = toPersonView(rows, { today: "2026-11-04" });
    const consent = v.sections.find((s) => s.id === "consent")!;
    const values = consent.blocks.flatMap((b) => (b.type === "row" ? [b.row.field] : []));
    expect(values).toHaveLength(CONSENT_KINDS.length);
    for (const value of values) expect(value).toEqual({ kind: "unconfirmed" });
    expect(scopeOfRows("family", rows)).toMatchObject({ items: [], timeline: "none", documents: [] });
    expect(scopeOfRows("medical", rows)).toMatchObject({ items: ["identity"], documents: [], provision: { basis: "vital" } });
    expect(timelineItems(rows).filter((t) => t.consent)).toEqual([]);
    // 行が無い人（前からある人）と同じ範囲
    const bare = { ...rows, consents: [] };
    for (const role of ["family", "medical", "care_manager", "self"] as const) expect(scopeOfRows(role, rows), role).toEqual(scopeOfRows(role, bare));
  });

  it("事業所の外のケアマネ・停止した人を担当にした失敗では、同意の行も入らない", async () => {
    expect(await createPerson(db, officeActor(yamamoto())!, { ...INPUT, careManagerId: "acct-partner-cm" }, AT, "p-fail")).toEqual({
      ok: false,
      error: "care_manager",
    });
    expect(consentRows("p-fail")).toEqual([]);
  });

  it("その場の登録（医療班・行政）も 4 行。記録した人は空。範囲は前と同じ（その場の人は同意ありと同じ区分）", async () => {
    const actor = { accountId: "acct-med-1", role: "medical" as const, name: "医療班 1", judge: false, walled: false };
    const input = { name: "架空 ミツ", kana: "カクウ ミツ", age: 80, birthDate: null, medications: [], devices: [], contact: null, shelter: "そらみ台小学校" };
    const r = await registerOnSite(db, actor, input, AT, { personId: "p-onsite" });
    expect(r.ok).toBe(true);
    expect(consentRows("p-onsite")).toEqual(
      [...CONSENT_KINDS].sort().map((kind) => ({ kind, status: "unconfirmed", scope: null, recorded_by: null, recorded_at: AT, expires_at: null, note: null })),
    );
    const rows = (await loadPersonPage(db, medical(), "p-onsite"))!;
    expect(scopeOfRows("medical", rows)).toEqual(scopeOfRows("medical", { ...rows, consents: [] }));
    expect(scopeOfRows("medical", rows).items).toContain("medical");
  });

  it("今ある人には足さない（migration で埋めない）。もう行がある人には何もしない（INSERT OR IGNORE）", () => {
    for (const n of readFileSync(new URL("../../migrations/0018_phone_link.sql", import.meta.url), "utf8").split("\n").filter((l) => !l.startsWith("--"))) {
      expect(n).not.toMatch(/consents/i);
    }
    expect(consentRows("p-partner-1")).toEqual([]);
    const src = readFileSync(new URL("../consent/unconfirmed.ts", import.meta.url), "utf8");
    expect(src).toContain("INSERT OR IGNORE INTO consents");
  });
});

describe("スマホ入口の発行（ケアマネだけ）", () => {
  it("ケアマネ・審査員のケアマネの役は発行でき、版が上がる。医療班・本人・ログインなしは断る", async () => {
    expect(await issuePhoneLinkFor(db, yamamoto(), "p-01", AT)).toEqual({ ok: true, personId: "p-01", generation: 1 });
    expect(await issuePhoneLinkFor(db, judgeCm(), "p-01", AT)).toEqual({ ok: true, personId: "p-01", generation: 2 });
    expect(await issuePhoneLinkFor(db, medical(), "p-01", AT)).toEqual({ ok: false, error: "forbidden" });
    expect(await issuePhoneLinkFor(db, self(), "p-01", AT)).toEqual({ ok: false, error: "forbidden" });
    expect(await issuePhoneLinkFor(db, null, "p-01", AT)).toEqual({ ok: false, error: "login_required" });
    expect(await issuePhoneLinkFor(db, yamamoto({ role: "unselected" }), "p-01", AT)).toEqual({ ok: false, error: "forbidden" });
  });

  it("事業所の外・無い人は 404、一覧から外した人は 409（戻せば発行できる）", async () => {
    expect(await issuePhoneLinkFor(db, yamamoto(), "p-partner-1", AT)).toEqual({ ok: false, error: "not_found" });
    expect(await issuePhoneLinkFor(db, yamamoto(), "p-99", AT)).toEqual({ ok: false, error: "not_found" });
    sqlite.exec(`UPDATE people SET unlisted_at = '${AT}' WHERE id = 'p-02'`);
    expect(await issuePhoneLinkFor(db, yamamoto(), "p-02", AT)).toEqual({ ok: false, error: "unlisted" });
    expect((await loadPhoneLinkRow(db, "p-02"))?.phone_link_generation).toBe(0);
  });

  it("書類の範囲: ケアマネは開ける。医療班は受け入れても開けない（範囲に無い）", async () => {
    expect(await loadPersonDocument(db, yamamoto(), "p-01", "phone")).not.toBeNull();
    await receive(db, { accountId: "acct-med-1", role: "medical", name: "医療班 1", judge: false, walled: false }, { personId: "p-01", shelter: "そらみ台小学校", via: "search" }, AT);
    expect(await loadPersonDocument(db, medical(), "p-01", "medical")).not.toBeNull();
    expect(await loadPersonDocument(db, medical(), "p-01", "phone")).toBeNull();
  });

  it("画面の頁はケアマネの役だけ・範囲は phone の書類・本人の名前を題に入れない", () => {
    const src = readFileSync(new URL("../../app/people/[id]/phone/page.tsx", import.meta.url), "utf8");
    expect(src).toContain('requirePage("person")');
    expect(src).toContain('principal.role !== "care_manager"');
    expect(src).toContain('loadPersonDocument(env.DB, principal, id, "phone")');
    expect(src).toContain("title: PHONE_LINK_LABELS.title");
    expect(src).toContain("index: false");
    const api = readFileSync(new URL("../../app/api/people/[id]/phone/route.ts", import.meta.url), "utf8");
    expect(api).toContain("isSameOrigin(request)");
    expect(api).toContain("issuePhoneLinkFor(");
  });
});

describe("スマホ入口の画面の形", () => {
  async function view(personId = "p-01", now = NOW) {
    const rows = (await loadPersonPage(db, yamamoto(), personId))!;
    return buildPhoneLinkView(rows, (await loadPhoneLinkRow(db, personId))!, { now, origin: ORIGIN, secret: SECRET });
  }

  it("家族用は答えられる連絡先だけ（本人の電話・機関は出さない）。スマホ 使用可を上、そのあと緊急連絡先の順", async () => {
    const rows = (await loadPersonPage(db, yamamoto(), "p-02"))!;
    const kinds = familyLinkContacts(rows).map((c) => c.kind);
    expect(kinds.every((k) => ["family", "supporter", "welfare_commissioner"].includes(k))).toBe(true);
    expect(rows.contacts.some((c) => c.kind === "oxygen_supplier")).toBe(true);
    // 1 山田: 娘（スマホ 使用可・緊急 1）→ 隣人（スマホ なし・緊急 2）。並びを入れ替えても同じ。印は本人と同じ形（T77）
    sqlite.exec("UPDATE contacts SET emergency_order = 1 WHERE id = 'c-01-2'; UPDATE contacts SET emergency_order = 2 WHERE id = 'c-01-1'");
    const v = await view();
    expect(v.family.map((f) => [f.key, f.relation, f.smartphone])).toEqual([
      ["c-01-1", "娘", "スマホ 使用可"],
      ["c-01-2", "隣人", "スマホ なし"],
    ]);
    expect(v.self).toMatchObject({ key: "self", kind: "self", name: "山田 ハナ", relation: null, smartphone: "スマホ 使用可" });
  });

  it("未発行は URL なし。発行すると本人用と家族用の URL（/s/<token>）。期限切れ・一覧外は URL を出さない", async () => {
    let v = await view();
    expect(v.state.status).toBe("none");
    expect([v.self, ...v.family].every((i) => i.url === null)).toBe(true);
    await issuePhoneLink(db, { officeId: "office-demo", authorId: "acct-yamamoto" }, "p-01", AT);
    v = await view();
    expect(v.state.status).toBe("active");
    for (const i of [v.self, ...v.family]) expect(i.url, i.key).toMatch(/^https:\/\/care72\.app\/s\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(new Set([v.self, ...v.family].map((i) => i.url)).size).toBe(3);
    expect((await view("p-01", NOW + PHONE_LINK_TTL_SEC)).self.url).toBeNull();
    sqlite.exec(`UPDATE people SET unlisted_at = '${AT}' WHERE id = 'p-01'`);
    const u = await view();
    expect(u.unlisted).toBe(true);
    expect(u.self.url).toBeNull();
  });

  it("描いた物: 発行は操作の色、使えるリンクがあるときの再発行は赤。URL は文字（押して開くリンクにしない）、QR は白地の画像", async () => {
    const before = renderToStaticMarkup(createElement(PhoneLinkIssueForm, { view: await view() }));
    expect(before).toContain(PHONE_LINK_LABELS.issue);
    expect(before).toContain("bg-accent");
    expect(before).toContain(`action="/api/people/p-01/phone"`);
    await issuePhoneLink(db, { officeId: "office-demo", authorId: "acct-yamamoto" }, "p-01", AT);
    const v = await view();
    const after = renderToStaticMarkup(createElement(PhoneLinkIssueForm, { view: v }));
    expect(after).toContain(PHONE_LINK_LABELS.reissue);
    expect(after).toContain("text-danger");
    const html = renderToStaticMarkup(createElement(PhoneLinkPanel, { view: v }));
    for (const w of [PHONE_LINK_LABELS.self, PHONE_LINK_LABELS.family, "山田 ハナ", "森 恵子", "木村 ヨシ", "コピー"]) expect(html, w).toContain(w);
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/care72\.app\/s\//);
    expect(html.match(/data-phone-link-qr/g)).toHaveLength(3);
    expect(html).toContain('src="data:image/svg+xml');
    expect(html).toContain(`alt="${PHONE_LINK_LABELS.self} QR"`);
    // 避ける型（等幅・details の▼・ピル型）は使わない
    for (const bad of ["font-mono", "<details", "rounded-full"]) expect(html, bad).not.toContain(bad);
    // 一覧外の人には発行のボタンを出さない
    sqlite.exec(`UPDATE people SET unlisted_at = '${AT}' WHERE id = 'p-01'`);
    expect(renderToStaticMarkup(createElement(PhoneLinkIssueForm, { view: await view() }))).toBe("");
  });

  it("画面の言葉は短い漢語。使わない語（診断・判定・重症・緊急度・札）が無い", () => {
    for (const w of Object.values(PHONE_LINK_LABELS)) {
      expect(w.length, w).toBeLessThanOrEqual(5);
      for (const bad of ["診断", "判定", "重症", "緊急度", "札"]) expect(w).not.toContain(bad);
    }
  });
});

describe("本人・家族の画面（やさしい日本語）", () => {
  it("平時の印は事業所名と「ふだん」だけ（文にしない・色を付けない）。漢字には全部ふりがな", () => {
    const html = renderToStaticMarkup(createElement(PhoneNormalMark, { office: "デモ事業所" }));
    // 事業所名も読みの表でふりがな（本人の 1 枚の電話の段と同じ）
    expect(html).toContain("デモ<ruby>事業所<rp>（</rp><rt>じぎょうしょ</rt><rp>）</rp></ruby>");
    expect(kanjiWithoutRuby(yomi("デモ事業所").words)).toEqual([]);
    expect(html).toContain("<ruby>普段<rp>（</rp><rt>ふだん</rt><rp>）</rp></ruby>");
    expect(html).not.toContain("data-tone");
    expect(kanjiWithoutRuby(easy(PHONE_EASY.normal))).toEqual([]);
    for (const page of ["app/me/page.tsx", "app/family/page.tsx"]) {
      const src = readFileSync(new URL(`../../${page}`, import.meta.url), "utf8");
      expect(src, page).toContain("<PhoneNormalMark office={office?.name ?? null} />");
      // 119 の 1 行と災害モードの画面は触らない（PhoneSheet・PhoneDisaster・FamilyDisaster はそのまま）
      expect(src.indexOf("<PhoneNormalMark")).toBeLessThan(src.indexOf("<PhoneSheet"));
    }
  });

  it("無効の 1 画面は「無効」と「ケアマネに連絡」だけ。誰のリンクかを出さない", () => {
    const html = renderToStaticMarkup(createElement(PhoneLinkInvalid));
    expect(html).toContain("<ruby>無効<rp>（</rp><rt>むこう</rt><rp>）</rp></ruby>");
    // 本人のスマホの頁の問いと同じ大きな字（説明は足さない）
    expect(html).toMatch(/text-\[2rem\][^"]*font-bold[^>]*data-tone="unknown"><ruby>無効/);
    expect(html).toContain("ケアマネに <ruby>連絡");
    for (const w of [PHONE_EASY.invalid, PHONE_EASY.callCareManager]) expect(kanjiWithoutRuby(easy(w))).toEqual([]);
    const page = readFileSync(new URL("../../app/s/invalid/page.tsx", import.meta.url), "utf8");
    expect(page).toContain("index: false");
    expect(page).toContain('referrer: "no-referrer"');
  });
});

describe("ログイン中の 1 枚とログアウト（設計の答え 11/4）", () => {
  it("ログイン中の 1 枚: 「切替」は赤で POST /s/<token>、「戻る」は今の役の入口。誰のリンクかは出さない", () => {
    const html = renderToStaticMarkup(createElement(PhoneLinkSwitch, { token: "abc.def", who: "管理者 山本", back: "/" }));
    expect(html).toContain(PHONE_LINK_LABELS.loggedIn);
    expect(html).toContain("管理者 山本");
    expect(html).toContain(`action="/s/abc.def"`);
    expect(html).toContain('method="post"');
    expect(html).toMatch(/text-danger[^>]*>.*切替/s);
    expect(html).toContain('href="/"');
    expect(html).toContain(PHONE_LINK_LABELS.back);
    expect(html).not.toContain("山田");
  });

  it("本人・家族の頁にログアウトを置かない（審査員の本人・家族も。役変更で戻る）。ほかの役は今までどおり", () => {
    expect(showsLogout("self")).toBe(false);
    expect(showsLogout("family")).toBe(false);
    for (const r of ["care_manager", "government", "medical", "unselected"] as const) expect(showsLogout(r), r).toBe(true);
    const header = readFileSync(new URL("../../components/AppHeader.tsx", import.meta.url), "utf8");
    expect(header).toMatch(/\{showsLogout\(p\.role\) && \(\s*<form method="post" action="\/api\/auth\/logout">/);
  });
});
