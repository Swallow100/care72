"use client";

// 入れる欄の「問い」: 空欄から次の 1 問（問いの文は定型。Claude は作らない）。会話の流れ（Intake.tsx）の最後の吹き出しに出す。
// 1 問で分かるように、何を聞くか（大きく）・なぜ要るか・答えの例（小さく）を並べる（T45）。
// 答えは選択肢・数字・文字で、そのまま保存する（手の入力）。決まった形の無い問いは文で答えて抽出（AI）。
// 「不明」「無回答」は空欄の理由として残し、「次回」はこの回は飛ばして未聴取として残す（どれも計画に「未確認」）。
// 選ぶ問い（1 つ・いくつでも・夜間支援）には補足の文字の欄（T150）。保存するボタンのすぐ上に置き、選んだ値と一緒に保存する
// （1 つ選ぶ問いは今どおり押すとすぐ保存なので、欄は選択肢の上。打ってから押す）。補足だけでは保存しない。行き先は lib/intake/answer.ts の noteChange。

import { useState } from "react";
import { DeclinedIcon, LaterIcon, SaveIcon, UnknownIcon } from "@/components/ui/Icon";
import { SplitIcon } from "./icons";
import type { PendingStatus } from "@/lib/db/types";
import { CLOCK_UNIT_LABELS, INTAKE_LABELS, PENDING_STATUS_LABELS, SECTION_LABELS } from "@/lib/labels";
import { answerChanges, NOTE_MAX, type AnswerInput } from "@/lib/intake/answer";
import { intakeField } from "@/lib/intake/fields";
import type { Question } from "@/lib/intake/ask";
import type { IntakeChange } from "@/lib/intake/changes";
// 問いは面の中の灰色の吹き出しに置くので、欄とボタンは白（_IN）
import { BTN_IN as BTN, BTN_MAIN, CHECK, INPUT_IN as INPUT } from "./intake-ui";

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
  if (!question) return null;
  // 問いが変わったら答えの入力を空にする（key）
  return <QuestionBody key={question.key} q={question} left={left} busy={busy} aiReady={aiReady} onAnswer={onAnswer} onSkip={onSkip} onFree={onFree} />;
}

/** 問いの文: 何を聞くか（大きく）・なぜ要るか・答えの例。会話の流れの答えた問いにも同じ形で出す */
export function QuestionText({ q }: { q: Pick<Question, "text" | "why" | "example"> }) {
  return (
    <div className="space-y-0.5">
      {/* text-base は使わない（地の色と重なる。app/globals.css） */}
      <p className="text-[15px] leading-snug font-bold">{q.text}</p>
      {q.why && <p className="text-xs leading-snug">{q.why}</p>}
      {q.example && <p className="text-xs leading-snug text-muted">{q.example}</p>}
    </div>
  );
}

/** 電話の欄（ai: false の組織電話など。T117） */
const telField = (a: Question["answer"]) => a.kind === "text" && intakeField(a.field)?.tel === true;

function QuestionBody({ q, left, busy, aiReady, onAnswer, onSkip, onFree }: Omit<Props, "question"> & { q: Question }) {
  // 初めの値は経路地図の見込みの分（T117。人が確かめて保存する）
  const [value, setValue] = useState(q.answer.kind === "int" && q.answer.suggest != null ? String(q.answer.suggest) : "");
  const [picked, setPicked] = useState<string[]>([]);
  // 選ぶ問いの補足（T150）
  const [note, setNote] = useState("");
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
        <span className="text-xs font-bold">{INTAKE_LABELS.ask}</span>
        <span className="text-xs text-muted">
          {SECTION_LABELS[q.section]} {q.label}
        </span>
        <span className="ml-auto text-xs text-muted tabular-nums" data-intake="left">
          {INTAKE_LABELS.left} {left} {INTAKE_LABELS.leftUnit}
        </span>
      </div>
      <QuestionText q={q} />

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
            <NoteInput label={q.label} value={note} onChange={setNote} disabled={busy} />
            <button type="button" className={BTN_MAIN} data-press="overlay" aria-label={`${q.label} ${INTAKE_LABELS.save}`} disabled={busy || picked.length === 0} onClick={() => submit({ kind: "choice", values: picked, note })}>
              <SaveIcon aria-hidden className="size-3.5 shrink-0" />
              {INTAKE_LABELS.save}
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <NoteInput label={q.label} value={note} onChange={setNote} disabled={busy} />
            <div className="flex flex-wrap gap-1">
              {a.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`${BTN} text-sm`}
                  data-press
                  data-choice={o.value}
                  disabled={busy}
                  onClick={() => submit({ kind: "choice", values: [o.value], note })}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}

      {(a.kind === "text" || a.kind === "list" || a.kind === "int" || a.kind === "clock" || a.kind === "medtext" || a.kind === "contact") && (
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
            inputMode={a.kind === "int" || a.kind === "clock" ? "decimal" : (a.kind === "contact" && a.part === "mobile") || telField(a) ? "tel" : undefined}
            aria-label={q.label}
          />
          {a.kind === "clock" && <span className="shrink-0 text-sm">{CLOCK_UNIT_LABELS[a.unit]}</span>}
          {a.kind === "int" && a.unit && <span className="shrink-0 text-sm">{a.unit}</span>}
          <button type="submit" className={`${BTN_MAIN} shrink-0`} data-press="overlay" aria-label={`${q.label} ${INTAKE_LABELS.save}`} disabled={busy || value.trim() === ""}>
            <SaveIcon aria-hidden className="size-3.5 shrink-0" />
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
          <NoteInput label={q.label} value={note} onChange={setNote} disabled={busy} />
          <div className="flex gap-1">
            <button type="button" className={BTN_MAIN} data-press="overlay" aria-label={`${q.label} ${INTAKE_LABELS.save}`} disabled={busy || picked.length === 0} onClick={() => submit({ kind: "night", contactIds: picked, note })}>
              <SaveIcon aria-hidden className="size-3.5 shrink-0" />
              {INTAKE_LABELS.save}
            </button>
            {a.contacts.length > 0 && (
              <button type="button" className={`${BTN} text-sm`} data-press disabled={busy} onClick={() => submit({ kind: "night", contactIds: [], note })}>
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
            <SplitIcon aria-hidden className="size-3.5 shrink-0" />
            {INTAKE_LABELS.split}
          </button>
        </form>
      )}

      {bad && <p className="text-xs font-bold text-danger">{INTAKE_LABELS.invalid}</p>}

      <div className="flex gap-1 pt-0.5">
        <button type="button" className={BTN} data-press disabled={busy} onClick={() => pending("unknown")}>
          <UnknownIcon aria-hidden className="size-3.5 shrink-0" />
          {PENDING_STATUS_LABELS.unknown}
        </button>
        <button type="button" className={BTN} data-press disabled={busy} onClick={() => pending("declined")}>
          <DeclinedIcon aria-hidden className="size-3.5 shrink-0" />
          {PENDING_STATUS_LABELS.declined}
        </button>
        <button type="button" className={BTN} data-press disabled={busy} onClick={() => onSkip(q)}>
          <LaterIcon aria-hidden className="size-3.5 shrink-0" />
          {INTAKE_LABELS.next}
        </button>
      </div>
    </div>
  );
}

/**
 * 選ぶ問いの補足の文字の欄（T150）。1 行で、欄の名前は読み上げにも渡す。Enter では保存しない（選ぶのはボタン）。
 * 打った文は選んだ値と一緒に保存され、手段・支援内容・世帯は書き足しの欄へ、ほかは特記へ（lib/intake/answer.ts）
 */
function NoteInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label className="flex items-center gap-1.5" data-intake="note">
      <span className="shrink-0 text-xs text-muted">{INTAKE_LABELS.supplement}</span>
      <input
        className={INPUT}
        value={value}
        maxLength={NOTE_MAX}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        disabled={disabled}
        aria-label={`${label} ${INTAKE_LABELS.supplement}`}
      />
    </label>
  );
}
