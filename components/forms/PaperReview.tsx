"use client";

// 紙の画面の見直し（T136）。紙面の画面の上の帯（components/ui/PaperBar の中。印刷で消える）に「見直し N」、押すと一覧。紙には刷らない。
// - 決まりの見直し（サーバーが開くたびに数える）と、AI の見直し（今の紙の版で回した物）を、要修正・要確認・参考に分けて並べる
// - 行を押すと紙のその欄へ送り、欄に枠を出す。紙の上で入れる所（T135）へ送る口は、窓の出来事 care72:paper-field（欄・紙の上の物・頁・矩形）
// - 「AI照合」: サーバーの描く物（塗る所を除いた字と印）で頁の絵を描いて塗り、送る。直せそうな欄（対応表の紙の欄の場所・項目の読み違い）は
//   紙の上に「再考中」の印を付け、その欄だけを読み直し（再考）、紙を描き直してもう一度照合する（回の上限はサーバー。lib/forms/review-ai.ts）。
//   再考で直した欄は「再考済」に AI の印つきで並べ、戻せる
// 紙の上の印の見た目は components/forms/review-paper.css（紙の画面が読み込む。overlay-paper.css と同じ）
// - 「確認済」: 全部見た印（紙の版に付く。紙が変われば外れる）。確認済でないと、印刷の横に「見直し未確認」の一言（止めはしない。ReviewPrintNote）

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { OpenIcon, RestoreIcon, ReviewIcon, SaveIcon } from "@/components/ui/Icon";
import { StateTag } from "@/components/ui/Tag";
import type { FieldBox } from "@/lib/forms/mapping";
import { REVIEW_LABELS, REVIEW_LEVEL_LABELS, reviewCount, type ReviewFinding, type ReviewLevel } from "@/lib/forms/review";
import type { ComposePlan } from "@/lib/forms/review-ai";
import type { PaperReviewProps } from "@/lib/forms/review-view";

/** 帯の言葉（2〜4 字） */
export const REVIEW_UI = {
  head: "見直し",
  ai: "AI照合",
  drawing: "描画中",
  checking: "照合中",
  redoing: "再考中",
  fixed: "再考済",
  confirm: "確認済",
  unconfirmed: "見直し未確認",
  stale: "前の紙",
  undo: "戻す",
  failed: "照合失敗",
  refused: "同意拒否",
} as const;

type Phase = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "error"; label: string };

/** 紙の上の欄へ送る口（T135 の紙の上で入れる所が受ける） */
export const PAPER_FIELD_EVENT = "care72:paper-field";
export type PaperFieldDetail = { field: string; items: string[]; page: number | null; box: FieldBox | null };

const pct = (n: number) => `${(n * 100).toFixed(3)}%`;

/** 紙の頁の上に印（再考中・選んだ欄の枠）を置く。前の印は消す */
function placeMarks(cls: string, marks: ReadonlyArray<{ page: number | null; box: FieldBox | null; text?: string }>): void {
  for (const el of document.querySelectorAll(`[data-paper-root] .${cls}`)) el.remove();
  for (const m of marks) {
    if (m.page === null || !m.box) continue;
    const host = document.querySelector(`[data-paper-root] section[data-page="${m.page}"] .ov-img`);
    if (!host) continue;
    const el = document.createElement("div");
    el.className = cls;
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, { left: pct(m.box.x), top: pct(m.box.y), width: pct(m.box.w), height: pct(m.box.h) });
    if (m.text) el.dataset.label = m.text;
    host.appendChild(el);
  }
}

async function postJson<T>(body: Record<string, unknown>): Promise<T & { ok?: boolean; error?: string; label?: string }> {
  const res = await fetch("/api/forms/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json().catch(() => ({ ok: false, error: "invalid" }))) as T & { ok?: boolean; error?: string; label?: string };
}

/** 応答の中身を読まない操作（確認済・戻す） */
type Done = Record<string, unknown>;

const LEVELS: ReviewLevel[] = ["fix", "check", "note"];

export function PaperReview(props: PaperReviewProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [ai, setAi] = useState<ReviewFinding[] | null>(props.ai);
  const [redoing, setRedoing] = useState<ReviewFinding[]>([]);
  const [showNotes, setShowNotes] = useState(false);
  // 紙の版が変われば（直して描き直した）、サーバーの AI の見直しに戻す
  useEffect(() => setAi(props.ai), [props.hash, props.ai]);

  const all = useMemo(() => [...props.rule, ...(ai ?? [])], [props.rule, ai]);
  const count = reviewCount(all);
  const byLevel = (l: ReviewLevel) => all.filter((f) => f.level === l);

  // 再考中の印（紙の上）
  useEffect(() => {
    placeMarks(
      "rv-redo",
      redoing.map((f) => ({ page: f.page, box: f.box, text: REVIEW_UI.redoing })),
    );
  }, [redoing, props.hash]);

  const focus = useCallback((f: ReviewFinding) => {
    placeMarks("rv-focus", [{ page: f.page, box: f.box }]);
    const target =
      document.querySelector(`[data-paper-root] .rv-focus`) ??
      (f.items[0] ? document.querySelector(`[data-paper-root] [data-field="${CSS.escape(f.items[0])}"]`) : null) ??
      (f.page !== null ? document.querySelector(`[data-paper-root] section[data-page="${f.page}"]`) : null);
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    window.dispatchEvent(new CustomEvent<PaperFieldDetail>(PAPER_FIELD_EVENT, { detail: { field: f.field, items: f.items, page: f.page, box: f.box } }));
  }, []);

  async function runAi() {
    if (phase.kind === "busy") return;
    setOpen(true);
    let run: string | null = null;
    try {
      const { composePage, paperFontFamily } = await import("@/lib/forms/review-compose");
      for (let round = 1; ; round++) {
        setPhase({ kind: "busy", label: REVIEW_UI.drawing });
        const p = await postJson<{ hash: string; plan: ComposePlan }>({ op: "plan", person: props.person, form: props.form });
        if (!p.ok) throw new Error(p.label ?? REVIEW_UI.failed);
        await document.fonts.ready;
        const family = paperFontFamily(p.plan.typeface);
        const shots = [];
        for (const page of p.plan.pages) shots.push(await composePage(page, family));
        setPhase({ kind: "busy", label: REVIEW_UI.checking });
        const fd = new FormData();
        fd.append("meta", JSON.stringify({ person: props.person, form: props.form, hash: p.hash, run, round, paints: shots.map((s) => s.paints) }));
        shots.forEach((s, i) => fd.append("image", s.blob, `review-${i + 1}.jpg`));
        const res = await fetch("/api/forms/review", { method: "POST", body: fd });
        const r = (await res.json().catch(() => ({ ok: false }))) as {
          ok?: boolean;
          label?: string;
          error?: string;
          run?: string;
          ai?: ReviewFinding[];
          rule?: ReviewFinding[];
          redo?: Array<{ id: string }>;
        };
        if (!r.ok) throw new Error(r.error === "consent_refused" ? REVIEW_UI.refused : (r.label ?? REVIEW_UI.failed));
        run = r.run ?? run;
        setAi(r.ai ?? []);
        const redo = r.redo ?? [];
        if (redo.length === 0) break;
        // 直せそうな欄に「再考中」の印を付けて、その欄だけ読み直す
        const found = [...(r.rule ?? []), ...(r.ai ?? [])];
        setRedoing(found.filter((f) => redo.some((x) => x.id === f.field)));
        setPhase({ kind: "busy", label: REVIEW_UI.redoing });
        const rr = await postJson<{ fixed: string[] }>({ op: "redo", person: props.person, form: props.form, run, fields: redo });
        setRedoing([]);
        if (!rr.ok) throw new Error(rr.label ?? REVIEW_UI.failed);
        if (rr.fixed.length === 0) break;
        // 直した紙を出してから、もう一度照合
        router.refresh();
      }
      setPhase({ kind: "idle" });
    } catch (e) {
      setRedoing([]);
      setPhase({ kind: "error", label: e instanceof Error && e.message.length <= 12 ? e.message : REVIEW_UI.failed });
    }
    router.refresh();
  }

  async function confirm() {
    const r = await postJson<Done>({ op: "confirm", person: props.person, form: props.form, hash: props.hash, seen: all.map((f) => f.id) });
    if (!r.ok) setPhase({ kind: "error", label: r.label ?? REVIEW_UI.failed });
    router.refresh();
  }

  async function undo(field: string) {
    const r = await postJson<Done>({ op: "undo", person: props.person, form: props.form, field });
    if (!r.ok) setPhase({ kind: "error", label: r.label ?? REVIEW_UI.failed });
    router.refresh();
  }

  const busy = phase.kind === "busy";
  return (
    <>
      <Button
        kind="quiet"
        size="sm"
        icon={OpenIcon}
        aria-expanded={open}
        aria-controls="paper-review"
        onClick={() => setOpen((v) => !v)}
        className={`-mx-2 ${open ? "[&>svg]:rotate-180" : ""}`}
        data-review-count={count}
      >
        {count > 0 ? (
          <StateTag tone="check">
            {REVIEW_UI.head} <span className="tabular-nums">{count}</span>
          </StateTag>
        ) : (
          <span className="text-sm">
            {REVIEW_UI.head} <span className="font-bold tabular-nums">0</span>
          </span>
        )}
        {props.confirmed && <span className="text-xs text-state-ok">{REVIEW_UI.confirm}</span>}
      </Button>
      <div id="paper-review" hidden={!open} className="order-last grid basis-full gap-2 rounded-lg bg-panel px-3 py-2 text-sm" data-review-list>
        <div className="flex flex-wrap items-center gap-2">
          <Button kind="plain" size="sm" icon={ReviewIcon} onClick={runAi} disabled={busy || !props.canAi} data-review-ai>
            {REVIEW_UI.ai}
          </Button>
          <Button kind="main" size="sm" icon={SaveIcon} onClick={confirm} disabled={busy || props.confirmed !== null} data-review-confirm>
            {REVIEW_UI.confirm}
          </Button>
          {busy && (
            <span className="text-xs text-muted" role="status" data-review-phase>
              {phase.label}
            </span>
          )}
          {phase.kind === "error" && (
            <span className="text-xs text-state-urgent" role="alert">
              {phase.label}
            </span>
          )}
          {!props.canAi && <span className="text-xs text-muted">{REVIEW_UI.refused}</span>}
          {ai === null && props.stale && (
            <span className="text-xs text-muted" data-review-stale>
              AI {REVIEW_UI.stale}
            </span>
          )}
          {props.confirmed && (
            <span className="ml-auto text-xs text-muted">
              {REVIEW_UI.confirm} {props.confirmed.by ?? ""} {props.confirmed.at.slice(5, 16).replace("T", " ")}
            </span>
          )}
        </div>
        {LEVELS.map((level) => {
          const items = byLevel(level);
          if (items.length === 0) return null;
          const folded = level === "note" && !showNotes;
          return (
            <section key={level} data-review-level={level}>
              <h3 className="flex items-center gap-2 text-xs text-muted">
                {REVIEW_LEVEL_LABELS[level]} <span className="font-bold text-ink tabular-nums">{items.length}</span>
                {level === "note" && (
                  <Button kind="quiet" size="sm" icon={OpenIcon} aria-expanded={showNotes} onClick={() => setShowNotes((v) => !v)} className={showNotes ? "[&>svg]:rotate-180" : ""}>
                    {showNotes ? "畳む" : "開く"}
                  </Button>
                )}
              </h3>
              {!folded && (
                <ul className="grid">
                  {items.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        className="grid w-full grid-cols-[4.5rem_minmax(0,12rem)_minmax(0,1fr)_auto] items-baseline gap-x-3 rounded px-1 py-0.5 text-left"
                        data-press=""
                        onClick={() => focus(f)}
                        data-review-item={f.id}
                      >
                        <span className={level === "fix" ? "font-bold" : ""}>{REVIEW_LABELS[f.kind]}</span>
                        <span className="truncate">{f.label}</span>
                        <span className="truncate text-xs text-muted">{f.why}</span>
                        <span className="flex items-center gap-1">
                          {f.by === "ai" && <AiMark small />}
                          {redoing.some((x) => x.field === f.field) && <span className="text-xs font-bold">{REVIEW_UI.redoing}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {props.fixes.length > 0 && (
          <section data-review-fixes>
            <h3 className="flex items-center gap-2 text-xs text-muted">
              {REVIEW_UI.fixed} <span className="font-bold text-ink tabular-nums">{props.fixes.length}</span> <AiMark />
            </h3>
            <ul className="grid">
              {props.fixes.map((f) => (
                <li key={f.field} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-x-3 px-1 py-0.5">
                  <span className="truncate">{f.label}</span>
                  <span className="truncate text-xs text-muted">{f.reason}</span>
                  <Button kind="plain" size="sm" icon={RestoreIcon} onClick={() => undo(f.field)} disabled={busy}>
                    {REVIEW_UI.undo}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

/** 印刷の横の一言（確認済でないとき。止めはしない） */
export function ReviewPrintNote({ confirmed }: { confirmed: boolean }) {
  if (confirmed) return null;
  return (
    <span className="text-xs" data-review-print-note>
      <StateTag tone="check">{REVIEW_UI.unconfirmed}</StateTag>
    </span>
  );
}
