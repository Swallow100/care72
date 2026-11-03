"use client";

// 行の詳細の連絡先と電話のボタン（docs/tasks/T13.md「電話は tel: のリンクで、押した事実を経過に残す」）。
// 電話のボタンは tel: のリンク（かけるのはケアマネ本人の電話）。押すと「電話 家族 娘」を経過に残してから電話の画面へ。
// 「不通」は 1 押しで「電話 家族 娘 不通」を残す。残したら画面を読み直す（電話の記録と最後の電話が変わる）。
// 「通話」（T58）は行の中に小さな欄を開く: 聞いた安否（無事・無事でない・聞けず）、無事でないときだけ けが・動けない、メモ（任意）。
// 聞いた安否はサーバーが信号（出どころ ケアマネ）に足し、色と連絡順はルールの表が当て直す（画面では決めない）。
// 赤 けが・動けない の人に「無事」を送ると、サーバーが断る（「至急維持」）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DetailContact } from "@/lib/list/detail";
import { DETAIL_LABELS } from "@/lib/list/labels";
import { Button, buttonClass } from "@/components/ui/Button";
import { CloseIcon, PhoneIcon, SaveIcon } from "@/components/ui/Icon";
import { CALL_PATH } from "@/lib/list/paths";

type Result = "dialed" | "no_answer" | "connected";
type Choice = "green" | "red" | "none";
type Heard = { color: "green" | "red"; injured?: true; canMove?: false };

const MAX_MEMO = 100;

/** 選ぶ所の見た目。選んだ印は枠と太字（下地を敷かない）。押したときは灰色だけ */
const choiceClass = (on: boolean, tone = "") =>
  `inline-flex h-8 items-center rounded bg-panel px-3 text-sm ${tone} ${
    on ? "font-bold outline-2 -outline-offset-2 outline-accent" : "font-normal"
  } focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent`;

const CHOICES: ReadonlyArray<{ key: Choice; label: string; tone: string }> = [
  { key: "green", label: DETAIL_LABELS.heardGreen, tone: "text-state-ok" },
  { key: "red", label: DETAIL_LABELS.heardRed, tone: "text-state-urgent" },
  { key: "none", label: DETAIL_LABELS.heardNone, tone: "" },
];

function lastCallText(c: NonNullable<DetailContact["lastCall"]>): string {
  if (c.result === "no_answer") return DETAIL_LABELS.noAnswer;
  if (c.result === "connected") {
    const h = c.heard;
    return [DETAIL_LABELS.connected, h ? (h.color === "green" ? DETAIL_LABELS.heardGreen : DETAIL_LABELS.heardRed) : null]
      .filter((s) => s)
      .join(" ");
  }
  return DETAIL_LABELS.calls;
}

export function CallButtons({ personId, contacts }: { personId: string; contacts: DetailContact[] }) {
  const router = useRouter();
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** 通話の欄を開いている連絡先 */
  const [talking, setTalking] = useState<string | null>(null);

  async function log(contactId: string, result: Result, extra: { heard?: Heard | null; memo?: string } = {}): Promise<boolean> {
    setBusy(`${contactId}:${result}`);
    setFailed(null);
    try {
      const res = await fetch(CALL_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ person: personId, contact: contactId, result, ...extra }),
        // 電話の画面に移っても送り切る
        keepalive: true,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { label?: string } | null;
        setFailed(j?.label ?? "記録失敗");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setFailed("記録失敗");
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (contacts.length === 0) return <p className="text-sm text-muted">{DETAIL_LABELS.none}</p>;
  return (
    <div>
      <ul className="space-y-1.5">
        {contacts.map((c) => (
          <li key={c.id} data-contact={c.kind}>
            {/* 1 行目: 誰か（種類・名前・間柄・距離・緊急連絡先の順・最後の電話） */}
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-xs text-muted">{c.kindLabel}</span>
              {c.name && <span className="font-bold">{c.name}</span>}
              {c.relation && <span className="text-xs text-muted">{c.relation}</span>}
              {c.reach && (
                <span className="whitespace-nowrap text-xs text-muted" data-reach>
                  {c.reach}
                </span>
              )}
              {c.emergencyOrder !== null && (
                <span className="whitespace-nowrap text-xs text-muted">
                  {DETAIL_LABELS.emergency} {c.emergencyOrder}
                </span>
              )}
              {c.lastCall && (
                <span
                  className={`whitespace-nowrap text-xs tabular-nums ${c.lastCall.result === "no_answer" ? "font-bold tone-check" : "text-muted"}`}
                  data-last-call={c.lastCall.result ?? ""}
                >
                  {c.lastCall.when} {lastCallText(c.lastCall)}
                </span>
              )}
            </div>
            {/* 2 行目: 電話（tel:）と不通・通話 */}
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <a
                href={`tel:${c.tel}`}
                onClick={() => void log(c.id, "dialed")}
                className={buttonClass("main", "sm")}
                data-press="overlay"
                data-tel={c.id}
              >
                <PhoneIcon aria-hidden className="size-3.5 shrink-0" />
                {DETAIL_LABELS.calls} {c.phone}
              </a>
              <button
                type="button"
                onClick={() => void log(c.id, "no_answer")}
                disabled={busy !== null}
                className={buttonClass("plainIn", "sm")}
                data-press
                data-no-answer={c.id}
              >
                {DETAIL_LABELS.noAnswer}
              </button>
              <button
                type="button"
                onClick={() => setTalking(talking === c.id ? null : c.id)}
                disabled={busy !== null}
                aria-expanded={talking === c.id}
                className={buttonClass("plainIn", "sm")}
                data-press
                data-connected={c.id}
              >
                {DETAIL_LABELS.connected}
              </button>
            </div>
            {talking === c.id && (
              <ConnectedForm
                busy={busy !== null}
                onCancel={() => setTalking(null)}
                onSave={async (heard, memo) => {
                  const ok = await log(c.id, "connected", { heard, ...(memo ? { memo } : {}) });
                  if (ok) setTalking(null);
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="mt-1 text-sm font-bold text-danger">
          {failed}
        </p>
      )}
    </div>
  );
}

/** 通話の欄。聞いた安否を 1 つ選び（無事でないときだけ けが・動けない）、メモ（任意）を書いて保存 */
function ConnectedForm({
  busy,
  onSave,
  onCancel,
}: {
  busy: boolean;
  onSave: (heard: Heard | null, memo: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [injured, setInjured] = useState(false);
  const [immobile, setImmobile] = useState(false);
  const [memo, setMemo] = useState("");

  const heard: Heard | null =
    choice === "green"
      ? { color: "green" }
      : choice === "red"
        ? { color: "red", ...(injured ? { injured: true as const } : {}), ...(immobile ? { canMove: false as const } : {}) }
        : null;
  const canSave = choice !== null && !busy;

  return (
    <form
      className="mt-1 space-y-1.5 rounded bg-panel2 p-1.5"
      data-connected-form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void onSave(heard, memo.trim());
      }}
    >
      <div role="radiogroup" aria-label={DETAIL_LABELS.heard} className="flex flex-wrap gap-1">
        {CHOICES.map((x) => (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={choice === x.key}
            onClick={() => setChoice(x.key)}
            className={choiceClass(choice === x.key, x.tone)}
            data-press
            data-heard={x.key}
          >
            {x.label}
          </button>
        ))}
      </div>
      {choice === "red" && (
        <div className="flex flex-wrap gap-1" data-heard-answers>
          <button
            type="button"
            role="checkbox"
            aria-checked={injured}
            onClick={() => setInjured(!injured)}
            className={choiceClass(injured)}
            data-press
            data-heard-injured
          >
            {DETAIL_LABELS.injured}
          </button>
          <button
            type="button"
            role="checkbox"
            aria-checked={immobile}
            onClick={() => setImmobile(!immobile)}
            className={choiceClass(immobile)}
            data-press
            data-heard-immobile
          >
            {DETAIL_LABELS.immobile}
          </button>
        </div>
      )}
      <input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        maxLength={MAX_MEMO}
        placeholder={DETAIL_LABELS.memo}
        aria-label={DETAIL_LABELS.memo}
        className="h-8 w-full min-w-0 rounded bg-panel px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent"
        data-call-memo
      />
      <div className="flex flex-wrap gap-1">
        <Button type="submit" kind="main" size="sm" icon={SaveIcon} disabled={!canSave} data-call-save>
          {DETAIL_LABELS.save}
        </Button>
        <Button kind="quiet" size="sm" icon={CloseIcon} onClick={onCancel}>
          {DETAIL_LABELS.cancel}
        </Button>
      </div>
    </form>
  );
}
