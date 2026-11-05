// T132: 行の詳細を読んで分かる言葉に（担当一覧・訓練・本人のページが lib/ledger-words.ts の 1 か所から）、
// 平時の情報を「全部」で開く（本人のページの組み立て）、訓練は詳細の連絡先の行から対応の欄の本人・手・相手を選ぶ口
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { onActPick, pickAct, type ActPick } from "../components/drill/act-pick.ts";
import { DrillRowDetail } from "../components/drill/DrillRowDetail.tsx";
import { FullDetail } from "../components/list/FullDetail.tsx";
import { RowDetail } from "../components/list/RowDetail.tsx";
import { PersonView } from "../components/person/PersonView.tsx";
import { SEED_PEOPLE, seedConsents, type SeedPerson } from "../seed/people.ts";
import { toCaseloadRows } from "./caseload.ts";
import type { ContactRow, DrillAction } from "./db/types.ts";
import type { DisasterSituation } from "./disaster/state.ts";
import type { ActionTerm } from "./drill/action-terms.ts";
import { contactAct } from "./drill/contact-act.ts";
import { clockText } from "./ledger-words.ts";
import type { ClockForDetail, ContactForDetail, RowDetail as Detail } from "./list/detail.ts";
import { buildFullDetail, withoutPhones } from "./list/full.ts";
import { toPersonView, type PersonPageRows } from "./person.ts";

// 担当一覧の行の詳細の電話のボタン（CallButtons）が読む
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const TODAY = "2026-11-05";
/** 発災 16:00、停電 18:00、今 19:00（JST）。酸素の内蔵電池（停電から 2 時間）は残り 1 時間 */
const SIT: DisasterSituation = {
  now: "2026-11-05T10:00:00.000Z",
  disasterAt: "2026-11-05T07:00:00.000Z",
  outageAt: "2026-11-05T09:00:00.000Z",
  outageTowns: null,
};

const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;
const contactsOf = (p: SeedPerson): ContactForDetail[] =>
  p.contacts.map((c, i) => ({ kana: null, address: null, mobile: null, ...c, person_id: p.person.id, sort: i }) as ContactForDetail);
const clocksOf = (p: SeedPerson): Array<ClockForDetail & { person_id: string }> =>
  p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i }));

/** 種の人の発災時の行の詳細（担当一覧と訓練の左の表の行と同じ道: lib/caseload.ts の toCaseloadRows → buildRowDetail） */
function detailOf(id: string): Detail {
  const p = seed(id);
  const [row] = toCaseloadRows(
    [{ ...p.person, ledger: JSON.stringify(p.ledger) }],
    clocksOf(p),
    contactsOf(p) as unknown as ContactRow[],
    TODAY,
    { situation: SIT, signals: new Map(), detail: { contacts: contactsOf(p), clocks: clocksOf(p), signals: [], calls: [] } },
  );
  return row.detail!;
}

function pageRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: TODAY, updated_at: TODAY },
    careManagerName: "山本",
    contacts: contactsOf(p),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: clocksOf(p),
    timeline: [],
  };
}

/** 描いた HTML の文字だけ（色を付けた所で言葉が分かれていても続けて読む） */
const plain = (html: string) => html.replace(/<[^>]+>/g, "");

const term = (block: string | null = null, targets: ActionTerm["targets"] = {}): ActionTerm => ({ minutes: 5, block, targets, adds: [], pickup: 1 });

describe("時計の言葉（担当一覧・訓練の行の詳細）", () => {
  it("物の名前・きっかけから長さ・残り。区分の語は行に混ぜない", () => {
    const d = detailOf("p-01");
    const lines = d.clocks.map((k) => k.text.line);
    expect(lines).toEqual([
      "酸素 内蔵電池 停電から 2 時間（残り 1 時間）",
      "酸素 予備ボンベ 停電から 8 時間（残り 7 時間）",
      "ワーファリン 手元の量 未確認（発災から数える）",
    ]);
    expect(d.clocks.map((k) => k.kind)).toEqual(["device", "supply", "medication"]);
    expect(d.clocks[0]).toMatchObject({ running: true, remaining: "残り 1 時間", tone: "urgent" });
    // 未確認は残りの所に置かない
    expect(d.clocks[2]).toMatchObject({ running: false, remaining: null, tone: null });
  });

  it("担当一覧の行の詳細: 区分の見出しで束ね、出典と確認日に名前。前の詰めた形が無い", () => {
    const html = renderToStaticMarkup(createElement(RowDetail, { detail: detailOf("p-01") }));
    for (const g of ["device", "supply", "medication"]) expect(html).toContain(`data-clock-group="${g}"`);
    expect(html).toMatch(/data-clock-group="device"><h4[^>]*>機器</);
    expect(html).toMatch(/data-clock-group="supply"><h4[^>]*>物品</);
    expect(plain(html)).toContain("酸素 内蔵電池停電から 2 時間残り 1 時間");
    expect(html).toContain("手元の量 未確認");
    expect(html).toContain("（発災から数える）");
    expect(html).toContain("出典 説明書");
    expect(html).toContain("出典 未確認");
    expect(html).toContain("確認日 未確認");
    expect(html).not.toContain("機器 2 時間 停電");
    expect(html).not.toContain("物 8 時間 停電");
    expect(html).not.toMatch(/薬 未確認 発災/);
    // 夜間は何の印か分かる形（支援者の欄）
    expect(html).toContain("夜間 来訪 未確認");
    expect(html).not.toMatch(/夜間未確認/);
    // 下に「全部」（閉じた形）
    expect(html).toContain("data-full-toggle");
    expect(html).toContain(">全部<");
  });

  it("訓練の行の詳細も同じ部品で、出典と確認日を出す", () => {
    const html = renderToStaticMarkup(createElement(DrillRowDetail, { detail: detailOf("p-01"), startedAt: SIT.disasterAt }));
    expect(html).toMatch(/data-clock-group="device"><h4[^>]*>機器</);
    expect(html).toContain("ワーファリン");
    expect(html).toContain("手元の量 未確認");
    expect(html).toContain("出典 未確認");
    expect(html).not.toMatch(/ワーファリン<\/span><span[^>]*>未確認/);
    expect(html).toContain("data-full-toggle");
  });
});

describe("本人のページも同じ言葉", () => {
  it("時計の欄と上の時計が lib/ledger-words.ts の言葉", () => {
    const p = seed("p-01");
    const v = toPersonView(pageRows(p), { today: TODAY });
    const block = v.sections.flatMap((s) => s.blocks).find((b) => b.type === "clocks");
    expect(block?.type === "clocks" && block.clocks.map((k) => k.text.line)).toEqual(p.clocks.map((k) => clockText(k).line));
    expect(v.head.clocks.find((k) => k.label === "酸素 内蔵電池")?.value).toBe("停電から 2 時間");
    // 値の無い時計は何の値か（上の欄でも「未確認」だけにしない）
    expect(v.head.clocks.find((k) => k.label === "ワーファリン")).toMatchObject({ value: null, note: "手元の量 未確認" });
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(html).toMatch(/data-clock-group="device"><h4[^>]*>機器</);
    expect(html).toContain("酸素 予備ボンベ");
    expect(plain(html)).toContain("停電から 8 時間");
    expect(html).toContain("出典 説明書");
    // 台帳の未確認（ワーファリンの残り 不明）は長さの所に、理由つきの印で（「未確認」を 2 回並べない）
    expect(html).toMatch(/手元の量<\/span><span[^>]*data-pending="1"><span[^>]*>未確認<\/span><span[^>]*>不明/);
    expect(html).not.toMatch(/手元の量 未確認<\/span><span[^>]*data-pending/);
  });

  it("関係者の夜間も同じ言葉", () => {
    const v = toPersonView(pageRows(seed("p-01")), { today: TODAY });
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(html).toContain("夜間 来訪 未確認");
    expect(html).not.toContain("夜間未確認");
  });
});

describe("「全部」（台帳の平時の情報）", () => {
  it("連絡先の全員と、本人のページと同じ面（関係者・医療・避難・基本）", () => {
    const full = detailOf("p-01").full!;
    expect(full.contacts.map((c) => c.kind)).toEqual(["self", "family", "supporter"]);
    const daughter = full.contacts[1];
    expect(daughter).toMatchObject({ name: "森 恵子", relation: "娘", kindMark: "家族", roles: ["緊急 1", "支援 1"] });
    expect(daughter.night).toEqual({ text: "夜間 来訪 未確認", ok: false });
    expect(daughter.facts).toEqual(["市内", "車あり", "スマホあり"]);
    expect(full.sections.map((s) => s.id)).toEqual(["people", "medical", "evacuation", "basic"]);
    // 関係者の面は連絡先の一覧の行を除いた物（役割の空き・みまもり員・夜間支援）
    const keys = full.sections[0].blocks.flatMap((b) => (b.type === "row" ? [b.row.key] : []));
    expect(keys).not.toContain("people.contacts");
    expect(keys).toContain("people.night_supporter");

    const html = renderToStaticMarkup(createElement(FullDetail, { full }));
    for (const id of ["people", "medical", "evacuation", "basic"]) expect(html).toContain(`data-full-section="${id}"`);
    for (const word of ["森 恵子", "木村 ヨシ", "酸素濃縮器", "ワーファリン", "かわなぎ小学校", "娘の車", "独居", "薬は 2 階の箪笥", "停電から 8 時間", "夜間 来訪 未確認"]) {
      expect(plain(html)).toContain(word);
    }
    // 担当一覧は電話のリンク
    expect(html).toContain('href="tel:09000000011"');
  });

  it("訓練の「全部」は番号と tel: を出さない（「電話あり」）", () => {
    const full = detailOf("p-01").full!;
    const html = renderToStaticMarkup(createElement(FullDetail, { full, drill: true }));
    expect(html).not.toContain("tel:");
    expect(html).not.toMatch(/090-0000/);
    expect(html).toContain("電話あり");
    // 面の中の番号（基本の面の本人の電話）も落とす
    expect(JSON.stringify(withoutPhones(full.sections))).not.toMatch(/090-0000/);
  });

  it("担当一覧の右の面と同じ組み立てなので、種の 10 人で落ちない", () => {
    for (const p of SEED_PEOPLE) {
      const full = buildFullDetail({ person: { ...p.person, ledger: JSON.stringify(p.ledger) }, contacts: contactsOf(p), clocks: clocksOf(p), today: TODAY });
      expect(full.sections.length).toBe(4);
      expect(full.contacts.every((c) => !["home_doctor", "pharmacy", "dialysis_center"].includes(c.kind))).toBe(true);
    }
  });
});

describe("訓練: 詳細の連絡先の行から手を選ぶ", () => {
  it("連絡の手を手の表の順に見て、押せる最初の物。本人は本人電話", () => {
    expect(contactAct({ id: "c-1", kind: "family" }, null)).toEqual({ kind: "call_contact", target: "c-1", label: "連絡先電話", block: null });
    expect(contactAct({ id: "c-0", kind: "self" }, null)).toMatchObject({ kind: "call_person", target: null, block: null });
    // 連絡の手で相手に取れない区分は文字のまま
    expect(contactAct({ id: "c-9", kind: "oxygen_supplier" }, null)).toBeNull();
  });

  it("決まりの表の結果を読むだけ: 押せなければ次の手、全部押せなければ理由", () => {
    const terms = (over: Partial<Record<DrillAction, ActionTerm>>) => over;
    expect(contactAct({ id: "c-1", kind: "family" }, terms({ call_contact: term(null, { family: "通話不可" }) }))).toMatchObject({
      kind: "advise_119",
      block: null,
    });
    const all = terms({ call_contact: term("通話不可"), advise_119: term("通話不可"), ask_check: term("通話不可") });
    expect(contactAct({ id: "c-1", kind: "family" }, all)).toEqual({ kind: "call_contact", target: "c-1", label: "連絡先電話", block: "通話不可" });
  });

  it("進行中だけ連絡先の行が押せる行になる（今の詳細と「全部」）。押せない時は理由", () => {
    const d = detailOf("p-01");
    const off = renderToStaticMarkup(createElement(DrillRowDetail, { detail: d, startedAt: SIT.disasterAt }));
    expect(off).not.toContain("data-contact-pick");
    const on = renderToStaticMarkup(createElement(DrillRowDetail, { detail: d, startedAt: SIT.disasterAt, pick: true }));
    expect(on).toContain('data-contact-pick="call_person"');
    expect(on).toContain('data-contact-pick="call_contact" data-contact-target="c-01-1"');
    expect(on).not.toContain("tel:");
    const blocked = renderToStaticMarkup(
      createElement(DrillRowDetail, { detail: d, startedAt: SIT.disasterAt, pick: true, terms: { call_contact: term("通話不可"), advise_119: term("通話不可"), ask_check: term("通話不可") } }),
    );
    expect(blocked).toMatch(/data-contact-pick="call_contact" data-contact-target="c-01-1" data-contact-block="通話不可"[^>]*disabled|disabled[^>]*data-contact-pick="call_contact" data-contact-target="c-01-1"/);
    // 「全部」の連絡先の行も同じ口で包む
    const pick = (c: Parameters<typeof contactAct>[0], line: React.ReactNode) => createElement("span", { "data-wrapped": c.id }, line);
    const full = renderToStaticMarkup(createElement(FullDetail, { full: d.full!, drill: true, contactSlot: pick }));
    expect(full).toContain('data-wrapped="c-01-1"');
  });
});

describe("対応の欄に渡す口（act-pick）", () => {
  const g = globalThis as unknown as { window?: EventTarget; document?: unknown };
  const saved = { window: g.window, document: g.document };
  afterEach(() => {
    g.window = saved.window;
    g.document = saved.document;
  });

  it("pickAct で送った本人・手・相手を、受ける側がそのまま受け取る。外したら受けない", () => {
    g.window = new EventTarget();
    g.document = { querySelector: () => null };
    const got: ActPick[] = [];
    const off = onActPick((p) => got.push(p));
    pickAct({ person: "p-01", kind: "call_contact", target: "c-01-1" });
    off();
    pickAct({ person: "p-02", kind: "call_person", target: null });
    expect(got).toEqual([{ person: "p-01", kind: "call_contact", target: "c-01-1" }]);
  });
});
