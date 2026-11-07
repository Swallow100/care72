// T69b 本人・家族のスマホの中身（docs/tasks/T69b.md）。いちばん大事な線をここで縛る:
// - 選択肢の色（tone）は見た目の印で、ルールの表の入力ではない。赤は表が至急にする答えだけ。体の訴え・場所・わからない・とばすには色を付けない
// - 送る答え（answers）に色は入らない。lib/triage のどのファイルも tone を読まない

import { readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { Hearing } from "../../components/list/Hearing.tsx";
import { FamilyView } from "../../components/phone/FamilyView.tsx";
import { PhoneView, type PhoneActions } from "../../components/phone/PhoneView.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { seedStatements } from "../../seed/sql.ts";
import type { Principal } from "../auth/principal.ts";
import { loadCaseload } from "../caseload.ts";
import type { SignalRow } from "../db/types.ts";
import { d1FromSqlite, migratedSqlite } from "../db/test-d1.ts";
import { switchDisasterMode } from "../disaster/db.ts";
import { disasterScope } from "../disaster/scope.ts";
import type { SignalForTriage } from "../disaster/triage.ts";
import { mapPins } from "../map/side.ts";
import type { TriageSignal } from "../triage/index.ts";
import { NO_ANSWERS } from "./body.ts";
import { hearingViewOf } from "./hearing.ts";
import { locationPost } from "./http.ts";
import { coordText, positionText } from "./labels.ts";
import { createOutbox, fetchTransport, readOutbox, type LocationItem } from "./outbox.ts";
import { parseLocation, saveSignal, signalScope } from "./save.ts";
import { shelterOptionsOf, type FamilyScreen } from "./family.ts";
import { createFamilyPhone, type FamilyState } from "./family-phone.ts";
import type { AttachItem } from "./outbox.ts";
import {
  createPhone,
  MAX_RECORD_MS,
  RECORD_MS,
  TALKING_MS,
  type PhoneDeps,
  type PhoneState,
  type TranscriptEvents,
} from "./phone.ts";
import {
  CHOICE_TONES,
  choicesFor,
  legacyColumnsOf,
  nextQuestion,
  parseAnswers,
  questionOf,
  QUESTIONS,
  UNKNOWN_CHOICE,
  type Answer,
  type Answers,
  type Asker,
  type QuestionId,
} from "./questions.ts";

const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name) ? [p] : [];
  });
}

/** 選択肢の「問い.答え」の集合 */
const pairs = (pick: (q: (typeof QUESTIONS)[number], c: (typeof QUESTIONS)[number]["choices"][number]) => boolean) =>
  new Set(QUESTIONS.flatMap((q) => q.choices.filter((c) => pick(q, c)).map((c) => `${q.id}.${c.id}`)));

const noop: PhoneActions = {
  green() {},
  red() {},
  where() {},
  answer() {},
  skip() {},
  locate() {},
  extend() {},
  finish() {},
  again() {},
};

describe("選択肢の枠と色分け（1）", () => {
  it("赤（urgent）はルールの表が至急にする答えだけ: 表の側から逆に読む（4 つの列で けが=true・動けない=false）", () => {
    // 表が読むのは信号の列の injured と canMove だけ（lib/triage/index.ts の injuryWords: injured === true・canMove === false）
    const triageReads = pairs((q, c) => {
      const cols = legacyColumnsOf({ [q.id]: { choice: c.id, via: "press" } } as Partial<Record<QuestionId, Answer>>);
      return cols.injured === true || cols.canMove === false;
    });
    expect(pairs((_, c) => c.tone === "urgent")).toEqual(triageReads);
    expect([...triageReads].sort()).toEqual(["canMove.no", "injured.yes"]);
    const src = readFileSync(join(ROOT, "lib/triage/index.ts"), "utf8");
    expect(src).toContain("sig.injured === true");
    expect(src).toContain("sig.canMove === false");
  });

  it("黄・緑は文書の案のとおり。わからない・ほか・場所・部位・体の訴え・そばの人・頼みたいことには付けない", () => {
    expect([...pairs((_, c) => c.tone === "check")].sort()).toEqual(
      [
        "bleeding.yes",
        "exit.no",
        "trappedBy.door",
        "trappedBy.furniture",
        "trappedBy.fallen",
        "trappedBy.water",
        "water.floor",
        "water.knee",
        "water.waist",
        "fireGas.yes",
        "device.stopped",
        "hasMedicine.no",
        "contact.none",
      ].sort(),
    );
    expect([...pairs((_, c) => c.tone === "ok")].sort()).toEqual(
      [
        "injured.no",
        "bleeding.no",
        "canMove.yes",
        "exit.yes",
        "water.none",
        "fireGas.no",
        "device.running",
        "hasMedicine.yes",
        "contact.phone",
        "contact.tel",
      ].sort(),
    );
    const none: QuestionId[] = ["atHome", "floor", "room", "place", "injuryPart", "body", "nearby", "request"];
    for (const id of none) {
      const q = QUESTIONS.find((x) => x.id === id)!;
      expect(q.choices.filter((c) => c.tone), id).toEqual([]);
    }
    for (const q of QUESTIONS) {
      for (const c of q.choices) {
        if (c.id === UNKNOWN_CHOICE || c.id === "other") expect(c.tone, `${q.id}.${c.id}`).toBeUndefined();
        if (c.tone) expect(CHOICE_TONES).toContain(c.tone);
      }
    }
  });

  it("lib/triage のどのファイルも tone を読まない。表の入力の型にも無い", () => {
    const hits = sourceFiles(join(ROOT, "lib/triage")).filter((f) => /\btone\b|CHOICE_TONES|ChoiceTone/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
    expectTypeOf<TriageSignal>().not.toHaveProperty("tone");
  });

  it("送る答えの形に tone は入らない（parseAnswers は choice と via だけ。tone を付けても落とす）", () => {
    expectTypeOf<Answer>().not.toHaveProperty("tone");
    const parsed = parseAnswers({ injured: { choice: "yes", via: "press", tone: "urgent" } });
    expect(parsed).toEqual({ injured: { choice: "yes", via: "press" } });
    expect(JSON.stringify(parsed)).not.toContain("tone");
  });

  it("本人・家族の画面: 印のある答えだけ data-tone で面を塗り（T137b）、印の無い答えは灰の枠。言葉はそのまま", () => {
    const html = renderToStaticMarkup(
      createElement(PhoneView, {
        state: { step: "question", id: "injured", answers: {}, first: true, voice: null },
        nowMs: 0,
        on: noop,
      }),
    );
    expect(html).toMatch(/data-choice="yes" data-tone="urgent"/);
    expect(html).toMatch(/data-choice="no" data-tone="ok"/);
    expect(html).toMatch(/data-choice="unknown"(?! data-tone)/);
    expect(html.match(/phone-choice/g)).toHaveLength(1);
    expect(html).toMatch(/phone-fill-urgent[^"]*" data-press="overlay" data-choice="yes"/);
    expect(html).toMatch(/phone-fill-ok[^"]*" data-press="overlay" data-choice="no"/);
    // 体の訴え（息が くるしい など）には色を付けない
    const body = renderToStaticMarkup(
      createElement(PhoneView, { state: { step: "question", id: "body", answers: {}, first: false, voice: null }, nowMs: 0, on: noop }),
    );
    expect(body).not.toContain("data-tone");
    expect(body).toContain("phone-choice");
    // 119 の 1 行は今までどおり
    expect(html).toContain("data-emergency");

    const screen = {
      personId: "p-01",
      contactId: "c-01-1",
      question: [{ text: "お母さん" }],
      history: null,
      carry: null,
      careManager: { words: [{ text: "山本" }], number: null },
      callName: [{ text: "お母さん" }],
      hasDevice: false,
    } as unknown as FamilyScreen;
    const fam = renderToStaticMarkup(
      createElement(FamilyView, {
        state: { step: "question", id: "canMove", answers: {} },
        screen,
        on: { answer() {}, choose() {}, skip() {}, again() {} },
      }),
    );
    expect(fam).toMatch(/data-choice="no" data-tone="urgent"/);
    expect(fam).toMatch(/data-choice="yes" data-tone="ok"/);
  });

  it("phone.css の決まり（T137b）: 印のある答えは状態の色で面を塗る。端だけの色の線（inset の影）と薄い下地は使わない", () => {
    const css = readFileSync(join(ROOT, "components/phone/phone.css"), "utf8");
    expect(css).toMatch(/\.phone-choice\s*\{\s*border: 1\.5px solid/);
    expect(css).toMatch(/\.phone-fill-urgent\s*\{\s*background-color: var\(--state-urgent\)/);
    expect(css).toMatch(/\.phone-fill-ok\s*\{\s*background-color: var\(--state-ok\)/);
    expect(css).toMatch(/\.phone-fill-check\s*\{\s*background-color: var\(--state-check-fill\);\s*color: var\(--on-state-check\)/);
    expect(css).not.toContain("inset");
    expect(css).not.toContain("color-mix");
  });

  it("ケアマネの聞き取りの欄には色を付けない（components/list/Hearing.tsx は tone を読まない）", () => {
    expect(readFileSync(join(ROOT, "components/list/Hearing.tsx"), "utf8")).not.toMatch(/\btone\b/);
  });
});

// ---------- 3 やばそうなら残りを飛ばして録音 ----------

const T0 = Date.parse("2026-11-04T01:00:00.000Z");
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

type PhoneHarness = {
  phone: ReturnType<typeof createPhone>;
  states: PhoneState[];
  answers: Array<{ signalId: string; answers: Answers }>;
  recordings: AttachItem[];
};

function phoneHarness(over: Partial<PhoneDeps> = {}): PhoneHarness {
  const h = { states: [], answers: [], recordings: [] } as unknown as PhoneHarness;
  let n = 0;
  h.phone = createPhone({
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    sendSignal: async () => "sent",
    sendRecording: async (item) => {
      h.recordings.push(item);
      return "sent";
    },
    sendAnswers: async (item) => {
      h.answers.push(item);
      return "sent";
    },
    playPrompt: async () => {},
    startRecording: async () => ({ stop: async () => new Blob([new Uint8Array([9])], { type: "audio/webm" }) }),
    startTranscript: () => ({ stop: async () => "あしが いたい" }),
    onChange: (s) => h.states.push(s),
    ...over,
  });
  return h;
}

const qSteps = (states: ReadonlyArray<{ step: string; id?: string }>) =>
  states.map((s) => (s.step === "question" ? `q:${s.id}` : s.step));

/** 押す順に答える（今の問いを確かめながら） */
function press(h: PhoneHarness, path: ReadonlyArray<readonly [QuestionId, string]>) {
  for (const [q, c] of path) {
    expect(h.phone.state).toMatchObject({ step: "question", id: q });
    h.phone.answer(c);
  }
}

describe("やばそうなら残りを飛ばして録音（3）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it("飛ばす答えの集合（案）: けが ある・動けない・出られない・妨げ 4 つ・水 3 つ・火やガス・機器の停止", () => {
    expect([...pairs((_, c) => c.toRecording === true)].sort()).toEqual(
      [
        "injured.yes",
        "canMove.no",
        "exit.no",
        "trappedBy.door",
        "trappedBy.furniture",
        "trappedBy.fallen",
        "trappedBy.water",
        "water.floor",
        "water.knee",
        "water.waist",
        "fireGas.yes",
        "device.stopped",
      ].sort(),
    );
    // 体の訴え・薬・連絡・そばの人・場所には付けない
    for (const id of ["body", "hasMedicine", "contact", "nearby", "place"] as QuestionId[]) {
      expect(QUESTIONS.find((q) => q.id === id)!.choices.some((c) => c.toRecording), id).toBe(false);
    }
  });

  it("けが ある → 「動けますか」の 1 問だけ → 定型文と録音。飛ばした問いは answers に入らない", async () => {
    const h = phoneHarness();
    h.phone.red();
    h.phone.answer("yes");
    expect(h.phone.state).toMatchObject({ step: "question", id: "canMove" });
    h.phone.answer("yes");
    await flush();
    expect(h.phone.state.step).toBe("recording");
    expect(qSteps(h.states)).toEqual(["q:injured", "q:canMove", "prompt", "recording"]);
    expect(h.answers.at(-1)!.answers).toEqual({ injured: { choice: "yes", via: "press" }, canMove: { choice: "yes", via: "press" } });
    // 表が読む 4 つの列: けが あり・動ける（ほかは答えなし）
    expect(legacyColumnsOf(h.answers.at(-1)!.answers)).toEqual({ injured: true, atHome: null, canMove: true, hasMedicine: null });
  });

  it("けが ある のあとの 動けますか を とばしても録音へ", async () => {
    const h = phoneHarness();
    h.phone.red();
    h.phone.answer("yes");
    h.phone.skip();
    await flush();
    expect(h.phone.state.step).toBe("recording");
  });

  it("動けない → すぐ定型文と録音（自分が表の入力なのでそのまま）", async () => {
    const h = phoneHarness();
    h.phone.red();
    press(h, [
      ["injured", "no"],
      ["atHome", "yes"],
      ["floor", "f1"],
      ["room", "bedroom"],
      ["canMove", "no"],
    ]);
    await flush();
    expect(h.phone.state.step).toBe("recording");
    expect(Object.keys(h.answers.at(-1)!.answers)).toEqual(["injured", "atHome", "floor", "room", "canMove"]);
  });

  it("出られない・水が床まで・火やガス でも録音へ。急がない答え（水なし）はそのまま次の問い", async () => {
    const head = [
      ["injured", "no"],
      ["atHome", "unknown"],
      ["canMove", "yes"],
    ] as const;
    const cases: Array<[ReadonlyArray<readonly [QuestionId, string]>, boolean]> = [
      [[...head, ["exit", "no"]], true],
      [[...head, ["exit", "yes"], ["body", "none"], ["water", "floor"]], true],
      [[...head, ["exit", "yes"], ["body", "none"], ["water", "none"], ["fireGas", "yes"]], true],
      [[...head, ["exit", "yes"], ["body", "breath"], ["water", "none"]], false],
    ];
    for (const [path, rush] of cases) {
      const h = phoneHarness();
      h.phone.red();
      press(h, path);
      await flush();
      if (rush) expect(h.phone.state.step, JSON.stringify(path)).toBe("recording");
      else expect(h.phone.state).toMatchObject({ step: "question", id: "fireGas" });
    }
  });

  it("体の訴え（息が くるしい）では飛ばさない（症状の重さを仕組みが決めない）", () => {
    const h = phoneHarness();
    h.phone.red();
    press(h, [
      ["injured", "no"],
      ["atHome", "unknown"],
      ["canMove", "yes"],
      ["exit", "yes"],
      ["body", "breath"],
    ]);
    expect(h.phone.state).toMatchObject({ step: "question", id: "water" });
  });

  it("機器が止まった（台帳に機器がある人）→ 録音へ", async () => {
    const h = phoneHarness({ hasDevice: true });
    h.phone.red();
    press(h, [
      ["injured", "no"],
      ["atHome", "unknown"],
      ["canMove", "yes"],
      ["exit", "yes"],
      ["body", "none"],
      ["water", "none"],
      ["fireGas", "no"],
      ["device", "stopped"],
    ]);
    await flush();
    expect(h.phone.state.step).toBe("recording");
  });

  it("家族: けが ある → 動けますか の 1 問 → 送れたか（録音は無い）。動けない → すぐ送れたか", async () => {
    const sent: Answers[] = [];
    const make = () => {
      const states: FamilyState[] = [];
      const f = createFamilyPhone({
        sendSignal: async () => "sent",
        sendAnswers: async (item) => {
          sent.push(item.answers);
          return "sent";
        },
        onChange: (s) => states.push(s),
      });
      return { f, states };
    };
    const a = make();
    a.f.answer("red");
    a.f.choose("yes");
    expect(a.f.state).toMatchObject({ step: "question", id: "canMove" });
    a.f.choose("no");
    await flush();
    expect(a.f.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(sent.at(-1)).toEqual({ injured: { choice: "yes", via: "press" }, canMove: { choice: "no", via: "press" } });

    const b = make();
    b.f.answer("red");
    b.f.choose("no");
    b.f.choose("unknown");
    expect(b.f.state).toMatchObject({ step: "question", id: "canMove" });
    b.f.choose("no");
    await flush();
    expect(b.f.state).toMatchObject({ step: "done" });
    expect(qSteps(b.states as Array<{ step: string; id?: string }>)).not.toContain("q:exit");
  });

  it("飛ばしても表の 4 つの列は同じ答えから同じ値（飛ばした問いは列に関わらない）", () => {
    const rushed = legacyColumnsOf({ injured: { choice: "yes", via: "press" }, canMove: { choice: "no", via: "press" } });
    const full = legacyColumnsOf({
      injured: { choice: "yes", via: "press" },
      injuryPart: { choice: "leg", via: "press" },
      bleeding: { choice: "no", via: "press" },
      canMove: { choice: "no", via: "press" },
      exit: { choice: "no", via: "press" },
    });
    expect(rushed).toEqual(full);
  });
});

describe("録音の長さ（3）: 60 秒、話している間は 60 秒ずつ延びる、上限 180 秒", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  /** 文字起こしの偽物。talk() で文字の知らせ（onText）を届ける */
  function talking() {
    let events: TranscriptEvents | null = null;
    const start: NonNullable<PhoneDeps["startTranscript"]> = (e) => {
      events = e;
      return { stop: async () => "みずが きて うごけない" };
    };
    return { start, talk: () => events?.onText?.("みずが") };
  }

  /** けが ある → 動けない で録音へ（押してすぐ録音が始まる） */
  async function toRecording(h: PhoneHarness) {
    h.phone.red();
    h.phone.answer("yes");
    h.phone.answer("no");
    await flush();
    expect(h.phone.state).toEqual({ step: "recording", startedAt: T0, until: T0 + RECORD_MS });
  }

  it("定数: 60 秒・180 秒・話している間 15 秒", () => {
    expect(RECORD_MS).toBe(60_000);
    expect(MAX_RECORD_MS).toBe(180_000);
    expect(TALKING_MS).toBe(15_000);
  });

  it("話していれば 60 秒の時点で 60 秒延び、話し終われば次の時点で送る", async () => {
    const t = talking();
    const h = phoneHarness({ startTranscript: t.start });
    await toRecording(h);
    vi.advanceTimersByTime(RECORD_MS - 5_000);
    t.talk();
    vi.advanceTimersByTime(5_000);
    await flush();
    expect(h.phone.state).toEqual({ step: "recording", startedAt: T0, until: T0 + 2 * RECORD_MS });
    // 次の 60 秒は黙っている → 送る
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(h.phone.state).toMatchObject({ step: "done", color: "red" });
    expect(h.recordings[0]).toMatchObject({ transcript: "みずが きて うごけない", durationSec: (2 * RECORD_MS) / 1000 });
  });

  it("話し続けても 180 秒で止めて送る", async () => {
    const t = talking();
    const h = phoneHarness({ startTranscript: t.start });
    await toRecording(h);
    for (let i = 0; i < 18; i++) {
      t.talk();
      vi.advanceTimersByTime(10_000);
      await flush();
    }
    expect(h.phone.state).toMatchObject({ step: "done" });
    expect(h.recordings[0].durationSec).toBe(MAX_RECORD_MS / 1000);
  });

  it("最後に話したのが 15 秒より前なら延ばさない（静かになってから待たせない）", async () => {
    const t = talking();
    const h = phoneHarness({ startTranscript: t.start });
    await toRecording(h);
    vi.advanceTimersByTime(10_000);
    t.talk();
    vi.advanceTimersByTime(RECORD_MS - 10_000);
    await flush();
    expect(h.phone.state).toMatchObject({ step: "done" });
  });

  it("「おくる」はいつでも送る（延ばしている途中でも）", async () => {
    const t = talking();
    const h = phoneHarness({ startTranscript: t.start });
    await toRecording(h);
    vi.advanceTimersByTime(RECORD_MS - 1_000);
    t.talk();
    vi.advanceTimersByTime(2_000);
    await flush();
    expect(h.phone.state).toMatchObject({ step: "recording", until: T0 + 2 * RECORD_MS });
    h.phone.finish();
    await flush();
    expect(h.phone.state).toMatchObject({ step: "done" });
  });
});

// ---------- 2 場所（避難先の選択・端末の位置） ----------

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
/** 本人のスマホの端末の位置（架空。台帳の位置とは別の所） */
const HERE = { lat: 33.8301, lng: 132.7612, accuracyM: 48, at: atH(1.02) };

describe("場所（2）: 避難先の選択", () => {
  it("避難所 → 「どこの 避難所ですか」は台帳に避難先がある人だけ。押す画面だけ（声の問いでは聞かない）", () => {
    const withShelter: Asker = { who: "self", hasDevice: false, shelters: 1 };
    const none: Asker = { who: "self", hasDevice: false };
    expect(nextQuestion("place", "shelter", withShelter)).toBe("shelterWhich");
    expect(nextQuestion("place", "shelter", none)).toBe("canMove");
    expect(nextQuestion("place", "shelter", { ...withShelter, voice: true })).toBe("canMove");
    expect(nextQuestion("place", "shelter", { who: "family", hasDevice: false, shelters: 2 })).toBe("shelterWhich");
    expect(nextQuestion("shelterWhich", "d1", withShelter)).toBe("canMove");
    expect(questionOf("shelterWhich").field).toBe("place");
  });

  it("選択肢は台帳の避難先だけ（名前はそのまま）と ほか・わからない。答えは id だけ", () => {
    const q = questionOf("shelterWhich");
    expect(choicesFor(q, [{ id: "d1", easy: "かわなぎ小学校" }]).map((c) => [c.id, c.name ?? null])).toEqual([
      ["d1", "かわなぎ小学校"],
      ["other", null],
      [UNKNOWN_CHOICE, null],
    ]);
    expect(choicesFor(q, []).map((c) => c.id)).toEqual(["other", UNKNOWN_CHOICE]);
    const html = renderToStaticMarkup(
      createElement(PhoneView, {
        state: { step: "question", id: "shelterWhich", answers: {}, first: false, voice: null },
        nowMs: 0,
        on: noop,
        shelters: [
          { id: "d1", easy: "かわなぎ小学校" },
          { id: "d2", easy: "みずほし公民館" },
        ],
      }),
    );
    expect(html).toContain("かわなぎ小学校");
    expect(html).toContain("みずほし公民館");
    expect(html).toContain("data-emergency");
    // 送る答えは id だけ（名前は入らない）
    expect(parseAnswers({ shelterWhich: { choice: "d1", via: "press" } })).toEqual({ shelterWhich: { choice: "d1", via: "press" } });
    expect(parseAnswers({ shelterWhich: { choice: "かわなぎ小学校", via: "press" } })).toBeNull();
  });

  it("台帳から避難先の選択肢を作る（空の欄は出さない）。家族の画面にも渡す", () => {
    const yamada = SEED_PEOPLE[0];
    const rows = { person: { ...yamada.person, ledger: JSON.stringify(yamada.ledger) } } as unknown as Parameters<typeof shelterOptionsOf>[0];
    expect(shelterOptionsOf(rows)).toEqual([{ id: "d1", easy: "福音小学校" }]);
    const none = SEED_PEOPLE.find((p) => !p.ledger.evacuation.destination1)!;
    expect(shelterOptionsOf({ person: { ...none.person, ledger: JSON.stringify(none.ledger) } } as never)).toEqual([]);
  });

  it("ケアマネの聞き取りの欄: 場所の行で d1・d2 を台帳の名前に引く。色は付けない", () => {
    const answers = JSON.stringify({
      atHome: { choice: "no", via: "press" },
      place: { choice: "shelter", via: "press" },
      shelterWhich: { choice: "d1", via: "press" },
    });
    const v = hearingViewOf({ answers }, { shelters: { d1: "かわなぎ小学校", d2: null } })!;
    const row = v.rows.find((r) => r.field === "place")!;
    expect(row.answers.map((a) => a.choice)).toEqual(["自宅外", "避難所", "かわなぎ小学校"]);
    // 名前が無ければ「避難先1」
    const bare = hearingViewOf({ answers })!.rows.find((r) => r.field === "place")!;
    expect(bare.answers.at(-1)!.choice).toBe("避難先1");
  });
});

describe("場所（2）: 端末の位置", () => {
  let sqlite: DatabaseSync;
  let db: ReturnType<typeof d1FromSqlite>;
  beforeEach(() => {
    sqlite = migratedSqlite();
    for (const s of seedStatements()) sqlite.exec(s);
    db = d1FromSqlite(sqlite);
  });
  afterEach(() => sqlite.close());

  async function quake() {
    const r = await switchDisasterMode(db, disasterScope(cmP)!, { kind: "earthquake", version: 0, at: atH(0) });
    expect(r).toMatchObject({ ok: true });
  }
  async function red(n: number, color: "red" | "green" = "red", h = 1) {
    const r = await saveSignal(
      db,
      signalScope(selfP)!,
      { id: sid(n), color, whereNow: color === "green" ? "home" : null, answers: { ...NO_ANSWERS }, occurredAt: atH(h), sentAt: atH(h) },
      atH(h),
    );
    expect(r.ok).toBe(true);
  }
  const row = (id: string) => sqlite.prepare("SELECT * FROM signals WHERE id = ?").get(id) as unknown as SignalRow;

  it("車・ほかの ところ → 本人の画面だけ「いまの 場所を おくりますか」。はい で 1 回だけ位置を取り、待たずに次の問い", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    try {
      const sent: LocationItem[] = [];
      let located = 0;
      const h = phoneHarness({
        locate: async () => {
          located++;
          return { ...HERE };
        },
        sendLocation: async (item) => {
          sent.push(item);
          return "sent";
        },
      });
      h.phone.red();
      press(h, [
        ["injured", "no"],
        ["atHome", "no"],
        ["place", "car"],
      ]);
      expect(h.phone.state).toEqual({ step: "locate", answers: h.answers.at(-1)!.answers });
      const html = renderToStaticMarkup(createElement(PhoneView, { state: h.phone.state, nowMs: 0, on: noop }));
      expect(html).toContain("data-emergency");
      expect(html).not.toContain("data-tone");
      h.phone.locate(true);
      expect(h.phone.state).toMatchObject({ step: "question", id: "canMove" });
      await flush();
      expect(located).toBe(1);
      expect(sent).toEqual([{ signalId: sid(1), ...HERE }]);
      // 位置は答え（answers）に入らない
      expect(JSON.stringify(h.answers)).not.toContain("33.83");

      // いいえ・20 秒押さない は何も送らず次へ
      const n = phoneHarness({ locate: async () => ({ ...HERE }), sendLocation: async () => "sent" });
      n.phone.red();
      press(n, [
        ["injured", "no"],
        ["atHome", "no"],
        ["place", "other"],
      ]);
      n.phone.locate(false);
      expect(n.phone.state).toMatchObject({ step: "question", id: "canMove" });
      const idle = phoneHarness({ locate: async () => ({ ...HERE }), sendLocation: async () => "sent" });
      idle.phone.red();
      press(idle, [
        ["injured", "no"],
        ["atHome", "no"],
        ["place", "car"],
      ]);
      vi.advanceTimersByTime(20_000);
      expect(idle.phone.state).toMatchObject({ step: "question", id: "canMove" });

      // 取れない・断られた（null）は何も送らない
      const denied: LocationItem[] = [];
      const d = phoneHarness({ locate: async () => null, sendLocation: async (i) => (denied.push(i), "sent") });
      d.phone.red();
      press(d, [
        ["injured", "no"],
        ["atHome", "no"],
        ["place", "car"],
      ]);
      d.phone.locate(true);
      await flush();
      expect(denied).toEqual([]);

      // 位置を取れない端末（locate が無い）・避難所 は聞かない
      const plain = phoneHarness();
      plain.phone.red();
      press(plain, [
        ["injured", "no"],
        ["atHome", "no"],
        ["place", "car"],
      ]);
      expect(plain.phone.state).toMatchObject({ step: "question", id: "canMove" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("保存: 自分の赤の信号だけ。家族・緑・ほかの人・平時・範囲の外は断る。台帳の位置は変えない", async () => {
    // 平時は 409
    expect((await locationPost(db, selfP, sid(1), HERE)).status).toBe(409);
    await quake();
    await red(1);
    await red(2, "green", 1.5);
    const res = await locationPost(db, selfP, sid(1), HERE);
    expect(res.status).toBe(200);
    expect(row(sid(1))).toMatchObject({ reported_lat: HERE.lat, reported_lng: HERE.lng, reported_accuracy_m: 48, reported_at: HERE.at });
    // 2 回目（同じ値）は変わらない
    expect(await (await locationPost(db, selfP, sid(1), HERE)).json()).toMatchObject({ ok: true, changed: false });
    // 緑は 400、知らない信号 404、家族は 404、ケアマネは 403、ログインなし 401
    expect((await locationPost(db, selfP, sid(2), HERE)).status).toBe(400);
    expect((await locationPost(db, selfP, sid(9), HERE)).status).toBe(404);
    expect((await locationPost(db, familyP, sid(1), HERE)).status).toBe(404);
    expect((await locationPost(db, cmP, sid(1), HERE)).status).toBe(403);
    expect((await locationPost(db, null, sid(1), HERE)).status).toBe(401);
    // 範囲の外・形の違いは 400
    for (const bad of [
      { ...HERE, lat: 91 },
      { ...HERE, lng: -181 },
      { ...HERE, accuracyM: -1 },
      { ...HERE, lat: "33" },
      { ...HERE, at: "きのう" },
      null,
    ]) {
      expect((await locationPost(db, selfP, sid(1), bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect(parseLocation({ lat: -90, lng: 180, accuracyM: null, at: HERE.at })).toEqual({ lat: -90, lng: 180, accuracyM: null, at: HERE.at });
    // 台帳の位置は変えない
    const ledger = JSON.parse((sqlite.prepare("SELECT ledger FROM people WHERE id = 'p-01'").get() as { ledger: string }).ledger);
    expect(ledger.basic.location).toEqual(SEED_PEOPLE[0].ledger.basic.location);
  });

  it("送る道: 位置は本文の JSON で、URL に載せない。通信が無ければ端末に残して送り直す", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const t = fetchTransport(async (url, init) => {
      seen.push({ url: String(url), body: String(init?.body) });
      return new Response("{}", { status: 200 });
    });
    expect(await t.location!({ signalId: sid(1), ...HERE })).toBe("ok");
    expect(seen[0].url).toBe(`/api/signals/${sid(1)}/location`);
    expect(seen[0].url).not.toContain("33.83");
    expect(JSON.parse(seen[0].body)).toEqual({ lat: HERE.lat, lng: HERE.lng, accuracyM: 48, at: HERE.at });

    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    let online = false;
    const sentItems: LocationItem[] = [];
    const box = createOutbox({
      storage,
      owner: "self:p-01",
      transport: {
        signal: async () => "ok",
        attach: async () => "ok",
        answers: async () => "ok",
        location: async (item) => {
          if (!online) throw new Error("offline");
          sentItems.push(item);
          return "ok";
        },
      },
    });
    expect(await box.sendLocation({ signalId: sid(1), ...HERE })).toBe("queued");
    expect(readOutbox(storage)).toMatchObject([{ kind: "location", signalId: sid(1), lat: HERE.lat }]);
    online = true;
    await box.flush();
    expect(sentItems).toEqual([{ signalId: sid(1), ...HERE }]);
    expect(box.pending()).toBe(0);
  });

  it("ケアマネの画面: 聞き取りの場所の行に「位置 あり（±48 m）」と座標、地図のピンは申告位置（title に「申告位置」）", async () => {
    await quake();
    await red(1);
    expect((await locationPost(db, selfP, sid(1), HERE)).status).toBe(200);
    const data = (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, "2026-11-04", atH(1.1)))!;
    const yamada = data.rows.find((r) => r.id === "p-01")!;
    expect(yamada.reported).toEqual({ lat: HERE.lat, lng: HERE.lng });
    expect(yamada.location).toEqual(SEED_PEOPLE[0].ledger.basic.location);
    const sig = yamada.detail!.signals.find((s) => s.id === sid(1))!;
    expect(sig.place).toEqual({ shelters: { d1: "福音小学校", d2: null }, reported: { lat: HERE.lat, lng: HERE.lng, accuracyM: 48 } });
    const place = hearingViewOf({ answers: sig.row.answers }, sig.place)!.rows.find((r) => r.field === "place")!;
    expect(place.position).toEqual({ lat: HERE.lat, lng: HERE.lng, accuracyM: 48 });
    expect(positionText(48)).toBe("位置 あり（±48 m）");
    expect(coordText(HERE)).toBe("33.83010, 132.76120");
    const html = renderToStaticMarkup(
      createElement(Hearing, { signalId: sig.id, source: { answers: sig.row.answers }, place: sig.place }),
    );
    expect(html).toContain("位置 あり（±48 m）");
    expect(html).toContain("33.83010, 132.76120");

    const pins = mapPins(data.rows, "tier", data.rows.flatMap((r) => (r.triage ? [r.triage] : [])));
    const pin = pins.find((p) => p.id === "p-01")!;
    expect(pin.location).toEqual({ lat: HERE.lat, lng: HERE.lng });
    expect(pin.title.endsWith("申告位置")).toBe(true);
    // 位置を送っていない人は台帳の位置のまま
    const other = pins.find((p) => p.id === "p-02")!;
    expect(other.location).toEqual(SEED_PEOPLE[1].ledger.basic.location);
    expect(other.title).not.toContain("申告位置");
  });

  it("位置は色と順に使わない（ルールの表の入力の型に無い。位置の有無で色・理由・順が同じ）", async () => {
    type Leak<T> = Extract<keyof T, "reported_lat" | "reported_lng" | "reported_accuracy_m" | "reported_at" | "reported">;
    expectTypeOf<Leak<SignalForTriage>>().toEqualTypeOf<never>();
    expectTypeOf<Leak<TriageSignal>>().toEqualTypeOf<never>();
    await quake();
    await red(1);
    const before = (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, "2026-11-04", atH(1.1)))!;
    expect((await locationPost(db, selfP, sid(1), HERE)).status).toBe(200);
    const after = (await loadCaseload(db, { officeId: "office-demo", careManagerId: "acct-yamamoto" }, "2026-11-04", atH(1.1)))!;
    expect(after.rows.map((r) => [r.id, r.rank, r.triage])).toEqual(before.rows.map((r) => [r.id, r.rank, r.triage]));
  });
});
