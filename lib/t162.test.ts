// T162 使う側の模擬で迷った画面を直す（docs/tasks/T162.md）。画面は renderToStaticMarkup と部品の元の文で確かめる。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

import { DocumentPeople } from "../components/forms/DocumentList.tsx";
import { EditWindow, PAPER_EDIT_LABELS } from "../components/forms/PaperEdit.tsx";
import { DrillControls } from "../components/drill/DrillControls.tsx";
import { AssignForm } from "../components/office/AssignForm.tsx";
import { DocumentSection } from "../components/person/DocumentSection.tsx";
import { PrintButton } from "../components/ui/PrintButton.tsx";
import { CLOCK_LABELS, movedText } from "./drill/clock.ts";
import { TALK_LABELS } from "./drill/dialogue.ts";
import { CALL_UI } from "./drill/labels.ts";
import { MATSUYAMA_ENTRY } from "./forms/catalog.ts";
import { PRINT_PREVIEW_LABELS, printPhaseText } from "./forms/print.ts";
import type { PaperTarget } from "./forms/paper-edit.ts";
import { OFFICE_LABELS } from "./office/labels.ts";
import type { DocumentView } from "./person.ts";
import { personas } from "../tools/eval/persona/personas.ts";
import { screenOf } from "../tools/eval/persona/finding.ts";
import { GUARDS } from "../tools/eval/guards.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 2〜4 字（中黒・数字を含む） */
const short = (s: string) => [...s].length >= 2 && [...s].length <= 4;

describe("1. 印刷: 押したことが窓の前から分かる・戻ると見本終了を分ける", () => {
  it("見本の帯の言葉は 2〜4 字。「閉じる」は使わず、見本だけを閉じる物は見本終了、前の画面へは戻る", () => {
    for (const v of Object.values(PRINT_PREVIEW_LABELS)) expect(short(v), v).toBe(true);
    expect(Object.values(PRINT_PREVIEW_LABELS)).not.toContain("閉じる");
    expect(PRINT_PREVIEW_LABELS.close).toBe("見本終了");
    expect(printPhaseText("preparing")).toBe("準備中");
    expect(printPhaseText("shown")).toBe("表示済");
    expect(printPhaseText("idle")).toBe("");
  });

  it("見本の帯に状態（読み上げの status）・再印刷・戻る（紙面の画面の戻ると同じ行き先）。送信中の印で台も待つ", () => {
    const src = read("../components/ui/PrintButton.tsx");
    expect(src).toContain('role="status"');
    expect(src).toContain("data-print-status={phase}");
    expect(src).toContain("aria-busy={busy || undefined}");
    expect(src).toContain("L.again");
    expect(src).toContain("<BackLink href={back} label={L.back} />");
    // 全部の紙面の帯（PaperBar）が戻るの行き先を渡す。様式 9 は書類の一覧へ
    expect(read("../components/ui/PaperBar.tsx")).toContain("<PrintButton auto={autoPrint} back={back} />");
    expect(read("../app/office/form9/page.tsx")).toContain('back="/forms"');
    // 閉じている間は印刷のボタンだけ
    const html = renderToStaticMarkup(createElement(PrintButton, { back: "/people/p-01" }));
    expect(html).toContain("data-print-button");
    expect(html).not.toContain("data-print-preview-bar");
  });

  it("見本の間も上の帯（画面の切替）を残し、見本の帯は上の帯の直下に留める。紙には出さない", () => {
    expect(read("../components/AppHeader.tsx")).toContain("data-app-header");
    const css = read("../components/forms/paper.css");
    expect(css).toContain("html[data-print-preview] header:not(:has([data-paper-root])):not([data-app-header])");
    expect(css).toContain("html[data-print-preview] nav:not(:has([data-paper-root])):not([data-app-header] nav)");
    expect(css).toMatch(/\.print-preview-slot \{\s*position: sticky;/);
    // 印刷では上の帯も見本の帯も出さない（@media print の規則は前のまま）
    expect(css).toMatch(/@media print \{\s*\.print-preview-bar \{\s*display: none !important;/);
  });
});

describe("2. 訓練: 着信の窓の後で・対応済、次までの進んだ分", () => {
  it("着信の窓の言葉は 2〜4 字。後で（窓を閉じる）・着信表示（下の 1 行から戻る）・対応済", () => {
    for (const k of ["later", "reopen", "handled", "answer", "decline", "hangUp"] as const) expect(short(CALL_UI[k]), CALL_UI[k]).toBe(true);
    const src = read("../components/drill/IncomingCall.tsx");
    expect(src).toContain('data-incoming-action="later"');
    expect(src).toContain('data-incoming-action="reopen"');
    expect(src).toContain("data-incoming-done={index - 1}");
    // 後での間は窓（aria-modal）を出さず、早送りを止める合図も下ろす
    expect(src).toContain("detail: current !== null && !later");
  });

  it("機器・薬の問いは区切って読める", () => {
    expect(TALK_LABELS.device_medicine).toBe("機器・薬");
  });

  it("次までは読み直した画面が届くまで送信中、進んだ分を「進行 N 分」で出す", () => {
    expect(CLOCK_LABELS.moved).toBe("進行");
    expect(movedText(6)).toBe("6 分");
    expect(movedText(60)).toBe("1 時間");
    expect(movedText(90)).toBe("1 時間 30 分");
    expect(movedText(-3)).toBe("0 分");
    const src = read("../components/drill/DrillControls.tsx");
    expect(src).toContain("startRefresh(() => router.refresh())");
    expect(src).toContain("data-moved={moved}");
    const html = renderToStaticMarkup(createElement(DrillControls, { id: "d-1", step: 0, done: false, clock: true, left: 10, minute: 0 }));
    expect(html).toContain("次まで");
    expect(html).not.toContain("data-moved");
    // 経過の大きな字は読み上げにも
    expect(read("../app/drill/[id]/page.tsx")).toMatch(/role="status" className="text-2xl font-bold tabular-nums" data-now-hour/);
  });
});

describe("3. 押した物の名前どおりの行き先", () => {
  const docs: DocumentView[] = [
    { key: "matsuyama", label: "計画書", status: "表示", href: "/people/p-01/forms/matsuyama" },
    { key: "medical", label: "医療要約", status: "表示", href: "/people/p-01/forms/medical" },
  ];

  it("本人のページの書類の行の表示・印刷は書類の名前つき（行ごとに違う名前）", () => {
    const html = renderToStaticMarkup(createElement(DocumentSection, { documents: docs }));
    expect(html).toContain('aria-label="計画書 表示"');
    expect(html).toContain('aria-label="計画書 印刷"');
    expect(html).toContain('aria-label="医療要約 表示"');
  });

  it("書類の一覧の一括印刷は書類の名前つき、行の表示・印刷は氏名と書類の名前つき", () => {
    const rows = [{ id: "p-01", name: "山田 ハナ", href: "/people/p-01/forms/matsuyama", printHref: "/people/p-01/forms/matsuyama?print=1", unconfirmed: null, blocked: null }];
    const html = renderToStaticMarkup(
      createElement(DocumentPeople, { entry: MATSUYAMA_ENTRY, isDefault: true, rows: rows as never, batch: "/forms/batch?form=matsuyama&print=1", counted: false }),
    );
    expect(html).toMatch(new RegExp(`data-batch-link[^>]*>.*${MATSUYAMA_ENTRY.short.replace(/[()（）]/g, ".")} 一括印刷`));
    expect(html).toContain(`aria-label="山田 ハナ ${MATSUYAMA_ENTRY.short} 印刷"`);
    expect(html).toContain(`aria-label="山田 ハナ ${MATSUYAMA_ENTRY.short} 表示"`);
  });
});

describe("4. 担当の変更", () => {
  const cms = [
    { id: "cm-1", name: "山本" },
    { id: "cm-2", name: "西村" },
  ];
  it("変更は今と違う担当を選ぶまで押せない。読み上げは「氏名 担当変更」", () => {
    const html = renderToStaticMarkup(createElement(AssignForm, { personId: "p-05", personName: "伊藤 フミ", careManagerId: "cm-1", careManagers: cms }));
    expect(OFFICE_LABELS.assignChange).toBe("担当変更");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="伊藤 フミ 担当変更"|<button[^>]*aria-label="伊藤 フミ 担当変更"[^>]*disabled=""/);
    // 選ぶ欄は一覧の開くボタン（台は選ぶ欄として読む。tools/eval/persona/dom.ts）
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="伊藤 フミ 担当"');
  });
});

describe("5. 紙に書く窓", () => {
  const target = {
    key: "pre_place" as never,
    label: "事前避難場所",
    inputs: [{ kind: "field", key: "evacuation.destination2", label: "避難先2", value: "" }],
  } as PaperTarget;

  it("書く欄が 1 つなら欄の名前は紙の欄の名前で、台帳のどこに入るかを小さく添える", () => {
    const html = renderToStaticMarkup(createElement(EditWindow, { data: { personId: "p-01", version: 1 }, target, onClose: () => {} }));
    expect(html).toContain("data-paper-ledger-name");
    expect(html.replace(/<!-- -->/g, "")).toContain(`${PAPER_EDIT_LABELS.ledger} 避難先2`);
    expect(html).toContain('<span class="text-muted">事前避難場所</span>');
    expect(html).toContain(PAPER_EDIT_LABELS.toLedger);
  });

  it("保存できたら紙の上に「保存済 欄の名前」と本人のページへの道", () => {
    const src = read("../components/forms/PaperEdit.tsx");
    expect(src).toContain("data-paper-saved");
    expect(src).toContain("onSaved={() => setSaved(open.label)}");
    expect(src).toContain("data-paper-saved-page");
  });

  it("様式 9 の紙の保存の状態は何の保存か（記入 保存済）", () => {
    expect(read("../components/forms/Form9Fill.tsx")).toContain("{FILL_WRITE}</span> {STATE_LABELS[state]}");
  });
});

describe("台: 決まった手・達成の印・画面の名前・守り", () => {
  const all = personas();
  const goal = (p: string, g: string) => all.find((x) => x.id === p)!.goals.find((x) => x.id === g)!;

  it("決まった手は今の画面の名前（書類の名前つきの表示・印刷、担当変更）。見本の間も上の帯から事業所へ", () => {
    expect(goal("first", "plan").route).toEqual([{ click: "計画書（松山市） 表示" }]);
    expect(goal("veteran", "plan").route).toEqual([{ click: "計画書（松山市） 表示" }]);
    expect(goal("admin", "assign").route.at(-1)).toEqual({ click: "伊藤 フミ 担当変更" });
    expect(goal("admin", "reset").route).toEqual([{ click: "事業所" }, { click: "最初に戻す" }, { click: "戻す" }]);
  });

  it("様式 9 の印刷の目標は様式 9 の画面で立った印刷の旗だけ（一括印刷の松山市の計画書を数えない）", () => {
    const done = goal("admin", "form9").done as { any: Array<{ printed?: boolean; path?: string }> };
    expect(done.any[0]).toEqual({ printed: true, path: "^/office/form9" });
  });

  it("足した人の p-<uuid> の道も [id] にまとめる（守りの原因の鍵が人ごとに割れない）", () => {
    expect(screenOf("/people/p-3017f485-cfe9-46c9-9123-0ac01722bb4e/forms/matsuyama")).toBe("/people/[id]/forms/matsuyama");
  });

  it("守り: 迷った画面の原因の数を次の回から 0 に", () => {
    const ids = GUARDS.filter((g) => g.task === "T162").map((g) => g.id);
    expect(ids).toEqual(["persona-plan-print-dead-end", "persona-drill-dead-end", "persona-form9-misread", "persona-assign-dead-end"]);
    for (const g of GUARDS.filter((x) => x.task === "T162")) {
      expect(g.bench).toBe("persona");
      expect(g.item.startsWith("count:persona:")).toBe(true);
      expect(g.value).toBe(0);
    }
  });
});
