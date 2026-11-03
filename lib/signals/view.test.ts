// 本人のスマホの画面（docs/tasks/T10.md）を静的に描いて確かめる: どの画面もボタンは 2〜3 つで戻るが無い、
// 赤緑の 2 つだけを面で塗る、AI が きいています の印、119 の 1 行は赤を押したあとの全部の画面（AI の出力で出し分けない）、本人の状態の判定の言葉を出さない、
// 平時は本人の 1 枚（T06）と同じ文。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhoneSheet } from "../../components/phone/PhoneSheet.tsx";
import { PhoneView, type PhoneActions } from "../../components/phone/PhoneView.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents } from "../../seed/people.ts";
import { buildOwnSheet, lineText } from "../forms/own-sheet.ts";
import type { PersonPageRows } from "../person.ts";
import { NO_ANSWERS } from "./body.ts";
import { createPhone, type PhoneState } from "./phone.ts";

const noop: PhoneActions = {
  green() {},
  red() {},
  where() {},
  answer() {},
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
const E = "いのちの 危険が あるときは 119";
/** AI の告知の文字（T48） */
const N = "これは AI（人では ない しくみ）が 聞いています。こたえは ケアマネジャーに とどきます";

const STATES: PhoneState[] = [
  { step: "top" },
  { step: "where" },
  ...[0, 1, 2, 3].map((index) => ({ step: "question" as const, index, answers: { ...NO_ANSWERS } })),
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

  it("赤は 1 画面 1 問: けが・家・動けるか・くすり。答えは 2 つ", () => {
    const qs = [0, 1, 2, 3].map((index) => text(view({ step: "question", index, answers: { ...NO_ANSWERS } })));
    expect(qs).toEqual([
      N + "けがは ありますかあるない" + E,
      "いまは 家ですかはいいいえ" + E,
      "動けますか動ける動けない" + E,
      "くすりは ありますかあるない" + E,
    ]);
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
    expect(has({ step: "question", index: 0, answers: { ...NO_ANSWERS } })).toBe(true);
    expect(has({ step: "prompt" })).toBe(true);
    for (const s of STATES.filter((x) => !(x.step === "question" && x.index === 0) && x.step !== "prompt")) expect(has(s), JSON.stringify(s)).toBe(false);
    // 流れ（lib/signals/phone.ts）で赤を押すと、どの押し方でも最初の画面は 1 問目（告知つき）。戻る・飛ばす操作は無い
    const phone = createPhone({ sendSignal: async () => "sent", sendRecording: async () => "sent", playPrompt: async () => {}, startRecording: async () => null, onChange: () => {} });
    phone.red();
    expect(phone.state).toMatchObject({ step: "question", index: 0 });
    expect(has(phone.state)).toBe(true);
    phone.dispose();
    // AI の印は告知の中の「AI」に付く
    expect(view({ step: "prompt" })).toContain(`<span class="phone-ai">AI</span>`);
  });

  it("赤の終わりは「とどきました」と 119 の 1 行。緑の終わりに 119 は無い。通信なしは「まだ とどいて いません」", () => {
    const red = view({ step: "done", color: "red", delivery: "sent" });
    expect(text(red)).toBe("とどきましたいのちの 危険が あるときは 119もう 一度");
    expect(buttons(red)).toEqual(["again"]);
    // 119 は押してもかからない（リンクにしない）
    expect(red).not.toContain("tel:");
    const green = view({ step: "done", color: "green", delivery: "queued" });
    expect(text(green)).toBe("まだ とどいて いませんつながったら 送りますもう 一度");
    expect(text(view({ step: "done", color: "red", delivery: "dropped" }))).not.toContain("つながったら");
  });

  it("聞き直しても無音のまま録音だけ送った終わりは「ろくおんを おくりました」と 119 の 1 行（T37）", () => {
    const html = view({ step: "done", color: "red", delivery: "sent", silent: true });
    expect(text(html)).toBe("ろくおんを おくりましたいのちの 危険が あるときは 119もう 一度");
    expect(html).toContain("data-silent");
    expect(buttons(html)).toEqual(["again"]);
    // 赤が端末に残っている間は、今まで通り「まだ とどいて いません」
    expect(text(view({ step: "done", color: "red", delivery: "queued", silent: true }))).toBe(
      "まだ とどいて いませんつながったら 送りますいのちの 危険が あるときは 119もう 一度",
    );
  });

  it("どの画面もボタンは 3 つまで、戻るは無い。本人の状態の判定の言葉を出さない。漢字には全部ふりがな", () => {
    for (const s of STATES) {
      const html = view(s);
      expect(buttons(html).length, s.step).toBeLessThanOrEqual(3);
      const t = text(html);
      for (const w of ["戻る", "至急", "要確認", "不明", "診断", "判定", "重症"]) expect(t, `${s.step} ${w}`).not.toContain(w);
      // ふりがなを落とす前の漢字の数と、ruby の中の漢字の数が同じ
      const bare = html.replace(/<ruby>[\s\S]*?<\/ruby>/g, "").replace(/<[^>]+>/g, "");
      expect(bare.match(/[一-鿿々]/g), s.step).toBeNull();
    }
  });
});

describe("119 の 1 行（T48、アドバイザーの返事）", () => {
  // 状態（PhoneState）には録音の中身も分類（AI の出力）も無い。119 を出すかは赤の流れかどうかだけで決まる
  const RED_FLOW: PhoneState[] = [
    ...[0, 1, 2, 3].map((index) => ({ step: "question" as const, index, answers: { ...NO_ANSWERS, injured: index > 0 ? true : null } })),
    { step: "prompt" },
    { step: "recording", startedAt: T, until: T + 30_000 },
    { step: "recording", startedAt: T, until: T + 120_000 },
    { step: "sending", color: "red" },
    ...(["sent", "queued", "dropped"] as const).flatMap((delivery) => [
      { step: "done" as const, color: "red" as const, delivery },
      { step: "done" as const, color: "red" as const, delivery, silent: true as const },
    ]),
  ];

  it("無事じゃない を押したあとの全部の画面に、同じ固定の 1 行をいちばん下（終わりは もう 一度 の上）に出す", () => {
    for (const s of RED_FLOW) {
      const html = view(s);
      expect(html.match(/data-emergency/g), JSON.stringify(s)).toHaveLength(1);
      const t = text(html);
      const tail = s.step === "done" ? t.slice(0, t.lastIndexOf("もう 一度")) : t;
      expect(tail.endsWith(E), JSON.stringify(s)).toBe(true);
      // 押してもかからない（リンクにしない）
      expect(html).not.toContain("tel:");
    }
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
  const p = SEED_PEOPLE.find((x) => x.person.id === "p-01")!;
  const rows: PersonPageRows = {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
  const sheet = buildOwnSheet(rows, { today: "2026-11-02", officeName: "デモ事業所" });

  it("本人の 1 枚（T06）の文をそのまま。電話は押すとかけられ、119 はリンクにしない", () => {
    const html = renderToStaticMarkup(createElement(PhoneSheet, { sheet }));
    const t = text(html);
    for (const line of sheet.blocks.flatMap((b) => b.lines)) {
      const words = lineText({ ...line, phone: undefined });
      expect(t, line.key).toContain(words);
    }
    expect(t).toContain("いのちの 危険が あるときは 119");
    const tels = [...html.matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]);
    const numbers = sheet.blocks.flatMap((b) => b.lines).flatMap((l) => (l.phone?.number ? [l.phone.number] : []));
    expect(tels).toEqual(numbers);
    expect(tels.length).toBeGreaterThan(0);
    expect(tels).not.toContain("119");
    expect(html).not.toContain("<button");
  });
});
