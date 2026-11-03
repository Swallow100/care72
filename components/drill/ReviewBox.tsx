"use client";

// 訓練の講評（docs/tasks/T22.md）。言葉は Opus が 1 訓練に 1 回だけ作る（lib/drill/review.ts）。数字は機械（ScorePanel）。
// - 鍵がある（canReview）のにまだ無ければ、開いたときに 1 回だけ作る（POST /api/drill/<id>/review）。作った物は drills.score に残り、
//   2 回目からはそれを出す。鍵が無ければ呼ばずに「講評なし」と理由「未設定」（数字だけ）
// - 作成中（ほかの画面が作っている）は 10 秒ごとに読み直す。失敗は理由と再作成
// - AI の印を付け、ケアマネが直せる（編集 → 保存。AI の元は消さずに別に残す）。直した物には「修正済」
// - 根拠は出典の登録簿の題名と発行元だけ（lib/sources）。確認前の出典は「未確認」
// 色は出典の確認の印だけ。押したときは灰色だけ（Button の data-press）。

import { useCallback, useEffect, useRef, useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { CloseIcon, EditIcon, RetryIcon, SaveIcon } from "@/components/ui/Icon";
import { Loader72 } from "@/components/ui/Loader72";
import { LABEL, PanelHead } from "@/components/ui/Panel";
import { Mark, StateText } from "@/components/ui/Tag";
import { BASIS_LABEL } from "@/lib/drill/labels";
import type { StoredReview } from "@/lib/drill/record";
import type { ReviewBody } from "@/lib/drill/review";
import { REVIEW_ERROR_LABELS, REVIEW_KIND_LABELS, REVIEW_UI } from "@/lib/drill/score-labels";
import { checkMark, isSourceId, sourceById } from "@/lib/sources";

type Shown = ReviewBody & { edited: boolean; model: string };

type View =
  | { kind: "none"; reason: string }
  | { kind: "creating" }
  | { kind: "failed"; reason: string }
  | { kind: "done"; shown: Shown };

/** 画面と紙面に出す講評（lib/drill/record.ts の shownReview と同じ。client の束に D1 の道を入れないよう写した） */
function shownOf(r: StoredReview | null): Shown | null {
  if (!r || r.state !== "done") return null;
  return r.edited ? { ...r.edited, edited: true, model: r.ai.model } : { ...r.ai, edited: false };
}

function viewOf(r: StoredReview | null, canReview: boolean): View {
  if (!r) return canReview ? { kind: "creating" } : { kind: "none", reason: REVIEW_ERROR_LABELS.not_configured };
  if (r.state === "pending") return { kind: "creating" };
  if (r.state === "failed") return { kind: "failed", reason: REVIEW_ERROR_LABELS[r.error] ?? REVIEW_UI.failed };
  return { kind: "done", shown: shownOf(r)! };
}

type ApiAnswer = { ok: true; review: StoredReview | null } | { ok: false; error?: string; label?: string };

const POLL_MS = 10_000;

/**
 * 欄の行数を中身から（field-sizing の効かないブラウザでも中で送らない）。右の欄の幅（約 18 字）で折り返す数に 1 行の余り
 */
function rowsOf(text: string): number {
  const lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(Array.from(l).length / 18)), 0);
  return Math.max(2, lines + 1);
}

const TEXTAREA =
  "w-full min-w-0 resize-none rounded bg-panel2 px-2 py-1 text-sm leading-6 outline-none [field-sizing:content] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function ReviewBox({
  drillId,
  initial,
  canReview,
  names,
}: {
  drillId: string;
  initial: StoredReview | null;
  canReview: boolean;
  names: Readonly<Record<string, string>>;
}) {
  const [view, setView] = useState<View>(() => viewOf(initial, canReview));
  const [editing, setEditing] = useState<{ summary: string; findings: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const started = useRef(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const post = useCallback(
    async (body: unknown): Promise<ApiAnswer | null> => {
      try {
        const res = await fetch(`/api/drill/${encodeURIComponent(drillId)}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return (await res.json()) as ApiAnswer;
      } catch {
        return null;
      }
    },
    [drillId],
  );

  const create = useCallback(async () => {
    inFlight.current = true;
    setView({ kind: "creating" });
    const a = await post({});
    inFlight.current = false;
    if (!alive.current) return;
    if (!a) return setView({ kind: "failed", reason: REVIEW_UI.network });
    if (!a.ok) {
      if (a.error === "not_configured") return setView({ kind: "none", reason: REVIEW_ERROR_LABELS.not_configured });
      return setView({ kind: "failed", reason: a.label ?? REVIEW_UI.failed });
    }
    setView(viewOf(a.review, true));
  }, [post]);

  // まだ無ければ開いたときに 1 回だけ作る（開発の Strict Mode で 2 回走っても 1 回。サーバーも作成中で重ねない）
  useEffect(() => {
    if (started.current || initial !== null || !canReview) return;
    started.current = true;
    void create();
  }, [initial, canReview, create]);

  // 作成中（ほかの画面が作っている）は読み直す。自分の POST の返事を待つ間は読み直さない
  useEffect(() => {
    if (view.kind !== "creating" || inFlight.current) return;
    const t = window.setTimeout(() => void create(), POLL_MS);
    return () => window.clearTimeout(t);
  }, [view, create]);

  const startEdit = () => {
    if (view.kind !== "done") return;
    setSaveError(null);
    setEditing({ summary: view.shown.summary, findings: view.shown.findings.map((f) => f.text) });
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    const a = await post({ edit: { summary: editing.summary, findings: editing.findings.map((text) => ({ text })) } });
    setSaving(false);
    if (!a) return setSaveError(REVIEW_UI.network);
    if (!a.ok) return setSaveError(a.label ?? REVIEW_UI.failed);
    setEditing(null);
    setView(viewOf(a.review, canReview));
  };

  const head = (
    <PanelHead
      as="h3"
      id={`review-${drillId}`}
      title={REVIEW_UI.review}
      sub={
        <span className="flex items-center gap-1.5 text-xs text-muted">
          {view.kind === "done" && <AiMark title={view.shown.edited ? "AI（Opus）の講評をケアマネが修正" : "AI（Opus）の講評。ケアマネが確認して直せる"} />}
          {view.kind === "done" && view.shown.edited && <span data-review-edited>{REVIEW_UI.edited}</span>}
        </span>
      }
      actions={
        view.kind === "done" && !editing ? (
          <Button kind="plain" size="sm" icon={EditIcon} onClick={startEdit} data-review-action="edit">
            {REVIEW_UI.edit}
          </Button>
        ) : view.kind === "failed" && canReview ? (
          <Button kind="plain" size="sm" icon={RetryIcon} onClick={() => void create()} data-review-action="retry">
            {REVIEW_UI.retry}
          </Button>
        ) : null
      }
    />
  );

  return (
    <section aria-labelledby={`review-${drillId}`} className="space-y-1.5" data-review={view.kind}>
      {head}
      {view.kind === "none" && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-bold" data-review-none>
            {REVIEW_UI.none}
          </span>
          <span className={LABEL}>{view.reason}</span>
        </p>
      )}
      {/* 講評を作っている間は AI の待ちの印（T44） */}
      {view.kind === "creating" && <Loader72 label={REVIEW_UI.creating} size={16} className="text-sm text-muted" />}
      {view.kind === "failed" && (
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-bold">{REVIEW_UI.failed}</span>
          <span className={LABEL}>{view.reason}</span>
        </p>
      )}
      {view.kind === "done" && !editing && <ReviewText shown={view.shown} names={names} />}
      {view.kind === "done" && editing && (
        <div className="space-y-2" data-review-form>
          <label className="block">
            <span className={LABEL}>{REVIEW_UI.summary}</span>
            <textarea
              className={TEXTAREA}
              rows={rowsOf(editing.summary)}
              value={editing.summary}
              onChange={(e) => setEditing({ ...editing, summary: e.target.value })}
            />
          </label>
          {view.shown.findings.map((f, i) => (
            <label key={i} className="block">
              <span className={`${LABEL} flex flex-wrap gap-x-1.5`}>
                <span>{REVIEW_KIND_LABELS[f.kind]}</span>
                <span>{f.person ? (names[f.person] ?? f.person) : REVIEW_UI.whole}</span>
              </span>
              <textarea
                className={TEXTAREA}
                rows={rowsOf(editing.findings[i] ?? "")}
                value={editing.findings[i] ?? ""}
                onChange={(e) => setEditing({ ...editing, findings: editing.findings.map((t, j) => (j === i ? e.target.value : t)) })}
              />
            </label>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button kind="main" size="sm" icon={SaveIcon} onClick={() => void save()} disabled={saving} data-review-action="save">
              {REVIEW_UI.save}
            </Button>
            <Button kind="quiet" size="sm" icon={CloseIcon} onClick={() => setEditing(null)} disabled={saving}>
              {REVIEW_UI.cancel}
            </Button>
            {saveError && <span className="text-sm font-bold text-danger">{saveError}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

/** 講評の文（総評と指摘）。根拠は登録簿の物だけ */
export function ReviewText({ shown, names }: { shown: ReviewBody; names: Readonly<Record<string, string>> }) {
  return (
    <div className="space-y-1.5 text-sm">
      {shown.summary && (
        <p className="leading-6" data-review-summary>
          {shown.summary}
        </p>
      )}
      {shown.findings.length > 0 && (
        <ul className="space-y-1">
          {shown.findings.map((f, i) => (
            <li key={i} className="rounded bg-panel2 px-2 py-1.5" data-finding={f.kind}>
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <Mark inPanel2>{REVIEW_KIND_LABELS[f.kind]}</Mark>
                <span className="font-bold">{f.person ? (names[f.person] ?? f.person) : REVIEW_UI.whole}</span>
              </div>
              <p className="mt-0.5 leading-6">{f.text}</p>
              {f.basis && isSourceId(f.basis) && <Basis id={f.basis} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Basis({ id }: { id: string }) {
  const s = sourceById(id);
  const mark = checkMark(id);
  return (
    <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs" data-basis={id}>
      <span className="text-muted">{BASIS_LABEL}</span>
      <a href={s.url} target="_blank" rel="noreferrer" title={s.title} className="-mx-0.5 rounded px-0.5 text-accent underline underline-offset-2" data-press>
        {s.publisher} {s.year}
      </a>
      {mark === "未確認" && <StateText tone="check">{mark}</StateText>}
    </p>
  );
}
