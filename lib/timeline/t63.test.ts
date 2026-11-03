// 経過の撤回（docs/tasks/T63.md）。行は消さず、誰が・いつ・理由を行に持つ。撤回できるのは人が書いた行だけ、
// 撤回できる人は書いた本人と、事業所のケアマネ（ケアマネの書いた行だけ）。D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。
// この作業は Claude を呼ばない。撤回の理由も Claude に渡さない（下の「Claude の入力」）。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { staffActor } from "../custody/actor.ts";
import { receive, release } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { CALL_SOURCE } from "../list/calls.ts";
import { callPost } from "../list/http.ts";
import { RETRACT_NOTE_MAX } from "./paths.ts";
import { CALL_PAYLOAD_SOURCE, canRetract, parseRetract, retractableRow, retractTimeline, retractTimelineRequest } from "./retract.ts";
import { writeTimelineRequest } from "./write.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const AT = "2026-11-03T01:00:00.000Z";
/** 撤回の時刻 11/3 22:10（JST） */
const RETRACT_AT = "2026-11-03T13:10:00.000Z";
const SHELTER = "みどり小学校";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-gov-1', NULL, 'government', '市 防災課')`).run();
  sqlite
    .prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-cm-2', 'office-demo', 'care_manager', '佐藤')`)
    .run();
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
const government = (): Principal => ({ ...base, role: "government", judge: false, accountId: "acct-gov-1", displayName: "市 防災課", office: null });
const judgeCm = (): Principal => ({ ...base, role: "care_manager", caseloadOf: "acct-yamamoto", displayName: "山本" });
const yamamoto = (): Principal => ({ ...judgeCm(), judge: false, admin: true, accountId: "acct-yamamoto" });
/** 同じ事業所の別のケアマネ */
const sato = (): Principal => ({ ...yamamoto(), admin: false, accountId: "acct-cm-2", caseloadOf: "acct-cm-2", displayName: "佐藤" });
/** 別の事業所のケアマネ */
const partner = (): Principal => ({
  ...yamamoto(),
  accountId: "acct-partner-cm",
  caseloadOf: "acct-partner-cm",
  office: { id: "office-partner", name: "協力事業所", kind: "regular" },
});
const self = (): Principal => ({ ...base, role: "self", judge: true, accountId: "acct-judge", personId: "p-01" });
const family = (): Principal => ({ ...base, role: "family", judge: true, accountId: "acct-judge", personId: "p-01", contactId: "c-01-1" });

async function received(personId: string, p: Principal = medical()) {
  const r = await receive(db, staffActor(p)!, { personId, shelter: SHELTER, via: "search" }, AT);
  if (!r.ok) throw new Error(r.error);
  return r.custodyId;
}

async function write(p: Principal, kind: string, body: string | null = null, personId = "p-01"): Promise<string> {
  const out = await writeTimelineRequest(db, p, { personId, kind, body }, AT);
  if (out.status !== 200) throw new Error(JSON.stringify(out.body));
  return String(out.body.id);
}

const retract = (p: Principal | null, raw: unknown, at = RETRACT_AT) => retractTimelineRequest(db, p, raw, at);
const rowOf = (id: string) => sqlite.prepare("SELECT * FROM timeline_entries WHERE id = ?").get(id) as Record<string, unknown>;
const count = () => Number((sqlite.prepare("SELECT count(*) AS n FROM timeline_entries").get() as { n: number }).n);

/** 経過の表に行を直に 1 行（撤回できない種類・payload の形を通すため） */
function insertEntry(e: { id: string; kind: string; author_role: string; author_id: string | null; payload?: string | null; body?: string | null }) {
  sqlite
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, signal_id, occurred_at)
       VALUES (?, 'p-01', ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(e.id, e.author_id, e.author_role, e.kind, e.body ?? null, e.payload ?? null, AT);
}

describe("撤回の往復", () => {
  it("撤回すると行は消えず、撤回の 3 列だけが入る（誰が・いつ・理由）。本文・payload・時刻は変わらない", async () => {
    const id = await write(yamamoto(), "note", "避難所 みどり小学校 到着");
    const before = rowOf(id);
    const n = count();
    const out = await retract(yamamoto(), { id, note: " 人違い " });
    expect(out).toEqual({ status: 200, body: { ok: true, id, at: RETRACT_AT } });
    expect(count()).toBe(n);
    expect(rowOf(id)).toEqual({
      ...before,
      retracted_at: RETRACT_AT,
      retracted_by: "acct-yamamoto",
      retracted_note: "人違い",
    });
  });

  it("理由は任意（空は null）、40 字まで。41 字・改行・制御文字・形の違いは断る", async () => {
    const id = await write(yamamoto(), "safety_check");
    expect(parseRetract({ id })).toEqual({ ok: true, value: { id, note: null } });
    expect(parseRetract({ id, note: "   " })).toEqual({ ok: true, value: { id, note: null } });
    expect(parseRetract({ id, note: "あ".repeat(RETRACT_NOTE_MAX) })).toEqual({ ok: true, value: { id, note: "あ".repeat(RETRACT_NOTE_MAX) } });
    expect(parseRetract({ id, note: "あ".repeat(RETRACT_NOTE_MAX + 1) })).toEqual({ ok: false, error: "too_long" });
    expect(parseRetract({ id, note: "1 行目\n2 行目" })).toEqual({ ok: false, error: "invalid" });
    expect(parseRetract({ id, note: "a\u0007b" })).toEqual({ ok: false, error: "invalid" });
    expect(parseRetract({ id, note: 3 })).toEqual({ ok: false, error: "invalid" });
    expect(parseRetract({ id: "../x" })).toEqual({ ok: false, error: "invalid" });
    expect(parseRetract(null)).toEqual({ ok: false, error: "invalid" });
    expect((await retract(yamamoto(), { id, note: "あ".repeat(RETRACT_NOTE_MAX + 1) })).body).toEqual({
      ok: false,
      error: "too_long",
      label: "理由 超過",
    });
    expect(rowOf(id).retracted_at).toBeNull();
    // 理由なしは通る
    expect((await retract(yamamoto(), { id })).status).toBe(200);
    expect(rowOf(id)).toMatchObject({ retracted_at: RETRACT_AT, retracted_note: null });
  });

  it("migration 0014 の CHECK: 理由は 41 字を入れられない（サーバーの検査をすり抜けても）", async () => {
    const id = await write(yamamoto(), "safety_check");
    expect(() => sqlite.prepare("UPDATE timeline_entries SET retracted_note = ? WHERE id = ?").run("あ".repeat(41), id)).toThrow();
    sqlite.prepare("UPDATE timeline_entries SET retracted_note = ? WHERE id = ?").run("あ".repeat(40), id);
    // 撤回したアカウントの行が消えたら retracted_by は NULL（撤回した事実は時刻で残る）
    sqlite.prepare("UPDATE timeline_entries SET retracted_at = ?, retracted_by = 'acct-cm-2' WHERE id = ?").run(RETRACT_AT, id);
    sqlite.prepare("DELETE FROM accounts WHERE id = 'acct-cm-2'").run();
    expect(rowOf(id)).toMatchObject({ retracted_at: RETRACT_AT, retracted_by: null });
    // 信号の表にも retracted_at
    const cols = (sqlite.prepare("PRAGMA table_info(signals)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain("retracted_at");
  });

  it("二度目は 409（撤回済）。同時の撤回も 1 回だけ（UPDATE は retracted_at IS NULL の行だけ）", async () => {
    const id = await write(yamamoto(), "safety_check");
    const [a, b] = await Promise.all([retract(yamamoto(), { id, note: "1" }), retract(judgeCm(), { id, note: "2" })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.label, b.body.label]).toContain("撤回済");
    const again = await retract(yamamoto(), { id }, "2026-11-03T14:00:00.000Z");
    expect(again).toEqual({ status: 409, body: { ok: false, error: "already", label: "撤回済" } });
    // 最初の撤回のまま
    expect(rowOf(id).retracted_at).toBe(RETRACT_AT);
  });

  it("電話の記録（called、payload の source が call）は撤回できる", async () => {
    const contact = (sqlite.prepare("SELECT id FROM contacts WHERE person_id = 'p-01' AND kind = 'family' ORDER BY sort LIMIT 1").get() as {
      id: string;
    }).id;
    const res = await callPost(db, yamamoto(), { person: "p-01", contact, result: "no_answer" }, AT);
    expect(res.status).toBe(200);
    const id = (sqlite.prepare("SELECT id FROM timeline_entries WHERE kind = 'called'").get() as { id: string }).id;
    expect((await retract(yamamoto(), { id, note: "番号違い" })).status).toBe(200);
    expect(rowOf(id)).toMatchObject({ retracted_by: "acct-yamamoto", retracted_note: "番号違い" });
    // 画面の印の source は電話の記録の source と同じ字
    expect(CALL_PAYLOAD_SOURCE).toBe(CALL_SOURCE);
  });
});

describe("撤回できる行", () => {
  it("撤回できない種類（信号・順番変更・同意・時計の確認・本人の報告の印・迎え・受入・退所）は 409（撤回不可）", async () => {
    const kinds = ["signal", "override", "consent", "clock_check", "self_report_mark", "pickup", "received", "released"];
    for (const kind of kinds) {
      insertEntry({ id: `x-${kind}`, kind, author_role: "care_manager", author_id: "acct-yamamoto" });
      expect(await retract(yamamoto(), { id: `x-${kind}` })).toEqual({
        status: 409,
        body: { ok: false, error: "not_retractable", label: "撤回不可" },
      });
      expect(rowOf(`x-${kind}`).retracted_at).toBeNull();
    }
  });

  it("payload つきの記録（入れる欄・事業所・受け持ち・QR 閲覧・分類）と、受け持ちの搬送（payload つき）は撤回できない", async () => {
    const payloads: Array<[string, string, string, string | null]> = [
      ["intake", "note", "care_manager", JSON.stringify({ source: "intake", ai: true, model: null, fields: ["basic.household"] })],
      ["office", "note", "care_manager", JSON.stringify({ source: "office", action: "added" })],
      ["qr", "note", "medical", JSON.stringify({ source: "qr_view", scope: "medical_summary", generation: 1 })],
      ["classify", "note", "system", JSON.stringify({ source: "classify", ai: true, model: "m", classes: ["injury"] })],
      ["system-plain", "note", "system", null],
      ["called-odd", "called", "care_manager", JSON.stringify({ source: "other" })],
      ["called-none", "called", "care_manager", null],
    ];
    for (const [name, kind, role, payload] of payloads) {
      insertEntry({ id: `x-${name}`, kind, author_role: role, author_id: role === "system" ? null : "acct-yamamoto", payload });
      const out = await retract(yamamoto(), { id: `x-${name}` });
      expect([name, out.status, out.body.error]).toEqual([name, 409, "not_retractable"]);
    }
    // 受け持ちの搬送は custody の記録と結ぶ（撤回しても受け持ちの閉じは戻らないので、経過だけ撤回させない）
    const custodyId = await received("p-01");
    await release(db, staffActor(medical())!, { custodyId, kind: "transported", note: "中央病院" }, AT);
    await received("p-01");
    const tr = sqlite.prepare("SELECT id FROM timeline_entries WHERE kind = 'transported'").get() as { id: string };
    expect((await retract(medical(), { id: tr.id })).body.error).toBe("not_retractable");
  });

  it("retractableRow は行の形だけで決める（書き足しの 6 種類は payload が無い物、called は電話の記録の payload）", () => {
    const row = (kind: string, payload: string | null = null, author_role = "care_manager") =>
      retractableRow({ kind, payload, author_role, retracted_at: null } as Parameters<typeof retractableRow>[0]);
    for (const k of ["safety_check", "examined", "medication_given", "transported", "arrived_shelter", "note"]) expect(row(k)).toBe(true);
    expect(row("note", "{}")).toBe(false);
    expect(row("called", JSON.stringify({ source: "call", contactId: "c", contactKind: "family", result: "dialed" }))).toBe(true);
    expect(row("note", null, "system")).toBe(false);
    expect(row("note", null, "self")).toBe(false);
    expect(retractableRow({ kind: "note", payload: null, author_role: "care_manager", retracted_at: RETRACT_AT })).toBe(false);
  });
});

describe("撤回できる人", () => {
  it("書いた本人は撤回できる（医療班・行政は受け持ちの間だけ）", async () => {
    const custodyId = await received("p-01");
    const exam = await write(medical(), "examined", "呼吸 落ち着いている");
    await received("p-01", government());
    const gov = await write(government(), "safety_check");
    expect((await retract(government(), { id: gov })).status).toBe(200);
    // 受け持ちを閉じたら壁の外（在っても無くても同じ 404）
    await release(db, staffActor(medical())!, { custodyId, kind: "discharged", note: null }, AT);
    expect(await retract(medical(), { id: exam })).toEqual({ status: 404, body: { ok: false, error: "not_found", label: "該当なし" } });
    expect(rowOf(exam).retracted_at).toBeNull();
    await received("p-01");
    expect((await retract(medical(), { id: exam })).status).toBe(200);
  });

  it("事業所のケアマネは、ほかのケアマネの書いた行も撤回できる（審査員は山本の行も）", async () => {
    const a = await write(yamamoto(), "note", "訪問");
    const b = await write(sato(), "safety_check");
    expect((await retract(judgeCm(), { id: a })).status).toBe(200);
    expect(rowOf(a).retracted_by).toBe("acct-judge");
    expect((await retract(yamamoto(), { id: b })).status).toBe(200);
  });

  it("ケアマネは医療班・行政の書いた行を撤回できない（403）。医療班は人の行を撤回できない", async () => {
    await received("p-01");
    await received("p-01", government());
    const exam = await write(medical(), "examined");
    const gov = await write(government(), "note", "避難所 受入");
    const cm = await write(yamamoto(), "note", "訪問");
    for (const id of [exam, gov]) {
      expect(await retract(yamamoto(), { id })).toEqual({ status: 403, body: { ok: false, error: "forbidden", label: "権限なし" } });
    }
    expect((await retract(medical(), { id: cm })).status).toBe(403);
    expect((await retract(medical(), { id: gov })).status).toBe(403);
    expect((await retract(government(), { id: exam })).status).toBe(403);
    expect(sqlite.prepare("SELECT count(*) AS n FROM timeline_entries WHERE retracted_at IS NOT NULL").get()).toEqual({ n: 0 });
  });

  it("審査員の役が違えば自分の行でも撤回できない（ケアマネの役で書いた行を医療班の役で）", async () => {
    await received("p-01");
    const cm = await write(judgeCm(), "note", "訪問");
    expect((await retract(medical(), { id: cm })).status).toBe(403);
  });

  it("別の事業所のケアマネは 404、本人・家族・役未選択は 403、ログインなしは 401", async () => {
    const id = await write(yamamoto(), "safety_check");
    expect((await retract(partner(), { id })).status).toBe(404);
    for (const p of [self(), family(), { ...base, role: "unselected" as const }]) {
      expect((await retract(p, { id })).status).toBe(403);
    }
    expect(await retract(null, { id })).toEqual({ status: 401, body: { ok: false, error: "login_required", label: "ログイン要" } });
    expect((await retract(yamamoto(), { id: "t-nobody" })).status).toBe(404);
    expect(rowOf(id).retracted_at).toBeNull();
  });

  it("retractTimeline も同じ所で断る（API を通らない呼び出しでも）。canRetract は画面のボタンと同じ述語", async () => {
    await received("p-01");
    const exam = await write(medical(), "examined");
    expect(await retractTimeline(db, yamamoto(), { id: exam, note: null }, RETRACT_AT)).toEqual({ ok: false, error: "forbidden" });
    const row = rowOf(exam) as Parameters<typeof canRetract>[1];
    expect(canRetract(medical(), row)).toBe(true);
    expect(canRetract(yamamoto(), row)).toBe(false);
    expect(canRetract(self(), row)).toBe(false);
  });
});

describe("Claude の入力", () => {
  it("撤回の理由は Claude に渡らない: askJson を呼ぶ所は経過の表と撤回の列を読まない", () => {
    const ROOT = join(__dirname, "..", "..");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return files(p);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
      });
    const callers = [...files(join(ROOT, "lib")), ...files(join(ROOT, "app"))].filter((f) => {
      const s = readFileSync(f, "utf8");
      return /\baskJson\(/.test(s) && !f.replaceAll("\\", "/").endsWith("lib/claude/call.ts");
    });
    expect(callers.length).toBeGreaterThan(0);
    const reading = callers.filter((f) => /timeline_entries|retracted_note|retracted|timelineItems|lib\/timeline/.test(readFileSync(f, "utf8")));
    expect(reading.map((f) => relative(ROOT, f))).toEqual([]);
  });
});
