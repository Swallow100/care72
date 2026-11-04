// 訓練の通話で聞いた安否の至急維持（docs/tasks なし、T84。DECISIONS 11/4 12:4x「訓練の通話で聞いた「無事」も、本番の電話と同じく
// 本人の「けが」「動けない」を置き換えない」）。本番の電話（lib/list/calls.ts の saveCall）と同じ線を、訓練の左の表に渡す所
// （lib/drill/view.ts の loadDrillScreen）で当てる: その通話の前の表の行が red_injury なら、「無事」と、けが・動けないの
// どちらも付けない「無事でない」は表に渡さず、画面に本番と同じ言葉（「無事 不可（本人が「けが」）」）を出す。
// 訓練は node:sqlite の D1 と種の 10 人で本物の道で作る。Claude は呼ばない（想定の表の固定の安否）。

import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionLog, LatestResult } from "../../components/drill/ActionLog.tsx";
import { DrillPaper } from "../../components/drill/DrillPaper.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { DrillAction, DrillScenario } from "../db/types.ts";
import { injuryRefusal } from "../list/calls.ts";
import { actDrill, advanceDrill, drillScope, heardSignalId, loadDrillRow, startDrill, stateOfRow, undoDrill } from "./db.ts";
import { lastStep, simAt, type PersonState } from "./engine.ts";
import { actionPost } from "./http.ts";
import { loadDrillRecord } from "./record.ts";
import { loadDrillScreen } from "./view.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  put = 0;
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const careManager = (): Principal => ({
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
const SCOPE = drillScope(careManager())!;
const START = "2026-11-05T01:00:00.000Z";
const ID = "drill-t84";

async function start(scenario: DrillScenario = "heavy_rain") {
  expect(await startDrill(db, SCOPE, scenario, START, {}, () => ID)).toEqual({ ok: true, id: ID });
}

async function advanceTo(stepIndex: number) {
  for (;;) {
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    if (row.step >= stepIndex) return;
    expect((await advanceDrill(db, SCOPE, ID, row.step, START)).ok).toBe(true);
  }
}

async function doAct(kind: DrillAction, person: string | null, target: string | null = null) {
  const row = (await loadDrillRow(db, DEMO.id, ID))!;
  const n = stateOfRow(row).actions.length;
  return actDrill(db, SCOPE, ID, { step: row.step, actions: n }, { kind, person, target }, START, { roll: () => 0 });
}

/** 手の前の本人役の様子を書き換える（Haiku の本人役が刻みのあとに 不明・答えなしの赤 を返した形。通話で聞く安否はここから決まる） */
function setPersonState(person: string, state: PersonState) {
  sqlite.prepare("UPDATE drills SET world = json_set(world, ?, json(?)) WHERE id = ?").run(`$.people.${person}`, JSON.stringify(state), ID);
}

/** 入れた順（同じ時刻の安否は created_at の順で読む） */
let put = 0;
const createdAt = () => `2026-11-05T00:00:${String(put++).padStart(2, "0")}.000Z`;

/**
 * 本人・家族の答えの 赤 けが を、訓練の安否として入れる（想定の表に無い筋を作る。保存の形は刻みの安否と同じ）。
 * 時刻は発災（0 時間。0 時間の刻みのあと、最初の手の前の表に入る。手の前の時計より先の安否は表が読まない）
 */
function putRed(person: string, source: "agent" | "family", answers: { injured?: 1; can_move?: 0 } = { injured: 1 }) {
  sqlite
    .prepare(
      `INSERT INTO signals (id, person_id, drill_id, color, source, injured, can_move, occurred_at, created_at)
       VALUES (?, ?, ?, 'red', ?, ?, ?, ?, ?)`,
    )
    .run(`${ID}-x${put}-${person}`, person, ID, source, answers.injured ?? null, answers.can_move ?? null, simAt(START, 0), createdAt());
}

function putGreen(person: string, source: "agent" | "family") {
  sqlite
    .prepare(`INSERT INTO signals (id, person_id, drill_id, color, source, occurred_at, created_at) VALUES (?, ?, ?, 'green', ?, ?, ?)`)
    .run(`${ID}-x${put}-${person}`, person, ID, source, simAt(START, 0), createdAt());
}

async function screen(want: number | null = null) {
  return (await loadDrillScreen(db, SCOPE, ID, want))!;
}

const rowOf = async (person: string) => (await screen()).rows.find((r) => r.id === person)!;

describe("通話で聞いた「無事」は 赤 けが・動けない を置き換えない（至急維持）", () => {
  it("家族が「けが」の小林に、家族の電話で「無事」→ 表は red_injury のまま・順位も同じ。画面に本番と同じ「無事 不可（家族が「けが」）」", async () => {
    await start();
    putRed("p-02", "family");
    const before = await rowOf("p-02");
    expect(before.triage).toMatchObject({ color: "red", rule: "red_injury" });
    expect(before.triage!.reason.startsWith("家族が「けが」")).toBe(true);

    const r = await doAct("call_contact", "p-02", "c-02-1"); // 0:00 → 0:05、出る
    // 手は残る（電話はかけた。本人役の言う事も返事もそのまま）。聞いた安否は手の記録に残る
    expect(r).toMatchObject({ ok: true, record: { result: { status: "connected", heard: { via: "call", color: "green" } } } });

    const s = await screen();
    const after = s.rows.find((x) => x.id === "p-02")!;
    expect(after.triage).toMatchObject({ color: "red", rule: "red_injury", reason: before.triage!.reason });
    expect(after.rank).toBe(before.rank);
    // 表に渡していないので、聞いた安否の印（行の詳細の「通話」）も行の詳細の安否の行も無い
    const sid = heardSignalId(ID, "a1");
    expect(s.heard[sid]).toBeUndefined();
    expect(JSON.stringify(after.detail)).not.toContain(sid);
    // 言葉は本番の電話の断り（lib/list/calls.ts の injuryRefusal）と同じ
    expect(s.refused).toEqual({ a1: injuryRefusal({ color: "green" }, before.triage!.reason) });
    expect(s.refused.a1).toBe("無事 不可（家族が「けが」）");
  });

  it("本人が「動けない」なら「無事 不可（本人が「動けない」）」", async () => {
    await start();
    putRed("p-02", "agent", { can_move: 0 });
    await doAct("call_person", "p-02");
    const s = await screen();
    expect(s.rows.find((x) => x.id === "p-02")!.triage).toMatchObject({ rule: "red_injury" });
    expect(s.refused).toEqual({ a1: "無事 不可（本人が「動けない」）" });
  });

  it("けが・動けない を付けない「無事でない」も同じく渡さない（連絡順の組が下がるため。T58 の答え）", async () => {
    await start();
    putRed("p-02", "family");
    // 本人役の今の様子が答えなしの赤（家族が「無事じゃない」とだけ言った）
    setPersonState("p-02", { color: "red", source: "family", whereNow: null, at: 0.25, saying: null, doing: null });
    const r = await doAct("call_contact", "p-02", "c-02-1");
    expect(r).toMatchObject({ ok: true, record: { result: { heard: { color: "red", injured: null, canMove: null } } } });
    const s = await screen();
    expect(s.rows.find((x) => x.id === "p-02")!.triage).toMatchObject({ color: "red", rule: "red_injury" });
    expect(s.refused).toEqual({ a1: "無事でない 不可（家族が「けが」）" });
  });

  it("けが を付けた「無事でない」は通す（ケアマネが聞いた けが で red_injury のまま。理由はケアマネ）", async () => {
    await start();
    putRed("p-02", "family");
    setPersonState("p-02", { color: "red", source: "family", whereNow: null, at: 0.25, saying: null, doing: null, injured: true });
    await doAct("call_contact", "p-02", "c-02-1");
    const s = await screen();
    expect(s.refused).toEqual({});
    expect(s.heard).toEqual({ [heardSignalId(ID, "a1")]: "call" });
    expect(s.rows.find((x) => x.id === "p-02")!.triage).toMatchObject({ rule: "red_injury", reason: expect.stringMatching(/^ケアマネが「けが」/) });
  });

  it("大雨 3 時間の山田（本人が「けが」）に本人電話 → 本人役の赤とけがを写すので通す（今まで通り）", async () => {
    await start();
    await advanceTo(2);
    await doAct("call_person", "p-01");
    const s = await screen();
    expect(s.refused).toEqual({});
    expect(s.rows.find((x) => x.id === "p-01")!.triage).toMatchObject({ color: "red", rule: "red_injury" });
  });

  it("佐藤（本人の報告を当てにしない印）: 家族の「けが」のあと本人役の緑は表が使わない。本人電話で聞いた「無事」も渡さない", async () => {
    await start();
    putRed("p-04", "family");
    putGreen("p-04", "agent");
    const before = await rowOf("p-04");
    expect(before.triage).toMatchObject({ rule: "red_injury" });
    expect(before.triage!.reason).toContain("本人の申告は参考");
    setPersonState("p-04", { color: "green", source: "agent", whereNow: "home", at: 0.5, saying: "だいじょうぶ", doing: null });
    await doAct("call_person", "p-04");
    const s = await screen();
    expect(s.rows.find((x) => x.id === "p-04")!.triage).toMatchObject({ color: "red", rule: "red_injury" });
    expect(s.refused).toEqual({ a1: "無事 不可（家族が「けが」）" });
  });

  it("赤 けが でない人（灰 不明・赤だけ）への「無事」は今まで通り表に渡す", async () => {
    await start();
    putRed("p-03", "family", {});
    expect((await rowOf("p-03")).triage).toMatchObject({ color: "red", rule: "red" });
    await doAct("call_contact", "p-02", "c-02-1"); // 灰の小林
    await doAct("call_contact", "p-03", "c-03-1"); // 赤だけの田中
    const s = await screen();
    expect(s.refused).toEqual({});
    expect(s.rows.find((x) => x.id === "p-02")!.triage).toMatchObject({ color: "green" });
    // 田中は聞いた「無事」で緑の行に。透析先の未確認は表がそのまま黄にする（T58 と同じ）
    expect(s.rows.find((x) => x.id === "p-03")!.triage).toMatchObject({ color: "yellow", rule: "green_unchecked" });
  });

  it("訪問（着いた・確認済）は当てない（作者の決めは通話。訪問は問いに書いた）", async () => {
    await start();
    putRed("p-04", "family");
    await doAct("visit", "p-04");
    const s = await screen();
    expect(s.refused).toEqual({});
    expect(s.rows.find((x) => x.id === "p-04")!.triage).toMatchObject({ color: "green" });
  });

  it("手の途中で刻みを越え、越えた刻みで本人役（当てにできる人）が緑 → その緑のあとの通話の「無事」は渡す（表はもう緑）", async () => {
    await start();
    putRed("p-07", "family");
    expect((await rowOf("p-07")).triage).toMatchObject({ rule: "red_injury" });
    await doAct("visit", "p-05"); // 0:00 → 0:40
    await doAct("request_welfare_shelter", "p-05"); // 0:40 → 0:55
    const r = await doAct("call_person", "p-07"); // 0:55 → 1:00。1 時間の刻みで本人役の緑「家にいる。まだ大丈夫」
    expect(r).toMatchObject({ ok: true, step: 1, record: { result: { status: "connected", crossed: [1], heard: { color: "green" } } } });
    const s = await screen();
    expect(s.refused).toEqual({});
    expect(s.rows.find((x) => x.id === "p-07")!.triage).toMatchObject({ color: "green" });
  });

  it("再生でも同じ言葉。取り消すと消え、表はそのまま", async () => {
    await start();
    putRed("p-02", "family");
    await doAct("call_contact", "p-02", "c-02-1");
    const row = (await loadDrillRow(db, DEMO.id, ID))!;
    expect(await undoDrill(db, SCOPE, ID, { step: row.step, actions: 1 })).toMatchObject({ ok: true });
    const undone = await screen();
    expect(undone.refused).toEqual({});
    expect(undone.rows.find((x) => x.id === "p-02")!.triage).toMatchObject({ rule: "red_injury" });

    await doAct("call_contact", "p-02", "c-02-1"); // 取り消した番号は使わない（a2）
    await advanceTo(1);
    const replay = await screen(0);
    expect(replay.refused).toEqual({ a2: "無事 不可（家族が「けが」）" });
    expect(replay.rows.find((x) => x.id === "p-02")!.triage).toMatchObject({ rule: "red_injury" });
    expect((await screen()).refused).toEqual({ a2: "無事 不可（家族が「けが」）" });
  });

  it("API の道（actionPost）: 次の手の前の左の表（採点が読む before）で、小林は赤のまま上に残る", async () => {
    await start();
    putRed("p-02", "family");
    const post = async (body: Record<string, unknown>) => {
      const row = (await loadDrillRow(db, DEMO.id, ID))!;
      const res = await actionPost(db, careManager(), ID, { step: row.step, actions: stateOfRow(row).actions.length, ...body }, START, { roll: () => 0 });
      expect(res.status).toBe(200);
    };
    await post({ kind: "call_contact", person: "p-02", target: "c-02-1" });
    const first = stateOfRow((await loadDrillRow(db, DEMO.id, ID))!).actions[0];
    await post({ kind: "call_person", person: "p-09", target: null });
    const second = stateOfRow((await loadDrillRow(db, DEMO.id, ID))!).actions[1];
    expect(second.before.ranking!.indexOf("p-02")).toBe(first.before.ranking!.indexOf("p-02"));
    expect(second.before.ranking![0]).toBe("p-02");
  });
});

describe("デモの 10 人の訓練の筋（想定の表の固定の安否）は変わらない", () => {
  for (const scenario of ["heavy_rain", "short"] as const) {
    it(`${scenario}: 全部の刻みで 10 人全員に本人電話をしても、渡さない通話は無い`, async () => {
      await start(scenario);
      const last = lastStep(scenario);
      let injuredCalls = 0;
      for (let st = 0; st < last; st++) {
        await advanceTo(st);
        const row = (await loadDrillRow(db, DEMO.id, ID))!;
        if (row.step >= last) break;
        for (const p of stateOfRow(row).participants) {
          const before = await rowOf(p);
          const r = await doAct("call_person", p);
          if (!r.ok) break;
          if (before.triage?.rule === "red_injury" && r.record.result?.heard) injuredCalls += 1;
        }
      }
      const s = await screen();
      expect(s.refused).toEqual({});
      // 本当に通話で安否を聞き、山田（3 時間から本人が「けが」）にも red_injury のまま電話している
      expect(Object.keys(s.heard).length).toBeGreaterThan(20);
      expect(injuredCalls).toBeGreaterThan(0);
    });
  }
});

describe("画面（手の結果・履歴・紙の訓練記録）", () => {
  it("通話の横に本番と同じ言葉を赤の太字で。渡した通話には出さない", async () => {
    await start();
    putRed("p-02", "family");
    await doAct("call_contact", "p-02", "c-02-1");
    await doAct("call_contact", "p-03", "c-03-1");
    const s = await screen();
    const names = s.names;
    const log = renderToStaticMarkup(
      createElement(ActionLog, { actions: s.state.actions, hours: s.hours, current: s.shown, names, refused: s.refused }),
    );
    expect(log).toContain("data-heard-refused");
    expect(log).toContain("無事 不可（家族が「けが」）");
    expect(log.match(/data-heard-refused/g)).toHaveLength(1);
    expect(log).toMatch(/class="[^"]*text-danger[^"]*"[^>]*data-heard-refused/);

    const latest = renderToStaticMarkup(
      createElement(LatestResult, { action: s.state.actions[0], names, ticks: s.ticks, refused: s.refused }),
    );
    expect(latest).toContain("無事 不可（家族が「けが」）");
    const other = renderToStaticMarkup(createElement(LatestResult, { action: s.state.actions[1], names, ticks: s.ticks, refused: s.refused }));
    expect(other).not.toContain("data-heard-refused");
  });

  it("紙の訓練記録の結果の欄にも同じ言葉", async () => {
    await start();
    putRed("p-02", "family");
    await doAct("call_contact", "p-02", "c-02-1");
    await advanceTo(lastStep("heavy_rain"));
    const record = await loadDrillRecord(db, SCOPE, ID, "2026-11-05T02:00:00.000Z");
    if (record === null || record === "running") throw new Error("記録が無い");
    const html = renderToStaticMarkup(createElement(DrillPaper, { record, office: DEMO.name, today: "2026-11-05" }));
    expect(html).toContain("無事 不可（家族が「けが」）");
    expect(html.match(/data-heard-refused/g)).toHaveLength(1);
  });
});
