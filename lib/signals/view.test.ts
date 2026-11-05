// 本人のスマホの画面（docs/tasks/T10.md）を静的に描いて確かめる: どの画面もボタンは 2〜3 つで戻るが無い、
// 赤緑の 2 つだけを面で塗る、AI が きいています の印、119 の 1 行は赤を押したあとの全部の画面（AI の出力で出し分けない）、本人の状態の判定の言葉を出さない、
// 平時は本人の 1 枚（T06）と同じ文。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhoneSheet, phoneBlocks } from "../../components/phone/PhoneSheet.tsx";
import { PhoneView, type PhoneActions } from "../../components/phone/PhoneView.tsx";
import { SEED_AT, seedConsents } from "../../seed/people.ts";
import { buildOwnSheet, EMERGENCY_TEXT, lineText } from "../forms/own-sheet.ts";
import type { PersonPageRows } from "../person.ts";
import { createPhone, type PhoneState } from "./phone.ts";
import { choicesFor, QUESTIONS, type QuestionId } from "./questions.ts";
// T142 で種の台帳を埋めた。このテストは空いた欄を前提にするので、T142 より前の空きの多い形（seed/sparse.ts）を使う
import { SPARSE_PEOPLE } from "../../seed/sparse.ts";

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

const T = Date.parse("2026-11-04T01:00:00.000Z");
const view = (state: PhoneState, nowMs = T) => renderToStaticMarkup(createElement(PhoneView, { state, nowMs, on: noop }));
/** ふりがなと札を落とした文字 */
const text = (html: string) => html.replace(/<rt>[^<]*<\/rt>|<rp>[^<]*<\/rp>/g, "").replace(/<[^>]+>/g, "");
const buttons = (html: string) => [...html.matchAll(/<button[^>]*data-choice="([^"]+)"/g)].map((m) => m[1]);
/** 119 の 1 行の文字 */
const E = "命が 危ないと 感じたら、すぐ 119番へ";
/** AI の告知の文字（T48） */
const N = "これは AI（人では ない しくみ）が 聞いています。こたえは ケアマネジャーに とどきます";

/** 問いの画面（T49）。first は赤の流れの最初の問い、voice は声の問いの段 */
const q = (id: QuestionId, over: Partial<Extract<PhoneState, { step: "question" }>> = {}): PhoneState => ({
  step: "question",
  id,
  answers: {},
  first: false,
  voice: null,
  ...over,
});

const STATES: PhoneState[] = [
  { step: "top" },
  { step: "where" },
  q("injured", { first: true }),
  ...QUESTIONS.slice(1).map((x) => q(x.id)),
  q("canMove", { voice: "speaking" }),
  q("canMove", { voice: "listening" }),
  // いまの 場所を おくりますか（T69b）
  { step: "locate", answers: {} },
  { step: "prompt" },
  { step: "recording", startedAt: T, until: T + 30_000 },
  { step: "sending", color: "red" },
  { step: "done", color: "red", delivery: "sent" },
  { step: "done", color: "red", delivery: "sent", silent: true },
  { step: "done", color: "green", delivery: "queued" },
];

describe("災害モードの画面", () => {
  it("上は「無事」緑と「無事じゃない」赤の 2 つだけ。面で塗るのはこの 2 つ", () => {
    const html = view({ step: "top" });
    expect(buttons(html)).toEqual(["green", "red"]);
    expect(text(html)).toBe("無事無事じゃない");
    expect(html).toContain("phone-fill-ok");
    expect(html).toContain("phone-fill-urgent");
    for (const s of STATES.slice(1)) {
      const h = view(s);
      expect(h, s.step).not.toContain("phone-fill-");
    }
  });

  it("緑の 1 問: どこに いますか（家・避難所・ほかの ところ）", () => {
    const html = view({ step: "where" });
    expect(buttons(html)).toEqual(["home", "shelter", "other"]);
    expect(text(html)).toBe("どこに いますか家避難所ほかの ところ");
  });

  it("赤は 1 画面 1 問（T49 の表）: 問い・選択肢（わからない を含む）・とばす・119 の 1 行。最初の問いだけ AI の告知", () => {
    expect(text(view(q("injured", { first: true })))).toBe(N + "けがは ありますかあるないわからないとばす" + E);
    expect(text(view(q("canMove")))).toBe("動けますか動ける動けないわからないとばす" + E);
    expect(buttons(view(q("canMove")))).toEqual(["yes", "no", "unknown", "skip"]);
    expect(text(view(q("body")))).toBe("からだで つらい ことは ありますか息が くるしい胸が いたいめまいはきけないほかわからないとばす" + E);
    // 選択肢の多い問いは 2 列
    expect(view(q("room"))).toContain("grid-cols-2");
    expect(view(q("canMove"))).not.toContain("grid-cols-2");
  });

  it("声の問い（20 秒押さないとき）は「AI が きいています」を上に。押すボタンはそのまま", () => {
    for (const voice of ["speaking", "listening"] as const) {
      const html = view(q("canMove", { voice }));
      expect(html).toContain('data-ai="listening"');
      expect(buttons(html)).toEqual(["yes", "no", "unknown", "skip"]);
    }
    expect(view(q("canMove"))).not.toContain("data-ai");
  });

  it("録っている間は「AI が きいています」と定型文と残りの秒、延長と送る", () => {
    const html = view({ step: "recording", startedAt: T, until: T + 30_000 }, T + 5_200);
    expect(html).toContain('data-ai="listening"');
    expect(text(html)).toBe("AIが きいています大丈夫ですか状況を 説明して くださいあと 25 秒もっと 話す送る" + E);
    expect(html).toContain('<span class="phone-ai">AI</span>');
    expect(buttons(html)).toEqual(["more", "send"]);
    // 数え始める前は 30 秒
    expect(text(view({ step: "recording", startedAt: T, until: T + 30_000 }, 0))).toContain("あと 30 秒");
  });

  it("定型文を流している間は「AI が きいています」の印を出さない（まだ録っていない）。声と同じ AI の告知は出す", () => {
    const html = view({ step: "prompt" });
    expect(html).not.toContain("data-ai");
    expect(text(html)).toBe(N + "大丈夫ですか状況を 説明して ください" + E);
    expect(buttons(html)).toEqual([]);
  });

  it("AI の告知（T48）: 赤の流れの最初（1 問目）と定型文の画面にだけ。2 問目からと録音・緑の画面には出さない", () => {
    const has = (s: PhoneState) => view(s).includes(`data-notice="ai"`);
    expect(has(q("injured", { first: true }))).toBe(true);
    expect(has({ step: "prompt" })).toBe(true);
    for (const s of STATES.filter((x) => !(x.step === "question" && x.first) && x.step !== "prompt")) expect(has(s), JSON.stringify(s)).toBe(false);
    // 流れ（lib/signals/phone.ts）で赤を押すと、どの押し方でも最初の画面は 1 問目（告知つき）。戻る・飛ばす操作は無い
    const phone = createPhone({
      sendSignal: async () => "sent",
      sendRecording: async () => "sent",
      sendAnswers: async () => "sent",
      playPrompt: async () => {},
      startRecording: async () => null,
      onChange: () => {},
    });
    phone.red();
    expect(phone.state).toMatchObject({ step: "question", id: "injured", first: true });
    expect(has(phone.state)).toBe(true);
    phone.dispose();
    // AI の印は告知の中の「AI」に付く
    expect(view({ step: "prompt" })).toContain(`<span class="phone-ai">AI</span>`);
  });

  it("赤の終わりは「とどきました」と 119 の 1 行。緑の終わりに 119 は無い。通信なしは「まだ とどいて いません」", () => {
    const red = view({ step: "done", color: "red", delivery: "sent" });
    expect(text(red)).toBe("とどきました命が 危ないと 感じたら、すぐ 119番へ最初から");
    expect(buttons(red)).toEqual(["again"]);
    // 119 は押してもかからない（リンクにしない）
    expect(red).not.toContain("tel:");
    const green = view({ step: "done", color: "green", delivery: "queued" });
    expect(text(green)).toBe("まだ とどいて いませんつながったら 送ります最初から");
    expect(text(view({ step: "done", color: "red", delivery: "dropped" }))).not.toContain("つながったら");
  });

  it("聞き直しても無音のまま録音だけ送った終わりは「ろくおんを おくりました」と 119 の 1 行（T37）", () => {
    const html = view({ step: "done", color: "red", delivery: "sent", silent: true });
    expect(text(html)).toBe("ろくおんを おくりました命が 危ないと 感じたら、すぐ 119番へ最初から");
    expect(html).toContain("data-silent");
    expect(buttons(html)).toEqual(["again"]);
    // 赤が端末に残っている間は、今まで通り「まだ とどいて いません」
    expect(text(view({ step: "done", color: "red", delivery: "queued", silent: true }))).toBe(
      "まだ とどいて いませんつながったら 送ります命が 危ないと 感じたら、すぐ 119番へ最初から",
    );
  });

  it("どの画面もボタンは 3 つまで（問いは選択肢とわからない・とばす）、戻るは無い。本人の状態の判定の言葉を出さない。漢字には全部ふりがな", () => {
    for (const s of STATES) {
      const html = view(s);
      if (s.step === "question") {
        // 避難所の問い（T69b）は台帳の避難先だけ出す（ここは避難先なし）
        const choices = choicesFor(QUESTIONS.find((x) => x.id === s.id)!).length;
        expect(buttons(html).length, s.id).toBe(choices + 1);
      } else expect(buttons(html).length, s.step).toBeLessThanOrEqual(3);
      const t = text(html);
      for (const w of ["戻る", "至急", "要確認", "不明", "診断", "判定", "重症"]) expect(t, `${s.step} ${w}`).not.toContain(w);
      // ふりがなを落とす前の漢字の数と、ruby の中の漢字の数が同じ
      const bare = html.replace(/<ruby>[\s\S]*?<\/ruby>/g, "").replace(/<[^>]+>/g, "");
      expect(bare.match(/[一-鿿々]/g), s.step).toBeNull();
    }
  });
});

describe("119 の 1 行（T48）", () => {
  // 状態（PhoneState）には録音の中身も分類（AI の出力）も無い。119 を出すかは赤の流れかどうかだけで決まる
  const RED_FLOW: PhoneState[] = [
    q("injured", { first: true }),
    ...QUESTIONS.map((x) => q(x.id, { answers: { injured: { choice: "yes", via: "press" } } })),
    // 声の問いでも、からだの訴えを押したあとでも同じ 1 行（答えで出し分けない）
    q("water", { voice: "listening", answers: { body: { choice: "breath", via: "press" } } }),
    q("fireGas", { voice: "speaking", answers: { body: { choice: "chest", via: "voice" } } }),
    { step: "locate", answers: { place: { choice: "car", via: "press" } } },
    { step: "prompt" },
    { step: "recording", startedAt: T, until: T + 30_000 },
    { step: "recording", startedAt: T, until: T + 120_000 },
    { step: "sending", color: "red" },
    ...(["sent", "queued", "dropped"] as const).flatMap((delivery) => [
      { step: "done" as const, color: "red" as const, delivery },
      { step: "done" as const, color: "red" as const, delivery, silent: true as const },
    ]),
  ];

  it("無事じゃない を押したあとの全部の画面に、同じ固定の 1 行をいちばん下（終わりは 最初から の上）に出す", () => {
    for (const s of RED_FLOW) {
      const html = view(s);
      expect(html.match(/data-emergency/g), JSON.stringify(s)).toHaveLength(1);
      const t = text(html);
      const tail = s.step === "done" ? t.slice(0, t.lastIndexOf("最初から")) : t;
      expect(tail.endsWith(E), JSON.stringify(s)).toBe(true);
      // 押してもかからない（リンクにしない）
      expect(html).not.toContain("tel:");
    }
  });

  it("文は「命が危ないと感じたら、すぐ119番へ」で、どの画面でも 1 字も変わらない（出し分けない）", () => {
    expect(E.replaceAll(" ", "")).toBe(EMERGENCY_TEXT);
    const lines = new Set(
      RED_FLOW.map((s) => {
        const m = view(s).match(/<[^>]*data-emergency[^>]*>[\s\S]*?<\/p>/);
        return m ? text(m[0]) : null;
      }),
    );
    expect([...lines]).toEqual([E]);
  });

  it("上・緑の 1 問・緑の送る・緑の終わりには出さない", () => {
    for (const s of [
      { step: "top" },
      { step: "where" },
      { step: "sending", color: "green" },
      { step: "done", color: "green", delivery: "sent" },
      { step: "done", color: "green", delivery: "queued" },
    ] satisfies PhoneState[]) {
      expect(view(s), s.step).not.toContain("data-emergency");
    }
  });
});

describe("平時の画面", () => {
  const p = SPARSE_PEOPLE.find((x) => x.person.id === "p-01")!;
  const rows: PersonPageRows = {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
  const sheet = buildOwnSheet(rows, { today: "2026-11-02", officeName: "デモ事業所" });

  it("本人の 1 枚（T06）の文をそのまま。電話は押すとかけられ、119 はリンクにしない。電話の段は番号のある行だけ（T77）", () => {
    const html = renderToStaticMarkup(createElement(PhoneSheet, { sheet }));
    const t = text(html);
    for (const line of sheet.blocks.flatMap((b) => b.lines)) {
      const words = lineText({ ...line, phone: undefined });
      // 紙で手で書く線の行（ケアマネ・かかりつけ。番号の欄がまだ無い）はスマホに出さない
      const handwritten = line.key.startsWith("call.") && !line.phone?.number;
      if (handwritten) expect(t, line.key).not.toContain(words);
      else expect(t, line.key).toContain(words);
    }
    // 山田 ハナは電話の段の行が全部手書きなので、段ごと出さない（家族の番号は 来てくれる 人 の段に）
    expect(phoneBlocks(sheet.blocks).map((b) => b.id)).not.toContain("call");
    expect(html).not.toContain("data-block=\"call\"");
    expect(t).toContain("命が 危ないと 感じたら、すぐ 119番へ");
    const tels = [...html.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]);
    const numbers = sheet.blocks.flatMap((b) => b.lines).flatMap((l) => (l.phone?.number ? [l.phone.number] : []));
    expect(tels).toEqual(numbers);
    expect(tels.length).toBeGreaterThan(0);
    expect(tels).not.toContain("119");
    expect(html).not.toContain("<button");
  });
});
