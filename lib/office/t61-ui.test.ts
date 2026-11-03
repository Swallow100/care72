// ケアマネの一覧の行（components/office/CareManagerRow.tsx、docs/tasks/T61.md）の描画。
// 固定の行はボタンなし、管理者の見るほかの人の行は 改名・管理者・停止・再発行、自分の行は パスワード変更、停止した行は 停止の印と 再開。

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CareManagerRow, PASSWORD_INPUT, type CareManagerRowItem } from "../../components/office/CareManagerRow.tsx";
import { NEW_PASSWORD_MAX, NEW_PASSWORD_MIN } from "../auth/password-change.ts";
import { OFFICE_LABELS } from "./labels.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const item = (p: Partial<CareManagerRowItem> = {}): CareManagerRowItem => ({
  id: "acct-sato",
  name: "佐藤",
  loginId: "sato",
  admin: false,
  people: 0,
  disabled: false,
  ...p,
});

const render = (props: { item: CareManagerRowItem; self: boolean; manage: boolean }) =>
  renderToStaticMarkup(createElement("ul", null, createElement(CareManagerRow, props)));

/** ボタン（開きの印と、アイコンの svg・囲みの span を除いた文字） */
const buttonTags = (html: string) =>
  [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    attrs: m[2],
    inner: m[3],
    text: m[3].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, ""),
  }));
const buttons = (html: string) => buttonTags(html).map((b) => b.text);

describe("ケアマネの一覧の行", () => {
  it("新しいパスワードの長さはサーバーと同じ", () => {
    expect(PASSWORD_INPUT).toEqual({ min: NEW_PASSWORD_MIN, max: NEW_PASSWORD_MAX });
  });

  it("種の山本の行は「固定」の 1 語だけで、管理者が見ても本人が見てもボタンを出さない", () => {
    for (const self of [true, false]) {
      const html = render({ item: item({ id: "acct-yamamoto", name: "山本", loginId: "yamamoto", admin: true, people: 10 }), self, manage: true });
      expect(html).toContain(`>${OFFICE_LABELS.fixed}<`);
      expect(buttons(html)).toEqual([]);
      expect(html).not.toContain("data-cm-actions");
    }
  });

  it("管理者が見るほかの人の行: 改名・管理者・停止・再発行（停止と再発行は赤）", () => {
    const html = render({ item: item(), self: false, manage: true });
    expect(buttons(html)).toEqual([OFFICE_LABELS.rename, OFFICE_LABELS.makeAdmin, OFFICE_LABELS.disable, OFFICE_LABELS.resetPassword]);
    expect(html).not.toContain(OFFICE_LABELS.changePassword);
  });

  it("赤の操作（停止・管理者解除・再発行）も白い地のボタンで、文字と印だけ赤（灰色の行に溶けない）", () => {
    const tags = [
      ...buttonTags(render({ item: item(), self: false, manage: true })),
      ...buttonTags(render({ item: item({ admin: true }), self: false, manage: true })),
    ];
    for (const label of [OFFICE_LABELS.disable, OFFICE_LABELS.resetPassword, OFFICE_LABELS.removeAdmin]) {
      const b = tags.find((t) => t.text === label);
      expect(b, label).toBeDefined();
      expect(b!.attrs).toContain("bg-panel ");
      expect(b!.attrs).not.toContain("bg-panel2");
      expect(b!.attrs).toContain("data-danger");
      expect(b!.inner).toMatch(/<svg[^>]*text-danger/);
      expect(b!.inner).toContain(`<span class="text-danger group-disabled:text-muted">${label}</span>`);
    }
    // 白い地のボタンは全部同じ形（plainIn）
    for (const t of tags) expect(t.attrs).toContain("bg-panel ");
  });

  it("管理者の行には「管理者解除」（赤）、停止した行には停止の印と「再開」", () => {
    expect(buttons(render({ item: item({ admin: true }), self: false, manage: true }))).toContain(OFFICE_LABELS.removeAdmin);
    const html = render({ item: item({ disabled: true }), self: false, manage: true });
    expect(html).toContain('data-disabled=""');
    expect(html).toMatch(/data-tone="unknown"[^>]*>停止</);
    expect(buttons(html)).toEqual([OFFICE_LABELS.rename, OFFICE_LABELS.makeAdmin, OFFICE_LABELS.enable, OFFICE_LABELS.resetPassword]);
  });

  it("自分の行: 管理者なら 改名 と パスワード変更、管理者でなければ パスワード変更 だけ", () => {
    expect(buttons(render({ item: item({ admin: true }), self: true, manage: true }))).toEqual([OFFICE_LABELS.rename, OFFICE_LABELS.changePassword]);
    expect(buttons(render({ item: item(), self: true, manage: false }))).toEqual([OFFICE_LABELS.changePassword]);
  });

  it("管理者でない人が見るほかの人の行はボタンなし", () => {
    expect(buttons(render({ item: item(), self: false, manage: false }))).toEqual([]);
  });
});
