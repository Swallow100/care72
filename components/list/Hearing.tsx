"use client";

// 赤のあとの聞き取り（T49）の欄。担当一覧の行の詳細（RowDetail）の信号ごとに置く。
// 欄ごとに、本人・家族が押した答え（印なし。声の言葉の一致で取れた物は「声」）と、Claude の聞き取りメモ（文字起こしから写しただけ。AI の印）を
// 同じ表に出す。ケアマネは「修正」で欄の文を直せる（直した欄は人の値になり AI の印が外れる。経過に残る）。
// 色は付けない。聞き取りは色と連絡の順に使わない（lib/triage の入力に無い）。形は lib/signals/hearing.ts の hearingViewOf。

import { useState } from "react";
import { AiMark } from "@/components/person/parts";
import { BTN, BTN_IN, BTN_MAIN } from "@/components/person/intake-ui";
import { HEARING_LABELS } from "@/lib/labels";
import { hearingViewOf, MEMO_TEXT_MAX, type HearingRow, type HearingSource } from "@/lib/signals/hearing";
import type { HearingField } from "@/lib/signals/questions";

export type HearingProps = {
  signalId: string;
  /** 信号の行の answers・ai_memo・memo の列 */
  source: HearingSource;
  /** 直す口を出す（ケアマネの役だけ。API もケアマネ以外は 403） */
  editable?: boolean;
  /** 面の中の区分（地が panel2）に置くときは true */
  inset?: boolean;
};

type SaveState = "idle" | "saving" | "failed";

export function Hearing({ signalId, source, editable = false, inset = false }: HearingProps) {
  const [memo, setMemo] = useState<string | null | undefined>(source.memo);
  // 一覧が読み直されて新しい行が来たら、それに合わせる
  const [seen, setSeen] = useState(source.memo);
  if (source.memo !== seen) {
    setSeen(source.memo);
    setMemo(source.memo);
  }
  const [editing, setEditing] = useState<HearingField | null>(null);
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState<SaveState>("idle");

  const view = hearingViewOf({ ...source, memo });
  if (!view) return null;
  const btn = inset ? BTN_IN : BTN;

  const start = (r: HearingRow) => {
    setDraft(r.text ?? "");
    setSave("idle");
    setEditing(r.field);
  };

  const submit = async (field: HearingField, text: string | null) => {
    setSave("saving");
    try {
      const res = await fetch(`/api/signals/${encodeURIComponent(signalId)}/memo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, text }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; memo?: string } | null;
      if (!res.ok || !json?.ok || typeof json.memo !== "string") {
        setSave("failed");
        return;
      }
      setMemo(json.memo);
      setEditing(null);
      setSave("idle");
    } catch {
      setSave("failed");
    }
  };

  return (
    <div className="space-y-0.5 text-sm" data-hearing={signalId}>
      <span className="text-xs text-muted">{HEARING_LABELS.title}</span>
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
        {view.rows.map((r) => (
          <div key={r.field} className="contents" data-hearing-field={r.field}>
            <dt className="text-xs text-muted">{r.label}</dt>
            <dd className="min-w-0">
              {editing === r.field ? (
                <span className="flex flex-wrap items-center gap-1">
                  <input
                    className={`min-w-0 flex-1 rounded px-2 py-0.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-accent ${inset ? "bg-panel" : "bg-panel2"}`}
                    value={draft}
                    maxLength={MEMO_TEXT_MAX}
                    aria-label={r.label}
                    disabled={save === "saving"}
                    onChange={(e) => setDraft(e.target.value)}
                  />
                  {save === "failed" && <span className="text-xs font-bold text-danger">{HEARING_LABELS.failed}</span>}
                  <button
                    type="button"
                    className={BTN_MAIN}
                    data-press="overlay"
                    disabled={save === "saving"}
                    onClick={() => submit(r.field, draft.trim() || null)}
                  >
                    {save === "saving" ? HEARING_LABELS.saving : HEARING_LABELS.save}
                  </button>
                  <button type="button" className={btn} data-press disabled={save === "saving"} onClick={() => submit(r.field, null)}>
                    {HEARING_LABELS.clear}
                  </button>
                  <button type="button" className={btn} data-press disabled={save === "saving"} onClick={() => setEditing(null)}>
                    {HEARING_LABELS.cancel}
                  </button>
                </span>
              ) : (
                <span className="flex flex-wrap items-baseline gap-x-2">
                  {r.answers.map((a) => (
                    <span key={`${a.question}-${a.choice}`} data-answer={a.via}>
                      <span className="text-xs text-muted">{a.question}</span> {a.choice}
                      {a.via === "voice" && <span className="ml-0.5 text-xs text-muted">（{HEARING_LABELS.voice}）</span>}
                    </span>
                  ))}
                  {r.text !== null && (
                    <span className="flex items-baseline gap-1" data-memo={r.textBy ?? ""}>
                      {r.textBy === "ai" && <AiMark small />}
                      <span>「{r.text}」</span>
                    </span>
                  )}
                  {r.textBy === "human" && <span className="text-xs text-muted">{HEARING_LABELS.edited}</span>}
                  {editable && (
                    <button type="button" className={`ml-auto ${btn}`} data-press onClick={() => start(r)}>
                      {HEARING_LABELS.edit}
                    </button>
                  )}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
