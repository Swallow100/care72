// T166 使う側の模擬の 2 回目で迷った所を直す（docs/tasks/T166.md）。画面は renderToStaticMarkup と部品の元の文で確かめる。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

import { onActPick, pickAct } from "../components/drill/act-pick.ts";
import { ActionHintRows } from "../components/drill/ActionHints.tsx";
import { ActionItem } from "../components/drill/ActionLog.tsx";
import type { ActionRecord } from "./drill/engine.ts";
import { DrillControls } from "../components/drill/DrillControls.tsx";
import { AskMarks } from "../components/drill/TalkLines.tsx";
import { RequestSection } from "../components/person/RequestSection.tsx";
import { RoleMenu } from "../components/ui/RoleMenu.tsx";
import { REQUEST_LABELS } from "./custody/labels.ts";
import type { RequestPanel } from "./custody/requests.ts";
import { ASK_EXTRA, askActions, askPick, PANEL_HIDDEN, type ActionHints } from "./drill/action-hints.ts";
import { CALL_UI, DRILL_LABELS, LOG_LABELS } from "./drill/labels.ts";
import type { AskKind } from "./drill/scenarios.ts";
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
    expect(on).toContain(`aria-label="${REQUEST_LABELS.toStaffName}"`);
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

describe("3b. 頼み事の印", () => {
  const every = Object.keys(ASK_EXTRA) as AskKind[];
  it("全部の頼み事に手の候補がある。手が 1 つならその手、2 つ以上は決めずに候補の行へ", () => {
    for (const ask of every) {
      const kinds = askActions(ask).filter((k) => !PANEL_HIDDEN.includes(k));
      expect(kinds.length, ask).toBeGreaterThan(0);
      const to = askPick(ask, null);
      if (kinds.length === 1) expect(to, ask).toEqual({ to: "act", kind: kinds[0] });
      else expect(to, ask).toEqual({ to: "row", found: false });
    }
  });
  it("手が 1 つでも押せないときは理由の読める候補の行へ。候補に行があれば found", () => {
    const only = every.find((a) => askActions(a).filter((k) => !PANEL_HIDDEN.includes(k)).length === 1);
    const many = every.find((a) => askActions(a).filter((k) => !PANEL_HIDDEN.includes(k)).length > 1)!;
    const group = (ask: AskKind, state: "ok" | "block"): ActionHints => ({
      alt: null,
      groups: [{ sources: [{ from: "ask", ask, label: "x" }], actions: askActions(ask).map((kind) => ({ kind, state, why: null, minutes: 5 })) }],
    });
    if (only) {
      expect(askPick(only, group(only, "block"))).toEqual({ to: "row", found: true });
      expect(askPick(only, group(only, "ok")).to).toBe("act");
    }
    expect(askPick(many, group(many, "ok"))).toEqual({ to: "row", found: true });
  });
  it("案内された候補の行だけ枠で示す", () => {
    const hints: ActionHints = {
      alt: null,
      groups: [
        { sources: [{ from: "ask", ask: "transport", label: "移送" }], actions: [{ kind: "request_welfare_shelter", state: "ok", why: null, minutes: 5 }] },
        { sources: [{ from: "ask", ask: "medicine", label: "薬" }], actions: [{ kind: "arrange_medicine", state: "ok", why: null, minutes: 5 }] },
      ],
    };
    const html = renderToStaticMarkup(createElement(ActionHintRows, { person: "p-1", hints, focusAsk: "transport" }));
    expect(html.match(/data-hint-focus/g)?.length).toBe(1);
    expect(html.indexOf("data-hint-focus")).toBeLessThan(html.indexOf("data-hint-act=\"request_welfare_shelter\""));
    expect(renderToStaticMarkup(createElement(ActionHintRows, { person: "p-1", hints }))).not.toContain("data-hint-focus");
  });
  it("経過の手の行は進行中だけ印を押せる", () => {
    const a = {
      id: "a-1", step: 0, kind: "call_person", person: "p-1", target: null, atMinute: 0, calleeLabel: "本人", memo: null,
      result: { status: "reached", speech: "はい", speechAi: true, crossed: [], talk: [{ who: "them", text: "移送を", ai: true, asks: ["transport"] }], visit: { condition: "x", asks: ["water"], speech: null, ai: true } },
    } as unknown as ActionRecord;
    const live = renderToStaticMarkup(createElement(ActionItem, { a, names: { "p-1": "山田" }, live: true }));
    expect(live).toContain('data-ask-pick="transport"');
    expect(live).toContain('data-ask-pick="water"');
    const read = renderToStaticMarkup(createElement(ActionItem, { a, names: { "p-1": "山田" } }));
    expect(read).not.toContain("data-ask-pick");
    expect(read).toContain('data-ask-mark="transport"');
  });
  it("本人を渡すと押せるボタン（アイコン＋文字）、渡さないと文字のまま。全部の種類", () => {
    for (const ask of every) {
      const on = renderToStaticMarkup(createElement(AskMarks, { asks: [ask], person: "p-1" }));
      expect(on, ask).toMatch(new RegExp(`<button[^>]*data-ask-pick="${ask}"`));
      expect(on, ask).toContain("<svg");
      const off = renderToStaticMarkup(createElement(AskMarks, { asks: [ask] }));
      expect(off, ask).not.toContain("<button");
      expect(off, ask).toContain(`data-ask-mark="${ask}"`);
    }
  });
  it("押すと対応の欄へ本人と頼み事を渡す（pickAct と同じ口）", () => {
    const got: unknown[] = [];
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    vi.stubGlobal("CustomEvent", class extends Event { detail: unknown; constructor(n: string, o: { detail: unknown }) { super(n); this.detail = o.detail; } });
    const off = onActPick((p) => got.push(p));
    pickAct({ person: "p-1", ask: "transport" });
    off();
    vi.unstubAllGlobals();
    expect(got).toEqual([{ person: "p-1", ask: "transport" }]);
  });
  it("進行中の場所は本人を渡す。通話の窓の中と終わった訓練は渡さない", () => {
    const log = read("../components/drill/ActionLog.tsx");
    expect(log).toContain("askPerson={live ? a.person : null}");
    expect(log).toContain("askPerson={talk ? action.person : null}");
    const drill = read("../components/drill/DrillLog.tsx");
    expect(drill).toContain("live: !finished");
    expect(drill.match(/askPerson=\{c\.live \? /g)?.length).toBe(4);
    expect(drill).not.toMatch(/<(TalkFold|VisitLine)(?![^>]*askPerson)[^>]*\/>/);
    expect(read("../components/drill/TalkBox.tsx")).toContain("askPerson={action.person}");
    expect(read("../components/drill/DrillRowDetail.tsx")).toContain("person={pick ? d.personId : null}");
    // 通話の窓の中（着信・外へ掛けた電話）は文字のまま
    expect(read("../components/drill/CallTalk.tsx")).toContain("<TalkLines lines={lines} speaker={speaker} />");
  });
  it("対応の欄は askPick で決め、切り替えの並びでは対応の欄を出す", () => {
    const panel = read("../components/drill/ActionPanel.tsx");
    expect(panel).toContain("askPick(d.ask, hints?.[d.person] ?? null)");
    expect(panel).toContain("focusAsk={focusAsk}");
    expect(read("../components/drill/DrillPanes.tsx")).toContain('onActPick(() => setPane("main"))');
    expect(read("../components/drill/ActionHints.tsx")).toContain("data-hint-focus");
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
