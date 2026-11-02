"use client";

// 入れる欄（T03）。本人のページの右に常に開いている。上に入力（文字・貼り付け、または手入力）、下に変更点と質問。
// - 文字: Claude（Sonnet）が台帳の欄に分け（/api/intake/extract）、今の値と並べた変更点を出す。人が外す・直す・選んで保存
// - 手入力: 区分ごとに欄を直接埋める。AI 未設定・上限到達のときはこちらが開く
// - 質問: 空欄から 1 問ずつ。答えはそのまま保存（手の入力）
// 保存は全部 /api/intake/save（版を確かめ、埋まった欄は上書きしない）。保存のあとはページを読み直す。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { INTAKE_LABELS } from "@/lib/labels";
import type { Question } from "@/lib/intake/ask";
import type { IntakeChange } from "@/lib/intake/changes";
import type { DiffItem } from "@/lib/intake/diff";
import type { IntakeProps } from "@/lib/intake/props";
import { IntakeChanges, rowsOf, type ChangeRow } from "./IntakeChanges";
import { IntakeManual } from "./IntakeManual";
import { IntakeQuestion } from "./IntakeQuestion";
import { BTN_MAIN, INPUT } from "./intake-ui";
import { StateTag, type Level } from "./parts";

/** 入力の文の長さの上限（lib/intake/extract.ts の INTAKE_TEXT_MAX と同じ） */
const TEXT_MAX = 4000;

type Tab = "text" | "manual";
type Proposal = { model: string; dropped: number; rows: ChangeRow[] };
type ApiError = { ok: false; error: string; label: string };

async function postJson<T>(url: string, body: unknown): Promise<T | ApiError> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | ApiError | null;
    if (!data) return { ok: false, error: "network", label: INTAKE_LABELS.failed };
    return data;
  } catch {
    return { ok: false, error: "network", label: INTAKE_LABELS.failed };
  }
}

const isError = (x: unknown): x is ApiError => typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;

export function Intake(props: IntakeProps & { level: Level }) {
  const router = useRouter();
  const [aiBlock, setAiBlock] = useState<string | null>(props.aiReady ? null : INTAKE_LABELS.aiNotConfigured);
  const [tab, setTab] = useState<Tab>(props.aiReady ? "text" : "manual");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [skip, setSkip] = useState<string[]>([]);
  const aiReady = aiBlock === null;
  const H = props.level === 1 ? "h2" : "h3";
  const titleId = `intake-${props.personId}`;

  // 次の 1 問（lib/intake/ask.ts の nextQuestion と同じ。ブラウザに台帳の読み方を持ち込まないため、ここで引く）
  const question = props.queue.find((q) => !skip.includes(q.key)) ?? null;
  const left = props.queue.filter((q) => !skip.includes(q.key)).length;

  async function extract(source: string, focus: string | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await postJson<{ ok: true; ai: { model: string }; items: DiffItem[]; dropped: number }>("/api/intake/extract", {
      personId: props.personId,
      text: source,
      focus,
    });
    setBusy(false);
    if (isError(r)) {
      if (r.error === "ai_not_configured" || r.error === "ai_limit") {
        setAiBlock(r.label);
        setTab("manual");
      }
      setError(r.label);
      return;
    }
    setProposal({ model: r.ai.model, dropped: r.dropped, rows: rowsOf(r.items) });
  }

  async function save(changes: IntakeChange[], ai: { model: string } | null): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await postJson<{ ok: true; changed: number }>("/api/intake/save", {
      personId: props.personId,
      version: props.version,
      ai,
      changes,
    });
    setBusy(false);
    if (isError(r)) {
      setError(r.label);
      // 競合はほかの人の保存。読み直して、今の台帳で選び直す
      if (r.error === "conflict") router.refresh();
      return false;
    }
    setNotice(r.changed > 0 ? INTAKE_LABELS.saved : INTAKE_LABELS.unchanged);
    router.refresh();
    return true;
  }

  return (
    <section aria-labelledby={titleId} className="space-y-3 rounded-lg bg-panel px-3 py-2.5 text-sm" data-intake="panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <H id={titleId} className="font-bold">
          {INTAKE_LABELS.title}
        </H>
        <div role="tablist" aria-label={INTAKE_LABELS.title} className="flex gap-1">
          {(["text", "manual"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`rounded px-1.5 py-0.5 text-xs ${tab === t ? "font-bold text-ink underline decoration-2 underline-offset-4" : "text-muted"}`}
              data-press
              onClick={() => setTab(t)}
            >
              {t === "text" ? INTAKE_LABELS.tabText : INTAKE_LABELS.tabManual}
            </button>
          ))}
        </div>
        {aiBlock && <StateTag tone="check">{aiBlock}</StateTag>}
        <span role="status" className="ml-auto text-xs">
          {busy ? <span className="text-muted">{INTAKE_LABELS.busy}</span> : error ? <span className="font-bold text-danger">{error}</span> : notice ? <span className="font-bold text-state-ok">{notice}</span> : null}
        </span>
      </div>

      {tab === "text" ? (
        <form
          className="space-y-1.5"
          data-intake="text"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) void extract(text, null);
          }}
        >
          <textarea
            className={`${INPUT} min-h-24 resize-y`}
            rows={4}
            maxLength={TEXT_MAX}
            placeholder={INTAKE_LABELS.placeholder}
            aria-label={INTAKE_LABELS.tabText}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button type="submit" className={BTN_MAIN} data-press="overlay" disabled={busy || !aiReady || text.trim() === ""}>
              {INTAKE_LABELS.extract}
            </button>
            <span className="text-xs text-muted tabular-nums">
              {text.length}/{TEXT_MAX}
            </span>
          </div>
        </form>
      ) : (
        <IntakeManual key={props.version} ledger={props.ledger} busy={busy} onSave={(changes) => void save(changes, null)} />
      )}

      {proposal && (
        <IntakeChanges
          rows={proposal.rows}
          dropped={proposal.dropped}
          ledger={props.ledger}
          clocks={props.clocks}
          busy={busy}
          onChange={(rows) => setProposal({ ...proposal, rows })}
          onDiscard={() => setProposal(null)}
          onSave={async (changes) => {
            if (await save(changes, { model: proposal.model })) {
              setProposal(null);
              setText("");
            }
          }}
        />
      )}

      <div>
        <IntakeQuestion
          question={question}
          left={left}
          busy={busy}
          aiReady={aiReady}
          onAnswer={(changes) => void save(changes, null)}
          onSkip={async (q: Question) => {
            // 次回: この回は飛ばし、未聴取として残す（計画に「未確認」）
            setSkip((s) => [...s, q.key]);
            await save([{ t: "pending", field: q.key, status: "not_asked" }], null);
          }}
          onFree={(q, answer) => void extract(answer, q.key)}
        />
      </div>
    </section>
  );
}
