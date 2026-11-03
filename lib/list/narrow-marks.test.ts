// 表の狭い幅（768px 未満）で医療の列を省くとき、氏名の下に医療の印を時計の残りつきで 1 行（T54）。
// 受け持ちの表（components/staff）と担当一覧の発災時の表（components/list）で同じ部品・同じ形。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisasterTable } from "../../components/list/DisasterTable.tsx";
import { CaseloadTable } from "../../components/list/CaseloadTable.tsx";
import { MedicalCell, NarrowMarks } from "../../components/list/NarrowMarks.tsx";
import { StaffTable } from "../../components/staff/StaffTable.tsx";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows } from "../caseload.ts";
import type { StaffRow } from "../custody/board.ts";
import { DEVICE_LABELS } from "../labels.ts";

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const AT = "2026-11-05T01:00:00.000Z";
const LATER = "2026-11-05T02:30:00.000Z";

/** 氏名の下の印の塊（1 人分）の中の文字 */
function narrowTexts(html: string): string[][] {
  return [...html.matchAll(/<div class="([^"]*)" data-narrow-marks="[^"]*">(.*?)<\/div>/g)].map((m) => {
    expect(m[1]).toContain("md:hidden");
    return [...m[2].matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((s) => s[1]);
  });
}

const staffRow = (p: Partial<StaffRow>): StaffRow => ({
  custodyId: "cu-1",
  personId: "p-01",
  name: "山田 ハナ",
  kana: "ヤマダ ハナ",
  age: 84,
  ageReported: false,
  marks: [],
  markItems: [],
  medications: [],
  devices: [],
  remain: null,
  shelter: "そらみ台小学校",
  via: "search",
  receivedAt: AT,
  receivedWhen: "11/5 10:00",
  office: "デモ事業所",
  unaffiliated: false,
  color: "red",
  tone: "urgent",
  reason: "",
  rank: 1,
  summary: false,
  ...p,
});

describe("氏名の下の医療の印（狭い幅だけ）", () => {
  it("項目名に時計のいちばん短い残り、残りの色は印の文字に。残りの無い項目は名前だけ", () => {
    const html = renderToStaticMarkup(
      createElement(NarrowMarks, {
        items: [
          { label: "酸素", tone: "urgent", remaining: "1.5h" },
          { label: "抗凝固", tone: null, remaining: null },
        ],
      }),
    );
    expect(narrowTexts(html)).toEqual([["酸素 1.5h", "抗凝固"]]);
    expect(html).toContain('data-tone="urgent"');
    // 塗りの印（安否の状態）でなく地の印。横に送らないよう折り返す
    expect(html).toContain("flex-wrap");
    // 印の中も空白の所で折り返せる（氏名の列を広げない）
    expect(html).toContain("break-keep");
    expect(html).not.toContain("whitespace-nowrap");
    expect(html).not.toContain("bg-state-urgent-fill");
  });

  it("時計の無い人は代わりの印（台帳の機器）。どちらも無ければ何も出さない", () => {
    expect(narrowTexts(renderToStaticMarkup(createElement(NarrowMarks, { items: [], fallback: ["在宅酸素"] })))).toEqual([["在宅酸素"]]);
    expect(renderToStaticMarkup(createElement(NarrowMarks, { items: [] }))).toBe("");
  });

  it("受け持ちの表: 医療の列は 768px 以上のまま、狭い幅は氏名の下に。時計の無い人は機器", () => {
    const html = renderToStaticMarkup(
      createElement(StaffTable, {
        shelters: ["そらみ台小学校"],
        rows: [
          staffRow({ marks: ["酸素"], markItems: [{ label: "酸素", tone: "urgent", remaining: "1.5h" }] }),
          staffRow({ custodyId: "cu-2", personId: "p-x", name: "松本 カズオ", kana: "マツモト カズオ", rank: 2, devices: ["在宅酸素"] }),
          staffRow({ custodyId: "cu-3", personId: "p-y", name: "架空 次郎", kana: "カクウ ジロウ", rank: 3 }),
        ],
      }),
    );
    expect(narrowTexts(html)).toEqual([["酸素 1.5h"], ["在宅酸素"]]);
    // 広い幅の医療の列は今のまま（hidden md:table-cell）
    expect(html.match(/hidden md:table-cell/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("担当一覧の発災時の表も同じ形。停電で走った酸素の時計は今の残り", () => {
    const rows = toCaseloadRows(people, clocks, contacts, "2026-11-05", {
      situation: { now: LATER, disasterAt: AT, outageAt: AT, outageTowns: null },
      signals: new Map(),
    });
    const yamada = rows.find((r) => r.id === "p-01")!;
    expect(yamada.markItems.map((m) => m.label)).toEqual(yamada.marks);
    const oxygen = yamada.markItems.find((m) => m.label === "酸素")!;
    expect(oxygen.tone).toBe("urgent");

    const html = renderToStaticMarkup(createElement(DisasterTable, { rows, sort: "state" }));
    const texts = narrowTexts(html).flat();
    expect(texts).toContain(`酸素 ${oxygen.remaining}`);
    // 印のある人の数だけ塊がある（印の無い人には出さない）
    expect(narrowTexts(html)).toHaveLength(rows.filter((r) => r.markItems.length > 0).length);
  });

  it("平時の行も同じ印（残りは時計の長さ）", () => {
    const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
    const yamada = rows.find((r) => r.id === "p-01")!;
    expect(yamada.markItems.map((m) => m.label)).toEqual(["酸素", "抗凝固"]);
    expect(yamada.markItems[0].remaining).toMatch(/^\d+(h|分|日|週)$/);
    expect(rows.find((r) => r.id === "p-09")!.markItems).toEqual([]);
  });
});

/** 広い幅（768px 以上）の医療の列の印の塊（1 人分）の中の文字。塊の無い行（「—」）は数えない */
function medicalTexts(html: string): string[][] {
  return [...html.matchAll(/<div class="[^"]*" data-medical-marks="[^"]*">(.*?)<\/div>/g)].map((m) =>
    [...m[1].matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((s) => s[1]),
  );
}

describe("担当一覧の 768px 以上の医療の列（受け持ちと同じ印。T56）", () => {
  it("MedicalCell: 残りつき・残りの色は印の文字、時計の無い人は機器、どちらも無ければ「—」", () => {
    const html = renderToStaticMarkup(
      createElement(MedicalCell, {
        items: [
          { label: "酸素", tone: "urgent", remaining: "27分" },
          { label: "抗凝固", tone: null, remaining: null },
        ],
      }),
    );
    expect(medicalTexts(html)).toEqual([["酸素 27分", "抗凝固"]]);
    expect(html).toContain('data-tone="urgent"');
    expect(html).toContain("flex-wrap");
    expect(html).toContain("break-keep");
    // 列の中なので md:hidden は付けない（列ごと hidden md:table-cell で出し分ける）
    expect(html).not.toContain("md:hidden");
    expect(medicalTexts(renderToStaticMarkup(createElement(MedicalCell, { items: [], fallback: ["在宅酸素"] })))).toEqual([["在宅酸素"]]);
    const empty = renderToStaticMarkup(createElement(MedicalCell, { items: [] }));
    expect(empty).toContain("—");
    expect(empty).not.toContain("data-medical-marks");
  });

  it("発災時の表: 医療の列に今の残り（停電で走った酸素）。氏名の下の印と同じ文字", () => {
    const rows = toCaseloadRows(people, clocks, contacts, "2026-11-05", {
      situation: { now: LATER, disasterAt: AT, outageAt: AT, outageTowns: null },
      signals: new Map(),
    });
    const html = renderToStaticMarkup(createElement(DisasterTable, { rows, sort: "state" }));
    const wide = medicalTexts(html);
    // 印のある人の数だけ列の塊があり、氏名の下（768 未満）と同じ文字
    expect(wide).toEqual(narrowTexts(html));
    const oxygen = rows.find((r) => r.id === "p-01")!.markItems.find((m) => m.label === "酸素")!;
    expect(wide.flat()).toContain(`酸素 ${oxygen.remaining}`);
    // 残りの無い「酸素」だけの印はもう無い（前は残りも色も無かった）
    expect(wide.flat()).not.toContain("酸素");
  });

  it("平時の表も同じ（残りは時計の長さ）。768px 未満は氏名の下、768px 以上は列", () => {
    const rows = toCaseloadRows(people, clocks, contacts, "2026-11-02");
    const html = renderToStaticMarkup(createElement(CaseloadTable, { rows, sort: "tier" }));
    const wide = medicalTexts(html);
    expect(wide).toEqual(narrowTexts(html));
    expect(wide).toHaveLength(rows.filter((r) => r.markItems.length > 0).length);
    const yamada = rows.find((r) => r.id === "p-01")!;
    expect(wide.flat()).toContain(`酸素 ${yamada.markItems[0].remaining}`);
  });

  it("時計の無い人（その場で登録した人）は台帳の機器を印に", () => {
    const seed = SEED_PEOPLE[0];
    const ledger = { ...seed.ledger, medical: { ...seed.ledger.medical, devices: [{ kind: "oxygen" as const, detail: "" }] } };
    const rows = toCaseloadRows([{ ...seed.person, ledger: JSON.stringify(ledger) }], [], [], "2026-11-02");
    expect(rows[0].markItems).toEqual([]);
    expect(rows[0].devices).toEqual([DEVICE_LABELS.oxygen]);
    const html = renderToStaticMarkup(createElement(CaseloadTable, { rows, sort: "tier" }));
    expect(medicalTexts(html)).toEqual([[DEVICE_LABELS.oxygen]]);
    expect(narrowTexts(html)).toEqual([[DEVICE_LABELS.oxygen]]);
  });
});
