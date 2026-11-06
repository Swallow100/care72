// T166 使う側の模擬の 2 回目で迷った所を直す（docs/tasks/T166.md）。画面は renderToStaticMarkup と部品の元の文で確かめる。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

import { DrillControls } from "../components/drill/DrillControls.tsx";
import { RequestSection } from "../components/person/RequestSection.tsx";
import { RoleMenu } from "../components/ui/RoleMenu.tsx";
import { REQUEST_LABELS } from "./custody/labels.ts";
import type { RequestPanel } from "./custody/requests.ts";
import { CALL_UI, DRILL_LABELS, LOG_LABELS } from "./drill/labels.ts";
import { splitSource, WARNING_SOURCE } from "./jma/labels.ts";
import { INTAKE_LABELS } from "./labels.ts";
import { START_LABELS, startDetails } from "./seed/labels.ts";
import { fillRequest } from "./ui/dialog.ts";
import { CONFIRM_LABELS, DIALOG_LABELS, PRINT_BAR_LABELS } from "./ui/labels.ts";
import { GUARDS } from "../tools/eval/guards.ts";
import { personas } from "../tools/eval/persona/personas.ts";
import { BUSY_SELECTOR } from "../tools/eval/persona/surface.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
/** 2〜4 字 */
const short = (s: string) => [...s].length >= 2 && [...s].length <= 4;

const openPanel = {
  canSend: true,
  defaultShelter: "かわなぎ小学校",
  latest: { id: "r-1", state: "open", shelter: "かわなぎ小学校", requestedAt: "2026-11-06T10:00:00.000Z", repliedAt: null, repliedName: null },
} as RequestPanel;

describe("1. 医療班の役に入る道", () => {
  it("依頼中の面に、役を選べる人だけ受入一覧への入口（役を医療班にして送る）", () => {
    const on = renderToStaticMarkup(createElement(RequestSection, { personId: "p-1", panel: openPanel, level: 2, staffEntry: true }));
    expect(on).toContain("data-request-staff");
    expect(on).toContain('action="/api/auth/role"');
    expect(on).toContain('value="medical"');
    expect(on).toContain(REQUEST_LABELS.toStaff);
    // 本物のケアマネ（役を選べない）には出さない
    const off = renderToStaticMarkup(createElement(RequestSection, { personId: "p-1", panel: openPanel, level: 2 }));
    expect(off).not.toContain("data-request-staff");
    // 依頼が無い面にも出さない
    const none = renderToStaticMarkup(createElement(RequestSection, { personId: "p-1", panel: { ...openPanel, latest: null }, level: 2, staffEntry: true }));
    expect(none).not.toContain("data-request-staff");
  });

  it("担当一覧と単独の本人のページの両方が canChooseRole を渡す", () => {
    expect(read("../app/page.tsx")).toContain("staffEntry={canChooseRole(principal)}");
    expect(read("../app/people/[id]/page.tsx")).toContain("staffEntry={canChooseRole(principal)}");
  });

  it("役変更は開く前から中の役を読める（名前は役変更で始まる）", () => {
    const html = renderToStaticMarkup(
      createElement(RoleMenu, {
        label: "役変更",
        current: "care_manager",
        choices: [
          { role: "care_manager", label: "ケアマネ", sub: null },
          { role: "medical", label: "医療班", sub: "受入一覧" },
        ],
      }),
    );
    expect(html).toContain('aria-label="役変更 ケアマネ・医療班"');
    expect(html).toContain('title="ケアマネ・医療班"');
  });

  it("台は未確認の数の data-pending を送信中と読まない（未確認のある人で毎手 60 秒待ち、筋が時間切れになった）", () => {
    expect(BUSY_SELECTOR).toContain('[data-pending=""]');
    expect(BUSY_SELECTOR).toContain('[data-pending="true"]');
    expect(BUSY_SELECTOR).not.toContain(":not(");
    expect(read("../components/person/parts.tsx")).toContain("data-pending={pending.length}");
  });
});

describe("2. 避難先: 目次・保存", () => {
  const src = read("../components/person/SectionEdit.tsx");
  it("目次はリンクで、押すとその組の最初の欄にカーソル", () => {
    expect(src).toContain("aria-label={`${g.label} ${INTAKE_LABELS.groupMove}`}");
    expect(src).toContain("href={`#${anchorOf(g.id)}`}");
    expect(src).toMatch(/\.focus\(\{ preventScroll: true \}\)/);
  });
  it("保存と取消は画面の下に留める。数は「変更 N 件」、保存のあとは保存済", () => {
    expect(src).toMatch(/sticky bottom-0[^"]*" data-edit-bar/);
    expect(src).toContain("{INTAKE_LABELS.changeCount} {changes.length} 件");
    expect(src).toContain("data-edit-saved={section}");
    expect(short(INTAKE_LABELS.groupMove)).toBe(true);
    expect(short(INTAKE_LABELS.changeCount)).toBe(true);
  });
});

describe("3. 訓練", () => {
  const call = read("../components/drill/IncomingCall.tsx");
  it("鳴っている間は窓で画面を止めない（通話中だけ aria-modal）", () => {
    expect(call).toContain('aria-modal={talkingNow ? "true" : undefined}');
    expect(call).toContain("fixed right-4 bottom-4");
  });
  it("着信の言葉は時間を進める物に読まれない", () => {
    expect(CALL_UI.later).toBe("保留");
    expect(short(CALL_UI.later)).toBe(true);
  });
  it("自動進行は押せるボタン（switch）、名前は自動進行のまま", () => {
    const html = renderToStaticMarkup(createElement(DrillControls, { id: "d-1", step: 0, done: false, clock: true, left: 10, minute: 0 }));
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="false"[^>]*data-action="fast"/);
    expect(html).toContain(DRILL_LABELS.fastForward);
    expect(html).not.toMatch(/<input[^>]*data-action="fast"/);
  });
  it("次までの横に前と今の経過", () => {
    expect(read("../components/drill/DrillControls.tsx")).toContain("{minuteText(moved.from)} → {minuteText(moved.to)}");
  });
  it("経過のタブは出来事（発生 N を発災への切替と読まれた）", () => {
    expect(LOG_LABELS.occurTab).toBe("出来事");
    expect(read("../components/drill/DrillLog.tsx")).toContain("label: LOG_LABELS.occurTab");
  });
  it("訓練の画面に事業所の今の状態と事業所の画面への入口", () => {
    const page = read("../app/drill/[id]/page.tsx");
    expect(page).toContain("data-office-entry");
    expect(page).toContain("href={OFFICE_PATH}");
    expect(short(DRILL_LABELS.officeSwitch)).toBe(true);
  });
});

describe("4. 事業所", () => {
  const page = read("../app/office/page.tsx");
  it("発災開始の窓の決める方は発災開始、やめる方は平時維持（題は別の言葉）", () => {
    expect(START_LABELS.title).not.toBe(START_LABELS.start);
    expect(page).toContain("ok: START_LABELS.start,");
    expect(page).toContain("cancel: START_LABELS.stay,");
    expect(startDetails(["みずほし町"], "山田 ハナ")[0]).toBe("現在 平時");
    for (const v of [START_LABELS.title, START_LABELS.stay, START_LABELS.done, START_LABELS.toList, CONFIRM_LABELS.stayNormal, CONFIRM_LABELS.stayDisaster]) expect(short(v), v).toBe(true);
  });
  it("窓のやめる方の言葉を呼ぶ側から渡せる。渡さなければ取消", () => {
    const base = { kind: "confirm" as const, message: "m" };
    expect(fillRequest(1, base).cancel).toBe(DIALOG_LABELS.cancel);
    expect(fillRequest(1, { ...base, cancel: START_LABELS.stay }).cancel).toBe(START_LABELS.stay);
  });
  it("開始のあとは頭に知らせと担当一覧への入口。災害モードの間の平時のボタンは平時復帰", () => {
    expect(page).toContain("data-started-notice");
    expect(read("./seed/http.ts")).toContain("?started=1");
    expect(page).toContain('kind === "normal" && state.kind !== "normal" ? DISASTER_LABELS.backToNormal');
  });
  it("気象庁の出典は文を変えず、押せるのは名前だけ", () => {
    const { before, after } = splitSource(WARNING_SOURCE);
    expect(`${before}${WARNING_SOURCE.link}${after}`).toBe(WARNING_SOURCE.text);
    expect(WARNING_SOURCE.link).not.toContain("http");
    const view = read("../components/office/JmaAlertsView.tsx");
    expect(view).toContain("{WARNING_SOURCE.link}");
    expect(view.split("{WARNING_SOURCE.href}").length).toBe(1);
    expect(view).toContain("href={WARNING_SOURCE.href}");
  });
});

describe("5. 様式 9 の見本と最初に戻す", () => {
  it("見本だけを閉じるボタンは通常表示（戻す・終了の語を使わない）", () => {
    expect(PRINT_BAR_LABELS.close).toBe("通常表示");
    const src = read("../components/ui/PrintButton.tsx");
    expect(src).toContain("{PRINT_BAR_LABELS.close}");
    expect(src).not.toContain("{L.close}");
  });
  it("最初に戻すは事業所の画面の右の列の頭", () => {
    const page = read("../app/office/page.tsx");
    expect(page.indexOf("<ResetSection state={reset} />")).toBeLessThan(page.indexOf("<AddCareManager count="));
  });
});

describe("6. 台", () => {
  it("守りが足してあり、原因の鍵は台の形", () => {
    const mine = GUARDS.filter((g) => g.task === "T166");
    expect(mine.map((g) => g.id)).toEqual(
      expect.arrayContaining([
        "persona-medical-role",
        "persona-medical-note",
        "persona-ledger-not-found",
        "persona-auto-reached",
        "persona-first-disaster",
        "persona-office-exit",
        "persona-admin-reset",
        "persona-form9-preview-misread",
      ]),
    );
    for (const g of mine) expect(g.item.startsWith("count:persona:"), g.id).toBe(true);
  });
  it("筋の発災開始は窓の決める方の名前", () => {
    const first = personas().find((p) => p.id === "first")!;
    expect(first.goals.find((g) => g.id === "disaster")!.route).toEqual([{ click: "事業所" }, { click: "発災開始" }, { click: "発災開始" }]);
  });
});
