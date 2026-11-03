"use client";

// アプリ内の確認・お知らせの窓を描く所（T51 で書き直した）。app/layout.tsx に 1 つ置く。待ち行列は lib/ui/dialog.ts。
// <dialog> の showModal で後ろを押せなくし、Tab は窓の中を回る。Escape と外側（暗い所）は取消。
// 開いている間は後ろの画面を送らない。html の overflow は開く前の値を覚えて、閉じたら戻す（地図の全画面も html を触るので消し合わない）。
// 閉じたら、開く前に焦点のあった物へ戻す。
// 見た目: 面（白）に題 16px と本文、右下にボタン。影・グラデーション・ピル型なし。後ろは黒 40% で暗く。

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { cancelAnswer, dialogs, promptReady, type DialogAnswer, type DialogRequest } from "@/lib/ui/dialog";
import { Button, buttonClass } from "./Button";
import * as Icons from "./Icon";

const subscribe = (l: () => void) => dialogs.subscribe(l);
const current = () => dialogs.current();
const none = () => null;

export function DialogHost() {
  const req = useSyncExternalStore(subscribe, current, none);
  const ref = useRef<HTMLDialogElement>(null);
  /** 開く前の焦点と html の overflow（閉じたら戻す） */
  const before = useRef<{ focus: Element | null; overflow: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = document.documentElement;
    if (req) {
      if (!before.current) {
        before.current = { focus: document.activeElement, overflow: html.style.overflow };
        html.style.overflow = "hidden";
      }
      if (!el.open) el.showModal();
      const first = el.querySelector<HTMLElement>("[data-dialog-focus]");
      first?.focus();
    } else {
      if (el.open) el.close();
      const b = before.current;
      before.current = null;
      if (b) {
        html.style.overflow = b.overflow;
        if (b.focus instanceof HTMLElement && b.focus.isConnected) b.focus.focus({ preventScroll: true });
      }
    }
  }, [req]);

  // 部品が外れたときも html を戻す
  useEffect(
    () => () => {
      const b = before.current;
      if (b) document.documentElement.style.overflow = b.overflow;
    },
    [],
  );

  const settle = (answer: DialogAnswer) => {
    if (req) dialogs.settle(req.id, answer);
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={req ? `dialog-title-${req.id}` : undefined}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg bg-panel p-0 text-ink backdrop:bg-black/40"
      onCancel={(e) => {
        // Escape。窓は待ち行列が閉じる（次の窓があればそのまま出す）
        e.preventDefault();
        if (req) settle(cancelAnswer(req.kind));
      }}
      onClose={() => {
        // ブラウザが自分で閉じたとき（Escape を続けて押したなど）も取消にする
        if (req && dialogs.current()?.id === req.id) settle(cancelAnswer(req.kind));
      }}
      onClick={(e) => {
        // 外側（暗い所）を押すと取消。窓の中身は dialog の全体を覆うので、dialog そのものに当たるのは外側だけ
        if (e.target === e.currentTarget && req) settle(cancelAnswer(req.kind));
      }}
    >
      {req && <DialogPanel key={req.id} request={req} onSettle={settle} />}
    </dialog>
  );
}

const choiceButtons = (box: HTMLElement) => [...box.querySelectorAll<HTMLButtonElement>("button[data-choice]")];

/** 窓の中身（題・本文・箇条書き・欄・ボタン）。テストは renderToStaticMarkup でこれを描く */
export function DialogPanel({ request: r, onSettle }: { request: DialogRequest; onSettle: (answer: DialogAnswer) => void }) {
  const [value, setValue] = useState(r.field?.initial ?? "");
  const titleId = `dialog-title-${r.id}`;
  const OkIcon = Icons[r.okIcon];
  const cancelButton = (
    <Button kind="quiet" icon={Icons.CloseIcon} onClick={() => onSettle(cancelAnswer(r.kind))} data-dialog-focus={r.focus === "cancel" ? "" : undefined} data-dialog-action="cancel">
      {r.cancel}
    </Button>
  );
  const firstChoice = Math.max(
    0,
    r.options.findIndex((o) => !o.danger),
  );

  const onChoiceKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const list = choiceButtons(e.currentTarget);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    const to = at < 0 ? 0 : (at + step + list.length) % list.length;
    list[to]?.focus();
    e.preventDefault();
  };

  const body = (
    <>
      <h2 id={titleId} className="text-[1rem] leading-snug font-bold">
        {r.title}
      </h2>
      {r.message && <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{r.message}</p>}
      {r.details.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs leading-relaxed [overflow-wrap:anywhere] marker:text-muted" data-dialog-details>
          {r.details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </>
  );

  if (r.kind === "prompt" && r.field) {
    const f = r.field;
    const ready = promptReady(f, value);
    return (
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onSettle(value);
        }}
      >
        {body}
        <label className="mt-3 block">
          {f.label && <span className="mb-1 block text-xs text-muted">{f.label}</span>}
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={f.placeholder || undefined}
            maxLength={f.maxLength}
            required={f.required || undefined}
            aria-label={f.label ? undefined : r.title}
            autoComplete="off"
            enterKeyHint="done"
            className="h-12 w-full rounded bg-panel2 px-3 text-[0.9375rem] outline-none focus-visible:outline-2 focus-visible:outline-accent"
            data-dialog-focus=""
            data-dialog-field=""
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          {cancelButton}
          <Button type="submit" kind="main" icon={OkIcon} disabled={!ready} data-dialog-action="ok">
            {r.ok}
          </Button>
        </div>
      </form>
    );
  }

  if (r.kind === "choice") {
    return (
      <div className="p-4">
        {body}
        <div className="mt-3 flex flex-col gap-1.5" role="group" aria-labelledby={titleId} onKeyDown={onChoiceKey}>
          {r.options.map((o, i) => {
            const I = o.icon ? Icons[o.icon] : null;
            return (
              <button
                key={o.value}
                type="button"
                className={buttonClass(o.danger ? "danger" : "plain", "lg", "w-full justify-start")}
                data-press=""
                data-choice={o.value}
                data-dialog-focus={i === firstChoice ? "" : undefined}
                onClick={() => onSettle(o.value)}
              >
                {I && <I aria-hidden className="size-[1.125rem] shrink-0" />}
                {o.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex justify-end">{cancelButton}</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {body}
      <div className="mt-4 flex justify-end gap-2">
        {r.kind === "confirm" && cancelButton}
        <Button
          kind={r.kind === "alert" ? "plain" : r.danger ? "dangerFill" : "main"}
          icon={OkIcon}
          onClick={() => onSettle(r.kind === "alert" ? undefined : true)}
          data-dialog-focus={r.focus === "ok" ? "" : undefined}
          data-dialog-action="ok"
        >
          {r.ok}
        </Button>
      </div>
    </div>
  );
}
