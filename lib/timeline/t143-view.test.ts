// T143 の画面のテスト: 経過と変更履歴の畳み、見る方の画面（当たり前の値・時計の重なりと添え・未入力の添え）、AI 入力の吹き出しの保存した中身。
// 画面は react-dom/server で描く。人と台帳はこのテストの中で作る（種の台帳の値には寄らない。T142 が種を埋めている）。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { PersonView } from "../../components/person/PersonView.tsx";
import { LogBubble, type LogEntry } from "../../components/person/Intake.tsx";
import { parseLedger } from "../db/ledger.ts";
import type { ClockRow, Ledger, TimelineEntryRow } from "../db/types.ts";
import { savedLines, savedLine, SAVED_SHOWN } from "../intake/saved-say.ts";
import { intakePropsOf } from "../intake/props.ts";
import { USUAL_VALUES, isUsualValue } from "../intake/fields.ts";
import { toPersonView, type PersonPageRows, type PersonView as View } from "../person.ts";
import { scopeOfRows } from "../consent/scope.ts";

const AT = "2026-11-02T03:00:00.000Z";

function ledgerOf(over: (l: Ledger) => Ledger): Ledger {
  return over(parseLedger("{}"));
}

function clock(c: Partial<ClockRow> & Pick<ClockRow, "id" | "kind" | "category" | "label" | "starts_on">): PersonPageRows["clocks"][number] {
  return {
    person_id: "p-x",
    value: null,
    unit: null,
    source: null,
    source_note: null,
    confirmed_at: null,
    depends_on: null,
    depends_check: null,
    note: null,
    sort: 0,
    ...c,
  };
}

function rowsOf(ledger: Ledger, opts: { clocks?: PersonPageRows["clocks"]; timeline?: PersonPageRows["timeline"] } = {}): PersonPageRows {
  return {
    person: {
      id: "p-x",
      office_id: "office-demo",
      care_manager_id: "acct-yamamoto",
      name: "架空 花子",
      kana: "カクウ ハナコ",
      birth_date: "1940-04-18",
      ledger: JSON.stringify(ledger),
      plan_status: "draft",
      version: 1,
      origin: "care_manager",
      self_report_unreliable: 0,
      created_at: AT,
      updated_at: AT,
    } as PersonPageRows["person"],
    careManagerName: "山本",
    contacts: [],
    consents: [],
    clocks: opts.clocks ?? [],
    timeline: opts.timeline ?? [],
  };
}

const draw = (view: View) => renderToStaticMarkup(createElement(PersonView, { view, level: 1, edit: null }));
const view = (rows: PersonPageRows, o: { reading?: boolean; mode?: "normal" | "disaster" } = {}) =>
  toPersonView(rows, { today: "2026-11-06", mode: o.mode ?? "normal", reading: o.reading });
const sectionHtml = (html: string, id: string) => {
  const start = html.indexOf(`data-section="${id}"`);
  const end = html.indexOf("</section>", start);
  return html.slice(start, end);
};

function entry(id: string, kind: TimelineEntryRow["kind"], body: string | null, payload: object | null, at: string): PersonPageRows["timeline"][number] {
  return {
    id,
    person_id: "p-x",
    author_id: "acct-yamamoto",
    author_role: "care_manager",
    kind,
    body,
    payload: payload ? JSON.stringify(payload) : null,
    signal_id: null,
    occurred_at: at,
    created_at: at,
    retracted_at: null,
    retracted_by: null,
    retracted_note: null,
    author_name: "山本",
    signal_color: null,
  };
}

describe("経過と変更履歴の畳み", () => {
  const timeline = [
    entry("t-1", "note", "手入力: 既往", { source: "intake", ai: false, model: null, fields: ["medical.history"] }, "2026-11-04T01:00:00.000Z"),
    entry(
      "t-2",
      "note",
      "ケアマネが直した: アレルギー",
      {
        source: "intake",
        ai: false,
        model: null,
        edit: true,
        fields: ["medical.allergies"],
        diff: [{ key: "medical.allergies", section: "medical", label: "アレルギー", before: null, after: "甲殻類・スイカ" }],
      },
      "2026-11-05T01:00:00.000Z",
    ),
    entry("t-3", "safety_check", "電話で無事を確認", null, "2026-11-05T02:00:00.000Z"),
  ];

  it("平時: 経過は人が書き足す記録だけで畳む（件数と最後の 1 行）。台帳を直した跡は下の変更履歴に畳む", () => {
    const html = draw(view(rowsOf(parseLedger("{}"), { timeline })));
    const tl = sectionHtml(html, "timeline");
    expect(tl).toMatch(/data-fold="timeline"(?![^>]*data-open)/);
    expect(tl).toContain("1 件");
    expect(tl).toContain('data-fold-summary="timeline"');
    expect(tl).toContain("電話で無事を確認");
    // 変更履歴の行は経過に出ない
    expect(tl).not.toContain("手入力");
    expect(tl).not.toContain("既往を手で入力");
    const hist = sectionHtml(html, "history");
    expect(hist).toContain("変更履歴");
    // 台帳作成（種から作る行）・2 つの保存で 3 件
    expect(hist).toContain("3 件");
    expect(hist).toContain("既往を手で入力");
    expect(hist).toContain("アレルギーを手で修正");
    // 変更履歴は区分の並びの下（経過より後ろ）
    expect(html.indexOf('data-section="history"')).toBeGreaterThan(html.indexOf('data-section="timeline"'));
  });

  it("前と後のある行は押すと「欄 前 → 後」、無い古い行は押せない", () => {
    const hist = sectionHtml(draw(view(rowsOf(parseLedger("{}"), { timeline }))), "history");
    expect(hist).toMatch(/data-history="t-2"[^>]*data-diff-count="1"/);
    expect(hist).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="history-t-2"/);
    expect(hist).toContain('data-diff="medical.allergies"');
    expect(hist).toContain("甲殻類・スイカ");
    expect(hist).toContain("なし"); // 前が空
    expect(hist).not.toMatch(/data-history="t-1"[^>]*data-diff-count/);
    // <details> の既定の▼を使わない
    expect(hist).not.toContain("<details");
  });

  it("発災時は記録があれば開いた形（今どおり上）。行が無ければ「記録なし」の一言", () => {
    const html = draw(view(rowsOf(parseLedger("{}"), { timeline }), { mode: "disaster" }));
    expect(html.indexOf('data-section="timeline"')).toBeLessThan(html.indexOf('data-section="medical"'));
    expect(sectionHtml(html, "timeline")).toMatch(/data-fold="timeline"[^>]*data-open=""/);
    const empty = draw(view(rowsOf(parseLedger("{}"), { timeline: [timeline[0]] }), { mode: "disaster" }));
    expect(sectionHtml(empty, "timeline")).toContain("記録なし");
    expect(sectionHtml(empty, "timeline")).not.toContain('data-fold="timeline"');
  });

  it("医療班の範囲（発災時）でも、書き足された記録は開いた形で一番上。台帳を直した跡は医療班に出ない行のまま", () => {
    const rows = rowsOf(parseLedger("{}"), {
      timeline: [
        ...timeline,
        { ...entry("t-4", "examined", "血圧 140", null, "2026-11-05T03:00:00.000Z"), author_role: "medical", author_id: "acct-judge", author_name: "医療班 A" },
      ],
    });
    rows.consents = (["registry", "plan_share", "supporters", "medical", "ai_overseas"] as const).map((kind) => ({
      person_id: "p-x",
      kind,
      status: "granted" as const,
      scope: null,
      recorded_by: "acct-yamamoto",
      recorded_at: AT,
      expires_at: null,
      note: null,
      recorded_by_name: "山本",
      recorded_by_role: "care_manager" as const,
    }));
    const v = toPersonView(rows, { today: "2026-11-06", mode: "disaster", scope: scopeOfRows("medical", rows), reading: true });
    const html = draw(v);
    expect(v.sections[0].id).toBe("timeline");
    const tl = sectionHtml(html, "timeline");
    expect(tl).toMatch(/data-fold="timeline"[^>]*data-open=""/);
    expect(tl).toContain("血圧 140");
    expect(tl).toContain("電話で無事を確認");
    // 医療班の範囲では同意の区分が外なので、変更履歴に同意の行は出ない（前からの範囲のまま）
    expect(sectionHtml(html, "history")).not.toContain("同意");
  });
});

describe("経過の書き足しの欄（TimelineComposer）", () => {
  const timeline = [entry("t-3", "safety_check", "電話で無事を確認", null, "2026-11-05T02:00:00.000Z")];
  const viewAs = (role: "care_manager" | "medical" | "government", mode: "normal" | "disaster", items = timeline) => {
    const rows = rowsOf(parseLedger("{}"), { timeline: items });
    rows.consents = (["registry", "plan_share", "supporters", "medical", "ai_overseas"] as const).map((kind) => ({
      person_id: "p-x",
      kind,
      status: "granted" as const,
      scope: null,
      recorded_by: "acct-yamamoto",
      recorded_at: AT,
      expires_at: null,
      note: null,
      recorded_by_name: "山本",
      recorded_by_role: "care_manager" as const,
    }));
    return draw(toPersonView(rows, { today: "2026-11-06", mode, scope: scopeOfRows(role, rows), reading: true }));
  };
  /** 書き足しの欄が畳みの中（開いた時だけ）か */
  const insideFold = (html: string) => {
    const tl = sectionHtml(html, "timeline");
    const form = tl.indexOf('data-form="timeline"');
    const list = tl.indexOf('id="person-p-x-timeline-list"');
    expect(form).toBeGreaterThan(-1);
    return list > -1 && form > list;
  };

  it("平時のケアマネは経過の畳みの中（開いた時だけ）。行が無ければ「追記」で開く", () => {
    expect(insideFold(viewAs("care_manager", "normal"))).toBe(true);
    const empty = sectionHtml(viewAs("care_manager", "normal", []), "timeline");
    expect(empty).toMatch(/data-fold-toggle="timeline"[^>]*>[\s\S]*?追記/);
    expect(empty).toContain("記録なし");
  });

  it("発災時と行政の役はいつも出す。医療班の役には出さない（T172）", () => {
    expect(insideFold(viewAs("care_manager", "disaster"))).toBe(false);
    expect(insideFold(viewAs("government", "normal"))).toBe(false);
    expect(insideFold(viewAs("government", "disaster"))).toBe(false);
    for (const mode of ["normal", "disaster"] as const) {
      expect(sectionHtml(viewAs("medical", mode), "timeline")).not.toContain('data-form="timeline"');
    }
  });

  it("見出し「追記」の下に「種類」の選び（初めは記録）、文の欄に例の言葉", () => {
    const tl = sectionHtml(viewAs("care_manager", "disaster"), "timeline");
    const form = tl.slice(tl.indexOf('data-form="timeline"'));
    expect(form).toMatch(/<h4[^>]*>追記<\/h4>/);
    expect(form).toContain(">種類<");
    expect(form).toContain('role="radiogroup"');
    expect(form).toMatch(/role="radio" aria-checked="true"[^>]*data-kind="note"/);
    expect(form).toMatch(/data-kind="safety_check"[^>]*>安否確認/);
    expect(form).toMatch(/placeholder="例 /);
  });
});

describe("見る方の画面: 当たり前の値（lib/intake/fields.ts の USUAL_VALUES）", () => {
  const usual = ledgerOf((l) => ({
    ...l,
    medical: { ...l.medical, allergies: [], history: [] },
    care: { ...l.care, walking: "ok", hearing: "ok", vision: "ok", understanding: "ok", judgment: "ok", orientation: "ok", bedridden: false, dementia: false },
  }));

  it("表は 1 か所: 心身の問題なし・寝たきり／認知症のなし・アレルギー／既往のなし・本人の報告の通常", () => {
    expect(isUsualValue("care.hearing", "ok")).toBe(true);
    expect(isUsualValue("care.hearing", "hard")).toBe(false);
    expect(isUsualValue("care.bedridden", false)).toBe(true);
    expect(isUsualValue("medical.allergies", [])).toBe(true);
    expect(isUsualValue("medical.allergies", undefined)).toBe(false);
    expect(isUsualValue("medical.allergies", ["卵"])).toBe(false);
    expect(Object.keys(USUAL_VALUES)).toContain("basic.selfReport");
  });

  it("見る方は出さず、心身は「特記なし」。編集・医療要約の原本（reading なし）は今どおり全部", () => {
    const read = draw(view(rowsOf(usual), { reading: true }));
    expect(read).not.toContain("問題なし");
    expect(read).not.toContain('data-field="medical.allergies"');
    expect(read).not.toContain('data-field="medical.history"');
    expect(read).not.toContain('data-field="basic.selfReport"');
    expect(sectionHtml(read, "basic")).toMatch(/data-field="care"[\s\S]*特記なし/);
    const full = draw(view(rowsOf(usual)));
    expect(full).toContain("聴覚 問題なし");
    expect(full).toContain('data-field="medical.allergies"');
    expect(full).toContain('data-field="basic.selfReport"');
  });

  it("気を付ける所は出す（当たり前でない値だけ）", () => {
    const some = ledgerOf((l) => ({ ...l, care: { ...l.care, walking: "hard", hearing: "ok" }, medical: { ...l.medical, allergies: ["卵"] } }));
    const read = draw(view(rowsOf(some), { reading: true }));
    expect(read).toContain("歩行 困難");
    expect(read).not.toContain("聴覚 問題なし");
    expect(read).toContain('data-field="medical.allergies"');
  });
});

describe("見る方の画面: 時計を行の中に 1 回だけ、添えは触れた時", () => {
  const ledger = ledgerOf((l) => ({
    ...l,
    medical: {
      ...l.medical,
      devices: [{ kind: "oxygen", detail: "在宅酸素" }],
      medications: [
        { name: "ワーファリン", category: "anticoagulant", schedule: "1 日 1 回" },
        { name: "アムロジピン", category: "other", schedule: "朝" },
      ],
    },
  }));
  const clocks = [
    clock({ id: "k-1", kind: "device", category: "oxygen", label: "酸素 内蔵電池", value: 2, unit: "hour", starts_on: "outage", source: "device_manual", confirmed_at: AT }),
    clock({ id: "k-2", kind: "medication", category: "anticoagulant", label: "ワーファリン", starts_on: "disaster" }),
    clock({ id: "k-3", kind: "supply", category: "other", label: "飲み水", value: 3, unit: "day", starts_on: "disaster" }),
  ] as PersonPageRows["clocks"];

  it("機器・薬の行に入る時計は時計の段に重ねず、入らない時計（飲み水）だけ残す。編集の側（reading なし）は今どおり", () => {
    const read = sectionHtml(draw(view(rowsOf(ledger, { clocks }), { reading: true })), "medical");
    expect(read.match(/酸素 内蔵電池/g)).toHaveLength(1);
    expect(read).not.toContain('data-clock="k-1"');
    expect(read).not.toContain('data-clock="k-2"');
    expect(read).toContain('data-clock="k-3"');
    const full = sectionHtml(draw(view(rowsOf(ledger, { clocks }))), "medical");
    expect(full.match(/酸素 内蔵電池/g)!.length).toBeGreaterThan(1);
  });

  it("出典・確認日・手元の量 未確認は常には出さず、触れた時の添え。色の長さ（2 時間）は今どおり", () => {
    const read = sectionHtml(draw(view(rowsOf(ledger, { clocks }), { reading: true })), "medical");
    expect(read).toMatch(/data-hint=""[^>]*>[\s\S]*?2 時間/);
    expect(read).toMatch(/role="tooltip"[^>]*>出典 説明書　確認日 2026-11-02/);
    expect(read).toMatch(/role="tooltip"[^>]*>手元の量 未確認/);
    // 2 行目の出典・確認日の段は出さない
    expect(read).not.toContain("data-clock-source");
    expect(read).toContain('data-tone="urgent"');
  });

  it("用量・保管・電池の「未入力」の添えを出さない", () => {
    const read = sectionHtml(draw(view(rowsOf(ledger, { clocks: [] }), { reading: true })), "medical");
    const meds = read.slice(read.indexOf('data-field="medical.medications"'), read.indexOf('data-field="medical.devices"'));
    expect(meds).not.toContain("未入力");
    expect(meds).not.toContain("用量");
    const devices = read.slice(read.indexOf('data-field="medical.devices"'));
    expect(devices.slice(0, devices.indexOf("</dd>"))).not.toContain("電池");
    const full = sectionHtml(draw(view(rowsOf(ledger, { clocks: [] }))), "medical");
    expect(full).toContain("用量");
  });
});

describe("AI 入力の吹き出し: 保存した中身", () => {
  it("1 件 1 行の「区分 欄 値」、5 件まで、それより多ければ「他 N 件」", () => {
    expect(savedLine({ t: "note", value: "床ずれに注意" })).toBe("基本 床ずれに注意");
    expect(savedLine({ t: "field", key: "medical.history", value: ["高血圧", "心不全"] })).toBe("医療 既往 高血圧・心不全");
    expect(savedLine({ t: "field", key: "medical.allergies", value: [] })).toBe("医療 アレルギー なし");
    const many = Array.from({ length: SAVED_SHOWN + 2 }, (_, i) => ({ t: "note" as const, value: `メモ ${i}` }));
    expect(savedLines(many)).toEqual({ lines: many.slice(0, SAVED_SHOWN).map((c) => `基本 ${c.value}`), more: 2 });
  });

  it("保存したあとの吹き出しは数でなく中身を行に並べる（保存済）。変わらなかった・取消は今どおり", () => {
    const props = intakePropsOf(rowsOf(parseLedger("{}")), true);
    const bubble = (e: LogEntry) =>
      renderToStaticMarkup(
        createElement(LogBubble, { entry: e, props, busy: false, aiReady: true, onRows: () => {}, onSave: async () => {}, onDiscard: () => {}, onRetry: () => {} }),
      );
    const base = {
      id: "1",
      who: "ai" as const,
      kind: "split" as const,
      say: "2 項目を見つけました（基本 1・医療 1）",
      proposal: { model: "claude-sonnet-5-5", dropped: 0, rows: [] },
    };
    const saved = bubble({ ...base, state: "saved", changed: 2, saved: { lines: ["基本 床ずれに注意", "医療 既往 高血圧"], more: 0, head: null } });
    expect(saved).not.toContain("項目を見つけました");
    expect(saved.match(/data-intake="saved-line"/g)).toHaveLength(2);
    expect(saved).toContain("基本 床ずれに注意");
    expect(saved).toMatch(/data-intake="state"[^>]*>保存済</);
    expect(saved).toContain('data-ai=""');
    const more = bubble({ ...base, state: "saved", changed: 7, saved: { lines: ["a", "b", "c", "d", "e"], more: 2, head: "お薬手帳.jpg を読みました" } });
    expect(more).toContain("他 2 件");
    expect(more).toContain("お薬手帳.jpg を読みました");
    expect(bubble({ ...base, state: "saved", changed: 0, saved: { lines: ["x"], more: 0, head: null } })).toContain("項目を見つけました");
  });
});
