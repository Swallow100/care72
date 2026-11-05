// 声の聞き取りの会話（docs/tasks/T137.md）のサーバー: 会話の API（役の壁・平時・自分の赤の信号だけ・後勝ち・仮名化の門）、
// 録音に添える会話、分類に渡す会話の文、ケアマネの行の詳細の会話の欄。D1 は node:sqlite に種の 10 人。本物の API は呼ばない。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Talk } from "../../components/list/Talk.tsx";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import type { SignalRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { classifySignal } from "../classify/store.ts";
import { NO_ANSWERS } from "./body.ts";
import { recordingPost, type FormLike } from "./http.ts";
import { saveSignal, signalScope } from "./save.ts";
import { fixedLine, heardTurn, newTalkLog, readTalkLog, TALK_OPENING, type TalkLine, type TalkLog } from "./talk.ts";
import { talkPost } from "./talk-http.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
const selfP: Principal = {
  role: "self",
  judge: true,
  admin: false,
  accountId: "acct-judge",
  displayName: "山田 ハナ",
  office: DEMO,
  caseloadOf: null,
  personId: "p-01",
  contactId: null,
};
const familyP: Principal = { ...selfP, role: "family", displayName: "森 恵子", contactId: "c-01-1" };
const otherSelfP: Principal = { ...selfP, personId: "p-02" };
const cmP: Principal = {
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
const atH = (h: number) => new Date(QUAKE + h * 3_600_000).toISOString();
const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;
beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const row = (id: string) => sqlite.prepare("SELECT * FROM signals WHERE id = ?").get(id) as unknown as SignalRow;
const aiRows = () => sqlite.prepare("SELECT purpose, model, status FROM ai_calls").all() as Array<Record<string, unknown>>;

async function quake() {
  expect(await switchDisasterMode(db, disasterScope(cmP)!, { kind: "earthquake", version: 0, at: atH(0) })).toMatchObject({ ok: true });
}
async function signal(n: number, color: "red" | "green" = "red", p: Principal = selfP) {
  const r = await saveSignal(
    db,
    signalScope(p)!,
    { id: sid(n), color, whereNow: color === "green" ? "home" : null, answers: { ...NO_ANSWERS }, occurredAt: atH(1), sentAt: atH(1) },
    atH(1),
  );
  expect(r.ok).toBe(true);
}

function fake(answer: () => unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return {
            id: "msg_test",
            type: "message",
            role: "assistant",
            model: HAIKU,
            content: [{ type: "text", text: JSON.stringify(answer()), citations: null }],
            stop_reason: "end_turn",
            stop_details: null,
            stop_sequence: null,
            usage: { input_tokens: 300, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          } as unknown as Message;
        },
      },
    },
  };
  return { client, calls };
}

const deps = (client?: ClaudeClient) => ({
  ai: async (): Promise<AskJsonContext> => ({
    env: { ANTHROPIC_API_KEY: "dummy" },
    usage: d1UsageStore(db),
    office: { id: DEMO.id, kind: DEMO.kind },
    now: () => new Date(QUAKE + 3_700_000),
    claude: client,
  }),
  now: () => QUAKE + 3_700_000,
});

function logOf(pairs: Array<[TalkLine, string | null]>): TalkLog {
  const log = newTalkLog(atH(1.01));
  pairs.forEach(([l, r], i) => log.turns.push(heardTurn(l, r, new Date(QUAKE + 3_640_000 + i * 15_000).toISOString())));
  return log;
}

const post = async (p: Principal | null, id: string, log: unknown, client?: ClaudeClient) => {
  const res = await talkPost(db, p, id, { log }, deps(client));
  return { status: res.status, body: (await res.json()) as { reply?: Record<string, unknown> } };
};

describe("会話の API（talkPost）", () => {
  it("役の壁: ログインなし 401・家族とケアマネ 403・平時 409・ほかの人の信号 404・緑 400・形の違い 400", async () => {
    const log = logOf([[TALK_OPENING, "あしが いたい"]]);
    expect((await post(null, sid(1), log)).status).toBe(401);
    expect((await post(familyP, sid(1), log)).status).toBe(403);
    expect((await post(cmP, sid(1), log)).status).toBe(403);
    expect((await post(selfP, sid(1), log)).status).toBe(409);
    await quake();
    await signal(1);
    await signal(2, "green");
    expect((await post(otherSelfP, sid(1), log)).status).toBe(404);
    expect((await post(selfP, sid(2), log)).status).toBe(400);
    expect((await post(selfP, sid(1), { ...log, end: "never" })).status).toBe(400);
    expect((await post(selfP, "not-a-uuid", log)).status).toBe(404);
  });

  it("記録を信号に書き（後勝ち。往復の少ない古い送りで上書きしない）、次の 1 文を Claude（Haiku・分類の数え）で返す。名前は伏せて渡す", async () => {
    await quake();
    await signal(1);
    const f = fake(() => ({ topic: "canMove", preface: "あしが いたいのですね", question: "じぶんで たてますか", done: false }));
    const one = logOf([[TALK_OPENING, "山田 ハナです。あしが いたい"]]);
    const r = await post(selfP, sid(1), one, f.client);
    expect(r.status).toBe(200);
    expect(r.body.reply).toMatchObject({ kind: "ask", called: true, line: { by: "ai", topic: "canMove", text: "あしが いたいのですね。じぶんで たてますか" } });
    expect(JSON.stringify(f.calls[0])).not.toContain("山田");
    expect(aiRows()).toEqual([{ purpose: "classify", model: HAIKU, status: "ok" }]);
    expect(readTalkLog(row(sid(1)).talk)?.turns).toHaveLength(1);
    const two = logOf([
      [TALK_OPENING, "山田 ハナです。あしが いたい"],
      [fixedLine("injured"), "はい"],
    ]);
    await post(selfP, sid(1), two, f.client);
    expect(readTalkLog(row(sid(1)).talk)?.turns).toHaveLength(2);
    // 遅れて届いた古い送り（1 往復）は書かない
    await post(selfP, sid(1), one, f.client);
    expect(readTalkLog(row(sid(1)).talk)?.turns).toHaveLength(2);
    // 色と順に使わない: 会話を書いても信号の 4 列・分類は変わらない
    expect(row(sid(1))).toMatchObject({ injured: null, can_move: null, classes: null });
  });

  it("AI の 1 文には声の URL を添える（間に合ったときだけ）。決まった文には添えない（端末が id で頼む）", async () => {
    await quake();
    await signal(1);
    const f = fake(() => ({ topic: "canMove", preface: "", question: "じぶんで たてますか", done: false }));
    const seen: string[] = [];
    const voice = async (text: string) => {
      seen.push(text);
      return "/api/signals/voice?talk=0123456789abcdef0123456789abcdef";
    };
    const res = await talkPost(db, selfP, sid(1), { log: logOf([[TALK_OPENING, "あしが いたい"]]) }, { ...deps(f.client), voice });
    expect(((await res.json()) as { reply: unknown }).reply).toMatchObject({
      kind: "ask",
      line: { by: "ai", voice: "/api/signals/voice?talk=0123456789abcdef0123456789abcdef" },
    });
    expect(seen).toEqual(["じぶんで たてますか"]);
    const fixed = await talkPost(db, selfP, sid(1), { log: logOf([[TALK_OPENING, "あしが いたい"]]) }, { ...deps(), voice, ai: async () => ({ env: {}, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind } }) });
    expect(((await fixed.json()) as { reply: { line: { voice: string } } }).reply.line.voice).toBe("/api/signals/voice?fixed=topic-injured");
    expect(seen).toHaveLength(1);
  });

  it("鍵が無い事業所・危ない言葉は Claude を呼ばない（決まった問い・締め）", async () => {
    await quake();
    await signal(1);
    const none = await talkPost(db, selfP, sid(1), { log: logOf([[TALK_OPENING, "あしが いたい"]]) }, {
      ai: async () => ({ env: {}, usage: d1UsageStore(db), office: { id: DEMO.id, kind: DEMO.kind } }),
      now: () => QUAKE + 3_700_000,
    });
    expect(((await none.json()) as { reply: unknown }).reply).toMatchObject({ kind: "ask", called: false, error: "not_configured", line: { by: "fixed", topic: "injured" } });
    const danger = await post(selfP, sid(1), logOf([[TALK_OPENING, "みずが はいって きた"]]));
    expect(danger.body.reply).toEqual({ kind: "danger", danger: "water", called: false });
    expect(aiRows()).toEqual([]);
  });
});

// ---------- 録音に添える会話 ----------

function form(values: Record<string, string | Blob>): FormLike {
  return { get: (name) => (name in values ? (values[name] as FormDataEntryValue) : null) };
}

describe("録音に添える会話と分類", () => {
  it("録音と一緒に会話の記録を書く。会話だけ（音声も文字も無い）でも書く。形の違う会話は 400", async () => {
    await quake();
    await signal(1);
    await signal(2);
    const log = { ...logOf([[TALK_OPENING, null], [fixedLine("injured"), "うー"]]), unclear: true, end: "unclear" as const };
    const only = await recordingPost(db, { put: async () => undefined } as never, selfP, form({ signal: sid(1), recordedAt: atH(1.1), sentAt: atH(1.1), talk: JSON.stringify(log) }), atH(1.1));
    expect(only.status).toBe(200);
    expect(readTalkLog(row(sid(1)).talk)).toMatchObject({ unclear: true, end: "unclear" });
    expect(row(sid(1)).recording_key).toBeNull();
    const bad = await recordingPost(db, { put: async () => undefined } as never, selfP, form({ signal: sid(2), recordedAt: atH(1.1), sentAt: atH(1.1), transcript: "はい", talk: "{\"v\":2}" }), atH(1.1));
    expect(bad.status).toBe(400);
  });

  it("分類に会話の問いと答えを手がかりとして渡す（伏せて）。分けた言葉の写しは本人の言葉からだけ", async () => {
    await quake();
    await signal(1);
    const log = { ...logOf([[TALK_OPENING, "いたい"], [fixedLine("canMove"), "うごけない"]]), end: "grasped" as const };
    let afterAttach = false;
    const res = await recordingPost(
      db,
      { put: async () => undefined } as never,
      selfP,
      form({ signal: sid(1), recordedAt: atH(1.1), sentAt: atH(1.1), transcript: "いたい\nうごけない", talk: JSON.stringify(log) }),
      atH(1.1),
      { afterAttach: () => (afterAttach = true) },
    );
    expect(res.status).toBe(200);
    expect(afterAttach).toBe(true);
    const f = fake(() => ({ categories: ["immobile"], confidence: 0.9, quote: "うごけない" }));
    await classifySignal(db, { officeId: DEMO.id, personId: "p-01", signalId: sid(1) }, { ai: deps(f.client).ai, now: () => atH(1.2) });
    const sent = JSON.parse(f.calls[0].messages[0].content as string) as Record<string, { text: string }>;
    expect(sent.会話.text).toContain("問: 動けますか\n答: うごけない");
    expect(sent.文字起こし.text).toBe("いたい\nうごけない");
    expect(row(sid(1)).classes).toBe(JSON.stringify(["immobile"]));
  });
});

// ---------- ケアマネの画面 ----------

describe("ケアマネの行の詳細の会話の欄", () => {
  it("問いと答えを全部。AI の問いに AI の印、決まった問いは印なし。応答不明瞭・終わり方・取れた答え。状態の色を使わない", () => {
    const log: TalkLog = {
      ...logOf([
        [TALK_OPENING, null],
        [{ text: "どこか いたい ところは ありますか", question: "どこか いたい ところは ありますか", easy: null, by: "ai", topic: "injured" }, "うー"],
      ]),
      unclear: true,
      end: "unclear",
      aiCalls: 1,
    };
    log.turns.push({ ask: "けがはありますか。はいならみどり、いいえならあかをおしてください", by: "fixed", topic: "injured", reply: null, heard: "press", answer: { id: "injured", choice: "yes" }, at: atH(1.05) });
    const html = renderToStaticMarkup(createElement(Talk, { log }));
    expect(html).toContain('data-talk-mark="unclear"');
    expect(html).toContain("応答不明瞭");
    expect(html).toContain("終了 ボタン回答");
    expect(html).toContain("無音");
    expect(html).toContain("取得 けが あり");
    expect((html.match(/data-ai="item"/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/tone-urgent|tone-check|state-urgent|state-check/);
  });

  it("担当一覧の行の詳細の安否の行に会話が載る（SELECT * の列）。色と理由は会話で変わらない", async () => {
    await quake();
    await signal(1);
    const scope = { officeId: DEMO.id, careManagerId: "acct-yamamoto" };
    const yamada = async () => (await loadCaseload(db, scope, "2026-11-04", atH(1.2)))!.rows.find((r) => r.id === "p-01")!;
    const before = await yamada();
    const log = { ...logOf([[TALK_OPENING, null], [fixedLine("injured"), null]]), unclear: true, end: "unclear" as const };
    await recordingPost(db, { put: async () => undefined } as never, selfP, form({ signal: sid(1), recordedAt: atH(1.1), sentAt: atH(1.1), talk: JSON.stringify(log) }), atH(1.1));
    const after = await yamada();
    expect(JSON.stringify(after.triage)).toBe(JSON.stringify(before.triage));
    expect(after.detail?.signals.find((s) => s.id === sid(1))?.talk).toMatchObject({ unclear: true, end: "unclear" });
  });
});
