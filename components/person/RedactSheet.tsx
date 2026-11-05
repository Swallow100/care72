"use client";

// 黒塗りの画面（T52）。入れる欄と様式の読み取り（T83）で写真・PDF を選ぶと必ずここを通り、写った氏名・住所・電話・町名・生年月日・保険者番号を人が四角で黒く塗ってから送る。
// - 全画面の窓（<dialog> の showModal。後ろは押せず、Tab は窓の中を回る）。Escape・「取消」で何も送らずに閉じる
// - 写真は 1 枚 1 頁、PDF は頭から 10 頁まで（lib/redact/browser.ts。T146 で 3 から 10 に）。1 頁ずつ出し、「前頁」「次頁」で移る
// - 4 頁以上あれば（Excel・Word と、T146 から PDF も）頁ごとに「対象」「除外」を選び、送るのは 10 頁まで
//   （Excel・Word の既定は記入例・記載例のシートを外した頭の 10 頁）。描いた頁は元の印刷と少しずれるので「PDF 保存で正確」を 1 行出す。
//   T122: シートが 2 つ以上のブックは「シート」でシートの一覧を窓の中に開く（押すとそのシートの頭の頁へ）。既定で送る頁は様式の本体らしいシート
//   （lib/ooxml/pick.ts。表紙・目次・説明・記入例は後ろ）。頁の画像は見る頁と送る頁だけ描く（描くまで「描画中」）
//   古い形（.xls・.doc）は読まずに「旧形式」と名前を出す
// - 塗る: 指・マウスで引くと黒い四角。押した四角は選ばれ（操作の色の枠）、「外す」で外す。「一手戻す」「全解除」（この頁）
// - 拡大: ボタン（拡大・縮小・全体）・ホイール・2 本の指。拡大中は「移動」で画像を送る（2 本の指はいつでも送れる）
// - 画面の中にスクロールの箱を作らない。画像は枠に収め、拡大中だけ画像の中を動かす（窓は送らない）
// - 送信: 塗った所の無い頁があれば確かめの窓「塗り無し」（共通の部品 appChoice。戻る・送信）。隠した所 0 の頁を送れるのは、
//   人がそこで「送信」を選んだときだけで、その頁に bare の印を付けて渡す（サーバーは印の無い 0 を断る。T83）。
//   塗った後の画像（JPEG、EXIF なし）だけを呼ぶ側へ渡す。元の写真・PDF は渡さない
// 座標・塗り・JPEG の計算は lib/redact（純な関数、テストあり）。ここは描くのと指・マウスを受けるだけ。

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, buttonClass } from "@/components/ui/Button";
import { AddIcon, BackIcon, CloseIcon, FitIcon, OpenIcon, RemoveIcon, SendIcon, ZoomInIcon, ZoomOutIcon } from "@/components/ui/Icon";
import { Loader72 } from "@/components/ui/Loader72";
import { REDACT_LABELS as L } from "@/lib/labels";
import { PDF_PAGES_MAX, READ_CHOOSE_FROM, type ReadMeta } from "@/lib/intake/read-form";
import { defaultExcluded } from "@/lib/ooxml/pick";
import { drawRedactPage, encodeRedacted, loadPages, metaOf, releasePages, type RedactPage } from "@/lib/redact/browser";
import { hitRect, initialRedact, rectFromDrag, redactReducer, totalHidden, unpainted, type Rect } from "@/lib/redact/rects";
import { fitView, panView, pinchView, refitView, viewToImage, zoomAt, ZOOM_MAX, ZOOM_STEP, type Frame, type Pt, type View } from "@/lib/redact/view";
import { appChoice } from "@/lib/ui/dialog";
import { ClearIcon, MoveIcon, NextIcon, PaintIcon, UndoIcon } from "./icons";

/**
 * 送る 1 頁（塗った後の画像と、黒塗りの画面の印）。bare は隠した所 0 の頁を人が確かめの窓で「送信」と選んだ印。
 * origin は元のファイルの頁の番号（選んで頁の番号を振り直しても元の番号。一覧の公式の様式の共有の対応表の鍵、T134）
 */
export type RedactedPage = { name: string; blob: Blob; meta: ReadMeta; bare: boolean; origin: number };

/** これより動かなければ「押した」（四角を選ぶ）。px */
const TAP_SLOP = 6;



type Mode = "paint" | "move";

export function RedactSheet({
  files,
  onSend,
  onCancel,
  pageBytes,
}: {
  files: readonly File[];
  onSend: (pages: RedactedPage[]) => void;
  onCancel: () => void;
  /**
   * 送る頁の数から 1 頁の JPEG の上限を決める（T146）。様式の読み取りは 1 要求に全部の頁を載せるので、頁の画像の合計を上限に収める
   * （lib/forms/read-upload.ts の formReadPageBytes）。入れる欄の読み取りは 1 頁 1 要求なので渡さない（1 枚の上限のまま）
   */
  pageBytes?: (pages: number) => number;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<RedactPage[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [legacy, setLegacy] = useState<string[]>([]);
  // 送らない頁（Excel・Word で 4 頁以上のとき人が選ぶ）
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [at, setAt] = useState(0);
  const [state, dispatch] = useReducer(redactReducer, undefined, () => initialRedact([]));
  const [selected, setSelected] = useState(-1);
  const [mode, setMode] = useState<Mode>("paint");
  const [frame, setFrame] = useState<Frame | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [encodeFailed, setEncodeFailed] = useState(false);
  // シートの一覧を開いているか（T122）
  const [sheetList, setSheetList] = useState(false);
  const sheetListId = useId();
  const page = pages?.[at] ?? null;
  const rects = page ? (state.rects[page.id] ?? []) : [];

  // 開く。開いている間は後ろを送らない（地図の全画面と同じ形。片付けで close を呼ばない）
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // 最初の焦点は画像の枠（取消に枠が付かない。キーの一手戻す・外す・拡大もここで受ける）
    stage.current?.focus({ preventScroll: true });
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // 今の頁の並び（片付けで、描いた頁の画像も外す。T122）
  const pagesRef = useRef<RedactPage[] | null>(null);
  pagesRef.current = pages;

  // 写真・PDF を頁の画像に（ブラウザの中だけ）
  useEffect(() => {
    let live = true;
    let loaded: RedactPage[] = [];
    void loadPages(files).then((r) => {
      loaded = r.pages;
      if (!live) return releasePages(r.pages);
      setPages(r.pages);
      setFailed(r.failed);
      setLegacy(r.legacy);
      const skip = defaultExcluded(r.pages.map((p) => ({ id: p.id, example: p.example, ...p.pick })));
      setExcluded(skip);
      // 送る頁の頭から見せる（T122: 様式の本体のシートがブックの後ろにあるとき、表紙を開かない）
      setAt(Math.max(0, r.pages.findIndex((p) => !skip.has(p.id))));
    });
    return () => {
      live = false;
      // 描いた頁の画像は state の写しにある（drawRedactPage）。今の頁の並びで片付ける
      releasePages(pagesRef.current ?? loaded);
    };
  }, [files]);

  // 見ている頁の画像がまだ無ければ描く（Excel・Word。T122）
  const drawn = (p: RedactPage) => setPages((cur) => (cur ? cur.map((x) => (x.id === p.id ? p : x)) : cur));
  useEffect(() => {
    if (!page || page.url) return;
    let live = true;
    void drawRedactPage(page).then(
      (p) => {
        if (live) drawn(p);
        else URL.revokeObjectURL(p.url);
      },
      () => {
        if (live) setEncodeFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [page?.id, page?.url]);

  // 枠の大きさを測る（向き・幅が変われば測り直し、倍率と真ん中を保つ）
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => {
      const f = { w: e.contentRect.width, h: e.contentRect.height };
      if (f.w > 0 && f.h > 0) setFrame(f);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 頁が変わった・枠が変わったら表示を合わせ直す
  const lastFrame = useRef<Frame | null>(null);
  const lastPage = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!frame || !page) return;
    const samePage = lastPage.current === page.id;
    setView((v) => (samePage && v && lastFrame.current ? refitView(v, lastFrame.current, frame, page) : fitView(frame, page)));
    lastFrame.current = frame;
    lastPage.current = page.id;
  }, [frame, page]);

  // 一手戻したら、戻した頁を出す
  useEffect(() => {
    if (!pages || !state.lastPage) return;
    const i = pages.findIndex((p) => p.id === state.lastPage);
    if (i >= 0 && i !== at) setAt(i);
    // 戻した頁へ移るだけ。at は依存に入れない（頁を移るたびに戻ってしまう）
  }, [state.past.length, pages]);

  const update = (f: (v: View, fr: Frame) => View) => {
    if (!page) return;
    setView((v) => (v && frame ? f(v, frame) : v));
  };
  const zoomBy = (k: number, p?: Pt) => update((v, fr) => zoomAt(v, fr, page!, v.zoom * k, p));

  // ホイールで拡大（React の onWheel は passive で止められないので、ここで足す）
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const k = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      setView((v) => (v && frameRef.current && pageRef.current ? zoomAt(v, frameRef.current, pageRef.current, v.zoom * k, p) : v));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const frameRef = useRef(frame);
  const pageRef = useRef(page);
  frameRef.current = frame;
  pageRef.current = page;

  // ---- 指・マウス ----
  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<{ start: Pt; moved: boolean; pinch: boolean } | null>(null);
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!view || !page || encoding) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 1) gesture.current = { start: p, moved: false, pinch: false };
    else if (gesture.current) {
      // 2 本目の指: 塗りかけを捨てて拡大・送りに
      gesture.current.pinch = true;
      setDraft(null);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev || !g || !view || !page || !frame) return;
    const now = local(e);
    if (!g.moved && Math.hypot(now.x - g.start.x, now.y - g.start.y) >= TAP_SLOP) g.moved = true;
    const ids = [...pointers.current.keys()];
    if (g.pinch && ids.length >= 2) {
      const [a, b] = ids;
      if (e.pointerId !== a && e.pointerId !== b) return;
      const before: [Pt, Pt] = [pointers.current.get(a)!, pointers.current.get(b)!];
      pointers.current.set(e.pointerId, now);
      const after: [Pt, Pt] = [pointers.current.get(a)!, pointers.current.get(b)!];
      update((v, fr) => pinchView(v, fr, page, before, after));
      return;
    }
    pointers.current.set(e.pointerId, now);
    if (g.pinch) return;
    if (mode === "move") update((v, fr) => panView(v, fr, page, now.x - prev.x, now.y - prev.y));
    else if (g.moved) setDraft(rectFromDrag(view, page, g.start, now));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const last = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0 || !g) return;
    gesture.current = null;
    if (!view || !page || !last) return;
    if (!g.moved && !g.pinch) {
      // 押しただけ: 四角を選ぶ（何も無い所なら選ばない）
      setSelected(hitRect(rects, viewToImage(view, last)));
      return;
    }
    if (mode === "paint" && !g.pinch && e.type === "pointerup") {
      const r = rectFromDrag(view, page, g.start, last);
      if (r) {
        dispatch({ type: "add", page: page.id, rect: r });
        setSelected(rects.length);
      }
    }
    setDraft(null);
  };

  // ---- 操作 ----
  const goto = (i: number) => {
    setAt(i);
    setSelected(-1);
    setDraft(null);
  };
  const remove = () => {
    if (!page || selected < 0) return;
    dispatch({ type: "remove", page: page.id, index: selected });
    setSelected(-1);
  };
  const undo = () => {
    dispatch({ type: "undo" });
    setSelected(-1);
  };
  const clear = () => {
    if (!page) return;
    dispatch({ type: "clear", page: page.id });
    setSelected(-1);
  };

  // 送る頁（選ぶ頁が無ければ全部）
  const chosen = pages ? pages.filter((p) => !excluded.has(p.id)) : [];
  const office = !!pages && pages.some((p) => p.source === "excel" || p.source === "word");
  // シートの一覧（T122。シートが 2 つ以上のブックだけ）。ブックの順に、頁の数と送る頁があるか
  const sheets = pages
    ? pages.reduce<Array<{ name: string; first: number; pages: number; picked: boolean }>>((acc, p, i) => {
        if (!p.sheet) return acc;
        const s = acc.find((x) => x.name === p.sheet);
        if (s) {
          s.pages += 1;
          s.picked ||= !excluded.has(p.id);
        } else acc.push({ name: p.sheet, first: i, pages: 1, picked: !excluded.has(p.id) });
        return acc;
      }, [])
    : [];
  // 送る頁を選ぶ: 4 頁以上か、シートが 2 つ以上のブック（既定で外した頁を戻せるように。T122）。
  // 上限を 10 頁にしたので（T146）、上限を超えたときでなく 4 頁から選べるようにする（頁ごとに AI を呼ぶので、要らない頁を外せる）
  const choosing = !!pages && (pages.length >= READ_CHOOSE_FROM || sheets.length >= 2);

  async function send() {
    if (!pages || chosen.length === 0 || chosen.length > PDF_PAGES_MAX || encoding) return;
    const blank = unpainted(
      state,
      chosen.map((p) => p.id),
    );
    if (blank.length > 0) {
      const names = blank.map((id) => {
        const p = pages.find((x) => x.id === id)!;
        return L.pageName(p.fileName, p.page, p.pages);
      });
      // 戻るを先に置く（最初の焦点。Enter だけで塗らずに送らない）。塗らずに送るのは赤（隠さずに AI へ出す）
      const a = await appChoice(L.noneText, {
        title: L.noneTitle,
        details: names,
        options: [
          { value: "back", label: L.noneBack, icon: "BackIcon" },
          { value: "send", label: L.noneOk, icon: "SendIcon", danger: true },
        ],
      });
      if (a !== "send") {
        const i = pages.findIndex((p) => p.id === blank[0]);
        if (i >= 0) goto(i);
        return;
      }
    }
    setEncoding(true);
    setEncodeFailed(false);
    try {
      const out: RedactedPage[] = [];
      for (const [i, q] of chosen.entries()) {
        // 送る頁で、まだ描いていない頁を描く（T122）
        const p = q.url ? q : await drawRedactPage(q);
        if (p !== q) drawn(p);
        const r = state.rects[p.id] ?? [];
        // ここに来た隠した所 0 の頁は、上の窓で人が「送信」を選んだ物だけ。選んだ頁は頭から 1・2・3 と数え直す（受け口は頁の順を見る）
        const meta = metaOf(p, r);
        out.push({ name: L.pageName(p.fileName, p.page, p.pages), blob: await encodeRedacted(p, r, pageBytes?.(chosen.length)), meta: choosing ? { ...meta, page: i + 1 } : meta, bare: r.length === 0, origin: p.page });
      }
      onSend(out);
    } catch {
      setEncoding(false);
      setEncodeFailed(true);
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected >= 0) {
      e.preventDefault();
      remove();
    } else if (!e.ctrlKey && !e.metaKey && (e.key === "+" || e.key === "=")) zoomBy(ZOOM_STEP);
    else if (!e.ctrlKey && !e.metaKey && e.key === "-") zoomBy(1 / ZOOM_STEP);
  };

  const hidden = totalHidden(state);
  const busy = !pages || encoding;
  const s = view?.scale ?? 1;
  const box = (r: Rect) => ({ left: r.x * s, top: r.y * s, width: r.w * s, height: r.h * s });
  const toggle = (m: Mode, label: string, Icon: typeof PaintIcon) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className={`${buttonClass("quiet", "sm")} ${mode === m ? "underline decoration-2 underline-offset-[6px]" : "font-normal text-muted"}`}
      data-press=""
      data-redact={`mode-${m}`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label}
    </button>
  );

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-base p-0 text-ink backdrop:bg-black/40"
      data-redact="sheet"
      onCancel={(e) => {
        e.preventDefault();
        if (!encoding) onCancel();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="flex h-full flex-col">
        <header className="space-y-1.5 bg-panel px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 id={titleId} className="text-[1rem] leading-6 font-bold">
              {L.title}
            </h2>
            <span className="text-xs text-muted">{L.what}</span>
            <span className="text-xs font-bold tabular-nums" data-redact="count">
              {L.hidden} {hidden}
            </span>
            <span role="status" className="text-xs">
              {encoding ? <Loader72 label={L.encoding} size={16} live={false} className="text-muted" /> : null}
            </span>
            <div className="ml-auto flex gap-1.5">
              <Button kind="quiet" size="sm" icon={CloseIcon} disabled={encoding} onClick={onCancel} data-redact="cancel">
                {L.cancel}
              </Button>
              <Button kind="main" size="sm" icon={SendIcon} disabled={busy || !pages || chosen.length === 0 || chosen.length > PDF_PAGES_MAX} onClick={() => void send()} data-redact="send">
                {L.send}
              </Button>
            </div>
          </div>
          <div role="toolbar" aria-label={L.title} className="flex flex-wrap items-center gap-1">
            {toggle("paint", L.paint, PaintIcon)}
            {toggle("move", L.move, MoveIcon)}
            <span className="mx-0.5 hidden h-4 w-px bg-panel2 sm:inline-block" aria-hidden />
            <Button size="sm" icon={UndoIcon} disabled={busy || state.past.length === 0} onClick={undo} data-redact="undo">
              {L.undo}
            </Button>
            <Button kind="danger" size="sm" icon={RemoveIcon} disabled={busy || selected < 0} onClick={remove} data-redact="remove">
              {L.remove}
            </Button>
            <Button kind="danger" size="sm" icon={ClearIcon} disabled={busy || rects.length === 0} onClick={clear} data-redact="clear">
              {L.clear}
            </Button>
            <span className="mx-0.5 hidden h-4 w-px bg-panel2 sm:inline-block" aria-hidden />
            <Button size="sm" icon={ZoomOutIcon} disabled={busy || !view || view.zoom <= 1} onClick={() => zoomBy(1 / ZOOM_STEP)}>
              {L.zoomOut}
            </Button>
            <Button size="sm" icon={ZoomInIcon} disabled={busy || !view || view.zoom >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)}>
              {L.zoomIn}
            </Button>
            <Button size="sm" icon={FitIcon} disabled={busy || !view || view.zoom === 1} onClick={() => frame && page && setView(fitView(frame, page))}>
              {L.fit}
            </Button>
          </div>
          {pages && pages.length > 0 && page && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {pages.length > 1 && (
                <>
                  <Button size="sm" icon={BackIcon} disabled={busy || at === 0} onClick={() => goto(at - 1)} data-redact="prev">
                    {L.prev}
                  </Button>
                  <span className="font-bold tabular-nums" data-redact="page">
                    {at + 1}/{pages.length}
                  </span>
                  <Button size="sm" icon={NextIcon} disabled={busy || at >= pages.length - 1} onClick={() => goto(at + 1)} data-redact="next">
                    {L.next}
                  </Button>
                </>
              )}
              <span className="min-w-0 truncate">{L.pageName(page.fileName, page.page, page.pages)}</span>
              {sheets.length >= 2 && page.sheet ? (
                // シートの一覧を開く（T122）。一覧は窓の中に出す（共通の選ぶ部品は窓の外の body に出すので、全画面の窓の後ろに隠れる）
                <Button
                  size="sm"
                  icon={OpenIcon}
                  aria-expanded={sheetList}
                  aria-controls={sheetListId}
                  disabled={busy}
                  onClick={() => setSheetList((v) => !v)}
                  data-redact="sheets"
                >
                  {L.sheet} {page.sheet}
                </Button>
              ) : (
                page.sheet && <span className="min-w-0 truncate text-muted" data-redact="sheet-name">{page.sheet}</span>
              )}
              {page.total > page.pages && <span className="text-muted">{L.pagesOf(page.pages, page.total)}</span>}
              {choosing && (
                <>
                  <Button
                    size="sm"
                    icon={excluded.has(page.id) ? AddIcon : RemoveIcon}
                    aria-pressed={!excluded.has(page.id)}
                    disabled={busy}
                    onClick={() =>
                      setExcluded((s) => {
                        const n = new Set(s);
                        if (n.has(page.id)) n.delete(page.id);
                        else n.add(page.id);
                        return n;
                      })
                    }
                    data-redact="pick"
                  >
                    {excluded.has(page.id) ? L.pick : L.skip}
                  </Button>
                  <span className={`font-bold tabular-nums ${chosen.length > PDF_PAGES_MAX ? "text-danger" : ""}`} data-redact="picked">
                    {L.picked} {chosen.length}/{PDF_PAGES_MAX}
                  </span>
                </>
              )}
              {choosing && excluded.has(page.id) && <span className="font-bold">{L.skipped}</span>}
              {pages.length > 1 && (
                <span className="tabular-nums text-muted">
                  {L.onPage} {rects.length}
                </span>
              )}
            </div>
          )}
          {sheetList && sheets.length >= 2 && page && (
            // シートの一覧: 押すとそのシートの頭の頁へ。送る頁のあるシートは太字と下線、今のシートは操作の色の文字
            <div id={sheetListId} role="list" aria-label={L.sheet} className="flex flex-wrap gap-1 text-xs" data-redact="sheet-list">
              {sheets.map((sh) => (
                <button
                  key={sh.name}
                  type="button"
                  role="listitem"
                  aria-current={sh.name === page.sheet ? "page" : undefined}
                  className={`${buttonClass("quiet", "sm")} ${sh.picked ? "font-bold underline decoration-2 underline-offset-[6px]" : "font-normal"} ${sh.name === page.sheet ? "text-accent" : ""}`}
                  data-press=""
                  data-sheet={sh.name}
                  onClick={() => {
                    goto(sh.first);
                    setSheetList(false);
                  }}
                >
                  {L.sheetOption(sh.name, sh.pages, sh.picked)}
                </button>
              ))}
            </div>
          )}
          {office && (
            <p className="text-xs text-muted" data-redact="office">
              {L.officeHint}
            </p>
          )}
          {legacy.length > 0 && (
            <p className="text-xs font-bold text-danger" role="alert" data-redact="legacy">
              {L.legacy} {legacy.join("・")}
            </p>
          )}
          {failed.length > 0 && (
            <p className="text-xs font-bold text-danger" role="alert">
              {L.unreadable} {failed.join("・")}
            </p>
          )}
          {encodeFailed && (
            <p className="text-xs font-bold text-danger" role="alert">
              {L.encodeFailed}
            </p>
          )}
        </header>

        <div
          ref={stage}
          tabIndex={-1}
          aria-label={page ? L.pageName(page.fileName, page.page, page.pages) : L.preparing}
          className={`relative min-h-0 flex-1 touch-none overflow-hidden outline-none select-none ${mode === "move" ? "cursor-grab" : "cursor-crosshair"}`}
          data-redact="stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          {!pages && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader72 label={L.preparing} on="base" />
            </div>
          )}
          {page && !page.url && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader72 label={L.drawing} on="base" />
            </div>
          )}
          {page && page.url && view && (
            <div className="absolute" style={{ left: view.x, top: view.y, width: page.w * s, height: page.h * s }} data-redact="page-image">
              {/* ブラウザの中の blob: の画像（外へ出さない）なので next/image でなく img */}
              <img src={page.url} alt={L.pageName(page.fileName, page.page, page.pages)} draggable={false} className="absolute inset-0 size-full bg-panel" />
              {rects.map((r, i) => (
                <div
                  key={`${r.x}-${r.y}-${i}`}
                  className={`absolute bg-black ${i === selected ? "outline-2 outline-offset-2 outline-accent outline-solid" : ""}`}
                  style={box(r)}
                  data-redact="rect"
                  data-selected={i === selected || undefined}
                />
              ))}
              {draft && <div className="absolute bg-black/80 outline-1 outline-accent outline-dashed" style={box(draft)} data-redact="draft" />}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
