// T64: 録音と自由文の分類に「その他」（other）を足す。はっきり言っているが けが・動けない・水が来た・機器が止まった の
// どれでもない物（食べ物が無い・家族と連絡が取れない・不安・頼みごと）を、聞き取れない「不明」と分ける。
// 分類は Claude（Haiku）の出力で、色と連絡の順には使わない（lib/triage の表が見るのは injury・immobile だけ）。
// ここで縛ること: 種の 10 人の色・並び・理由が other・[]・unknown で同じ、other は理由に出さない、other と unknown の落とし方、
// 人の修正で other を選べる。本物の API は呼ばない（偽の client が決まった JSON を返す）。

import Anthropic from "@anthropic-ai/sdk";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toggleClass } from "../../components/list/Classification.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload, sortCaseload } from "../caseload.ts";
import type { AskJsonContext } from "../claude/call.ts";
import type { ClaudeClient } from "../claude/client.ts";
import { HAIKU } from "../claude/models.ts";
import { d1UsageStore } from "../claude/usage.ts";
import { RECORDING_CLASSES, type RecordingClass } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import { CLASS_LABELS as LIST_CLASS_LABELS } from "../list/labels.ts";
import { pseudonymize, type PseudonymInput } from "../pseudonym/index.ts";
import { seedConsents } from "../../seed/people.ts";
import { NO_ANSWERS } from "../signals/body.ts";
import { saveSignal, signalScope } from "../signals/save.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import { EXPECTED, HOURS, SIGNALS, situation } from "../triage/heavy-rain.fixture.ts";
import { rank, triage, type Situation, type TriageResult, type TriageSignal } from "../triage/index.ts";
import { classify, normalizeClassification, sealClassifyInput } from "./classify.ts";
import { ClassEditBody, classEditPost } from "./http.ts";
import { CLASS_LABELS, classesText } from "./labels.ts";
import { CLASSIFY_SYSTEM, ClassifySchema } from "./prompt.ts";
import { normalizeEdit } from "./store.ts";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;

// ---------- 名前と並び ----------

describe("分類の名前と並び", () => {
  it("other は unknown の前。けが・動けない・水が来た・機器が止まった・その他・不明の 6 つ", () => {
    expect([...RECORDING_CLASSES]).toEqual(["injury", "immobile", "water", "device_stopped", "other", "unknown"]);
    expect(Object.values(CLASS_LABELS)).toEqual(["けが", "動けない", "水が来た", "機器が止まった", "その他", "不明"]);
    expect(CLASS_LABELS.other).toBe("その他");
    expect(LIST_CLASS_LABELS.other).toBe("その他");
    expect(classesText(["injury", "other"])).toBe("けが・その他");
  });

  it("指示に その他 の 1 行。不明は聞き取れない物、ほかと一緒に選ばない決まりはそのまま", () => {
    expect(CLASSIFY_SYSTEM).toContain("下の 6 つに分け");
    expect(CLASSIFY_SYSTEM).toContain("- other（その他）: はっきり言っているが上の 4 つのどれでもない");
    expect(CLASSIFY_SYSTEM).toMatch(/食べ物・水が無い、家族と連絡が取れない、不安、頼みごと/);
    expect(CLASSIFY_SYSTEM).toContain("unknown はほかと一緒に選ばない");
    // other の行は unknown の行より前
    expect(CLASSIFY_SYSTEM.indexOf("- other（その他）")).toBeLessThan(CLASSIFY_SYSTEM.indexOf("- unknown（不明）"));
    expect(CLASSIFY_SYSTEM).not.toMatch(/5 つ/);
    expect(CLASSIFY_SYSTEM).not.toMatch(/判定|重症|緊急度/);
  });

  it("返事の形は other を通す。6 つの外は通さない", () => {
    expect(ClassifySchema.safeParse({ categories: ["other"], confidence: 0.8, quote: "" }).success).toBe(true);
    expect(ClassifySchema.safeParse({ categories: ["food"], confidence: 0.8, quote: "" }).success).toBe(false);
  });
});

// ---------- Claude の返事の落とし方 ----------

describe("Claude の返事を決まりに合わせる", () => {
  const text = "たべものが ない、むすめと れんらくが とれない";
  const norm = (categories: RecordingClass[], confidence = 0.9) =>
    normalizeClassification({ categories, confidence, quote: "" }, text).categories;

  it("other だけなら other", () => {
    expect(norm(["other"])).toEqual(["other"]);
  });

  it("other と unknown を一緒に返したら other（不明はほかと一緒にしない）", () => {
    expect(norm(["unknown", "other"])).toEqual(["other"]);
    expect(norm(["other", "unknown", "other"])).toEqual(["other"]);
  });

  it("other は 4 つと一緒に選べる。並びは 6 つの順", () => {
    expect(norm(["other", "injury"])).toEqual(["injury", "other"]);
    expect(norm(["device_stopped", "other", "immobile", "unknown"])).toEqual(["immobile", "device_stopped", "other"]);
  });

  it("確信が 0.6 未満なら other でも不明", () => {
    expect(norm(["other"], 0.59)).toEqual(["unknown"]);
    expect(norm(["other"], 0.6)).toEqual(["other"]);
  });
});

// ---------- 人の修正 ----------

describe("人の修正で その他 を選べる", () => {
  it("選択の切り替え: 不明から その他 に、その他 から不明に。4 つとは重ねられる", () => {
    expect(toggleClass([], "other")).toEqual(["other"]);
    expect(toggleClass(["unknown"], "other")).toEqual(["other"]);
    expect(toggleClass(["other"], "unknown")).toEqual(["unknown"]);
    expect(toggleClass(["other"], "injury")).toEqual(["injury", "other"]);
    expect(toggleClass(["injury", "other"], "other")).toEqual(["injury"]);
  });

  it("保存の前の形: other を通し、unknown と一緒なら other", () => {
    expect(ClassEditBody.safeParse({ classes: ["other"] }).success).toBe(true);
    expect(ClassEditBody.safeParse({ classes: [...RECORDING_CLASSES] }).success).toBe(true);
    expect(normalizeEdit(["other"])).toEqual(["other"]);
    expect(normalizeEdit(["unknown", "other"])).toEqual(["other"]);
    expect(normalizeEdit(["other", "water"])).toEqual(["water", "other"]);
  });
});

// ---------- ルールの表（純粋な関数） ----------

const PEOPLE = SEED_PEOPLE.map(toTriagePerson);
const T0 = Date.parse("2026-11-02T06:00:00.000Z");
const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
const sit = (h: number, outageFrom: number | null = 0): Situation => ({
  now: iso(h),
  disasterAt: iso(0),
  outageAt: outageFrom === null ? null : iso(outageFrom),
});
const SITUATIONS: Situation[] = [sit(0, null), sit(1), sit(2.5), sit(6), sit(30), sit(72), sit(30, null)];
const red = (extra: Partial<TriageSignal> = {}): TriageSignal => ({ color: "red", source: "self", at: iso(0), ...extra });
/** 色・行・組・理由・足した言葉（比べる所） */
const shape = (r: TriageResult) => ({
  personId: r.personId,
  color: r.color,
  rule: r.rule,
  group: r.group,
  reason: r.reason,
  qualifiers: r.qualifiers,
});

describe("ルールの表: その他 は色・順・理由を動かさない", () => {
  it("10 人 × 停電の経過で、赤に other・[]・unknown を付けても色・行・組・理由が同じ", () => {
    for (const s of SITUATIONS) {
      for (const p of PEOPLE) {
        const base = shape(triage({ person: p, signals: [red()] }, s));
        expect(shape(triage({ person: p, signals: [red({ classes: ["other"] })] }, s)), `${p.id} ${s.now}`).toEqual(base);
        expect(shape(triage({ person: p, signals: [red({ classes: ["unknown"] })] }, s)), `${p.id} ${s.now}`).toEqual(base);
        expect(shape(triage({ person: p, signals: [red({ classes: [] })] }, s)), `${p.id} ${s.now}`).toEqual(base);
        // 人が直した分類でも同じ
        expect(shape(triage({ person: p, signals: [red({ staffClasses: ["other"] })] }, s)), `${p.id} ${s.now}`).toEqual(base);
      }
    }
  });

  it("10 人の並び: 全員が赤で、分類が other・[]・unknown のどれでも同じ並び", () => {
    for (const s of SITUATIONS) {
      const order = (classes: RecordingClass[]) =>
        rank(PEOPLE.map((p) => ({ person: p, signals: [red({ classes })] })), s).map(shape);
      expect(order(["other"])).toEqual(order([]));
      expect(order(["unknown"])).toEqual(order([]));
    }
  });

  it("other と injury を一緒に返したら、理由は AI の印つきの けが だけ（その他 は理由に出さない）", () => {
    const p = PEOPLE.find((x) => x.id === "p-09")!;
    const s = sit(0, null);
    const r = triage({ person: p, signals: [red({ classes: ["injury", "other"] })] }, s);
    expect(r).toMatchObject({ color: "red", rule: "red", group: 1, reason: "本人が「無事じゃない」、録音の分類（AI）: けが" });
    expect(r.reason).not.toContain("その他");
    expect(shape(r)).toEqual(shape(triage({ person: p, signals: [red({ classes: ["injury"] })] }, s)));
    // 家族の赤でも同じ
    const fam = triage({ person: p, signals: [red({ source: "family", classes: ["other", "immobile"] })] }, s);
    expect(fam.reason).toBe("家族が「無事じゃない」、録音の分類（AI）: 動けない");
  });

  it("大雨の筋: 山田の録音の分類を不明から その他 に替えても、10 人の並び・色・理由は前と同じ", () => {
    const NAME = Object.fromEntries(SEED_PEOPLE.map((p) => [p.person.id, p.person.name.split(" ")[0]]));
    const CHAR = { red: "赤", yellow: "黄", gray: "灰", green: "緑" } as const;
    const line = (r: TriageResult) => `${NAME[r.personId]} ${CHAR[r.color]} ${r.reason}`;
    const swapped = Object.fromEntries(
      Object.entries(SIGNALS).map(([id, sigs]) => [
        id,
        sigs.map((sg) => (sg.classes?.includes("unknown") ? { ...sg, classes: ["other" as const] } : sg)),
      ]),
    );
    expect(swapped["p-01"][0].classes).toEqual(["other"]);
    const entries = SEED_PEOPLE.map((p) => ({ person: toTriagePerson(p), signals: swapped[p.person.id] ?? [] }));
    for (const h of HOURS) expect(rank(entries, situation(h)).map(line), `${h} 時間`).toEqual(EXPECTED[h]);
  });
});

// ---------- D1 の表を読む道（担当一覧） ----------

let sqlite: DatabaseSync;
let db: ReturnType<typeof d1FromSqlite>;

beforeEach(() => {
  sqlite = migratedSqlite();
  for (const s of seedStatements()) sqlite.exec(s);
  db = d1FromSqlite(sqlite);
});
afterEach(() => sqlite.close());

const DEMO = { id: "office-demo", name: "デモ事業所", kind: "demo" as const };
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
const QUAKE = Date.parse("2026-11-04T01:00:00.000Z");
const at = (h: number) => new Date(QUAKE + h * 3_600_000).toISOString();
const caseloadScope = { officeId: "office-demo", careManagerId: "acct-yamamoto" };

async function redSignal(): Promise<string> {
  const r = await switchDisasterMode(db, disasterScope(careManager)!, { kind: "earthquake", version: 0, at: at(0) });
  expect(r).toEqual({ ok: true, changed: true });
  const id = "00000000-0000-4000-8000-000000000064";
  const saved = await saveSignal(
    db,
    signalScope(self)!,
    { id, color: "red", whereNow: null, answers: { ...NO_ANSWERS }, occurredAt: at(1), sentAt: at(1) },
    at(1),
  );
  expect(saved.ok).toBe(true);
  return id;
}

/** 担当一覧の 10 人の並び（tier の順）と色・理由 */
async function board() {
  const data = await loadCaseload(db, caseloadScope, "2026-11-04", at(1.5));
  return sortCaseload(data!.rows, "tier").map((r) => ({ id: r.id, color: r.triage?.color, rule: r.triage?.rule, reason: r.triage?.reason }));
}

function setAi(signalId: string, classes: RecordingClass[] | null) {
  const json = classes ? JSON.stringify(classes) : null;
  sqlite
    .prepare("UPDATE signals SET classes = ?, ai_classes = ?, classified_by = ?, ai_confidence = ?, transcript = ? WHERE id = ?")
    .run(json, json, classes ? "claude" : null, classes ? 0.9 : null, "たべものが ない", signalId);
}

describe("担当一覧（D1 の信号の行から）: その他 は並び・色・理由を動かさない", () => {
  it("Claude の分類が なし・不明・その他 で、10 人の並び・色・理由が同じ", async () => {
    const id = await redSignal();
    setAi(id, null);
    const none = await board();
    expect(none[0]).toMatchObject({ id: "p-01", color: "red", rule: "red" });
    setAi(id, ["unknown"]);
    expect(await board()).toEqual(none);
    setAi(id, ["other"]);
    expect(await board()).toEqual(none);
  });

  it("ケアマネが その他 に直しても同じ。直しは保存され、経過に「分類修正 … → その他」", async () => {
    const id = await redSignal();
    setAi(id, ["unknown"]);
    const before = await board();
    const res = await classEditPost(db, careManager, id, { classes: ["other"] }, at(1.2));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; view: { kind: string; classes: RecordingClass[] } };
    expect(body).toMatchObject({ ok: true, view: { kind: "human", classes: ["other"] } });
    const row = sqlite.prepare("SELECT classes, classified_by FROM signals WHERE id = ?").get(id) as Record<string, unknown>;
    expect(row).toEqual({ classes: '["other"]', classified_by: "care_manager" });
    expect(await board()).toEqual(before);
    const log = sqlite.prepare("SELECT body FROM timeline_entries WHERE person_id = 'p-01' AND body LIKE '分類修正%'").all() as Array<{
      body: string;
    }>;
    expect(log.map((l) => l.body)).toContain("分類修正 不明（AI） → その他");
  });
});

// ---------- 分ける本体（偽の Claude） ----------

function reply(value: unknown): Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: HAIKU,
    content: [{ type: "text", text: JSON.stringify(value), citations: null }],
    stop_reason: "end_turn",
    stop_details: null,
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function fake(value: unknown) {
  const calls: Params[] = [];
  const client: ClaudeClient = {
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return reply(value);
        },
      },
    },
  };
  return { client, calls };
}

const yamada = SEED_PEOPLE[0];
const yamadaInput: PseudonymInput = {
  person: yamada.person,
  ledger: yamada.ledger,
  contacts: yamada.contacts,
  clocks: yamada.clocks,
  consents: seedConsents(yamada),
};
const { key } = pseudonymize([yamadaInput], { on: "2026-11-04" });

function aiCtx(claude: ClaudeClient): AskJsonContext {
  return {
    env: { ANTHROPIC_API_KEY: "dummy" },
    usage: d1UsageStore(db),
    office: { id: DEMO.id, kind: DEMO.kind },
    now: () => new Date("2026-11-04T01:30:00.000Z"),
    claude,
  };
}

describe("分ける本体（偽の Claude）", () => {
  it("Claude が other を返せば その他。unknown と一緒なら その他 だけ", async () => {
    const input = sealClassifyInput({ transcript: "たべものが ない", answers: { ...NO_ANSWERS }, audio: null }, key);
    const one = fake({ categories: ["other"], confidence: 0.85, quote: "たべものが ない" });
    expect(await classify(input, aiCtx(one.client))).toMatchObject({
      ok: true,
      model: HAIKU,
      value: { categories: ["other"], confidence: 0.85, quote: "たべものが ない" },
    });
    const both = fake({ categories: ["other", "unknown"], confidence: 0.85, quote: "" });
    expect(await classify(input, aiCtx(both.client))).toMatchObject({ ok: true, value: { categories: ["other"] } });
    // 送った物に指示の その他 の行がある（1 回 1 呼び出し）
    expect(one.calls).toHaveLength(1);
    expect(JSON.stringify(one.calls[0].system)).toContain("other（その他）");
  });
});
