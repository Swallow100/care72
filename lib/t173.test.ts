// T173 使う側の模擬の 3 回目で残った迷いを減らす（docs/tasks/T173.md）。画面は renderToStaticMarkup と部品の元の文で確かめる。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/" }));

import { BulkButton, BulkCheck, PICKED_ROW } from "../components/staff/BulkReceive.tsx";
import { CONFIRM_LABELS } from "./ui/labels.ts";
import { RESET_LABELS } from "./seed/labels.ts";
import { BULK_LABELS, REQUEST_LABELS } from "./custody/labels.ts";
import { OFFICE_LABELS } from "./office/labels.ts";
import { INTAKE_LABELS } from "./labels.ts";
import { personaOf } from "../tools/eval/persona/personas.ts";
import { forbiddenOf } from "../tools/eval/persona/walk.ts";
import type { Item } from "../tools/eval/persona/types.ts";

const items = (...names: Array<string | [string, string]>): Item[] =>
  names.map((n, i) => (typeof n === "string" ? { ref: i + 1, role: "button", name: n } : { ref: i + 1, role: "button", name: n[0], zone: n[1] }));

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const short = (s: string) => [...s].length >= 2 && [...s].length <= 4;

describe("1. 最初に戻す", () => {
  const page = read("../app/office/page.tsx");
  it("画面の頭に置く（担当の長い表より前。読みの順で 115 個中 114 番目だった）", () => {
    expect(page.indexOf("<ResetAction />")).toBeGreaterThan(-1);
    for (const later of ["<ModeSection state=", "<AssignSection people=", "<SurveyPanel overview="]) {
      expect(page.indexOf("<ResetAction />")).toBeLessThan(page.indexOf(later));
    }
    // 右の列の面に戻さない
    expect(page).not.toContain("<ResetSection");
  });
  it("窓の決める方に「戻す」を使わない（2 つの窓で同じ語だった）。何をするかの語で、取り違えない", () => {
    expect(CONFIRM_LABELS.resetOk).toBe("初期化");
    expect(CONFIRM_LABELS.normalOk).toBe("平時復帰");
    expect(CONFIRM_LABELS.resetOk).not.toBe(CONFIRM_LABELS.normalOk);
    expect(short(CONFIRM_LABELS.stayCurrent)).toBe(true);
    expect(page).toContain("cancel: CONFIRM_LABELS.stayCurrent");
  });
  it("押す物の名前は最初に戻すのまま（目標と手引きの言葉）", () => {
    expect(RESET_LABELS.reset).toBe("最初に戻す");
    expect(page).toContain("{RESET_LABELS.reset}");
  });
});

describe("2. 医療班の入口", () => {
  it("役を選べる人だけ、画面の切替の右に出す。送り先は役変更の医療班と同じ", () => {
    const header = read("../components/AppHeader.tsx");
    expect(header).toContain("<NavLinks>{p && canChooseRole(p) && <StaffEntry");
    const menu = read("../components/ui/RoleMenu.tsx");
    // 値は既定がデモの医療班、新規事業所の中では新規事業所の医療班（T180、lib/auth/roles.ts の medicalChoiceOf）
    expect(menu).toMatch(/value = "medical"[^]*action="\/api\/auth\/role"[^]*name="role" value=\{value\}/);
    expect(header).toContain("value={medicalChoiceOf(p)}");
    expect(REQUEST_LABELS.toStaffName).toBe("医療班 受入一覧");
  });
  it("筋の最短は 1 手。読みの頭に無ければ台が数える", () => {
    const medical = personaOf("medical")!;
    expect(medical.goals.find((g) => g.id === "role")!.route).toEqual([{ click: "医療班" }]);
    const nav = ["ケア72", "担当一覧", "訓練", "事業所", "書類", "医療班 受入一覧", "役変更", "ログアウト"];
    expect(forbiddenOf(medical, { path: "/", text: "", items: items(...nav) })).toEqual([]);
    const far = forbiddenOf(medical, { path: "/", text: "", items: items("担当一覧", ...Array.from({ length: 20 }, (_, i) => `行 ${i}`), "役変更", "医療班 受入一覧") });
    expect(far).toEqual(["医療班の入口が読みの後ろ"]);
    // 窓の間は読みが窓の中だけなので数えない
    expect(forbiddenOf(medical, { path: "/", text: "", items: items(["発災継続", "窓:平時復帰"]) })).toEqual([]);
  });
  it("最初に戻すも読みの頭で見る（役の無い画面では数えない）", () => {
    const admin = personaOf("admin")!;
    expect(forbiddenOf(admin, { path: "/office", text: "", items: items("事業所", "最初に戻す") })).toEqual([]);
    const far = Array.from({ length: 114 }, (_, i) => `行 ${i}`);
    expect(forbiddenOf(admin, { path: "/office?started=1", text: "", items: items(...far, "最初に戻す") })).toEqual(["最初に戻すが読みの後ろ"]);
    expect(forbiddenOf(admin, { path: "/forms", text: "", items: items("書類") })).toEqual([]);
  });
});

describe("3. 編集の面（全部の面）", () => {
  const src = read("../components/person/SectionEdit.tsx");
  it("編集・保存・編集終了の読み上げに面の名前（「編集」が何個もあった）", () => {
    expect(src).toContain("aria-label={`${sectionName} ${INTAKE_LABELS.sectionEdit}`}");
    expect(src).toContain("aria-label={`${sectionName} ${INTAKE_LABELS.save}`}");
    expect(src).toContain("aria-label={`${sectionName} ${INTAKE_LABELS.closeEdit}`}");
  });
  it("保存の隣に取消を置かない。編集終了は帯の右の端で、変更があれば窓で確かめる", () => {
    expect(src).not.toContain("{INTAKE_LABELS.discard}");
    const bar = src.slice(src.indexOf("data-edit-bar"), src.indexOf("data-edit-close"));
    expect(bar.indexOf("data-edit-save")).toBeLessThan(bar.indexOf('role="status"'));
    expect(bar).toContain('className="ml-auto"');
    expect(src).toMatch(/if \(changes\.length > 0\) \{\s+const ok = await appConfirm/);
    expect(src).toContain("cancel: INTAKE_LABELS.closeKeep");
    for (const l of [INTAKE_LABELS.closeEdit, INTAKE_LABELS.closeTitle, INTAKE_LABELS.closeOk, INTAKE_LABELS.closeKeep, INTAKE_LABELS.noChange, INTAKE_LABELS.editing]) expect(short(l), l).toBe(true);
  });
  it("変更の無い間は未変更（変更 0 件にしない）。開いている間は編集中", () => {
    expect(src).toContain("changes.length === 0 ? INTAKE_LABELS.noChange");
    expect(src).toContain("data-edit-state={section}");
  });
  it("保存のあとは新しい値が届くのと同じ時に閉じる（閉じた直後に古い値を出さない）。送信中の印で台も待つ", () => {
    expect(src).toMatch(/startRefresh\(\(\) => \{\s+setOpen\(null\);\s+router\.refresh\(\);/);
    expect(src).toContain("data-pending={saving || undefined}");
  });
  it("全部の面に効く（面ごとの分岐が無い）。筋の手は面の名前つき", () => {
    expect(src).toContain("const sectionName = SECTION_LABELS[section]");
    const first = personaOf("first")!;
    expect(first.goals.find((g) => g.id === "ledger")!.route).toEqual([{ click: "避難 編集" }, { type: "避難先1", text: "みずほし公民館" }, { click: "避難 保存" }]);
  });
});

describe("4. 全選択の選んだ印", () => {
  const bulk = { busy: false, step: null, outcomes: null, run: async () => [] };
  it("押した結果を知らせで読む（選択 2/2 人）", () => {
    const html = renderToStaticMarkup(createElement(BulkButton, { count: 2, total: 2, bulk, onClick: () => {} }));
    expect(html).toContain('role="status"');
    expect(html).toContain('data-bulk-picked="2"');
    expect(html).toMatch(/選択 <span[^>]*>2<\/span>\/2 人/);
  });
  it("全員を選んだら名前が全解除に変わる（全部の一括の欄）。全選択のままだと押し直して 0 人に戻した", () => {
    expect(short(BULK_LABELS.clearAll)).toBe(true);
    const requests = read("../components/staff/StaffRequests.tsx");
    expect(requests).toContain("on === ids.length ? BULK_LABELS.clearAll : BULK_LABELS.selectAll");
    expect(read("../components/staff/StaffIntake.tsx")).toContain("chosen.length === open.length ? BULK_LABELS.clearAll : BULK_LABELS.selectAll");
    expect(OFFICE_LABELS.clearAll).toBe(BULK_LABELS.clearAll);
    expect(read("../components/office/AssignMany.tsx")).toContain("all ? OFFICE_LABELS.clearAll : OFFICE_LABELS.selectAll");
  });
  it("事業所の行は見える字つき。選んだ行に枠（下地を敷かない）", () => {
    const html = renderToStaticMarkup(createElement(BulkCheck, { label: "全解除 デモ", text: "全解除", checked: true, onChange: () => {} }));
    expect(html).toContain('aria-label="全解除 デモ"');
    expect(html).toContain("全解除</label>");
    expect(PICKED_ROW).toContain("outline-accent");
    expect(PICKED_ROW).not.toMatch(/bg-/);
    for (const f of ["StaffRequests", "StaffIntake"]) expect(read(`../components/staff/${f}.tsx`)).toContain("PICKED_ROW");
  });
});
