// T113: 本人のページの直し。関係者の面（1 人 1 行・役割の印・電話は 1 回）、生年月日の和暦、心身の入った項目と未入力の 1 行、
// 選ぶ欄の開いた一覧の未選択の行、位置を置く部品の数字。読む側の並べ方だけで、計画書の欄・連絡順・医療要約は変えない。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocationPick } from "../components/person/LocationPick.tsx";
import { PersonView } from "../components/person/PersonView.tsx";
import { SelectList } from "../components/ui/Select.tsx";
import { SEED_AT, seedConsents, type SeedContact, type SeedPerson } from "../seed/people.ts";
import { PLACE_LABELS, SECTION_LABELS } from "./labels.ts";
import { birthText, toPersonView, type Block, type PersonPageRows, type PersonView as View, type Row, type Seg } from "./person.ts";
import { readOptions, type SelectItem } from "./ui/select.ts";
// T142 で種の台帳を埋めた。このテストは空いた欄を前提にするので、T142 より前の空きの多い形（seed/sparse.ts）を使う
import { SPARSE_PEOPLE } from "../seed/sparse.ts";

const TODAY = "2026-11-05";

function seedRows(p: SeedPerson): PersonPageRows {
  return {
    person: { ...p.person, ledger: JSON.stringify(p.ledger), created_at: SEED_AT, updated_at: SEED_AT },
    careManagerName: "山本",
    contacts: p.contacts.map((c, i) => ({ ...c, person_id: p.person.id, sort: i })),
    consents: seedConsents(p).map((c) => ({ ...c, recorded_by_name: "山本", recorded_by_role: "care_manager" as const })),
    clocks: p.clocks.map((k, i) => ({ ...k, person_id: p.person.id, sort: i })),
    timeline: [],
  };
}

const seed = (id: string) => SPARSE_PEOPLE.find((p) => p.person.id === id)!;
const rowsOf = (blocks: Block[]): Row[] => blocks.flatMap((b) => (b.type === "row" ? [b.row] : []));
const section = (v: View, id: string) => v.sections.find((s) => s.id === id)!;
const rowOf = (v: View, key: string): Row | undefined => v.sections.flatMap((s) => rowsOf(s.blocks)).find((r) => r.key === key);
const linesOf = (r: Row | undefined): Seg[][] => (r && r.field.kind === "lines" ? r.field.lines : []);
const lineText = (l: Seg[]) => l.map((s) => s.text).join(" ");

/** 区分の HTML（data-section の面） */
function sectionHtml(html: string, id: string): string {
  const m = new RegExp(`<section[^>]*data-section="${id}"[\\s\\S]*?</section>`).exec(html);
  return m ? m[0] : "";
}

const base = seed("p-05");
/** 連絡先が本人と 1 人だけ（長男: 家族・緊急 1・支援 1・夜間可・車・スマホ）の人 */
function onePerson(extra: Partial<SeedContact> = {}): SeedPerson {
  const self = base.contacts.find((c) => c.kind === "self");
  const son: SeedContact = {
    id: "c-x-1",
    kind: "family",
    relation: "長男",
    name: "架空 一郎",
    phone: "090-0000-0091",
    reach: "in_city",
    emergency_order: 1,
    supporter_order: 1,
    night_ok: 1,
    has_car: 1,
    has_smartphone: 1,
    note: null,
    ...extra,
  };
  return { ...base, contacts: [...(self ? [self] : []), son] };
}

describe("関係者の面（T113）", () => {
  it("面の名前は「関係者」。問いの帯の頭も同じ言葉", () => {
    expect(SECTION_LABELS.people).toBe("関係者");
    const v = toPersonView(seedRows(seed("p-01")), { today: TODAY });
    expect(section(v, "people").label).toBe("関係者");
  });

  it("連絡先 1 人（家族・緊急 1・支援 1・夜間可）は 1 行。役割は印で並べ、電話は 1 回", () => {
    const v = toPersonView(seedRows(onePerson()), { today: TODAY });
    const list = rowOf(v, "people.contacts");
    expect(list?.label).toBe("連絡先");
    const lines = linesOf(list);
    expect(lines).toHaveLength(1);
    expect(lineText(lines[0])).toBe("架空 一郎 長男 家族 緊急 1 支援 1 夜間 来訪可 市内 車 スマホ 090-0000-0091");
    // 役割は色の無い印（状態の 4 色を使わない）
    expect(lines[0].filter((s) => s.mark).map((s) => s.text)).toEqual(["家族", "緊急 1", "支援 1", "夜間 来訪可"]);
    expect(lines[0].some((s) => s.tone && s.tone !== "muted")).toBe(false);
    // 埋まった役割の行は出さない（家族・緊急連絡先・支援者1・夜間支援の 4 か所に同じ人を並べない）
    for (const key of ["people.family", "people.emergency", "people.supporter1", "people.night_supporter"]) {
      expect(rowOf(v, key), key).toBeUndefined();
    }
    // 埋まっていない役割は「なし」のまま
    expect(rowOf(v, "people.supporter2")?.field).toEqual({ kind: "none" });
    expect(rowOf(v, "people.welfare_commissioner")?.field).toEqual({ kind: "none" });

    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    const people = sectionHtml(html, "people");
    expect(people).not.toBe("");
    expect(people.split("架空 一郎").length - 1).toBe(1);
    expect(people.split('href="tel:09000000091"').length - 1).toBe(1);
    // 1 行が 1 人の一覧は、人と人の間を 1 人の中の折り返しより広く空ける
    expect(list?.apart).toBe(true);
    expect(people).toMatch(/data-field="people.contacts"[\s\S]*?class="space-y-1.5"/);
    // 計画書・連絡順の元（上の段の緊急連絡先）はそのまま
    expect(v.head.emergency).toHaveLength(1);
  });

  it("支援者のいない人は「支援者1 なし」を注意の色で残す。夜間に来られる人がいなければ夜間支援の行", () => {
    const v = toPersonView(seedRows(onePerson({ supporter_order: null, night_ok: 0 })), { today: TODAY });
    expect(rowOf(v, "people.supporter1")?.field).toEqual({ kind: "none", tone: "check" });
    expect(rowOf(v, "people.night_supporter")?.field).toEqual({ kind: "none" });
    expect(lineText(linesOf(rowOf(v, "people.contacts"))[0])).toContain("夜間 来訪不可");
  });

  it("連絡先の行は緊急の順 → 支援の順 → ほかの順。本人とかかりつけ・薬局・透析施設は出さない", () => {
    const v = toPersonView(seedRows(seed("p-01")), { today: TODAY });
    const lines = linesOf(rowOf(v, "people.contacts")).map(lineText);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toMatch(/^森 恵子 娘 家族 緊急 1 支援 1/);
    for (const l of lines) expect(l).not.toMatch(/本人|かかりつけ|薬局|透析施設/);
    const p03 = toPersonView(seedRows(seed("p-03")), { today: TODAY });
    expect(JSON.stringify(section(p03, "people"))).not.toContain("あおたけ透析クリニック");
  });

  it("埋まった役割に未確認が付いたら、その役割の名前の行に出す（「その他」にしない）", () => {
    const p = onePerson();
    const v = toPersonView(seedRows({ ...p, ledger: { ...p.ledger, pending: [{ field: "people.emergency", status: "unknown" }] } }), { today: TODAY });
    expect(v.unconfirmed).toEqual([{ section: "people", field: "people.emergency", status: "unknown", label: "緊急連絡先" }]);
    expect(rowOf(v, "people.emergency")?.pending).toHaveLength(1);
    expect(section(v, "people").unconfirmed).toBe(1);
  });
});

describe("生年月日の和暦（T113）", () => {
  it("和暦と西暦の年。元年、大正・昭和・平成の境目", () => {
    expect(birthText("1941-03-12")).toBe("昭和16年3月12日（1941）");
    expect(birthText("1926-12-24")).toBe("大正15年12月24日（1926）");
    expect(birthText("1926-12-25")).toBe("昭和元年12月25日（1926）");
    expect(birthText("1989-01-07")).toBe("昭和64年1月7日（1989）");
    expect(birthText("1989-01-08")).toBe("平成元年1月8日（1989）");
    expect(birthText("1912-07-29")).toBe("1912年7月29日");
    expect(birthText("1912-07-30")).toBe("大正元年7月30日（1912）");
  });

  it("本人のページの基本の面に和暦で出し、「1942-04-18」の形を出さない。年齢はそのまま", () => {
    const v = toPersonView(seedRows(seed("p-01")), { today: TODAY });
    expect(lineText(linesOf(rowOf(v, "basic.birth"))[0])).toBe("昭和17年4月18日（1942）");
    expect(v.head.age).toBe(84);
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(html).not.toContain("1942-04-18");
  });
});

describe("心身は入った項目だけ、未入力は下の 1 行（T113）", () => {
  const withCare = (care: SeedPerson["ledger"]["care"]) => {
    const p = seed("p-02");
    return toPersonView(seedRows({ ...p, ledger: { ...p.ledger, care } }), { today: TODAY });
  };

  it("1 つだけ入った人: 「歩行 一部」と、下に灰の小さな字で「未入力　聴覚・…・認知症」", () => {
    const r = rowOf(withCare({ careLevel: "care2", walking: "some" }), "care");
    const lines = linesOf(r);
    expect(lines.map(lineText)).toEqual(["歩行 一部", "未入力　聴覚・視覚・理解・判断・見当識・寝たきり・認知症"]);
    expect(lines[1]).toEqual([{ text: "未入力　聴覚・視覚・理解・判断・見当識・寝たきり・認知症", tone: "muted", small: true }]);
    expect(lines[0].every((s) => s.tone !== "muted")).toBe(true);
  });

  it("「なし」（寝たきり・認知症で無いと分かっている）は入った物として並べる", () => {
    const lines = linesOf(rowOf(withCare({ walking: "ok", bedridden: false, dementia: true }), "care"));
    expect(lines.map(lineText)).toEqual(["歩行 問題なし 寝たきり なし 認知症", "未入力　聴覚・視覚・理解・判断・見当識"]);
  });

  it("全部空なら「未入力」だけ（数えない）", () => {
    const v = withCare({});
    expect(rowOf(v, "care")?.field).toEqual({ kind: "unconfirmed" });
    const html = renderToStaticMarkup(createElement(PersonView, { view: v, level: 1 }));
    expect(html).toMatch(/data-field="care"[\s\S]*?<span class="text-muted">未入力<\/span>/);
  });

  it("全部入った人は未入力の行が無い", () => {
    const lines = linesOf(
      rowOf(
        withCare({ walking: "ok", hearing: "some", vision: "ok", understanding: "hard", judgment: "some", orientation: "ok", bedridden: true, dementia: false }),
        "care",
      ),
    );
    expect(lines).toHaveLength(1);
    expect(lineText(lines[0])).toBe("歩行 問題なし 聴覚 一部 視覚 問題なし 理解 困難 判断 一部 見当識 問題なし 寝たきり 認知症 なし");
  });

  it("小さな字の灰の行は text-xs と text-muted で描く", () => {
    const html = renderToStaticMarkup(createElement(PersonView, { view: withCare({ walking: "some" }), level: 1 }));
    expect(html).toMatch(/class="text-xs text-muted">未入力　聴覚/);
  });
});

describe("選ぶ欄の開いた一覧の未選択の行（T113）", () => {
  const h = createElement;
  const opt = (value: string, label: string, more: Record<string, unknown> = {}) => h("option", { key: label, value, ...more }, label);
  const all = (items: SelectItem[]) => items.map((_, i) => i);
  const optionHtml = (html: string, value: string) => new RegExp(`<div[^>]*role="option"[^>]*data-value="${value}"[\\s\\S]*?</div>`).exec(html)?.[0] ?? "";

  it("未選択（data-placeholder）が選ばれていても、閉じた欄と同じ灰の細い字。選んだ印（右のチェック）はそのまま", () => {
    const m = readOptions([opt("", "未確認", { "data-placeholder": true }), opt("yes", "あり")]);
    const html = renderToStaticMarkup(h(SelectList, { id: "l", model: m, shown: all(m.items), values: [""], active: 0, multiple: false, search: null }));
    const row = optionHtml(html, "");
    expect(row).toContain('aria-selected="true"');
    expect(row).toMatch(/class="[^"]*text-muted/);
    expect(row).not.toMatch(/class="[^"]*font-bold/);
    expect(row).toContain("<svg");
  });

  it("ほかの項目を選んだときは今までどおり太字で、未選択の行は灰", () => {
    const m = readOptions([opt("", "未確認", { "data-placeholder": true }), opt("yes", "あり")]);
    const html = renderToStaticMarkup(h(SelectList, { id: "l", model: m, shown: all(m.items), values: ["yes"], active: 1, multiple: false, search: null }));
    expect(optionHtml(html, "yes")).toMatch(/class="[^"]*font-bold/);
    expect(optionHtml(html, "")).toMatch(/class="[^"]*text-muted/);
  });

  it("「全部」のように印の無い value=\"\" は黒のまま", () => {
    const m = readOptions([opt("", "全部"), opt("a", "甲")]);
    const html = renderToStaticMarkup(h(SelectList, { id: "l", model: m, shown: all(m.items), values: [""], active: 0, multiple: false, search: null }));
    expect(optionHtml(html, "")).toMatch(/class="[^"]*font-bold/);
    expect(optionHtml(html, "")).not.toMatch(/class="[^"]*text-muted/);
  });
});

describe("位置を置く部品は数字を出さない（T113）", () => {
  const center = { lat: 33.84, lng: 132.765 };

  it("置いてあれば「設定済」、無ければ「未設定」。緯度経度の数字は出さない。外す・拡大・縮小はそのまま", () => {
    const set = renderToStaticMarkup(
      createElement(LocationPick, { value: { lat: 33.83319, lng: 132.76191 }, onChange: () => {}, center, label: PLACE_LABELS.location }),
    );
    expect(set).toContain(`>${PLACE_LABELS.set}<`);
    expect(set).not.toMatch(/33\.83319|132\.76191/);
    for (const w of [PLACE_LABELS.unset, PLACE_LABELS.zoomIn, PLACE_LABELS.zoomOut]) expect(set).toContain(w);
    const none = renderToStaticMarkup(createElement(LocationPick, { value: null, onChange: () => {}, center, label: PLACE_LABELS.location }));
    expect(none).toContain(`>${PLACE_LABELS.none}<`);
    expect(none).not.toMatch(/33\.84|132\.765/);
  });
});
