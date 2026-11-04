// T117: 様式の欄で台帳に元の無かった物（連絡先のフリガナ・住所・携帯、実施組織、避難場所の手段と時間・最寄り、住居の種別）に
// 台帳の置き場を作り、問い・紙に直接書く・書く話す（AI）・写真と PDF の読み取りのどれからでも同じ台帳の値に入る。
// 棚卸しの表（docs/progress/t117.md）の B が、台帳の置き場・問い・様式の元・紙に直接書く入口の 4 つを持つか。保存は node:sqlite の D1 で往復。
// 本物の API は呼ばない。
import type { D1Database } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { PaperEdit } from "../../components/forms/PaperEdit.tsx";
import { MatsuyamaSheet } from "../../components/forms/MatsuyamaSheet.tsx";
import { SEED_PEOPLE, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { parseLedger } from "../db/ledger.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { answerChanges } from "../intake/answer.ts";
import { CONTACT_QUESTIONS, FIELD_QUESTIONS, FORM_FIELD_ORDER, questionQueue, routeMinutes, type Question } from "../intake/ask.ts";
import type { IntakeChange } from "../intake/changes.ts";
import { CONTACT_PARTS } from "../intake/contact-parts.ts";
import { buildDiff } from "../intake/diff.ts";
import { EXTRACT_SYSTEM, fieldGuide, pseudonymInputOf } from "../intake/extract.ts";
import { AI_INTAKE_KEYS, INTAKE_FIELDS, intakeField } from "../intake/fields.ts";
import { INTAKE_READ_SYSTEM as READ_SYSTEM } from "../intake/read.ts";
import { aiHandOnly, saveIntake, SaveRequestSchema, type SaveRequest } from "../intake/save.ts";
import { ExtractSchema, type ExtractOutput } from "../intake/schema.ts";
import { loadPersonPage, type PersonPageRows } from "../person.ts";
import { pseudonymize } from "../pseudonym/index.ts";
import { matsuyamaAskableOf } from "./form-asks.ts";
import { formContactOf, MATSUYAMA_INPUTS, matsuyamaAskable, writable } from "./form-inputs.ts";
import { buildMatsuyamaSheet, cellText, MATSUYAMA_FIELDS, matsuyamaField, type MatsuyamaKey } from "./matsuyama.ts";
import { paperChanges, paperEditData, type PaperTarget } from "./paper-edit.ts";
import { seedRows } from "./print-harness.ts";
import { matsuyamaUnconfirmed, unconfirmedView } from "./unconfirmed.ts";

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
const NOW = new Date("2026-11-05T03:00:00.000Z");
const TODAY = "2026-11-05";
const OPTS = { today: TODAY, officeName: "デモ事業所" };
const seed = (id: string): SeedPerson => SEED_PEOPLE.find((p) => p.person.id === id)!;

let sqlite: DatabaseSync;
let db: D1Database;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});

const load = async (id: string) => (await loadPersonPage(db, cm, id))!;
const save = (personId: string, version: number, changes: IntakeChange[], opts: { ai?: boolean; edit?: boolean } = {}) =>
  saveIntake(
    db,
    cm,
    { personId, version, ai: opts.ai ? { model: "claude-sonnet-5-5" } : null, ...(opts.edit ? { edit: true } : {}), changes } as SaveRequest,
    NOW,
  );

/** 棚卸しの表（docs/progress/t117.md の「計画書（松山市）」）の行。分類は A・B・C */
function inventory(): Array<{ key: MatsuyamaKey; cls: "A" | "B" | "C" }> {
  const md = readFileSync(new URL("../../docs/progress/t117.md", import.meta.url), "utf8");
  const start = md.indexOf("### 計画書（松山市）");
  const end = md.indexOf("\n### ", start + 1);
  const part = md.slice(start, end < 0 ? undefined : end);
  return [...part.matchAll(/^\| [^|]+ \| `([^`]+)` \| ([ABC]) \|/gm)].map((m) => ({ key: m[1] as MatsuyamaKey, cls: m[2] as "A" | "B" | "C" }));
}

describe("棚卸し（計画書の全部の欄を A・B・C に）", () => {
  it("表は計画書の欄を全部・様式の順に持つ。C は手書きの欄と引用の印だけ", () => {
    const rows = inventory();
    expect(rows.map((r) => r.key)).toEqual(MATSUYAMA_FIELDS.map((f) => f.key));
    for (const r of rows.filter((x) => x.cls === "C")) {
      const def = matsuyamaField(r.key);
      expect(def.source, r.key).toBe("手書き");
    }
    // 台帳に元の無い欄（NO_SOURCE）は計画書に残らない
    for (const f of MATSUYAMA_FIELDS) expect(f.source, f.key).not.toBe("台帳に無い");
  });

  it("B は全部、台帳の置き場・問い・様式の元・紙に直接書く入口の 4 つを持つ（漏れたら落ちる）", () => {
    const b = inventory().filter((r) => r.cls === "B");
    expect(b.length).toBeGreaterThanOrEqual(18);
    for (const { key } of b) {
      const inputs = MATSUYAMA_INPUTS[key];
      // 書類に直接書く入口（窓で書ける元がある）
      expect(writable(inputs), `${key} 直接書く`).toBe(true);
      // 様式の元は台帳
      expect(matsuyamaField(key).source, key).not.toMatch(/台帳に無い|手書き/);
      for (const i of inputs!) {
        if (i.kind === "page") continue;
        if (i.kind === "field") {
          // 台帳の置き場（入れる欄の表の form の欄）と、問い（定型の文と様式の問いの順）
          expect(intakeField(i.key)?.form, `${key} ${i.key} 置き場`).toBe(true);
          expect(FIELD_QUESTIONS[i.key], `${key} ${i.key} 問い`).toBeDefined();
          expect(FORM_FIELD_ORDER as readonly string[], `${key} ${i.key} 問いの順`).toContain(i.key);
        } else {
          // 連絡先の置き場（contacts.kana・address・mobile）と問い
          expect(CONTACT_PARTS as readonly string[], `${key} 置き場`).toContain(i.part === "phone" ? "mobile" : i.part);
          expect(CONTACT_QUESTIONS[i.part === "phone" ? "mobile" : i.part], `${key} 問い`).toBeDefined();
        }
      }
    }
  });

  it("様式の欄のための欄（form）は全部、問いの順と B の元のどこかにある", () => {
    const formFields = INTAKE_FIELDS.filter((f) => f.form).map((f) => f.key);
    expect([...FORM_FIELD_ORDER].sort()).toEqual([...formFields].sort());
    const bKeys = new Set(
      inventory()
        .filter((r) => r.cls === "B")
        .flatMap((r) => (MATSUYAMA_INPUTS[r.key] ?? []).flatMap((i) => (i.kind === "field" ? [i.key] : []))),
    );
    for (const k of formFields) expect(bKeys.has(k), k).toBe(true);
  });
});

describe("4 つの道のどれで入れても同じ台帳の値", () => {
  /** 問い・紙に直接書く・AI（書く話す）・読み取り（写真と PDF。分け方の形は同じ ExtractSchema）の変更 */
  async function viaQuestion(id: string, key: string, value: string) {
    const rows = await load(id);
    const q = questionQueue(rows).find((x) => x.key === key)!;
    expect(q, key).toBeDefined();
    const ch = answerChanges(q, q.answer.kind === "choice" ? { kind: "choice", values: [value] } : { kind: "value", value });
    expect(ch, key).not.toBeNull();
    expect(await save(id, rows.person.version!, ch!)).toMatchObject({ ok: true });
  }
  async function viaPaper(id: string, paperKey: MatsuyamaKey, draftKey: string, value: string) {
    const rows = await load(id);
    const target = paperEditData(rows).targets.find((t) => t.key === paperKey)!;
    const { changes, bad } = paperChanges(target, { [draftKey]: value });
    expect(bad).toEqual([]);
    expect(await save(id, rows.person.version!, changes, { edit: true })).toMatchObject({ ok: true });
  }
  async function viaAi(id: string, field: string, value: string) {
    const rows = await load(id);
    const out: ExtractOutput = ExtractSchema.parse({
      items: [{ field, value }],
      medications: [],
      devices: [],
      hazards: [],
      contacts: [],
      notes: [],
      unknowns: [],
    });
    const { items } = buildDiff({ ledger: parseLedger(rows.person.ledger), contacts: rows.contacts }, out, { text: (s) => s, note: (s) => s });
    const changes = items.flatMap((i) => (i.change ? [i.change] : []));
    expect(changes.length, field).toBe(1);
    expect(await save(id, rows.person.version!, changes, { ai: true })).toMatchObject({ ok: true });
  }
  const ledgerOf = async (id: string) => parseLedger((await load(id)).person.ledger);

  it("台帳の欄（最寄りの避難場所・組織の名称・避難先までの分）", async () => {
    const cases: Array<{ key: string; paper: MatsuyamaKey; value: string; stored: unknown }> = [
      { key: "evacuation.nearest", paper: "shelter.near.place", value: "あおば公園", stored: "あおば公園" },
      { key: "evacuation.destination1Minutes", paper: "shelter.city.minutes", value: "15", stored: 15 },
    ];
    for (const c of cases) {
      const vals: unknown[] = [];
      for (const way of ["question", "paper", "ai"] as const) {
        sqlite = migratedSqlite();
        for (const s of seedStatements()) sqlite.exec(s);
        db = d1FromSqlite(sqlite);
        if (way === "question") await viaQuestion("p-01", c.key, c.value);
        if (way === "paper") await viaPaper("p-01", c.paper, c.key, c.value);
        if (way === "ai") await viaAi("p-01", c.key, c.value);
        const l = await ledgerOf("p-01");
        vals.push(c.key.split(".").reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], l));
      }
      expect(vals, c.key).toEqual([c.stored, c.stored, c.stored]);
    }
    // 組織の名称は実施者のいない人に聞く（p-05 は実施者なし）
    const vals: unknown[] = [];
    for (const way of ["question", "paper", "ai"] as const) {
      sqlite = migratedSqlite();
      for (const s of seedStatements()) sqlite.exec(s);
      db = d1FromSqlite(sqlite);
      const id = noSupporter();
      if (way === "question") await viaQuestion(id, "local.orgName", "あおば自主防災会");
      if (way === "paper") await viaPaper(id, "org.name", "local.orgName", "あおば自主防災会");
      if (way === "ai") await viaAi(id, "local.orgName", "あおば自主防災会");
      vals.push((await ledgerOf(id)).local?.orgName);
    }
    expect(vals).toEqual(["あおば自主防災会", "あおば自主防災会", "あおば自主防災会"]);
  });

  it("連絡先のフリガナ・住所・携帯は問いと紙に直接書く道で同じ値。AI の道（書く話す・読み取り）では入らない", async () => {
    const vals: unknown[] = [];
    for (const way of ["question", "paper"] as const) {
      sqlite = migratedSqlite();
      for (const s of seedStatements()) sqlite.exec(s);
      db = d1FromSqlite(sqlite);
      const rows = await load("p-01");
      const kin = formContactOf(rows.contacts, "kin")!;
      if (way === "question") await viaQuestion("p-01", `contacts.${kin.id}.address`, "松山市 あおば町");
      else await viaPaper("p-01", "kin.address", `contacts.${kin.id}.address`, "松山市 あおば町");
      vals.push((await load("p-01")).contacts.find((c) => c.id === kin.id)?.address);
    }
    expect(vals).toEqual(["松山市 あおば町", "松山市 あおば町"]);

    // AI の分け方の形に連絡先のフリガナ・住所・携帯の置き場は無く、組織の電話（ai: false）も選べない
    const contactKeys = Object.keys((ExtractSchema.shape.contacts.element as unknown as { shape: Record<string, unknown> }).shape);
    for (const part of ["kana", "address", "mobile", "phone", "name"]) expect(contactKeys).not.toContain(part);
    expect(AI_INTAKE_KEYS).not.toContain("local.orgPhone");
    expect(ExtractSchema.safeParse({ items: [{ field: "local.orgPhone", value: "089" }], medications: [], devices: [], hazards: [], contacts: [], notes: [], unknowns: [] }).success).toBe(false);
    // 写真・PDF の読み取りも同じ欄の一覧（EXTRACT_RULES）で、組織の電話は載らない
    for (const sys of [EXTRACT_SYSTEM, READ_SYSTEM]) {
      expect(sys).toContain("- evacuation.nearest:");
      expect(sys).not.toContain("- local.orgPhone:");
    }
    expect(fieldGuide()).not.toContain("local.orgPhone");

    // AI の保存に混ぜると断る（作り替えた要求）
    const rows = await load("p-01");
    const kin = formContactOf(rows.contacts, "kin")!;
    const sneaky: IntakeChange[] = [{ t: "contact", id: kin.id, value: { kind: kin.kind, kana: "モリ" } }];
    expect(aiHandOnly(sneaky[0])).toBe(true);
    expect(SaveRequestSchema.safeParse({ personId: "p-01", version: rows.person.version, ai: { model: "claude-sonnet-5-5" }, changes: sneaky }).success).toBe(false);
    expect(await save("p-01", rows.person.version!, sneaky, { ai: true })).toEqual({ ok: false, error: "forbidden" });
    expect(await save("p-01", rows.person.version!, [{ t: "field", key: "local.orgPhone", value: "089-000-0000" }], { ai: true })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

/** 実施者のいない種の人 */
function noSupporter(): string {
  const p = SEED_PEOPLE.find((x) => !x.contacts.some((c) => c.supporter_order != null));
  return p!.person.id;
}

describe("フリガナ・住所・電話を Claude に渡さない", () => {
  it("仮名化の層に渡しても、連絡先のフリガナ・住所・携帯と組織の電話は送る形に入らない", () => {
    const p = seed("p-01");
    const rows: PersonPageRows = seedRows({
      ...p,
      ledger: { ...p.ledger, local: { orgName: "あおば自主防災会", orgPhone: "089-000-0042" } },
      contacts: p.contacts.map((c) => (c.emergency_order === 1 ? { ...c, kana: "モリ ケイコ", address: "松山市 あおば町", mobile: "090-0000-0077" } : c)),
    });
    const { payload } = pseudonymize([pseudonymInputOf(rows)], { on: TODAY });
    const sent = JSON.stringify(payload);
    for (const v of ["モリ ケイコ", "あおば町", "090-0000-0077", "0900000077", "089-000-0042", "あおば自主防災会"]) expect(sent, v).not.toContain(v);
  });

  it("問いの Claude に渡す言葉（focus）に連絡先の名前を入れない", () => {
    for (const p of SEED_PEOPLE) {
      const rows = seedRows(p);
      for (const q of questionQueue(rows).filter((x) => x.group === "form")) {
        for (const c of rows.contacts) if (c.name) expect(q.focus, q.key).not.toContain(c.name);
      }
    }
  });
});

describe("紙の未確認と問いを同じ元から数える", () => {
  it("帯の「問い」の欄は、本人のページの問いの列（残り N 問）のどれかが元に当たる欄。手書きは引用の印だけ", () => {
    for (const p of SEED_PEOPLE) {
      const rows = seedRows(p);
      const keys = questionQueue(rows).map((q) => q.key);
      const ask = matsuyamaAskable(keys, rows.contacts);
      expect([...matsuyamaAskableOf(rows)].sort()).toEqual([...ask].sort());
      const s = matsuyamaUnconfirmed(buildMatsuyamaSheet(rows, OPTS), ask);
      const v = unconfirmedView(s);
      expect(v.count, p.person.id).toBe((v.ask ?? []).length + v.blank.length);
      expect(v.noSource, p.person.id).toEqual(["まつやま総合防災マップからの引用"]);
      // 問いが空なら「問い」の欄も無い
      expect(matsuyamaAskable([], rows.contacts).size).toBe(0);
    }
  });

  it("紙に載る問いに全部答えると、帯の「問い」の欄が無くなる（p-01）", async () => {
    expect(matsuyamaAskableOf(await load("p-01")).size).toBeGreaterThan(5);
    // 場所を答えると手段と時間の問いが出るので、問いが無くなるまで答える（3 回まで）
    for (let round = 0; round < 3; round++) {
      const rows = await load("p-01");
      const changes: IntakeChange[] = [];
      for (const q of questionQueue(rows)) {
        const ch = answerChanges(q, sample(q));
        if (ch) changes.push(...ch);
      }
      if (changes.length === 0) break;
      expect(await save("p-01", rows.person.version!, changes)).toMatchObject({ ok: true });
    }
    const after = await load("p-01");
    const v = unconfirmedView(matsuyamaUnconfirmed(buildMatsuyamaSheet(after, OPTS), matsuyamaAskableOf(after)));
    expect(v.ask).toEqual([]);
    expect(questionQueue(after).filter((q) => q.group === "form")).toEqual([]);
  });

  it("種の 10 人で紙の未確認が減る: フリガナの入った人は近親者・実施者のフリガナが未確認でない、実施者のいる人の実施組織・電話のある人の 2 つ目の電話は空き枠", () => {
    for (const p of SEED_PEOPLE) {
      const rows = seedRows(p);
      const sheet = buildMatsuyamaSheet(rows, OPTS);
      const kin = formContactOf(rows.contacts, "kin");
      if (kin?.kana) expect(cellText(sheet.cells["kin.kana"]), p.person.id).toBe(kin.kana);
      if (rows.contacts.some((c) => c.supporter_order != null) && sheet.withheld.length === 0) expect(sheet.cells["org.name"].kind).toBe("empty");
      if (kin?.phone && !kin.mobile && !(kin.note ?? "").includes("携帯")) expect(sheet.cells["kin.mobile"].kind).toBe("empty");
      expect(sheet.cells["housing.type"].kind, p.person.id).toBe("choice");
      expect(cellText(sheet.cells["housing.type"])).toContain("■戸建住宅");
      // 帯の未確認は前（T117 の前は台帳に置き場の無い 11〜13 欄がいつも数えられた）より少ない
      expect(matsuyamaUnconfirmed(sheet).count, p.person.id).toBeLessThanOrEqual(20);
    }
  });
});

describe("問い", () => {
  it("様式の欄の問いは今の決まり（医療 → 夜間 → その他）の後ろ。避難場所の手段と時間は場所が入ってから、組織は実施者のいないときだけ", () => {
    for (const p of SEED_PEOPLE) {
      const q = questionQueue(seedRows(p));
      const first = q.findIndex((x) => x.group === "form");
      if (first >= 0) expect(q.slice(first).every((x) => x.group === "form"), p.person.id).toBe(true);
    }
    const p = seed("p-01");
    const none = questionQueue(seedRows({ ...p, ledger: { ...p.ledger, evacuation: { ...p.ledger.evacuation, nearest: undefined } } })).map((x) => x.key);
    expect(none).toContain("evacuation.nearest");
    expect(none).not.toContain("evacuation.nearestMinutes");
    expect(none).not.toContain("local.orgName");
    const set = questionQueue(seedRows({ ...p, ledger: { ...p.ledger, evacuation: { ...p.ledger.evacuation, nearest: "あおば公園" } } })).map((x) => x.key);
    expect(set).toContain("evacuation.nearestMinutes");
    expect(questionQueue(seedRows(seed(noSupporter()))).map((x) => x.key)).toContain("local.orgName");
  });

  it("連絡先の問い: 近親者・実施者のフリガナ・住所、携帯は電話も携帯も無い人だけ。文は定型で名前と続柄を差し込む", () => {
    const p = seed("p-01");
    const rows = seedRows({ ...p, contacts: p.contacts.map((c) => ({ ...c, kana: null })) });
    const q = questionQueue(rows).filter((x) => x.group === "form" && x.key.startsWith("contacts."));
    const kin = formContactOf(rows.contacts, "kin")!;
    expect(q.map((x) => x.key)).toContain(`contacts.${kin.id}.kana`);
    expect(q.map((x) => x.key)).not.toContain(`contacts.${kin.id}.mobile`);
    const kana = q.find((x) => x.key === `contacts.${kin.id}.kana`)!;
    expect(kana.text).toContain(kin.name!);
    expect(kana.example).toMatch(/^例: /);
    expect(answerChanges(kana, { kind: "value", value: "もり けいこ" })).toEqual([{ t: "contact", id: kin.id, value: { kind: kin.kind, kana: "モリ ケイコ" } }]);
    const noPhone = seedRows({ ...p, contacts: p.contacts.map((c) => (c.id === kin.id ? { ...c, phone: null } : c)) });
    const mobile = questionQueue(noPhone).find((x) => x.key === `contacts.${kin.id}.mobile`)!;
    expect(answerChanges(mobile, { kind: "value", value: "０９０－００００－００７７" })).toEqual([
      { t: "contact", id: kin.id, value: { kind: kin.kind, mobile: "090-0000-0077" } },
    ]);
    expect(answerChanges(mobile, { kind: "value", value: "わからない" })).toBeNull();
  });

  it("避難先 1 までの時間の問いは、経路地図の見込みを初めの値に（人が確かめて保存する）", () => {
    const p = seed("p-01");
    const ledger = {
      ...p.ledger,
      care: { ...p.ledger.care, walking: "ok" as const, bedridden: false },
      evacuation: {
        ...p.ledger.evacuation,
        transportKind: "foot" as const,
        routeMap: { to: 1 as const, mode: "foot" as const, source: "hand" as const, line: [], via: [], distanceM: 600, view: { center: { lat: 33.84, lng: 132.76 }, z: 16 } },
      },
    };
    expect(routeMinutes(ledger, 1)).toBe(10);
    const q = questionQueue(seedRows({ ...p, ledger })).find((x) => x.key === "evacuation.destination1Minutes")!;
    expect(q.answer).toMatchObject({ kind: "int", suggest: 10 });
    expect(routeMinutes(ledger, 2)).toBeNull();
  });
});

describe("紙に直接書く", () => {
  it("押せる欄は計画書の B と A の値の欄。手書きの欄・作成日・区分・別紙・引用の印は押せない", () => {
    const data = paperEditData(seedRows(seed("p-01")));
    const keys = new Set(data.targets.map((t) => t.key));
    for (const k of ["head.number", "sign.self", "sign.proxy", "city.stamp", "route.map", "head.date", "target.category", "notes.annex", "risk.timing"] as const) {
      if (k === "target.category") continue;
      expect(keys.has(k), k).toBe(false);
    }
    for (const r of inventory().filter((x) => x.cls === "B")) expect(keys.has(r.key), r.key).toBe(true);
  });

  it("居ない人の欄は書けず、本人のページの関係者の面へ。いる人は今の値が入る", () => {
    const p = seed("p-01");
    const rows = seedRows({ ...p, contacts: p.contacts.filter((c) => c.supporter_order !== 2) });
    const data = paperEditData(rows);
    const s2 = data.targets.find((t) => t.key === "supporter2.kana")!;
    expect(s2.inputs).toEqual([{ kind: "page", label: "関係者（支援者2 なし）", href: "/people/p-01" }]);
    const kin = data.targets.find((t) => t.key === "kin.kana")!;
    expect(kin.inputs[0]).toMatchObject({ kind: "contact", part: "kana", value: "モリ ケイコ" });
  });

  it("窓の変更: 空にすれば外す、形の合わない値は送らない、変わらなければ何も送らない", () => {
    const rows = seedRows(seed("p-01"));
    const data = paperEditData(rows);
    const t = (k: MatsuyamaKey): PaperTarget => data.targets.find((x) => x.key === k)!;
    expect(paperChanges(t("shelter.city.minutes"), { "evacuation.destination1Minutes": "たくさん" }).bad).toEqual(["避難先1時間"]);
    expect(paperChanges(t("shelter.city.place"), { "evacuation.destination1": "" }).changes).toEqual([
      { t: "remove", target: { what: "field", key: "evacuation.destination1" } },
    ]);
    const kin = formContactOf(rows.contacts, "kin")!;
    expect(paperChanges(t("kin.kana"), { [`contacts.${kin.id}.kana`]: "モリ ケイコ" }).changes).toEqual([]);
    expect(paperChanges(t("kin.mobile"), { [`contacts.${kin.id}.mobile`]: "abc" }).bad.length).toBe(1);
  });

  it("前からの紙面を包むと、押せる欄に画面だけの印を付ける所（data-field）があり、窓は押すまで出ない", () => {
    const rows = seedRows(seed("p-01"));
    const html = renderToStaticMarkup(
      createElement(PaperEdit, { data: paperEditData(rows), children: createElement(MatsuyamaSheet, { sheet: buildMatsuyamaSheet(rows, OPTS) }) }),
    );
    expect(html).toContain("data-paper-edit");
    expect(html).toContain('data-field="kin.kana"');
    expect(html).not.toContain("data-paper-edit-window");
    // 紙には押せる印の CSS が印刷で消える決まりがある
    const css = readFileSync(new URL("../../components/forms/paper-edit.css", import.meta.url), "utf8");
    expect(css).toMatch(/@media print[\s\S]*\.ov-edit[\s\S]*display: none/);
  });
});

/** 問いの答えの見本（種の p-01 の問いの形ごと） */
function sample(q: Question): Parameters<typeof answerChanges>[1] {
  const a = q.answer;
  switch (a.kind) {
    case "choice":
      return { kind: "choice", values: [a.options[0].value] };
    case "night":
      return { kind: "night", contactIds: a.contacts.slice(0, 1).map((c) => c.id) };
    case "int":
    case "clock":
      return { kind: "value", value: "10" };
    case "contact":
      return { kind: "value", value: a.part === "mobile" ? "090-0000-0099" : a.part === "kana" ? "テスト" : "松山市 あおば町" };
    case "list":
      return { kind: "value", value: "なし" };
    default:
      return { kind: "value", value: "見本" };
  }
}
