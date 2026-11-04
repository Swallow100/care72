import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIER_LABELS } from "../labels.ts";
import { QUALIFIERS, RULES, TIERS, categoryTier, tierBasis, type Tier } from "../triage/index.ts";
import { citedBy, OPERATION_CHECKS, sourcesDoc } from "./doc.ts";
import {
  QUOTE_MAX,
  SOURCES,
  SOURCE_IDS,
  assertSourceIds,
  checkMark,
  isSourceId,
  sourceById,
  type SourceEntry,
} from "./index.ts";

const all: ReadonlyArray<SourceEntry> = SOURCES;

/** 根拠を持つ物の全部: 表の行・足す言葉・骨格の段 */
const based = [
  ...RULES.map((r) => ({ name: `表の行 ${r.id}`, why: r.why, sourceIds: r.sourceIds })),
  ...QUALIFIERS.map((q) => ({ name: `足す言葉 ${q.id}`, why: q.why, sourceIds: q.sourceIds })),
  ...TIERS.map((t) => ({ name: `骨格の段 ${t.tier}`, why: t.why, sourceIds: t.sourceIds })),
];

/** 画面・README・動画に書かない言葉（CLAUDE.md）。なぜの 1 行にも使わない */
const BANNED = ["診断", "判定", "病気がわかる", "重症"];

describe("出典の登録簿", () => {
  it("id は重ならず、英小文字・数字・ハイフン（docs/SOURCES.md の見出しのアンカーと同じ）", () => {
    expect(new Set(SOURCE_IDS).size).toBe(SOURCE_IDS.length);
    for (const id of SOURCE_IDS) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("どの出典も発行元・題名・年・版・https の URL・要旨・使う範囲がある", () => {
    for (const s of all) {
      expect(s.publisher.trim(), s.id).not.toBe("");
      expect(s.title.trim(), s.id).not.toBe("");
      expect(s.edition.trim(), s.id).not.toBe("");
      expect(s.summary.trim(), s.id).not.toBe("");
      expect(s.scope.trim(), s.id).not.toBe("");
      expect(Number.isInteger(s.year) && s.year >= 2000 && s.year <= 2026, s.id).toBe(true);
      expect(s.url, s.id).toMatch(/^https:\/\/[^\s]+$/);
      if (s.page !== undefined) expect(s.page, s.id).toMatch(/^https:\/\/[^\s]+$/);
    }
  });

  it("PDF をリポジトリに入れない（URL はよそのサイト）", () => {
    for (const s of all) {
      expect(s.url, s.id).not.toMatch(/github\.com|care72/i);
    }
  });

  it(`引用は ${QUOTE_MAX} 字まで、場所つき`, () => {
    for (const s of all) {
      if (!s.quote) continue;
      expect([...s.quote.text].length, `${s.id}: ${s.quote.text}`).toBeLessThanOrEqual(QUOTE_MAX);
      expect(s.quote.text.trim(), s.id).not.toBe("");
      expect(s.quote.where.trim(), s.id).not.toBe("");
    }
  });

  it("確認の日は YYYY-MM-DD の本当の日付か null（未確認）", () => {
    for (const s of all) {
      if (s.checkedOn === null) {
        expect(checkMark(s.id)).toBe("未確認");
        continue;
      }
      expect(s.checkedOn, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${s.checkedOn}T00:00:00Z`).toISOString().slice(0, 10), s.id).toBe(s.checkedOn);
      expect(checkMark(s.id)).toBe("確認済");
    }
  });

  it("無い id は投げる", () => {
    expect(isSourceId("jadp-dialysis-2023")).toBe(true);
    expect(isSourceId("made-up-2026")).toBe(false);
    expect(() => sourceById("made-up-2026")).toThrow("出典の登録簿に無い id: made-up-2026");
    expect(() => assertSourceIds(["jadp-dialysis-2023", "made-up-2026"])).toThrow("made-up-2026");
    expect(() => assertSourceIds(["jadp-dialysis-2023"])).not.toThrow();
  });
});

describe("ルールの表の根拠", () => {
  it("表の行・足す言葉・骨格の段の全部に出典の id が 1 つ以上あり、全部が登録簿にある", () => {
    for (const b of based) {
      expect(b.sourceIds.length, b.name).toBeGreaterThan(0);
      expect(new Set(b.sourceIds).size, `${b.name} の id が重なる`).toBe(b.sourceIds.length);
      for (const id of b.sourceIds) expect(isSourceId(id), `${b.name}: ${id}`).toBe(true);
    }
  });

  it("全部に「なぜ」の 1 文がある（事実 → 確かめる物。改行なし、書かない言葉なし）", () => {
    for (const b of based) {
      expect(b.why.trim(), b.name).not.toBe("");
      expect(b.why, b.name).toContain(" → ");
      expect(b.why, b.name).not.toMatch(/\n/);
      for (const w of BANNED) expect(b.why, `${b.name} に「${w}」`).not.toContain(w);
    }
  });

  it("骨格の段は 1〜8 が順に 1 つずつ、名前は TIER_LABELS", () => {
    expect(TIERS.map((t) => t.tier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const t of TIERS) {
      expect(TIER_LABELS[t.tier]).toBeTruthy();
      expect(tierBasis(t.tier)).toBe(t);
    }
    expect(() => tierBasis(9 as Tier)).toThrow();
  });

  it("時計の区分から段を引ける（本人のページの時計ごとの「なぜ」）", () => {
    expect(categoryTier("oxygen")).toBe(2);
    expect(categoryTier("suction")).toBe(1);
    expect(categoryTier("tube_feeding")).toBe(4);
    expect(categoryTier("antiepileptic")).toBe(5);
    expect(categoryTier("dementia")).toBeNull();
    expect(categoryTier("other")).toBeNull();
    expect(tierBasis(categoryTier("oxygen")!).why).toContain("予備ボンベ");
  });

  it("引く行・段は lib/triage から逆に引く", () => {
    expect(citedBy("jadp-dialysis-2023")).toContain("骨格の段 3（透析）");
    expect(citedBy("mhlw-dementia-2018")).toContain("足す言葉 self_green_set_aside（本人の申告は参考）");
    // 車中泊の血栓はまだルールの表に無い
    expect(citedBy("jsth-pe-2020")).toEqual([]);
  });
});

describe("docs/SOURCES.md", () => {
  const file = readFileSync(new URL("../../docs/SOURCES.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");

  it("登録簿とルールの表から作った物と同じ（違えば npm run docs:triage を流す）", () => {
    expect(file).toBe(sourcesDoc());
  });

  it("全部の出典に見出し（アンカー）と URL と確認の欄がある", () => {
    for (const s of all) {
      expect(file).toContain(`\n### ${s.id}\n`);
      expect(file).toContain(`<${s.url}>`);
      expect(file).toContain(`| [${s.id}](#${s.id}) |`);
    }
  });
});

describe("docs/TRIAGE.md の出典", () => {
  const file = readFileSync(new URL("../../docs/TRIAGE.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");

  it("表の行・足す言葉・骨格の段の出典が SOURCES.md へのリンクで載り、なぜの 1 文も載る", () => {
    for (const b of based) {
      expect(file, b.name).toContain(b.why);
      for (const id of b.sourceIds) expect(file, `${b.name}: ${id}`).toContain(`[${id}](SOURCES.md#${id})`);
    }
  });

  it("未確認の出典には「未確認」が付く", () => {
    for (const s of all) {
      if (s.checkedOn !== null) continue;
      if (citedBy(s.id).length === 0) continue;
      expect(file).toContain(`[${s.id}](SOURCES.md#${s.id}) 未確認`);
    }
  });
});

describe("本運用で確かめること（T48）", () => {
  it("README と docs/SOURCES.md に同じ一覧。同意・仮名と対応表・外国の事業者・表の監修を、断定せず「確かめる」の形で", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const sources = readFileSync(new URL("../../docs/SOURCES.md", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    for (const c of OPERATION_CHECKS) {
      expect(readme, c).toContain(`- ${c}`);
      expect(sources, c).toContain(`- ${c}`);
    }
    const all = OPERATION_CHECKS.join("\n");
    for (const w of ["要配慮個人情報", "2 条 1 項", "28 条", "監修"]) expect(all, w).toContain(w);
  });
});
