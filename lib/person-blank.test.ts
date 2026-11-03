// 本人のページの「未確認」と「未入力」（T79、11/4 の点検の中 11）。上の「未確認 N」が数える物（台帳の pending）と、
// 欄に「未確認」と出る物をそろえる。まだ誰も入れていない欄は「未入力」で数えない。同意の未確認・値の無い時計は状態の「未確認」のまま。
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PersonView } from "../components/person/PersonView.tsx";
import { seedStatements } from "../seed/sql.ts";
import type { Principal } from "./auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "./db/test-d1.ts";
import { createPerson } from "./office/people.ts";
import { officeActor } from "./office/scope.ts";
import { loadPersonPage, toPersonView } from "./person.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const yamamoto = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});

const AT = "2026-11-04T01:00:00.000Z";
const count = (html: string, word: string) => html.split(word).length - 1;

/** 区分の HTML（data-section の面）。無ければ空 */
function sectionHtml(html: string, id: string): string {
  const start = html.indexOf(`aria-labelledby="person-`);
  if (start < 0) return "";
  const m = new RegExp(`<section[^>]*aria-labelledby="person-[^"]*-${id}"[\\s\\S]*?</section>`).exec(html);
  return m ? m[0] : "";
}

describe("未確認と未入力（T79）", () => {
  it("新しく足した人: 上は「未確認 0」、欄は「未入力」。「未確認」の字は同意の区分（状態）にだけ出る", async () => {
    const r = await createPerson(db, officeActor(yamamoto())!, { name: "架空 一郎", kana: "カクウ イチロウ", birthDate: "1941-04-01", sex: "male", careManagerId: "acct-yamamoto" }, AT);
    if (!r.ok) throw new Error("足せない");
    const v = toPersonView((await loadPersonPage(db, yamamoto(), r.id))!, { today: "2026-11-04" });
    expect(v.head.unconfirmed).toBe(0);
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(count(html, "未入力")).toBeGreaterThan(10);
    const consent = sectionHtml(html, "consent");
    expect(consent).not.toBe("");
    // 同意の 5 種類は状態の「未確認」
    expect(count(consent, "未確認")).toBe(5);
    // 同意の区分の外の「未確認」は上の数え（0）の見出しの 1 つだけ
    expect(count(html.replace(consent, ""), "未確認")).toBe(1);
  });

  it("pending のある欄は「未確認」と理由で、上と区分の見出しに数える（種の人）", async () => {
    const rows = (await loadPersonPage(db, yamamoto(), "p-01"))!;
    const pending = rows.person.ledger ? JSON.parse(rows.person.ledger).pending?.length ?? 0 : 0;
    const v = toPersonView(rows, { today: "2026-11-04" });
    expect(v.head.unconfirmed).toBe(pending);
    expect(v.sections.reduce((n, s) => n + s.unconfirmed, 0)).toBe(pending);
  });
});
