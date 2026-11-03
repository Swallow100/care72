"use client";

// 「アンケート」の区分の見出しと「共有リンク作成」（docs/tasks/T42.md・T65.md）。押すと見出しのすぐ下に控えの欄が開く。
// 作ったら欄を閉じ、見出しの下に「作成済」と控えの 1 行だけを出し、一覧を読み直す（router.refresh。この部品の状態は残る）。
// URL・コピー・QR・QR保存・期限・回答は一覧の行（SurveyPanel の ShareRow）の 1 か所だけに出す。新しいリンクは一覧の先頭の行（新しい順）。
// 1 本の共有のリンクで何人でも答えられる（受付は締切まで、30 件まで。lib/survey/share.ts）。紙に刷る QR はこれ 1 つ。
// 控えは本名でなく「包括配布」のような呼び名（リンクの見分けに使うだけ）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { CloseIcon, LinkIcon } from "@/components/ui/Icon";
import { PanelHead } from "@/components/ui/Panel";
import { StateText } from "@/components/ui/Tag";
import { MEMO_MAX } from "@/lib/survey/form";
import { SURVEY_LINKS_API_PATH } from "@/lib/survey/paths";
import { SURVEY_OFFICE_LABELS as L } from "@/lib/survey/text";

const INPUT =
  "h-8 w-full min-w-0 rounded bg-panel px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

export function SurveyCreate({ count }: { count: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 作ったリンクの控え（作成済の 1 行に出す。リンクそのものは一覧の行に） */
  const [made, setMade] = useState<{ memo: string } | null>(null);

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
      const data = (await res.json().catch(() => null)) as { ok: true } | { ok: false; label?: string } | null;
      if (data?.ok) {
        setMade({ memo: memo.trim() });
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
        <p role="status" className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm" data-survey-made>
          <StateText tone="ok">{L.made}</StateText>
          {made.memo && <span className="font-bold">{made.memo}</span>}
        </p>
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
