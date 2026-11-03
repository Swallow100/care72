// 書類と録音の範囲（docs/tasks/T24.md）。医療班・行政は医療要約だけ（医療班への提供に同意があるとき）、録音は開けない。
// 医療要約は住所・本人の電話を描かず、支援者は役割名だけ。API（録音）も同じ範囲（lib/consent/scope.ts）で断る。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MedicalSummarySheet } from "../../components/forms/MedicalSummarySheet.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { staffActor } from "../custody/actor.ts";
import { receive } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { buildMedicalSummary, type MedicalSummary } from "../forms/medical-summary.ts";
import { loadPersonDocument, medicalSummaryView } from "./documents.ts";
import { recordingScopeRefusal } from "./recording.ts";
import { SCOPE_DOCUMENTS } from "./scope.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-03";
const AT = "2026-11-03T01:00:00.000Z";
const SIGNAL = "0a0a0a0a-0000-4000-8000-000000000001";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const base: Principal = {
  role: "medical",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: null,
  office: DEMO,
  caseloadOf: null,
  personId: null,
  contactId: null,
};
const medical = (): Principal => base;
const judgeCm = (): Principal => ({ ...base, role: "care_manager", caseloadOf: "acct-yamamoto", displayName: "山本" });
const self = (): Principal => ({ ...base, role: "self", judge: false, accountId: null, personId: "p-01" });
const family = (): Principal => ({ ...base, role: "family", judge: false, accountId: null, personId: "p-01", contactId: "c-01-1" });

async function received(personId: string) {
  expect((await receive(db, staffActor(medical())!, { personId, shelter: "みどり小学校", via: "search" }, AT)).ok).toBe(true);
}

async function summaryAs(p: Principal, personId: string): Promise<MedicalSummary> {
  const opened = (await loadPersonDocument(db, p, personId, "medical"))!;
  const r = buildMedicalSummary(opened.rows, { today: TODAY, officeName: "デモ事業所", view: medicalSummaryView(opened.scope) });
  if (r.kind !== "sheet") throw new Error(r.kind);
  return r.sheet;
}

const html = (s: MedicalSummary) => renderToStaticMarkup(createElement(MedicalSummarySheet, { sheet: s }));

describe("書類の範囲", () => {
  it("医療班は受け持った 1 山田の医療要約だけ開ける。計画書・本人の1枚・QR・差し込みは開けない", async () => {
    await received("p-01");
    for (const doc of SCOPE_DOCUMENTS) {
      const opened = await loadPersonDocument(db, medical(), "p-01", doc);
      expect(opened !== null, doc).toBe(doc === "medical");
    }
  });

  it("9 渡辺（医療班への提供に同意なし）は受け持っても医療要約を開けない。ケアマネは全部開ける", async () => {
    await received("p-09");
    expect(await loadPersonDocument(db, medical(), "p-09", "medical")).toBeNull();
    for (const doc of SCOPE_DOCUMENTS) expect(await loadPersonDocument(db, judgeCm(), "p-09", doc), doc).not.toBeNull();
  });

  it("受け持つ前は医療要約も開けない（壁の外）", async () => {
    expect(await loadPersonDocument(db, medical(), "p-01", "medical")).toBeNull();
  });
});

describe("医療班の医療要約", () => {
  it("住所と本人の電話の欄を描かず、支援者は役割名だけ。緊急連絡先は名前と電話", async () => {
    // 種の支援者はみな緊急連絡先なので、隣人（支援者 2）を緊急連絡先から外して確かめる
    sqlite.prepare("UPDATE contacts SET emergency_order = NULL WHERE id = 'c-01-2'").run();
    await received("p-01");
    const cm = await summaryAs(judgeCm(), "p-01");
    const staff = await summaryAs(medical(), "p-01");
    expect(staff.hidden).toEqual(["patient.phone", "patient.address"]);
    expect(cm.hidden).toBeUndefined();

    const cmHtml = html(cm);
    const staffHtml = html(staff);
    expect(cmHtml).toContain('data-field="patient.address"');
    expect(staffHtml).not.toContain('data-field="patient.address"');
    expect(staffHtml).not.toContain('data-field="patient.phone"');
    // 描かない欄の列は詰める（空の灰色の枠を残さない）
    expect(staffHtml).toMatch(/grid-template-columns:1fr"><div data-field="patient.house"/);
    expect(cmHtml).toContain("grid-template-columns:1fr 1.2fr 1fr");
    // 本人の電話・住所の町名がどこにも無い
    expect(cmHtml).toContain("090-0000-0001");
    expect(staffHtml).not.toContain("090-0000-0001");
    const town = /([^\s>]+町)/.exec(JSON.stringify(cm.cells["patient.address"]))?.[1];
    expect(town).toBeTruthy();
    expect(staffHtml).not.toContain(town!);

    // 緊急連絡先でない支援者の名前と電話は出ない。緊急連絡先は出る
    const contacts = sqlite
      .prepare("SELECT name, phone, emergency_order FROM contacts WHERE person_id = 'p-01' AND (emergency_order IS NOT NULL OR supporter_order IS NOT NULL)")
      .all() as Array<{ name: string | null; phone: string | null; emergency_order: number | null }>;
    expect(contacts.some((c) => c.emergency_order == null)).toBe(true);
    for (const c of contacts) {
      if (c.emergency_order != null) {
        if (c.phone) expect(staffHtml).toContain(c.phone);
      } else {
        if (c.name) expect(staffHtml).not.toContain(c.name);
        if (c.phone) expect(staffHtml).not.toContain(c.phone);
      }
    }
    // 医療の欄（酸素・薬）は同じ
    expect(staff.cells["drug.hot"]).toEqual(cm.cells["drug.hot"]);
    expect(staff.medications).toEqual(cm.medications);
    // 未確認の一覧は要約の欄の物だけ
    expect(staff.pending.every((p) => p.key !== null && p.key !== "patient.address")).toBe(true);
  });

  it("住所が医療班への提供の同意の範囲にあれば住所の欄を描く（本人の電話は描かない）", async () => {
    sqlite.prepare(`UPDATE consents SET scope = '{"address":true}' WHERE person_id = 'p-01' AND kind = 'medical'`).run();
    await received("p-01");
    const staff = await summaryAs(medical(), "p-01");
    expect(staff.hidden).toEqual(["patient.phone"]);
    expect(html(staff)).toContain('data-field="patient.address"');
  });
});

describe("録音の API も同じ範囲で断る", () => {
  beforeEach(() => {
    sqlite
      .prepare(
        `INSERT INTO signals (id, person_id, color, source, recording_key, occurred_at) VALUES (?, 'p-01', 'red', 'self', 'rec/p-01/x.webm', ?)`,
      )
      .run(SIGNAL, AT);
  });

  it("医療班は受け持った本人の録音も 404（範囲に録音が無い）", async () => {
    await received("p-01");
    const res = await recordingScopeRefusal(db, medical(), SIGNAL);
    expect(res?.status).toBe(404);
    expect(await res!.json()).toEqual({ ok: false, label: "対象なし" });
  });

  it("家族も 404。ケアマネと本人は範囲の中（壁と R2 は recordingGet）", async () => {
    expect((await recordingScopeRefusal(db, family(), SIGNAL))?.status).toBe(404);
    expect(await recordingScopeRefusal(db, judgeCm(), SIGNAL)).toBeNull();
    expect(await recordingScopeRefusal(db, self(), SIGNAL)).toBeNull();
  });

  it("ログインしていない・信号の無いときは recordingGet に任せる（401・404 はそちら）", async () => {
    expect(await recordingScopeRefusal(db, null, SIGNAL)).toBeNull();
    expect(await recordingScopeRefusal(db, medical(), "0a0a0a0a-0000-4000-8000-0000000000ff")).toBeNull();
  });
});
