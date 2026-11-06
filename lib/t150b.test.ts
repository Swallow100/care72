// T150b: 本人のページの上の段の「医療」に薬を 1 つ 1 行で（名前・区分・量・残り・中断注意、3 つまでと「他 N 件」）。
// 区分だけの印（抗凝固）と薬の行を重ねない。担当一覧・訓練の行の詳細の「薬」も同じ形（lib/person.ts の medLines、components/person/MedLines.tsx）。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DrillRowDetail } from "../components/drill/DrillRowDetail.tsx";
import { PersonHead } from "../components/person/PersonHead.tsx";
import { SEED_AT, SEED_PEOPLE, seedConsents, type SeedPerson } from "../seed/people.ts";
import { viewScope } from "./consent/scope.ts";
import type { Ledger } from "./db/types.ts";
import { buildRowDetail } from "./list/detail.ts";
import { MED_LINES_MAX, medLines, toPersonView, type PersonPageRows } from "./person.ts";
import { triage } from "./triage/index.ts";
import { toTriagePerson } from "./triage/from-ledger.ts";

const TODAY = "2026-11-02";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = (id: string) => SEED_PEOPLE.find((p) => p.person.id === id)!;

function rowsOf(p: SeedPerson, ledger: Ledger = p.ledger, clocks = p.clocks): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

/** 山田 ハナ（p-01）に薬を 4 つ（量のある物・印の区分・印の無い区分）と、ワーファリンの手元の量 7 日の時計 */
function many() {
  const p = seed("p-01");
  const ledger: Ledger = structuredClone(p.ledger);
  ledger.medical.medications = [
    { name: "降圧薬", category: "other", schedule: "1 日 1 回", amount: "1 回 1 錠" },
    { name: "ワーファリン", category: "anticoagulant", schedule: "1 日 1 回", interruptionRisk: true },
    { name: "メトホルミン", category: "oral_diabetes", schedule: "朝夕" },
    { name: "整腸剤", category: "other" },
  ];
  const clocks = p.clocks.map((k) => (k.label === "ワーファリン" ? { ...k, value: 7, unit: "day" as const } : k));
  return { p, ledger, clocks };
}

const visible = (html: string) =>
  html
    .replace(/<span[^>]*data-hint-text[^>]*>[^<]*<\/span>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");

describe("薬の行（lib/person.ts の medLines）", () => {
  it("1 つ 1 行: 名前・区分・量（台帳にあれば）・残り（手元の量）・中断注意。印の区分の薬が先、3 つまでと残りの数", () => {
    const { ledger, clocks } = many();
    const m = medLines(ledger.medical.medications, clocks, null);
    expect(m.lines).toHaveLength(MED_LINES_MAX);
    expect(m.more).toBe(1);
    expect(m.lines.map((l) => l.name)).toEqual(["ワーファリン", "降圧薬", "メトホルミン"]);
    expect(m.lines[0]).toMatchObject({ mark: { label: "抗凝固" }, category: null, amount: null, interruption: true, left: { label: "手元の量", text: "7 日" } });
    expect(m.lines[1]).toMatchObject({ mark: null, category: "その他", amount: "1 回 1 錠", left: null, interruption: false });
    expect(m.lines[2]).toMatchObject({ mark: null, category: "経口糖尿病薬", amount: null });
    expect(m.covered).toEqual(new Set(["anticoagulant"]));
    expect(m.clockIds.size).toBe(1);
  });

  it("災害モードは今の残り（発災から数える薬）", () => {
    const { ledger, clocks } = many();
    const now = "2026-11-03T06:00:00.000Z";
    const m = medLines(ledger.medical.medications, clocks, { now, disasterAt: "2026-11-03T00:00:00.000Z", outageAt: null });
    expect(m.lines[0].left).toMatchObject({ label: null, text: "残り 6.8 日" });
  });

  it("薬の無い人は行なし", () => {
    expect(medLines([], [], null)).toMatchObject({ lines: [], more: 0 });
  });
});

describe("上の段の「医療」（components/person/PersonHead.tsx）", () => {
  it("薬の行を出し、区分の印（抗凝固）は行の中へ（印の並びに 2 回出さない）。酸素の印と予備ボンベの行はそのまま", () => {
    const { p, ledger, clocks } = many();
    const head = toPersonView(rowsOf(p, ledger, clocks), { today: TODAY }).head;
    expect(head.medical.map((x) => x.mark?.label)).toEqual(["酸素"]);
    expect(head.meds.lines.map((l) => l.name)).toEqual(["ワーファリン", "降圧薬", "メトホルミン"]);
    expect(head.meds.more).toBe(1);
    const html = renderToStaticMarkup(createElement(PersonHead, { head, level: 2, titleId: "t" }));
    const text = visible(html);
    expect(text.match(/抗凝固/g)).toHaveLength(1);
    expect(text).toContain("ワーファリン");
    expect(text).toContain("1 回 1 錠");
    expect(text).toContain("中断注意");
    expect(text).toContain("手元の量 7 日");
    expect(text).toContain("他 1 件");
    expect(text).not.toContain("整腸剤");
    expect(text).toContain("酸素 予備ボンベ");
    // 量の無い薬に「用量」「未入力」を出さない
    const medHtml = html.slice(html.indexOf("data-med-lines"), html.indexOf("</ul>", html.indexOf("data-med-lines")));
    expect(visible(medHtml)).not.toMatch(/未入力|用量/);
  });

  it("医療が範囲の外なら薬の行も出さない", () => {
    const { p, ledger, clocks } = many();
    const head = toPersonView(rowsOf(p, ledger, clocks), { today: TODAY, scope: viewScope("medical", { consents: [], origin: "care_manager" }) }).head;
    expect(head.meds).toEqual({ lines: [], more: 0 });
  });
});

describe("担当一覧・訓練の行の詳細の「薬」（lib/list/detail.ts）", () => {
  const detail = () => {
    const { p, ledger, clocks } = many();
    const now = "2026-11-03T06:00:00.000Z";
    const situation = { now, disasterAt: "2026-11-03T00:00:00.000Z", outageAt: "2026-11-03T03:00:00.000Z" };
    const rows = rowsOf(p, ledger, clocks);
    const t = triage({ person: toTriagePerson({ person: rows.person, ledger, contacts: rows.contacts, clocks: rows.clocks }), signals: [] }, situation);
    return buildRowDetail({ personId: p.person.id, ledger, contacts: rows.contacts, clocks: rows.clocks, signals: [], calls: [], triage: t, situation });
  };

  it("同じ薬の行。行に入った薬の時計は「残り時間」に出さない（2 回出さない）", () => {
    const d = detail();
    expect(d.meds.lines.map((l) => l.name)).toEqual(["ワーファリン", "降圧薬", "メトホルミン"]);
    expect(d.meds.more).toBe(1);
    expect(d.clocks.map((k) => k.label)).not.toContain("ワーファリン");
    expect(d.clocks.map((k) => k.label)).toContain("酸素 内蔵電池");
  });

  it("訓練の詳細に「薬」の段（担当一覧の詳細は電話の部品が app router を要るので、同じ部品と同じ条件で置くことを読んで確かめる）", () => {
    const d = detail();
    const html = renderToStaticMarkup(createElement(DrillRowDetail, { detail: d, startedAt: "2026-11-03T00:00:00.000Z" }));
    expect(html).toContain("data-med-lines");
    expect(html).toContain('data-med-line="ワーファリン"');
    expect(html).toContain('data-med-more="1"');
    expect(visible(html)).toContain("残り 6.8 日");
    const none = renderToStaticMarkup(createElement(DrillRowDetail, { detail: { ...d, meds: { lines: [], more: 0 } }, startedAt: "2026-11-03T00:00:00.000Z" }));
    expect(none).not.toContain("data-med-lines");
    for (const file of ["components/list/RowDetail.tsx", "components/drill/DrillRowDetail.tsx"]) {
      const src = readFileSync(join(root, file), "utf8");
      expect(src, file).toContain("{d.meds.lines.length > 0 && (");
      expect(src, file).toContain("<MedLines lines={d.meds.lines} more={d.meds.more} />");
    }
  });
});
