// 通話で聞いた安否の撤回（docs/tasks/T63.md の 4）。電話の記録（called）を撤回すると、結んだ信号（出どころ care_manager）も
// ルールの表から外れ、色・連絡順・理由が通話の前に戻る。表を読む 4 画面（担当一覧・本人のページ・様式 9・受け持ち）で同じ。
// 本人・家族・支援者・訓練の信号は外さない。lib/triage の行・言葉は変えない。D1 は node:sqlite に種の 10 人。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { staffActor } from "../custody/actor.ts";
import { loadStaffBoard } from "../custody/board.ts";
import { receive } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadSituation, saveDisasterInfo, switchDisasterMode } from "../disaster/db.ts";
import { personDisaster } from "../disaster/person.ts";
import { disasterScope } from "../disaster/scope.ts";
import { loadForm9 } from "../forms/form9-db.ts";
import { callPost } from "../list/http.ts";
import { loadPersonPage, toPersonView } from "../person.ts";
import { NO_ANSWERS, type SignalBody } from "../signals/body.ts";
import { saveSignal, signalScope } from "../signals/save.ts";
import { retractTimelineRequest } from "./retract.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const yamamoto = (): Principal => ({
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
});
const medical = (): Principal => ({
  ...yamamoto(),
  role: "medical",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  caseloadOf: null,
  displayName: null,
});
/** 審査員の本人のスマホ（p-01） */
const self = (): Principal => ({
  ...yamamoto(),
  role: "self",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  caseloadOf: null,
  personId: "p-01",
});

/** 浸水と停電の時刻（2026-11-05 18:00 JST）。発災は -2 時間。停電は事業所全体で 0 時間から */
const FLOOD = Date.parse("2026-11-05T09:00:00.000Z");
const at = (h: number) => new Date(FLOOD + h * 3_600_000).toISOString();
const SCOPE = { officeId: "office-demo", careManagerId: "acct-yamamoto" };
const TODAY = "2026-11-05";
/** 4 画面を読む時刻。通話（0.5）と撤回（0.6）のあと、時計で色が動かない 1 時間の中 */
const NOW = at(0.7);

async function heavyRain() {
  const scope = disasterScope(yamamoto())!;
  expect(await switchDisasterMode(db, scope, { kind: "heavy_rain", version: 0, at: at(-2) })).toEqual({ ok: true, changed: true });
  expect(
    await saveDisasterInfo(db, scope, {
      version: 1,
      at: at(0),
      info: { startedAt: at(-2), outage: { scope: "office", towns: [], startedAt: at(0) }, alertLevel: 4, water: null, road: null },
    }),
  ).toEqual({ ok: true, changed: true });
}

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const red = (answers: Partial<SignalBody["answers"]>, time: string): SignalBody => ({
  id: uuid(),
  color: "red",
  whereNow: null,
  answers: { ...NO_ANSWERS, ...answers },
  occurredAt: time,
  sentAt: time,
});

const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
const contactOf = (person: string) =>
  (rows(`SELECT id FROM contacts WHERE person_id = '${person}' AND kind = 'family' ORDER BY sort LIMIT 1`)[0] as { id: string }).id;

async function call(person: string, body: Record<string, unknown>, h: number) {
  const res = await callPost(db, yamamoto(), { person, contact: contactOf(person), result: "connected", ...body }, at(h));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/** いちばん新しい電話の記録の行を撤回する */
async function retractLastCall(person: string, h: number) {
  const id = (
    rows(`SELECT id FROM timeline_entries WHERE kind = 'called' AND person_id = '${person}' ORDER BY occurred_at DESC LIMIT 1`)[0] as {
      id: string;
    }
  ).id;
  const out = await retractTimelineRequest(db, yamamoto(), { id, note: "人違い" }, at(h));
  expect(out.status).toBe(200);
  return id;
}

/** 医療班が発災より前に受け入れる（受け持ちの一覧を開くため）。受入中の受け入れは発災より前でも表に数える（T80）ので、通話の前は受入の緑「到着」 */
async function receivedBeforeDisaster(person: string) {
  const r = await receive(db, staffActor(medical())!, { personId: person, shelter: "みどり小学校", via: "search" }, at(-3));
  expect(r.ok).toBe(true);
}

type Shot = { color: string | null; reason: string; rank: number | null; rule?: string };

/** 表を読む 4 画面の、その人の色・理由・順 */
async function screens(person: string): Promise<{ caseload: Shot; page: Shot; form9: Shot; staff: Shot }> {
  const list = (await loadCaseload(db, SCOPE, TODAY, NOW))!.rows.find((r) => r.id === person)!;
  const pageRows = (await loadPersonPage(db, yamamoto(), person))!;
  const d = await personDisaster(db, pageRows, NOW);
  const situation = await loadSituation(db, "office-demo", NOW);
  const f9 = (await loadForm9(db, { officeId: "office-demo" }, { today: TODAY, situation }))!.sheet.rows.find((r) => r.id === person)!;
  const staff = (await loadStaffBoard(db, staffActor(medical())!, TODAY, NOW)).rows.find((r) => r.personId === person)!;
  return {
    caseload: { color: list.triage!.color, reason: list.triage!.reason, rank: list.rank, rule: list.triage!.rule },
    page: { color: d.triage!.color, reason: d.triage!.reason, rank: null, rule: d.triage!.rule },
    form9: { color: f9.color, reason: f9.reason, rank: f9.rank },
    staff: { color: staff.color, reason: staff.reason, rank: null },
  };
}

const colors = (s: Awaited<ReturnType<typeof screens>>) => [s.caseload.color, s.page.color, s.form9.color, s.staff.color];

describe("通話で聞いた安否の撤回で、4 画面の色・順・理由が通話の前に戻る", () => {
  it("通話で「無事」→ 4 画面とも「ケアマネが「無事」」→ 撤回 → 4 画面とも通話の前（受入の緑「到着」）と同じ。信号は消えず retracted_at だけ", async () => {
    await heavyRain();
    await receivedBeforeDisaster("p-05");
    const before = await screens("p-05");
    // 受入中は発災より前の受け入れも表に数える（T80。前は数えず 灰 不明だった）
    expect(before.caseload).toMatchObject({ color: "green", rule: "green" });
    expect(before.caseload.reason.startsWith("到着 みどり小学校")).toBe(true);
    expect(colors(before)).toEqual(["green", "green", "green", "green"]);

    expect((await call("p-05", { heard: { color: "green" } }, 0.5)).status).toBe(200);
    const heard = await screens("p-05");
    expect(colors(heard)).toEqual(["green", "green", "green", "green"]);
    // 理由は表の言葉（p-05 は「ケアマネが「無事」、支援者なし」）。担当一覧・本人のページ・様式 9 で同じ
    expect(heard.caseload.reason.startsWith("ケアマネが「無事」")).toBe(true);
    expect([heard.page.reason, heard.form9.reason]).toEqual([heard.caseload.reason, heard.caseload.reason]);

    const entry = await retractLastCall("p-05", 0.6);
    expect(await screens("p-05")).toEqual(before);
    const sig = rows("SELECT id, source, retracted_at FROM signals WHERE person_id = 'p-05'");
    expect(sig).toEqual([{ id: sig[0].id, source: "care_manager", retracted_at: at(0.6) }]);
    expect(rows(`SELECT signal_id FROM timeline_entries WHERE id = '${entry}'`)[0].signal_id).toBe(sig[0].id);
  });

  it("本人の赤のあとのケアマネの「けが」（赤の最上位）を撤回すると、本人の赤（red）に戻る。本人の信号は外さない", async () => {
    await heavyRain();
    await receivedBeforeDisaster("p-01");
    await saveSignal(db, signalScope(self())!, red({}, at(0.3)), at(0.3));
    const before = await screens("p-01");
    expect(before.caseload).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });

    expect((await call("p-01", { heard: { color: "red", injured: true } }, 0.5)).status).toBe(200);
    const heard = await screens("p-01");
    expect(heard.caseload).toMatchObject({ color: "red", rule: "red_injury", reason: "ケアマネが「けが」" });
    expect(heard.page).toMatchObject({ rule: "red_injury", reason: "ケアマネが「けが」" });

    await retractLastCall("p-01", 0.6);
    expect(await screens("p-01")).toEqual(before);
    expect(rows("SELECT source, retracted_at FROM signals ORDER BY source")).toEqual([
      { source: "care_manager", retracted_at: at(0.6) },
      { source: "self", retracted_at: null },
    ]);
  });

  it("「至急維持」で断られた通話は信号も経過も残らない。そのあとの安否なしの通話（聞けず）を撤回しても色は動かず、信号に触らない", async () => {
    await heavyRain();
    await receivedBeforeDisaster("p-01");
    await saveSignal(db, signalScope(self())!, red({ canMove: false }, at(0.3)), at(0.3));
    const before = await screens("p-01");
    expect(before.caseload).toMatchObject({ rule: "red_injury", reason: "本人が「動けない」" });
    expect(await call("p-01", { heard: { color: "green" } }, 0.5)).toEqual({
      status: 409,
      json: { ok: false, error: "injury", label: "無事 不可（本人が「動けない」）" },
    });
    expect(rows("SELECT * FROM timeline_entries WHERE kind = 'called'")).toEqual([]);

    expect((await call("p-01", { memo: "折り返し待ち" }, 0.5)).status).toBe(200);
    expect(rows("SELECT signal_id FROM timeline_entries WHERE kind = 'called'")).toEqual([{ signal_id: null }]);
    await retractLastCall("p-01", 0.6);
    expect(await screens("p-01")).toEqual(before);
    expect(rows("SELECT source, retracted_at FROM signals")).toEqual([{ source: "self", retracted_at: null }]);
  });

  it("本人のページの経過では、取り消し線は電話の記録の行に付く（通話の信号には経過の行が無い）", async () => {
    await heavyRain();
    await call("p-05", { heard: { color: "green" } }, 0.5);
    const id = await retractLastCall("p-05", 0.6);
    const pageRows = (await loadPersonPage(db, yamamoto(), "p-05"))!;
    const items = toPersonView(pageRows, { today: TODAY, viewer: yamamoto() })
      .sections.find((s) => s.id === "timeline")!
      .blocks.flatMap((b) => (b.type === "timeline" ? b.items : []));
    expect(items.find((t) => t.id === id)).toMatchObject({ kind: "電話", retracted: { who: "山本", note: "人違い" } });
    expect(items.filter((t) => t.kind === "安否")).toEqual([]);
  });

  it("撤回は本人・家族・支援者の信号に結んだ行を外さない（called でない行は撤回できない）。訓練の信号は読む所が初めから外す", async () => {
    await heavyRain();
    await saveSignal(db, signalScope(self())!, red({}, at(0.3)), at(0.3));
    const signalEntry = (rows("SELECT id FROM timeline_entries WHERE kind = 'signal'")[0] as { id: string }).id;
    const out = await retractTimelineRequest(db, yamamoto(), { id: signalEntry }, at(0.6));
    expect(out.body).toMatchObject({ error: "not_retractable" });
    expect(rows("SELECT retracted_at FROM signals")).toEqual([{ retracted_at: null }]);
  });
});

describe("表を読む所の濾し", () => {
  it("ルールの表を使うファイルで、訓練でない信号を読む SQL は全部 retracted_at IS NULL で外す", () => {
    const ROOT = join(__dirname, "..", "..");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return files(p);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
      });
    const checked: string[] = [];
    const missing: string[] = [];
    for (const f of [...files(join(ROOT, "lib")), ...files(join(ROOT, "app"))]) {
      const s = readFileSync(f, "utf8");
      // ルールの表に信号を渡す所（toTriageSignal・triageInDisaster・rankInDisaster を使う、または定める）
      if (!/\b(toTriageSignal|triageInDisaster|rankInDisaster)\b/.test(s)) continue;
      const rel = relative(ROOT, f).replaceAll("\\", "/");
      for (const m of s.matchAll(/FROM signals\b[^`]*/g)) {
        const sql = m[0];
        if (!/drill_id IS NULL/.test(sql)) continue;
        checked.push(rel);
        if (!/retracted_at IS NULL/.test(sql)) missing.push(rel);
      }
    }
    expect(missing).toEqual([]);
    // 5 か所（lib/disaster/triage.ts の 2 つ・lib/caseload.ts・lib/custody/board.ts・lib/forms/form9-db.ts）
    expect([...new Set(checked)].sort()).toEqual([
      "lib/caseload.ts",
      "lib/custody/board.ts",
      "lib/disaster/triage.ts",
      "lib/forms/form9-db.ts",
    ]);
    expect(checked).toHaveLength(5);
  });
});
