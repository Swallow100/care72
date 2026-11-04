"use client";

// 録音と自由文の分類（T12）の欄。担当一覧の行の詳細（T13）と本人のページに置く部品。
// 分類・確信・引用と「AI」の印。ケアマネは「修正」で選び直せる（経過に残り、以後は人の分類が効く）。
// 色は付けない（分類から色を決めるのは lib/triage だけ）。選んだ印は枠と文字の色で、下地を敷かない。
// 使い方は docs/progress/t12.md。読み込みは lib/classify/view.ts（CLASSIFY_COLUMNS と classViewOf）から。

import { useState } from "react";
import { RECORDING_CLASSES, type RecordingClass } from "@/lib/db/types";
import {
  CLASS_LABELS,
  CLASSIFY_ERROR_LABELS,
  CLASSIFY_LABELS,
  classesText,
  confidenceText,
} from "@/lib/classify/labels";
import type { AiClassView, ClassView } from "@/lib/classify/view";
import { BTN, BTN_IN, BTN_MAIN } from "@/components/person/intake-ui";
import { AiMark } from "@/components/person/parts";

export type ClassificationProps = {
  /** 信号の id */
  signalId: string;
  /** lib/classify/view.ts の classViewOf で作った物 */
  view: ClassView;
  /** 直す口を出す（ケアマネの役だけ。API もケアマネ以外は 403） */
  editable?: boolean;
  /** 面の中の区分（地が panel2）に置くときは true。ボタンを白にする */
  inset?: boolean;
  /** 直して保存したあと（一覧の読み直しなどに） */
  onSaved?: (view: ClassView) => void;
};

/** 分類の選択（6 つ）。不明はほかと一緒に選ばない */
export function toggleClass(picked: readonly RecordingClass[], c: RecordingClass): RecordingClass[] {
  if (c === "unknown") return picked.includes("unknown") ? [] : ["unknown"];
  const rest: RecordingClass[] = picked.filter((x) => x !== "unknown");
  return rest.includes(c) ? rest.filter((x) => x !== c) : RECORDING_CLASSES.filter((x) => x === c || rest.includes(x));
}

function currentClasses(view: ClassView): RecordingClass[] {
  return view.kind === "ai" || view.kind === "human" ? view.classes : [];
}

type SaveState = "idle" | "saving" | "failed";

export function Classification({ signalId, view: given, editable = false, inset = false, onSaved }: ClassificationProps) {
  const [view, setView] = useState<ClassView>(given);
  // 一覧が読み直されて新しい形が来たら、それに合わせる
  const givenKey = JSON.stringify(given);
  const [seenKey, setSeenKey] = useState(givenKey);
  if (givenKey !== seenKey) {
    setSeenKey(givenKey);
    setView(given);
  }
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<RecordingClass[]>([]);
  const [save, setSave] = useState<SaveState>("idle");

  if (view.kind === "absent") return null;
  const btn = inset ? BTN_IN : BTN;

  const startEdit = () => {
    setPicked(currentClasses(view));
    setSave("idle");
    setEditing(true);
  };

  const submit = async () => {
    if (picked.length === 0) return;
    setSave("saving");
    try {
      const res = await fetch(`/api/signals/${encodeURIComponent(signalId)}/classes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classes: picked }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; view?: ClassView } | null;
      if (!res.ok || !json?.ok || !json.view) {
        setSave("failed");
        return;
      }
      setView(json.view);
      setEditing(false);
      setSave("idle");
      onSaved?.(json.view);
    } catch {
      setSave("failed");
    }
  };

  return (
    <div className="space-y-1 text-sm" data-classify={view.kind}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-xs text-muted">{CLASSIFY_LABELS.title}</span>
        <ClassBody view={view} />
        {editable && !editing && (
          <button type="button" className={`ml-auto ${btn}`} data-press onClick={startEdit}>
            {CLASSIFY_LABELS.edit}
          </button>
        )}
      </div>
      {editing && (
        <div className="flex flex-wrap items-center gap-1" data-classify="edit">
          {RECORDING_CLASSES.map((c) => {
            const on = picked.includes(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                className={`${btn} ${on ? "outline-2 -outline-offset-2 outline-accent" : "font-normal"}`}
                data-press
                disabled={save === "saving"}
                onClick={() => setPicked((p) => toggleClass(p, c))}
              >
                {CLASS_LABELS[c]}
              </button>
            );
          })}
          <span className="ml-auto flex items-center gap-1">
            {save === "failed" && <span className="text-xs font-bold text-danger">{CLASSIFY_LABELS.failed}</span>}
            <button
              type="button"
              className={BTN_MAIN}
              data-press="overlay"
              disabled={picked.length === 0 || save === "saving"}
              onClick={submit}
            >
              {save === "saving" ? CLASSIFY_LABELS.saving : CLASSIFY_LABELS.save}
            </button>
            <button type="button" className={btn} data-press disabled={save === "saving"} onClick={() => setEditing(false)}>
              {CLASSIFY_LABELS.cancel}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function AiLine({ ai, small = false }: { ai: AiClassView; small?: boolean }) {
  return (
    <>
      <span className={small ? "" : "font-bold"}>{classesText(ai.classes)}</span>
      <AiMark small={small} title="AI の分類。人が確認して直す" />
      {ai.confidence !== null && (
        <span className="text-xs text-muted tabular-nums">
          {CLASSIFY_LABELS.confidence} {confidenceText(ai.confidence)}
        </span>
      )}
      {ai.quote && (
        <span className="text-xs">
          <span className="text-muted">{CLASSIFY_LABELS.quote}</span>「{ai.quote}」
        </span>
      )}
    </>
  );
}

function ClassBody({ view }: { view: Exclude<ClassView, { kind: "absent" }> }) {
  switch (view.kind) {
    case "pending":
      return <span className="text-muted">{CLASSIFY_LABELS.pending}</span>;
    case "none":
      // 文字の無い録音（無音）は「不明」と出す（AI は呼んでいないので AI の印は付けない）
      if (view.error === "no_text") return <span className="font-bold">{CLASS_LABELS.unknown}</span>;
      return (
        <>
          <span className="font-bold">{CLASSIFY_LABELS.none}</span>
          <span className="text-xs text-muted">{CLASSIFY_ERROR_LABELS[view.error]}</span>
        </>
      );
    case "ai":
      return <AiLine ai={view} />;
    case "human":
      return (
        <>
          <span className="font-bold">{classesText(view.classes)}</span>
          <span className="text-xs font-bold text-muted">{CLASSIFY_LABELS.edited}</span>
          {view.ai && (
            <span className="inline-flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted" data-classify="before">
              <span>{CLASSIFY_LABELS.before}</span>
              <AiLine ai={view.ai} small />
            </span>
          )}
        </>
      );
  }
}
