// 赤のあとの聞き取りの答えとメモの保存（T49）: 押すたびに送った答えが信号の行に重なる（後勝ち）、今の 4 問の列にも同じ値、
// 役の壁（自分の赤の信号だけ）、平時は断る、ケアマネの直し、聞き取りは担当一覧の色・行・理由・並びを動かさない。
// D1 は node:sqlite に種の 10 人。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { NO_ANSWERS, type FamilySignalBody, type SignalBody } from "./body.ts";
import { hearingViewOf } from "./hearing.ts";
import { answersPost, memoEditPost, signalPost } from "./http.ts";
import type { Answers } from "./questions.ts";

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

const self = (p: Partial<Principal> = {}): Principal => ({
  role: "self",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: "山田 ハナ",
  office: DEMO,
  caseloadOf: null,
  personId: "p-01",
  contactId: null,
  ...p,
});
const family = (p: Partial<Principal> = {}): Principal => ({ ...self(), role: "family", contactId: "c-01-1", ...p });
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

const QUAKE = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(QUAKE + h * 3_600_000).toISOString();

async function earthquake() {
  const r = await switchDisasterMode(db, disasterScope(careManager)!, { kind: "earthquake", version: 0, at: at(0) });
  expect(r).toEqual({ ok: true, changed: true });
}

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** 赤を押した時に送る信号（答えはまだ無い。T49 から答えは押すたびに answers の API で足す） */
const redPress = (time = at(1)): SignalBody => ({
  id: newId(),
  color: "red",
  whereNow: null,
  answers: { ...NO_ANSWERS },
  occurredAt: time,
  sentAt: time,
});

const row = (id: string) => sqlite.prepare("SELECT * FROM signals WHERE id = ?").get(id) as Record<string, unknown>;
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });
const caseloadScope = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

async function triageOf(personId: string, h: number) {
  const c = await loadCaseload(db, caseloadScope, "2026-11-04", at(h));
  const t = c!.rows.find((r) => r.id === personId)!.triage!;
  return { color: t.color, rule: t.rule, group: t.group, reason: t.reason, qualifiers: t.qualifiers };
}

async function order(h: number) {
  const c = await loadCaseload(db, caseloadScope, "2026-11-04", at(h));
  return c!.rows.map((r) => r.id);
}

describe("押すたびに送る（後勝ち）", () => {
  it("赤を押した時に信号、答えを押すたびにそれまでの全部。answers と今の 4 問の列と経過の 1 行が重なる", async () => {
    await earthquake();
    const sig = redPress();
    expect((await signalPost(db, self(), sig, at(1))).status).toBe(200);
    expect(row(sig.id)).toMatchObject({ injured: null, answers: null });

    const a1: Answers = { injured: { choice: "yes", via: "press" } };
    expect(await json(await answersPost(db, self(), sig.id, { answers: a1 }))).toMatchObject({ status: 200, body: { ok: true, changed: true } });
    expect(row(sig.id)).toMatchObject({ injured: 1, can_move: null, answers: JSON.stringify(a1) });

    const a2: Answers = { ...a1, injuryPart: { choice: "leg", via: "press" }, canMove: { choice: "no", via: "voice" } };
    await answersPost(db, self(), sig.id, { answers: a2 });
    expect(row(sig.id)).toMatchObject({ injured: 1, can_move: 0, answers: JSON.stringify(a2) });
    const log = sqlite.prepare("SELECT body FROM timeline_entries WHERE signal_id = ? AND kind = 'signal'").get(sig.id) as { body: string };
    expect(log.body).toBe("無事じゃない けが あり・動けない・未回答 2");

    // 同じ物をもう一度は何も変えない
    expect((await json(await answersPost(db, self(), sig.id, { answers: a2 }))).body).toMatchObject({ changed: false });
  });

  it("家族も自分が答えた赤の信号に（4 つの列にも）。本人の信号・ほかの家族の信号には書けない", async () => {
    await earthquake();
    const fam: FamilySignalBody = { id: newId(), color: "red", occurredAt: at(1), sentAt: at(1) };
    await signalPost(db, family(), fam, at(1));
    const a: Answers = { canMove: { choice: "no", via: "press" } };
    expect((await answersPost(db, family(), fam.id, { answers: a })).status).toBe(200);
    expect(row(fam.id)).toMatchObject({ can_move: 0 });
    // ほかの家族（c-01-2）は書けない
    expect((await answersPost(db, family({ contactId: "c-01-2" }), fam.id, { answers: a })).status).toBe(404);
    // 本人の信号に家族は書けない
    const mine = redPress();
    await signalPost(db, self(), mine, at(1));
    expect((await answersPost(db, family(), mine.id, { answers: a })).status).toBe(404);
  });

  it("断る: 平時 409・ログインなし 401・ケアマネ 403・ほかの本人の信号 404・緑 400・知らない問い 400", async () => {
    const sig = redPress();
    expect((await answersPost(db, self(), sig.id, { answers: {} })).status).toBe(409);
    await earthquake();
    await signalPost(db, self(), sig, at(1));
    const a: Answers = { injured: { choice: "no", via: "press" } };
    expect((await answersPost(db, null, sig.id, { answers: a })).status).toBe(401);
    expect((await answersPost(db, careManager, sig.id, { answers: a })).status).toBe(403);
    expect((await answersPost(db, self({ personId: "p-02" }), sig.id, { answers: a })).status).toBe(404);
    const g: SignalBody = { ...redPress(), color: "green", whereNow: "home" };
    await signalPost(db, self(), g, at(1));
    expect((await answersPost(db, self(), g.id, { answers: a })).status).toBe(400);
    expect((await answersPost(db, self(), sig.id, { answers: { pain_score: { choice: "3", via: "press" } } })).status).toBe(400);
    expect((await answersPost(db, self(), sig.id, { nope: 1 })).status).toBe(400);
  });
});

describe("聞き取りは色と連絡の順を動かさない", () => {
  it("からだの訴え（息がくるしい・胸がいたい）と Claude のメモと直しを足しても、色・行・組・理由・並びは同じ", async () => {
    await earthquake();
    const sig = redPress();
    await signalPost(db, self(), sig, at(1));
    const before = await triageOf("p-01", 1.1);
    const orderBefore = await order(1.1);

    await answersPost(db, self(), sig.id, {
      answers: {
        body: { choice: "breath", via: "press" },
        trappedBy: { choice: "furniture", via: "press" },
        water: { choice: "waist", via: "press" },
        fireGas: { choice: "yes", via: "press" },
      },
    });
    sqlite
      .prepare("UPDATE signals SET ai_memo = ? WHERE id = ?")
      .run(JSON.stringify({ body: "胸が痛い", injury: "足を打った", trapped: "タンスに挟まれて" }), sig.id);
    await memoEditPost(db, careManager, sig.id, { field: "body", text: "息が苦しいと言った" }, at(1.05));

    expect(await triageOf("p-01", 1.1)).toEqual(before);
    expect(await order(1.1)).toEqual(orderBefore);
  });
});

describe("ケアマネの直し", () => {
  it("欄を直すと人の値（AI の印なし）、空にもできる。経過に「聞き取り修正」。Claude の写しは残す", async () => {
    await earthquake();
    const sig = redPress();
    await signalPost(db, self(), sig, at(1));
    sqlite.prepare("UPDATE signals SET ai_memo = ? WHERE id = ?").run(JSON.stringify({ place: "台所", water: "床まで" }), sig.id);

    const r = await json(await memoEditPost(db, careManager, sig.id, { field: "place", text: "台所の床" }, at(1.1)));
    expect(r).toMatchObject({ status: 200, body: { ok: true, changed: true } });
    await memoEditPost(db, careManager, sig.id, { field: "water", text: null }, at(1.2));
    const v = hearingViewOf(row(sig.id) as never)!;
    expect(v.rows.find((x) => x.field === "place")).toMatchObject({ text: "台所の床", textBy: "human" });
    expect(v.rows.find((x) => x.field === "water")).toMatchObject({ text: null, textBy: "human" });
    expect(row(sig.id).ai_memo).toBe(JSON.stringify({ place: "台所", water: "床まで" }));
    const logs = sqlite.prepare("SELECT body FROM timeline_entries WHERE signal_id = ? AND kind = 'note' ORDER BY occurred_at").all(sig.id);
    expect(logs).toEqual([{ body: "聞き取り修正 場所「台所の床」" }, { body: "聞き取り修正 水 空欄" }]);
  });

  it("直せるのはケアマネだけ。本人・家族 403、ログインなし 401、事業所の外・無い信号 404、知らない欄 400", async () => {
    await earthquake();
    const sig = redPress();
    await signalPost(db, self(), sig, at(1));
    const body = { field: "place", text: "居間" };
    expect((await memoEditPost(db, self(), sig.id, body, at(1))).status).toBe(403);
    expect((await memoEditPost(db, family(), sig.id, body, at(1))).status).toBe(403);
    expect((await memoEditPost(db, null, sig.id, body, at(1))).status).toBe(401);
    expect((await memoEditPost(db, careManager, "nope", body, at(1))).status).toBe(404);
    expect(
      (await memoEditPost(db, { ...careManager, office: { ...DEMO, id: "office-other" } }, sig.id, body, at(1))).status,
    ).toBe(404);
    expect((await memoEditPost(db, careManager, sig.id, { field: "severity", text: "高" }, at(1))).status).toBe(400);
  });
});

describe("ケアマネの画面の「聞き取り」の欄（components/list/Hearing.tsx）", () => {
  it("押した答えは印なし（声で取れた物は「声」）、Claude の写しは AI の印、直した欄は「修正済」。色の札（至急など）を付けない", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Hearing } = await import("../../components/list/Hearing.tsx");
    const html = renderToStaticMarkup(
      createElement(Hearing, {
        signalId: "s-1",
        editable: true,
        source: {
          answers: JSON.stringify({ injured: { choice: "yes", via: "press" }, canMove: { choice: "no", via: "voice" } }),
          ai_memo: JSON.stringify({ body: "胸が少し痛い", injury: "足を打った" }),
          memo: JSON.stringify({ request: "薬を持ってきて" }),
        },
      }),
    );
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("聞き取り");
    expect(html).toContain('data-hearing-field="body"');
    expect(text).toContain("「胸が少し痛い」");
    // けがは押した答えがあるので、Claude の「足を打った」は出さない
    expect(text).not.toContain("足を打った");
    expect(html).toContain('data-answer="voice"');
    expect(text).toContain("（声）");
    expect(html.match(/data-memo="ai"/g)).toHaveLength(1);
    expect(text).toContain("修正済");
    for (const w of ["至急", "要確認", "緊急度", "重症", "判定", "診断"]) expect(text).not.toContain(w);
    expect(renderToStaticMarkup(createElement(Hearing, { signalId: "s-2", source: {} }))).toBe("");
  });
});
