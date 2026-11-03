// T57 のテスト: 台帳の幅（連絡先の順・種類・距離、機器・ハザード・世帯の「その他」、時計の手入力）。
// 保存は node:sqlite の D1 で往復（保存 → 読み戻し）。本物の API は呼ばない。
import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { parseLedger } from "../db/ledger.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadPersonPage } from "../person.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import type { IntakeChange } from "./changes.ts";
import { editChanges, editDraft, orderClash } from "./edit.ts";
import { intakePropsOf } from "./props.ts";
import { contactOrderClash, saveIntake, SaveRequestSchema, type SaveRequest } from "./save.ts";

const cm: Principal = {
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
const NOW = new Date("2026-11-03T12:00:00.000Z");

let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});

/** 本人のページの面の「編集」と同じ形の保存（手の入力） */
const edit = (personId: string, changes: IntakeChange[], version = 1): SaveRequest => ({ personId, version, ai: null, edit: true, changes }) as SaveRequest;

async function editDataOf(personId: string) {
  const rows = await loadPersonPage(db, cm, personId);
  return intakePropsOf(rows!, false).edit;
}

async function triagePersonOf(personId: string) {
  const rows = (await loadPersonPage(db, cm, personId))!;
  return toTriagePerson({ person: rows.person, ledger: parseLedger(rows.person.ledger), contacts: rows.contacts, clocks: rows.clocks });
}

describe("連絡先の順（T57 の 1）", () => {
  it("画面で足した支援者に「支援 1」を付けて保存すると、表の入力で支援者あり（「支援者なし」が消える）", async () => {
    // 伊藤 p-05 は種で支援者なし
    expect((await triagePersonOf("p-05")).hasSupporter).toBe(false);
    const d = await editDataOf("p-05");
    const draft = editDraft(d);
    draft.newContacts = [{ id: null, kind: "supporter", relation: "隣人", name: "", phone: "", night: "yes", note: "", emergency: "", supporter: "1" }];
    const changes = editChanges("people", d, draft);
    expect(changes).toEqual([{ t: "contact", id: null, value: { kind: "supporter", relation: "隣人", nightOk: true, supporterOrder: 1 } }]);
    const r = await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-05", changes)), NOW);
    expect(r).toMatchObject({ ok: true, version: 2 });
    expect((await triagePersonOf("p-05")).hasSupporter).toBe(true);
    const added = sqlite.prepare("SELECT kind, relation, supporter_order, emergency_order FROM contacts WHERE person_id = 'p-05' AND kind = 'supporter'").get();
    expect(added).toEqual({ kind: "supporter", relation: "隣人", supporter_order: 1, emergency_order: null });
  });

  it("今の行の順を直す・外す（overwrite の UPDATE）。読み戻した下書きは保存した順", async () => {
    const d = await editDataOf("p-04");
    const draft = editDraft(d);
    // c-04-2（家族、緊急 2・支援なし）に支援 2、c-04-1 の緊急を外す
    draft.contacts = draft.contacts.map((c) => (c.id === "c-04-2" ? { ...c, supporter: "2" } : c.id === "c-04-1" ? { ...c, emergency: "" } : c));
    const changes = editChanges("people", d, draft);
    expect(changes).toEqual([
      { t: "contact", id: "c-04-1", value: { kind: "welfare_commissioner", emergencyOrder: null }, overwrite: true },
      { t: "contact", id: "c-04-2", value: { kind: "family", supporterOrder: 2 }, overwrite: true },
    ]);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-04", changes)), NOW)).toMatchObject({ ok: true });
    const back = editDraft(await editDataOf("p-04"));
    expect(back.contacts.map((c) => [c.id, c.emergency, c.supporter])).toEqual([
      ["c-04-1", "", "1"],
      ["c-04-2", "2", "2"],
    ]);
  });

  it("同じ順を 2 人に付けた保存はサーバーで断る。画面も重なりを出して保存を止める。入れ替えは通る", async () => {
    const d = await editDataOf("p-09");
    const draft = editDraft(d);
    // c-09-1（家族、支援なし）に支援 1 → c-09-2 の支援 1 と重なる
    draft.contacts = draft.contacts.map((c) => (c.id === "c-09-1" ? { ...c, supporter: "1" } : c));
    expect(orderClash(draft)).toEqual({ emergency: [], supporter: [1] });
    const clash = editChanges("people", d, draft);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-09", clash)), NOW)).toEqual({ ok: false, error: "order_clash" });
    expect(sqlite.prepare("SELECT supporter_order FROM contacts WHERE id = 'c-09-1'").get()).toEqual({ supporter_order: null });
    // 外す行の順は数えない
    const dropped = { ...draft, drops: ["contact:c-09-2"] };
    expect(orderClash(dropped)).toEqual({ emergency: [], supporter: [] });
    // 緊急 1 と 2 の入れ替え
    const swap = editDraft(d);
    swap.contacts = swap.contacts.map((c) => (c.id === "c-09-1" ? { ...c, emergency: "2" } : c.id === "c-09-2" ? { ...c, emergency: "1" } : c));
    expect(orderClash(swap)).toEqual({ emergency: [], supporter: [] });
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-09", editChanges("people", d, swap))), NOW)).toMatchObject({ ok: true });
    expect(sqlite.prepare("SELECT id, emergency_order FROM contacts WHERE person_id = 'p-09' AND kind <> 'self' ORDER BY id").all()).toEqual([
      { id: "c-09-1", emergency_order: 2 },
      { id: "c-09-2", emergency_order: 1 },
    ]);
  });

  it("新しい連絡先どうしの重なりも断る（contactOrderClash）", async () => {
    const rows = (await loadPersonPage(db, cm, "p-05"))!;
    const two: IntakeChange[] = [
      { t: "contact", id: null, value: { kind: "supporter", relation: "隣人", supporterOrder: 1 } },
      { t: "contact", id: null, value: { kind: "supporter", relation: "友人", supporterOrder: 1 } },
    ];
    expect(contactOrderClash(rows, two)).toBe(true);
    expect(contactOrderClash(rows, two.slice(0, 1))).toBe(false);
  });

  it("AI の分け方・問いの答えの保存からは順を付けられない（edit でなければ断る）", async () => {
    const withOrder: IntakeChange[] = [{ t: "contact", id: null, value: { kind: "supporter", relation: "隣人", supporterOrder: 1 } }];
    expect(SaveRequestSchema.safeParse({ personId: "p-05", version: 1, ai: { model: "claude-sonnet-5-5" }, changes: withOrder }).success).toBe(false);
    expect(SaveRequestSchema.safeParse({ personId: "p-05", version: 1, ai: null, changes: withOrder }).success).toBe(false);
    expect(await saveIntake(db, cm, { personId: "p-05", version: 1, ai: null, changes: withOrder } as SaveRequest, NOW)).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});
