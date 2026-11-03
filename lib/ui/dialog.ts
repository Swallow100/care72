// アプリ内の確認・お知らせ（T44）。OS の confirm・alert は端末ごとに見た目が違い、アプリの外の画面に見えるので使わない。
// 表示は components/ui/DialogHost.tsx（app/layout.tsx に 1 つ）。開いた順に 1 つずつ出し、閉じたら次を出す（待ち行列）。
// 呼ぶ側は待てる: `if (await appConfirm(…)) …`。ok の言葉は 2〜4 字の漢語（削除・戻す・終了）。消す操作は danger。
// 画面を持たない作り（待ち行列と settle）だけをここに置き、テストは node で回す（lib/ui/dialog.test.ts）。

import { DIALOG_LABELS } from "./labels.ts";

export type DialogKind = "confirm" | "alert";

export type DialogOptions = {
  /** 窓の題（既定は 確認・お知らせ） */
  title?: string;
  /** 決める方のボタンの言葉（既定は 決定・閉じる）。2〜4 字 */
  ok?: string;
  /** 消す・外す・戻す操作。ボタンは赤の塗りで、最初の焦点は取消（Enter だけで消えない） */
  danger?: boolean;
};

export type DialogItem = {
  id: number;
  kind: DialogKind;
  title: string;
  message: string;
  ok: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
};

/** 窓を開いたとき最初に焦点を置くボタン。消す確認は取消、ほかは決める方 */
export function initialFocus(item: Pick<DialogItem, "kind" | "danger">): "cancel" | "ok" {
  return item.kind === "confirm" && item.danger ? "cancel" : "ok";
}

/** 待ち行列。画面の部品は current と subscribe を useSyncExternalStore に渡す */
export function createDialogs() {
  let queue: DialogItem[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  function open(kind: DialogKind, message: string, options: DialogOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      queue = [
        ...queue,
        {
          id: next++,
          kind,
          message,
          title: options.title ?? (kind === "alert" ? DIALOG_LABELS.alert : DIALOG_LABELS.confirm),
          ok: options.ok ?? (kind === "alert" ? DIALOG_LABELS.close : DIALOG_LABELS.ok),
          danger: kind === "confirm" && (options.danger ?? false),
          resolve,
        },
      ];
      emit();
    });
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** 今出す窓（先頭）。無ければ null */
    current: (): DialogItem | null => queue[0] ?? null,
    /** 何件待っているか（今出している 1 件を含む） */
    size: () => queue.length,
    /** 窓を閉じる。ok は決めたら true、取消・Escape・外側なら false。同じ id を 2 度閉じても 1 度だけ */
    settle(id: number, ok: boolean) {
      const item = queue.find((d) => d.id === id);
      if (!item) return;
      queue = queue.filter((d) => d.id !== id);
      emit();
      item.resolve(ok);
    },
    confirm: (message: string, options: DialogOptions = {}) => open("confirm", message, options),
    alert: (message: string, options: Pick<DialogOptions, "title"> = {}) => open("alert", message, options).then(() => undefined),
  };
}

const dialogs = createDialogs();

export const subscribeDialogs = dialogs.subscribe;
export const currentDialog = dialogs.current;
export const settleDialog = dialogs.settle;

/** 確認。決めたら true、取消・Escape・外側を押したら false */
export function appConfirm(message: string, options: DialogOptions = {}): Promise<boolean> {
  return dialogs.confirm(message, options);
}

/** お知らせ。閉じるまで待てる（待たなくてもよい） */
export function appAlert(message: string, options: Pick<DialogOptions, "title"> = {}): Promise<void> {
  return dialogs.alert(message, options);
}
