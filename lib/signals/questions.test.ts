// 赤のあとの聞き取りの問いの表（T49）と、いちばん大事な線: 聞き取りの答えもメモも、色・連絡の順・119 の出し方に渡さない。
// からだの訴え（息が くるしい・胸が いたい）はアドバイザーの NG 例（「息が苦しい」と聞いた AI が危険と判断して 119 を案内する）と
// 同じ言葉なので、「記録して見せるだけ」をここで守る。

import { describe, expect, expectTypeOf, it } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { HEARING_FIELD_LABELS, HEARING_LABELS } from "../labels.ts";
import { kanjiWithoutRuby, easy } from "../forms/easy-words.ts";
import { toTriageSignal, triageInDisaster, type SignalForTriage } from "../disaster/triage.ts";
import { toTriagePerson } from "../triage/from-ledger.ts";
import type { Situation, TriageSignal } from "../triage/index.ts";
import { hearingViewOf, readMemo } from "./hearing.ts";
import {
  allQuestionMarkups,
  allQuestionStrings,
  firstQuestion,
  HEARING_FIELDS,
  legacyColumnsOf,
  matchVoiceAnswer,
  nextQuestion,
  parseAnswers,
  QUESTION_IDS,
  QUESTIONS,
  questionOf,
  UNKNOWN_CHOICE,
  voiceTextOf,
  type Asker,
  type QuestionId,
} from "./questions.ts";
import { allPhoneWords } from "./phrases.ts";

const ASKERS: Asker[] = [
  { who: "self", hasDevice: true },
  { who: "self", hasDevice: false },
  { who: "family", hasDevice: true },
  { who: "family", hasDevice: false },
];

const BANNED = ["緊急度", "重症", "判定", "診断", "点数", "重さ"] as const;

describe("問いの表", () => {
  it("id は重ならず、表の順は QUESTION_IDS と同じ。欄は全部どれかの問いが埋める", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual([...QUESTION_IDS]);
    for (const f of HEARING_FIELDS) expect(QUESTIONS.some((q) => q.field === f), f).toBe(true);
  });

  it("どの問いにも「わからない」。選択肢は 2 つ以上（わからない のほか）、id は問いの中で重ならない", () => {
    for (const q of QUESTIONS) {
      expect(q.choices.some((c) => c.id === UNKNOWN_CHOICE), q.id).toBe(true);
      expect(q.choices.filter((c) => c.id !== UNKNOWN_CHOICE).length, q.id).toBeGreaterThanOrEqual(2);
      expect(new Set(q.choices.map((c) => c.id)).size, q.id).toBe(q.choices.length);
    }
  });

  it("枝が閉じている: どの答え・とばすも、表にある問いか終わりに着く。どの人でも、どの道でも終わる（回らない）", () => {
    const ids = new Set<string>(QUESTION_IDS);
    for (const q of QUESTIONS) {
      if (q.next !== null) expect(ids.has(q.next), `${q.id}.next`).toBe(true);
      for (const c of q.choices) if (c.next) expect(ids.has(c.next), `${q.id}.${c.id}`).toBe(true);
    }
    for (const a of ASKERS) {
      // 深さ優先でたどり、たどっている途中の問いにもう一度着いたら回っている（全部の道は数が多いので、問いごとに 1 回）
      const done = new Set<QuestionId>();
      const onPath = new Set<QuestionId>();
      const walk = (id: QuestionId | null) => {
        if (id === null || done.has(id)) return;
        expect(onPath.has(id), `${JSON.stringify(a)} ${id} で回る`).toBe(false);
        onPath.add(id);
        for (const c of [null, ...questionOf(id).choices.map((x) => x.id)]) walk(nextQuestion(id, c, a));
        onPath.delete(id);
        done.add(id);
      };
      walk(firstQuestion(a));
      expect(done.size).toBeGreaterThan(5);
    }
  });

  it("機器の問いは台帳に機器がある人だけ。家族には 連絡手段・頼みごと を聞かない", () => {
    const reach = (a: Asker) => {
      const seen = new Set<QuestionId>();
      const walk = (id: QuestionId | null) => {
        if (id === null || seen.has(id)) return;
        seen.add(id);
        for (const c of [null, ...questionOf(id).choices.map((x) => x.id)]) walk(nextQuestion(id, c, a));
      };
      walk(firstQuestion(a));
      return seen;
    };
    expect(reach({ who: "self", hasDevice: true }).has("device")).toBe(true);
    expect(reach({ who: "self", hasDevice: false }).has("device")).toBe(false);
    // 避難先のある人（T69b）なら全部の問いに着く
    expect(reach({ who: "self", hasDevice: true, shelters: 2 }).size).toBe(QUESTIONS.length);
    expect(reach({ who: "self", hasDevice: true }).has("shelterWhich")).toBe(false);
    const fam = reach({ who: "family", hasDevice: true });
    expect(fam.has("contact") || fam.has("request")).toBe(false);
  });

  it("枝: けが あり → 部位 → 血。家 → 階 → 部屋、家でない → 場所。出られない → 何で", () => {
    const a: Asker = { who: "self", hasDevice: false };
    expect(firstQuestion(a)).toBe("injured");
    expect(nextQuestion("injured", "yes", a)).toBe("injuryPart");
    expect(nextQuestion("injured", "no", a)).toBe("atHome");
    expect(nextQuestion("injured", null, a)).toBe("atHome");
    expect(nextQuestion("injuryPart", "leg", a)).toBe("bleeding");
    expect(nextQuestion("atHome", "yes", a)).toBe("floor");
    expect(nextQuestion("floor", "f2", a)).toBe("room");
    expect(nextQuestion("floor", "outside", a)).toBe("canMove");
    expect(nextQuestion("atHome", "no", a)).toBe("place");
    expect(nextQuestion("exit", "no", a)).toBe("trappedBy");
    expect(nextQuestion("exit", "yes", a)).toBe("body");
    // 機器が無い人は 火・ガス の次が 薬
    expect(nextQuestion("fireGas", "no", a)).toBe("hasMedicine");
    expect(nextQuestion("fireGas", "no", { ...a, hasDevice: true })).toBe("device");
    expect(nextQuestion("request", "none", a)).toBeNull();
  });

  it("問い・選択肢・欄の言葉に「緊急度」「重症」「判定」「診断」「点数」「重さ」が無い", () => {
    const all = [...allQuestionStrings(), ...Object.values(HEARING_FIELD_LABELS), ...Object.values(HEARING_LABELS)];
    for (const t of all) for (const w of BANNED) expect(t, w).not.toContain(w);
  });

  it("本人・家族の画面の問いと選択肢の漢字には全部ふりがな（allPhoneWords にも入っている）", () => {
    expect(kanjiWithoutRuby(allQuestionMarkups().flatMap((m) => easy(m)))).toEqual([]);
    const phone = allPhoneWords().map((w) => w.text).join("");
    expect(phone).toContain("からだで つらい ことは ありますか");
  });
});

describe("今の 4 問の列", () => {
  it("はい・いいえ だけを 4 つの列に。わからない・答えなし・ほかの問いは null のまま", () => {
    expect(
      legacyColumnsOf({
        injured: { choice: "yes", via: "press" },
        atHome: { choice: "no", via: "voice" },
        canMove: { choice: UNKNOWN_CHOICE, via: "press" },
        body: { choice: "breath", via: "press" },
      }),
    ).toEqual({ injured: true, atHome: false, canMove: null, hasMedicine: null });
    expect(legacyColumnsOf({})).toEqual({ injured: null, atHome: null, canMove: null, hasMedicine: null });
  });

  it("送られた答えの確かめ: 知らない問い・知らない選択肢・形の違いは断る", () => {
    expect(parseAnswers({ injured: { choice: "yes", via: "press" } })).toEqual({ injured: { choice: "yes", via: "press" } });
    expect(parseAnswers({ severity: { choice: "yes", via: "press" } })).toBeNull();
    expect(parseAnswers({ injured: { choice: "big", via: "press" } })).toBeNull();
    expect(parseAnswers({ injured: { choice: "yes", via: "claude" } })).toBeNull();
    expect(parseAnswers([])).toBeNull();
  });
});

describe("声の答え（言葉の一致だけ。Claude は使わない）", () => {
  it("はい・うん・ある → はい の側、いいえ・ない → いいえ の側", () => {
    expect(matchVoiceAnswer("はい", "injured")).toBe("yes");
    expect(matchVoiceAnswer("うん", "hasMedicine")).toBe("yes");
    expect(matchVoiceAnswer("あります", "hasMedicine")).toBe("yes");
    expect(matchVoiceAnswer("いいえ", "injured")).toBe("no");
    expect(matchVoiceAnswer("ない", "hasMedicine")).toBe("no");
  });

  it("選択肢の言葉（漢字でも）。「動けない」を「動ける」に、「わからない」を「いいえ」に取らない", () => {
    expect(matchVoiceAnswer("動けない", "canMove")).toBe("no");
    expect(matchVoiceAnswer("うごける", "canMove")).toBe("yes");
    expect(matchVoiceAnswer("わからない", "canMove")).toBe(UNKNOWN_CHOICE);
    expect(matchVoiceAnswer("足を打った", "injuryPart")).toBe("leg");
    expect(matchVoiceAnswer("寝室です", "room")).toBe("bedroom");
    expect(matchVoiceAnswer("胸が痛い", "body")).toBe("chest");
    expect(matchVoiceAnswer("ひざまで", "water")).toBe("knee");
  });

  it("無言・関係の無い言葉は null（答えなしで次へ）", () => {
    expect(matchVoiceAnswer(null, "injured")).toBeNull();
    expect(matchVoiceAnswer("   ", "injured")).toBeNull();
    expect(matchVoiceAnswer("あー", "injured")).toBeNull();
  });

  it("読む文は問いと選択肢（ふりがなを落とす）。名前を入れない", () => {
    expect(voiceTextOf("canMove")).toBe("動けますか。動ける、動けない、わからない");
    expect(voiceTextOf("bleeding")).toBe("血は出ていますか。出ている、出ていない、わからない");
  });
});

describe("いちばん大事な線: 聞き取りは色・順・119 に渡さない", () => {
  it("型: ルールの表の入力（TriageSignal・SignalForTriage）に answers・ai_memo・memo が無い", () => {
    expectTypeOf<"answers" | "ai_memo" | "memo">().not.toMatchTypeOf<keyof SignalForTriage>();
    expectTypeOf<"answers" | "memo" | "aiMemo" | "hearing">().not.toMatchTypeOf<keyof TriageSignal>();
    // 1 つずつも
    expectTypeOf<keyof SignalForTriage>().not.toEqualTypeOf<"answers">();
    type NoHearing<T> = Extract<keyof T, "answers" | "ai_memo" | "memo" | "aiMemo" | "hearing">;
    expectTypeOf<NoHearing<SignalForTriage>>().toEqualTypeOf<never>();
    expectTypeOf<NoHearing<TriageSignal>>().toEqualTypeOf<never>();
  });

  const T0 = Date.parse("2026-11-02T06:00:00.000Z");
  const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
  const situation: Situation = { now: iso(1), disasterAt: iso(0), outageAt: null };

  const base: SignalForTriage = {
    person_id: "p-01",
    color: "red",
    source: "self",
    injured: null,
    can_move: null,
    classes: null,
    classified_by: null,
    occurred_at: iso(0.5),
  };

  /** 同じ信号に、からだの訴え（息がくるしい・胸がいたい）の答えと Claude のメモと直した欄を足した物 */
  const withHearing = {
    ...base,
    answers: JSON.stringify({
      body: { choice: "breath", via: "press" },
      trappedBy: { choice: "furniture", via: "voice" },
      fireGas: { choice: "yes", via: "press" },
    }),
    ai_memo: JSON.stringify({ body: "息が苦しい", injury: "胸が痛い", trapped: "タンスに挟まれて" }),
    memo: JSON.stringify({ request: "すぐ来てほしい" }),
  };

  it("入力: 答え・メモのある信号も無い信号も、表の入力は同じ", () => {
    expect(toTriageSignal(withHearing)).toEqual(toTriageSignal(base));
  });

  it("出力: 色・行・組・理由・足す言葉が、聞き取りの有り無しで変わらない（10 人とも）", () => {
    for (const p of SEED_PEOPLE) {
      const person = toTriagePerson(p);
      const plain = triageInDisaster({ person, signals: [toTriageSignal({ ...base, person_id: person.id })], town: null }, situation);
      const heard = triageInDisaster(
        { person, signals: [toTriageSignal({ ...withHearing, person_id: person.id })], town: null },
        situation,
      );
      expect(heard, person.id).toEqual(plain);
    }
  });

  it("からだの訴えは記録して見せるだけ: 欄に本人の押した言葉と Claude の写しが出る（重さは付けない）", () => {
    const v = hearingViewOf(withHearing)!;
    const body = v.rows.find((r) => r.field === "body")!;
    expect(body.answers).toEqual([{ question: "体の訴え", choice: "息がくるしい", via: "press", unknown: false }]);
    // 押した答えがある欄は Claude の写しを出さない（人が押した物が先）
    expect(body.text).toBeNull();
    // 押していない欄は Claude の写し（AI の印）
    expect(v.rows.find((r) => r.field === "injury")).toMatchObject({ text: "胸が痛い", textBy: "ai" });
    // 直した欄は人の値
    expect(v.rows.find((r) => r.field === "request")).toMatchObject({ text: "すぐ来てほしい", textBy: "human" });
    for (const r of v.rows) for (const w of BANNED) expect(JSON.stringify(r)).not.toContain(w);
  });
});

describe("聞き取りの欄の形", () => {
  it("答えもメモも無い信号は欄を出さない", () => {
    expect(hearingViewOf({ answers: null, ai_memo: null, memo: null })).toBeNull();
    expect(hearingViewOf({})).toBeNull();
  });

  it("「わからない」だけの欄は Claude の写しで埋める。直した欄を空にしたら AI の写しも出さない", () => {
    const v = hearingViewOf({
      answers: JSON.stringify({ canMove: { choice: UNKNOWN_CHOICE, via: "voice" } }),
      ai_memo: JSON.stringify({ trapped: "足が抜けない", water: "床まで水" }),
      memo: JSON.stringify({ water: null }),
    })!;
    expect(v.rows.find((r) => r.field === "trapped")).toMatchObject({ text: "足が抜けない", textBy: "ai" });
    expect(v.rows.find((r) => r.field === "water")).toMatchObject({ text: null, textBy: "human" });
  });

  it("メモの読み方: 知らない欄・文でない値は捨てる、長すぎる文は切る", () => {
    expect(readMemo(JSON.stringify({ place: "台所", severity: "高", water: 3 }))).toEqual({ place: "台所" });
    expect(readMemo("壊れた")).toEqual({});
    expect(Array.from(readMemo(JSON.stringify({ place: "あ".repeat(100) })).place!).length).toBe(60);
  });
});
