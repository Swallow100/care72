"use client";

// 経過の書き足し（docs/tasks/T24.md）。本人のページの経過の区分の上に置く。定型（安否確認・診察・配薬・搬送・到着）を 1 つ選び、
// 自由文を足して「追記」。定型を選ばなければ自由文だけの「記録」。誰が・いつ・どの役はサーバーが付ける（lib/timeline/write.ts）。
// 書ける種類は役と同意で決まる（lib/consent/scope.ts の writes。ケアマネは診察・配薬を出さない、医療班は今は無し）。自由文は Claude に渡さない。
// 送ったら本人のページを読み直す（router.refresh）。選んだ定型は太字と下線で示し、薄い色の下地は敷かない。
// T143: 何の欄か分かるように、見出し「追記」の下に「種類」と書く種類の選び（記録〔自由文だけ〕・安否確認・搬送・到着…、初めは記録）、
// 文の欄に選んだ種類の例の言葉（「例 電話で本人の声を確認」）。平時のケアマネは経過の畳みの中（components/person/PersonView.tsx）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { AddIcon } from "@/components/ui/Icon";
import { COMPOSER_EXAMPLES, COMPOSER_FAILED, COMPOSER_LABELS } from "@/lib/consent/labels";
import { CUSTODY_LABELS } from "@/lib/custody/labels";
import type { WritableKind } from "@/lib/consent/scope";
import { TIMELINE_KIND_LABELS } from "@/lib/labels";
import { BODY_MAX, TIMELINE_API } from "@/lib/timeline/paths";

type Preset = Exclude<WritableKind, "note">;

/** 入れる欄の形（地の色のほか）。撤回の理由の欄（RetractButton）も同じ形 */
export const TIMELINE_INPUT_SHAPE =
  "w-full min-w-0 rounded px-2 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
/** 欄は面の中（panel2）に置くので、文の欄は面の地（T143） */
const INPUT = `resize-y bg-panel ${TIMELINE_INPUT_SHAPE}`;
/** 追記・記録は主の操作（共通のボタンの形、components/ui/Button） */
const PRIMARY = buttonClass("main", "md");

export function TimelineComposer({ personId, kinds }: { personId: string; kinds: readonly WritableKind[] }) {
  const router = useRouter();
  const presets = kinds.filter((k): k is Preset => k !== "note");
  const [preset, setPreset] = useState<Preset | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 自由文だけなら「記録」（書ける種類に無ければ送れない）
  const kind: WritableKind | null = preset ?? (kinds.includes("note") && text.trim() !== "" ? "note" : null);
  // 到着の本文は様式 9 の避難先の列に出る（lib/forms/form9-db.ts の entryPlace）ので欄の名前を「避難所」に。搬送は「行き先」
  const textLabel =
    preset === "arrived_shelter" ? CUSTODY_LABELS.shelter : preset === "transported" ? CUSTODY_LABELS.destination : COMPOSER_LABELS.text;
  // 文の欄の例の言葉（選んだ種類の。選んでいなければ記録の例）
  const example = COMPOSER_EXAMPLES[preset ?? "note"];
  // 種類の選び: 記録（自由文だけ）が書ける役なら先頭に置き、定型を選んでいない時はそれが選ばれている形
  const noteOk = kinds.includes("note");
  const choices: Array<WritableKind> = [...(noteOk ? (["note"] as const) : []), ...presets];
  const chosen: WritableKind | null = preset ?? (noteOk ? "note" : null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!kind || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(TIMELINE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, kind, body: text }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; label?: string };
      if (!res.ok || !json.ok) {
        setError(json.label ?? COMPOSER_FAILED);
        return;
      }
      setPreset(null);
      setText("");
      router.refresh();
    } catch {
      setError(COMPOSER_FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} aria-labelledby={`${personId}-composer`} className="mb-1.5 space-y-1.5 rounded bg-panel2 px-2 py-1.5" data-form="timeline">
      <h4 id={`${personId}-composer`} className="text-xs font-bold">
        {COMPOSER_LABELS.title}
      </h4>
      {choices.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span id={`${personId}-composer-kind`} className="text-muted">
            {COMPOSER_LABELS.preset}
          </span>
          <div role="radiogroup" aria-labelledby={`${personId}-composer-kind`} className="flex flex-wrap gap-1">
            {choices.map((k) => {
              const on = chosen === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPreset(k === "note" ? null : (k as Preset))}
                  className={`rounded bg-panel px-2 py-1 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent ${on ? "font-bold text-ink underline underline-offset-4" : "text-muted"}`}
                  data-press
                  data-kind={k}
                >
                  {TIMELINE_KIND_LABELS[k]}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={BODY_MAX}
          placeholder={example}
          aria-label={textLabel}
          className={INPUT}
        />
        <button type="submit" disabled={!kind || busy} className={`${PRIMARY} shrink-0`} data-press="overlay">
          <AddIcon aria-hidden className="size-4 shrink-0" />
          {busy ? COMPOSER_LABELS.sending : COMPOSER_LABELS.send}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-bold text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
