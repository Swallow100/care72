"use client";

// 録音のまとめ（T69b）。担当一覧の行の詳細（RowDetail）の信号ごとに、分類の欄の上に置く。
// 「まとめ」（Claude の言い換え。AI の印）と「本人の言葉」（文字起こしをそのまま）を左右に並べる（375 では上下）。まとめだけを出さない。
// ケアマネは「修正」で文を直せる（人の文になり AI の印が外れる。経過に「まとめ修正」）。まとめが無いときは「なし」と「生成」（もう一度 Claude、待ち 20 秒）。
// 色は付けない。まとめは色と連絡の順に使わない（lib/triage の入力に無い）。形は lib/classify/view.ts の summaryOf。

import { useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { CLASSIFY_ERROR_LABELS, SUMMARY_EDIT_MAX, SUMMARY_LABELS } from "@/lib/classify/labels";
import type { SignalSummary } from "@/lib/classify/view";

export type SummaryProps = {
  signalId: string;
  /** lib/classify/view.ts の summaryOf で作った物 */
  summary: SignalSummary;
  /** 本人の言葉（文字起こしをそのまま）。無ければ出さない（並べる元が無いまとめは出さない） */
  transcript: string | null;
  /** 直す口と「生成」を出す（ケアマネの役だけ。API もケアマネ以外は 403） */
  editable?: boolean;
  /** 面の中の区分（地が panel2）に置くときは true */
  inset?: boolean;
};

type Busy = "idle" | "saving" | "making" | "failed";

export function Summary({ signalId, summary: given, transcript, editable = false, inset = false }: SummaryProps) {
  const [view, setView] = useState<SignalSummary>(given);
  // 一覧が読み直されて新しい形が来たら、それに合わせる
  const givenKey = JSON.stringify(given);
  const [seenKey, setSeenKey] = useState(givenKey);
  if (givenKey !== seenKey) {
    setSeenKey(givenKey);
    setView(given);
  }
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  if (!transcript) return null;

  const post = async (body: object, kind: "saving" | "making") => {
    setBusy(kind);
    try {
      const res = await fetch(`/api/signals/${encodeURIComponent(signalId)}/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; view?: SignalSummary } | null;
      if (!res.ok || !json?.ok || !json.view) {
        setBusy("failed");
        return;
      }
      setView(json.view);
      setEditing(false);
      setBusy("idle");
    } catch {
      setBusy("failed");
    }
  };

  const plain = inset ? "plainIn" : "plain";
  const working = busy === "saving" || busy === "making";

  return (
    <div className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-2" data-summary={signalId} data-summary-by={view.by ?? ""}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-xs text-muted">{SUMMARY_LABELS.title}</span>
          {view.by === "ai" && <AiMark />}
          {view.by === "human" && <span className="text-xs text-muted">{SUMMARY_LABELS.edited}</span>}
          {busy === "failed" && <span className="text-xs font-bold text-danger">{SUMMARY_LABELS.failed}</span>}
          {editable && !editing && view.text !== null && (
            <Button
              size="sm"
              kind={plain}
              className="ml-auto"
              disabled={working}
              onClick={() => {
                setDraft(view.text ?? "");
                setBusy("idle");
                setEditing(true);
              }}
            >
              {SUMMARY_LABELS.edit}
            </Button>
          )}
          {editable && view.text === null && (
            <Button size="sm" kind="main" className="ml-auto" disabled={working} onClick={() => post({}, "making")}>
              {busy === "making" ? SUMMARY_LABELS.making : SUMMARY_LABELS.make}
            </Button>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-1">
            <textarea
              className={`block w-full resize-y rounded px-2 py-1 text-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${inset ? "bg-panel" : "bg-panel2"}`}
              rows={2}
              value={draft}
              maxLength={SUMMARY_EDIT_MAX}
              aria-label={SUMMARY_LABELS.title}
              disabled={working}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex gap-1">
              <Button size="sm" kind="main" disabled={working || !draft.trim()} onClick={() => post({ text: draft.trim() }, "saving")}>
                {busy === "saving" ? SUMMARY_LABELS.saving : SUMMARY_LABELS.save}
              </Button>
              <Button size="sm" kind="quiet" disabled={working} onClick={() => setEditing(false)}>
                {SUMMARY_LABELS.cancel}
              </Button>
            </div>
          </div>
        ) : view.text !== null ? (
          <p className="mt-0.5 font-bold" data-summary-text>
            {view.text}
          </p>
        ) : (
          <p className="mt-0.5 text-muted" data-summary-text="none">
            {SUMMARY_LABELS.none}
            {view.error && view.error !== "no_text" ? `（${CLASSIFY_ERROR_LABELS[view.error]}）` : ""}
          </p>
        )}
      </div>
      <div className="min-w-0">
        <span className="text-xs text-muted">{SUMMARY_LABELS.words}</span>
        <p className="mt-0.5" data-summary-words>
          「{transcript}」
        </p>
      </div>
    </div>
  );
}
