// 録音と自由文の分類（docs/tasks/T12.md）。本物の API は呼ばない（偽の client が決まった JSON を返す）。
// 5 つの分類、低い確信 → 不明、未設定・上限・断られた・形の違い・失敗 → 分類なし、仮名化を通らない入力は型と実行時で止まる、
// 送った物に氏名・町名・電話が無い、信号の行への書き方、人の直しが優先、山田の「いたい、うごけない」→ 動けない → 一覧の一番上。

import Anthropic from "@anthropic-ai/sdk";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Classification, toggleClass } from "../../components/list/Classification.tsx";
import { SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload, sortCaseload } from "../caseload.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { RECORDING_CLASSES, type RecordingClass, type SignalRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { loadPersonPage, timelineItems } from "../person.ts";
import { pseudonymize, PseudonymLeakError, pseudonymizeText, type PseudonymInput } from "../pseudonym/index.ts";
import { NO_ANSWERS, type SignalBody } from "../signals/body.ts";
import { recordingPost, type AttachedRecording } from "../signals/http.ts";
import { saveSignal, signalScope } from "../signals/save.ts";
import { classify, factsText, normalizeClassification, quoteOf, sealClassifyInput, type ClassifyInput } from "./classify.ts";
import { classEditPost } from "./http.ts";
import { aiClassLogBody, CLASS_LABELS, classEditLogBody } from "./labels.ts";
import { CLASSIFY_SYSTEM } from "./prompt.ts";
import { classifySignal, normalizeEdit, saveClassEdit, type ClassifyDeps } from "./store.ts";
import { classViewOf, type ClassView, type SignalClassFields } from "./view.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 偽の Claude ----------

function reply(value: unknown, over: Partial<Message> = {}): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...over,
  } as unknown as Message;
}

function fake(answer: (p: Params) => Message | Promise<Message>) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return answer(params);
        },
      },
    },
  };
  return { client, calls };
}

const says = (categories: RecordingClass[], confidence = 0.9, quote = "") => () => reply({ categories, confidence, quote });

// ---------- D1（node:sqlite に種の 10 人） ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };

function aiCtx(claude?: ClaudeClient, env: AskJsonContext["env"] = { ANTHROPIC_API_KEY: "dummy" }): AskJsonContext {
  return {
    env,
    usage: d1UsageStore(db),
    office: { id: DEMO.id, kind: DEMO.kind },
    now: () => new Date("2026-11-04T01:30:00.000Z"),
    claude,
  };
}

const aiRows = () => sqlite.prepare("SELECT purpose, model, status, error FROM ai_calls").all() as Array<Record<string, unknown>>;

// 山田 ハナ（p-01）の鍵。娘は森 恵子、隣人は木村 ヨシ、町名はかわなぎ町
const yamada = SEED_PEOPLE[0];
const yamadaInput: PseudonymInput = {
  person: yamada.person,
  ledger: yamada.ledger,
  contacts: yamada.contacts,
  clocks: yamada.clocks,
  consents: seedConsents(yamada),
};
const { key } = pseudonymize([yamadaInput], { on: "2026-11-04" });
const seal = (transcript: string | null, answers: SignalBody["answers"] | null = NO_ANSWERS) =>
  sealClassifyInput({ transcript, answers, audio: { durationSec: 30, silenceRatio: null } }, key);

// ---------- 本人のスマホの信号 ----------

const self: Principal = {
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
const caseloadScope = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

async function earthquake() {
  const r = await switchDisasterMode(db, disasterScope(careManager)!, { kind: "earthquake", version: 0, at: at(0) });
  expect(r).toEqual({ ok: true, changed: true });
}

let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** 答えのない赤（20 秒で音声に替わった）を送り、録音と文字起こしを添える。添えたときの hook の引数を返す */
async function redWithRecording(transcript: string | null, audio = true): Promise<AttachedRecording> {
  const id = newId();
  const s = signalScope(self)!;
  const saved = await saveSignal(db, s, { id, color: "red", whereNow: null, answers: { ...NO_ANSWERS }, occurredAt: at(1), sentAt: at(1) }, at(1));
  expect(saved.ok).toBe(true);
  const form = new FormData();
  form.set("signal", id);
  form.set("recordedAt", at(1.01));
  form.set("sentAt", at(1.01));
  form.set("durationSec", "30");
  if (transcript !== null) form.set("transcript", transcript);
  if (audio) form.set("audio", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }));
  const attached: AttachedRecording[] = [];
  const bucket = { put: async () => ({}) };
  const res = await recordingPost(db, bucket, self, form, at(1.02), { afterAttach: (a) => attached.push(a) });
  expect(res.status).toBe(200);
  expect(attached).toHaveLength(1);
  return attached[0];
}

function deps(claude?: ClaudeClient, env?: AskJsonContext["env"]): ClassifyDeps & { made: number } {
  const d = {
    made: 0,
    ai: async () => {
      d.made++;
      return aiCtx(claude, env);
    },
    now: () => at(1.03),
  };
  return d;
}

const target = (a: AttachedRecording) => ({ ...a, audio: { durationSec: a.durationSec, silenceRatio: null } });
const signalRow = (id: string) => sqlite.prepare("SELECT * FROM signals WHERE id = ?").get(id) as unknown as SignalRow;
const yamadaRow = async (h = 1.1) => {
  const data = await loadCaseload(db, caseloadScope, "2026-11-04", at(h));
  return { row: data!.rows.find((r) => r.id === "p-01")!, top: sortCaseload(data!.rows, "tier")[0] };
};

// ---------- テスト ----------

describe("分ける本体（classify）", () => {
  it("6 つの分類を固定の応答で。確信と引用も返り、Haiku の classify で 1 回", async () => {
    const quotes: Record<RecordingClass, [string, string]> = {
      injury: ["あしから ちが でてる", "ちが でてる"],
      immobile: ["いたい、うごけない", "うごけない"],
      water: ["ゆかまで みずが きた", "みずが きた"],
      device_stopped: ["さんその きかいが とまった", "きかいが とまった"],
      other: ["たべものが ない", "たべものが ない"],
      unknown: ["うう……", ""],
    };
    for (const c of RECORDING_CLASSES) {
      const [text, quote] = quotes[c];
      const { client, calls } = fake(says([c], 0.9, quote));
      const r = await classify(seal(text), aiCtx(client));
      expect(r, c).toMatchObject({ ok: true, model: HAIKU, value: { categories: [c], confidence: 0.9, quote } });
      expect(calls[0].model).toBe(HAIKU);
      // ほかの用途は high だが、分類は録音の応答のあとの 30 秒に収めるため low のまま（T67）
      expect(calls[0].output_config?.effort).toBe("low");
    }
    expect(aiRows()).toHaveLength(RECORDING_CLASSES.length);
    expect(aiRows().every((r) => r.purpose === "classify" && r.status === "ok")).toBe(true);
  });

  it("確信が 0.6 未満なら不明。不明はほかと一緒にしない。空・範囲の外の確信も直す", () => {
    const text = "いたい、うごけない";
    expect(normalizeClassification({ categories: ["immobile"], confidence: 0.4, quote: "うごけない" }, text)).toMatchObject({
      categories: ["unknown"],
      confidence: 0.4,
      quote: "うごけない",
    });
    expect(normalizeClassification({ categories: ["immobile"], confidence: 0.6, quote: "" }, text).categories).toEqual(["immobile"]);
    expect(normalizeClassification({ categories: ["unknown", "injury", "immobile", "injury"], confidence: 0.8, quote: "" }, text).categories).toEqual([
      "injury",
      "immobile",
    ]);
    expect(normalizeClassification({ categories: [], confidence: 0.9, quote: "" }, text).categories).toEqual(["unknown"]);
    expect(normalizeClassification({ categories: ["water"], confidence: 1.4, quote: "" }, text).confidence).toBe(1);
    expect(normalizeClassification({ categories: ["water"], confidence: -0.2, quote: "" }, text)).toMatchObject({
      categories: ["unknown"],
      confidence: 0,
    });
  });

  it("低い確信の応答も不明（呼び出しを通して）", async () => {
    const { client } = fake(says(["injury", "immobile"], 0.35, "いたい"));
    const r = await classify(seal("いたい、うごけない"), aiCtx(client));
    expect(r).toMatchObject({ ok: true, value: { categories: ["unknown"], confidence: 0.35 } });
  });

  it("引用は文字起こしに無ければ捨て、10 字に切り、かぎ括弧を外す", () => {
    const text = "あしが いたくて たてない。だれか きて ください";
    expect(quoteOf("いたくて たてない", text)).toBe("いたくて たてない");
    expect(quoteOf("「たてない」", text)).toBe("たてない");
    expect(quoteOf("あしが いたくて たてない。", text)).toBe("あしが いたくて た");
    expect(Array.from(quoteOf("あしが いたくて たてない。", text))).toHaveLength(10);
    expect(quoteOf("骨が折れた", text)).toBe("");
    expect(quoteOf("  ", text)).toBe("");
  });

  it("AI 未設定・上限・断られた・形の違い・失敗は投げずに理由。未設定は数えない", async () => {
    // 差し替えの client を渡さないときは env の鍵で作る（鍵が無ければ呼ばない）
    expect(await classify(seal("みずが きた"), aiCtx(undefined, {}))).toEqual({ ok: false, error: "not_configured" });
    expect(await classify(seal("みずが きた"), aiCtx(undefined, { ANTHROPIC_API_KEY: "  " }))).toEqual({ ok: false, error: "not_configured" });
    expect(aiRows()).toHaveLength(0);

    const { client, calls } = fake(says(["water"]));

    expect(await classify(seal("みずが きた"), aiCtx(client, { ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }))).toEqual({
      ok: false,
      error: "limit",
    });

    const refused = fake(() => reply("", { stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: null } } as never));
    expect(await classify(seal("みずが きた"), aiCtx(refused.client))).toEqual({ ok: false, error: "refused" });

    const japanese = fake(() => reply({ categories: ["水が来た"], confidence: 0.9, quote: "" }));
    expect(await classify(seal("みずが きた"), aiCtx(japanese.client))).toEqual({ ok: false, error: "bad_output" });

    const notJson = fake(() => reply("水が来た"));
    expect(await classify(seal("みずが きた"), aiCtx(notJson.client))).toEqual({ ok: false, error: "bad_output" });

    const down = fake(() => {
      throw new Error("つながらない");
    });
    expect(await classify(seal("みずが きた"), aiCtx(down.client))).toEqual({ ok: false, error: "failed" });

    expect(aiRows().map((r) => r.error)).toEqual(["refused", "bad_output", "bad_output", "api_error"]);
  });

  it("文字起こしが無ければ呼ばない（不明。うめき声・黙っているも不明）", async () => {
    const { client, calls } = fake(says(["water"]));
    expect(await classify(seal(null), aiCtx(client))).toEqual({ ok: false, error: "no_text" });
    expect(await classify(seal("   "), aiCtx(client))).toEqual({ ok: false, error: "no_text" });

  });

  it("送る物は伏せた文字起こしと答えだけ。氏名・町名・電話・台帳を渡さない", async () => {
    const { client, calls } = fake(says(["immobile"], 0.9, "（町名）の家で"));
    const text = "娘の森 恵子さんに 090-0000-0011 で電話して。かわなぎ町の家で うごけない";
    const r = await classify(seal(text, { ...NO_ANSWERS, canMove: false }), aiCtx(client));
    expect(r).toMatchObject({ ok: true, value: { categories: ["immobile"], quote: "（町名）の家で" } });

    const sent = JSON.stringify(calls[0].messages);
    for (const secret of ["森", "恵子", "山田", "ハナ", "かわなぎ", "090-0000-0011", "0900000011", "1942-04-18", "木村", "ワーファリン"]) {
      expect(sent, secret).not.toContain(secret);
    }
    expect(sent).toContain("娘");
    expect(sent).toContain("（町名）");
    expect(sent).toContain("（電話）");
    expect(sent).toContain("動けない");
    // 指示は共通の指示と分類の指示だけ（本人の値を入れない）
    expect(calls[0].system).toEqual([
      { type: "text", text: expect.any(String) },
      { type: "text", text: CLASSIFY_SYSTEM },
    ]);
    expect(CLASSIFY_SYSTEM).toContain("0.6 未満");
    expect(CLASSIFY_SYSTEM).toContain("助言");
  });

  it("仮名化を通らない入力は型で通らず、実行時にも止まる（理由にしないで投げる）", async () => {
    const { client, calls } = fake(says(["water"]));
    const facts = seal("x").facts;
    // @ts-expect-error 素の文は渡せない（lib/pseudonym の pseudonymizeText を通した物だけ）
    const raw: ClassifyInput = { text: { text: "山田さんの家に水が来た" }, facts };
    await expect(classify(raw, aiCtx(client))).rejects.toThrow("仮名化の層");
    // @ts-expect-error 文字列そのものも渡せない
    const str: ClassifyInput = { text: "山田さんの家に水が来た", facts };
    await expect(classify(str, aiCtx(client))).rejects.toThrow();

  });

  it("伏せたあとに元の情報が残る文は送らない（電話の数字が長い数字の並びの中にある）", () => {
    // 生年月日はどの書き方でも（生年月日）に伏せる（T118）。伏せきれない物の例は電話の数字を含む長い並び
    expect(() => seal("09000000012345 にかけて")).toThrow(PseudonymLeakError);
  });

  it("答えと音の文は決まった言葉だけ", () => {
    expect(factsText({ injured: true, atHome: null, canMove: false, hasMedicine: true }, { durationSec: 30, silenceRatio: 0.42 })).toBe(
      "けが あり・自宅 未回答・動けない・薬 あり。録音 30 秒・無音 42%",
    );
    expect(factsText(null, null)).toBe("答えなし。音の特徴なし");
    expect(pseudonymizeText(factsText(NO_ANSWERS, null), key).text).toBe(factsText(NO_ANSWERS, null));
  });
});

describe("信号の行に書く（classifySignal）", () => {
  it("山田の「いたい、うごけない」→ 動けない（0.9）→ 赤の理由に「録音の分類（AI）: 動けない」を添える（順は動かさない。案 10）", async () => {
    await earthquake();
    const a = await redWithRecording("いたい、うごけない");
    const before = await yamadaRow();
    expect(before.row.triage).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });

    const { client, calls } = fake(says(["immobile"], 0.9, "うごけない"));
    const d = deps(client);
    const out = await classifySignal(db, target(a), d);
    expect(out).toMatchObject({
      status: "classified",
      result: { ok: true, value: { categories: ["immobile"], confidence: 0.9, quote: "うごけない" } },
      view: { kind: "ai", classes: ["immobile"], confidence: 0.9, quote: "うごけない", model: HAIKU },
    });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].messages)).toContain("録音 30 秒");

    expect(signalRow(a.signalId)).toMatchObject({
      classes: '["immobile"]',
      classified_by: "claude",
      ai_classes: '["immobile"]',
      ai_confidence: 0.9,
      ai_quote: "うごけない",
      ai_model: HAIKU,
      ai_error: null,
      ai_at: at(1.03),
    });

    const after = await yamadaRow();
    expect(after.row.triage).toMatchObject({ color: "red", rule: "red", group: 1, reason: "本人が「無事じゃない」、録音の分類（AI）: 動けない" });
    expect(after.top.id).toBe("p-01");

    // 経過に AI の 1 行（書き手は自動）
    const page = await loadPersonPage(db, careManager, "p-01");
    const items = timelineItems(page!);
    expect(items.some((t) => t.body === "録音の分類（AI）: 動けない 確信 90%「うごけない」" && t.who.startsWith("自動"))).toBe(true);
  });

  it("2 回目は何もしない（呼ばない・経過を重ねない）", async () => {
    await earthquake();
    const a = await redWithRecording("いたい、うごけない");
    const { client, calls } = fake(says(["immobile"]));
    await classifySignal(db, target(a), deps(client));
    expect(await classifySignal(db, target(a), deps(client))).toEqual({ status: "skipped" });
    expect(calls).toHaveLength(1);
    const logs = sqlite.prepare("SELECT count(*) AS n FROM timeline_entries WHERE json_extract(payload, '$.source') = 'classify'").get() as {
      n: number;
    };
    expect(logs.n).toBe(1);
  });

  it("AI 未設定は不明のまま: classes は空、理由を信号に残し、色は答えだけ", async () => {
    await earthquake();
    const a = await redWithRecording("いたい、うごけない");
    const out = await classifySignal(db, target(a), deps(undefined, {}));
    expect(out).toMatchObject({ status: "classified", result: { ok: false, error: "not_configured" }, view: { kind: "none", error: "not_configured" } });
    expect(signalRow(a.signalId)).toMatchObject({ classes: null, classified_by: null, ai_error: "not_configured", ai_classes: null });
    expect((await yamadaRow()).row.triage).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });
  });

  it("上限・低い確信・形の違いも理由か不明で残る", async () => {
    await earthquake();
    const a1 = await redWithRecording("いたい");
    const low = fake(says(["injury"], 0.3, "いたい"));
    await classifySignal(db, target(a1), deps(low.client));
    expect(signalRow(a1.signalId)).toMatchObject({ classes: '["unknown"]', classified_by: "claude", ai_confidence: 0.3 });
    expect((await yamadaRow()).row.triage).toMatchObject({ rule: "red" });

    const a2 = await redWithRecording("みず");
    await classifySignal(db, target(a2), deps(fake(says(["water"])).client, { ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "1" }));
    expect(signalRow(a2.signalId)).toMatchObject({ classes: null, ai_error: "limit" });
  });

  it("音声だけ（文字起こしなし）は呼ばずに「文字なし」、分類は「不明」（AI の印なし。T37）", async () => {
    await earthquake();
    const a = await redWithRecording(null);
    const d = deps(fake(says(["water"])).client);
    const out = await classifySignal(db, target(a), d);
    expect(out).toMatchObject({ result: { ok: false, error: "no_text" }, view: { kind: "none", error: "no_text" } });
    expect(d.made).toBe(0);
    expect(aiRows()).toHaveLength(0);
    // Claude の答えではないので classified_by・ai_classes は空のまま
    expect(signalRow(a.signalId)).toMatchObject({
      classes: '["unknown"]',
      classified_by: null,
      ai_classes: null,
      ai_error: "no_text",
    });
    // 不明は赤だけの組のまま（理由に AI の印を出さない）。経過に AI の行を足さない
    expect((await yamadaRow()).row.triage).toMatchObject({ color: "red", rule: "red", reason: "本人が「無事じゃない」" });
    const logs = sqlite.prepare("SELECT count(*) AS n FROM timeline_entries WHERE json_extract(payload, '$.source') = 'classify'").get() as {
      n: number;
    };
    expect(logs.n).toBe(0);
    // 2 回目は何もしない。人が直せば人の分類（直す前は AI の印なしの「不明」）
    expect(await classifySignal(db, target(a), d)).toEqual({ status: "skipped" });
  });

  it("空白だけの文字起こしも呼ばずに「不明」。人が先に直していれば上書きしない", async () => {
    await earthquake();
    const a = await redWithRecording("   ");
    await classifySignal(db, target(a), deps(fake(says(["water"])).client));
    expect(signalRow(a.signalId)).toMatchObject({ classes: '["unknown"]', classified_by: null });

    const b = await redWithRecording(null);
    sqlite.prepare(`UPDATE signals SET classes = '["injury"]', classified_by = 'care_manager' WHERE id = ?`).run(b.signalId);
    expect(await classifySignal(db, target(b), deps(fake(says(["water"])).client))).toEqual({ status: "skipped" });
    expect(signalRow(b.signalId)).toMatchObject({ classes: '["injury"]', classified_by: "care_manager" });
  });

  it("伏せきれない文字起こしは送らずに「送信不可」", async () => {
    await earthquake();
    const a = await redWithRecording("09000000012345 にかけて");
    const { client, calls } = fake(says(["water"]));
    const out = await classifySignal(db, target(a), deps(client));
    expect(out).toMatchObject({ result: { ok: false, error: "leak" } });

  });

  it("録音の hook は初めて添えたときだけ（送り直しでは呼ばない）", async () => {
    await earthquake();
    const a = await redWithRecording("いたい");
    const form = new FormData();
    form.set("signal", a.signalId);
    form.set("recordedAt", at(1.01));
    form.set("sentAt", at(1.05));
    form.set("transcript", "いたい");
    const again: AttachedRecording[] = [];
    const res = await recordingPost(db, { put: async () => ({}) }, self, form, at(1.06), { afterAttach: (x) => again.push(x) });
    expect(await res.json()).toMatchObject({ ok: true, duplicate: true });
    expect(again).toHaveLength(0);
    expect(a).toEqual({ officeId: "office-demo", personId: "p-01", signalId: a.signalId, durationSec: 30 });
  });

  it("別の事業所・別の本人の信号は分けない", async () => {
    await earthquake();
    const a = await redWithRecording("いたい");
    const { client, calls } = fake(says(["injury"]));
    expect(await classifySignal(db, { ...target(a), officeId: "office-partner" }, deps(client))).toEqual({ status: "not_found" });
    expect(await classifySignal(db, { ...target(a), personId: "p-02" }, deps(client))).toEqual({ status: "not_found" });

  });
});

describe("人の直し", () => {
  it("AI の分類を直すと人の分類が効き、経過に残り、AI の答えは残る", async () => {
    await earthquake();
    const a = await redWithRecording("いたい、うごけない");
    await classifySignal(db, target(a), deps(fake(says(["immobile"], 0.9, "うごけない")).client));

    const r = await saveClassEdit(db, { officeId: "office-demo", accountId: "acct-yamamoto", role: "care_manager" }, a.signalId, ["injury"], at(1.2));
    expect(r).toMatchObject({
      ok: true,
      changed: true,
      view: { kind: "human", classes: ["injury"], ai: { classes: ["immobile"], confidence: 0.9, quote: "うごけない" } },
    });
    expect(signalRow(a.signalId)).toMatchObject({ classes: '["injury"]', classified_by: "care_manager", ai_classes: '["immobile"]' });
    expect((await yamadaRow(1.3)).row.triage).toMatchObject({ rule: "red_injury", group: 0 });

    const page = await loadPersonPage(db, careManager, "p-01");
    expect(timelineItems(page!).some((t) => t.body === "分類修正 動けない（AI） → けが" && t.who.includes("山本"))).toBe(true);

    // 同じ分類をもう一度は何もしない
    const same = await saveClassEdit(db, { officeId: "office-demo", accountId: "acct-yamamoto", role: "care_manager" }, a.signalId, ["injury"], at(1.3));
    expect(same).toMatchObject({ ok: true, changed: false });
  });

  it("人が先に直していれば、あとから来た Claude の答えは classes を上書きしない（ai_* だけ残る）", async () => {
    await earthquake();
    const a = await redWithRecording("みずが きた");
    await saveClassEdit(db, { officeId: "office-demo", accountId: "acct-yamamoto", role: "care_manager" }, a.signalId, ["water"], at(1.02));
    const { client, calls } = fake(says(["immobile"]));
    expect(await classifySignal(db, target(a), deps(client))).toEqual({ status: "skipped" });

    expect(signalRow(a.signalId)).toMatchObject({ classes: '["water"]', classified_by: "care_manager", ai_classes: null });

    // 呼んでいる途中で人が直した（Claude の書き込みより人の直しが先に入った）
    const b = await redWithRecording("いたい");
    const slow = fake(async () => {
      await saveClassEdit(db, { officeId: "office-demo", accountId: "acct-yamamoto", role: "care_manager" }, b.signalId, ["unknown"], at(1.03));
      return says(["injury"], 0.8, "いたい")();
    });
    const out = await classifySignal(db, target(b), deps(slow.client));
    expect(out).toMatchObject({ view: { kind: "human", classes: ["unknown"], ai: { classes: ["injury"] } } });
    expect(signalRow(b.signalId)).toMatchObject({ classes: '["unknown"]', classified_by: "care_manager", ai_classes: '["injury"]' });
  });

  it("選び方の決まり: 不明はほかと一緒にしない、空は断る", () => {
    expect(normalizeEdit(["immobile", "injury", "injury"])).toEqual(["injury", "immobile"]);
    expect(normalizeEdit(["unknown", "water"])).toEqual(["water"]);
    expect(normalizeEdit(["unknown"])).toEqual(["unknown"]);
    expect(normalizeEdit([])).toBeNull();
    expect(toggleClass(["injury"], "unknown")).toEqual(["unknown"]);
    expect(toggleClass(["unknown"], "water")).toEqual(["water"]);
    expect(toggleClass(["water"], "injury")).toEqual(["injury", "water"]);
    expect(toggleClass(["injury", "water"], "injury")).toEqual(["water"]);
  });

  it("API: ケアマネだけ。本人・医療班は 403、ログインなしは 401、形の違いは 400、事業所の外は 404", async () => {
    await earthquake();
    const a = await redWithRecording("いたい");
    const body = { classes: ["injury"] };
    expect((await classEditPost(db, null, a.signalId, body, at(1.2))).status).toBe(401);
    expect((await classEditPost(db, self, a.signalId, body, at(1.2))).status).toBe(403);
    expect((await classEditPost(db, { ...careManager, role: "medical" }, a.signalId, body, at(1.2))).status).toBe(403);
    expect((await classEditPost(db, careManager, a.signalId, { classes: [] }, at(1.2))).status).toBe(400);
    expect((await classEditPost(db, careManager, a.signalId, { classes: ["けが"] }, at(1.2))).status).toBe(400);
    expect((await classEditPost(db, careManager, a.signalId, null, at(1.2))).status).toBe(400);
    const partner = { ...careManager, accountId: "acct-partner", office: { id: "office-partner", name: "協力事業所", kind: "regular" as const } };
    expect((await classEditPost(db, partner, a.signalId, body, at(1.2))).status).toBe(404);
    expect((await classEditPost(db, careManager, "no such id!", body, at(1.2))).status).toBe(404);
    expect(signalRow(a.signalId).classified_by).toBeNull();

    const ok = await classEditPost(db, careManager, a.signalId, body, at(1.2));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, changed: true, view: { kind: "human", classes: ["injury"], ai: null } });
  });
});

describe("画面の形と部品", () => {
  const base: SignalClassFields = {
    transcript: "いたい、うごけない",
    recording_key: "recordings/office-demo/p-01/x.webm",
    classes: null,
    classified_by: null,
    ai_classes: null,
    ai_confidence: null,
    ai_quote: null,
    ai_model: null,
    ai_error: null,
    ai_at: null,
  };
  const aiRow: SignalClassFields = {
    ...base,
    classes: '["immobile"]',
    classified_by: "claude",
    ai_classes: '["immobile"]',
    ai_confidence: 0.9,
    ai_quote: "うごけない",
    ai_model: HAIKU,
    ai_at: "2026-11-04T01:03:00.000Z",
  };

  it("状態: 出さない・未分類・分類なし・AI・人", () => {
    expect(classViewOf({ ...base, transcript: null, recording_key: null })).toEqual({ kind: "absent" });
    expect(classViewOf(base)).toEqual({ kind: "pending" });
    expect(classViewOf({ ...base, ai_error: "limit", ai_at: "x" })).toEqual({ kind: "none", error: "limit" });
    expect(classViewOf(aiRow)).toEqual({ kind: "ai", classes: ["immobile"], confidence: 0.9, quote: "うごけない", model: HAIKU });
    expect(classViewOf({ ...aiRow, classes: '["injury"]', classified_by: "care_manager" })).toEqual({
      kind: "human",
      classes: ["injury"],
      ai: { classes: ["immobile"], confidence: 0.9, quote: "うごけない", model: HAIKU },
    });
    // 文字なしの録音でも人は付けられる
    expect(classViewOf({ ...base, transcript: null, classes: '["water"]', classified_by: "care_manager", ai_error: "no_text" })).toMatchObject({
      kind: "human",
      classes: ["water"],
      ai: null,
    });
  });

  const html = (view: ClassView, editable = false) =>
    renderToStaticMarkup(createElement(Classification, { signalId: "s-1", view, editable }));
  const text = (h: string) => h.replace(/<[^>]+>/g, "");

  it("AI の分類は 分類・確信・引用と AI の印。色を付けない", () => {
    const h = html(classViewOf(aiRow), true);
    expect(text(h)).toContain("分類動けないAI確信 90%引用「うごけない」修正");
    expect(h).toContain('data-ai=""');
    expect(h).not.toMatch(/state-(urgent|ok|check|unknown)/);
  });

  it("分類なしは理由、人の分類は修正済と修正前の AI、出さない物は空", () => {
    expect(text(html({ kind: "none", error: "not_configured" }))).toBe("分類分類なしAI 未設定");
    // 文字の無い録音は「不明」（「文字なし」と出さない。AI の印も無い。T40）
    const silent = html({ kind: "none", error: "no_text" });
    expect(text(silent)).toBe("分類不明");
    expect(silent).not.toContain("data-ai");
    expect(text(html({ kind: "pending" }))).toBe("分類未分類");
    const human = html(classViewOf({ ...aiRow, classes: '["injury"]', classified_by: "care_manager" }));
    expect(text(human)).toContain("けが修正済修正前動けない");
    expect(human).toContain('data-ai="item"');
    expect(html({ kind: "absent" })).toBe("");
    // 直す口はケアマネだけ（editable）
    expect(text(html(classViewOf(aiRow)))).not.toContain("修正");
  });

  it("言葉: 診断・判定・重症と書かない。5 つの名前は CLAUDE.md のまま（T64 の その他 を不明の前に）", () => {
    const words = [
      ...Object.values(CLASS_LABELS),
      aiClassLogBody({ classes: ["injury", "immobile"], confidence: 0.85, quote: "いたい" }),
      classEditLogBody({ from: ["immobile"], fromBy: "claude", to: ["injury"] }),
      classEditLogBody({ from: null, fromBy: null, to: ["unknown"] }),
      CLASSIFY_SYSTEM,
      html(classViewOf(aiRow), true),
    ].join("\n");
    expect(words).not.toMatch(/判定|重症|病気がわかる/);
    expect(Object.values(CLASS_LABELS)).toEqual(["けが", "動けない", "水が来た", "機器が止まった", "その他", "不明"]);
    expect(aiClassLogBody({ classes: ["injury", "immobile"], confidence: 0.85, quote: "いたい" })).toBe(
      "録音の分類（AI）: けが・動けない 確信 85%「いたい」",
    );
    expect(classEditLogBody({ from: null, fromBy: null, to: ["unknown"] })).toBe("分類修正 分類なし → 不明");
  });
});

describe("聞き取りメモ（T49。分類と同じ 1 回の呼び出し）", () => {
  const memo = (over: Record<string, string | null> = {}) => ({
    place: null,
    trapped: null,
    body: null,
    injury: null,
    water: null,
    fireGas: null,
    device: null,
    medicine: null,
    nearby: null,
    contact: null,
    request: null,
    ...over,
  });

  it("欄は文字起こしからそのまま写した物だけ。無い言葉（言い換え・重さ）は捨て、30 字に切る。memo の無い返事は全部 null", () => {
    const text = "だいどころで たおれて、むねが すこし いたい。あしを うった";
    const v = normalizeClassification(
      {
        categories: ["injury"],
        confidence: 0.9,
        quote: "あしを うった",
        memo: memo({
          place: "だいどころ",
          body: "「むねが すこし いたい」",
          injury: "足の打撲（重い）",
          request: "あ".repeat(40),
        }),
      },
      text,
    );
    expect(v.memo).toEqual(memo({ place: "だいどころ", body: "むねが すこし いたい" }));
    expect(normalizeClassification({ categories: ["injury"], confidence: 0.9, quote: "" }, text).memo).toEqual(memo());
    const long = "た".repeat(40);
    expect(normalizeClassification({ categories: ["unknown"], confidence: 0.9, quote: "", memo: memo({ place: long }) }, long).memo.place).toHaveLength(30);
  });

  it("指示に memo の決まり（写すだけ・無ければ null・重さを書かない）。呼び出しは 1 回のまま", () => {
    expect(CLASSIFY_SYSTEM).toContain("memo");
    expect(CLASSIFY_SYSTEM).toContain("言い換えない");
    expect(CLASSIFY_SYSTEM).toContain("無い欄は null");
  });

  it("信号の行の ai_memo に書く。分類・色・理由は memo の無い時と同じ（メモは表に渡さない）", async () => {
    await earthquake();
    const a = await redWithRecording("むねが いたい、たんすに はさまれた");
    const plain = await redWithRecording("むねが いたい、たんすに はさまれた");
    const withMemo = () =>
      reply({ categories: ["immobile"], confidence: 0.9, quote: "はさまれた", memo: memo({ body: "むねが いたい", trapped: "たんすに はさまれた" }) });
    await classifySignal(db, target(a), deps(fake(withMemo).client));
    await classifySignal(db, target(plain), deps(fake(says(["immobile"], 0.9, "はさまれた")).client));

    expect(JSON.parse(signalRow(a.signalId).ai_memo!)).toMatchObject({ body: "むねが いたい", trapped: "たんすに はさまれた" });
    expect(signalRow(plain.signalId).ai_memo).toBeNull();
    const pick = (r: SignalRow) => ({ classes: r.classes, classified_by: r.classified_by, injured: r.injured, can_move: r.can_move });
    expect(pick(signalRow(a.signalId))).toEqual(pick(signalRow(plain.signalId)));
    expect((await yamadaRow()).row.triage).toMatchObject({ color: "red", rule: "red" });
  });
});
