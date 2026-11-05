// T128: 訓練の画面を PC で「何が起きてきたか」が送らずに分かる形に。
// 手の時刻の書き方（時刻の範囲と所要を分ける）、切替の下線（名前と数で 1 本）、上の操作（次までと自動進行だけ。次までが手の時間も閉じる）、
// 上の帯の段の表（lib/drill/strip.ts）、区域の出来事の対象（lib/drill/area-targets.ts）、新着の決め（lib/drill/news.ts）、画面の描き。
// Claude は呼ばない。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BusyLine } from "../../components/drill/BusyLine.tsx";
import { DrillControls } from "../../components/drill/DrillControls.tsx";
import { LogTabs } from "../../components/drill/LogTabs.tsx";
import { Tabs, tabClass } from "../../components/ui/Tabs.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { ACT_TIME_LABELS, actSpanText, clockText, needText, needWhyText, timeBaseOf } from "./act-time.ts";
import type { ActTarget, ActionHooks } from "./actions.ts";
import { act } from "./actions.ts";
import { busyOf } from "./busy.ts";
import { nextEventMinute } from "./clock.ts";
import { advance, aiAtOf, initialState, type DrillState } from "./engine.ts";
import { NIGHT_START_HOUR, nightTimeLabel } from "./night.ts";
import { scoreView } from "./score-view.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

/** 日本の 13:44 に発災 */
const START = "2026-11-05T04:44:00.000Z";
const BASE = timeBaseOf(START, false);
const NIGHT = timeBaseOf(START, true);

const PARTICIPANTS = [...SEED_PEOPLE]
  .sort((a, b) => a.person.kana.localeCompare(b.person.kana) || (a.person.id < b.person.id ? -1 : 1))
  .map((p) => p.person.id);
const SELF_01: ActTarget = { id: "c-01-0", kind: "self", label: "本人", hasPhone: true };

async function clockAt0(): Promise<DrillState> {
  const init = initialState("heavy_rain", PARTICIPANTS, START, { clock: true, terms: true });
  return (await advance(init, 0, {}, { policy: "clock" }))!.state;
}

// ---------- 5. 手の時刻の書き方 ----------

describe("手の時刻の書き方（時刻の範囲と所要を分ける）", () => {
  it("訓練の中の時刻「13:44〜14:44」。同じ分は 1 つ、日をまたげば終わりに日付", () => {
    expect(actSpanText(BASE, 0, 60)).toBe("13:44〜14:44");
    expect(actSpanText(BASE, 120, 122)).toBe("15:44〜15:46");
    expect(actSpanText(BASE, 30, 30)).toBe("14:14");
    // 10 時間 16 分あとは 0:00（日本の 11/6）
    expect(actSpanText(BASE, 600, 640)).toBe("23:44〜11/6 0:24");
    expect(clockText(BASE, 75)).toBe("14:59");
  });

  it("夜間発災は深夜 2 時から数え、上の大きな経過の下の時刻（nightTimeLabel）と同じ。日をまたげば「翌」", () => {
    expect(NIGHT_START_HOUR).toBe(2);
    for (const m of [0, 59, 61, 330, 1320, 1500]) expect(clockText(NIGHT, m)).toBe(nightTimeLabel(m));
    expect(actSpanText(NIGHT, 0, 60)).toBe("2:00〜3:00");
    expect(actSpanText(NIGHT, 1310, 1330)).toBe(`23:50〜${ACT_TIME_LABELS.nextDay} 0:10`);
  });

  it("元が無いときは発災からの経過で両端を略さない（前の「2 時間〜2 分」にしない）", () => {
    expect(actSpanText(null, 120, 122)).toBe("2 時間〜2 時間 2 分");
    expect(actSpanText(null, 60, 120)).toBe("1 時間〜2 時間");
    expect(clockText(null, 90)).toBe("1 時間 30 分");
  });

  it("所要は「所要 60 分」、理由は別（「浸水・夜間」）。無ければ null", () => {
    expect(needText(60)).toBe("所要 60 分");
    expect(needWhyText(["浸水", "夜間"])).toBe("浸水・夜間");
    expect(needWhyText([])).toBeNull();
    expect(needWhyText(undefined)).toBeNull();
  });

  it("職員の空きの次空も訓練の中の時刻。元が無ければ前と同じ経過", () => {
    const busy = { minute: 55, aiAt: 0, used: 55, acts: 4, staffFree: 2, staffOut: 1, nextFree: 130 };
    expect(renderToStaticMarkup(createElement(BusyLine, { busy, base: BASE }))).toContain("15:54");
    expect(renderToStaticMarkup(createElement(BusyLine, { busy }))).toContain("2 時間 10 分");
  });

  it("採点の空振り・重複の時刻も訓練の中の時刻（元が無ければ経過）", () => {
    const score = {
      v: 1,
      participants: ["p-01"],
      endMinute: 120,
      order: { matched: 0, total: 1, misses: [] },
      report: { minute: null },
      form9: { blanks: 0, rows: [] },
      reached: [],
      calls: { total: 0, answered: 0, declined: 0, open: 0 },
      wasted: { rows: [{ action: "a1", person: "p-01", kind: "call_person", why: "unreachable", atMinute: 60 }] },
      repeat: { rows: [{ action: "a2", person: "p-01", kind: "call_person", gap: 10, atMinute: 70 }] },
      asks: { rows: [] },
      talks: 0,
    } as unknown as Parameters<typeof scoreView>[0];
    const view = scoreView(score, { "p-01": "山田 ハナ" }, null, BASE);
    expect(view.extra.wasted[0].at).toBe("14:44");
    expect(view.extra.repeat[0].at).toBe("14:54");
    expect(scoreView(score, { "p-01": "山田 ハナ" }, null).extra.wasted[0].at).toBe("1 時間");
  });
});

// ---------- 6. 切替の下線 ----------

describe("切替の下線（名前と数で 1 本）", () => {
  it("今の物は文字の装飾の下線でなく、切替の下の 1 本の線（after）。数は空白 1 つで並べる", () => {
    expect(tabClass(true)).toContain("after:h-0.5");
    expect(tabClass(true)).not.toContain("underline");
    expect(tabClass(false)).not.toContain("after:");
    const html = renderToStaticMarkup(
      createElement(LogTabs, {
        label: "経過切替",
        initial: "know",
        items: [
          { tab: "occur", label: "発生", count: 6 },
          { tab: "know", label: "把握", count: 14 },
          { tab: "act", label: "対応", count: 2 },
        ],
        panels: { occur: null, know: null, act: null },
      }),
    );
    const on = html.match(/<button[^>]*aria-selected="true"[^>]*>(.*?)<\/button>/)!;
    expect(on[0]).toContain("after:h-0.5");
    expect(on[0]).not.toContain("underline");
    expect(on[1]).toMatch(/把握 <span[^>]*data-tab-count[^>]*>14<\/span>/);
    expect(on[1]).not.toContain("ml-1");
  });

  it("画面の中の切替（components/ui/Tabs）も同じ見た目", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        label: "書類",
        items: [
          { href: "/forms", label: "書類", current: true },
          { href: "/office/form9", label: "様式9", current: false, count: 3 },
        ],
      }),
    );
    expect(html).toContain("after:h-0.5");
    expect(html).not.toContain("underline");
    expect(html).toMatch(/様式9 <span[^>]*data-tab-count[^>]*>3<\/span>/);
  });
});

// ---------- 7. 上の操作 ----------

describe("上の操作（次までと自動進行と中断だけ）", () => {
  it("連続の時計の訓練: 30 分・1 時間・3 時間・手の分・間の選択が無い。次までが主の操作", () => {
    const html = renderToStaticMarkup(createElement(DrillControls, { id: "d1", step: 1, done: false, clock: true, left: 100 }));
    expect(html).toContain("data-next");
    expect(html).not.toContain("data-minutes");
    expect(html).not.toContain("data-acts");
    expect(html).not.toContain('data-action="fast-interval"');
    expect(html).not.toContain("<select");
    expect(html).not.toContain("手の分");
    expect(html).not.toContain("2.5 秒</");
    // 自動進行は何をくり返すかを title に（常設の文は置かない）
    expect(html).toContain("自動進行");
    expect(html).toMatch(/title="次まで 2\.5 秒ごと"/);
    expect(html).toContain('data-action="abandon"');
  });

  it("「次まで」は前の区切りから進めるので、手に使った時間も閉じる（手の分が要らない）", async () => {
    const asked: string[] = [];
    const hooks: ActionHooks = {
      persona: async (input) => {
        asked.push(input.person);
        return [];
      },
    };
    let s = await clockAt0();
    for (const p of ["p-01", "p-02", "p-04"]) s = (await act(s, { kind: "call_person", person: p, target: SELF_01 }, {}, () => 0)).state;
    expect(busyOf(s, { on: true, aiAt: aiAtOf(s) }).used).toBe(15);
    const to = nextEventMinute(s);
    expect(to).toBeGreaterThan(15);
    const r = (await advance(s, to, hooks, { policy: "clock", next: true }))!;
    // 手で電話した人の本人役を、この区切りで呼んだ（手の分と同じ人）
    expect(asked).toEqual(expect.arrayContaining(["p-01", "p-02", "p-04"]));
    // AI を動かした最後の区切りが今の時計に追いつき、手に使った時間は 0 に戻る
    expect(r.state.aiAt).toBe(to);
    expect(r.state.minute).toBe(to);
    expect(busyOf(r.state, { on: true, aiAt: aiAtOf(r.state) }).used).toBe(0);
  });
});
