"use client";

// アプリ内の確認・お知らせの窓（lib/ui/dialog.ts の appConfirm・appAlert）。app/layout.tsx に 1 つ置く。
// 見た目は面（Panel）に題 16px と本文、ボタンは Button（消す操作は赤の塗り、取消は文字だけ）。
// 消す操作は最初の焦点を取消に置く（Enter だけで消えないように）。Escape と外側を押すと取消。
// <dialog> の showModal で開く（後ろは押せず、読み上げも窓の中だけ）。開いている間は後ろの画面を送らない。

import { useEffect, useRef, useSyncExternalStore } from "react";
import { currentDialog, initialFocus, settleDialog, subscribeDialogs, type DialogItem } from "@/lib/ui/dialog";
import { DIALOG_LABELS } from "@/lib/ui/labels";
import { Button } from "./Button";
import { CloseIcon } from "./Icon";

export function DialogHost() {
  const item = useSyncExternalStore(subscribeDialogs, currentDialog, () => null);
  if (!item) return null;
  // id ごとに描き直す（次の窓は新しく開き、焦点も置き直す）
  return <AppDialog key={item.id} item={item} />;
}

function AppDialog({ item }: { item: DialogItem }) {
  const box = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const titleId = `app-dialog-${item.id}`;
  const confirm = item.kind === "confirm";

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    if (!el.open) el.showModal();
    (initialFocus(item) === "cancel" ? cancelRef.current : okRef.current)?.focus();
    return () => {
      root.style.overflow = overflow;
      if (el.open) el.close();
      if (before?.isConnected) before.focus();
    };
  }, [item]);

  // 取消（お知らせは閉じるだけなので、どれで閉じても同じ）
  const cancel = () => settleDialog(item.id, !confirm);

  return (
    <dialog
      ref={box}
      aria-labelledby={titleId}
      data-app-dialog={item.kind}
      // Escape は取消（閉じるのは settle に任せ、ブラウザに閉じさせない）
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      // 外側（後ろの暗い所）を押したら取消。窓の中の押下は面が受ける
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg bg-panel p-0 text-ink backdrop:bg-[rgb(0_0_0/0.4)]"
    >
      <div className="grid gap-3 p-4">
        <h2 id={titleId} className="text-[1rem] leading-6 font-bold">
          {item.title}
        </h2>
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{item.message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          {confirm && (
            <Button ref={cancelRef} kind="quiet" icon={CloseIcon} onClick={cancel} data-dialog-action="cancel">
              {DIALOG_LABELS.cancel}
            </Button>
          )}
          <Button
            ref={okRef}
            kind={item.danger ? "dangerFill" : confirm ? "main" : "plain"}
            onClick={() => settleDialog(item.id, true)}
            data-dialog-action="ok"
          >
            {item.ok}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
