// T68 のテスト: 地域と住所（本人の住所・位置・本人の電話、連絡先のスマホ・車）。
// 新しい事業所（架空の高知市の事業所）が画面から利用者を足した、の筋で、保存を node:sqlite の D1 で往復（保存 → 読み戻し）する。
// 本物の API は呼ばない（Claude は呼ばない作業。仮名化は呼ぶ前の形を見るだけ）。
import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { SectionForm } from "../../components/person/SectionEdit.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { parseLedger } from "../db/ledger.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadOfficeTowns } from "../disaster/db.ts";
import { personSituation } from "../disaster/state.ts";
import { reportersOf } from "../drill/persona.ts";
import { buildForm9 } from "../forms/form9.ts";
import { buildMappedSheet } from "../forms/mapped-sheet.ts";
import { cellText, buildMatsuyamaSheet } from "../forms/matsuyama.ts";
import { buildMedicalSummary, buildOwnSheetMedical } from "../forms/medical-summary.ts";
import { caoMapping } from "../forms/plan-form.ts";
import { loadOfficePlace } from "../office/place.ts";
import { createPerson } from "../office/people.ts";
import type { OfficeActor } from "../office/scope.ts";
import { loadPersonPage, toPersonView, type PersonPageRows } from "../person.ts";
import { pseudonymize, pseudonymizeText, TOWN_MARK } from "../pseudonym/index.ts";
import type { IntakeChange } from "./changes.ts";
import { changeText } from "./changes.ts";
import { editBlockers, editChanges, editDraft, removalNames, selfTwice, type EditData } from "./edit.ts";
import { INTAKE_FIELDS, INTAKE_KEYS } from "./fields.ts";
import { intakePropsOf } from "./props.ts";
import { CONTACT_KINDS_FOR_EDIT, CONTACT_KINDS_FOR_INTAKE, ExtractSchema } from "./schema.ts";
import { applyPlace, saveIntake, SaveRequestSchema, type SaveRequest } from "./save.ts";

const NOW = new Date("2026-11-04T03:00:00.000Z");
const TODAY = "2026-11-04";
const OFFICE = "office-kochi-t68";
const CM = "acct-kochi-t68";

/** 架空の高知市の事業所の管理者（新しい事業所のケアマネ） */
const cm: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: CM,
  displayName: "架空 一郎",
  office: { id: OFFICE, name: "架空ケア高知", kind: "regular" },
  caseloadOf: CM,
  personId: null,
  contactId: null,
};
const actor: OfficeActor = { officeId: OFFICE, authorId: CM, authorRole: "care_manager", admin: true, placeEdit: true, defaultCareManagerId: CM };

let sqlite: DatabaseSync;
let db: D1Database;
let pid: string;

beforeEach(async () => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite.exec(`INSERT INTO offices (id, name, kind, city) VALUES ('${OFFICE}', '架空ケア高知', 'regular', '高知市')`);
  sqlite.exec(
    `INSERT INTO accounts (id, office_id, role, is_office_admin, display_name, login_id) VALUES ('${CM}', '${OFFICE}', 'care_manager', 1, '架空 一郎', 'kochi-t68')`,
  );
  db = d1FromSqlite(sqlite);
  // 利用者追加（氏名・カナ・生年月日・性別・担当だけ。住所も位置も連絡先も無い）
  const r = await createPerson(db, actor, { name: "架空 花子", kana: "カクウ ハナコ", birthDate: "1940-05-06", sex: "female", careManagerId: CM }, NOW.toISOString(), "p-t68-new");
  expect(r).toEqual({ ok: true, id: "p-t68-new" });
  pid = "p-t68-new";
});

const edit = (changes: IntakeChange[], version: number): SaveRequest => SaveRequestSchema.parse({ personId: pid, version, ai: null, edit: true, changes });

/** 種のデモ事業所の山本（種の人を開くとき） */
const yamamoto: Principal = { ...cm, accountId: "acct-yamamoto", caseloadOf: "acct-yamamoto", office: { id: "office-demo", name: "デモ事業所", kind: "demo" } };
const whoFor = (id: string) => (id.startsWith("p-t68") ? cm : yamamoto);

async function rowsOf(id = pid): Promise<PersonPageRows> {
  return (await loadPersonPage(db, whoFor(id), id))!;
}

/** 面の編集の値（PersonWithIntake と同じく、事業所の地域を足す） */
async function editData(id = pid): Promise<EditData> {
  const rows = await rowsOf(id);
  const place = (await loadOfficePlace(db, rows.person.office_id)) ?? undefined;
  return { ...intakePropsOf(rows, false).edit, place };
}

/** 面の編集で 1 回保存する（下書きを直す関数を受け取る） */
async function saveSection(section: "basic" | "people", patch: (d: ReturnType<typeof editDraft>) => void) {
  const d = await editData();
  const draft = editDraft(d);
  patch(draft);
  expect(editBlockers(section, draft, d)).toEqual([]);
  const changes = editChanges(section, d, draft);
  const r = await saveIntake(db, cm, edit(changes, d.version), NOW);
  return { changes, r };
}

const KOCHI_TOWN = "汐見川町";
const POINT = { lat: 33.55897, lng: 133.53112 };

describe("住所と位置の手入力（T68 の 1）", () => {
  it("新しい人は住所・位置が無く、市の欄の既定は事業所の市・町名は空。町名が空のあいだは市の既定を送らず、ほかの直しを止めない", async () => {
    const d = await editData();
    expect(d.place).toEqual({ city: "高知市", center: null, towns: [] });
    const draft = editDraft(d);
    expect(draft.address).toEqual({ city: "高知市", town: "" });
    expect(draft.location).toBeNull();
    draft.note = "坂の上の家";
    expect(editBlockers("basic", draft, d)).toEqual([]);
    expect(editChanges("basic", d, draft)).toEqual([{ t: "note", value: "坂の上の家" }]);
  });

  it("市・町名・位置を保存して読み戻す（版が 1 つ上がり、経過に「住所・位置」）", async () => {
    const { changes, r } = await saveSection("basic", (draft) => {
      draft.address = { city: "高知市", town: ` ${KOCHI_TOWN} ` };
      draft.location = POINT;
    });
    expect(changes).toEqual([
      { t: "address", value: { city: "高知市", town: KOCHI_TOWN } },
      { t: "location", value: POINT },
    ]);
    expect(r).toMatchObject({ ok: true, version: 2, fields: expect.arrayContaining(["basic.address", "basic.location"]) });
    const rows = await rowsOf();
    const l = parseLedger(rows.person.ledger);
    expect(l.basic.address).toEqual({ city: "高知市", town: KOCHI_TOWN });
    expect(l.basic.location).toEqual(POINT);
    // 種の経過の行は本物の時刻で入るので、NOW（固定）より新しくなりうる。直した行だけを見る（時刻で落ちないように）
    const body = sqlite
      .prepare("SELECT body FROM timeline_entries WHERE person_id = ?1 AND body LIKE 'ケアマネが直した%' ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(pid) as { body: string };
    expect(body.body).toBe("ケアマネが直した: 住所・位置");
    // 読み戻した下書きは今の値。同じ値なら何も送らない
    const back = editDraft(await editData());
    expect(back.address).toEqual({ city: "高知市", town: KOCHI_TOWN });
    expect(back.location).toEqual(POINT);
    expect(editChanges("basic", await editData(), back)).toEqual([]);
    // 本人のページの基本の「住所」が「未確認」でなくなる
    const view = toPersonView(rows, { today: TODAY });
    const row = view.sections.flatMap((s) => s.blocks).find((b) => b.type === "row" && b.row.key === "basic.address");
    expect(row && row.type === "row" && row.row.field).toMatchObject({ kind: "lines" });
  });

  it("両方を空にすると外す・位置の外す。片方だけは editBlockers で止め、サーバーも空の欄を断る", async () => {
    await saveSection("basic", (draft) => {
      draft.address = { city: "高知市", town: KOCHI_TOWN };
      draft.location = POINT;
    });
    const d = await editData();
    const draft = editDraft(d);
    draft.address = { city: "高知市", town: "" };
    expect(editBlockers("basic", draft, d)).toEqual(["町名"]);
    draft.address = { city: "", town: KOCHI_TOWN };
    expect(editBlockers("basic", draft, d)).toEqual(["市"]);
    // 片方だけの値はサーバーの形でも断る
    expect(SaveRequestSchema.safeParse({ personId: pid, version: 2, ai: null, edit: true, changes: [{ t: "address", value: { city: "高知市", town: "" } }] }).success).toBe(false);
    draft.address = { city: "", town: "" };
    draft.location = null;
    expect(editBlockers("basic", draft, d)).toEqual([]);
    const changes = editChanges("basic", d, draft);
    expect(changes).toEqual([
      { t: "address", value: null },
      { t: "location", value: null },
    ]);
    expect(changes.map(changeText)).toEqual(["外す", "外す"]);
    expect(await saveIntake(db, cm, edit(changes, d.version), NOW)).toMatchObject({ ok: true });
    const l = parseLedger((await rowsOf()).person.ledger);
    expect(l.basic.address).toBeUndefined();
    expect(l.basic.location).toBeUndefined();
  });

  it("住所・位置は手で直すときだけ（AI の分け方・問いの答えの保存に混ざると断る）。位置は描ける範囲（±85）の外を断る", async () => {
    const ai = { personId: pid, version: 1, ai: { model: "claude-sonnet-5-5" }, changes: [{ t: "address", value: { city: "高知市", town: KOCHI_TOWN } }] };
    expect(SaveRequestSchema.safeParse(ai).success).toBe(false);
    const manual = { personId: pid, version: 1, ai: null, changes: [{ t: "location", value: POINT }] };
    expect(SaveRequestSchema.safeParse(manual).success).toBe(false);
    // 形を通さずに来ても、保存が断る
    expect(await saveIntake(db, cm, { ...manual, edit: false } as unknown as SaveRequest, NOW)).toEqual({ ok: false, error: "forbidden" });
    expect(SaveRequestSchema.safeParse({ ...manual, edit: true, changes: [{ t: "location", value: { lat: 89, lng: 133 } }] }).success).toBe(false);
  });

  it("applyPlace は同じ値なら変えない", () => {
    const l = parseLedger(JSON.stringify({ basic: { address: { city: "高知市", town: KOCHI_TOWN }, location: POINT } }));
    expect(applyPlace(l, [{ t: "address", value: { city: "高知市", town: KOCHI_TOWN } }, { t: "location", value: { ...POINT } }]).fields).toEqual([]);
  });

  it("AI の分け方の候補（入れる欄の表と ExtractSchema）に住所・位置・本人（self）が無い", () => {
    expect(INTAKE_FIELDS.some((f) => f.key.startsWith("basic.address") || f.key.startsWith("basic.location"))).toBe(false);
    expect((INTAKE_KEYS as readonly string[]).some((k) => /address|location/.test(k))).toBe(false);
    const json = JSON.stringify(z.toJSONSchema(ExtractSchema));
    expect(json).not.toMatch(/"(address|location|self|lat|lng|city|town)"/);
    expect(CONTACT_KINDS_FOR_INTAKE).not.toContain("self");
    expect(CONTACT_KINDS_FOR_EDIT).toContain("self");
  });

  it("保存した町名は次の仮名化で（町名）になる。位置は Claude に渡す形に無い", async () => {
    const before = await rowsOf();
    const input = (rows: PersonPageRows) => ({ person: rows.person, ledger: parseLedger(rows.person.ledger), contacts: [...rows.contacts], clocks: [...rows.clocks] });
    // 保存の前は町名を知らないので、文に混ざっても伏せられない（だから AI の分け方に住所を足さない）
    expect(pseudonymizeText(`${KOCHI_TOWN}の坂の上`, pseudonymize([input(before)]).key).text).toContain(KOCHI_TOWN);
    await saveSection("basic", (draft) => {
      draft.address = { city: "高知市", town: KOCHI_TOWN };
      draft.location = POINT;
    });
    const { payload, key } = pseudonymize([input(await rowsOf())]);
    expect(pseudonymizeText(`${KOCHI_TOWN}の坂の上`, key).text).toBe(`${TOWN_MARK}の坂の上`);
    const sent = JSON.stringify(payload);
    expect(sent).not.toContain(KOCHI_TOWN);
    expect(sent).not.toContain(String(POINT.lat));
    expect(sent).not.toContain(String(POINT.lng));
  });

  it("面の編集の基本に 市・町名（事業所の町名の候補）・位置の地図が出る", async () => {
    await saveSection("basic", (draft) => {
      draft.address = { city: "高知市", town: KOCHI_TOWN };
    });
    const d = await editData();
    expect(d.place?.towns).toEqual([KOCHI_TOWN]);
    const html = renderToStaticMarkup(createElement(SectionForm, { section: "basic", data: d, draft: editDraft(d), set: () => {} }));
    expect(html).toContain('data-field="basic.address.city"');
    expect(html).toContain('data-field="basic.address.town"');
    expect(html).toContain(`<option value="${KOCHI_TOWN}">`);
    expect(html).toContain("data-location-pick");
    expect(html).toContain("cyberjapandata.gsi.go.jp/xyz/pale/");
    expect(html).toContain("地理院タイル");
    expect(html).toContain("未設定");
  });
});

describe("本人の電話（T68 の 2）", () => {
  it("連絡先の編集で本人（self）を足し、電話と備考だけを保存する。様式・本人のページが読む", async () => {
    const { changes, r } = await saveSection("people", (draft) => {
      draft.newContacts = [
        { id: null, kind: "self", relation: "娘", name: "誰か", phone: "090-0000-0068", night: "yes", note: "携帯", emergency: "1", supporter: "", reach: "together", smartphone: "yes", car: "yes" },
      ];
    });
    // 本人の行は電話と備考だけ（続柄・順・距離・夜間・スマホ・車は送らない）
    expect(changes).toEqual([{ t: "contact", id: null, value: { kind: "self", phone: "090-0000-0068", note: "携帯" } }]);
    expect(r).toMatchObject({ ok: true });
    const self = sqlite.prepare("SELECT kind, relation, name, phone, note, emergency_order, night_ok, has_smartphone, has_car FROM contacts WHERE person_id = ?1").all(pid);
    expect(self).toEqual([
      { kind: "self", relation: null, name: null, phone: "090-0000-0068", note: "携帯", emergency_order: null, night_ok: null, has_smartphone: null, has_car: null },
    ]);
    // 下書きに出て、電話を直せる
    const d = await editData();
    const draft = editDraft(d);
    expect(draft.contacts.map((c) => c.kind)).toEqual(["self"]);
    draft.contacts[0] = { ...draft.contacts[0], phone: "090-0000-0069", relation: "無視" };
    const fix = editChanges("people", d, draft);
    expect(fix).toEqual([{ t: "contact", id: expect.any(String), value: { kind: "self", phone: "090-0000-0069" }, overwrite: true }]);
    expect(await saveIntake(db, cm, edit(fix, d.version), NOW)).toMatchObject({ ok: true });
    expect(sqlite.prepare("SELECT phone, relation FROM contacts WHERE person_id = ?1").get(pid)).toEqual({ phone: "090-0000-0069", relation: null });
  });

  it("2 つ目の本人は画面（selfTwice）とサーバー（self_twice）で止める。種の人は 1 つずつ", async () => {
    const d = await editData("p-01");
    const draft = editDraft(d);
    expect(draft.contacts.filter((c) => c.kind === "self")).toHaveLength(1);
    draft.newContacts = [{ id: null, kind: "self", relation: "", name: "", phone: "090-0000-0070", night: "", note: "", emergency: "", supporter: "", reach: "" }];
    expect(selfTwice(draft)).toBe(true);
    const changes = editChanges("people", d, draft);
    const req = SaveRequestSchema.parse({ personId: "p-01", version: d.version, ai: null, edit: true, changes });
    expect(await saveIntake(db, yamamoto, req, NOW)).toEqual({ ok: false, error: "self_twice" });
    expect(sqlite.prepare("SELECT count(*) AS n FROM contacts WHERE person_id = 'p-01' AND kind = 'self'").get()).toEqual({ n: 1 });
  });

  it("本人（self）は AI の分け方・問いの答えの保存では作れない", async () => {
    const ai = { personId: pid, version: 1, ai: { model: "claude-sonnet-5-5" }, changes: [{ t: "contact", id: null, value: { kind: "self", phone: "090-0000-0068" } }] };
    expect(SaveRequestSchema.safeParse(ai).success).toBe(false);
    expect(await saveIntake(db, cm, ai as unknown as SaveRequest, NOW)).toEqual({ ok: false, error: "forbidden" });
  });

  it("本人の行はほかの連絡先と同じく外せる（確認の窓は「本人」）。外すと本人の電話が無くなり、外して足し直すのは本人重複にならない", async () => {
    const d = await editData("p-01");
    const draft = editDraft(d);
    draft.drops = ["contact:c-01-0"];
    const changes = editChanges("people", d, draft);
    expect(changes).toEqual([{ t: "remove", target: { what: "contact", id: "c-01-0" } }]);
    expect(removalNames(changes, d)).toEqual(["本人"]);
    // 外して同じ保存で足し直す（2 つにはならない）
    draft.newContacts = [{ id: null, kind: "self", relation: "", name: "", phone: "090-0000-0070", night: "", note: "携帯", emergency: "", supporter: "", reach: "" }];
    expect(selfTwice(draft)).toBe(false);
    const swap = editChanges("people", d, draft);
    expect(await saveIntake(db, yamamoto, SaveRequestSchema.parse({ personId: "p-01", version: d.version, ai: null, edit: true, changes: swap }), NOW)).toMatchObject({
      ok: true,
    });
    expect(sqlite.prepare("SELECT phone, note FROM contacts WHERE person_id = 'p-01' AND kind = 'self'").all()).toEqual([{ phone: "090-0000-0070", note: "携帯" }]);
    // 外すだけ → 本人の電話の行は無くなる（訓練の本人電話は番号なし。lib/drill/db.ts の resolveTarget）
    const d2 = await editData("p-01");
    const draft2 = editDraft(d2);
    const id = draft2.contacts.find((c) => c.kind === "self")!.id!;
    draft2.drops = [`contact:${id}`];
    expect(await saveIntake(db, yamamoto, SaveRequestSchema.parse({ personId: "p-01", version: d2.version, ai: null, edit: true, changes: editChanges("people", d2, draft2) }), NOW)).toMatchObject({
      ok: true,
    });
    expect(sqlite.prepare("SELECT count(*) AS n FROM contacts WHERE person_id = 'p-01' AND kind = 'self'").get()).toEqual({ n: 0 });
    const html = renderToStaticMarkup(createElement(SectionForm, { section: "people", data: d, draft: { ...editDraft(d), drops: ["contact:c-01-0"] }, set: () => {} }));
    expect(html).toContain("data-dropped");
  });
});

describe("連絡先のスマホ・車（T68 の 3）", () => {
  it("今の行と足す行にスマホ・車を保存し、本人のページの連絡先の行に出る。訓練の押せる人になる", async () => {
    // 足す行: 娘（スマホ あり・車 なし）
    const added = await saveSection("people", (draft) => {
      draft.newContacts = [
        { id: null, kind: "family", relation: "娘", name: "架空 桃子", phone: "090-0000-0071", night: "", note: "", emergency: "1", supporter: "", reach: "in_city", smartphone: "yes", car: "no" },
      ];
    });
    expect(added.changes).toEqual([
      {
        t: "contact",
        id: null,
        value: { kind: "family", relation: "娘", name: "架空 桃子", phone: "090-0000-0071", emergencyOrder: 1, reach: "in_city", hasSmartphone: true, hasCar: false },
      },
    ]);
    expect(changeText(added.changes[0])).toContain("スマホ あり");
    expect(changeText(added.changes[0])).toContain("車 なし");
    expect(sqlite.prepare("SELECT has_smartphone, has_car FROM contacts WHERE person_id = ?1").get(pid)).toEqual({ has_smartphone: 1, has_car: 0 });
    let rows = await rowsOf();
    expect(reportersOf({ ledger: parseLedger(rows.person.ledger), contacts: [...rows.contacts] })).toEqual([
      { role: "本人", source: "agent", canPress: false },
      { role: "娘", source: "family", canPress: true },
    ]);
    // 今の行: 車 あり に直し、スマホを未確認に戻す
    const d = await editData();
    const draft = editDraft(d);
    expect(draft.contacts[0]).toMatchObject({ smartphone: "yes", car: "no" });
    draft.contacts[0] = { ...draft.contacts[0], smartphone: "", car: "yes" };
    const fix = editChanges("people", d, draft);
    expect(fix).toEqual([{ t: "contact", id: expect.any(String), value: { kind: "family", hasSmartphone: null, hasCar: true }, overwrite: true }]);
    expect(await saveIntake(db, cm, edit(fix, d.version), NOW)).toMatchObject({ ok: true });
    expect(sqlite.prepare("SELECT has_smartphone, has_car FROM contacts WHERE person_id = ?1").get(pid)).toEqual({ has_smartphone: null, has_car: 1 });
    rows = await rowsOf();
    const view = toPersonView(rows, { today: TODAY });
    const emergency = view.sections.flatMap((s) => s.blocks).find((b) => b.type === "row" && b.row.key === "people.emergency");
    expect(JSON.stringify(emergency)).toContain('"車"');
  });

  it("スマホ・車は手で直すときだけ（AI の分け方の保存に混ざると断る）", () => {
    const ai = { personId: pid, version: 1, ai: { model: "claude-sonnet-5-5" }, changes: [{ t: "contact", id: null, value: { kind: "family", relation: "娘", hasSmartphone: true } }] };
    expect(SaveRequestSchema.safeParse(ai).success).toBe(false);
  });

  it("面の編集の連絡先の行にスマホ・車の選択、本人の行は電話と備考だけ", async () => {
    const d = await editData("p-01");
    const html = renderToStaticMarkup(createElement(SectionForm, { section: "people", data: d, draft: editDraft(d), set: () => {} }));
    expect(html).toContain('data-flag="スマホ"');
    expect(html).toContain('data-flag="車"');
    expect(html).toContain("data-contact-self");
    const selfRow = html.slice(html.indexOf("data-contact-self"), html.indexOf("data-contact-self") + 1500);
    expect(selfRow).not.toContain("data-flag");
    expect(selfRow).not.toContain("data-order");
  });
});

describe("停電の地区と町名（T68 の 5）", () => {
  it("町名を入れた新しい人は事業所の町名の候補に出て、地区の停電がその人に当たる（ほかの町だけなら当たらない）", async () => {
    expect(await loadOfficeTowns(db, OFFICE)).toEqual([{ town: null, count: 1 }]);
    await saveSection("basic", (draft) => {
      draft.address = { city: "高知市", town: KOCHI_TOWN };
    });
    expect(await loadOfficeTowns(db, OFFICE)).toEqual([{ town: KOCHI_TOWN, count: 1 }]);
    const s = { now: NOW.toISOString(), disasterAt: NOW.toISOString(), outageAt: NOW.toISOString() };
    expect(personSituation({ ...s, outageTowns: [KOCHI_TOWN] }, KOCHI_TOWN).outageAt).toBe(s.outageAt);
    expect(personSituation({ ...s, outageTowns: ["別の町"] }, KOCHI_TOWN).outageAt).toBeNull();
    // 町名の無い人は停電に含む（今の作りのまま）
    expect(personSituation({ ...s, outageTowns: ["別の町"] }, null).outageAt).toBe(s.outageAt);
  });
});

describe("様式に住所と本人の電話（今まで「未確認」だった欄）", () => {
  async function filled(): Promise<PersonPageRows> {
    await saveSection("basic", (draft) => {
      draft.address = { city: "高知市", town: KOCHI_TOWN };
    });
    await saveSection("people", (draft) => {
      draft.newContacts = [{ id: null, kind: "self", relation: "", name: "", phone: "090-0000-0068", night: "", note: "固定電話", emergency: "", supporter: "", reach: "" }];
    });
    // 医療班の要約は医療班提供の同意が要る
    const d = await editData();
    const consent: IntakeChange[] = [{ t: "consent", kind: "medical", status: "granted" }];
    expect(await saveIntake(db, cm, edit(consent, d.version), NOW)).toMatchObject({ ok: true });
    return rowsOf();
  }

  it("保存の前は住所・本人の電話が「未確認」", async () => {
    const rows = await rowsOf();
    const s = buildMatsuyamaSheet(rows, { today: TODAY, officeName: "架空ケア高知" });
    expect(cellText(s.cells["target.address"])).toContain("未確認");
  });

  it("松山市の様式・内閣府の様式例・様式 9・医療班の要約・本人の 1 枚の裏", async () => {
    const rows = await filled();
    const opts = { today: TODAY, officeName: "架空ケア高知" };
    const m = buildMatsuyamaSheet(rows, opts);
    expect(cellText(m.cells["target.address"])).toBe(`高知市 ${KOCHI_TOWN}`);
    expect(cellText(m.cells["target.district"])).toBe(KOCHI_TOWN);
    expect(cellText(m.cells["target.phone"])).toContain("090-0000-0068");

    const cao = buildMappedSheet(rows, caoMapping(), opts);
    const cell = (label: string) => {
      for (const p of cao.pages) for (const sec of p.sections) for (const r of sec.rows) if (sec.section === "" && r.field.label === label) return cellText(r.cell);
      return null;
    };
    expect(cell("住所又は居所")).toBe(`高知市 ${KOCHI_TOWN}`);
    expect(cell("電話番号")).toContain("090-0000-0068");

    const f9 = buildForm9([{ person: { ...rows.person, self_report_unreliable: rows.person.self_report_unreliable }, careManager: rows.careManagerName, contacts: rows.contacts, clocks: rows.clocks }], {
      today: TODAY,
    });
    expect(f9.rows[0].cells.address).toBe(`高知市${KOCHI_TOWN}`);
    expect(f9.rows[0].cells.means).toContain("本人電話");

    const med = buildMedicalSummary(rows, opts);
    expect(med.kind).toBe("sheet");
    if (med.kind === "sheet") {
      expect(cellText(med.sheet.cells["patient.address"])).toBe(`高知市 ${KOCHI_TOWN}`);
      expect(cellText(med.sheet.cells["patient.phone"])).toContain("090-0000-0068");
    }
    const own = buildOwnSheetMedical(rows, opts);
    expect(own.kind).toBe("sheet");
    if (own.kind === "sheet") expect(cellText(own.sheet.cells["patient.address"])).toBe(`高知市 ${KOCHI_TOWN}`);
  });
});
