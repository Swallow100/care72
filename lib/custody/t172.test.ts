// T172: 医療班の一括受入（1 人ずつ今の受入を通す・失敗した人が分かる・成功した人を戻さない・上限・見せる人を増やさない）と、
// 医療班からケアマネへの伝達を止める（欄も API も。行政は今のまま）。カメラは lib/custody/t172-camera.test.ts。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";
import { BulkButton, BulkResult } from "../../components/staff/BulkReceive.tsx";
import { ReceivedPerson } from "../../components/staff/ReceivedPerson.tsx";
import { StaffRequests } from "../../components/staff/StaffRequests.tsx";
import type { Principal } from "../auth/principal.ts";
import { MEDICAL_TIMELINE_WRITES } from "../consent/relay.ts";
import { scopeOfRows, viewScope, WRITABLE_KINDS } from "../consent/scope.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { loadPersonPage, toPersonView } from "../person.ts";
import { writeTimelineRequest } from "../timeline/write.ts";
import { seedStatements } from "../../seed/sql.ts";
import { staffActor } from "./actor.ts";
import { BULK_MAX, requestsByOffice, runBulk, togglePick, togglePickAll, type BulkSent } from "./bulk.ts";
import { parseReceived, pinReceived } from "./entry.ts";
import { receiveRequest, searchRequest } from "./http.ts";
import { CUSTODY_ERROR_LABELS } from "./labels.ts";
import { receivedHref } from "./paths.ts";
import { replyRequestPost } from "./request-http.ts";
import { latestRequestOf, openRequests, sendRequest, type RequestHit } from "./requests.ts";
import { release } from "./store.ts";

// 部品は useRouter を読む（描くだけなので空の物）
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const TODAY = "2026-11-03";
const AT = "2026-11-03T01:00:00.000Z";
const LATER = "2026-11-03T02:00:00.000Z";

let sqlite: ReturnType<typeof migratedSqlite>;
let db: D1Database;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-gov-1', NULL, 'government', '市 防災課')`).run();
  sqlite.prepare(`INSERT INTO accounts (id, office_id, role, display_name) VALUES ('acct-med-1', NULL, 'medical', '医療班 1')`).run();
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const base: Principal = {
  role: "medical",
  judge: false,
  admin: false,
  accountId: "acct-med-1",
  displayName: "医療班 1",
  office: null,
  caseloadOf: null,
  personId: null,
  contactId: null,
};
const medical = (): Principal => base;
const government = (): Principal => ({ ...base, role: "government", accountId: "acct-gov-1", displayName: "市 防災課" });

const cm = { officeId: "office-check", authorId: "acct-yamamoto" };

/** 種の人の事業所（依頼はその事業所のケアマネから） */
function officeOf(personId: string): string {
  return (sqlite.prepare("SELECT office_id FROM people WHERE id = ?").get(personId) as { office_id: string }).office_id;
}

async function ask(personId: string, shelter: string, at = AT): Promise<string> {
  const r = await sendRequest(db, { ...cm, officeId: officeOf(personId) }, { personId, shelter }, at);
  if (!r.ok) throw new Error(r.error);
  return r.requestId;
}

function consent(personId: string, status: "granted" | "refused") {
  sqlite.prepare("UPDATE consents SET status = ? WHERE person_id = ? AND kind = 'medical'").run(status, personId);
}

function count(sql: string, ...args: string[]): number {
  return (sqlite.prepare(sql).get(...args) as { n: number }).n;
}

/** 画面の一括受入と同じに、1 人ずつ返事の受け口を呼ぶ */
function accepting(shelter?: string) {
  return async (t: { id: string }): Promise<BulkSent> => {
    const out = await replyRequestPost(db, medical(), { requestId: t.id, answer: "accept", ...(shelter ? { shelter } : {}) }, LATER);
    return out.body.ok ? { ok: true, custodyId: String(out.body.custodyId) } : { ok: false, label: String(out.body.label) };
  };
}

describe("送り方（runBulk）", () => {
  it("順に 1 人ずつ送り、失敗しても止めない。進みを数える", async () => {
    const seen: string[] = [];
    const steps: number[] = [];
    const out = await runBulk(
      [
        { id: "a", kana: "ア" },
        { id: "b", kana: "イ" },
        { id: "c", kana: "ウ" },
      ],
      async (t) => {
        seen.push(t.id);
        if (t.id === "b") throw new Error("通信");
        return { ok: true, custodyId: `cu-${t.id}` };
      },
      (d) => steps.push(d),
    );
    expect(seen).toEqual(["a", "b", "c"]);
    expect(steps).toEqual([1, 2, 3]);
    expect(out.map((o) => o.ok)).toEqual([true, false, true]);
    expect(out[1]).toMatchObject({ kana: "イ", ok: false, label: "送信失敗" });
  });

  it("上限を超えた分は送らない。選ぶ欄も上限で止まる", async () => {
    const many = Array.from({ length: BULK_MAX + 5 }, (_, i) => ({ id: `x${i}`, kana: "ア" }));
    const send = vi.fn(async () => ({ ok: true as const, custodyId: "cu" }));
    expect(await runBulk(many, send)).toHaveLength(BULK_MAX);
    expect(send).toHaveBeenCalledTimes(BULK_MAX);

    const all = togglePickAll(new Set(), many.map((m) => m.id));
    expect(all.size).toBe(BULK_MAX);
    expect(togglePick(all, "x24").has("x24")).toBe(false);
    // 全員選んだ事業所をもう 1 回押すと外れる
    expect(togglePickAll(new Set(["a", "b"]), ["a", "b"]).size).toBe(0);
    expect([...togglePickAll(new Set(["a"]), ["a", "b"])].sort()).toEqual(["a", "b"]);
  });

  it("新着は URL にコンマでつなぎ、形の違う物は読まない。先頭に全員（並びの番号はそのまま）", () => {
    const href = receivedHref(["cu-1", "cu-2"]);
    expect(href).toBe("/staff?received=cu-1,cu-2");
    expect(parseReceived({ received: "cu-1,cu-2" })).toEqual(["cu-1", "cu-2"]);
    expect(parseReceived({ received: "cu-1,<x>" })).toEqual([]);
    const rows = [{ custodyId: "a" }, { custodyId: "b" }, { custodyId: "c" }, { custodyId: "d" }];
    expect(pinReceived(rows, ["c", "b"]).map((r) => r.custodyId)).toEqual(["c", "b", "a", "d"]);
    expect(pinReceived(rows, ["z"]).map((r) => r.custodyId)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("受入依頼の一括受入", () => {
  it("1 人ごとに今の受入と同じ物（受け持ち・経過・第三者提供の記録）。途中で失敗した人は理由つきで、成功した人は戻らない", async () => {
    const one = await ask("p-01", "かわなぎ小学校");
    const two = await ask("p-02", "みどり小学校");
    const three = await ask("p-03", "みどり小学校");
    // 送ったあとに同意が変わった人（2 人目）は同意の確かめで断られる
    consent("p-02", "refused");
    const out = await runBulk(
      [
        { id: one, kana: "ヤマダ ハナ" },
        { id: two, kana: "コバヤシ トシ" },
        { id: three, kana: "タナカ シゲル" },
      ],
      accepting(),
    );
    expect(out.map((o) => o.ok)).toEqual([true, false, true]);
    expect(out[1]).toMatchObject({ ok: false, label: CUSTODY_ERROR_LABELS.consent });

    for (const p of ["p-01", "p-03"]) {
      expect(count("SELECT count(*) AS n FROM custody WHERE person_id = ? AND released_at IS NULL", p)).toBe(1);
      expect(count("SELECT count(*) AS n FROM third_party_provisions WHERE person_id = ?", p)).toBe(1);
      expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = ? AND kind = 'received'", p)).toBe(1);
    }
    // 失敗した人には何も書かない。依頼中のまま
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = 'p-02'")).toBe(0);
    expect(count("SELECT count(*) AS n FROM third_party_provisions WHERE person_id = 'p-02'")).toBe(0);
    expect((sqlite.prepare("SELECT state FROM custody_requests WHERE id = ?").get(two) as { state: string }).state).toBe("open");
  });

  it("避難所の 1 回の入力で全員に。空なら各人の依頼の行き先。事業所の側の行き先も実際の避難所になる", async () => {
    const a = await ask("p-01", "かわなぎ小学校");
    const b = await ask("p-02", "みどり小学校");
    await runBulk([{ id: a, kana: "ヤマダ ハナ" }, { id: b, kana: "コバヤシ トシ" }], accepting("そらみ台小学校"));
    for (const p of ["p-01", "p-02"]) {
      expect(sqlite.prepare("SELECT shelter FROM custody WHERE person_id = ?").get(p)).toEqual({ shelter: "そらみ台小学校" });
      expect((await latestRequestOf(db, p))?.shelter).toBe("そらみ台小学校");
    }
    const c = await ask("p-03", "みどり小学校");
    await runBulk([{ id: c, kana: "タナカ シゲル" }], accepting());
    expect(sqlite.prepare("SELECT shelter FROM custody WHERE person_id = 'p-03'").get()).toEqual({ shelter: "みどり小学校" });
  });

  it("避難所の字が長すぎれば断り、受け入れない。受け入れに失敗したら依頼中に戻る", async () => {
    const a = await ask("p-01", "かわなぎ小学校");
    const long = await replyRequestPost(db, medical(), { requestId: a, answer: "accept", shelter: "あ".repeat(41) }, LATER);
    expect(long.body).toMatchObject({ ok: false, error: "shelter" });
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = 'p-01'")).toBe(0);
    expect((sqlite.prepare("SELECT state, shelter FROM custody_requests WHERE id = ?").get(a) as { state: string; shelter: string })).toEqual({ state: "open", shelter: "かわなぎ小学校" });
  });

  it("一覧は依頼の来ている人だけ。事業所でまとめても依頼の無い同じ事業所の人は出ない", async () => {
    await ask("p-01", "かわなぎ小学校", AT);
    await ask("p-02", "みどり小学校", LATER);
    const list = await openRequests(db, staffActor(medical())!, TODAY);
    const groups = requestsByOffice(list);
    expect(groups.flatMap((g) => g.requests.map((r) => r.personId))).toEqual(["p-01", "p-02"]);
    expect(groups.map((g) => g.requests.length).reduce((a, b) => a + b, 0)).toBe(2);
    // 依頼の行の鍵は前のまま（漢字の氏名・薬は持たない）
    expect(Object.keys(list[0]!).sort()).toEqual(["age", "id", "kana", "office", "personId", "requestedAt", "shelter"]);
    const html = renderToStaticMarkup(createElement(StaffRequests, { requests: list }));
    expect(html).toContain('data-request-office="');
    expect(html).toContain("一括受入");
    expect(html).toContain("全選択");
    // 依頼の無い人（同じ事業所の p-03）のカナは出ない
    const third = sqlite.prepare("SELECT kana FROM people WHERE id = 'p-03'").get() as { kana: string };
    expect(html).not.toContain(third.kana);
  });

  it("事業所ごとにまとめ、事業所の順は古い依頼の順、中は来た順", () => {
    const hit = (id: string, office: string): RequestHit => ({ id, personId: id, kana: "ア", age: null, office, shelter: "み", requestedAt: AT });
    const groups = requestsByOffice([hit("a", "東"), hit("b", "西"), hit("c", "東")]);
    expect(groups.map((g) => [g.office, g.requests.map((r) => r.id)])).toEqual([
      ["東", ["a", "c"]],
      ["西", ["b"]],
    ]);
  });
});

describe("検索のヒットの一括受入", () => {
  it("今の受入の受け口を 1 人ずつ。同意の無い人は本人確認の範囲で（根拠は生命保護）、全部同じ避難所", async () => {
    const send = async (t: { id: string }): Promise<BulkSent> => {
      const out = await receiveRequest(db, medical(), { personId: t.id, shelter: "みどり小学校", via: "search" }, AT);
      return out.body.ok ? { ok: true, custodyId: String(out.body.custodyId) } : { ok: false, label: String(out.body.label) };
    };
    const out = await runBulk(
      [
        { id: "p-01", kana: "ヤマダ ハナ" },
        { id: "p-09", kana: "ワタナベ" },
        { id: "p-nobody", kana: "ナシ" },
      ],
      send,
    );
    expect(out.map((o) => o.ok)).toEqual([true, true, false]);
    expect(out[2]).toMatchObject({ label: CUSTODY_ERROR_LABELS.not_found });
    const row = (p: string) => sqlite.prepare("SELECT basis, shelter, scope FROM third_party_provisions WHERE person_id = ?").get(p) as { basis: string; shelter: string; scope: string };
    expect(row("p-01")).toMatchObject({ basis: "consent", shelter: "みどり小学校" });
    expect(row("p-09")).toMatchObject({ basis: "vital", shelter: "みどり小学校", scope: JSON.stringify(["identity"]) });
    // もう 1 回送っても二重にしない（受入済）
    const again = await runBulk([{ id: "p-01", kana: "ヤマダ ハナ" }], send);
    expect(again[0]).toMatchObject({ ok: false, label: CUSTODY_ERROR_LABELS.already });
    expect(count("SELECT count(*) AS n FROM custody WHERE person_id = 'p-01' AND released_at IS NULL")).toBe(1);
  });

  it("検索の決まりは前のまま（全件を返さない・ヒットの鍵は 6 つ）", async () => {
    expect((await searchRequest(db, medical(), { text: "" }, TODAY)).body.error).toBe("query");
    const out = await searchRequest(db, medical(), { text: "ヤマダ" }, TODAY);
    const hits = out.body.hits as Array<Record<string, unknown>>;
    expect(Object.keys(hits[0]!).sort()).toEqual(["age", "ageReported", "birthDate", "id", "kana", "mine"]);
  });
});

describe("一括受入の画面の部品", () => {
  const bulk = { busy: false, step: null, outcomes: null, run: async () => [] };
  it("押せるのは選んだ時だけ、上限に達したら上限の言葉", () => {
    const none = renderToStaticMarkup(createElement(BulkButton, { count: 0, total: 2, bulk, onClick: () => {} }));
    expect(none).toMatch(/<button[^>]*disabled/);
    const full = renderToStaticMarkup(createElement(BulkButton, { count: BULK_MAX, total: 30, bulk, onClick: () => {} }));
    expect(full).toContain("data-bulk-limit");
    expect(full).toContain("上限");
    const going = renderToStaticMarkup(createElement(BulkButton, { count: 3, total: 3, bulk: { ...bulk, busy: true, step: { done: 1, total: 3 } }, onClick: () => {} }));
    expect(going).toContain("1/3");
  });
  it("失敗した人はカナと理由の一覧に。全員成功なら人数だけ", () => {
    const html = renderToStaticMarkup(
      createElement(BulkResult, {
        outcomes: [
          { id: "a", kana: "ヤマダ ハナ", ok: true, custodyId: "cu-1" },
          { id: "b", kana: "コバヤシ トシ", ok: false, label: "同意なし" },
        ],
      }),
    );
    expect(html).toContain('data-bulk-result="failed"');
    expect(html).toContain("コバヤシ トシ");
    expect(html).toContain("同意なし");
    expect(html).not.toContain("ヤマダ ハナ");
    const ok = renderToStaticMarkup(createElement(BulkResult, { outcomes: [{ id: "a", kana: "ヤマダ ハナ", ok: true, custodyId: "cu-1" }] }));
    expect(ok).toContain('data-bulk-result="ok"');
    expect(ok).not.toContain("data-bulk-failed");
  });
});

describe("医療班からケアマネへの伝達を止める", () => {
  async function held(p: Principal, personId: string): Promise<string> {
    const out = await receiveRequest(db, p, { personId, shelter: "みどり小学校", via: "search" }, AT);
    return String(out.body.custodyId);
  }

  it("定数は今なし。医療班の範囲は空、行政は全部の種類（同意の有無を問わない）", () => {
    expect(MEDICAL_TIMELINE_WRITES).toBe(false);
    for (const status of ["granted", "refused", "unconfirmed"] as const) {
      const input = { consents: [{ kind: "medical" as const, status, scope: null }], origin: "care_manager" as const };
      expect(viewScope("medical", input).writes).toEqual([]);
      expect(viewScope("government", input).writes).toEqual([...WRITABLE_KINDS]);
    }
  });

  it("API でも書けない（全部の種類で 403、行は増えない）。行政は書ける", async () => {
    await held(medical(), "p-01");
    const before = count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = 'p-01'");
    for (const kind of WRITABLE_KINDS) {
      const out = await writeTimelineRequest(db, medical(), { personId: "p-01", kind, body: "x" }, LATER);
      expect(out.status, kind).toBe(403);
    }
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = 'p-01'")).toBe(before);
    await held(government(), "p-01");
    expect((await writeTimelineRequest(db, government(), { personId: "p-01", kind: "note", body: "x" }, LATER)).status).toBe(200);
  });

  it("受け入れた人の画面に欄が出ない。経過の区分（受入の行）は残る。行政には欄が出る", async () => {
    const custodyId = await held(medical(), "p-01");
    const rows = (await loadPersonPage(db, medical(), "p-01"))!;
    const view = toPersonView(rows, { today: TODAY, scope: scopeOfRows("medical", rows) });
    expect(view.writes).toEqual([]);
    const html = renderToStaticMarkup(createElement(ReceivedPerson, { view, custody: null, consent: "granted" }));
    expect(html).not.toContain('data-form="timeline"');
    expect(html).toContain('data-section="timeline"');
    expect(html).toContain("受入");

    await held(government(), "p-01");
    const gov = (await loadPersonPage(db, government(), "p-01"))!;
    const govHtml = renderToStaticMarkup(
      createElement(ReceivedPerson, { view: toPersonView(gov, { today: TODAY, scope: scopeOfRows("government", gov) }), custody: null, consent: "granted" }),
    );
    expect(govHtml).toContain('data-form="timeline"');

    // 搬送は事実としてケアマネの経過にそのまま
    await release(db, staffActor(medical())!, { custodyId, kind: "transported", note: "中央病院" }, LATER);
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE person_id = 'p-01' AND kind = 'transported'")).toBe(1);
  });

  it("受入依頼の返事は決まった 2 つだけ。理由の文を送っても残らず、状態は事実として見える", async () => {
    const a = await ask("p-01", "かわなぎ小学校");
    const free = { note: "申し送りの文", reason: "申し送りの文", body: "申し送りの文", message: "申し送りの文" };
    const out = await replyRequestPost(db, medical(), { requestId: a, answer: "decline", ...free }, LATER);
    expect(out.body).toEqual({ ok: true, custodyId: null });
    const row = sqlite.prepare("SELECT * FROM custody_requests WHERE id = ?").get(a) as Record<string, unknown>;
    expect(row.state).toBe("declined");
    expect(JSON.stringify(row)).not.toContain("申し送り");
    expect(Object.keys(row).join(",")).not.toMatch(/note|reason|body|message/);
    expect(count("SELECT count(*) AS n FROM timeline_entries WHERE body LIKE '%申し送り%'")).toBe(0);
    expect((await latestRequestOf(db, "p-01"))?.state).toBe("declined");
  });
});
