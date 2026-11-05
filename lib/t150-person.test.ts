// T150: 本人のページの上の段の「医療」と「時計」を 1 つに（同じ時計を 2 回出さない）、空いた欄に避難先。
// 行の詳細の「全部」の医療の面に「残り時間」と同じ時計を出さない。本人のページの書類の段を畳む。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentSection } from "../components/person/DocumentSection.tsx";
import { PersonHead } from "../components/person/PersonHead.tsx";
import { PersonView } from "../components/person/PersonView.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../seed/people.ts";
import { viewScope } from "./consent/scope.ts";
import { buildFullDetail } from "./list/full.ts";
import { toPersonView, type DocumentView, type PersonPageRows } from "./person.ts";
import { FIRST_DOCUMENTS, splitDocuments } from "./person-documents.ts";

const TODAY = "2026-11-02";
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

function seedRows(p: SeedPerson, clocks = p.clocks): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const headOf = (id: string) => toPersonView(seedRows(seed(id)), { today: TODAY }).head;

/** 描いた HTML の見える文字（属性の title は外す） */
const visible = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const renderHead = (head: ReturnType<typeof headOf>) => renderToStaticMarkup(createElement(PersonHead, { head, level: 2, titleId: "t" }));

describe("上の段の医療（lib/person.ts の headMedical、components/person/PersonHead.tsx）", () => {
  it("時計が 1 つの区分は印だけ（「呼吸器 3h」）。時計の 1 行は印に触れた時（title）で、見える文字には 2 回目を出さない", () => {
    const h = headOf("p-02");
    expect(h.medical).toEqual([
      { mark: { label: "呼吸器", tone: "urgent", remaining: "3h" }, waiting: false, others: [], lines: ["人工呼吸器 内蔵電池 停電から 3 時間"] },
    ]);
    const html = renderHead(h);
    const text = visible(html);
    expect(text).toContain("呼吸器 3h");
    expect(text).not.toContain("停電から 3 時間");
    expect(text).not.toContain("人工呼吸器 内蔵電池");
    expect(html).toContain('title="人工呼吸器 内蔵電池 停電から 3 時間"');
    // 前の「時計」の欄は無い
    expect(text).not.toMatch(/ 時計 /);
  });

  it("同じ区分に時計が 2 つ: 印の数の元（いちばん短い）でない方を 1 行で添える。値の無い時計は添えない（印に数が無いことで分かる）", () => {
    const h = headOf("p-01");
    expect(h.medical.map((m) => [m.mark?.label, m.mark?.remaining, m.others.map((k) => `${k.label} ${k.value}`)])).toEqual([
      ["酸素", "2h", ["酸素 予備ボンベ 停電から 8 時間"]],
      ["抗凝固", null, []],
    ]);
    expect(h.medical[1].lines).toEqual(["ワーファリン 手元の量 未確認（発災から数える）"]);
    const text = visible(renderHead(h));
    expect(text).toContain("酸素 2h");
    expect(text).toContain("酸素 予備ボンベ");
    expect(text).toContain("停電から 8 時間");
    expect(text).not.toContain("停電から 2 時間");
    expect(text.match(/酸素 内蔵電池/g)).toBeNull();
  });

  it("災害モード: 印は今の残り、まだ走っていない時計の印には「未開始」、添えの行は今の残り", () => {
    const now = "2026-11-03T06:00:00.000Z";
    const hoursAgo = (n: number) => new Date(Date.parse(now) - n * 3_600_000).toISOString();
    const inDisaster = (outageAt: string | null) =>
      toPersonView(seedRows(seed("p-01")), { today: TODAY, mode: "disaster", situation: { now, disasterAt: hoursAgo(6), outageAt, outageTowns: null } }).head;
    const out = inDisaster(hoursAgo(3));
    expect(out.medical[0]).toMatchObject({ mark: { label: "酸素", remaining: "超過" }, waiting: false });
    expect(out.medical[0].others.map((k) => k.value)).toEqual(["残り 5 時間"]);
    const calm = inDisaster(null);
    expect(calm.medical[0]).toMatchObject({ mark: { remaining: "2h" }, waiting: true });
    const text = visible(renderHead(calm));
    expect(text).toContain("酸素 2h 未開始");
  });

  it("印の区分に入らない時計（その他）は印の無い行として全部出す（値の無い物も）", () => {
    const p = seed("p-02");
    const extra = { ...p.clocks[0], id: "k-x", label: "電動ベッド 内蔵電池", category: "other" as const, value: null, unit: null };
    const h = toPersonView(seedRows(p, [...p.clocks, extra]), { today: TODAY }).head;
    expect(h.medical.at(-1)).toMatchObject({ mark: null, others: [{ id: "k-x", label: "電動ベッド 内蔵電池", value: null }] });
    expect(visible(renderHead(h))).toContain("電動ベッド 内蔵電池");
  });

  it("時計の無い人・状態だけの人は印だけ（認知症）。医療が範囲の外なら欄ごと出さない", () => {
    expect(headOf("p-04").medical).toEqual([{ mark: { label: "認知症", tone: null, remaining: null }, waiting: false, others: [], lines: [] }]);
    const staff = toPersonView(seedRows(seed("p-02")), { today: TODAY, scope: viewScope("medical", { consents: [], origin: "care_manager" }) }).head;
    expect(staff.medical).toEqual([]);
    expect(renderHead(staff)).not.toContain("data-head-medical");
  });
});

describe("上の段の避難先（前の「時計」の欄の所）", () => {
  it("避難先 1・2 と手段。無い物は未確認", () => {
    const h = headOf("p-01");
    const e = seed("p-01").ledger.evacuation;
    expect(h.evacuation?.first).toBe(e.destination1 ?? null);
    const html = renderHead(h);
    expect(html).toContain("data-head-evacuation");
    expect(visible(html)).toContain("避難先");
    if (e.destination1) expect(visible(html)).toContain(e.destination1);
  });

  it("避難の区分が見る人の範囲の外なら null で、欄を出さない", () => {
    const staff = toPersonView(seedRows(seed("p-01")), { today: TODAY, scope: viewScope("medical", { consents: [], origin: "care_manager" }) }).head;
    expect(staff.evacuation).toBeNull();
    expect(renderHead(staff)).not.toContain("data-head-evacuation");
  });
});

describe("行の詳細の「全部」の医療の面（lib/list/full.ts）", () => {
  const fullOf = (id: string) => {
    const p = seed(id);
    const rows = seedRows(p);
    return buildFullDetail({ person: rows.person, contacts: rows.contacts, clocks: rows.clocks, today: TODAY });
  };
  it("走る時計は上の「残り時間」に出ているので、「時計」の段に出さない", () => {
    const medical = fullOf("p-01").sections.find((s) => s.id === "medical")!;
    expect(medical.blocks.some((b) => b.type === "clocks")).toBe(false);
    // 機器・薬の行はそのまま
    expect(medical.blocks.some((b) => b.type === "row" && b.row.key === "medical.devices")).toBe(true);
  });
  it("本人の状態の時計（「残り時間」に出ない）だけは残す", () => {
    const medical = fullOf("p-04").sections.find((s) => s.id === "medical")!;
    const clocks = medical.blocks.flatMap((b) => (b.type === "clocks" ? b.clocks : []));
    expect(clocks.length).toBeGreaterThan(0);
    expect(clocks.every((k) => k.text.kind === "condition")).toBe(true);
  });
});

describe("本人のページの書類の段（lib/person-documents.ts、components/person/DocumentSection.tsx）", () => {
  const docsOf = (id = "p-01") => {
    const v = toPersonView(seedRows(seed(id)), { today: TODAY });
    const s = v.sections.find((x) => x.id === "documents")!;
    return s.blocks.flatMap((b) => (b.type === "documents" ? b.documents : []));
  };

  it("最初は計画書・医療要約・本人の 1 枚。ほかは開いたら見える。並びは来た順のまま", () => {
    const { first, rest } = splitDocuments(docsOf());
    expect(first.map((d) => d.key)).toEqual(["matsuyama", "medical", "own"]);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((d) => !FIRST_DOCUMENTS.has(d.key))).toBe(true);
  });

  it("最初に出す物が 1 つも無ければ全部を出す（空の段にしない）", () => {
    const qr: DocumentView = { key: "qr", label: "QR", status: "表示", href: "/x" };
    expect(splitDocuments([qr])).toEqual({ first: [qr], rest: [] });
  });

  it("畳んだ形: 最初の 3 つの行と「表示」「印刷」、「他 N 件」。書類ごとの説明の 1 行は出さない", () => {
    const docs = docsOf();
    const { rest } = splitDocuments(docs);
    const html = renderToStaticMarkup(createElement(DocumentSection, { documents: docs }));
    for (const k of ["matsuyama", "medical", "own"]) {
      expect(html).toContain(`data-field="documents.${k}"`);
      expect(html).toContain(`data-print-link="${k}"`);
    }
    for (const d of rest) expect(html).not.toContain(`data-field="documents.${d.key}"`);
    expect(html).not.toContain("data-document-about");
    expect(visible(html)).toContain(`他 ${rest.length} 件`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("<details");
  });

  it("本人のページの書類の段もこの形（PersonView の Blocks から）", () => {
    const v = toPersonView(seedRows(seed("p-01")), { today: TODAY });
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 2 }));
    expect(html).toContain("data-documents-toggle");
    expect(html).not.toContain("data-document-about");
    expect(html).toContain('data-print-link="matsuyama"');
  });
});
