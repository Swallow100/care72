import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { QrSummary } from "../../components/qr/QrSummary.tsx";
import { QrInvalid, QrReceive, QrWithheld } from "../../components/qr/QrStates.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { MEDICAL_FIELDS } from "../forms/medical-summary.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { QR_LABELS } from "./labels.ts";
import { currentQrToken, issueQr, resolveQrToken } from "./store.ts";
import { qrViewOf } from "./timeline.ts";
import { originFromHeaders, qrUrl } from "./url.ts";
import {
  buildQrPage,
  loadQrPerson,
  medicalConsentOf,
  QR_FIELDS,
  QR_HIDDEN_KEYS,
  qrViewBody,
  qrViewLog,
  recordQrView,
  shownFields,
  type QrPage,
} from "./view.ts";

const SECRET = "test-secret-for-qr-view-0123456789abcdef";
const TODAY = "2026-11-04";
const NOW_ISO = "2026-11-04T02:20:00.000Z"; // 11/4 11:20 JST
const EXPIRES = "2027-02-02T02:20:00.000Z";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});

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
const judgeMedical: Principal = {
  role: "medical",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: null,
  office: { id: "office-demo", name: "デモ事業所", kind: "demo" },
  caseloadOf: null,
  personId: null,
  contactId: null,
};

async function pageOf(id: string): Promise<QrPage> {
  const person = (await loadQrPerson(db, id))!;
  return buildQrPage(person.rows, { today: TODAY, officeName: person.officeName });
}
const summaryHtml = (page: QrPage) => {
  if (page.kind !== "sheet") throw new Error(`要約が出ない: ${page.kind}`);
  return renderToStaticMarkup(createElement(QrSummary, { sheet: page.sheet, expiresAt: EXPIRES }));
};

/** QR の頁を開いたのと同じ流れ（トークン → 本人 → 頁 → 記録） */
async function open(token: string, principal: Principal | null, nowIso = NOW_ISO): Promise<QrPage | null> {
  const hit = await resolveQrToken(db, SECRET, token, Date.parse(nowIso) / 1000);
  const person = hit ? await loadQrPerson(db, hit.p) : null;
  if (!hit || !person) return null;
  const page = buildQrPage(person.rows, { today: TODAY, officeName: person.officeName });
  await recordQrView(db, { personId: hit.p, generation: hit.g, principal, page, consent: medicalConsentOf(person.rows), nowIso });
  return page;
}

async function tokenOf(id: string, at = NOW_ISO): Promise<string> {
  const row = (await issueQr(db, id, at))!;
  return (await currentQrToken(id, row, SECRET))!;
}

const qrRows = () =>
  sqlite
    .prepare("SELECT * FROM timeline_entries WHERE payload LIKE '%qr_view%' ORDER BY occurred_at, id")
    .all() as Array<Record<string, string | null>>;

describe("出す範囲（医療要約から氏名の全部と住所を除く）", () => {
  it("出す欄は要約の順のまま、氏名（漢字等）と住所だけが無い", () => {
    const all = MEDICAL_FIELDS.map((f) => f.key as string);
    expect(QR_FIELDS.map((f) => f.key)).toEqual(all.filter((k) => !(QR_HIDDEN_KEYS as readonly string[]).includes(k)));
    expect(QR_HIDDEN_KEYS).toEqual(["patient.name", "patient.address"]);
  });

  it("山田 ハナ: 氏名カナと生年月日まで出し、漢字の氏名・市・町名は出さない", async () => {
    const page = await pageOf("p-01");
    expect(page.kind).toBe("sheet");
    const html = summaryHtml(page);
    expect(html).toContain("ヤマダ ハナ");
    expect(html).toContain("1942 年 4 月 18 日");
    expect(html).toContain("19420418Fヤマダハナ");
    expect(html).not.toContain("山田");
    expect(html).not.toContain("松山市");
    expect(html).not.toContain("かわなぎ町");
    // 値の側にも持たない
    if (page.kind !== "sheet") return;
    expect(JSON.stringify(page.sheet)).not.toContain("山田");
    expect(JSON.stringify(page.sheet)).not.toContain("かわなぎ町");
    expect(shownFields(page)).not.toContain("patient.name");
    expect(shownFields(page)).not.toContain("patient.address");
  });

  it("山田 ハナ: 医療班が要る物（ワーファリンと中断注意、在宅酸素、連絡先の電話、未確認）は出す", async () => {
    const html = summaryHtml(await pageOf("p-01"));
    expect(html).toContain("ワーファリン");
    expect(html).toContain("中断注意");
    expect(html).toContain("在宅酸素療法（HOT）");
    expect(html).toContain("090-0000-0011");
    expect(html).toContain("かわなぎ小学校");
    expect(html).toContain(`data-pending-list="`);
    // 紙面と同じ順: カナ → 生年月日 → 避難先 → 禁忌 → 特記 → 常用薬 → メディカル ID
    const at = (k: string) => html.indexOf(`data-field="${k}"`);
    const order = ["patient.kana", "patient.birth", "shelter.first", "contra.allergy", "drug.anticoagulant", "meds.list", "id.medical"];
    for (let i = 1; i < order.length; i++) expect(at(order[i]), order[i]).toBeGreaterThan(at(order[i - 1]));
  });

  it("渡辺 清（医療班提供 不同意）: 「同意なし」だけ。カナ・薬・電話・町名・同意の記録の人も出さない", async () => {
    const page = await pageOf("p-09");
    expect(page).toEqual({ kind: "refused" });
    const html = renderToStaticMarkup(createElement(QrWithheld, { kind: "refused" }));
    expect(html).toContain("同意なし");
    for (const s of ["ワタナベ", "渡辺", "降圧薬", "090-0000", "そらみ台", "山本", "1944"]) expect(html).not.toContain(s);
  });

  it("医療班提供が未確認（保留）の人は「未確認」だけ", async () => {
    sqlite.exec("UPDATE consents SET status = 'unconfirmed' WHERE person_id = 'p-01' AND kind = 'medical'");
    const page = await pageOf("p-01");
    expect(page).toEqual({ kind: "unconfirmed" });
    const html = renderToStaticMarkup(createElement(QrWithheld, { kind: "unconfirmed" }));
    expect(html).toContain("未確認");
    expect(html).not.toContain("ヤマダ");
  });

  it("無効の頁は「無効」だけ", () => {
    const html = renderToStaticMarkup(createElement(QrInvalid));
    expect(html).toContain(QR_LABELS.invalid);
    expect(html.replace(/<[^>]+>/g, "")).toBe(QR_LABELS.invalid);
  });

  it("受入の入口（T23）はトークンと避難所を /staff/receive へ送るフォーム。本人の id は載せない", () => {
    const html = renderToStaticMarkup(createElement(QrReceive, { token: "tok.sig", shelter: "みどり小学校" }));
    expect(html).toContain(QR_LABELS.receive);
    expect(QR_LABELS.receive).toBe("受入");
    expect(html).toContain('action="/staff/receive"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="token" value="tok.sig"');
    expect(html).toContain('name="shelter"');
    expect(html).toContain('value="みどり小学校"');
    // 押せる（disabled の属性が無い）。class の disabled: は押せないときの見た目なので数えない
    expect(html).not.toMatch(/<(button|input)[^>]*\sdisabled(=|\s|>)/);
    expect(html).toMatch(/<button[^>]*type="submit"/);
    expect(html).not.toContain("p-01");
  });
});

describe("閲覧の記録（相手・範囲・時刻）", () => {
  it("ログインなしで開くと経過に 1 行。相手なし・範囲は要約・時刻。画面は「QR 閲覧」「未ログイン」", async () => {
    const t = await tokenOf("p-01");
    expect((await open(t, null))?.kind).toBe("sheet");
    const rows = qrRows();
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({ person_id: "p-01", author_id: null, author_role: "system", kind: "note", occurred_at: NOW_ISO });
    expect(r.body).toBe(qrViewBody("medical_summary", "granted"));
    const p = qrViewOf({ kind: "note", payload: r.payload })!;
    expect(p).toMatchObject({ source: "qr_view", generation: 1, recipient: null, scope: "medical_summary", consent: "granted" });
    expect(p.fields).toContain("patient.kana");
    expect(p.fields).not.toContain("patient.name");
    expect(p.fields).not.toContain("patient.address");

    const view = (await loadPersonPage(db, careManager, "p-01"))!;
    const item = timelineItems(view).find((i) => i.id === r.id)!;
    expect(item).toMatchObject({ kind: QR_LABELS.view, who: QR_LABELS.anonymous, when: "2026-11-04 11:20" });
  });

  it("医療班でログインしていれば誰が（審査員の医療班の役は 医療班 審査員）", async () => {
    const t = await tokenOf("p-01");
    await open(t, judgeMedical);
    const r = qrRows()[0];
    expect(r).toMatchObject({ author_id: "acct-judge", author_role: "medical" });
    const p = qrViewOf({ kind: "note", payload: r.payload })!;
    expect(p.recipient).toEqual({ role: "medical", accountId: "acct-judge", name: null, judge: true });
    const view = (await loadPersonPage(db, careManager, "p-01"))!;
    expect(timelineItems(view).find((i) => i.id === r.id)).toMatchObject({ kind: QR_LABELS.view, who: "医療班 審査員" });
  });

  it("同意のない人を開いても残す（範囲は表示なし、出した欄は空）", async () => {
    const t = await tokenOf("p-09");
    expect(await open(t, null)).toEqual({ kind: "refused" });
    const r = qrRows()[0];
    expect(r.person_id).toBe("p-09");
    expect(r.body).toBe("範囲 表示なし 医療班提供 不同意");
    expect(qrViewOf({ kind: "note", payload: r.payload })).toMatchObject({ scope: "none", consent: "refused", fields: [] });
  });

  it("作り直した前の版・期限切れのトークンは無効で、経過に残さない", async () => {
    const old = await tokenOf("p-01", "2026-08-01T00:00:00.000Z");
    expect(await open(old, null)).toBeNull(); // 90 日を過ぎた
    const t1 = await tokenOf("p-01");
    await tokenOf("p-01", "2026-11-04T02:21:00.000Z"); // 作り直す（t1 は前の版になる）
    expect(await open(t1, judgeMedical)).toBeNull();
    expect(await open("not-a-token", null)).toBeNull();
    expect(qrRows()).toHaveLength(0);
  });

  it("開くたびに残る（時刻の順）", async () => {
    const t = await tokenOf("p-01");
    await open(t, judgeMedical, "2026-11-04T02:25:00.000Z");
    await open(t, null, "2026-11-04T02:21:00.000Z");
    expect(qrRows().map((r) => [r.author_role, r.occurred_at])).toEqual([
      ["system", "2026-11-04T02:21:00.000Z"],
      ["medical", "2026-11-04T02:25:00.000Z"],
    ]);
  });

  it("ほかの経過（自由文の記録）は「QR 閲覧」にしない", async () => {
    sqlite.exec(
      `INSERT INTO timeline_entries (id, person_id, author_role, kind, body, payload, occurred_at)
       VALUES ('tl-x', 'p-01', 'care_manager', 'note', 'メモ', '{"source":"other"}', '${NOW_ISO}')`,
    );
    const view = (await loadPersonPage(db, careManager, "p-01"))!;
    expect(timelineItems(view).find((i) => i.id === "tl-x")?.kind).toBe("記録");
    expect(qrViewLog(view)).toEqual([]);
  });

  it("本人のページの QR の画面の閲覧記録: 新しい順に 時刻・相手・範囲・版", async () => {
    const t1 = await tokenOf("p-01", "2026-11-04T01:00:00.000Z");
    await open(t1, null, "2026-11-04T01:10:00.000Z");
    const t2 = await tokenOf("p-01", "2026-11-04T02:00:00.000Z");
    await open(t2, judgeMedical, "2026-11-04T02:20:00.000Z");
    const view = (await loadPersonPage(db, careManager, "p-01"))!;
    expect(qrViewLog(view).map(({ id: _id, ...v }) => v)).toEqual([
      { when: "2026-11-04 11:20", who: "医療班 審査員", scope: QR_LABELS.scopeSummary, generation: 2 },
      { when: "2026-11-04 10:10", who: QR_LABELS.anonymous, scope: QR_LABELS.scopeSummary, generation: 1 },
    ]);
  });
});

describe("QR に入れる URL", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });
  it("手元は http、配信は https。転送の見出しがあればそれ", () => {
    expect(originFromHeaders(h({ host: "localhost:3078" }))).toBe("http://localhost:3078");
    expect(originFromHeaders(h({ host: "care72.example" }))).toBe("https://care72.example");
    expect(originFromHeaders(h({ host: "x", "x-forwarded-host": "care72.example", "x-forwarded-proto": "https" }))).toBe(
      "https://care72.example",
    );
    expect(qrUrl("https://care72.example", "abc.def")).toBe("https://care72.example/q/abc.def");
  });
  it("host が無い・おかしな host は作らない", () => {
    expect(originFromHeaders(h({}))).toBeNull();
    expect(originFromHeaders(h({ host: "evil.example/path?x=" }))).toBeNull();
  });
});
