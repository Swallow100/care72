"use client";

// 「アンケート」の区分の見出しと「リンク作成」（docs/tasks/T42.md）。押すと見出しのすぐ下に宛先の控えの欄が開く。
// 作ったら欄を閉じ、「作成済」と URL とコピーを出し、一覧を読み直す（router.refresh。この部品の状態は残る）。
// 宛先の控えは本名でなく「ケアマネA」のような呼び名（答えの一覧と写しの見分けに使うだけ）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/forms/CopyButton";
import { Button } from "@/components/ui/Button";
import { CloseIcon, LinkIcon } from "@/components/ui/Icon";
import { PanelHead } from "@/components/ui/Panel";
import { StateText } from "@/components/ui/Tag";
import { MEMO_MAX } from "@/lib/survey/form";
import { SURVEY_LINKS_API_PATH } from "@/lib/survey/paths";
import { SURVEY_OFFICE_LABELS as L } from "@/lib/survey/text";

const INPUT =
  "h-8 w-full min-w-0 rounded bg-panel px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent";

export function SurveyCreate({ count }: { count: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; memo: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(SURVEY_LINKS_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as { ok: true; url: string } | { ok: false; label?: string } | null;
      if (data?.ok) {
        setMade({ url: data.url, memo: memo.trim() });
        setMemo("");
        setOpen(false);
        router.refresh();
      } else {
        setError(data?.label ?? L.failed);
      }
    } catch {
      setError(L.failed);
    }
    setBusy(false);
  }

  return (
    <>
      <PanelHead
        id="survey-title"
        title={L.title}
        count={count}
        actions={
          !open ? (
            <Button kind="main" icon={LinkIcon} aria-expanded={false} onClick={() => setOpen(true)}>
              {L.create}
            </Button>
          ) : null
        }
      />
      {made && (
        <div role="status" className="mt-2 rounded bg-panel2 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <StateText tone="ok">{L.made}</StateText>
            {made.memo && <span className="font-bold">{made.memo}</span>}
          </div>
          <p id="survey-made-url" className="mt-1 break-all select-all">
            {made.url}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <CopyButton text={made.url} targetId="survey-made-url" />
            <Button kind="quiet" size="sm" icon={CloseIcon} onClick={() => setMade(null)} className="ml-auto">
              {L.close}
            </Button>
          </div>
        </div>
      )}
      {open && (
        <form onSubmit={submit} aria-labelledby="survey-add-title" className="mt-2 grid gap-2 rounded bg-panel2 p-2.5">
          <h3 id="survey-add-title" className="text-sm font-bold">
            {L.create}
          </h3>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">{L.memo}</span>
            <input
              type="text"
              maxLength={MEMO_MAX}
              autoComplete="off"
              autoFocus
              placeholder={L.memoPlaceholder}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className={INPUT}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm font-bold text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="submit" kind="main" icon={LinkIcon} disabled={busy}>
              {L.create}
            </Button>
            <Button kind="quiet" icon={CloseIcon} onClick={() => setOpen(false)}>
              {L.close}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
