import { describe, expect, it, vi } from "vitest";
import { createDialogs, initialFocus } from "./dialog.ts";
import { DIALOG_LABELS } from "./labels.ts";

describe("アプリ内の確認・お知らせの待ち行列", () => {
  it("開いた順に 1 つずつ出し、閉じたら次を出す", async () => {
    const d = createDialogs();
    const first = d.confirm("一つ目", { title: "初期化", ok: "戻す", danger: true });
    const second = d.alert("二つ目");
    expect(d.size()).toBe(2);
    const a = d.current();
    expect(a?.message).toBe("一つ目");
    expect(a?.kind).toBe("confirm");
    d.settle(a!.id, true);
    expect(await first).toBe(true);
    const b = d.current();
    expect(b?.message).toBe("二つ目");
    expect(b?.kind).toBe("alert");
    d.settle(b!.id, true);
    expect(await second).toBeUndefined();
    expect(d.current()).toBeNull();
  });

  it("取消・Escape・外側は false で返す", async () => {
    const d = createDialogs();
    const p = d.confirm("消す");
    d.settle(d.current()!.id, false);
    expect(await p).toBe(false);
  });

  it("同じ窓を 2 度閉じても 1 度だけ（先に返した答えのまま）", async () => {
    const d = createDialogs();
    const p = d.confirm("消す", { danger: true });
    const id = d.current()!.id;
    d.settle(id, false);
    d.settle(id, true);
    expect(await p).toBe(false);
    expect(d.size()).toBe(0);
  });

  it("後ろの窓を先に閉じても、先頭はそのまま", async () => {
    const d = createDialogs();
    void d.confirm("一つ目");
    const second = d.confirm("二つ目");
    const ids = [d.current()!.id];
    d.settle(ids[0] + 1, true);
    expect(await second).toBe(true);
    expect(d.current()?.message).toBe("一つ目");
  });

  it("開く・閉じるたびに聞き手に知らせ、外したら知らせない", () => {
    const d = createDialogs();
    const listener = vi.fn();
    const off = d.subscribe(listener);
    void d.confirm("a");
    expect(listener).toHaveBeenCalledTimes(1);
    d.settle(d.current()!.id, true);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    void d.confirm("b");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("題とボタンの既定は 確認・決定、お知らせは お知らせ・閉じる", () => {
    const d = createDialogs();
    void d.confirm("a");
    expect(d.current()).toMatchObject({ title: DIALOG_LABELS.confirm, ok: DIALOG_LABELS.ok, danger: false });
    d.settle(d.current()!.id, true);
    void d.alert("b");
    expect(d.current()).toMatchObject({ title: DIALOG_LABELS.alert, ok: DIALOG_LABELS.close, danger: false });
  });

  it("決める方のボタンもアイコン＋文字（既定は 消す RemoveIcon・ほか SaveIcon・お知らせ CloseIcon、渡せば渡した物）", () => {
    const d = createDialogs();
    void d.confirm("a", { danger: true });
    void d.confirm("b");
    void d.confirm("c", { danger: true, icon: "RestoreIcon" });
    void d.alert("d");
    const icons: string[] = [];
    while (d.current()) {
      icons.push(d.current()!.icon);
      d.settle(d.current()!.id, false);
    }
    expect(icons).toEqual(["RemoveIcon", "SaveIcon", "RestoreIcon", "CloseIcon"]);
  });

  it("消す確認は最初の焦点を取消に、ほかは決める方に（Enter だけで消えない）", () => {
    expect(initialFocus({ kind: "confirm", danger: true })).toBe("cancel");
    expect(initialFocus({ kind: "confirm", danger: false })).toBe("ok");
    expect(initialFocus({ kind: "alert", danger: false })).toBe("ok");
    // お知らせには danger を付けない（取消が無いので）
    const d = createDialogs();
    void d.alert("x");
    expect(initialFocus(d.current()!)).toBe("ok");
  });

  it("窓の題と ok の言葉は 2〜4 字（呼ぶ側の言葉）", async () => {
    const { CONFIRM_LABELS } = await import("./labels.ts");
    for (const k of ["resetTitle", "resetOk", "normalTitle", "normalOk", "unlistTitle", "unlistOk", "abandonTitle", "abandonOk"] as const) {
      expect(CONFIRM_LABELS[k].length).toBeGreaterThanOrEqual(2);
      expect(CONFIRM_LABELS[k].length).toBeLessThanOrEqual(4);
    }
  });
});
