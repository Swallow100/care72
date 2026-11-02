// 家族・支援者のスマホ（docs/tasks/T11.md）: 3 つの答えの信号の形と出どころ（家族・支援者）、役の壁（家族は自分の本人の分しか
// 送れない。本人の id はログインの連絡先の行から）、ルールの表が家族の緑を本人の緑と区別すること（案 4）、いちばん新しい答えが効く、
// 同意の出し分け（支援者への提供に同意していない 7 加藤の家族には経過を出さない）、流れと画面の静的な描画。
// D1 は node:sqlite に種の 10 人。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { FamilyView, type FamilyActions } from "../../components/phone/FamilyView.tsx";
import { PhoneSheet } from "../../components/phone/PhoneSheet.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { kanjiWithoutRuby, plainText } from "../forms/easy-words.ts";
import { buildOwnSheet } from "../forms/own-sheet.ts";
import { loadPersonPage, timelineItems, type PersonPageRows } from "../person.ts";
import { FamilySignalBodySchema, NO_ANSWERS, type FamilyAnswer, type FamilySignalBody } from "./body.ts";
import {
  buildFamilyScreen,
  FAMILY_SHEET_BLOCKS,
  familyHistory,
  familyQuestion,
  familyWhen,
  familyWriterOf,
  type FamilyScreen,
} from "./family.ts";
import { createFamilyPhone, type FamilyState } from "./family-phone.ts";
import { recordingPost, signalPost } from "./http.ts";
import { familyLogBody } from "./labels.ts";
import type { Delivery } from "./outbox.ts";
import { allFamilyWords } from "./phrases.ts";
import { saveSignal, signalScope } from "./save.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

/** 審査員の「家族のスマホ」（山田 ハナの娘 c-01-1）。p で本人と連絡先の行を替える */
const family = (p: Partial<Principal> = {}): Principal => ({
  role: "family",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: "森 恵子",
  office: DEMO,
  caseloadOf: null,
  personId: "p-01",
  contactId: "c-01-1",
  ...p,
});

/** 審査員の「本人のスマホ」（山田 ハナ） */
const self = (p: Partial<Principal> = {}): Principal => ({ ...family(), role: "self", contactId: null, ...p });

const careManager: Principal = {
  role: "care_manager",
  judge: false,
  admin: true,
  accountId: "acct-yamamoto",
  displayName: "山本",
  office: DEMO,
  caseloadOf: "acct-yamamoto",
  personId: null,
  contactId: null,
};

/** 地震（停電なし）の発災 2026-11-04 10:00 JST。h 時間あとは at(h) */
const QUAKE = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(QUAKE + h * 3_600_000).toISOString();

async function earthquake() {
  const r = await switchDisasterMode(db, disasterScope(careManager)!, { kind: "earthquake", version: 0, at: at(0) });
  expect(r).toEqual({ ok: true, changed: true });
}

let n = 0;
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const answer = (color: FamilyAnswer, time = at(1)): FamilySignalBody => ({ id: id(), color, occurredAt: time, sentAt: time });

/** 本人の形（T10） */
const selfBody = (color: "green" | "red", time = at(1)) => ({
  id: id(),
  color,
  whereNow: color === "green" ? ("home" as const) : null,
  answers: { ...NO_ANSWERS },
  occurredAt: time,
  sentAt: time,
});

const rows = (sql: string) => sqlite.prepare(sql).all() as Array<Record<string, unknown>>;
const count = (table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

const caseloadScope = { officeId: "office-demo", careManagerId: "acct-yamamoto" };
async function rowOf(personId: string, now: string) {
  const data = await loadCaseload(db, caseloadScope, "2026-11-04", now);
  return data!.rows.find((r) => r.id === personId)!.triage!;
}

async function pageOf(p: Principal): Promise<PersonPageRows> {
  const page = await loadPersonPage(db, p, p.personId!);
  expect(page).not.toBeNull();
  return page!;
}

function insertTimeline(personId: string, kind: string, role: string, body: string, time: string, payload: string | null = null) {
  sqlite
    .prepare(
      `INSERT INTO timeline_entries (id, person_id, author_id, author_role, kind, body, payload, occurred_at)
       VALUES (?, ?, 'acct-yamamoto', ?, ?, ?, ?, ?)`,
    )
    .run(id(), personId, role, kind, body, payload, time);
}

describe("3 つの答えの信号の形と出どころ", () => {
  it("送る形は 緑・赤・未知 と時刻だけ。本人の id・出どころは送らない（送っても読まない）", () => {
    for (const c of ["green", "red", "unknown"] as const) expect(FamilySignalBodySchema.safeParse(answer(c)).success).toBe(true);
    expect(FamilySignalBodySchema.safeParse({ ...answer("red"), color: "yellow" }).success).toBe(false);
    expect(FamilySignalBodySchema.safeParse({ ...answer("red"), id: "s-1" }).success).toBe(false);
    const parsed = FamilySignalBodySchema.parse({ ...answer("red"), personId: "p-02", source: "self", contactId: "c-02-1" });
    expect(Object.keys(parsed).sort()).toEqual(["color", "id", "occurredAt", "sentAt"]);
  });

  it("娘（家族）: 無事です・無事じゃない・分からない を出どころ「家族」で。答えの 4 問と居場所は空。経過に「娘が「…」と回答」", async () => {
    await earthquake();
    for (const [i, c] of (["green", "red", "unknown"] as const).entries()) {
      const res = await signalPost(db, family(), answer(c, at(1 + i)), at(1 + i));
      expect(res.status, c).toBe(200);
    }
    expect(rows("SELECT person_id, color, source, where_now, injured, at_home, can_move, has_medicine, classes FROM signals ORDER BY occurred_at")).toEqual(
      (["green", "red", "unknown"] as const).map((color) => ({
        person_id: "p-01",
        color,
        source: "family",
        where_now: null,
        injured: null,
        at_home: null,
        can_move: null,
        has_medicine: null,
        classes: null,
      })),
    );
    expect(rows("SELECT author_id, author_role, kind, body, payload FROM timeline_entries ORDER BY occurred_at")).toEqual([
      { author_id: "acct-judge", author_role: "family", kind: "signal", body: "娘が「無事」と回答", payload: '{"source":"phone","contactId":"c-01-1"}' },
      { author_id: "acct-judge", author_role: "family", kind: "signal", body: "娘が「無事じゃない」と回答", payload: '{"source":"phone","contactId":"c-01-1"}' },
      {
        author_id: "acct-judge",
        author_role: "family",
        kind: "signal",
        body: "娘が「分からない（連絡つかず）」と回答",
        payload: '{"source":"phone","contactId":"c-01-1"}',
      },
    ]);
  });

  it("隣人（支援者 2）と民生委員は出どころ「支援者」。続柄の無い民生委員は種類で呼ぶ（名前は経過の 1 行に入れない）", async () => {
    await earthquake();
    expect((await signalPost(db, family({ contactId: "c-01-2" }), answer("red"), at(1))).status).toBe(200);
    expect((await signalPost(db, family({ personId: "p-04", contactId: "c-04-1" }), answer("green"), at(1))).status).toBe(200);
    expect(rows("SELECT person_id, source FROM signals ORDER BY person_id")).toEqual([
      { person_id: "p-01", source: "supporter" },
      { person_id: "p-04", source: "supporter" },
    ]);
    expect(rows("SELECT author_role, body FROM timeline_entries ORDER BY person_id")).toEqual([
      { author_role: "supporter", body: "隣人が「無事じゃない」と回答" },
      { author_role: "supporter", body: "民生委員が「無事」と回答" },
    ]);
    expect(familyLogBody({ kind: "family", relation: null }, "red")).toBe("家族が「無事じゃない」と回答");
    expect(JSON.stringify(rows("SELECT body FROM timeline_entries"))).not.toMatch(/木村|清水/);
  });

  it("送り直し（同じ id）は重ねない", async () => {
    await earthquake();
    const body = answer("red");
    expect(await saveSignal(db, signalScope(family())!, body, at(1))).toMatchObject({ ok: true, duplicate: false });
    expect(await saveSignal(db, signalScope(family())!, { ...body, sentAt: at(2) }, at(2))).toMatchObject({ ok: true, duplicate: true });
    expect(count("signals")).toBe(1);
    expect(count("timeline_entries")).toBe(1);
  });
});

describe("役の壁（家族は自分の本人の分しか送れない）", () => {
  it("送った物の中の本人の id・出どころ・連絡先は読まず、ログインの連絡先の行（c-01-1 → p-01、家族）に入る", async () => {
    await earthquake();
    const res = await signalPost(db, family(), { ...answer("red"), personId: "p-02", source: "self", contactId: "c-02-1" }, at(1));
    expect(res.status).toBe(200);
    expect(rows("SELECT person_id, source FROM signals")).toEqual([{ person_id: "p-01", source: "family" }]);
    expect(rows("SELECT author_role FROM timeline_entries")).toEqual([{ author_role: "family" }]);
  });

  it("連絡先の行がほかの本人の物（小林の夫の行で山田に・山田の娘の行で小林に）は 404。表に何も入らない", async () => {
    await earthquake();
    expect((await signalPost(db, family({ contactId: "c-02-1" }), answer("red"), at(1))).status).toBe(404);
    expect((await signalPost(db, family({ personId: "p-02" }), answer("red"), at(1))).status).toBe(404);
    expect((await signalPost(db, family({ contactId: "c-99" }), answer("red"), at(1))).status).toBe(404);
    expect((await signalPost(db, family({ personId: "p-99" }), answer("red"), at(1))).status).toBe(404);
    expect(count("signals")).toBe(0);
    expect(count("timeline_entries")).toBe(0);
  });

  it("本人の電話の行（c-01-0）は家族として答えられない（403）。連絡先の行が無い家族の役も 403", async () => {
    await earthquake();
    expect((await signalPost(db, family({ contactId: "c-01-0" }), answer("green"), at(1))).status).toBe(403);
    expect((await signalPost(db, family({ contactId: null }), answer("green"), at(1))).status).toBe(403);
    expect(count("signals")).toBe(0);
  });

  it("形は役で決まる: 本人は「分からない」を送れない（400）。本人の形・家族の形を取り違えても入らない", async () => {
    await earthquake();
    expect((await signalPost(db, self(), answer("unknown"), at(1))).status).toBe(400);
    expect((await signalPost(db, self(), answer("green"), at(1))).status).toBe(400);
    expect(await saveSignal(db, signalScope(self())!, answer("red"), at(1))).toEqual({ ok: false, error: "invalid" });
    expect(await saveSignal(db, signalScope(family())!, selfBody("red"), at(1))).toEqual({ ok: false, error: "invalid" });
    expect(count("signals")).toBe(0);
  });

  it("家族は録音を送れない（403）。本人も家族の信号には録音を添えられない（404）", async () => {
    await earthquake();
    const body = answer("red");
    await signalPost(db, family(), body, at(1));
    const form = () => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ signal: body.id, transcript: "あし", recordedAt: at(1), sentAt: at(1) })) f.set(k, v);
      return f;
    };
    const bucket = { put: async () => null };
    expect((await recordingPost(db, bucket, family(), form(), at(1))).status).toBe(403);
    expect((await recordingPost(db, bucket, self(), form(), at(1))).status).toBe(404);
    expect(rows("SELECT transcript FROM signals")).toEqual([{ transcript: null }]);
  });

  it("平時は断る（409）", async () => {
    expect((await signalPost(db, family(), answer("red"), at(1))).status).toBe(409);
    expect(count("signals")).toBe(0);
  });
});

describe("保存のあとの担当一覧（色はルールの表のまま）", () => {
  it("娘が「無事じゃない」→ 山田は赤、理由は「家族が「無事じゃない」」", async () => {
    await earthquake();
    expect((await rowOf("p-01", at(1))).color).not.toBe("red");
    await signalPost(db, family(), answer("red", at(1)), at(1));
    expect(await rowOf("p-01", at(1.1))).toMatchObject({ color: "red", rule: "red", reason: "家族が「無事じゃない」" });
  });

  it("「分からない」は未知のまま（ほかに信号の無い人は灰）", async () => {
    await earthquake();
    await signalPost(db, family({ personId: "p-09", contactId: "c-09-1" }), answer("unknown", at(1)), at(1));
    expect(await rowOf("p-09", at(1.1))).toMatchObject({ color: "gray", rule: "unknown" });
  });

  it("複数の家族・支援者が同じ本人に答えられ、いちばん新しい答えが効く（娘の赤 → 隣人の緑 → 娘の赤）", async () => {
    await earthquake();
    await signalPost(db, family(), answer("red", at(1)), at(1));
    await signalPost(db, family({ contactId: "c-01-2" }), answer("green", at(1.5)), at(1.5));
    expect(await rowOf("p-01", at(1.6))).toMatchObject({ color: "green", reason: "支援者が「無事」" });
    await signalPost(db, family(), answer("red", at(2)), at(2));
    expect(await rowOf("p-01", at(2.1))).toMatchObject({ color: "red", reason: "家族が「無事じゃない」" });
  });

  it("案 4: 本人の報告を当てにしない印の佐藤は、本人の緑は参考（緑にしない）、息子（家族）の緑は緑", async () => {
    await earthquake();
    const sato = self({ personId: "p-04" });
    await signalPost(db, sato, selfBody("green", at(1)), at(1));
    const bySelf = await rowOf("p-04", at(1.1));
    expect(bySelf.color).not.toBe("green");
    expect(bySelf.reason).toContain("本人の緑は参考");

    await signalPost(db, family({ personId: "p-04", contactId: "c-04-2" }), answer("green", at(2)), at(2));
    expect(await rowOf("p-04", at(2.1))).toMatchObject({ color: "green", rule: "green", reason: "家族が「無事」" });

    // 印の無い山田は本人の緑で緑
    await signalPost(db, self(), selfBody("green", at(1)), at(1));
    expect(await rowOf("p-01", at(1.1))).toMatchObject({ color: "green", reason: "本人が「無事」" });
  });

  it("本人のページの経過に「安否」と家族の書き手で出る", async () => {
    await earthquake();
    await signalPost(db, family(), answer("red", at(1)), at(1));
    const page = await loadPersonPage(db, careManager, "p-01");
    const item = timelineItems(page!).find((t) => t.kind === "安否")!;
    expect(item).toMatchObject({ tone: "urgent", body: "娘が「無事じゃない」と回答" });
    expect(item.who).toContain("家族");
  });
});

describe("家族の画面に出す物", () => {
  it("問い: 娘から見た山田 ハナは「お母さん（山田 ハナ）は 無事ですか」。隣人は名前で。弟から見た加藤は「お兄さん」", async () => {
    const yamada = await pageOf(family());
    expect(plainText(familyQuestion(yamada, familyWriterOf(yamada, "c-01-1")!))).toBe("お母さん（山田 ハナ）は 無事ですか");
    expect(plainText(familyQuestion(yamada, familyWriterOf(yamada, "c-01-2")!))).toBe("山田 ハナさんは 無事ですか");
    const kato = await pageOf(family({ personId: "p-07", contactId: "c-07-1" }));
    expect(plainText(familyQuestion(kato, familyWriterOf(kato, "c-07-1")!))).toBe("お兄さん（加藤 正）は 無事ですか");
  });

  it("答えられない連絡先の行（本人の電話・ほかの本人の行・無い）は null（画面は 404）", async () => {
    const yamada = await pageOf(family());
    expect(familyWriterOf(yamada, "c-01-0")).toBeNull();
    expect(familyWriterOf(yamada, "c-02-1")).toBeNull();
    expect(familyWriterOf(yamada, null)).toBeNull();
  });

  it("決まった言葉の漢字には全部ふりがな", () => {
    expect(kanjiWithoutRuby(allFamilyWords())).toEqual([]);
  });

  it("経過（同意あり）: 決まった言葉だけ、新しい順。自分の答えは「あなた」。本文・文字起こし・自由文・印の変更は出さない", async () => {
    await earthquake();
    await signalPost(db, self(), selfBody("red", at(1)), at(1));
    sqlite.exec(`UPDATE signals SET transcript = 'あしが いたい' WHERE source = 'self'`);
    const selfSignal = rows("SELECT id FROM signals")[0].id as string;
    insertTimeline("p-01", "signal", "self", "録音 30 秒 文字起こし「あしが いたい」", at(1.01), '{"source":"recording"}');
    sqlite.exec(`UPDATE timeline_entries SET signal_id = '${selfSignal}' WHERE body LIKE '録音%'`);
    insertTimeline("p-01", "called", "care_manager", "娘の森さんに電話 酸素の残量を確認", at(1.2));
    insertTimeline("p-01", "note", "care_manager", "自由文の記録", at(1.3));
    insertTimeline("p-01", "self_report_mark", "care_manager", "印を付けた", at(1.35));
    insertTimeline("p-01", "pickup", "care_manager", "木村さんが迎え", at(1.4));
    await signalPost(db, family(), answer("red", at(1.5)), at(1.5));
    await signalPost(db, family({ contactId: "c-01-2" }), answer("green", at(1.6)), at(1.6));

    const page = await pageOf(family());
    const history = familyHistory(page, familyWriterOf(page, "c-01-1")!)!;
    expect(history.map((h) => plainText(h.words))).toEqual([
      "隣人が「無事」と こたえました",
      "あなたが「無事じゃない」と こたえました",
      "迎えが 決まりました",
      "ケアマネジャーが 電話しました",
      "録音が とどきました",
      "お母さんが「無事じゃない」と こたえました",
    ]);
    expect(history[0].when).toBe("11/4 11:36");
    const all = JSON.stringify(history);
    for (const hidden of ["あしが", "酸素", "自由文", "印", "森", "木村", "至急", "要確認"]) expect(all).not.toContain(hidden);
  });

  it("同意の出し分け: 支援者への提供に同意していない加藤の弟には経過を出さない（null）。同意の未確認も出さない", async () => {
    await earthquake();
    const kato = family({ personId: "p-07", contactId: "c-07-1" });
    await signalPost(db, kato, answer("red", at(1)), at(1));
    insertTimeline("p-07", "called", "care_manager", "電話した", at(1.2));
    const page = await pageOf(kato);
    expect(familyHistory(page, familyWriterOf(page, "c-07-1")!)).toBeNull();
    const screen = buildFamilyScreen(page, familyWriterOf(page, "c-07-1")!, buildOwnSheet(page, { today: "2026-11-04", officeName: "デモ事業所" }));
    expect(screen.history).toBeNull();

    sqlite.exec(`UPDATE consents SET status = 'unconfirmed' WHERE person_id = 'p-01' AND kind = 'supporters'`);
    const yamada = await pageOf(family());
    expect(familyHistory(yamada, familyWriterOf(yamada, "c-01-1")!)).toBeNull();
  });

  it("時刻は JST の「月/日 時:分」", () => {
    expect(familyWhen("2026-11-04T01:05:00.000Z")).toBe("11/4 10:05");
    expect(familyWhen("2026-11-04T15:30:00.000Z")).toBe("11/5 00:30");
  });
});

describe("流れ（画面に触らない）", () => {
  function phone(result: Delivery | "throw" = "sent") {
    const sent: FamilySignalBody[] = [];
    const states: FamilyState[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const p = createFamilyPhone({
      now: () => QUAKE,
      newId: () => "00000000-0000-4000-8000-0000000000f1",
      sendSignal: async (b) => {
        sent.push(b);
        await gate;
        if (result === "throw") throw new Error("通信");
        return result;
      },
      onChange: (s) => states.push(s),
    });
    return { p, sent, states, release };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("1 回押せば送る（緑・赤・未知）。送っている間は押しても重ねない。答えたあとは「最初から」で上へ", async () => {
    for (const c of ["green", "red", "unknown"] as const) {
      const { p, sent, states, release } = phone();
      p.answer(c);
      p.answer("green");
      expect(sent).toEqual([{ id: "00000000-0000-4000-8000-0000000000f1", color: c, occurredAt: at(0), sentAt: at(0) }]);
      expect(p.state).toEqual({ step: "sending", color: c });
      release();
      await tick();
      expect(p.state).toEqual({ step: "done", color: c, delivery: "sent" });
      p.again();
      expect(p.state).toEqual({ step: "top" });
      expect(states.map((s) => s.step)).toEqual(["sending", "done", "top"]);
    }
  });

  it("送れなければ「まだ とどいて いません」（端末に残す）。閉じたあとの結果は当てない", async () => {
    const a = phone("throw");
    a.p.answer("red");
    a.release();
    await tick();
    expect(a.p.state).toEqual({ step: "done", color: "red", delivery: "queued" });

    const b = phone();
    b.p.answer("red");
    b.p.dispose();
    b.release();
    await tick();
    expect(b.p.state).toEqual({ step: "sending", color: "red" });
  });
});

describe("画面の静的な描画", () => {
  const noop: FamilyActions = { answer() {}, again() {} };
  const text = (html: string) => html.replace(/<rt>[^<]*<\/rt>|<rp>[^<]*<\/rp>/g, "").replace(/<[^>]+>/g, "");
  const buttons = (html: string) => [...html.matchAll(/data-choice="([^"]+)"/g)].map((m) => m[1]);

  async function screenOf(p: Principal): Promise<FamilyScreen> {
    const page = await pageOf(p);
    return buildFamilyScreen(page, familyWriterOf(page, p.contactId)!, buildOwnSheet(page, { today: "2026-11-04", officeName: "デモ事業所" }));
  }
  const view = (state: FamilyState, screen: FamilyScreen) => renderToStaticMarkup(createElement(FamilyView, { state, screen, on: noop }));

  it("上は問いと 3 つのボタン。面で塗るのは 無事です（緑）と 無事じゃない（赤）だけ", async () => {
    const screen = await screenOf(family());
    const html = view({ step: "top" }, screen);
    expect(buttons(html)).toEqual(["green", "red", "unknown"]);
    expect(text(html)).toBe("お母さん（山田 ハナ）は 無事ですか無事です無事じゃない分からない（連絡が つかない）");
    expect(html.match(/phone-fill-[a-z]+/g)).toEqual(["phone-fill-ok", "phone-fill-urgent"]);
  });

  it("答えたあと: 赤は 119 の 1 行。経過（同意あり）・持って いく もの・ケアマネジャー・最初から。緑・未知に 119 は無い", async () => {
    await earthquake();
    await signalPost(db, family(), answer("red", at(1)), at(1));
    const screen = await screenOf(family());
    const red = view({ step: "done", color: "red", delivery: "sent" }, screen);
    const t = text(red);
    expect(t).toContain("とどきました");
    expect(t).toContain("いのちの 危険が あるときは 119");
    expect(t).toContain("これまでの こと");
    expect(t).toContain("あなたが「無事じゃない」と こたえました");
    expect(t).toContain("持って いく もの");
    expect(t).toContain("お薬手帳");
    expect(t).toContain("ケアマネジャー 山本さん");
    expect(t).toContain("最初から");
    expect(red).not.toContain("phone-fill-");
    // 台帳にケアマネの電話が無いので、押してもかからない形にしない
    expect(red).not.toContain("tel:");
    for (const c of ["green", "unknown"] as const) {
      expect(text(view({ step: "done", color: c, delivery: "queued" }, screen))).not.toContain("119");
    }
    expect(text(view({ step: "done", color: "green", delivery: "queued" }, screen))).toContain("まだ とどいて いません");
  });

  it("ケアマネの電話の番号があれば tel: で押せる", async () => {
    const screen = await screenOf(family());
    const html = view({ step: "done", color: "green", delivery: "sent" }, { ...screen, careManager: { ...screen.careManager, number: "090-0000-0099" } });
    expect(html).toContain('href="tel:090-0000-0099"');
    expect(text(html)).toContain("ケアマネジャーに 電話");
  });

  it("同意の無い加藤の弟の答えたあとに経過は無い", async () => {
    await earthquake();
    const kato = family({ personId: "p-07", contactId: "c-07-1" });
    await signalPost(db, kato, answer("red", at(1)), at(1));
    const html = view({ step: "done", color: "red", delivery: "sent" }, await screenOf(kato));
    expect(html).not.toContain('data-block="history"');
    expect(text(html)).not.toContain("これまでの こと");
    // ケアマネジャーの名前と事業所は本人の 1 枚（支援者にも渡る紙）と同じく出す。来てくれる人（支援者）の名前は 1 枚の側で落ちる
    expect(text(html)).toContain("ケアマネジャー 山本さん（デモ事業所）");
    expect(text(html)).not.toMatch(/前田|加藤 実/);
  });

  it("どの画面にも判定・助言の言葉と住所を出さない", async () => {
    await earthquake();
    await signalPost(db, family(), answer("red", at(1)), at(1));
    const screen = await screenOf(family());
    const states: FamilyState[] = [
      { step: "top" },
      { step: "sending", color: "red" },
      ...(["green", "red", "unknown"] as const).map((color) => ({ step: "done" as const, color, delivery: "sent" as const })),
    ];
    for (const s of states) {
      const t = text(view(s, screen));
      for (const w of ["至急", "要確認", "不明", "診断", "判定", "重症", "かわなぎ町", "松山市"]) expect(t, `${s.step} ${w}`).not.toContain(w);
    }
  });

  it("平時: 本人の 1 枚のうち 逃げるところ・来てくれる人・持っていく物・電話だけ。住所・本人の言葉は出さない", async () => {
    const page = await pageOf(family());
    const sheet = buildOwnSheet(page, { today: "2026-11-04", officeName: "デモ事業所" });
    const html = renderToStaticMarkup(createElement(PhoneSheet, { sheet, only: FAMILY_SHEET_BLOCKS }));
    expect([...html.matchAll(/data-block="([^"]+)"/g)].map((m) => m[1])).toEqual(["where", "who", "carry", "call", "emergency"]);
    const t = text(html);
    expect(t).toContain("かわなぎ小学校");
    expect(t).toContain("お薬手帳");
    for (const w of ["かわなぎ町", "松山市", "箪笥"]) expect(t).not.toContain(w);
  });
});
