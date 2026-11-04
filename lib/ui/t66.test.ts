// T66 画面を見た直し（docs/tasks/T66.md、docs/progress/screens-20261104.md）。
// - 状態の人数の帯: 1 人以上は 4 つとも言葉を塗りの印、数は本文色。0 人は印も数も灰
// - 残りの列（担当一覧・受入一覧）と受入一覧の状態の切替も同じ考え（塗りの印、黄は文字に使わない、0 は灰）
// - 並べ替えの見出しには印、押せない見出しは印なし。切替は地のあるボタン、見出しの言葉は地なし
// - ログインの上の説明と審査員の 1 行を外す、ヘッダーの左上に印（BrandMark の 1 か所から）
// - 画面と紙の「受け持ち」→「受入一覧」

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SEED_PEOPLE } from "../../seed/people.ts";
import { toCaseloadRows, type CaseloadDisaster } from "../caseload.ts";
import { CUSTODY_LABELS } from "../custody/labels.ts";
import type { StaffRow } from "../custody/board.ts";
import { STAFF_CSV_NAMES, STAFF_CSV_TITLE } from "../forms/staff-csv.ts";
import { SIGNALS, situation } from "../triage/heavy-rain.fixture.ts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/auth/server", () => ({ getPrincipal: async () => null }));

const { CountLabel, countClass, StateTag } = await import("../../components/ui/Tag.tsx");
const { ColorCounts } = await import("../../components/disaster/ColorCounts.tsx");
const { DisasterSummary } = await import("../../components/list/DisasterSummary.tsx");
const { DisasterTable } = await import("../../components/list/DisasterTable.tsx");
const { SortHeader } = await import("../../components/list/SortHeader.tsx");
const { FilterBar } = await import("../../components/list/FilterBar.tsx");
const { StaffTable } = await import("../../components/staff/StaffTable.tsx");
const { BrandMark } = await import("../../components/brand/BrandMark.tsx");
const { default: LoginPage } = await import("../../app/login/page.tsx");

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const COUNTS = { red: 2, yellow: 1, gray: 0, green: 0 } as const;

/** 人数の組（dt と dd）を 1 つずつ。data-count か div の中の dt・dd */
function pairs(markup: string): { label: string; tag: string; num: string; numClass: string }[] {
  return [...markup.matchAll(/<(?:dt|span)[^>]*>\s*(<span class="[^"]*"[^>]*>[^<]*<\/span>)\s*<\/(?:dt|span)>\s*<(?:dd|span) class="([^"]*)"[^>]*>(\d+)<\/(?:dd|span)>/g)].map(
    (m) => ({ tag: m[1], label: m[1].replace(/<[^>]+>/g, ""), numClass: m[2], num: m[3] }),
  );
}

function expectCountShape(markup: string) {
  const ps = pairs(markup);
  expect(ps.map((p) => p.label)).toEqual(["至急", "要確認", "不明", "無事"]);
  for (const p of ps) {
    // 数はどれも本文色（状態の色の文字を使わない）
    expect(p.numClass).not.toMatch(/text-state-|tone-check/);
    if (Number(p.num) > 0) {
      expect(p.tag).toMatch(/bg-state-[a-z]+-fill/);
      expect(p.numClass).not.toContain("text-muted");
    } else {
      // 0 は印も数も灰。不明の塗り（--state-unknown-fill）も使わない
      expect(p.tag).toContain("data-zero");
      expect(p.tag).toContain("text-muted");
      expect(p.tag).not.toMatch(/bg-state-/);
      expect(p.numClass).toContain("text-muted");
    }
  }
  return ps;
}

describe("人数の帯（至急・要確認・不明・無事）", () => {
  it("部品: 1 人以上は 4 つとも塗りの印（無事も緑、要確認だけでない）。0 は同じ箱の灰の印", () => {
    for (const tone of ["urgent", "check", "unknown", "ok"] as const) {
      const one = html(createElement(CountLabel, { tone, count: 1, children: "言葉" }));
      expect(one).toContain(`data-tone="${tone}"`);
      expect(one).toMatch(/bg-state-[a-z]+-fill/);
      const zero = html(createElement(CountLabel, { tone, count: 0, children: "言葉" }));
      expect(zero).toContain("data-zero");
      expect(zero).not.toMatch(/bg-state-/);
      expect(zero).toContain("bg-panel2");
    }
    // 面の中（灰の地）の上の 0 は白の地
    expect(html(createElement(CountLabel, { tone: "ok", count: 0, inPanel2: true, children: "無事" }))).toMatch(/class="[^"]*bg-panel[ "]/);
    // 0 と 1 で箱の大きさが同じ（並びが動かない）
    const box = (s: string) => s.match(/(px-[0-9.]+ [^"]*leading-[^ "]+)/)?.[1];
    expect(box(html(createElement(CountLabel, { tone: "ok", count: 0, size: "md", children: "無事" })))).toBe(
      box(html(createElement(StateTag, { tone: "ok", size: "md", children: "無事" }))),
    );
    expect(countClass(3)).toBe("");
    expect(countClass(0)).toBe("text-muted");
  });

  it("事業所・受入一覧・様式 9 の人数（ColorCounts）", () => {
    expectCountShape(html(createElement(ColorCounts, { counts: COUNTS })));
  });

  it("担当一覧と訓練の上の人数（DisasterSummary）は押せる形も押せない形も同じ", () => {
    const base = { counts: { ...COUNTS }, disaster: "5 時間", outage: null, at: "11/5 21:00" };
    const plain = html(createElement(DisasterSummary, base));
    const linked = html(createElement(DisasterSummary, { ...base, href: (c: string) => `/?color=${c}` }));
    for (const m of [plain, linked]) {
      const ps = expectCountShape(m);
      expect(ps.map((p) => p.num)).toEqual(["2", "1", "0", "0"]);
    }
    // 押せる人数は焦点の枠を持つ
    expect(linked).toMatch(/<a [^>]*focus-visible:outline-solid[^>]*data-count="red"/);
  });
});

// ---------- 残りの列 ----------

const people = SEED_PEOPLE.map((p) => ({ ...p.person, ledger: JSON.stringify(p.ledger) }));
const clocks = SEED_PEOPLE.flatMap((p) => p.clocks.map((k) => ({ ...k, person_id: p.person.id })));
const contacts = SEED_PEOPLE.flatMap((p) => p.contacts.map((c) => ({ ...c, person_id: p.person.id })));
const disasterAt = (h: number): CaseloadDisaster => ({
  situation: { ...situation(h), outageTowns: null },
  signals: new Map(Object.entries(SIGNALS)),
});

describe("残りの列（状態の色が付くときは塗りの印）", () => {
  it("担当一覧の発災時: 至急・要確認の残りは塗りの印、色の無い残りは本文色の文字。黄・赤の文字にしない", () => {
    const rows = toCaseloadRows(people, clocks, contacts, "2026-11-05", disasterAt(3.5));
    const m = html(createElement(DisasterTable, { rows, sort: "tier" }));
    const remains = [...m.matchAll(/<div class="([^"]*)" data-remain="([a-z]+)">([\s\S]*?)<\/div>/g)];
    expect(remains.length).toBeGreaterThan(0);
    const tones = new Set(remains.map((r) => r[2]));
    expect(tones.has("urgent")).toBe(true);
    expect(tones.has("check")).toBe(true);
    for (const [, cls, tone, body] of remains) {
      expect(cls).not.toMatch(/text-state-|tone-check/);
      if (tone === "none") expect(body).not.toContain("bg-state-");
      else expect(body).toMatch(new RegExp(`<span class="[^"]*bg-state-[a-z]+-fill[^"]*" data-tone="${tone}">`));
    }
  });

  it("受入一覧も同じ形。640px 未満は小さな印（375 で表が幅を超えないように）", () => {
    const row = (p: Partial<StaffRow>): StaffRow => ({
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
      remain: { label: "酸素 内蔵電池", text: "超過 1.2 時間", hours: -1.2, tone: "urgent" },
      shelter: "そらみ台小学校",
      via: "search",
      receivedAt: "2026-11-05T01:00:00.000Z",
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
    const rows = [
      row({}),
      row({ custodyId: "cu-2", personId: "p-03", rank: 2, color: "yellow", tone: "check", remain: { label: "透析", text: "残り 43.8 時間", hours: 43.8, tone: "check" } }),
      row({ custodyId: "cu-3", personId: "p-09", rank: 3, color: "green", tone: "ok", remain: { label: "降圧薬", text: "残り 6.8 日", hours: 163, tone: null } }),
    ];
    const m = html(createElement(StaffTable, { rows, shelters: ["そらみ台小学校"] }));
    expect(m).toMatch(/data-remain="urgent"><span class="[^"]*sm:text-sm[^"]*bg-state-urgent-fill[^"]*" data-tone="urgent">超過 1.2 時間<\/span>/);
    expect(m).toMatch(/data-remain="check"><span class="[^"]*bg-state-check-fill[^"]*" data-tone="check">残り 43.8 時間<\/span>/);
    expect(m).toMatch(/data-remain="none">残り 6.8 日<\/div>/);

    // 状態の切替: 見出し「状態」は地なしの言葉、切替は地のあるボタン。状態は人数の帯と同じ印と数（0 は灰）
    const filter = m.match(/<fieldset[^>]*data-filter="state"[\s\S]*?<\/fieldset>/)?.[0] ?? "";
    expect(filter).toMatch(/<span class="mr-0.5 text-muted" aria-hidden="true">状態<\/span>/);
    const buttons = [...filter.matchAll(/<button [^>]*>[\s\S]*?<\/button>/g)].map((b) => b[0]);
    expect(buttons.length).toBe(5);
    for (const b of buttons) {
      expect(b).toContain("bg-panel2");
      expect(b).toContain("focus-visible:outline-solid");
      expect(b).toMatch(/aria-pressed="(true|false)"/);
    }
    // 選んだ印は操作の色の枠（テーマ色の下地は敷かない）
    expect(buttons[0]).toMatch(/aria-pressed="true"/);
    expect(buttons[0]).toContain("ring-accent");
    expect(buttons[0]).not.toMatch(/bg-accent/);
    const states = Object.fromEntries(buttons.slice(1).map((b) => [b.match(/data-state-filter="([a-z]+)"/)![1], b]));
    expect(states.red).toMatch(/bg-state-urgent-fill[^>]*>至急<\/span><span class="font-bold tabular-nums ">1<\/span>/);
    expect(states.yellow).toMatch(/bg-state-check-fill[^>]*>要確認<\/span>/);
    expect(states.green).toMatch(/bg-state-ok-fill[^>]*>無事<\/span>/);
    expect(states.gray).toMatch(/data-zero[^>]*>不明<\/span><span class="font-bold tabular-nums text-muted">0<\/span>/);
    expect(states.gray).toContain('aria-label="不明 0"');

    // 表の見出し: 並べ替えのボタンには印、押せない見出し（状態・医療）は印なし
    const head = m.match(/<thead>[\s\S]*?<\/thead>/)![0];
    const ths = [...head.matchAll(/<th [^>]*>([\s\S]*?)<\/th>/g)].map((t) => t[1]);
    const sortable = ths.filter((t) => t.includes("<button"));
    expect(sortable.length).toBe(7);
    for (const t of sortable) expect(t).toMatch(/<svg[^>]*aria-hidden="true"/);
    // 押していない列は上下の印
    expect(sortable.filter((t) => t.includes("data-sortable")).length).toBe(6);
    for (const t of ths.filter((x) => !x.includes("<button") && x.trim() !== "" && !x.includes("sr-only"))) {
      expect(t).not.toContain("<svg");
    }
  });
});

describe("担当一覧の絞込の帯（見出しと押せる物を分ける）", () => {
  const props = {
    areas: ["かわなぎ町"],
    marks: [["oxygen", "酸素"]] as Array<["oxygen", string]>,
    sort: "tier" as const,
    dir: "asc" as const,
    open: null,
    filter: { color: "yellow" as const, area: null, mark: null, q: "" },
  };

  it("状態は受入一覧と同じ切替（地のあるボタン・人数の印・0 は灰・選んだ印は枠）。見出し「状態・地区・医療」は地なしの言葉", () => {
    const m = html(createElement(FilterBar, { ...props, disaster: true, colorCounts: { red: 2, yellow: 1, gray: 0, green: 0 } }));
    const fs = m.match(/<fieldset[^>]*data-filter="color"[\s\S]*?<\/fieldset>/)?.[0] ?? "";
    expect(fs).toMatch(/<span class="mr-0.5 text-muted text-xs" aria-hidden="true">状態<\/span>/);
    const buttons = [...fs.matchAll(/<button [^>]*>[\s\S]*?<\/button>/g)].map((b) => b[0]);
    expect(buttons.length).toBe(5);
    for (const b of buttons) {
      // スクリプトが動かなくても GET の form で絞れる（送信のボタンに name=color）
      expect(b).toMatch(/^<button type="submit" value="(|red|yellow|gray|green)"/);
      expect(b).toMatch(/ name="color"[ >]/);
      expect(b).toContain("bg-panel2");
      expect(b).toContain("focus-visible:outline-solid");
    }
    const by = Object.fromEntries(buttons.map((b) => [b.match(/data-state-filter="([a-z]+)"/)![1], b]));
    expect(by.yellow).toMatch(/aria-pressed="true"/);
    expect(by.yellow).toContain("ring-accent");
    expect(by.all).toMatch(/aria-pressed="false"/);
    expect(by.red).toMatch(/bg-state-urgent-fill[^>]*>至急<\/span><span class="font-bold tabular-nums ">2<\/span>/);
    expect(by.gray).toMatch(/data-zero[^>]*>不明<\/span><span class="font-bold tabular-nums text-muted">0<\/span>/);
    // 見出しの言葉は押せる形にしない（地なしの span）。押せる物は選ぶ欄の箱
    for (const word of ["地区", "医療"]) expect(m).toMatch(new RegExp(`<span class="text-xs text-muted">${word}</span>`));
    expect(m).not.toMatch(/<select|<option/);
    // 平時は状態で絞らない
    expect(html(createElement(FilterBar, { ...props, filter: { ...props.filter, color: null }, disaster: false }))).not.toContain('data-filter="color"');
  });
});

describe("ルールの表の説明の言葉", () => {
  it("「受け持ち」は「受入一覧」に（説明の言葉だけ。行の数と出典は同じ）、docs/TRIAGE.md も同じ言葉", () => {
    const root = join(import.meta.dirname, "..", "..");
    const doc = readFileSync(join(root, "docs", "TRIAGE.md"), "utf8");
    expect(doc).not.toContain("受け持ち");
    expect(doc).toContain("受入一覧から搬送で外した知らせ");
  });
});

describe("並べ替えの見出し（担当一覧・訓練）", () => {
  it("押していない列は上下の印、押している列は下線と向きの印。640px 未満は印を言葉の下に", () => {
    const off = html(createElement("table", null, createElement("thead", null, createElement("tr", null, createElement(SortHeader, { k: "kana", sort: "tier" })))));
    expect(off).toContain("data-sortable");
    expect(off).toMatch(/<svg[^>]*class="mx-auto block size-3 sm:ml-0.5 sm:inline/);
    const on = html(createElement("table", null, createElement("thead", null, createElement("tr", null, createElement(SortHeader, { k: "tier", sort: "tier" })))));
    expect(on).not.toContain("data-sortable");
    expect(on).toContain("underline");
    expect(on).toMatch(/<svg/);
    expect(on).toContain("focus-visible:outline-solid");
  });
});

// ---------- ログイン・印・言葉 ----------

describe("ログインと印", () => {
  it("ログインの上の説明の見出しと、審査員の 1 行を外す。見出しは「ログイン」だけで、印と名前はヘッダーの 1 か所（頁の中に重ねない）", async () => {
    const m = html(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(m).not.toContain("ケアマネの知っていること");
    expect(m).not.toContain("計画・訓練・発災時");
    expect(m).not.toContain("審査員");
    expect(m).not.toContain("ケア72");
    expect(m).toMatch(/<h1 id="login-title"[^>]*>\s*ログイン\s*<\/h1>/);
    // 印（72 時間の輪）も頁の中には出さない（ヘッダーの左上にある）
    expect(m).not.toContain(">72</text>");
    // 新規登録は作らない（docs/DECISIONS.md「アカウントと事業所」）
    expect(m).not.toContain("新規登録");
  });

  it("印は BrandMark の 1 か所から読む（ヘッダー・ログイン・役選択）。ヘッダーの印は動かない満ちた形", () => {
    const still = html(createElement(BrandMark, { size: 24, still: true }));
    expect(still).toContain('stroke-dashoffset="0"');
    const moving = html(createElement(BrandMark, { size: 56 }));
    expect(moving).not.toContain('stroke-dashoffset="0"');
    const root = join(import.meta.dirname, "..", "..");
    const users: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) {
          const src = readFileSync(p, "utf8");
          if (/from "@\/components\/login\/Mark72"/.test(src)) users.push(p.slice(root.length + 1).replaceAll("\\", "/"));
        }
      }
    };
    walk(join(root, "app"));
    walk(join(root, "components"));
    expect(users).toEqual(["components/brand/BrandMark.tsx"]);
    const header = readFileSync(join(root, "components", "AppHeader.tsx"), "utf8");
    expect(header).toMatch(/<BrandMark size=\{24\} still/);
  });

  it("画面と紙の言葉は「受入一覧」（見出し・タブの題名・CSV の名前と 1 行目）", () => {
    expect(CUSTODY_LABELS.page).toBe("受入一覧");
    expect(STAFF_CSV_TITLE).toBe("受入一覧");
    expect(STAFF_CSV_NAMES.utf8).toBe("受入一覧");
  });
});
