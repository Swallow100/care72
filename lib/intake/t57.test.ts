// T57 のテスト: 台帳の幅（連絡先の順・種類・距離、機器・ハザード・世帯の「その他」、時計の手入力）。
// 保存は node:sqlite の D1 で往復（保存 → 読み戻し）。本物の API は呼ばない。
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { SectionForm } from "../../components/person/SectionEdit.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { parseLedger } from "../db/ledger.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { CONTACT_KINDS } from "../db/types.ts";
import { hazardText } from "../labels.ts";
import { loadPersonPage, toPersonView } from "../person.ts";
import { findLeaks, pseudonymize } from "../pseudonym/index.ts";
import { isSignalWriterKind } from "../signals/labels.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { SEED_PEOPLE } from "../../seed/people.ts";
import type { IntakeChange } from "./changes.ts";
import { editBlockers, editChanges, editDraft, orderClash, removalNames } from "./edit.ts";
import { INTAKE_FIELDS, normalizeValue } from "./fields.ts";
import { markClockIds } from "./marks.ts";
import { intakePropsOf } from "./props.ts";
import { CONTACT_KINDS_FOR_EDIT, CONTACT_KINDS_FOR_INTAKE, DEVICE_KINDS_FOR_INTAKE, HAZARD_KINDS_FOR_INTAKE } from "./schema.ts";
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
    draft.newContacts = [{ id: null, kind: "supporter", relation: "隣人", name: "", phone: "", night: "yes", note: "", emergency: "", supporter: "1", reach: "nearby" }];
    const changes = editChanges("people", d, draft);
    expect(changes).toEqual([{ t: "contact", id: null, value: { kind: "supporter", relation: "隣人", nightOk: true, supporterOrder: 1, reach: "nearby" } }]);
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
      // 本人の電話の行（T68 から下書きに出す。順は付けない）
      ["c-04-0", "", ""],
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

  it("もともと重なっている順はほかの直しを止めない。そのうえで別の順を新しく重ねる保存は断る", async () => {
    sqlite.exec("UPDATE contacts SET supporter_order = 1 WHERE id = 'c-09-1'"); // c-09-2 の支援 1 と重なる（種には無い形）
    const rows = (await loadPersonPage(db, cm, "p-09"))!;
    expect(contactOrderClash(rows, [{ t: "contact", id: "c-09-1", value: { kind: "family", note: "鍵あり" }, overwrite: true }])).toBe(false);
    // 緊急 1（c-09-1）を c-09-2 にも付ける → 新しい重なり
    expect(contactOrderClash(rows, [{ t: "contact", id: "c-09-2", value: { kind: "supporter", emergencyOrder: 1 }, overwrite: true }])).toBe(true);
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

describe("連絡先の種類と距離・migration 0008（T57 の 2）", () => {
  it("0008 のあと: 新しい種類が入り、知らない種類は断る。列と索引は前と同じ", () => {
    const cols = (sqlite.prepare("PRAGMA table_info(contacts)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual([
      "id",
      "person_id",
      "kind",
      "relation",
      "name",
      "phone",
      "reach",
      "emergency_order",
      "supporter_order",
      "night_ok",
      "has_car",
      "has_smartphone",
      "note",
      "sort",
      "created_at",
    ]);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'contacts' AND name = 'contacts_person'").get()).toEqual({
      name: "contacts_person",
    });
    const ins = (id: string, kind: string) => sqlite.prepare("INSERT INTO contacts (id, person_id, kind) VALUES (?, 'p-01', ?)").run(id, kind);
    for (const kind of CONTACT_KINDS) ins(`c-t57-${kind}`, kind);
    expect(() => ins("c-t57-bad", "neighbor_cat")).toThrow(/CHECK/);
  });

  it("行のある表に 0008 を当てても連絡先の行は全部残る（退けて作り直す道）", () => {
    const before = sqlite.prepare("SELECT COUNT(*) AS n FROM contacts").get();
    // 種を入れた表に 0008 をもう一度当てる（退けて作り直す道を、行のある表で通す）
    const sql = readFileSync(new URL("../../migrations/0008_contact_kinds.sql", import.meta.url), "utf8");
    sqlite.exec(sql);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM contacts").get()).toEqual(before);
    expect(sqlite.prepare("SELECT kind, supporter_order, reach FROM contacts WHERE id = 'c-01-2'").get()).toEqual({
      kind: "supporter",
      supporter_order: 2,
      reach: "nearby",
    });
  });

  it("新しい種類（酸素業者）を距離つきで足し、今の行の距離も直す。読み戻すと本人のページの連絡先の行に出る", async () => {
    const d = await editDataOf("p-01");
    const draft = editDraft(d);
    draft.newContacts = [
      { id: null, kind: "oxygen_supplier", relation: "", name: "架空酸素", phone: "090-0000-0071", night: "yes", note: "", emergency: "", supporter: "", reach: "in_city" },
    ];
    draft.contacts = draft.contacts.map((c) => (c.id === "c-01-2" ? { ...c, reach: "together" } : c));
    const changes = editChanges("people", d, draft);
    expect(changes).toEqual([
      { t: "contact", id: "c-01-2", value: { kind: "supporter", reach: "together" }, overwrite: true },
      { t: "contact", id: null, value: { kind: "oxygen_supplier", name: "架空酸素", phone: "090-0000-0071", nightOk: true, reach: "in_city" } },
    ]);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-01", changes)), NOW)).toMatchObject({ ok: true });
    expect(
      sqlite.prepare("SELECT kind, reach FROM contacts WHERE person_id = 'p-01' AND kind IN ('oxygen_supplier', 'supporter') ORDER BY kind").all(),
    ).toEqual([
      { kind: "oxygen_supplier", reach: "in_city" },
      { kind: "supporter", reach: "together" },
    ]);
    const rows = (await loadPersonPage(db, cm, "p-01"))!;
    const text = JSON.stringify(toPersonView(rows, { today: "2026-11-03" }).sections.find((s) => s.id === "people"));
    expect(text).toContain("酸素業者");
    expect(text).toContain("架空酸素");
    expect(text).toContain("市内");
  });

  it("その他の連絡先は続柄が空なら画面で止める（保存の前）", async () => {
    const d = await editDataOf("p-05");
    const draft = editDraft(d);
    draft.newContacts = [{ id: null, kind: "other", relation: "", name: "架空 花子", phone: "", night: "", note: "", emergency: "", supporter: "", reach: "" }];
    expect(editBlockers("people", draft)).toEqual(["その他 続柄"]);
    draft.newContacts[0].relation = "大家";
    expect(editBlockers("people", draft)).toEqual([]);
  });

  it("新しい種類は Claude に名前でない役割名で渡り、名前・電話・自由記入の名前は残らない（findLeaks）", () => {
    const base = SEED_PEOPLE.find((p) => p.person.id === "p-05")!;
    const blank = { reach: null, emergency_order: null, supporter_order: null, night_ok: null, has_car: null, has_smartphone: null };
    const extra = [
      { ...blank, id: "c-05-o", kind: "oxygen_supplier" as const, relation: null, name: "架空酸素", phone: "090-0000-0071", note: null },
      { ...blank, id: "c-05-p", kind: "power_company" as const, relation: null, name: null, phone: "090-0000-0072", note: null },
      { ...blank, id: "c-05-h", kind: "hospital" as const, relation: null, name: "架空総合病院", phone: "090-0000-0073", note: null },
      { ...blank, id: "c-05-x", kind: "other" as const, relation: "大家", name: "架空 次郎", phone: "090-0000-0074", note: "架空 次郎さんが鍵を持つ" },
    ];
    const ledger = {
      ...base.ledger,
      basic: { ...base.ledger.basic, household: "other" as const, householdNote: "架空 次郎さんの離れ" },
      evacuation: { ...base.ledger.evacuation, hazards: [{ kind: "other" as const, note: "架空 次郎さん宅の裏山" }] },
    };
    const { payload, key } = pseudonymize([{ person: base.person, ledger, contacts: [...base.contacts, ...extra], clocks: base.clocks }], { on: "2026-11-03" });
    const p = payload[0];
    expect(p.contacts.map((c) => c.role).slice(-4)).toEqual(["酸素業者", "電力会社", "病院", "その他の連絡先"]);
    expect(findLeaks(payload, key)).toEqual([]);
    const json = JSON.stringify(payload);
    for (const s of ["架空 次郎", "架空次郎", "090-0000-007"]) expect(json).not.toContain(s);
    expect(p.householdNote).not.toContain("次郎");
    expect(p.evacuation.hazards[0].note).not.toContain("次郎");
  });

  it("新しい種類は安否の書き手にしない（本人・家族・支援者・民生委員のまま）", () => {
    for (const k of ["oxygen_supplier", "power_company", "hospital", "other"] as const) expect(isSignalWriterKind(k)).toBe(false);
  });
});

describe("機器・ハザード・世帯の「その他」（T57 の 3）", () => {
  it("その他の機器は名前つきで足し、時計は作らない。名前が空なら画面で止める", async () => {
    const d = await editDataOf("p-05");
    const draft = editDraft(d);
    draft.newDevices = ["other"];
    expect(editBlockers("medical", draft)).toEqual(["その他 名前"]);
    expect(editChanges("medical", d, draft)).toEqual([]);
    draft.newDeviceDetail = "CPAP";
    expect(editBlockers("medical", draft)).toEqual([]);
    const changes = editChanges("medical", d, draft);
    expect(changes).toEqual([{ t: "device", value: { kind: "other", detail: "CPAP" } }]);
    const clocksBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM clocks WHERE person_id = 'p-05'").get();
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-05", changes)), NOW)).toMatchObject({ ok: true });
    const rows = (await loadPersonPage(db, cm, "p-05"))!;
    expect(parseLedger(rows.person.ledger).medical.devices).toEqual([{ kind: "other", detail: "CPAP" }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM clocks WHERE person_id = 'p-05'").get()).toEqual(clocksBefore);
    // 今あるその他の機器の名前を空にしても止める
    const d2 = intakePropsOf(rows, false).edit;
    const draft2 = editDraft(d2);
    draft2.devices = draft2.devices.map((x) => ({ ...x, detail: "" }));
    expect(editBlockers("medical", draft2)).toEqual(["その他 名前"]);
    // 外すなら止めない（時計の無い機器を外しても落ちない）
    draft2.drops = ["device:other"];
    expect(editBlockers("medical", draft2)).toEqual([]);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-05", editChanges("medical", d2, draft2), 2)), NOW)).toMatchObject({ ok: true });
    expect(parseLedger((await loadPersonPage(db, cm, "p-05"))!.person.ledger).medical.devices).toEqual([]);
  });

  it("ハザードのその他と書き足し、世帯の施設と書き足しを保存して読み戻す。施設は独居でない", async () => {
    const d = await editDataOf("p-09");
    const draft = editDraft(d);
    draft.newHazards = ["other"];
    draft.newHazardNote = "裏山";
    const ev = editChanges("evacuation", d, draft);
    expect(ev).toEqual([{ t: "hazard", value: { kind: "other", note: "裏山" } }]);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-09", ev)), NOW)).toMatchObject({ ok: true });

    const d2 = await editDataOf("p-09");
    const draft2 = editDraft(d2);
    draft2.hazards = draft2.hazards.map((h) => ({ ...h, note: "裏山の斜面" }));
    draft2.values["basic.household"] = "facility";
    draft2.values["basic.householdNote"] = "グループホーム";
    expect(editChanges("evacuation", d2, draft2)).toEqual([{ t: "hazard", value: { kind: "other", note: "裏山の斜面" }, overwrite: true }]);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-09", editChanges("evacuation", d2, draft2), 2)), NOW)).toMatchObject({ ok: true });
    const basic = editChanges("basic", d2, draft2);
    expect(basic).toEqual([
      { t: "field", key: "basic.household", value: "facility", overwrite: true },
      { t: "field", key: "basic.householdNote", value: "グループホーム", overwrite: true },
    ]);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-09", basic, 3)), NOW)).toMatchObject({ ok: true });

    const rows = (await loadPersonPage(db, cm, "p-09"))!;
    const l = parseLedger(rows.person.ledger);
    expect(l.evacuation.hazards).toEqual([{ kind: "other", note: "裏山の斜面" }]);
    expect(l.basic).toMatchObject({ household: "facility", householdNote: "グループホーム" });
    expect(hazardText(l.evacuation.hazards[0])).toBe("その他（裏山の斜面）");
    expect((await triagePersonOf("p-09")).livesAlone).toBe(false);
    const view = JSON.stringify(toPersonView(rows, { today: "2026-11-03" }));
    expect(view).toContain("その他（裏山の斜面）");
    expect(view).toContain("施設（グループホーム）");
  });

  it("AI の分け方は機器・ハザードのその他を作らない（選択肢に無い）。連絡先の種類は広がる", () => {
    expect(DEVICE_KINDS_FOR_INTAKE).not.toContain("other");
    expect(HAZARD_KINDS_FOR_INTAKE).not.toContain("other");
    expect(CONTACT_KINDS_FOR_INTAKE).toContain("oxygen_supplier");
    // 連絡先のその他も AI は作らない（続柄が無いと誰か分からない）。編集の保存は受ける
    expect(CONTACT_KINDS_FOR_INTAKE).not.toContain("other");
    expect(CONTACT_KINDS_FOR_EDIT).toContain("other");
  });

  it("書き足しは 60 字まで（世帯補記・ハザードの補記）", () => {
    const f = INTAKE_FIELDS.find((x) => x.key === "basic.householdNote")!;
    expect(normalizeValue(f, "あ".repeat(80))).toBe("あ".repeat(60));
    expect(SaveRequestSchema.safeParse(edit("p-01", [{ t: "hazard", value: { kind: "other", note: "あ".repeat(61) } }])).success).toBe(false);
  });
});

describe("時計の手入力（T57 の 4）", () => {
  it("時計を足す: 値あり（出典・書き足し・停電から）と値なし（未確認）。経過の場所に残る", async () => {
    const d = await editDataOf("p-10");
    const draft = editDraft(d);
    draft.newClocks = [
      { label: "電動ベッド 予備電池", kind: "device", category: "other", value: "６", unit: "hour", start: "outage", source: "device_manual", sourceNote: "取扱説明書 p.12" },
      { label: "飲み水", kind: "supply", category: "other", value: "", unit: "day", start: "disaster", source: "", sourceNote: "" },
      { label: "", kind: "supply", category: "other", value: "", unit: "day", start: "disaster", source: "", sourceNote: "" }, // 空 → 送らない
    ];
    expect(editBlockers("medical", draft)).toEqual([]);
    const changes = editChanges("medical", d, draft);
    expect(changes).toEqual([
      {
        t: "clockAdd",
        value: { label: "電動ベッド 予備電池", kind: "device", category: "other", value: 6, unit: "hour", startsOn: "outage", source: "device_manual", sourceNote: "取扱説明書 p.12" },
      },
      { t: "clockAdd", value: { label: "飲み水", kind: "supply", category: "other", value: null, unit: null, startsOn: "disaster", source: null } },
    ]);
    const r = await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-10", changes)), NOW);
    expect(r).toMatchObject({ ok: true, changed: 2 });
    const rows = sqlite
      .prepare("SELECT label, kind, category, value, unit, starts_on, source, source_note, confirmed_at FROM clocks WHERE person_id = 'p-10' ORDER BY sort")
      .all();
    expect(rows).toEqual([
      { label: "電動ベッド 予備電池", kind: "device", category: "other", value: 6, unit: "hour", starts_on: "outage", source: "device_manual", source_note: "取扱説明書 p.12", confirmed_at: NOW.toISOString() },
      { label: "飲み水", kind: "supply", category: "other", value: null, unit: null, starts_on: "disaster", source: null, source_note: null, confirmed_at: null },
    ]);
    if (!r.ok) throw new Error("not ok");
    expect(r.fields.filter((f) => f.startsWith("clocks."))).toHaveLength(2);
    // 読み戻した編集の下書きに出て、次の保存で消えない（印の時計でないので作り直しもしない）
    const back = editDraft(await editDataOf("p-10"));
    expect(back.clocks.map((k) => [k.label, k.value, k.start])).toEqual([
      ["電動ベッド 予備電池", "6", "outage"],
      ["飲み水", "", "disaster"],
    ]);
  });

  it("名前の無い時計に値を書いたら・値が数でなければ画面で止める", async () => {
    const draft = editDraft(await editDataOf("p-10"));
    draft.newClocks = [{ label: "", kind: "supply", category: "other", value: "3", unit: "day", start: "disaster", source: "", sourceNote: "" }];
    expect(editBlockers("medical", draft)).toEqual(["時計 名前"]);
    draft.newClocks[0] = { ...draft.newClocks[0], label: "飲み水", value: "三日" };
    expect(editBlockers("medical", draft)).toEqual(["時計 値"]);
  });

  it("起点を変える（停電 → 発災）。経過の場所に残る", async () => {
    const d = await editDataOf("p-01");
    const draft = editDraft(d);
    draft.clocks = draft.clocks.map((k) => (k.id === "k-01-2" ? { ...k, start: "disaster" } : k));
    const changes = editChanges("medical", d, draft);
    expect(changes).toEqual([{ t: "clockStart", clockId: "k-01-2", to: "disaster" }]);
    const r = await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-01", changes)), NOW);
    expect(r).toMatchObject({ ok: true, changed: 1, fields: ["clocks.k-01-2"] });
    expect(sqlite.prepare("SELECT starts_on FROM clocks WHERE id = 'k-01-2'").get()).toEqual({ starts_on: "disaster" });
    // 走らない状態の時計（認知症）は起点を変えない
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-04", [{ t: "clockStart", clockId: "k-04-1", to: "outage" }])), NOW)).toMatchObject({
      ok: true,
      changed: 0,
    });
    expect(sqlite.prepare("SELECT starts_on FROM clocks WHERE id = 'k-04-1'").get()).toEqual({ starts_on: "none" });
  });

  it("外す: 印でない時計は消える。印の時計（機器・薬から作る物）は時計だけでは外さない（次の保存で作り直されるため）", async () => {
    // 降圧薬（薬の区分 その他）の時計は印でない
    const d9 = await editDataOf("p-09");
    expect(markClockIds(d9.ledger, d9.clocks).has("k-09-1")).toBe(false);
    const draft9 = editDraft(d9);
    draft9.drops = ["clock:k-09-1"];
    draft9.clocks = draft9.clocks.map((k) => ({ ...k, value: "2" })); // 外す時計の直しは送らない
    const changes = editChanges("medical", d9, draft9);
    expect(changes).toEqual([{ t: "remove", target: { what: "clock", id: "k-09-1" } }]);
    expect(removalNames(changes, d9)).toEqual(["降圧薬"]);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-09", changes)), NOW)).toMatchObject({ ok: true, changed: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM clocks WHERE id = 'k-09-1'").get()).toEqual({ n: 0 });
    // 次の保存でも作り直さない
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-09", [{ t: "note", value: "確認" }], 2)), NOW)).toMatchObject({ ok: true });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM clocks WHERE person_id = 'p-09'").get()).toEqual({ n: 0 });

    // 透析の時計は透析の機器の印。時計だけを外す要求はサーバーが無視する
    const d3 = await editDataOf("p-03");
    expect(markClockIds(d3.ledger, d3.clocks).has("k-03-1")).toBe(true);
    expect(await saveIntake(db, cm, SaveRequestSchema.parse(edit("p-03", [{ t: "remove", target: { what: "clock", id: "k-03-1" } }])), NOW)).toMatchObject({
      ok: true,
      changed: 0,
    });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM clocks WHERE id = 'k-03-1'").get()).toEqual({ n: 1 });
    // 酸素の時計は 2 つ（内蔵電池・予備ボンベ）。片方なら外しても印は残るので外せる。認知症の時計は外せない
    const d1 = await editDataOf("p-01");
    const m1 = markClockIds(d1.ledger, d1.clocks);
    expect([m1.has("k-01-1"), m1.has("k-01-2"), m1.has("k-01-3")]).toEqual([false, false, true]);
    const d4 = await editDataOf("p-04");
    expect(markClockIds(d4.ledger, d4.clocks).has("k-04-1")).toBe(true);
  });

  it("時計の追加・起点・外すは手で直すときだけ（AI の分け方の保存には混ぜない）", () => {
    const add: IntakeChange = { t: "clockAdd", value: { label: "飲み水", kind: "supply", category: "other", value: null, unit: null, startsOn: "disaster", source: null } };
    expect(SaveRequestSchema.safeParse({ personId: "p-10", version: 1, ai: { model: "claude-sonnet-5-5" }, changes: [add] }).success).toBe(false);
    expect(SaveRequestSchema.safeParse({ personId: "p-10", version: 1, ai: null, changes: [{ t: "clockStart", clockId: "k-01-1", to: "disaster" }] }).success).toBe(false);
    // 状態の時計・認知症は足せない。値があって単位が無いのも断る
    expect(SaveRequestSchema.safeParse(edit("p-10", [{ t: "clockAdd", value: { ...(add as { value: object }).value, kind: "condition" } } as never])).success).toBe(false);
    expect(SaveRequestSchema.safeParse(edit("p-10", [{ t: "clockAdd", value: { ...(add as { value: object }).value, category: "dementia" } } as never])).success).toBe(false);
    expect(SaveRequestSchema.safeParse(edit("p-10", [{ t: "clockAdd", value: { ...(add as { value: object }).value, value: 3, unit: null } } as never])).success).toBe(false);
  });
});

describe("編集の画面の欄（components/person/SectionEdit.tsx、T57）", () => {
  const form = (section: "medical" | "evacuation" | "people", data: Awaited<ReturnType<typeof editDataOf>>, patch: Partial<ReturnType<typeof editDraft>> = {}) =>
    renderToStaticMarkup(createElement(SectionForm, { section, data, draft: { ...editDraft(data), ...patch }, set: () => {} }));

  it("連絡先の行に距離・緊急・支援の選択。重なった順は 1 行で知らせる", async () => {
    const d = await editDataOf("p-09");
    const h = form("people", d);
    expect(h).toContain("data-reach");
    expect(h).toContain('data-order="緊急"');
    expect(h).toContain('data-order="支援"');
    expect(h).not.toContain("data-order-clash");
    const clash = form("people", d, { contacts: editDraft(d).contacts.map((c) => ({ ...c, supporter: "1" })) });
    expect(clash).toContain("data-order-clash");
    expect(clash).toContain("順番重複");
  });

  it("時計の行に起点の選択。印でない時計だけ「外す」。「時計追加」で足す行（名前・区分・対象・値・起点・出典）", async () => {
    const d3 = await editDataOf("p-03");
    const h3 = form("medical", d3);
    expect(h3).toContain('data-clock-start="k-03-1"');
    expect(h3).toContain("data-clock-add");
    expect(h3).not.toContain('aria-label="透析 次の回まで 外す"');
    const d9 = await editDataOf("p-09");
    expect(form("medical", d9)).toContain('aria-label="降圧薬 外す"');
    const add = form("medical", d9, { newClocks: [{ label: "", kind: "supply", category: "other", value: "", unit: "day", start: "disaster", source: "", sourceNote: "" }] });
    expect(add).toContain('data-clock="new"');
    for (const w of ["名前", "区分", "対象", "起点", "出典"]) expect(add).toContain(w);
  });

  it("機器・ハザードの「その他」を選ぶと名前・補記の欄。ハザードの行に補記の欄", async () => {
    const d = await editDataOf("p-01");
    expect(form("medical", d, { newDevices: ["other"] })).toContain("data-new-device-other");
    const ev = form("evacuation", d, { newHazards: ["other"] });
    expect(ev).toContain("data-new-hazard-other");
    expect(ev).toContain('aria-label="浸水 補記"');
  });

  it("画面の言葉に使わない語が無い", async () => {
    const d = await editDataOf("p-01");
    const all = ["medical", "evacuation", "people"].map((s) => form(s as "medical", d)).join("");
    for (const w of ["診断", "判定", "重症", "緊急度", "札"]) expect(all).not.toContain(w);
  });
});
