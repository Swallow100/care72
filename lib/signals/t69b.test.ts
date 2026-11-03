// T69b 本人・家族のスマホの中身（docs/tasks/T69b.md）。いちばん大事な線をここで縛る:
// - 選択肢の色（tone）は見た目の印で、ルールの表の入力ではない。赤は表が至急にする答えだけ。体の訴え・場所・わからない・とばすには色を付けない
// - 送る答え（answers）に色は入らない。lib/triage のどのファイルも tone を読まない

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import { FamilyView } from "../../components/phone/FamilyView.tsx";
import { PhoneView, type PhoneActions } from "../../components/phone/PhoneView.tsx";
import type { TriageSignal } from "../triage/index.ts";
import type { FamilyScreen } from "./family.ts";
import {
  CHOICE_TONES,
  legacyColumnsOf,
  parseAnswers,
  QUESTIONS,
  UNKNOWN_CHOICE,
  type Answer,
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
