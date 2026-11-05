// T120: 確かめの画面（MappingEditor）に、台帳の項目なしで人が選ぶ欄の「要選択」と候補の「採用」、読めなかった頁の「未読」と「再読」。
// 日付・電話の欄は区切りの字を直せる。画面は描いた HTML で確かめる（ブラウザは使わない）。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MappingEditor } from "../../components/forms/mapping/MappingEditor.tsx";
import { checkReadResult, type ReadResult } from "./mapping.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const read: ReadResult = {
  title: "様式",
  issuer: "",
  pages: 2,
  typeface: "gothic",
  unread: [2],
  fields: [
    { page: 1, section: "同意", label: "名簿への登録", position: "", shape: "check", options: [], item: null, candidate: "consent.registry", confidence: "medium", reason: "本人の意思" },
    { page: 1, section: "", label: "生年月日", position: "", shape: "date", options: ["年", "月", "日"], item: "person.birth", confidence: "high", reason: "" },
    { page: 1, section: "", label: "受付番号", position: "", shape: "text", options: [], item: null, confidence: "high", reason: "市が書く" },
  ],
};

describe("確かめの画面", () => {
  it("要選択の数・印と候補の採用、未読の頁と再読、日付の区切り", () => {
    const html = renderToStaticMarkup(createElement(MappingEditor, { id: "fm-1", version: 1, status: "draft", initial: checkReadResult(read).mapping }));
    expect(html).toContain('data-picks="1"');
    expect(html).toContain('data-pick="f1"');
    expect(html).toContain("候補 名簿登録の同意 採用");
    // 市が書く欄（候補なし・同意でない）は要選択にしない
    expect(html).not.toContain('data-pick="f3"');
    expect(html).toContain('data-unread="2"');
    expect(html).toContain("再読");
    expect(html).toContain('aria-label="区切り"');
  });

  it("未読が無ければ再読を出さない", () => {
    const { unread: _u, ...rest } = read;
    const html = renderToStaticMarkup(createElement(MappingEditor, { id: "fm-1", version: 1, status: "draft", initial: checkReadResult(rest).mapping }));
    expect(html).not.toContain("data-unread");
    expect(html).not.toContain("再読");
  });
});
