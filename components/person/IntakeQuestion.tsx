"use client";

// 入れる欄の「質問」: 空欄から次の 1 問（問いの文は定型。Claude は作らない）。
// 答えは選択肢・数字・文字で、そのまま保存する（手の入力）。決まった形の無い問いは文で答えて抽出（AI）。
// 「不明」「無回答」は空欄の理由として残し、「次回」はこの回は飛ばして未聴取として残す（どれも計画に「未確認」）。

import { useState } from "react";
import type { PendingStatus } from "@/lib/db/types";
import { CLOCK_UNIT_LABELS, INTAKE_LABELS, PENDING_STATUS_LABELS, SECTION_LABELS } from "@/lib/labels";
import { answerChanges, type AnswerInput } from "@/lib/intake/answer";
import type { Question } from "@/lib/intake/ask";
import type { IntakeChange } from "@/lib/intake/changes";
import { BTN, BTN_MAIN, CHECK, INPUT } from "./intake-ui";

type Props = {
  question: Question | null;
  /** 残りの問いの数（この問いを含む） */
  left: number;
  busy: boolean;
  aiReady: boolean;
  onAnswer: (changes: IntakeChange[]) => void;
  onSkip: (q: Question) => void;
  onFree: (q: Question, text: string) => void;
};

export function IntakeQuestion({ question, left, busy, aiReady, onAnswer, onSkip, onFree }: Props) {
  if (!question) {
    return (
      <div data-intake="question">
        <h3 className="font-bold">{INTAKE_LABELS.question}</h3>
        <p className="text-muted">{INTAKE_LABELS.noQuestion}</p>
      </div>
    );
  }
  // 問いが変わったら答えの入力を空にする（key）
  return <QuestionBody key={question.key} q={question} left={left} busy={busy} aiReady={aiReady} onAnswer={onAnswer} onSkip={onSkip} onFree={onFree} />;
}

function QuestionBody({ q, left, busy, aiReady, onAnswer, onSkip, onFree }: Omit<Props, "question"> & { q: Question }) {
  const [value, setValue] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [bad, setBad] = useState(false);
  const submit = (input: AnswerInput) => {
    const changes = answerChanges(q, input);
    if (!changes) {
      setBad(true);
      return;
    }
    setBad(false);
    onAnswer(changes);
  };
  const pending = (status: PendingStatus) => submit({ kind: "pending", status });
  const a = q.answer;

  return (
    <div className="space-y-1.5" data-intake="question" data-key={q.key}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="font-bold">{INTAKE_LABELS.question}</h3>
        <span className="text-xs text-muted">{SECTION_LABELS[q.section]}</span>
        <span className="ml-auto text-xs text-muted tabular-nums">残り {left}</span>
      </div>
      <div>
        <div className="text-xs font-bold">{q.label}</div>
        {/* text-base は使わない（地の色と重なる。app/globals.css） */}
        <div className="text-[15px] leading-snug">{q.text}</div>
      </div>

      {a.kind === "choice" &&
        (a.multi ? (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {a.options.map((o) => (
                <label key={o.value} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    className={CHECK}
                    checked={picked.includes(o.value)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))}
                  />
                  {o.label}
                </label>
              ))}
            </div>
            <button type="button" className={BTN_MAIN} data-press="overlay" disabled={busy || picked.length === 0} onClick={() => submit({ kind: "choice", values: picked })}>
              {INTAKE_LABELS.save}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            {a.options.map((o) => (
              <button key={o.value} type="button" className={`${BTN} text-sm`} data-press disabled={busy} onClick={() => submit({ kind: "choice", values: [o.value] })}>
                {o.label}
              </button>
            ))}
          </div>
        ))}

      {(a.kind === "text" || a.kind === "list" || a.kind === "int" || a.kind === "clock" || a.kind === "medtext") && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ kind: "value", value });
          }}
        >
          <input
            className={INPUT}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={a.kind === "int" || a.kind === "clock" ? "decimal" : undefined}
            aria-label={q.label}
          />
          {a.kind === "clock" && <span className="shrink-0 text-sm">{CLOCK_UNIT_LABELS[a.unit]}</span>}
          {a.kind === "int" && a.unit && <span className="shrink-0 text-sm">{a.unit}</span>}
          <button type="submit" className={`${BTN_MAIN} shrink-0`} data-press="overlay" disabled={busy || value.trim() === ""}>
            {INTAKE_LABELS.save}
          </button>
        </form>
      )}

      {a.kind === "night" && (
        <div className="space-y-1">
          {a.contacts.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {a.contacts.map((c) => (
                <label key={c.id} className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    className={CHECK}
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-1">
            <button type="button" className={BTN_MAIN} data-press="overlay" disabled={busy || picked.length === 0} onClick={() => submit({ kind: "night", contactIds: picked })}>
              {INTAKE_LABELS.save}
            </button>
            {a.contacts.length > 0 && (
              <button type="button" className={`${BTN} text-sm`} data-press disabled={busy} onClick={() => submit({ kind: "night", contactIds: [] })}>
                なし
              </button>
            )}
          </div>
        </div>
      )}

      {a.kind === "free" && (
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onFree(q, value);
          }}
        >
          <textarea className={INPUT} rows={2} value={value} onChange={(e) => setValue(e.target.value)} aria-label={q.label} disabled={!aiReady} />
          <button type="submit" className={BTN_MAIN} data-press="overlay" disabled={busy || !aiReady || value.trim() === ""}>
            {INTAKE_LABELS.extract}
          </button>
        </form>
      )}

      {bad && <p className="text-xs font-bold text-danger">{INTAKE_LABELS.invalid}</p>}

      <div className="flex gap-1 pt-0.5">
        <button type="button" className={BTN} data-press disabled={busy} onClick={() => pending("unknown")}>
          {PENDING_STATUS_LABELS.unknown}
        </button>
        <button type="button" className={BTN} data-press disabled={busy} onClick={() => pending("declined")}>
          {PENDING_STATUS_LABELS.declined}
        </button>
        <button type="button" className={BTN} data-press disabled={busy} onClick={() => onSkip(q)}>
          {INTAKE_LABELS.next}
        </button>
      </div>
    </div>
  );
}
