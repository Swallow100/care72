"use client";

// アンケートの答えの頁の中身（docs/tasks/T42.md・T65.md）。案内の文 → 問い → 送る → お礼。
// 頁の並び: 自己紹介と事情 → 作っている機能（平時・訓練・災害のとき）→ お願いの理由 → 答えの扱い → 受付 → 問い。
// 本人・家族のスマホと同じ作り: 大きな字、縦 1 本、選ぶ問いは大きなボタン、送るは操作の色 1 つ。
// 選んだ印は操作の色の枠と太字と印（薄い下地は敷かない）。答えたくない問いは空けてよいので、選んだ物をもう一度押すと外れる。
// 「その他」を選んだときだけ、その他の内容の欄が開く（60 字）。問いと選択肢の言葉は tools/survey/questions.ts。案内の文は lib/survey/text.ts。
// 見えない欄（honeypot）は画面の外に置き、読み上げにも出さない（人は埋めない。ボットが埋めたら送信は捨てられる）。
// Turnstile は鍵があるときだけ（site key を受け取ったときだけ部品を読み込む）。
// 送れたら、この端末に印を残す（サーバーの cookie と、ここの localStorage）。同じ端末で開くと「回答済」。

import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import { ChosenIcon, SendIcon } from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import { FREE_MAX, HONEYPOT_FIELD, OTHER_MAX } from "@/lib/survey/form";
import { surveyDoneStorageKey, surveySubmitPath } from "@/lib/survey/paths";
import {
  SURVEY_DEADLINE_PARTS,
  SURVEY_DONE_TEXT,
  SURVEY_FEATURES,
  SURVEY_FEATURES_TITLE,
  SURVEY_HANDLING,
  SURVEY_HANDLING_TITLE,
  SURVEY_INTRO,
  SURVEY_LABELS,
  SURVEY_PLAN_NOTE,
  SURVEY_PURPOSE,
  SURVEY_THANKS,
  SURVEY_TITLE,
} from "@/lib/survey/text";
import { TURNSTILE_SCRIPT } from "@/lib/survey/turnstile";
import {
  CHOICE_QUESTIONS,
  FREE_QUESTIONS,
  TEXT_FIELDS,
  type ChoiceKey,
  type FreeKey,
  type TextKey,
} from "@/tools/survey/questions";

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

/** 問いの並び。あなたについて → 問 1〜9（問 5 は記入、問 9 の下に理由）→ ご意見 → 引用の確認 */
type Item = { kind: "choice"; key: ChoiceKey; follow?: FreeKey } | { kind: "free"; key: FreeKey };
const ABOUT: Item[] = [
  { kind: "choice", key: "role" },
  { kind: "choice", key: "experience" },
];
const QUESTIONS: Item[] = [
  { kind: "choice", key: "q1" },
  { kind: "choice", key: "q2" },
  { kind: "choice", key: "q3" },
  { kind: "choice", key: "q4" },
  { kind: "free", key: "q5" },
  { kind: "choice", key: "q6" },
  { kind: "choice", key: "q7" },
  { kind: "choice", key: "q8" },
  { kind: "choice", key: "q9", follow: "q9reason" },
  { kind: "free", key: "comment" },
  { kind: "choice", key: "quote" },
];

const emptyChoices = (): Record<ChoiceKey, string[]> =>
  Object.fromEntries(CHOICE_QUESTIONS.map((q) => [q.key, []])) as unknown as Record<ChoiceKey, string[]>;
const emptyTexts = (): Record<TextKey, string> =>
  Object.fromEntries(TEXT_FIELDS.map((f) => [f.key, ""])) as unknown as Record<TextKey, string>;

const PANEL = "rounded-lg bg-panel px-4 py-4";
const FIELD =
  "block w-full rounded-lg bg-panel2 px-3 py-2 text-xl leading-relaxed text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 見出しと 1 行だけの頁（受付終了・回答済） */
export function SurveyNotice({ state, heading, text }: { state: "closed" | "done"; heading: string; text: string }) {
  return (
    <section className={`${PANEL} space-y-3`} role="status" data-survey={state}>
      <h1 className="text-2xl font-bold">{heading}</h1>
      <p className="text-xl leading-relaxed">{text}</p>
    </section>
  );
}

function readDone(token: string): boolean {
  try {
    return window.localStorage.getItem(surveyDoneStorageKey(token)) === "1";
  } catch {
    return false;
  }
}

function markDone(token: string) {
  try {
    window.localStorage.setItem(surveyDoneStorageKey(token), "1");
  } catch {
    // 端末の保存が使えない（プライベートの窓など）。サーバーの cookie の印だけになる
  }
}

export function SurveyForm({ token, opened, turnstileSiteKey }: { token: string; opened: string; turnstileSiteKey: string | null }) {
  const [choices, setChoices] = useState<Record<ChoiceKey, string[]>>(emptyChoices);
  const [texts, setTexts] = useState<Record<TextKey, string>>(emptyTexts);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [answeredBefore, setAnsweredBefore] = useState(false);
  const trapRef = useRef<HTMLInputElement>(null);

  // cookie が消されていても、この端末の控えがあれば回答済（描いたあとに読む。サーバーの描画と食い違わないように）
  useEffect(() => {
    if (readDone(token)) setAnsweredBefore(true);
  }, [token]);

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
  const setText = (key: TextKey, value: string) => setTexts((p) => ({ ...p, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const answers: Record<string, string | string[]> = {};
    for (const q of CHOICE_QUESTIONS) {
      const codes = choices[q.key];
      if (codes.length) answers[q.key] = q.multi ? codes : codes[0];
      // その他の内容は、その他を選んでいるときだけ送る
      if (q.other && codes.includes(q.other.code) && texts[q.other.key].trim()) answers[q.other.key] = texts[q.other.key];
    }
    for (const q of FREE_QUESTIONS) if (texts[q.key].trim()) answers[q.key] = texts[q.key];
    try {
      const res = await fetch(surveySubmitPath(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers,
          opened,
          [HONEYPOT_FIELD]: trapRef.current?.value ?? "",
          ...(turnstileSiteKey ? { turnstile: turnstileToken ?? "" } : {}),
        }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; label?: string } | null;
      if (res.ok && data?.ok) {
        markDone(token);
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
  if (answeredBefore) return <SurveyNotice state="done" heading={SURVEY_LABELS.done} text={SURVEY_DONE_TEXT} />;

  const waitingTurnstile = turnstileSiteKey !== null && !turnstileToken;
  const questionProps = { choices, texts, onToggle: toggle, onText: setText };

  return (
    <form onSubmit={submit} className="space-y-4" data-survey="form" noValidate>
      <section className={`${PANEL} space-y-3`} aria-labelledby="survey-title">
        <h1 id="survey-title" className="text-2xl font-bold">
          {SURVEY_TITLE}
        </h1>
        {SURVEY_INTRO.map((t) => (
          <p key={t} className="text-lg leading-relaxed">
            {t}
          </p>
        ))}
      </section>

      <section className={`${PANEL} space-y-4`} aria-labelledby="survey-features" data-survey-part="features">
        <h2 id="survey-features" className="text-xl font-bold">
          {SURVEY_FEATURES_TITLE}
        </h2>
        {SURVEY_FEATURES.map((g) => (
          <div key={g.heading}>
            <h3 className="text-lg font-bold">{g.heading}</h3>
            <ul className="mt-1 list-disc space-y-1.5 pl-5 text-[1rem] leading-relaxed">
              {g.items.map((item) => (
                <li key={item}>
                  <FeatureItem text={item} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-lg leading-relaxed">{SURVEY_PURPOSE}</p>
      </section>

      <section className={`${PANEL} space-y-2`} aria-labelledby="survey-handling">
        <h2 id="survey-handling" className="text-xl font-bold">
          {SURVEY_HANDLING_TITLE}
        </h2>
        <ul className="list-disc space-y-1.5 pl-5 text-lg leading-relaxed">
          {SURVEY_HANDLING.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <p className="pt-1 text-lg leading-relaxed" data-survey-part="deadline">
          {SURVEY_DEADLINE_PARTS[0]}
          <strong>{SURVEY_DEADLINE_PARTS[1]}</strong>
          {SURVEY_DEADLINE_PARTS[2]}
        </p>
      </section>

      <h2 className="px-1 pt-2 text-xl font-bold">{SURVEY_LABELS.about}</h2>
      {ABOUT.map((item) => (
        <Question key={item.key} item={item} {...questionProps} />
      ))}

      <h2 className="px-1 pt-2 text-xl font-bold">{SURVEY_LABELS.questions}</h2>
      <p className="px-1 text-[1rem] text-muted">{SURVEY_PLAN_NOTE}</p>
      {QUESTIONS.map((item) => (
        <Question key={item.key} item={item} {...questionProps} />
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
          className="relative flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-accent-fill text-xl font-bold text-on-accent disabled:bg-panel disabled:text-muted"
          data-press="overlay"
        >
          <SendIcon aria-hidden className="size-6 shrink-0" />
          {busy ? SURVEY_LABELS.sending : SURVEY_LABELS.submit}
        </button>
      </div>
    </form>
  );
}

/** 「利用者の台帳: …」の頭（: まで）を太字に */
function FeatureItem({ text }: { text: string }) {
  const at = text.indexOf(": ");
  if (at < 0 || at > 12) return <>{text}</>;
  return (
    <>
      <strong>{text.slice(0, at + 1)}</strong>
      {text.slice(at + 1)}
    </>
  );
}

type QuestionProps = {
  item: Item;
  choices: Record<ChoiceKey, string[]>;
  texts: Record<TextKey, string>;
  onToggle: (key: ChoiceKey, code: string, multi: boolean) => void;
  onText: (key: TextKey, value: string) => void;
};

/** 記入欄（問 5・問 9 の理由・ご意見）。全部の問いが任意だが、書く手間のある記入欄にだけ「任意」を添える */
function FreeField({ fieldKey, label, value, onText, big }: { fieldKey: FreeKey; label: string; value: string; onText: QuestionProps["onText"]; big: boolean }) {
  const id = `survey-${fieldKey}`;
  return (
    <div data-question={fieldKey}>
      <label htmlFor={id} className={`block leading-snug font-bold ${big ? "text-xl" : "mt-4 text-lg"}`}>
        {label}
        {/* 「複数可」と同じ形（間は空白、1 語のまま） */}{" "}
        <span className="text-[1rem] font-normal whitespace-nowrap text-muted">{SURVEY_LABELS.optional}</span>
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={FREE_MAX}
        value={value}
        onChange={(e) => onText(fieldKey, e.target.value)}
        className={`mt-2 resize-y ${FIELD}`}
      />
      <p className="mt-1 text-right text-[1rem] text-muted">
        {value.length}/{FREE_MAX}
        {SURVEY_LABELS.chars}
      </p>
    </div>
  );
}

function Question({ item, choices, texts, onToggle, onText }: QuestionProps) {
  if (item.kind === "free") {
    const q = FREE_QUESTIONS.find((x) => x.key === item.key)!;
    return (
      <section className={PANEL}>
        <FreeField fieldKey={q.key} label={q.text} value={texts[q.key]} onText={onText} big />
      </section>
    );
  }

  const q = CHOICE_QUESTIONS.find((x) => x.key === item.key)!;
  const chosen = choices[q.key];
  const titleId = `survey-${q.key}-title`;
  const otherOpen = q.other !== undefined && chosen.includes(q.other.code);
  const follow = item.follow ? FREE_QUESTIONS.find((x) => x.key === item.follow) : undefined;
  return (
    <section className={PANEL} data-question={q.key}>
      <div role={q.multi ? "group" : "radiogroup"} aria-labelledby={titleId}>
        <h3 id={titleId} className="text-xl leading-snug font-bold">
          {q.text}
          {/* 「複数可」は 1 語のまま（375px で「複数／可」に割れない）。間は空白にして、次の行に送られたときに頭が下がらないように */}
          {q.multi && (
            <>
              {" "}
              <span className="text-[1rem] font-normal whitespace-nowrap text-muted">{SURVEY_LABELS.multi}</span>
            </>
          )}
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
                  on ? "font-bold outline-2 -outline-offset-2 outline-accent" : ""
                }`}
                data-press
                data-choice={c.code}
              >
                {on ? (
                  <ChosenIcon aria-hidden className="size-7 shrink-0 text-accent" />
                ) : (
                  <span aria-hidden className={`size-7 shrink-0 bg-panel ${q.multi ? "rounded" : "rounded-full"}`} />
                )}
                <span>{c.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* その他の内容は「その他」（どの問いでも選択肢の最後）のすぐ下。問 4 の支援者の注はその下 */}
      {q.other && otherOpen && (
        <label className="mt-3 block" data-question={q.other.key}>
          <span className="block text-lg font-bold">{SURVEY_LABELS.otherText}</span>
          <input
            type="text"
            maxLength={OTHER_MAX}
            autoComplete="off"
            value={texts[q.other.key]}
            onChange={(e) => onText(q.other!.key, e.target.value)}
            className={`mt-2 h-14 ${FIELD}`}
          />
        </label>
      )}
      {q.note && <p className="mt-2 text-[1rem] text-muted">{q.note}</p>}
      {follow && <FreeField fieldKey={follow.key} label={follow.text} value={texts[follow.key]} onText={onText} big={false} />}
    </section>
  );
}
