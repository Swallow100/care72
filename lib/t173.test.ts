// T173 使う側の模擬の 3 回目で残った迷いを減らす（docs/tasks/T173.md）。画面は renderToStaticMarkup と部品の元の文で確かめる。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONFIRM_LABELS } from "./ui/labels.ts";
import { RESET_LABELS } from "./seed/labels.ts";
import { REQUEST_LABELS } from "./custody/labels.ts";
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
    expect(menu).toMatch(/action="\/api\/auth\/role"[^]*name="role" value="medical"/);
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
