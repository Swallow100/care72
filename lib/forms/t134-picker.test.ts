// T134: 地域選択の行。許諾要の市は一覧に出すが取り寄せはせず、公式の頁へのリンクだけ（「取得」を出さない）。
// 旧形式・内蔵も「取得」を出さない。取り込める様式は「取得」と公式の頁。共有済・取込済の印。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MunicipalPicker } from "../../components/forms/mapping/MunicipalPicker.tsx";
import { allMunicipalEntries, availability, MUNICIPAL_CITIES } from "./municipal-forms.ts";

const render = (defaultCity: string, extra: { shared?: string[]; own?: Record<string, { id: string; status: "draft" | "checked" }> } = {}) =>
  renderToStaticMarkup(
    createElement(MunicipalPicker, { shared: extra.shared ?? [], own: extra.own ?? {}, defaultCity, aiReady: true, busy: false, onPicked: () => {} }),
  );

/** 行（tr）ごとの中身 */
function rows(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<tr data-municipal-form="([^"]+)">([\s\S]*?)<\/tr>/g)) out.set(m[1], m[2]);
  return out;
}

describe("地域選択の行", () => {
  const permissionCities = MUNICIPAL_CITIES.filter((c) => c.terms.flag === "許諾要");

  it("許諾要の 3 市（さいたま市・津市・徳島市）は一覧に出し、取得を出さず、公式の頁へのリンクだけ", () => {
    expect(permissionCities.map((c) => c.name).sort()).toEqual(["さいたま市", "徳島市", "津市"].sort());
    for (const c of permissionCities) {
      const r = rows(render(c.id));
      expect(r.size, c.name).toBe(c.forms.length);
      for (const f of c.forms) {
        const tr = r.get(f.id)!;
        expect(tr, f.id).not.toContain("data-municipal-fetch");
        expect(tr, f.id).not.toContain("data-municipal-retry");
        expect(tr, f.id).toMatch(/data-municipal-block="(permission|legacy)"/);
        expect(tr, f.id).toContain(`href="${c.pageUrl}"`);
        // 様式のファイルそのものへのリンクは出さない（公式の頁だけ）
        expect(tr, f.id).not.toContain(`href="${f.url}"`);
      }
    }
  });

  it("取り込める様式は取得と公式の頁。共有済・取込済の印", () => {
    const e = allMunicipalEntries().find((x) => x.city.id === "kumamoto" && availability(x).ok)!;
    const plain = rows(render("kumamoto")).get(e.form.id)!;
    expect(plain).toContain("data-municipal-fetch");
    expect(plain).toContain("AI読取");
    expect(rows(render("kumamoto", { shared: [e.form.id] })).get(e.form.id)).toContain('data-municipal-shared="1"');
    expect(rows(render("kumamoto", { own: { [e.form.id]: { id: "fm-x", status: "draft" } } })).get(e.form.id)).toContain('href="/forms/mapping/fm-x"');
  });

  it("旧形式・内蔵も取得を出さない", () => {
    for (const id of ["yamagata", "matsuyama"]) {
      for (const [fid, tr] of rows(render(id))) {
        expect(tr, fid).not.toContain("data-municipal-fetch");
        expect(tr, fid).toMatch(/data-municipal-block="(legacy|builtin)"/);
      }
    }
  });
});
