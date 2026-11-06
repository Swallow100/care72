// 経過の書き足し（docs/tasks/T24.md）。誰が・いつ・どの役が付く、医療班の書き足しがケアマネの経過に出る、
// 受け持ちの間だけ書ける、書ける種類は役で（同意の範囲と同じ所）、API の断り方。
// D1 は node:sqlite（lib/db/test-d1.ts）に種の 10 人。

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { scopeOfRows } from "../consent/scope.ts";
import { staffActor } from "../custody/actor.ts";
import { receive, release } from "../custody/store.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { entryPlace } from "../forms/form9-db.ts";
import { loadPersonPage, toPersonView, type TimelineItem } from "../person.ts";
import { BODY_MAX } from "./paths.ts";
import { parseWrite, writeTimeline, writeTimelineRequest } from "./write.ts";

// 経過の書き足しの仕組みの試験。医療班の役の書き足しは今はなし（T172）なので、定数を戻した形で確かめる（今の形は lib/custody/t172.test.ts）
vi.mock("../consent/relay.ts", () => ({ MEDICAL_TIMELINE_WRITES: true }));

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

const TODAY = "2026-11-03";
const AT = "2026-11-03T01:00:00.000Z";
/** 11:40（JST） */
const EXAMINED_AT = "2026-11-03T02:40:00.000Z";
const SHELTER = "みどり小学校";

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-gov-1', NULL, 'government', '市 防災課')`).run();
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
const self = (): Principal => ({ ...base, role: "self", judge: false, accountId: null, personId: "p-01" });
const family = (): Principal => ({ ...base, role: "family", judge: false, accountId: null, personId: "p-01", contactId: "c-01-1" });

async function received(personId: string, p: Principal = medical()) {
  const r = await receive(db, staffActor(p)!, { personId, shelter: SHELTER, via: "search" }, AT);
  if (!r.ok) throw new Error(r.error);
  return r.custodyId;
}

async function timelineOf(p: Principal, personId: string): Promise<TimelineItem[]> {
  const rows = (await loadPersonPage(db, p, personId))!;
  const v = toPersonView(rows, { today: TODAY, scope: scopeOfRows(p.role, rows) });
  return v.sections.find((s) => s.id === "timeline")!.blocks.flatMap((b) => (b.type === "timeline" ? b.items : []));
}

describe("誰が・いつ・どの役", () => {
  it("医療班が「診察」と自由文を足すと、書き手・役・時刻がサーバーで付き、ケアマネの経過にも「医療班 診察 11:40」", async () => {
    await received("p-01");
    const out = await writeTimelineRequest(db, medical(), { personId: "p-01", kind: "examined", body: " 呼吸 落ち着いている " }, EXAMINED_AT);
    expect(out.status).toBe(200);
    const row = sqlite.prepare("SELECT * FROM timeline_entries WHERE id = ?").get(String(out.body.id)) as Record<string, unknown>;
    expect(row).toMatchObject({
      person_id: "p-01",
      author_id: "acct-judge",
      author_role: "medical",
      kind: "examined",
      body: "呼吸 落ち着いている",
      payload: null,
      occurred_at: EXAMINED_AT,
      created_at: EXAMINED_AT,
    });

    for (const p of [judgeCm(), yamamoto(), medical()]) {
      const item = (await timelineOf(p, "p-01")).find((t) => t.at === EXAMINED_AT)!;
      expect(item).toMatchObject({ kind: "診察", who: "医療班 審査員 1", body: "呼吸 落ち着いている", staff: true });
      expect(item.when).toBe("2026-11-03 11:40");
    }
  });

  it("行政は「行政 名前」、ケアマネは「ケアマネ 名前」で付く", async () => {
    await received("p-01", government());
    expect((await writeTimelineRequest(db, government(), { personId: "p-01", kind: "safety_check" }, EXAMINED_AT)).status).toBe(200);
    const later = "2026-11-03T02:45:00.000Z";
    expect((await writeTimelineRequest(db, yamamoto(), { personId: "p-01", kind: "note", body: "娘さんと連絡 済" }, later)).status).toBe(200);
    const items = (await timelineOf(yamamoto(), "p-01")).filter((t) => t.at === EXAMINED_AT || t.at === later);
    expect(items.map((t) => [t.kind, t.who, t.body])).toEqual([
      ["安否確認", "行政 市 防災課", null],
      ["記録", "ケアマネ 山本", "娘さんと連絡 済"],
    ]);
    // ケアマネの行は医療班・行政の行（staff）ではない
    expect(items[1].staff).toBeUndefined();
  });

  it("書き手と時刻は送った値で変えられない（authorId・occurredAt を入れても無視）", async () => {
    await received("p-01");
    const out = await writeTimelineRequest(
      db,
      medical(),
      { personId: "p-01", kind: "safety_check", authorId: "acct-yamamoto", authorRole: "care_manager", occurredAt: "2020-01-01T00:00:00.000Z" },
      EXAMINED_AT,
    );
    const row = sqlite.prepare("SELECT author_id, author_role, occurred_at FROM timeline_entries WHERE id = ?").get(String(out.body.id));
    expect(row).toEqual({ author_id: "acct-judge", author_role: "medical", occurred_at: EXAMINED_AT });
  });

  it("書き足しの到着の本文は様式 9 の避難先として読まれる（欄の名前は「避難所」）。搬送の本文は場所に使わない", async () => {
    await received("p-01");
    const a = await writeTimelineRequest(db, medical(), { personId: "p-01", kind: "arrived_shelter", body: "かわなぎ小学校" }, EXAMINED_AT);
    const t = await writeTimelineRequest(db, medical(), { personId: "p-01", kind: "transported", body: "中央病院" }, EXAMINED_AT);
    const row = (id: unknown) =>
      sqlite.prepare("SELECT kind, body, payload FROM timeline_entries WHERE id = ?").get(String(id)) as {
        kind: "arrived_shelter" | "transported";
        body: string | null;
        payload: string | null;
      };
    expect(entryPlace(row(a.body.id))).toBe("かわなぎ小学校");
    expect(entryPlace(row(t.body.id))).toBeNull();
  });

  it("9 渡辺（医療班への提供に同意なし）にも書け、医療班の経過に出る（医療班の行は範囲の中）", async () => {
    await received("p-09");
    expect((await writeTimelineRequest(db, medical(), { personId: "p-09", kind: "medication_given", body: "常用薬 1 回分" }, EXAMINED_AT)).status).toBe(200);
    const items = await timelineOf(medical(), "p-09");
    expect(items.map((t) => t.kind)).toEqual(["受入", "提供", "配薬"]);
  });
});

describe("書ける人と種類", () => {
  it("医療班は受け持ちの間だけ書ける（受け入れの前・搬送のあとは 404）", async () => {
    expect((await writeTimelineRequest(db, medical(), { personId: "p-01", kind: "examined" }, AT)).status).toBe(404);
    const custodyId = await received("p-01");
    expect((await writeTimelineRequest(db, medical(), { personId: "p-01", kind: "examined" }, AT)).status).toBe(200);
    await release(db, staffActor(medical())!, { custodyId, kind: "transported", note: "中央病院" }, EXAMINED_AT);
    const after = await writeTimelineRequest(db, medical(), { personId: "p-01", kind: "examined" }, EXAMINED_AT);
    expect(after).toEqual({ status: 404, body: { ok: false, error: "not_found", label: "該当なし" } });
  });

  it("ケアマネは診察・配薬を書けない（403）。安否確認・搬送・到着・記録は書ける", async () => {
    for (const kind of ["examined", "medication_given"]) {
      expect((await writeTimelineRequest(db, judgeCm(), { personId: "p-01", kind, body: "x" }, AT)).status).toBe(403);
    }
    for (const kind of ["safety_check", "transported", "arrived_shelter", "note"]) {
      expect((await writeTimelineRequest(db, judgeCm(), { personId: "p-01", kind, body: "x" }, AT)).status).toBe(200);
    }
    // 別の事業所の本人は壁の外
    expect((await writeTimelineRequest(db, judgeCm(), { personId: "p-nobody", kind: "note", body: "x" }, AT)).status).toBe(404);
  });

  it("ログインなし 401、本人・家族・役未選択は 403", async () => {
    expect((await writeTimelineRequest(db, null, { personId: "p-01", kind: "note", body: "x" }, AT)).status).toBe(401);
    for (const p of [self(), family(), { ...base, role: "unselected" as const }]) {
      expect((await writeTimelineRequest(db, p, { personId: "p-01", kind: "note", body: "x" }, AT)).status).toBe(403);
    }
    expect(Number(sqlite.prepare("SELECT count(*) AS n FROM timeline_entries").get()!.n)).toBe(0);
  });

  it("writeTimeline も同じ範囲で断る（API を通らない呼び出しでも）", async () => {
    await received("p-01");
    expect(await writeTimeline(db, judgeCm(), { personId: "p-01", kind: "examined", body: null }, AT)).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("入力の読み方", () => {
  it("種類は書き足せる物だけ、記録は本文が要る、400 字まで、前後の空白を落とす", () => {
    expect(parseWrite({ personId: "p-01", kind: "signal" })).toEqual({ ok: false, error: "invalid" });
    expect(parseWrite({ personId: "p-01", kind: "received" })).toEqual({ ok: false, error: "invalid" });
    expect(parseWrite({ personId: "../x", kind: "note", body: "a" })).toEqual({ ok: false, error: "invalid" });
    expect(parseWrite({ personId: "p-01", kind: "note", body: "   " })).toEqual({ ok: false, error: "empty" });
    expect(parseWrite({ personId: "p-01", kind: "note", body: "あ".repeat(BODY_MAX + 1) })).toEqual({ ok: false, error: "too_long" });
    expect(parseWrite({ personId: "p-01", kind: "note", body: "a\u0007b" })).toEqual({ ok: false, error: "invalid" });
    expect(parseWrite({ personId: "p-01", kind: "examined", body: 3 })).toEqual({ ok: false, error: "invalid" });
    expect(parseWrite({ personId: "p-01", kind: "examined" })).toEqual({ ok: true, value: { personId: "p-01", kind: "examined", body: null } });
    expect(parseWrite({ personId: "p-01", kind: "note", body: " 1 行目\r\n2 行目 " })).toEqual({
      ok: true,
      value: { personId: "p-01", kind: "note", body: "1 行目\n2 行目" },
    });
  });
});
