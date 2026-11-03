// 確認・お知らせの窓（T51 で書き直した）の待ち行列・既定の言葉・焦点・中身の描画
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DialogPanel } from "@/components/ui/DialogHost";
import { cancelAnswer, createDialogs, fillRequest, initialFocus, promptReady, type DialogAnswer, type DialogRequest } from "./dialog";
import { CONFIRM_LABELS, DIALOG_LABELS } from "./labels";

const draw = (r: DialogRequest) => renderToStaticMarkup(createElement(DialogPanel, { request: r, onSettle: () => {} }));
/** 2〜4 字（漢字・かなの数） */
const short = (s: string) => [...s].length >= 2 && [...s].length <= 4;

describe("待ち行列", () => {
  it("開いた順に 1 つずつ出し、閉じたら次", async () => {
    const q = createDialogs();
    const seen: string[] = [];
    q.subscribe(() => seen.push(q.current()?.message ?? "-"));
    const a = q.open({ kind: "confirm", message: "一" });
    const b = q.open({ kind: "alert", message: "二" });
    expect(q.current()?.message).toBe("一");
    expect(q.size()).toBe(2);
    q.settle(q.current()!.id, true);
    expect(q.current()?.message).toBe("二");
    q.settle(q.current()!.id, undefined);
    expect(q.current()).toBeNull();
    expect(await a).toBe(true);
    expect(await b).toBeUndefined();
    expect(seen).toEqual(["一", "二", "-"]);
  });

  it("同じ窓を 2 度閉じても答えは最初の 1 回。次の窓を巻き込まない", async () => {
    const q = createDialogs();
    const a = q.open({ kind: "confirm", message: "一" });
    const b = q.open({ kind: "confirm", message: "二" });
    const id = q.current()!.id;
    q.settle(id, false);
    q.settle(id, true);
    expect(await a).toBe(false);
    expect(q.current()?.message).toBe("二");
    q.settle(q.current()!.id, true);
    expect(await b).toBe(true);
  });

  it("前でない窓は閉じられない", () => {
    const q = createDialogs();
    void q.open({ kind: "confirm", message: "一" });
    void q.open({ kind: "confirm", message: "二" });
    q.settle(q.current()!.id + 1, true);
    expect(q.current()?.message).toBe("一");
  });

  it("聞き手を外せる", () => {
    const q = createDialogs();
    let n = 0;
    const off = q.subscribe(() => n++);
    void q.open({ kind: "alert", message: "x" });
    off();
    q.settle(q.current()!.id, undefined);
    expect(n).toBe(1);
  });

  it("取消の答えは種類ごと（確認は false、お知らせは undefined、選ぶ・入れるは null）", async () => {
    expect(cancelAnswer("confirm")).toBe(false);
    expect(cancelAnswer("alert")).toBeUndefined();
    expect(cancelAnswer("choice")).toBeNull();
    expect(cancelAnswer("prompt")).toBeNull();
    const q = createDialogs();
    const answers: Promise<DialogAnswer>[] = [
      q.open({ kind: "choice", message: "c", options: [{ value: "a", label: "甲" }, { value: "b", label: "乙" }] }),
      q.open({ kind: "prompt", message: "p" }),
    ];
    q.settle(q.current()!.id, "b");
    q.settle(q.current()!.id, "入れた文字");
    expect(await Promise.all(answers)).toEqual(["b", "入れた文字"]);
  });
});

describe("既定の言葉・アイコン・焦点", () => {
  it("確認: 題「確認」、決める「決定」、アイコンは保存、焦点は決める方", () => {
    const r = fillRequest(1, { kind: "confirm", message: "x" });
    expect([r.title, r.ok, r.cancel, r.okIcon, r.focus, r.danger]).toEqual([DIALOG_LABELS.confirm, DIALOG_LABELS.ok, DIALOG_LABELS.cancel, "SaveIcon", "ok", false]);
  });

  it("消す・外す・戻す（danger）: 焦点は取消、アイコンの既定は RemoveIcon、渡せば替わる", () => {
    const r = fillRequest(1, { kind: "confirm", message: "x", danger: true });
    expect([r.focus, r.okIcon]).toEqual(["cancel", "RemoveIcon"]);
    expect(fillRequest(2, { kind: "confirm", message: "x", danger: true, icon: "RestoreIcon" }).okIcon).toBe("RestoreIcon");
  });

  it("お知らせ: 題「お知らせ」、無色の「閉じる」と×、danger は付かない", () => {
    const r = fillRequest(1, { kind: "alert", message: "x", danger: true } as never);
    expect([r.title, r.ok, r.okIcon, r.danger, r.focus]).toEqual([DIALOG_LABELS.alert, DIALOG_LABELS.close, "CloseIcon", false, "ok"]);
  });

  it("選ぶは 1 つ目の選択肢に、入れるは欄に焦点", () => {
    expect(initialFocus("choice", false)).toBe("option");
    expect(initialFocus("prompt", false)).toBe("field");
    expect(initialFocus("confirm", true)).toBe("cancel");
    expect(initialFocus("alert", false)).toBe("ok");
  });

  it("選択肢は 4 つまで、空の箇条書きは落とす", () => {
    const opts = ["a", "b", "c", "d", "e"].map((v) => ({ value: v, label: v }));
    expect(fillRequest(1, { kind: "choice", message: "x", options: opts }).options).toHaveLength(4);
    expect(fillRequest(1, { kind: "confirm", message: "x", details: ["一", " ", "二"] }).details).toEqual(["一", "二"]);
  });

  it("窓の題と決める方のボタンは 2〜4 字（既定と、今の 4 つの窓）", () => {
    for (const s of Object.values(DIALOG_LABELS)) expect(short(s), s).toBe(true);
    const fixed = [
      CONFIRM_LABELS.resetTitle,
      CONFIRM_LABELS.resetOk,
      CONFIRM_LABELS.normalTitle,
      CONFIRM_LABELS.normalOk,
      CONFIRM_LABELS.unlistTitle,
      CONFIRM_LABELS.unlistOk,
      CONFIRM_LABELS.abandonTitle,
      CONFIRM_LABELS.abandonOk,
    ];
    for (const s of fixed) expect(short(s), s).toBe(true);
  });

  it("入れる欄: required で空、長すぎる物は決められない", () => {
    const f = fillRequest(1, { kind: "prompt", message: "x", field: { required: true, maxLength: 3, initial: "あ" } }).field;
    expect(f?.initial).toBe("あ");
    expect(promptReady(f, "")).toBe(false);
    expect(promptReady(f, "  ")).toBe(false);
    expect(promptReady(f, "いう")).toBe(true);
    expect(promptReady(f, "いうえお")).toBe(false);
    expect(promptReady(fillRequest(2, { kind: "prompt", message: "x" }).field, "")).toBe(true);
  });
});

describe("窓の中身の描画", () => {
  it("消す確認: 題・本文（改行を活かす）・取消（×）と赤の塗りの決める方、焦点の印は取消", () => {
    const html = draw(fillRequest(7, { kind: "confirm", message: "消す項目\n二行目", title: CONFIRM_LABELS.resetTitle, ok: CONFIRM_LABELS.resetOk, danger: true, icon: "RestoreIcon" }));
    expect(html).toContain('id="dialog-title-7"');
    expect(html).toContain(">初期化</h2>");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("消す項目\n二行目");
    expect(html).toMatch(/data-dialog-focus=""[^>]*data-dialog-action="cancel"/);
    expect(html).toContain("bg-danger");
    expect(html).toContain(">戻す</button>");
    // 影・グラデーション・ピル型は使わない
    expect(html).not.toMatch(/shadow|gradient|rounded-full/);
  });

  it("ふつうの確認は操作の色の塗り、焦点は決める方", () => {
    const html = draw(fillRequest(1, { kind: "confirm", message: "x" }));
    expect(html).toContain("bg-accent");
    expect(html).toMatch(/data-dialog-focus=""[^>]*data-dialog-action="ok"/);
  });

  it("お知らせは無色の「閉じる」だけ（取消は出さない）", () => {
    const html = draw(fillRequest(1, { kind: "alert", message: "x" }));
    expect(html).toContain(">閉じる</button>");
    expect(html).not.toContain('data-dialog-action="cancel"');
    expect(html).not.toContain("bg-accent");
    expect(html).toContain("bg-panel2");
  });

  it("details は本文の下の小さな箇条書き", () => {
    const html = draw(fillRequest(1, { kind: "confirm", message: "消す項目", details: ["訓練記録", "信号"] }));
    expect(html).toMatch(/<ul[^>]*data-dialog-details[^>]*><li>訓練記録<\/li><li>信号<\/li><\/ul>/);
    expect(html).toContain("text-xs");
  });

  it("選ぶ: 縦に並ぶ無色のボタン、danger だけ赤の文字、取消もある", () => {
    const html = draw(
      fillRequest(1, {
        kind: "choice",
        message: "どれ",
        options: [
          { value: "keep", label: "残す", icon: "SaveIcon" },
          { value: "drop", label: "消す", icon: "RemoveIcon", danger: true },
        ],
      }),
    );
    expect(html).toContain('data-choice="keep"');
    expect(html).toContain('data-choice="drop"');
    expect(html).toMatch(/text-danger[^>]*data-choice="drop"/);
    expect(html).toMatch(/data-choice="keep" data-dialog-focus=""/);
    expect(html).toContain("flex-col");
    expect(html).toContain('data-dialog-action="cancel"');
    expect(html).not.toContain("bg-accent");
  });

  it("入れる: 欄（48px、面の中の色、枠線なし）と、空なら押せない決める方", () => {
    const html = draw(fillRequest(1, { kind: "prompt", message: "名前", field: { label: "氏名", required: true, placeholder: "例 山田" } }));
    expect(html).toContain("h-12");
    expect(html).toContain("bg-panel2");
    expect(html).not.toMatch(/\bborder\b/);
    expect(html).toContain('placeholder="例 山田"');
    expect(html).toContain(">氏名</span>");
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
    expect(html).toMatch(/data-dialog-focus=""[^>]*data-dialog-field/);
  });
});
