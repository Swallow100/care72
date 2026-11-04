// T99: 受入一覧（/staff）の見出しの行の「パスワード変更」（components/staff/StaffPassword.tsx）と、
// T61 の事業所のケアマネの自分の行と同じ欄の部品（components/office/OwnPassword.tsx の OwnPasswordForm）。
// 医療班・行政のアカウントは「パスワード変更」のボタン、審査員・固定のアカウントは「固定」の印だけ。言葉は T61 と同じ OFFICE_LABELS。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CareManagerRow, PASSWORD_INPUT as ROW_PASSWORD_INPUT } from "../../components/office/CareManagerRow.tsx";
import { INPUT } from "../../components/office/AddCareManager.tsx";
import { OwnPasswordForm, PASSWORD_INPUT, PasswordDone } from "../../components/office/OwnPassword.tsx";
import { StaffPassword } from "../../components/staff/StaffPassword.tsx";
import { NEW_PASSWORD_MAX, NEW_PASSWORD_MIN } from "../auth/password-change.ts";
import { OFFICE_LABELS } from "./labels.ts";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const noop = () => {};

/** ボタン（アイコンの svg・囲みの span を除いた文字） */
const buttons = (html: string) =>
  [...html.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => m[3].replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, ""));
const inputs = (html: string) => [...html.matchAll(/<input\b([^>]*)>/g)].map((m) => m[1]);

const staff = (entry: "open" | "fixed" | null, loginId: string | null = "kyugo1") =>
  renderToStaticMarkup(createElement(StaffPassword, { entry, loginId }, createElement("a", { href: "/staff/csv" }, "CSV出力")));

describe("受入一覧の見出しの行（StaffPassword）", () => {
  it("医療班・行政: 書き出しの右に「パスワード変更」（鍵の印・無色）。欄は押すまで出さない", () => {
    const html = staff("open");
    expect(buttons(html)).toEqual(["CSV出力", OFFICE_LABELS.changePassword]);
    const b = /<button\b([^>]*)>([\s\S]*?)<\/button>/.exec(html)!;
    expect(b[1]).toContain('aria-expanded="false"');
    expect(b[1]).toContain("bg-panel2");
    expect(b[1]).not.toContain("bg-accent-fill");
    expect(b[2]).toContain("<svg");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="password"');
  });

  it("審査員・固定のアカウント: 「パスワード変更 固定」の印だけでボタンを出さない（サーバーも 403 fixed）", () => {
    const html = staff("fixed");
    expect(buttons(html)).toEqual(["CSV出力"]);
    expect(html).toContain(`${OFFICE_LABELS.changePassword} ${OFFICE_LABELS.fixed}`);
    expect(html).toContain('data-own-password="fixed"');
    expect(html).not.toContain("<form");
  });

  it("入口なし（医療班・行政でない）は書き出しだけ", () => {
    const html = staff(null);
    expect(buttons(html)).toEqual(["CSV出力"]);
    expect(html).not.toContain(OFFICE_LABELS.changePassword);
  });
});

const form = (p: { loginId: string | null; onPanel?: boolean }) =>
  renderToStaticMarkup(createElement(OwnPasswordForm, { ...p, onCancel: noop, onDone: noop }));

describe("自分のパスワードの欄（T61 と T99 で同じ部品）", () => {
  it("新しいパスワードの長さはサーバーと同じ。ケアマネの行からも同じ値", () => {
    expect(PASSWORD_INPUT).toEqual({ min: NEW_PASSWORD_MIN, max: NEW_PASSWORD_MAX });
    expect(ROW_PASSWORD_INPUT).toBe(PASSWORD_INPUT);
  });

  it("現在・新規・確認の 3 つの欄と、変更・取消。言葉は T61 と同じ", () => {
    const html = form({ loginId: "kyugo1" });
    expect(html).toContain(`aria-label="${OFFICE_LABELS.changePassword}"`);
    for (const l of [OFFICE_LABELS.currentPassword, OFFICE_LABELS.nextPassword, OFFICE_LABELS.confirmPassword]) expect(html).toContain(`>${l}<`);
    expect(buttons(html)).toEqual([OFFICE_LABELS.change, OFFICE_LABELS.cancel]);
    const pw = inputs(html).filter((a) => a.includes('type="password"'));
    expect(pw).toHaveLength(3);
    expect(pw[0]).toContain('autoComplete="current-password"');
    expect(pw[0]).not.toContain("minLength");
    for (const a of pw.slice(1)) {
      expect(a).toContain('autoComplete="new-password"');
      expect(a).toContain(`minLength="${NEW_PASSWORD_MIN}"`);
      expect(a).toContain(`maxLength="${NEW_PASSWORD_MAX}"`);
    }
  });

  it("パスワードの管理の道具のための隠した ID は、ID があるときだけ", () => {
    expect(inputs(form({ loginId: "kyugo1" })).find((a) => a.includes('autoComplete="username"'))).toContain('value="kyugo1"');
    expect(inputs(form({ loginId: null })).some((a) => a.includes('autoComplete="username"'))).toBe(false);
  });

  it("欄の地: ケアマネの行（面の中の灰色）の上は白、受入一覧の白い面の上は面の中の灰色", () => {
    const onRow = inputs(form({ loginId: "kyugo1" })).filter((a) => a.includes('type="password"'));
    const onPanel = inputs(form({ loginId: "kyugo1", onPanel: true })).filter((a) => a.includes('type="password"'));
    for (const a of onRow) expect(a).toContain(`class="${INPUT}"`);
    for (const a of onPanel) {
      expect(a).toContain("bg-panel2");
      expect(a).not.toMatch(/bg-panel(?!2)/);
    }
  });

  it("変えたあとの 1 行は「変更済 他端末 再ログイン」", () => {
    const html = renderToStaticMarkup(createElement(PasswordDone));
    expect(html).toContain('role="status"');
    expect(html).toMatch(new RegExp(`data-tone="ok"[^>]*>${OFFICE_LABELS.changed}<`));
    expect(html).toContain(`>${OFFICE_LABELS.otherDevices}<`);
  });

  it("ケアマネの行も受入一覧も、この部品で欄を出す（欄を写して持たない）", () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
    for (const p of ["../../components/office/CareManagerRow.tsx", "../../components/staff/StaffPassword.tsx"]) {
      const s = src(p);
      expect(s, p).toMatch(/<OwnPasswordForm\b/);
      expect(s, p).not.toContain('type="password"');
      expect(s, p).not.toContain("OWN_PASSWORD_API_PATH");
    }
    // 受入一覧の画面が入口を置く（入口の可否はサーバーが principal から決める）
    const page = src("../../app/staff/page.tsx");
    expect(page).toContain("ownPasswordEntry(principal)");
    expect(page).toMatch(/<StaffPassword entry=\{entry\} loginId=\{loginId\}>\s*<StaffCsvLink \/>\s*<\/StaffPassword>/);
  });

  it("ケアマネの行の自分の行は今までどおり「パスワード変更」（T61）", () => {
    const html = renderToStaticMarkup(
      createElement("ul", null, createElement(CareManagerRow, { item: { id: "acct-sato", name: "佐藤", loginId: "sato", admin: false, people: 0, disabled: false }, self: true, manage: false })),
    );
    expect(buttons(html)).toEqual([OFFICE_LABELS.changePassword]);
  });
});
