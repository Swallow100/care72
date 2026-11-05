// T138 のテスト: 本人のページの「AI 入力」の欄を会話の並びに。
// - 吹き出しの向き（AI と問いは左、ケアマネは右）と地の色（ライトとダークで別の地）
// - 保存の行（「N 件を保存しました」）を出さず、吹き出しの中の小さな状態だけ
// - 今の問いの置き場所（入力の欄のすぐ下、やり取りの上）と、答えると次の問いに替わる選び方
// - やり取りの組（新しい組を上、組の中は起きた順）と畳み方
// 画面は react-dom/server で描く（components/person/Intake.tsx）。並べ方と選び方は components/person/intake-log.ts の関数で確かめる。
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { Intake, LogBubble, type LogEntry } from "../../components/person/Intake.tsx";
import { currentAsk, logTurns, TURNS_SHOWN, visibleTurns } from "../../components/person/intake-log.ts";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../../seed/people.ts";
import type { PersonPageRows } from "../person.ts";
import type { IntakeProps } from "./props.ts";
import { intakePropsOf } from "./props.ts";

const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT, version: 1 },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const propsOf = (id = "p-04"): IntakeProps => intakePropsOf(seedRows(seed(id)), true);
const drawIntake = (props: IntakeProps) => renderToStaticMarkup(createElement(Intake, { ...props, level: 1 }));
const drawBubble = (entry: LogEntry, props: IntakeProps = propsOf()) =>
  renderToStaticMarkup(
    createElement(LogBubble, { entry, props, busy: false, aiReady: true, onRows: () => {}, onSave: async () => {}, onDiscard: () => {}, onRetry: () => {} }),
  );

const q = (key: string) => {
  const base = propsOf().queue[0];
  return { ...base, key };
};
const split = (id: string, state: "open" | "saved" | "discarded", changed?: number): LogEntry => ({
  id,
  who: "ai",
  kind: "split",
  say: "1 項目を見つけました（医療 1）",
  proposal: { model: "claude-sonnet-5-5", dropped: 0, rows: [] },
  state,
  ...(changed === undefined ? {} : { changed }),
});

describe("吹き出しの向き（T138）", () => {
  it("ケアマネは右、AI と問いは左。AI の吹き出しにだけ AI の印", () => {
    const you = drawBubble({ id: "1", who: "you", text: "88 歳、独居" });
    expect(you).toMatch(/data-who="you"[^>]*data-side="right"/);
    expect(you).toContain("ml-auto");
    expect(you).not.toContain('data-ai=""');

    const ai = drawBubble(split("2", "open"));
    expect(ai).toMatch(/data-who="ai"[^>]*data-side="left"/);
    expect(ai).toContain("mr-auto");
    expect(ai).toContain('data-ai=""');

    const asked = drawBubble({ id: "3", who: "ask", q: propsOf().queue[0] });
    expect(asked).toMatch(/data-who="ask"[^>]*data-side="left"/);
    expect(asked).not.toContain('data-ai=""'); // 問いは定型（Claude は作らない）

    const failed = drawBubble({ id: "4", who: "ai", kind: "failed", label: "AI 失敗", reason: "timeout", retry: null });
    expect(failed).toMatch(/data-who="ai"[^>]*data-side="left"/);
    expect(failed).toContain('data-ai=""');
  });

  it("地の色を分ける: AI と問いは面の中（panel2）、ケアマネはもう 1 段の地（panel3）。枠線・影・グラデーションは使わない", () => {
    const you = drawBubble({ id: "1", who: "you", text: "x" });
    const ai = drawBubble(split("2", "saved", 1));
    expect(you).toContain("bg-panel3");
    expect(ai).toContain("bg-panel2");
    for (const h of [you, ai]) expect(h).not.toMatch(/\b(border|shadow|ring|bg-gradient|rounded-full)\b/);
  });

  it("ケアマネの吹き出しの地はライトとダークの両方にあり、ダークでは面の中より明るい", () => {
    const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
    const light = css.match(/:root \{[\s\S]*?\n\}/)![0];
    const dark = css.match(/:root\[data-theme="dark"\] \{[\s\S]*?\n\}/)![0];
    const hex = (block: string, name: string) => block.match(new RegExp(`--${name}: (#[0-9a-f]{6})`))![1];
    const lum = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).reduce((a, b) => a + b, 0);
    expect(hex(light, "panel3")).not.toBe(hex(light, "panel2"));
    expect(lum(hex(light, "panel3"))).toBeLessThan(lum(hex(light, "panel2")));
    expect(lum(hex(dark, "panel3"))).toBeGreaterThan(lum(hex(dark, "panel2")));
    expect(css).toContain("--color-panel3: var(--panel3);");
  });
});

describe("保存の行を出さない（T138）", () => {
  it("保存した AI の吹き出しは「保存済」の小さな状態だけ。「N 件を保存しました」は無い", () => {
    const h = drawBubble(split("1", "saved", 1));
    expect(h).toContain("1 項目を見つけました（医療 1）");
    expect(h).toMatch(/data-intake="state"[^>]*>保存済</);
    expect(h).not.toContain("件を保存しました");
    // 保存して変わらなかった・取り消した
    expect(drawBubble(split("2", "saved", 0))).toMatch(/data-intake="state"[^>]*>変更なし</);
    expect(drawBubble(split("3", "discarded"))).toMatch(/data-intake="state"[^>]*>取消</);
  });

  it("開いている変更点は保存・取消（取り消しの道）を残し、状態はまだ出さない", () => {
    const props = propsOf();
    const items = [{ id: "r1", section: "medical", label: "特記", state: "add", current: null, next: "x", masked: false, change: { t: "note", value: "x" } }];
    const open: LogEntry = { ...(split("1", "open") as Extract<LogEntry, { kind: "split" }>), proposal: { model: "m", dropped: 0, rows: items.map((i) => ({ ...i, on: true, editing: false, edited: false })) as never } };
    const h = drawBubble(open, props);
    expect(h).toContain('data-intake="changes"');
    expect(h).toContain(">取消<");
    expect(h).not.toContain('data-intake="state"');
  });

  it("問いの答えも、答えの吹き出しの中の小さな状態。保存の失敗は同じ吹き出しに赤の 1 行", () => {
    const ok = drawBubble({ id: "1", who: "you", text: "1 回 1 錠", state: "saved" });
    expect(ok).toMatch(/1 回 1 錠[\s\S]*data-intake="state"[^>]*>保存済</);
    const bad = drawBubble({ id: "2", who: "you", text: "次回", error: "競合" });
    expect(bad).toMatch(/data-intake="save-error"[^>]*>競合</);
  });

  it("入れる欄の部品は、保存・取消・次回・不明を流れの 1 行にしない（INTAKE_SAYS の行の言葉を使わない）", () => {
    const src = readFileSync(new URL("../../components/person/Intake.tsx", import.meta.url), "utf8");
    for (const say of ["INTAKE_SAYS.saved", "INTAKE_SAYS.unchanged", "INTAKE_SAYS.discarded", "INTAKE_SAYS.skipped", "INTAKE_SAYS.pending"]) {
      expect(src, say).not.toContain(say);
    }
  });
});

describe("今の問いの置き場所（T138）", () => {
  it("入力の欄のすぐ下・やり取りの上に 1 つだけ。問いの何を・なぜ・例と残り、答えの欄・不明・無回答・次回がそこにある", () => {
    const props = propsOf();
    const h = drawIntake(props);
    const form = h.indexOf('data-intake="text"');
    const current = h.indexOf('data-intake="current"');
    const log = h.indexOf('data-intake="log"');
    expect(form).toBeGreaterThan(-1);
    expect(current).toBeGreaterThan(form);
    expect(log).toBeGreaterThan(current);
    const block = h.slice(current, log);
    const first = props.queue[0];
    expect(block).toContain('data-intake="question"');
    expect(block).toContain(`data-key="${first.key}"`);
    for (const s of [first.text, first.why, first.example, "不明", "無回答", "次回"]) expect(block).toContain(s);
    expect(block).toMatch(/残り \d+ 問/);
    expect(h.match(/data-intake="question"/g)).toHaveLength(1);
    // やり取りの部品は問いを持たない（問いは決まった所の 1 つだけ）
    expect(h.slice(log)).not.toContain('data-intake="question"');
  });

  it("空欄が無いときも同じ所に「空欄はありません」", () => {
    const h = drawIntake({ ...propsOf(), queue: [] });
    const current = h.indexOf('data-intake="current"');
    expect(current).toBeGreaterThan(h.indexOf('data-intake="text"'));
    expect(h.slice(current, h.indexOf('data-intake="log"'))).toContain('data-intake="done"');
  });

  it("答えると同じ所が次の問いに替わる。保存に失敗した答えは替えない。「次回」も替える", () => {
    const queue = propsOf().queue;
    expect(queue.length).toBeGreaterThan(2);
    const start = currentAsk(queue, []);
    expect(start.question?.key).toBe(queue[0].key);
    expect(start.left).toBe(queue.length);
    // 答えて保存できた（done に入る）→ 次の問い、残りが 1 つ減る
    const answered = currentAsk(queue, [queue[0].key]);
    expect(answered.question?.key).toBe(queue[1].key);
    expect(answered.left).toBe(queue.length - 1);
    // 保存に失敗（done に入れない）→ 同じ問い
    expect(currentAsk(queue, []).question?.key).toBe(queue[0].key);
    // 次回にした欄と答えた欄を合わせて飛ばす
    expect(currentAsk(queue, [queue[0].key, queue[1].key]).question?.key).toBe(queue[2].key);
    // 全部済めば問いは無い
    expect(currentAsk(queue, queue.map((x) => x.key))).toEqual({ question: null, left: 0 });
  });

  it("今の問いの所の印（data-key）が、答えた欄を飛ばした次の問いに替わる（描いた画面で）", () => {
    const props = propsOf();
    const [first, second] = props.queue;
    // ページを読み直したあと（サーバーが答えた欄を問いの並びから外す）と同じ形
    const after = drawIntake({ ...props, queue: props.queue.slice(1) });
    const block = after.slice(after.indexOf('data-intake="current"'), after.indexOf('data-intake="log"'));
    expect(block).toContain(`data-key="${second.key}"`);
    expect(block).not.toContain(`data-key="${first.key}"`);
  });
});

describe("やり取りの組（T138）", () => {
  const you = (id: string, text = id): LogEntry => ({ id, who: "you", text });
  const ask = (id: string): LogEntry => ({ id, who: "ask", q: q(`k-${id}`) });
  const ids = (turns: LogEntry[][]) => turns.map((t) => t.map((e) => e.id));

  it("新しい組を上に、組の中は起きた順（入力 → AI、問い → 答え、文の答え → AI、再試行は同じ組）", () => {
    const log: LogEntry[] = [
      you("t1"),
      split("a1", "saved", 1),
      ask("q1"),
      you("y1"),
      ask("q2"),
      you("y2"),
      { id: "f1", who: "ai", kind: "failed", label: "AI 失敗", reason: "timeout", retry: null },
      split("a2", "open"),
      you("t2"),
      { id: "x1", who: "app", text: "入力不備", tone: "danger" },
    ];
    expect(ids(logTurns(log))).toEqual([["t2", "x1"], ["q2", "y2", "f1", "a2"], ["q1", "y1"], ["t1", "a1"]]);
  });

  it("「次回」の組: 問い（左）→ 次回（右）", () => {
    expect(ids(logTurns([ask("q1"), you("y1", "次回"), ask("q2"), you("y2")]))).toEqual([["q2", "y2"], ["q1", "y1"]]);
    expect(logTurns([])).toEqual([]);
  });

  it(`古い組は畳む（新しい ${TURNS_SHOWN} 組を見せる）。まだ保存していない変更点のある組は畳まない`, () => {
    const turns = Array.from({ length: TURNS_SHOWN + 3 }, (_, i) => [you(`t${i}`), split(`a${i}`, i === TURNS_SHOWN + 1 ? "open" : "saved", 1)]);
    const hasOpen = (t: readonly LogEntry[]) => t.some((e) => e.who === "ai" && e.kind === "split" && e.state === "open");
    const folded = visibleTurns(turns, false, hasOpen);
    expect(folded.shown).toHaveLength(TURNS_SHOWN + 1);
    expect(folded.folded).toBe(2);
    expect(folded.shown.some(hasOpen)).toBe(true);
    expect(visibleTurns(turns, true, hasOpen)).toEqual({ shown: turns, folded: 0 });
  });
});
