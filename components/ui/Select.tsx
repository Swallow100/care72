"use client";

// OS の選択（<select>）の代わり（T44）。<select> と同じ書き方（value・onChange・中の <option>・<optgroup>）のまま、
// 押すとその下に一覧が開き、押した項目を選ぶ（components/ui/Menu と同じ作り: 外を押す・Esc で閉じる）。
// OS の選択の画面は端末ごとに見た目と操作が違い、アプリの画面から浮くので使わない。
// - onChange には e.target.value・e.currentTarget.value で読める形を渡す（呼ぶ側の書き方を変えない）
// - value が無ければ defaultValue から中で持つ。name があれば隠しの欄で同じ値をフォームに送る
// - 一覧は body の直下に描く（表の入れ物の overflow-clip で切られないように）。位置はボタンの下、右にはみ出すなら右を揃える
// - 選んでいる項目は太字とチェックの印（下地は敷かない）。キーは ↑↓・Home・End で移り、Enter・Space で選び、Esc・Tab で閉じる
// - 画面の中にスクロールの箱を作らない（一覧は長くても内側で送らず、画面全体の縦 1 本で送る）

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChosenIcon, OpenIcon } from "./Icon";

export type SelectItem = { value: string; label: string; disabled: boolean; group?: string };
type OptionProps = { value?: string | number; children?: ReactNode; disabled?: boolean; label?: string };

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

/** 中の <option>・<optgroup>・Fragment・配列をたどって、選べる項目の並びにする */
export function selectItems(children: ReactNode, group?: string): SelectItem[] {
  const out: SelectItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<OptionProps>;
    if (el.type === Fragment) {
      out.push(...selectItems(el.props.children, group));
      return;
    }
    if (el.type === "optgroup") {
      out.push(...selectItems(el.props.children, el.props.label ?? group));
      return;
    }
    if (el.type === "option") {
      const label = textOf(el.props.children) || el.props.label || "";
      const value = el.props.value === undefined ? label : String(el.props.value);
      out.push({ value, label, disabled: Boolean(el.props.disabled), ...(group ? { group } : {}) });
    }
  });
  return out;
}

/** ↑↓・Home・End で次に移る項目（選べない項目は飛ばす）。無ければ今のまま */
export function nextEnabled(items: readonly SelectItem[], from: number, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): number {
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
  if (enabled.length === 0) return from;
  if (key === "Home") return enabled[0];
  if (key === "End") return enabled[enabled.length - 1];
  if (key === "ArrowDown") return enabled.find((i) => i > from) ?? from;
  return [...enabled].reverse().find((i) => i < from) ?? from;
}

/** onChange に渡す形（<select> の change と同じく target.value・currentTarget.value で読める） */
export type SelectChange = { target: { value: string; name: string }; currentTarget: { value: string; name: string } };

export type SelectProps = {
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (event: SelectChange) => void;
  name?: string;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  title?: string;
  "aria-label"?: string;
} & { [data: `data-${string}`]: string | undefined };

export function Select({
  value,
  defaultValue,
  onChange,
  name,
  children,
  className = "",
  disabled = false,
  required,
  id,
  title,
  "aria-label": ariaLabel,
  ...data
}: SelectProps) {
  const [inner, setInner] = useState(defaultValue === undefined ? undefined : String(defaultValue));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const items = selectItems(children);
  const current = value !== undefined ? String(value) : (inner ?? items.find((it) => !it.disabled)?.value ?? "");
  const selected = items.find((it) => it.value === current);

  const close = useCallback((focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  }, []);

  // 開いたら、ボタンの下に置く（右にはみ出すなら右を揃える）。窓の幅が変わったら閉じる
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const b = button.current?.getBoundingClientRect();
    if (!b) return;
    const width = list.current?.offsetWidth ?? b.width;
    const room = document.documentElement.clientWidth - 8;
    const left = Math.max(8, Math.min(b.left, room - width)) + window.scrollX;
    setPos({ top: b.bottom + 4 + window.scrollY, left, minWidth: b.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  // 置けたら、選んでいる項目（無ければ最初の選べる項目）に焦点を置く
  useEffect(() => {
    if (!open || !pos) return;
    const at = items.findIndex((it) => it.value === current && !it.disabled);
    const start = at >= 0 ? at : nextEnabled(items, -1, "ArrowDown");
    list.current?.querySelector<HTMLButtonElement>(`[data-index="${start}"]`)?.focus({ preventScroll: true });
    // 項目の並びは開いている間は変わらない（開いたときの 1 回だけ）
  }, [open, pos]);

  const choose = (next: string) => {
    close(true);
    if (next === current) return;
    if (value === undefined) setInner(next);
    const target = { value: next, name: name ?? "" };
    onChange?.({ target, currentTarget: target });
  };

  const onListKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const at = Number((document.activeElement as HTMLElement | null)?.dataset.index ?? -1);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const to = nextEnabled(items, at, e.key);
      list.current?.querySelector<HTMLButtonElement>(`[data-index="${to}"]`)?.focus();
    }
  };

  let lastGroup: string | undefined;
  return (
    <>
      <button
        ref={button}
        type="button"
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex min-w-0 items-center justify-between gap-1.5 text-left disabled:text-muted ${open ? "outline-2 -outline-offset-2 outline-accent" : ""} ${className}`}
        data-press
        {...data}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-muted"}`}>{selected?.label ?? ""}</span>
        <OpenIcon aria-hidden className={`size-4 shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
      </button>
      {name !== undefined && <input type="hidden" name={name} value={current} />}
      {open &&
        createPortal(
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={ariaLabel ?? title}
            onKeyDown={onListKey}
            style={pos ? { top: pos.top, left: pos.left, minWidth: pos.minWidth } : { top: 0, left: 0, visibility: "hidden" }}
            className="absolute z-50 max-w-[calc(100vw-1rem)] rounded-lg bg-panel p-1 text-sm text-ink shadow-[0_2px_8px_rgb(0_0_0/0.18)] dark:bg-panel2 dark:shadow-[0_2px_10px_rgb(0_0_0/0.6)]"
          >
            {items.map((it, i) => {
              const active = it.value === current;
              const header = it.group && it.group !== lastGroup ? it.group : null;
              lastGroup = it.group;
              return (
                <Fragment key={`${i}:${it.value}`}>
                  {header && <p className="px-2 pt-2 pb-0.5 text-xs text-muted">{header}</p>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={it.disabled}
                    data-index={i}
                    tabIndex={-1}
                    onClick={() => choose(it.value)}
                    className={`flex min-h-8 w-full items-center gap-2 rounded px-2 text-left disabled:text-muted ${active ? "font-bold" : ""}`}
                    data-press
                  >
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {active ? <ChosenIcon aria-hidden className="size-4 shrink-0" /> : <span aria-hidden className="size-4 shrink-0" />}
                  </button>
                </Fragment>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
