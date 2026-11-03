// T77（docs/progress/qa-20261104.md の中 14）: 赤のあとの問いを減らし、押せる人・マイクの無い人に声の問いと聞き直しを挟まない。
// ルールの表が読む答え（けが・動けるか）はどの道でも聞く。119 の 1 行と色・連絡順には触れない（この作業は問いの数と流れだけ）。
// 録音・定型文・文字起こし・読み上げは偽物、時計は偽の時計。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { phoneBlocks } from "../../components/phone/PhoneSheet.tsx";
import type { ContactKind, ContactReach } from "../db/types.ts";
import type { OwnBlock } from "../forms/own-sheet.ts";
import { PHONE_LINK_LABELS } from "../qr/phone-labels.ts";
import { contactSmartphone, isFamilyLinkContact } from "../qr/phone-link-view.ts";
import type { SignalBody } from "./body.ts";
import { createFamilyPhone, type FamilyState } from "./family-phone.ts";
import { createPhone, IDLE_MS, RECORD_MS, type PhoneDeps, type PhoneState, type TranscriptEvents } from "./phone.ts";
import {
  answeredOutside,
  firstQuestion,
  nextQuestion,
  questionOf,
  rushesToRecording,
  rushNext,
  type Answers,
  type Asker,
  type QuestionId,
} from "./questions.ts";

const T0 = Date.parse("2026-11-04T01:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

// ---------- 問いの表（数と、表が読む 2 問） ----------

/** 押す画面の流れと同じ進み方（答えを足してから次。録音へ急ぐ答えは rushNext）で、問いの並びを返す */
function walk(a: Asker, pick: Partial<Record<QuestionId, string>>): QuestionId[] {
  const seen: QuestionId[] = [];
  let answers: Answers = {};
  let rushing = false;
  let id = firstQuestion(a);
  while (id !== null && seen.length < 40) {
    seen.push(id);
    const choice = pick[id] ?? null;
    if (choice !== null) answers = { ...answers, [id]: { choice, via: "press" as const } };
    if (rushesToRecording(id, choice)) rushing = true;
    id = rushing ? rushNext(id, answers, a) : nextQuestion(id, choice, a, answers);
  }
  return seen;
}

/** 何も困っていない人の答え（録音へ急ぐ答えを押さない） */
const FINE = {
  injured: "no",
  atHome: "yes",
  floor: "f1",
  room: "living",
  place: "shelter",
  shelterWhich: "d1",
  canMove: "yes",
  exit: "yes",
  body: "none",
  water: "none",
  fireGas: "no",
  device: "running",
  hasMedicine: "yes",
  nearby: "alone",
  contact: "phone",
  request: "none",
} as const satisfies Partial<Record<QuestionId, string>>;

describe("問いの数（山田 ハナ: 機器あり・避難先 1 つ）", () => {
  const self: Asker = { who: "self", hasDevice: true, shelters: 1 };
  const family: Asker = { who: "family", hasDevice: true, shelters: 1 };

  it("本人: 家 13 問・避難所 12 問・車 11 問（前は 14・14・13）。マイクが無ければ「はなす」を聞かず 1 問少ない", () => {
    expect(walk(self, FINE)).toEqual([
      "injured", "atHome", "floor", "room", "canMove", "exit", "body", "water", "fireGas", "device", "hasMedicine", "nearby", "request",
    ]);
    expect(walk(self, { ...FINE, atHome: "no" })).toEqual([
      "injured", "atHome", "place", "shelterWhich", "canMove", "body", "water", "fireGas", "device", "hasMedicine", "nearby", "request",
    ]);
    expect(walk(self, { ...FINE, atHome: "no", place: "car" })).toHaveLength(11);
    const noMic = { ...self, mic: false };
    expect(walk(noMic, FINE)).toHaveLength(12);
    expect(walk(noMic, FINE)).not.toContain("request");
    expect(walk(noMic, { ...FINE, atHome: "no" })).toHaveLength(11);
  });

  it("家族: 家 12 問・避難所 11 問（前は 12・12）。連絡手段・頼みごとは前から聞かない", () => {
    expect(walk(family, FINE)).toHaveLength(12);
    expect(walk(family, { ...FINE, atHome: "no" })).toHaveLength(11);
  });

  it("連絡手段は押す画面では聞かない（このスマホで押せている事が答え）。声の問いでは今までどおり聞く", () => {
    expect(walk(self, FINE)).not.toContain("contact");
    expect(walk({ ...self, voice: true }, FINE)).toContain("contact");
  });

  it("外に 出られますか は、家の外・避難所・車にいると答えた人には聞かない（答えから決まる）。家の中なら聞く", () => {
    expect(answeredOutside({ atHome: { choice: "no", via: "press" } })).toBe(true);
    expect(answeredOutside({ atHome: { choice: "yes", via: "press" }, floor: { choice: "outside", via: "press" } })).toBe(true);
    expect(answeredOutside({ atHome: { choice: "yes", via: "press" }, floor: { choice: "f2", via: "press" } })).toBe(false);
    expect(answeredOutside({ atHome: { choice: "unknown", via: "press" } })).toBe(false);
    expect(walk(self, { ...FINE, floor: "outside" })).not.toContain("exit");
    expect(walk(self, { ...FINE, atHome: "unknown" })).toContain("exit");
    // 家の中で出られない → 何で（今までどおり）
    expect(nextQuestion("exit", "no", self, { atHome: { choice: "yes", via: "press" } })).toBe("trappedBy");
  });

  it("ルールの表が読む 2 問（けが・動けるか）は、どの答え・とばす・どの人・マイクの有無でも必ず聞く", () => {
    const askers: Asker[] = [];
    for (const who of ["self", "family"] as const)
      for (const hasDevice of [true, false])
        for (const shelters of [0, 2])
          for (const extra of [{}, { voice: true }, { mic: false }]) askers.push({ who, hasDevice, shelters, ...extra });
    let ends = 0;
    for (const a of askers) {
      // 全部の道（選択肢ととばす）を、答えを足しながらたどる。道の数は多いので、次の問いを決める物（今の問い・急いでいるか・
      // 外にいると答えたか・動けるかを答えたか）と、けが・動けるかを聞いたかが同じ所は 1 回だけ見る
      const seen = new Set<string>();
      const go = (id: QuestionId | null, answers: Answers, rushing: boolean, path: QuestionId[]) => {
        const sawInjured = path.includes("injured");
        const sawCanMove = path.includes("canMove");
        const key = [id, rushing, answeredOutside(answers), "canMove" in answers, sawInjured, sawCanMove].join("|");
        if (seen.has(key)) return;
        seen.add(key);
        if (id === null) {
          ends++;
          expect(sawInjured, `${JSON.stringify(a)} ${path.join(">")}`).toBe(true);
          expect(sawCanMove, `${JSON.stringify(a)} ${path.join(">")}`).toBe(true);
          return;
        }
        expect(path.length).toBeLessThan(25);
        // 外にいると答えたあとに 外に出られますか を聞かない
        if (id === "exit") expect(answeredOutside(answers), `${JSON.stringify(a)} ${path.join(">")}`).toBe(false);
        for (const c of [null, ...questionOf(id).choices.map((x) => x.id)]) {
          const next = c === null ? answers : { ...answers, [id]: { choice: c, via: "press" as const } };
          const r = rushing || rushesToRecording(id, c);
          go(r ? rushNext(id, next, a) : nextQuestion(id, c, a, next), next, r, [...path, id]);
        }
      };
      go(firstQuestion(a), {}, false, []);
    }
    expect(ends).toBeGreaterThan(askers.length);
  });
});

// ---------- 本人のスマホの流れ ----------

type Harness = {
  phone: ReturnType<typeof createPhone>;
  states: PhoneState[];
  signals: SignalBody[];
  calls: string[];
  spoken: string[];
  events: TranscriptEvents[];
  recordings: number;
};

function harness(over: Partial<PhoneDeps> = {}, transcript: Array<string | null> = []): Harness {
  const h: Harness = { phone: null as never, states: [], signals: [], calls: [], spoken: [], events: [], recordings: 0 };
  let n = 0;
  h.phone = createPhone({
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    sendSignal: async (b) => {
      h.signals.push(b);
      return "sent";
    },
    sendRecording: async () => {
      h.recordings++;
      return "sent";
    },
    sendAnswers: async () => "sent",
    prime: () => void h.calls.push("prime"),
    playPrompt: async () => void h.calls.push("prompt"),
    startRecording: async () => {
      h.calls.push("record");
      return { stop: async () => new Blob([new Uint8Array([1])], { type: "audio/webm" }), pause() {}, resume() {} };
    },
    startTranscript: (events) => {
      const i = h.events.length;
      h.events.push(events);
      h.calls.push("transcript");
      return { stop: async () => transcript[i] ?? null };
    },
    onChange: (s) => h.states.push(s),
    ...over,
  });
  return h;
}

const steps = (h: Harness) => h.states.map((s) => (s.step === "question" ? `q:${s.id}${s.voice ? `:${s.voice}` : ""}` : s.step));

describe("押せる人には声の問いと聞き直しを挟まない", () => {
  it("1 つ押したら、止まっても声の問い・定型文へ替えない（読み上げのある端末でも）", async () => {
    const s = harness({ speak: async (t) => void s.spoken.push(t) });
    s.phone.red();
    s.phone.answer("no");
    vi.advanceTimersByTime(IDLE_MS * 10);
    await flush();
    expect(s.phone.state).toMatchObject({ step: "question", id: "atHome", voice: null });
    expect(s.spoken).toEqual([]);
    expect(s.calls).toEqual(["prime"]);
    // とばすも押した事になる
    const k = harness({ speak: async (t) => void k.spoken.push(t) });
    k.phone.red();
    k.phone.skip();
    vi.advanceTimersByTime(IDLE_MS * 10);
    await flush();
    expect(k.spoken).toEqual([]);
  });

  it("押して録音へ（動けない）: 無音でも定型文で聞き直さず、ブラウザの無音で閉じない。60 秒で録音を送る", async () => {
    const h = harness({}, [null]);
    h.phone.red();
    for (const c of ["no", "yes", "f1", "living", "no"]) h.phone.answer(c);
    await flush();
    expect(h.phone.state.step).toBe("recording");
    // 押せる人の文字起こしには無音の知らせを渡さない（ブラウザが続きから聞き直す）
    expect(h.events).toHaveLength(1);
    expect(h.events[0].onSilence).toBeUndefined();
    expect(typeof h.events[0].onText).toBe("function");
    vi.advanceTimersByTime(RECORD_MS);
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent", silent: true });
    expect(h.calls.filter((c) => c === "prompt")).toHaveLength(1);
    expect(h.recordings).toBe(1);
  });

  it("押せない人（1 つも押さずに 20 秒）は今までどおり声の問いへ（無音の聞き直しの知らせも渡す）", async () => {
    const v = harness({ speak: async (t) => void v.spoken.push(t) });
    v.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(v.phone.state).toMatchObject({ step: "question", id: "injured", voice: "listening" });
    expect(v.spoken[0]).toContain("けがはありますか");
    expect(typeof v.events[0].onSilence).toBe("function");
  });
});

describe("マイクが無い・許されていないときは声の問いに入らない", () => {
  it("赤を押した時の許可が false: 20 秒止まっても声の問い・定型文に入らず、押せばそのまま。「はなす」は聞かずに とどきました", async () => {
    const m = harness({ micReady: async () => false, speak: async (t) => void m.spoken.push(t) });
    m.phone.red();
    await flush();
    vi.advanceTimersByTime(IDLE_MS * 3);
    await flush();
    expect(m.phone.state).toMatchObject({ step: "question", id: "injured", voice: null });
    expect(m.spoken).toEqual([]);
    for (let i = 0; i < 30 && m.phone.state.step === "question"; i++) {
      const id = (m.phone.state as { id: QuestionId }).id;
      m.phone.answer(FINE[id as keyof typeof FINE] ?? "unknown");
    }
    await flush();
    expect(steps(m)).not.toContain("q:request");
    expect(steps(m)).not.toContain("prompt");
    expect(m.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(m.calls).toEqual(["prime"]);
  });

  it("許可が false で録音へ急ぐ答え（動けない）: 話してもらう定型文を流さず、送った赤と答えで とどきました", async () => {
    const h = harness({ micReady: async () => false });
    h.phone.red();
    await flush();
    for (const c of ["no", "yes", "f1", "living", "no"]) h.phone.answer(c);
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.calls).toEqual(["prime"]);
    expect(h.recordings).toBe(0);
  });

  it("点検の端末（読み上げあり・マイクなし・文字起こしの道はある）: 20 秒で声の問いに入らず、定型文の聞き直しも無い", async () => {
    const h = harness({ startRecording: async () => null }, [null, null, null]);
    const q = harness({ startRecording: async () => null, speak: async (t) => void q.spoken.push(t) }, [null, null, null]);
    q.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(q.phone.state).toMatchObject({ step: "question", id: "injured", voice: null });
    expect(q.spoken).toEqual([]);
    // 押し通すと「はなす」は聞かず、すぐ とどきました（前は声の問いと聞き直しで約 2 分）
    for (let i = 0; i < 30 && q.phone.state.step === "question"; i++) {
      const id = (q.phone.state as { id: QuestionId }).id;
      q.phone.answer(FINE[id as keyof typeof FINE] ?? "unknown");
    }
    await flush();
    expect(q.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(q.calls).toEqual(["prime"]);
    // 読み上げの無い端末で押さずに 20 秒（定型文へ）でも、マイクが無ければ聞き直さずに とどきました
    h.phone.red();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(h.phone.state).toEqual({ step: "done", color: "red", delivery: "sent" });
    expect(h.calls.filter((c) => c === "prompt")).toHaveLength(1);
    expect(h.calls).not.toContain("transcript");
  });

  it("許可は通っていて録音（MediaRecorder）だけ無い端末は、今までどおり声の問い（文字起こしで聞く）", async () => {
    const v = harness({ micReady: async () => true, startRecording: async () => null, speak: async (t) => void v.spoken.push(t) });
    v.phone.red();
    await flush();
    vi.advanceTimersByTime(IDLE_MS);
    await flush();
    expect(v.phone.state).toMatchObject({ step: "question", id: "injured", voice: "listening" });
    expect(v.spoken).toHaveLength(1);
  });
});

describe("家族のスマホ", () => {
  it("家でないと答えたら 外に出られますか を聞かない（場所 → 動けるか → 体）", () => {
    const states: FamilyState[] = [];
    const f = createFamilyPhone({
      sendSignal: async () => "sent",
      sendAnswers: async () => "sent",
      onChange: (s) => states.push(s),
    });
    f.answer("red");
    for (const c of ["no", "no", "car", "yes"]) f.choose(c);
    expect(f.state).toMatchObject({ step: "question", id: "body" });
    expect(states.map((s) => (s.step === "question" ? s.id : s.step))).toEqual(["injured", "atHome", "place", "canMove", "body"]);
  });
});

// ---------- 低の 3 つ（スマホ入口の家族用・スマホの印・平時の電話の段） ----------

describe("スマホ入口の家族用は 家族・同居・緊急連絡先だけ", () => {
  const c = (kind: ContactKind, reach: ContactReach | null, emergency_order: number | null) => ({ kind, reach, emergency_order });
  it("家族は距離・緊急連絡先によらず出す。支援者・民生委員は同居か緊急連絡先のときだけ。本人の電話・機関は出さない", () => {
    expect(isFamilyLinkContact(c("family", "far", null))).toBe(true);
    expect(isFamilyLinkContact(c("supporter", "nearby", null))).toBe(false);
    expect(isFamilyLinkContact(c("welfare_commissioner", "nearby", null))).toBe(false);
    expect(isFamilyLinkContact(c("supporter", "together", null))).toBe(true);
    expect(isFamilyLinkContact(c("supporter", "nearby", 2))).toBe(true);
    expect(isFamilyLinkContact(c("self", "together", 1))).toBe(false);
    expect(isFamilyLinkContact(c("hospital", null, 1))).toBe(false);
    expect(isFamilyLinkContact(c("care_service", "in_city", 1))).toBe(false);
  });

  it("スマホの印は本人と同じ「スマホ 使用可」の形（前は家族だけ「スマホ有」）。分からなければ出さない", () => {
    expect(contactSmartphone(1)).toBe("スマホ 使用可");
    expect(contactSmartphone(0)).toBe("スマホ なし");
    expect(contactSmartphone(null)).toBeNull();
    expect(Object.values(PHONE_LINK_LABELS)).not.toContain("スマホ有");
  });
});

describe("本人・家族のスマホの平時の電話の段は番号のある行だけ", () => {
  const w = (text: string) => [{ text }];
  const block = (id: OwnBlock["id"], lines: OwnBlock["lines"]): OwnBlock => ({ id, heading: w(id), lines });
  it("番号の無い行（ケアマネ・かかりつけの手書きの線）は出さず、番号のある行は出す。電話でない段の番号なしの行はそのまま", () => {
    const blocks = [
      block("who", [{ key: "who.1", words: w("娘"), phone: { number: null } }]),
      block("call", [
        { key: "call.cm", words: w("ケアマネジャー"), phone: { number: null } },
        { key: "call.dialysis.c-1", words: w("透析"), phone: { number: "090-0000-0031" } },
      ]),
    ];
    expect(phoneBlocks(blocks).map((b) => [b.id, b.lines.map((l) => l.key)])).toEqual([
      ["who", ["who.1"]],
      ["call", ["call.dialysis.c-1"]],
    ]);
    expect(phoneBlocks([block("call", [{ key: "call.cm", words: w("ケアマネジャー"), phone: { number: null } }])])).toEqual([]);
  });
});
