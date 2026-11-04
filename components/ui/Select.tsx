"use client";

// 選ぶ部品（T51 で書き直した）。OS の select の代わりで、書き方は select の要素と同じ（value・defaultValue・onChange・name、中は <option>・<optgroup>）。
// 押すとボタンの下に一覧が開く（Menu と同じ。下から出る面ではない）。一覧は body の直下に描く（表の overflow-clip で切られない）。
// 画面の中にスクロールの箱を作らない: 一覧は内側で送らず、長ければ画面全体が伸びる。下に入りきらず上が広ければ上に開く。
// キー: ↑↓・Home・End で移る（選べない物は飛ばす）、Enter・Space で選ぶ、Escape でボタンへ戻って閉じる、Tab と外を押すと閉じる。
// 文字を打つとその文字で始まる項目へ（1 秒で打ち直し）。項目が 12 を超えるか searchable なら、一覧の上に検索の欄。
// multiple で複数（押しても閉じない、ボタンの字は「a・b」か「N 件」、隠しの欄は同じ name で複数）。<option data-sub> で説明の行。
// <option value="" data-placeholder> は「まだ選んでいない」の項目で、選ばれている間はボタンの字を灰（入力の欄の下書きと同じ）。
// 選んだ印は太字と右のチェック（下地を敷かない）。押したときは灰色だけ（data-press）。

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SELECT_LABELS } from "@/lib/ui/labels";
import {
  edgeIndex,
  filterItems,
  joinValues,
  moveIndex,
  placeList,
  readOptions,
  summaryLabel,
  toggleValue,
  typeaheadIndex,
  wantsSearch,
  type SelectItem,
  type SelectModel,
} from "@/lib/ui/select";
import { ChosenIcon, OpenIcon, SaveIcon, SearchIcon } from "./Icon";

/** onChange に渡す物。OS の select と同じく e.target.value・e.currentTarget.value で読める。複数のときは values に配列 */
export type SelectTarget = { value: string; values: string[]; name: string };
export type SelectChangeEvent = { target: SelectTarget; currentTarget: SelectTarget };

export type SelectProps = {
  value?: string | string[];
  defaultValue?: string | string[];
  onChange?: (e: SelectChangeEvent) => void;
  name?: string;
  children?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** 複数を選ぶ */
  multiple?: boolean;
  /** 項目が少なくても検索の欄を出す */
  searchable?: boolean;
  className?: string;
} & Omit<ComponentProps<"button">, "value" | "defaultValue" | "onChange" | "children" | "type" | "name" | "multiple">;

const asList = (v: string | string[] | undefined): string[] | undefined => (v === undefined ? undefined : Array.isArray(v) ? v.map(String) : [String(v)]);

/** 文字で飛ぶとき、続けて打った字をまとめる間（ms） */
const TYPE_RESET_MS = 1000;

export function Select({
  value,
  defaultValue,
  onChange,
  name,
  children,
  disabled = false,
  required,
  multiple = false,
  searchable,
  className = "",
  id,
  ...rest
}: SelectProps) {
  const model = useMemo(() => readOptions(children), [children]);
  const controlled = value !== undefined;
  const [inner, setInner] = useState<string[]>(() => {
    const d = asList(defaultValue);
    if (d) return d;
    // OS の select と同じく、何も決めていなければ 1 つ目の選べる項目（複数のときは空）
    if (multiple) return [];
    const first = model.items.find((i) => !i.disabled);
    return first ? [first.value] : [];
  });
  const values = controlled ? (asList(value) ?? []) : inner;

  const autoId = useId();
  const buttonId = id ?? `select-${autoId}`;
  const listId = `${buttonId}-list`;
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  /** 焦点のある項目（shown の中の位置）。-1 は無し */
  const [active, setActive] = useState(-1);
  const [focusOn, setFocusOn] = useState<"list" | "search">("list");
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  /** 開いたときに決めた向き（検索で一覧が縮んでも向きは変えない） */
  const dir = useRef<boolean | null>(null);
  const typed = useRef({ text: "", at: 0 });

  const showSearch = wantsSearch(model.items.length, searchable);
  const shown = useMemo(() => filterItems(model.items, showSearch ? query : ""), [model.items, query, showSearch]);

  const selectedLabels = model.items.filter((i) => values.includes(i.value)).map((i) => i.label);
  const chosen = model.items.find((i) => values.includes(i.value));
  const buttonText = multiple ? summaryLabel(selectedLabels) : (chosen?.label ?? null);
  // 未選択の印の項目（data-placeholder）が選ばれている間も灰。「全部」のように value="" が選んだ物の所は印を付けないので黒のまま
  const muted = disabled || buttonText == null || (!multiple && (chosen?.disabled === true || chosen?.placeholder === true));

  const close = (refocus: boolean) => {
    setOpen(false);
    setPos(null);
    dir.current = null;
    if (refocus) button.current?.focus({ preventScroll: true });
  };

  const openList = () => {
    if (disabled || open) return;
    const at = model.items.findIndex((i) => values.includes(i.value) && !i.disabled);
    const all = model.items.map((_, i) => i);
    setQuery("");
    setActive(at >= 0 ? at : edgeIndex(model.items, all, "first"));
    setFocusOn("list");
    setOpen(true);
  };

  const commit = (next: string[]) => {
    if (!controlled) setInner(next);
    const t: SelectTarget = { value: multiple ? joinValues(next) : (next[0] ?? ""), values: next, name: name ?? "" };
    onChange?.({ target: t, currentTarget: t });
  };

  const pick = (itemIndex: number) => {
    const it = model.items[itemIndex];
    if (!it || it.disabled) return;
    if (multiple) {
      commit(toggleValue(model.items, values, it.value));
      return;
    }
    if (values[0] !== it.value || values.length !== 1) commit([it.value]);
    close(true);
  };

  // 置き場所: 開いた直後（描いた一覧の大きさを測ってから見せる）と、検索で項目の数が変わったとき
  useLayoutEffect(() => {
    if (!open) return;
    const b = button.current;
    const l = list.current;
    if (!b || !l) return;
    const a = b.getBoundingClientRect();
    const view = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const placed = placeList({
      anchor: a,
      list: { width: Math.max(l.offsetWidth, a.width), height: l.offsetHeight },
      viewport: view,
      scroll: { x: window.scrollX, y: window.scrollY },
    });
    if (dir.current === null) dir.current = placed.up;
    let top = placed.top;
    // 向きは開いたときのまま。上に開いた一覧は、縮んでもボタンの上に付けておく
    if (dir.current && !placed.up) top = a.top + window.scrollY - 4 - l.offsetHeight;
    if (!dir.current && placed.up) top = a.bottom + window.scrollY + 4;
    setPos({ top, left: placed.left, minWidth: a.width });
  }, [open, shown.length]);

  // 焦点: 項目か検索の欄。画面の外なら画面全体を送って見せる
  useEffect(() => {
    if (!open || !pos) return;
    if (focusOn === "search") {
      search.current?.focus({ preventScroll: true });
      return;
    }
    const el = list.current?.querySelector<HTMLElement>(`[data-pos="${active}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest" });
    } else {
      list.current?.focus({ preventScroll: true });
    }
  }, [open, pos, active, focusOn]);

  // 外を押す・窓の幅が変わると閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (button.current?.contains(t) || list.current?.contains(t)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = model.items;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        if (active < 0) {
          setActive(edgeIndex(items, shown, step === 1 ? "first" : "last"));
          setFocusOn("list");
          return;
        }
        const next = moveIndex(items, shown, active, step);
        // 一番上でさらに ↑ を押すと検索の欄へ
        if (step === -1 && next === active && showSearch) {
          setFocusOn("search");
          return;
        }
        setActive(next);
        setFocusOn("list");
        return;
      }
      case "Home":
      case "End":
        e.preventDefault();
        setActive(edgeIndex(items, shown, e.key === "Home" ? "first" : "last"));
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (active >= 0) pick(shown[active]);
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case "Tab":
        // ボタンへ焦点を戻してから、Tab はそのままボタンの次（前）へ進む
        close(true);
        return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (showSearch) {
      // 検索の欄がある一覧では、打った字は検索へ
      e.preventDefault();
      setQuery((q) => q + e.key);
      setFocusOn("search");
      return;
    }
    const now = Date.now();
    const t = typed.current;
    t.text = now - t.at > TYPE_RESET_MS ? e.key : t.text + e.key;
    t.at = now;
    const to = typeaheadIndex(items, shown, active, t.text);
    if (to >= 0) {
      e.preventDefault();
      setActive(to);
    }
  };

  const onQuery = (q: string) => {
    setQuery(q);
    setActive(-1);
    setFocusOn("search");
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const items = model.items;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const cur = active >= 0 && active < shown.length && !items[shown[active]].disabled ? active : edgeIndex(items, shown, "first");
      if (cur >= 0) {
        setActive(cur);
        setFocusOn("list");
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const first = edgeIndex(items, shown, "first");
      if (first >= 0) pick(shown[first]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      close(true);
    }
  };

  return (
    <>
      <button
        {...rest}
        ref={button}
        id={buttonId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-required={required || undefined}
        className={`inline-flex min-w-0 items-center justify-between gap-1 text-left ${className}`}
        style={open ? { ...rest.style, outline: "2px solid var(--accent)", outlineOffset: "-2px" } : rest.style}
        data-press=""
        data-select-open={open ? "" : undefined}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={onButtonKey}
      >
        <span className={`min-w-0 flex-1 truncate ${muted ? "text-muted" : ""}`}>{buttonText ?? SELECT_LABELS.none}</span>
        <OpenIcon aria-hidden className={`size-4 shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
      </button>
      {name &&
        (multiple ? values : [values[0] ?? ""]).map((v, i) => <input key={`${i}-${v}`} type="hidden" name={name} value={v} disabled={disabled} />)}
      {open &&
        createPortal(
          <SelectList
            ref={list}
            searchRef={search}
            id={listId}
            labelledBy={rest["aria-label"] ? undefined : buttonId}
            label={rest["aria-label"]}
            model={model}
            shown={shown}
            values={values}
            active={active}
            multiple={multiple}
            search={showSearch ? { query, onQuery: onQuery, onKeyDown: onSearchKey } : null}
            style={pos ? { top: pos.top, left: pos.left, minWidth: pos.minWidth } : { top: 0, left: 0, visibility: "hidden" }}
            onKeyDown={onListKey}
            onPick={pick}
            onActive={(p) => {
              setActive(p);
              setFocusOn("list");
            }}
          />,
          document.body,
        )}
    </>
  );
}

const PANEL =
  "absolute z-50 max-w-[calc(100vw-1rem)] rounded-lg bg-panel p-1 text-sm text-ink shadow-[0_2px_8px_rgb(0_0_0/0.18)] outline-none dark:bg-panel2 dark:shadow-[0_2px_10px_rgb(0_0_0/0.6)]";
const ITEM =
  "flex min-h-8 cursor-default items-center gap-2 rounded px-2 py-1 outline-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid";

/** 開いた一覧（body の直下に描く）。テストは renderToStaticMarkup でこれを描く */
export function SelectList({
  ref,
  searchRef,
  id,
  label,
  labelledBy,
  model,
  shown,
  values,
  active,
  multiple,
  search,
  style,
  onKeyDown,
  onPick,
  onActive,
}: {
  ref?: React.Ref<HTMLDivElement>;
  searchRef?: React.Ref<HTMLInputElement>;
  id: string;
  label?: string;
  labelledBy?: string;
  model: SelectModel;
  shown: number[];
  values: string[];
  active: number;
  multiple: boolean;
  search: { query: string; onQuery: (q: string) => void; onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void } | null;
  style?: React.CSSProperties;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  onPick?: (itemIndex: number) => void;
  onActive?: (pos: number) => void;
}) {
  // 続いて同じグループの項目を 1 つの束に（検索で絞ったあとも、見出しは残る項目のある物だけ）
  const runs: { group: number | null; at: number[] }[] = [];
  shown.forEach((itemIndex, p) => {
    const g = model.items[itemIndex].group;
    const last = runs[runs.length - 1];
    if (last && last.group === g) last.at.push(p);
    else runs.push({ group: g, at: [p] });
  });

  const option = (p: number) => {
    const i = shown[p];
    const it: SelectItem = model.items[i];
    const on = values.includes(it.value);
    return (
      <div
        key={`${i}-${it.value}`}
        id={`${id}-${i}`}
        role="option"
        aria-selected={on}
        aria-disabled={it.disabled || undefined}
        tabIndex={-1}
        data-pos={p}
        data-value={it.value}
        data-active={p === active ? "" : undefined}
        data-press={it.disabled ? undefined : ""}
        // 未選択の印の項目（data-placeholder）は閉じた欄の字と同じ灰の細い字。選ばれていても太字にしない（選んだ印は右のチェックだけ。T113）
        className={`${ITEM} ${it.disabled || it.placeholder ? "text-muted" : ""} ${on && !multiple && !it.placeholder ? "font-bold" : ""}`}
        onClick={() => onPick?.(i)}
        onFocus={() => {
          if (p !== active) onActive?.(p);
        }}
      >
        {multiple && (
          <span aria-hidden className={`grid size-4 shrink-0 place-items-center rounded-[3px] ${on ? "bg-accent-fill text-on-accent" : "outline-1 -outline-offset-1 outline-muted"}`}>
            {on && <SaveIcon className="size-3" />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block">{it.label}</span>
          {it.sub && <span className="block text-xs font-normal text-muted">{it.sub}</span>}
        </span>
        {on && !multiple && <ChosenIcon aria-hidden className="size-4 shrink-0" />}
      </div>
    );
  };

  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      aria-label={label}
      aria-labelledby={labelledBy}
      aria-multiselectable={multiple || undefined}
      tabIndex={-1}
      className={PANEL}
      style={style}
      onKeyDown={onKeyDown}
      data-select-list=""
    >
      {search && (
        <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 rounded-t-lg bg-panel px-1 pt-1 dark:bg-panel2">
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="text"
              role="searchbox"
              value={search.query}
              onChange={(e) => search.onQuery(e.target.value)}
              onKeyDown={search.onKeyDown}
              aria-label={SELECT_LABELS.search}
              aria-controls={id}
              autoComplete="off"
              enterKeyHint="search"
              className="h-8 w-full rounded bg-panel2 pr-2 pl-8 text-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent focus-visible:outline-solid dark:bg-panel"
              data-select-search=""
            />
          </div>
        </div>
      )}
      {shown.length === 0 && (
        <div role="status" className="px-2 py-1.5 text-muted">
          {SELECT_LABELS.empty}
        </div>
      )}
      {runs.map((r, k) =>
        r.group === null ? (
          r.at.map(option)
        ) : (
          <div key={`g-${r.group}-${k}`} role="group" aria-labelledby={`${id}-g${r.group}-${k}`}>
            <div id={`${id}-g${r.group}-${k}`} role="presentation" className="px-2 pt-2 pb-0.5 text-xs text-muted">
              {model.groups[r.group].label}
            </div>
            {r.at.map(option)}
          </div>
        ),
      )}
    </div>
  );
}
