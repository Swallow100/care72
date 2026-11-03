// T69b 本人・家族のスマホの中身（docs/tasks/T69b.md）。いちばん大事な線をここで縛る:
// - 選択肢の色（tone）は見た目の印で、ルールの表の入力ではない。赤は表が至急にする答えだけ。体の訴え・場所・わからない・とばすには色を付けない
// - 送る答え（answers）に色は入らない。lib/triage のどのファイルも tone を読まない

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { FamilyView } from "../../components/phone/FamilyView.tsx";
import { PhoneView, type PhoneActions } from "../../components/phone/PhoneView.tsx";
import type { TriageSignal } from "../triage/index.ts";
import type { FamilyScreen } from "./family.ts";
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
  legacyColumnsOf,
  parseAnswers,
  QUESTIONS,
  UNKNOWN_CHOICE,
  type Answer,
  type Answers,
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

  it("本人・家族の画面: 選択肢は全部灰の枠、印のある答えだけ data-tone。言葉はそのまま", () => {
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
    expect(html.match(/phone-choice/g)).toHaveLength(3);
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

  it("phone.css に帯の決まり（状態の色の変数だけ。薄い下地は使わない）", () => {
    const css = readFileSync(join(ROOT, "components/phone/phone.css"), "utf8");
    expect(css).toMatch(/\.phone-choice\s*\{\s*border: 1\.5px solid/);
    expect(css).toContain('[data-tone="urgent"]');
    expect(css).toContain("var(--state-urgent)");
    expect(css).toContain("var(--state-check)");
    expect(css).toContain("var(--state-ok)");
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
