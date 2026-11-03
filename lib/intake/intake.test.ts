// 入れる欄（T03）のテスト。本物の API は呼ばない（偽の client を渡し、Claude の応答は固定の JSON）。
import Anthropic from "@anthropic-ai/sdk";
import type { D1Database } from "@cloudflare/workers-types";
import type { DatabaseSync } from "node:sqlite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { IntakeChanges, rowsOf, type ChangeRow } from "../../components/person/IntakeChanges.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import { askJson, type AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { AiBadOutput, AiCallFailed, AiLimitReached, AiNotConfigured, AiRefused } from "../claude/errors.ts";
import { SONNET } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { applyLedgerChanges, parseLedger } from "../db/ledger.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import type { Ledger } from "../db/types.ts";
import { loadPersonPage, toPersonView, type PersonPageRows } from "../person.ts";
import { pseudonymize, pseudonymizeText } from "../pseudonym/index.ts";
import { answerChanges } from "./answer.ts";
import { FIELD_QUESTIONS, GENERATED_QUESTIONS, NOT_ASKED, nextQuestion, questionQueue } from "./ask.ts";
import type { IntakeChange } from "./changes.ts";
import { buildDiff, restoreNote, sentencesOf } from "./diff.ts";
import { buildExtractRequest, EXTRACT_SYSTEM, extractIntake, pseudonymInputOf } from "./extract.ts";
import { INTAKE_FIELDS, ledgerValue as ledgerValueOf } from "./fields.ts";
import { manualChanges } from "./manual.ts";
import { aiFailReasonOf, intakeErrorOf } from "./http.ts";
import { AI_FAIL_REASON_LABELS } from "../labels.ts";
import { markPreview, planMarkClocks } from "./marks.ts";
import { saveIntake, timelineBody, type SaveRequest } from "./save.ts";
import type { ExtractOutput } from "./schema.ts";
import { sectionOfField } from "../person.ts";

const TODAY = "2026-11-02";
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

function seedRows(p: SeedPerson, ledger: Ledger = p.ledger): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

/** T03 の終わりの形の文（〇〇 はそのまま） */
const SATO_TEXT = "88 歳、独居、認知症で民生委員の〇〇さんが週 2 回来る。土砂の区域";

/** 佐藤 キミに上の文を入れたときの、Claude の応答の代わり（固定の JSON） */
const SATO_OUTPUT: ExtractOutput = {
  items: [
    { field: "basic.household", value: "alone" },
    { field: "care.dementia", value: "true" },
    { field: "medical.history", value: "認知症" },
    { field: "basic.contactMeans.smartphone", value: "持っていない" }, // 選択肢に無い → 捨てる
  ],
  medications: [],
  devices: [],
  hazards: [{ kind: "landslide", depth_m: "" }],
  contacts: [{ kind: "welfare_commissioner", relation: "", night: "unknown", note: "週 2 回来る" }],
  notes: ["88 歳、独居、認知症で民生委員の〇〇さんが週 2 回来る。"],
  unknowns: [],
};

type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: SONNET,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fakeClaude(value: unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: { messages: { create: async (params) => (calls.push(params), reply(value)) } },
  };
  return { client, calls };
}

function aiCtx(env: AskJsonContext["env"], claude?: ClaudeClient) {
  const db = migratedSqlite();
  db.exec("INSERT INTO offices (id, name, kind, city) VALUES ('office-demo', 'デモ事業所', 'demo', '松山市')");
  const ctx: AskJsonContext = {
    env,
    usage: d1UsageStore(d1FromSqlite(db)),
    office: { id: "office-demo", kind: "demo" },
    now: () => new Date("2026-11-02T03:00:00.000Z"),
    claude,
  };
  const calls = () => db.prepare("SELECT purpose, model, status, error FROM ai_calls").all() as Array<{ purpose: string; model: string; status: string; error: string | null }>;
  return { ctx, calls };
}

const restoreIdentity = { text: (s: string) => s, note: (s: string) => s };

// ---------- 差分の当て方 ----------

describe("差分の当て方（lib/db/ledger.ts の applyLedgerChanges）", () => {
  const sato = seed("p-04").ledger;

  it("埋まっている欄は上書きしない。人が既入力を選んだ（overwrite）ときだけ変える", () => {
    const r = applyLedgerChanges(sato, [
      { t: "field", key: "basic.household", value: "with_child" },
      { t: "field", key: "care.careLevel", value: "care3" },
      { t: "field", key: "basic.housing.bedroom", value: "1 階 奥の和室" },
    ]);
    expect(r.ledger.basic.household).toBe("alone");
    expect(r.ledger.care.careLevel).toBe("care2");
    expect(r.ledger.basic.housing?.bedroom).toBe("1 階 奥の和室");
    expect(r.ledger.basic.housing?.floor).toBe(1);
    expect(r.fields).toEqual(["basic.housing.bedroom"]);
    expect(r.skipped).toBe(2);
    // 元の台帳は変えない
    expect(sato.basic.housing?.bedroom).toBeUndefined();

    const over = applyLedgerChanges(sato, [{ t: "field", key: "basic.household", value: "with_child", overwrite: true }]);
    expect(over.ledger.basic.household).toBe("with_child");
  });

  it("形の合わない値（選択肢に無い・欄の表に無い）は当てない", () => {
    const r = applyLedgerChanges(sato, [
      { t: "field", key: "basic.sex", value: "女性ではない何か" },
      { t: "field", key: "people.night_supporter", value: "娘" },
    ]);
    expect(r.ledger).toEqual(sato);
    expect(r.skipped).toBe(2);
  });

  it("配列の欄は無い物だけ足す。薬は同じ名前なら空いた所だけ、新しい薬は区分から中断注意の印", () => {
    const base: Ledger = { ...sato, medical: { ...sato.medical, allergies: ["卵"] } };
    const r = applyLedgerChanges(base, [
      { t: "field", key: "medical.allergies", value: ["卵", "そば"] },
      { t: "medication", value: { name: "抗認知症薬", category: "other", schedule: "1 日 3 回", amount: "1 錠", storage: "台所の棚" } },
      { t: "medication", value: { name: "ワーファリン", category: "anticoagulant", schedule: "朝" } },
    ]);
    expect(r.ledger.medical.allergies).toEqual(["卵", "そば"]);
    const [dementiaMed, warfarin] = r.ledger.medical.medications;
    expect(dementiaMed).toEqual({ name: "抗認知症薬", category: "other", schedule: "1 日 1 回", amount: "1 錠", storage: "台所の棚" });
    expect(warfarin).toEqual({ name: "ワーファリン", category: "anticoagulant", schedule: "朝", interruptionRisk: true });
  });

  it("値の入った欄の未確認は消え、分からない・答えないは pending に残る。埋まった欄には付けない", () => {
    const base: Ledger = {
      ...sato,
      pending: [
        { field: "basic.housing.bedroom", status: "not_asked" },
        { field: "medical.medications.warfarin.remaining", status: "unknown" },
      ],
    };
    const r = applyLedgerChanges(base, [
      { t: "field", key: "basic.housing.bedroom", value: "2 階" },
      { t: "medication", value: { name: "新しい薬", category: "other" } },
      { t: "pending", field: "local.watcher", status: "declined" },
      { t: "pending", field: "basic.household", status: "unknown" },
    ]);
    expect(r.ledger.pending).toEqual([
      // 薬を足しても、ほかの薬の残りの未確認は残る
      { field: "medical.medications.warfarin.remaining", status: "unknown" },
      { field: "local.watcher", status: "declined" },
    ]);
  });
});

// ---------- 分け方 → 差分 ----------

describe("Claude の分け方を差分にする（lib/intake/diff.ts）", () => {
  const rows = seedRows(seed("p-04"));
  const input = { ledger: parseLedger(rows.person.ledger), contacts: rows.contacts };

  it("佐藤 キミ: 基本・人・避難・医療に分かれ、今と同じ所は一致、空いた所は追加、選択肢に無い値は捨てる", () => {
    const { items, dropped } = buildDiff(input, SATO_OUTPUT, restoreIdentity);
    expect(dropped).toBe(1);
    expect(new Set(items.map((i) => i.section))).toEqual(new Set(["basic", "people", "evacuation", "medical"]));
    const by = (label: string) => items.find((i) => i.label === label)!;
    expect(by("世帯")).toMatchObject({ state: "same", current: "独居", next: "独居", change: null });
    expect(by("認知症")).toMatchObject({ state: "same", next: "あり" });
    expect(by("ハザード")).toMatchObject({ state: "same", next: "土砂" });
    expect(by("既往")).toMatchObject({ state: "add", current: null, next: "認知症", change: { t: "field", key: "medical.history", value: ["認知症"] } });
    expect(by("民生委員")).toMatchObject({
      state: "add",
      section: "people",
      change: { t: "contact", id: "c-04-1", value: { kind: "welfare_commissioner", note: "週 2 回来る" } },
    });
    expect(by("民生委員").current).toContain("清水 正子");
    expect(by("特記")).toMatchObject({ state: "add", section: "basic", change: { t: "note" } });
  });

  it("今と違う値は既入力（保存の既定では外す。選べば上書き）", () => {
    const out: ExtractOutput = { ...SATO_OUTPUT, items: [{ field: "care.careLevel", value: "care3" }], hazards: [], contacts: [], notes: [] };
    const [item] = buildDiff(input, out, restoreIdentity).items;
    expect(item).toMatchObject({ state: "filled", current: "要介護2", next: "要介護3", change: { overwrite: true } });
  });

  it("伏せ字が残る値には印。分からない・答えないは空いた欄にだけ", () => {
    const out: ExtractOutput = {
      ...SATO_OUTPUT,
      items: [{ field: "evacuation.destination1", value: "（町名）集会所" }],
      hazards: [],
      contacts: [],
      notes: [],
      unknowns: [
        { field: "basic.housing.bedroom", status: "unknown" },
        { field: "basic.household", status: "declined" },
      ],
    };
    const items = buildDiff(input, out, restoreIdentity).items;
    expect(items.find((i) => i.label === "避難先1")?.masked).toBe(true);
    expect(items.filter((i) => i.change?.t === "pending").map((i) => [i.label, i.next])).toEqual([["寝室", "不明"]]);
  });

  it("新しい連絡先は名前と電話なしで追加（人が入れる）。薬・機器は台帳に無ければ追加", () => {
    const out: ExtractOutput = {
      ...SATO_OUTPUT,
      items: [],
      hazards: [],
      notes: [],
      contacts: [{ kind: "family", relation: "娘", night: "yes", note: "" }],
      medications: [{ name: "ワーファリン", category: "anticoagulant", schedule: "1 日 1 回", amount: "", storage: "" }],
      devices: [{ kind: "oxygen", detail: "濃縮器", schedule: "" }],
    };
    const items = buildDiff(input, out, restoreIdentity).items;
    expect(items.find((i) => i.label === "家族")).toMatchObject({ state: "add", change: { t: "contact", id: null, value: { kind: "family", relation: "娘", nightOk: true } } });
    expect(items.find((i) => i.label === "薬")).toMatchObject({ state: "add", next: "ワーファリン 抗凝固薬 1 日 1 回" });
    expect(items.find((i) => i.label === "機器")).toMatchObject({ state: "add", next: "在宅酸素 濃縮器" });
  });

  it("特記は仮名化の前の同じ文に戻す（本人の言葉を言い換えない）", () => {
    const original = "娘の森 恵子さんが毎晩来る。薬は 2 階の箪笥\n夜は不安と言う";
    const scrubbed = "娘の娘が毎晩来る。薬は 2 階の箪笥\n夜は不安と言う";
    expect(sentencesOf(original)).toHaveLength(3);
    expect(restoreNote("娘の娘が毎晩来る。", original, scrubbed)).toBe("娘の森 恵子さんが毎晩来る。");
    expect(restoreNote("娘の娘が毎晩来る", original, scrubbed)).toBe("娘の森 恵子さんが毎晩来る。");
    expect(restoreNote("夜は不安と言う", original, scrubbed)).toBe("夜は不安と言う");
    // 文が合わなければそのまま（人が直す）
    expect(restoreNote("娘が来る", original, scrubbed)).toBe("娘が来る");
  });
});

// ---------- Claude を呼ぶ所 ----------

describe("分ける（lib/intake/extract.ts）", () => {
  it("Sonnet を 1 回呼び、仮名化した台帳と伏せた文だけを渡す。返事は差分になる", async () => {
    const { client, calls } = fakeClaude(SATO_OUTPUT);
    const { ctx, calls: aiCalls } = aiCtx({ ANTHROPIC_API_KEY: "dummy" }, client);
    const rows = seedRows(seed("p-04"));
    const p = await extractIntake(rows, `${SATO_TEXT}。清水 正子さんは くぬぎ谷町 に住む`, ctx, { today: TODAY });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe(SONNET);
    const sent = JSON.stringify(calls[0].messages);
    for (const secret of ["佐藤", "キミ", "清水", "正子", "くぬぎ谷", "1938-03-05", "090-0000-0004"]) expect(sent).not.toContain(secret);
    expect(sent).toContain("民生委員");
    expect(sent).toContain("（町名）");
    expect(aiCalls()).toEqual([{ purpose: "ledger_input", model: SONNET, status: "ok", error: null }]);
    expect(p.ai.model).toBe(SONNET);
    expect(p.items.map((i) => i.label)).toContain("既往");
    // 特記は入力の文に戻る
    expect(p.items.find((i) => i.label === "特記")?.next).toBe("88 歳、独居、認知症で民生委員の〇〇さんが週 2 回来る。");
  });

  it("system に決まり（埋まった欄は変えない・言い換えない・選択肢の値・医療依存を決めない）と欄の一覧", () => {
    expect(EXTRACT_SYSTEM).toContain("言い換えない");
    expect(EXTRACT_SYSTEM).toContain("今の台帳の値は変えない");
    expect(EXTRACT_SYSTEM).toContain("医療依存の度合い・優先・緊急度");
    for (const f of INTAKE_FIELDS) expect(EXTRACT_SYSTEM).toContain(`- ${f.key}:`);
    for (const bad of ["診断して", "判定して", "重症"]) expect(EXTRACT_SYSTEM).not.toContain(bad);
  });

  it("仮名化を通っていない入力は型で通らず、通しても askJson が止める", async () => {
    const rows = seedRows(seed("p-04"));
    const { payload, key } = pseudonymize([pseudonymInputOf(rows)], { on: TODAY });
    const sealed = pseudonymizeText(SATO_TEXT, key);
    expect(buildExtractRequest(payload, sealed, null).purpose).toBe("ledger_input");
    // @ts-expect-error 素の文字列は ForClaude でない
    const raw = buildExtractRequest(payload, { text: SATO_TEXT }, null);
    // @ts-expect-error 素の台帳は ForClaude でない
    buildExtractRequest([pseudonymInputOf(rows)], sealed, null);
    const { client, calls } = fakeClaude(SATO_OUTPUT);
    await expect(askJson(raw, aiCtx({ ANTHROPIC_API_KEY: "dummy" }, client).ctx)).rejects.toThrow("仮名化");
    expect(calls).toHaveLength(0);
  });

  it("AI 未設定（鍵なし）: 呼ばず、上限も減らさず、画面は「AI 未設定」", async () => {
    const { ctx, calls } = aiCtx({});
    const err = await extractIntake(seedRows(seed("p-04")), SATO_TEXT, ctx, { today: TODAY }).catch((e) => e);
    expect(err).toBeInstanceOf(AiNotConfigured);
    expect(calls()).toEqual([]);
    const res = intakeErrorOf(err)!;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "ai_not_configured", label: "AI 未設定" });
  });

  it("上限: 呼ばずに「上限到達」", async () => {
    const { client, calls } = fakeClaude(SATO_OUTPUT);
    const { ctx } = aiCtx({ ANTHROPIC_API_KEY: "dummy", AI_DAILY_LIMIT: "0" }, client);
    const err = await extractIntake(seedRows(seed("p-04")), SATO_TEXT, ctx, { today: TODAY }).catch((e) => e);
    expect(err).toBeInstanceOf(AiLimitReached);
    expect(calls).toHaveLength(0);
    expect(await intakeErrorOf(err)!.json()).toMatchObject({ label: "上限到達" });
  });

  it("AI 失敗は ai_calls の理由を返す（形が違う・切れた・断られた・時間切れ・API の失敗）。値と場所は返さない", async () => {
    const cases: Array<[unknown, number, string, string]> = [
      [new AiBadOutput("schema", ["items.0.value"]), 502, "ai_failed", "schema"],
      [new AiBadOutput("not_json"), 502, "ai_failed", "schema"],
      [new AiBadOutput("max_tokens"), 502, "ai_failed", "max_tokens"],
      [new AiRefused("cyber"), 422, "ai_refused", "refused"],
      [new AiCallFailed("timeout", new Error("x")), 502, "ai_failed", "timeout"],
      [new AiCallFailed("api_error", new Error("x")), 502, "ai_failed", "api_error"],
    ];
    for (const [err, status, error, reason] of cases) {
      const res = intakeErrorOf(err)!;
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body).toMatchObject({ ok: false, error, reason });
      expect(AI_FAIL_REASON_LABELS[reason as keyof typeof AI_FAIL_REASON_LABELS]).toBeTruthy();
      expect(JSON.stringify(body)).not.toContain("items.0");
    }
    // AI の返事の失敗でない物は理由を持たない
    expect(await intakeErrorOf(new AiNotConfigured("anthropic"))!.json()).not.toHaveProperty("reason");
    expect(aiFailReasonOf(new Error("x"))).toBeNull();
  });

  it("形の違う返事は ai_calls に bad_output で残り、画面には理由「形式相違」", async () => {
    const { client } = fakeClaude({ items: "形が違う" } as unknown as ExtractOutput);
    const { ctx, calls } = aiCtx({ ANTHROPIC_API_KEY: "dummy" }, client);
    const err = await extractIntake(seedRows(seed("p-04")), SATO_TEXT, ctx, { today: TODAY }).catch((e) => e);
    expect(err).toBeInstanceOf(AiBadOutput);
    expect(calls().map((c) => c.error)).toEqual(["bad_output"]);
    expect(await intakeErrorOf(err)!.json()).toMatchObject({ error: "ai_failed", reason: "schema" });
  });
});

// ---------- 問い ----------

describe("次の問い（lib/intake/ask.ts）", () => {
  it("佐藤 キミ: 医療依存（薬の残り・用量・保管）→ 夜間の支援者 → その他 の順", () => {
    const q = questionQueue(seedRows(seed("p-04")));
    expect(q[0]).toMatchObject({ group: "medical", label: "抗認知症薬 残り", answer: { kind: "clock", clockId: null, medIndex: 0 } });
    expect(q.slice(0, 3).map((x) => x.label)).toEqual(["抗認知症薬 残り", "抗認知症薬 用量", "抗認知症薬 保管"]);
    const groups = q.map((x) => x.group);
    const lastMedical = groups.lastIndexOf("medical");
    const firstNight = groups.indexOf("night");
    const firstOther = groups.indexOf("other");
    expect(lastMedical).toBeLessThan(firstNight);
    expect(firstNight).toBeLessThan(firstOther);
    expect(q[firstNight]).toMatchObject({ key: "people.night_supporter", text: GENERATED_QUESTIONS.night.text });
    // 埋まっている欄（世帯・認知症・介護度）は問わない
    expect(q.map((x) => x.key)).not.toContain("basic.household");
    expect(q.map((x) => x.key)).not.toContain("care.dementia");
    expect(q.map((x) => x.key)).toContain("basic.housing.bedroom");
  });

  it("山田 ハナ: 分からないと記録した欄（ワーファリンの残り・避難先2）は問わず、未聴取（夜間支援）は問う", () => {
    const q = questionQueue(seedRows(seed("p-01")));
    const keys = q.map((x) => x.key);
    expect(keys).not.toContain("medical.medications.warfarin.remaining");
    expect(keys).not.toContain("evacuation.destination2");
    expect(keys).toContain("people.night_supporter");
    // 値の空いた時計（骨格の段の上から）が先
    expect(q[0].group).toBe("medical");
  });

  it("この回で「次回」にした問いは飛ばす。空欄が無ければ null", () => {
    const q = questionQueue(seedRows(seed("p-04")));
    expect(nextQuestion(q, [q[0].key])?.key).toBe(q[1].key);
    expect(nextQuestion([], [])).toBeNull();
  });

  it("問いの文は定型で、Claude に渡す言葉（focus）に名前・台帳の値を入れない", () => {
    for (const p of SEED_PEOPLE) {
      for (const x of questionQueue(seedRows(p))) {
        expect(x.text.length, x.key).toBeGreaterThan(0);
        for (const m of p.ledger.medical.medications) expect(x.focus).not.toContain(m.name);
        for (const k of p.clocks) expect(x.focus).not.toContain(k.label);
      }
    }
  });

  it("欄の表の欄は、問わない欄のほか全部に問いの文（何を・なぜ・例）がある", () => {
    const asked = INTAKE_FIELDS.filter((f) => !NOT_ASKED.has(f.key)).map((f) => f.key);
    expect(asked.filter((k) => !FIELD_QUESTIONS[k])).toEqual([]);
    // 表に余分な欄（欄の表から消えた欄）を残さない
    expect(Object.keys(FIELD_QUESTIONS).filter((k) => !asked.includes(k))).toEqual([]);
  });

  it("全部の空欄の問いが 1 問で分かる文: 何を（。で終わる）・なぜ・例（「例: 」で始まる）。現場の言葉で書く", () => {
    // 種の 10 人と、台帳が空の人（全部の欄を問う）
    const empty = { ...seedRows(seed("p-04"), parseLedger("{}")), contacts: [] };
    const all = [...SEED_PEOPLE.map((p) => questionQueue(seedRows(p))), questionQueue(empty)].flat();
    expect(questionQueue(empty).length).toBeGreaterThanOrEqual(INTAKE_FIELDS.length - NOT_ASKED.size);
    for (const x of all) {
      expect(x.text, x.key).toMatch(/[。）]$/);
      expect(x.why, x.key).toMatch(/。$/);
      expect(x.why.length, x.key).toBeGreaterThan(8);
      expect(x.example, x.key).toMatch(/^例: \S/);
      for (const w of ["診断", "判定", "重症", "危険", "病気がわかる"]) expect(`${x.text}${x.why}${x.example}`, x.key).not.toContain(w);
    }
    // 薬の名前は問いの文に入る（何の薬か分かる）が、Claude に渡す言葉には入らない（下のテスト）
    const sato = questionQueue(seedRows(seed("p-04")));
    expect(sato.find((x) => x.label === "抗認知症薬 保管")?.text).toContain("抗認知症薬");
  });

  it("答え → 変更: 選択肢・薬の残り・夜間の連絡先・分からない", () => {
    const q = questionQueue(seedRows(seed("p-04")));
    const remain = q.find((x) => x.label === "抗認知症薬 残り")!;
    expect(answerChanges(remain, { kind: "value", value: "１４" })).toEqual([
      { t: "clock", clockId: null, medIndex: 0, label: "抗認知症薬", value: 14, unit: "day" },
    ]);
    expect(answerChanges(remain, { kind: "value", value: "たくさん" })).toBeNull();
    const night = q.find((x) => x.key === "people.night_supporter")!;
    expect(answerChanges(night, { kind: "night", contactIds: ["c-04-1"] })).toEqual([
      { t: "contact", id: "c-04-1", value: { kind: "welfare_commissioner", nightOk: true } },
    ]);
    expect(answerChanges(night, { kind: "night", contactIds: [] })?.map((c) => c.t === "contact" && c.value.nightOk)).toEqual([false, false]);
    const tl = q.find((x) => x.key === "evacuation.myTimeline")!;
    expect(answerChanges(tl, { kind: "choice", values: ["paper"] })).toEqual([{ t: "field", key: "evacuation.myTimeline", value: "paper" }]);
    expect(answerChanges(tl, { kind: "pending", status: "declined" })).toEqual([{ t: "pending", field: "evacuation.myTimeline", status: "declined" }]);
  });
});

// ---------- 手入力 ----------

describe("手入力（lib/intake/manual.ts）", () => {
  const sato = seed("p-04").ledger;
  const initial = () => Object.fromEntries(INTAKE_FIELDS.map((f) => [f.key, ledgerValueOf(sato, f.key)]));

  it("変えた欄だけを送る。今の値を変えた欄は上書き、空いた欄は追加。形の合わない値は送らない", () => {
    const values = { ...initial(), "basic.housing.bedroom": "奥の和室", "care.careLevel": "care3", "basic.housing.floor": "二階", "medical.allergies": "卵、そば" };
    const changes = manualChanges(sato, values, { "0.amount": "1 錠" }, [{ name: "降圧薬", category: "other", schedule: "", amount: "", storage: "" }], ["oxygen"], [], " 夜は眠れないと言う ");
    expect(changes).toEqual([
      { t: "field", key: "medical.allergies", value: ["卵", "そば"] },
      { t: "field", key: "basic.housing.bedroom", value: "奥の和室" },
      { t: "field", key: "care.careLevel", value: "care3", overwrite: true },
      { t: "medication", index: 0, value: { name: "抗認知症薬", category: "other", amount: "1 錠" } },
      { t: "medication", value: { name: "降圧薬", category: "other" } },
      { t: "device", value: { kind: "oxygen" } },
      { t: "note", value: "夜は眠れないと言う" },
    ]);
    expect(manualChanges(sato, initial(), {}, [], [], [], "")).toEqual([]);
  });
});

// ---------- 医療依存の印 ----------

describe("医療依存の印は台帳の区分から機械的に（lib/intake/marks.ts）", () => {
  it("酸素と抗凝固薬を入れると、値の空いた時計を作り、印と骨格の段が付く。今ある時計は重ねない", () => {
    const sato = seed("p-04");
    const ledger: Ledger = {
      ...sato.ledger,
      medical: {
        devices: [{ kind: "oxygen" }],
        medications: [...sato.ledger.medical.medications, { name: "ワーファリン", category: "anticoagulant" }],
      },
    };
    const planned = planMarkClocks(ledger, sato.clocks);
    expect(planned).toEqual([
      { kind: "device", category: "oxygen", label: "酸素 内蔵電池", starts_on: "outage" },
      { kind: "medication", category: "anticoagulant", label: "ワーファリン", starts_on: "disaster" },
    ]);
    expect(markPreview(planned)).toEqual([
      { label: "酸素", tier: 2 },
      { label: "抗凝固", tier: 5 },
    ]);
    // 山田さんの酸素とワーファリンは時計があるので作らない
    expect(planMarkClocks(seed("p-01").ledger, seed("p-01").clocks)).toEqual([]);
  });
});

// ---------- 保存 ----------

describe("保存（lib/intake/save.ts）", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
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
  const NOW = new Date("2026-11-03T01:00:00.000Z");

  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
  });

  const req = (changes: IntakeChange[], over: Partial<SaveRequest> = {}): SaveRequest =>
    ({ personId: "p-04", version: 1, ai: { model: SONNET }, changes, ...over }) as SaveRequest;
  const person = (id = "p-04") =>
    sqlite.prepare("SELECT plan_status, version, ledger FROM people WHERE id = ?").get(id) as { plan_status: string; version: number; ledger: string };

  it("保存すると台帳に入り、担当一覧の「未作成」が「下書き」に、経過に「入力」（AI の印）が 1 行", async () => {
    const before = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY);
    expect(before!.rows.find((r) => r.id === "p-04")!.plan).toBe("none");

    const r = await saveIntake(
      db,
      cm,
      req([
        { t: "field", key: "medical.history", value: ["認知症"] },
        { t: "field", key: "basic.household", value: "with_child" }, // 埋まっている → 変えない
        { t: "note", value: "88 歳、独居、認知症で民生委員の〇〇さんが週 2 回来る。" },
        { t: "contact", id: "c-04-1", value: { kind: "welfare_commissioner", note: "週 2 回来る" } },
      ]),
      NOW,
    );
    expect(r).toMatchObject({ ok: true, version: 2, plan: "draft" });
    const p = person();
    expect(p).toMatchObject({ plan_status: "draft", version: 2 });
    const ledger = parseLedger(p.ledger);
    expect(ledger.medical.history).toEqual(["認知症"]);
    expect(ledger.basic.household).toBe("alone");
    expect(ledger.notes).toEqual(["88 歳、独居、認知症で民生委員の〇〇さんが週 2 回来る。"]);
    expect(sqlite.prepare("SELECT note FROM contacts WHERE id = 'c-04-1'").get()).toEqual({ note: "週 2 回来る" });

    const after = await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, TODAY);
    expect(after!.rows.find((r) => r.id === "p-04")!.plan).toBe("draft");

    const rows = await loadPersonPage(db, cm, "p-04");
    const view = toPersonView(rows!, { today: TODAY });
    const items = view.sections.find((s) => s.id === "timeline")!.blocks.flatMap((b) => (b.type === "timeline" ? b.items : []));
    const input = items.filter((t) => !t.derived);
    expect(input).toHaveLength(1);
    expect(input[0]).toMatchObject({ kind: "入力", ai: true, who: "ケアマネ 山本" });
    expect(input[0].body).toBe("AI の分け方、人が確認: 既往・特記・連絡先");
  });

  it("版が違えば書かない（競合）。同じ版からの 2 つ目の保存は、連絡先も経過も書かない", async () => {
    const first = await saveIntake(db, cm, req([{ t: "field", key: "basic.housing.bedroom", value: "奥の和室" }]), NOW);
    expect(first.ok).toBe(true);
    const second = await saveIntake(
      db,
      cm,
      req([
        { t: "field", key: "evacuation.pets", value: "猫" },
        { t: "contact", id: "c-04-2", value: { kind: "family", nightOk: true } },
      ]),
      NOW,
    );
    expect(second).toEqual({ ok: false, error: "conflict" });
    expect(parseLedger(person().ledger).evacuation.pets).toBeUndefined();
    expect(sqlite.prepare("SELECT night_ok FROM contacts WHERE id = 'c-04-2'").get()).toEqual({ night_ok: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM timeline_entries").get()).toEqual({ n: 1 });
  });

  it("同じ版から 2 つの保存が重なっても、書くのは片方だけ（台帳・連絡先・時計・経過とも）", async () => {
    const [a, b] = await Promise.all([
      saveIntake(db, cm, req([{ t: "field", key: "basic.housing.bedroom", value: "奥の和室" }]), NOW),
      saveIntake(
        db,
        cm,
        req([
          { t: "field", key: "evacuation.pets", value: "猫" },
          { t: "contact", id: "c-04-2", value: { kind: "family", nightOk: true } },
          { t: "device", value: { kind: "oxygen" } },
        ]),
        NOW,
      ),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(b).toEqual({ ok: false, error: "conflict" });
    expect(person()).toMatchObject({ version: 2 });
    expect(parseLedger(person().ledger).evacuation.pets).toBeUndefined();
    expect(sqlite.prepare("SELECT night_ok FROM contacts WHERE id = 'c-04-2'").get()).toEqual({ night_ok: null });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM clocks WHERE person_id = 'p-04'").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM timeline_entries").get()).toEqual({ n: 1 });
  });

  it("機器・薬を入れると時計（印）を作り、問いの答えで残りが入る。夜間の答えで夜間支援の未確認が消える", async () => {
    const r = await saveIntake(
      db,
      cm,
      req(
        [
          { t: "device", value: { kind: "oxygen" } },
          { t: "medication", value: { name: "ワーファリン", category: "anticoagulant" } },
          { t: "clock", clockId: null, medIndex: 1, label: "ワーファリン", value: 10, unit: "day" },
          { t: "clock", clockId: null, medIndex: 0, label: "抗認知症薬", value: 14, unit: "day" },
          { t: "contact", id: "c-04-1", value: { kind: "welfare_commissioner", nightOk: true } },
        ],
        { ai: null },
      ),
      NOW,
    );
    expect(r.ok).toBe(true);
    const clocks = sqlite
      .prepare("SELECT kind, category, label, value, unit, starts_on, source FROM clocks WHERE person_id = 'p-04' ORDER BY sort")
      .all();
    expect(clocks).toEqual([
      { kind: "condition", category: "dementia", label: "認知症 本人の信号が当てにならない", value: null, unit: null, starts_on: "none", source: "care_manager" },
      { kind: "device", category: "oxygen", label: "酸素 内蔵電池", value: null, unit: null, starts_on: "outage", source: null },
      { kind: "medication", category: "anticoagulant", label: "ワーファリン", value: 10, unit: "day", starts_on: "disaster", source: "care_manager" },
      { kind: "medication", category: "other", label: "抗認知症薬", value: 14, unit: "day", starts_on: "disaster", source: "care_manager" },
    ]);
    const rows = await loadPersonPage(db, cm, "p-04");
    const view = toPersonView(rows!, { today: TODAY });
    expect(view.head.marks.map((m) => m.label)).toEqual(["酸素", "抗凝固", "認知症"]);
    expect(view.head.priority).toMatchObject({ kind: "tier", tier: 2 });
    // 夜間の答えが入り、問いの列から夜間支援が消える
    expect(questionQueue(rows!).map((q) => q.key)).not.toContain("people.night_supporter");
    // 手入力は AI の印なし
    const tl = sqlite.prepare("SELECT body, payload FROM timeline_entries").get() as { body: string; payload: string };
    expect(JSON.parse(tl.payload)).toMatchObject({ source: "intake", ai: false, model: null });
    expect(tl.body.startsWith("手入力: ")).toBe(true);
  });

  it("山田 ハナ: 夜間の答えで pending（夜間支援 未聴取）が消え、薬の残りの答えで pending（ワーファリン）が消える", async () => {
    const r = await saveIntake(
      db,
      cm,
      req(
        [
          { t: "contact", id: "c-01-1", value: { kind: "family", nightOk: true } },
          { t: "clock", clockId: "k-01-3", medIndex: null, label: "ワーファリン", value: 7, unit: "day" },
        ],
        { personId: "p-01", ai: null },
      ),
      NOW,
    );
    expect(r.ok).toBe(true);
    const ledger = parseLedger(person("p-01").ledger);
    expect(ledger.pending).toEqual([{ field: "evacuation.destination2", status: "unknown" }]);
    expect(person("p-01").plan_status).toBe("draft"); // もとから下書き
  });

  it("ケアマネの役でなければ書けない。事業所の外の本人は該当なし。変わらなければ書かない", async () => {
    expect(await saveIntake(db, { ...cm, role: "medical" }, req([{ t: "note", value: "x" }]), NOW)).toEqual({ ok: false, error: "forbidden" });
    expect(await saveIntake(db, cm, req([{ t: "note", value: "x" }], { personId: "p-nothing" }), NOW)).toEqual({
      ok: false,
      error: "not_found",
    });
    const same = await saveIntake(db, cm, req([{ t: "field", key: "basic.household", value: "alone" }]), NOW);
    expect(same).toMatchObject({ ok: true, changed: 0, version: 1 });
    expect(person().plan_status).toBe("none");
  });

  it("経過の本文は欄の名前だけ（値は書かない）", () => {
    expect(timelineBody(true, ["basic.household", "notes", "contacts.c-1", "clocks.k-1", "medical.medications"])).toBe(
      "AI の分け方、人が確認: 世帯・特記・連絡先・時計・薬",
    );
    expect(sectionOfField("local.watcher")).toBe("people");
    expect(timelineBody(false, [], [{ field: "medical.medications.0.amount", status: "unknown" }])).toBe("手入力: 薬（不明）");
  });

  it("経過の payload は場所だけで、薬の名前を残さない", async () => {
    const r = await saveIntake(db, cm, req([{ t: "medication", index: 0, value: { name: "抗認知症薬", category: "other", amount: "1 錠" } }]), NOW);
    expect(r.ok).toBe(true);
    const tl = sqlite.prepare("SELECT body, payload FROM timeline_entries").get() as { body: string; payload: string };
    expect(JSON.parse(tl.payload).fields).toEqual(["medical.medications.0.amount"]);
    expect(tl.payload).not.toContain("抗認知症薬");
    expect(tl.body).not.toContain("抗認知症薬");
  });

  it("分からない・次回の答えだけでも保存され、経過に理由が出る", async () => {
    const r = await saveIntake(db, cm, req([{ t: "pending", field: "people.night_supporter", status: "not_asked" }], { ai: null }), NOW);
    expect(r).toMatchObject({ ok: true, plan: "draft" });
    expect(parseLedger(person().ledger).pending).toEqual([{ field: "people.night_supporter", status: "not_asked" }]);
    const tl = sqlite.prepare("SELECT body, payload FROM timeline_entries").get() as { body: string; payload: string };
    expect(tl.body).toBe("手入力: 夜間支援（未聴取）");
    expect(JSON.parse(tl.payload).fields).toEqual(["people.night_supporter"]);
  });
});

// ---------- 変更点の画面 ----------

describe("変更点の画面（components/person/IntakeChanges.tsx）", () => {
  const rows = seedRows(seed("p-04"));
  const input = { ledger: parseLedger(rows.person.ledger), contacts: rows.contacts };
  const render = (r: ChangeRow[]) =>
    renderToStaticMarkup(
      createElement(IntakeChanges, {
        rows: r,
        dropped: 1,
        ledger: input.ledger,
        clocks: [],
        busy: false,
        onChange: () => {},
        onSave: () => {},
        onDiscard: () => {},
      }),
    );

  it("見出しの AI の印のほか、項目の行ごとに小さな AI の印。人が直した行だけ「修正済」", () => {
    const r = rowsOf(buildDiff(input, SATO_OUTPUT, restoreIdentity).items);
    const html = render(r);
    expect(r.length).toBeGreaterThan(3);
    expect(html.match(/data-ai="item"/g)).toHaveLength(r.length);
    expect(html.match(/data-ai=""/g)).toHaveLength(1);
    expect(html).not.toContain("修正済");
    const edited = r.map((x) => (x.label === "既往" ? { ...x, edited: true } : x));
    expect(render(edited).match(/修正済/g)).toHaveLength(1);
  });
});
