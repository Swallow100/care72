"use client";

// アンケートの答えの頁の中身（docs/tasks/T42.md）。案内の文 → 問い → 送る → お礼。
// 本人・家族のスマホと同じ作り: 大きな字、縦 1 本、選ぶ問いは大きなボタン、送るは操作の色 1 つ。
// 選んだ印は操作の色の枠と太字と印（薄い下地は敷かない）。答えたくない問いは空けてよいので、選んだ物をもう一度押すと外れる。
// 問いと選択肢の言葉は tools/survey/questions.ts（紙と同じ並び・記号）。案内の文は lib/survey/text.ts。
// 見えない欄（honeypot）は画面の外に置き、読み上げにも出さない（人は埋めない。ボットが埋めたら送信は捨てられる）。
// Turnstile は鍵があるときだけ（site key を受け取ったときだけ部品を読み込む）。

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { ChosenIcon, SendIcon } from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import { FREE_MAX, HONEYPOT_FIELD } from "@/lib/survey/form";
import { surveySubmitPath } from "@/lib/survey/paths";
import {
  SURVEY_INVITATION,
  SURVEY_LABELS,
  SURVEY_PLAN_NOTE,
  SURVEY_SUPPORTER_NOTE,
  SURVEY_THANKS,
  SURVEY_TITLE,
} from "@/lib/survey/text";
import { TURNSTILE_SCRIPT } from "@/lib/survey/turnstile";
import { CHOICE_QUESTIONS, FREE_QUESTIONS, type ChoiceKey, type FreeKey } from "@/tools/survey/questions";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** 問いの並び（紙と同じ）。あなたについて → 問 1〜7（問 4・問 7 の理由は記入欄）→ 引用の確認 */
type Item = { kind: "choice"; key: ChoiceKey } | { kind: "free"; key: FreeKey };
const ABOUT: Item[] = [
  { kind: "choice", key: "role" },
  { kind: "choice", key: "experience" },
];
const QUESTIONS: Item[] = [
  { kind: "choice", key: "q1" },
  { kind: "choice", key: "q2" },
  { kind: "choice", key: "q3" },
  { kind: "free", key: "q4" },
  { kind: "choice", key: "q5" },
  { kind: "choice", key: "q6" },
  { kind: "choice", key: "q7" },
  { kind: "free", key: "q7reason" },
  { kind: "choice", key: "quote" },
];

const emptyChoices = (): Record<ChoiceKey, string[]> =>
  Object.fromEntries(CHOICE_QUESTIONS.map((q) => [q.key, []])) as unknown as Record<ChoiceKey, string[]>;

const PANEL = "rounded-lg bg-panel px-4 py-4";

export function SurveyForm({ token, turnstileSiteKey }: { token: string; turnstileSiteKey: string | null }) {
  const [choices, setChoices] = useState<Record<ChoiceKey, string[]>>(emptyChoices);
  const [free, setFree] = useState<Record<FreeKey, string>>({ q4: "", q7reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const trapRef = useRef<HTMLInputElement>(null);

  // Turnstile（鍵があるときだけ）
  const [scriptReady, setScriptReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  useEffect(() => {
    if (!turnstileSiteKey || !widgetRef.current) return;
    const api = window.turnstile;
    if (!api || widgetId.current) return;
    widgetId.current = api.render(widgetRef.current, {
      sitekey: turnstileSiteKey,
      language: "ja",
      callback: (t: string) => setTurnstileToken(t),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    });
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [turnstileSiteKey, scriptReady]);

  function toggle(key: ChoiceKey, code: string, multi: boolean) {
    setChoices((prev) => {
      const has = prev[key].includes(code);
      const next = multi ? (has ? prev[key].filter((c) => c !== code) : [...prev[key], code]) : has ? [] : [code];
      return { ...prev, [key]: next };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const answers: Record<string, string | string[]> = {};
    for (const q of CHOICE_QUESTIONS) {
      const codes = choices[q.key];
      if (codes.length) answers[q.key] = q.multi ? codes : codes[0];
    }
    for (const q of FREE_QUESTIONS) if (free[q.key].trim()) answers[q.key] = free[q.key];
    try {
      const res = await fetch(surveySubmitPath(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          [HONEYPOT_FIELD]: trapRef.current?.value ?? "",
          ...(turnstileSiteKey ? { turnstile: turnstileToken ?? "" } : {}),
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (res.ok && data?.ok) {
        setDone(true);
        window.scrollTo({ top: 0 });
      } else {
        setError(data?.label ?? SURVEY_LABELS.failed);
        // Turnstile の答えは 1 回きり。断られたら作り直す
        if (widgetId.current) {
          window.turnstile?.reset(widgetId.current);
          setTurnstileToken(null);
        }
      }
    } catch {
      setError(SURVEY_LABELS.failed);
    }
    setBusy(false);
  }

  if (done) {
    return (
      <section className={`${PANEL} space-y-3`} role="status" data-survey="sent">
        <h1 className="text-2xl font-bold">
          <StateText tone="ok">{SURVEY_LABELS.sent}</StateText>
        </h1>
        {SURVEY_THANKS.map((t) => (
          <p key={t} className="text-xl leading-relaxed">
            {t}
          </p>
        ))}
      </section>
    );
  }

  const waitingTurnstile = turnstileSiteKey !== null && !turnstileToken;

  return (
    <form onSubmit={submit} className="space-y-4" data-survey="form" noValidate>
      <section className={`${PANEL} space-y-2`} aria-labelledby="survey-title">
        <h1 id="survey-title" className="text-2xl font-bold">
          {SURVEY_TITLE}
        </h1>
        {SURVEY_INVITATION.map((t) => (
          <p key={t} className="text-lg leading-relaxed">
            {t}
          </p>
        ))}
      </section>

      <h2 className="px-1 pt-2 text-xl font-bold">{SURVEY_LABELS.about}</h2>
      {ABOUT.map((item) => (
        <Question key={item.key} item={item} choices={choices} free={free} onToggle={toggle} onText={(k, v) => setFree((p) => ({ ...p, [k]: v }))} />
      ))}

      <h2 className="px-1 pt-2 text-xl font-bold">{SURVEY_LABELS.questions}</h2>
      <p className="px-1 text-base text-muted">{SURVEY_PLAN_NOTE}</p>
      {QUESTIONS.map((item) => (
        <Question key={item.key} item={item} choices={choices} free={free} onToggle={toggle} onText={(k, v) => setFree((p) => ({ ...p, [k]: v }))} />
      ))}

      {/* 見えない欄。人には見えず、読み上げにも出ず、Tab でも止まらない。ボットが埋めたら送信は捨てられる */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          website
          <input ref={trapRef} type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      {turnstileSiteKey && (
        <>
          <Script src={TURNSTILE_SCRIPT} strategy="afterInteractive" onReady={() => setScriptReady(true)} />
          <div ref={widgetRef} className="min-h-[65px]" />
        </>
      )}

      <div className="space-y-2 pt-2">
        {error && (
          <p role="alert" className="px-1 text-lg font-bold text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || waitingTurnstile}
          className="relative flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-accent text-xl font-bold text-on-accent disabled:bg-panel2 disabled:text-muted"
          data-press="overlay"
        >
          <SendIcon aria-hidden className="size-6 shrink-0" />
          {busy ? SURVEY_LABELS.sending : SURVEY_LABELS.submit}
        </button>
      </div>
    </form>
  );
}

function Question({
  item,
  choices,
  free,
  onToggle,
  onText,
}: {
  item: Item;
  choices: Record<ChoiceKey, string[]>;
  free: Record<FreeKey, string>;
  onToggle: (key: ChoiceKey, code: string, multi: boolean) => void;
  onText: (key: FreeKey, value: string) => void;
}) {
  if (item.kind === "free") {
    const q = FREE_QUESTIONS.find((x) => x.key === item.key)!;
    const id = `survey-${q.key}`;
    const value = free[q.key];
    return (
      <section className={PANEL} data-question={q.key}>
        <label htmlFor={id} className="block text-xl leading-snug font-bold">
          {q.heading}
        </label>
        <textarea
          id={id}
          rows={3}
          maxLength={FREE_MAX}
          value={value}
          onChange={(e) => onText(q.key, e.target.value)}
          className="mt-3 block w-full resize-y rounded-lg bg-panel2 px-3 py-2 text-xl leading-relaxed text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent"
        />
        <p className="mt-1 text-right text-base text-muted">
          {value.length}/{FREE_MAX} {SURVEY_LABELS.chars}
        </p>
      </section>
    );
  }

  const q = CHOICE_QUESTIONS.find((x) => x.key === item.key)!;
  const chosen = choices[q.key];
  const titleId = `survey-${q.key}-title`;
  return (
    <section className={PANEL} data-question={q.key}>
      <div role={q.multi ? "group" : "radiogroup"} aria-labelledby={titleId}>
        <h3 id={titleId} className="text-xl leading-snug font-bold">
          {q.heading}
          {q.multi && <span className="ml-2 text-base font-normal text-muted">{SURVEY_LABELS.multi}</span>}
        </h3>
        <div className="mt-3 grid gap-2">
          {q.choices.map((c) => {
            const on = chosen.includes(c.code);
            return (
              <button
                key={c.code}
                type="button"
                role={q.multi ? "checkbox" : "radio"}
                aria-checked={on}
                onClick={() => onToggle(q.key, c.code, q.multi)}
                className={`flex min-h-14 w-full items-center gap-3 rounded-lg bg-panel2 px-4 py-2 text-left text-xl ${
                  on ? "font-bold outline-2 outline-accent" : ""
                }`}
                data-press
                data-choice={c.code}
              >
                {on ? (
                  <ChosenIcon aria-hidden className="size-7 shrink-0 text-accent" />
                ) : (
                  <span aria-hidden className={`size-7 shrink-0 border-2 border-muted ${q.multi ? "rounded" : "rounded-full"}`} />
                )}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
        {q.key === "q3" && <p className="mt-2 text-base text-muted">{SURVEY_SUPPORTER_NOTE}</p>}
      </div>
    </section>
  );
}
