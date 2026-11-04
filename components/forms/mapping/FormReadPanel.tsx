"use client";

// 様式の読取（写真・PDF → 黒塗りの画面 → /api/forms/read）と手作成（/api/forms/mappings）。読めたら確かめる画面へ送る。
// AI 未設定のときは読取を押せず、手作成の道だけ残す。読取は Opus で数十秒かかるので、待った秒を出す。
// 写真・PDF は入れる欄と同じ黒塗りの画面（components/person/RedactSheet.tsx）を必ず通す（T83、見直しの安全 中 5）。
// 白紙の様式は塗らずに「送信」（確かめの窓「塗り無し」で人が選ぶ）、記入済みなら書いた値を塗ってから。送るのは塗った後の頁の画像だけ。

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { RedactedPage } from "@/components/person/RedactSheet";
import { BTN_MAIN, BTN_SIDE, INPUT } from "@/components/person/intake-ui";
import { AddIcon, PaperIcon, ReadIcon } from "@/components/ui/Icon";
import { Loader72 } from "@/components/ui/Loader72";
import { LIMITS, MAPPING_LABELS as L } from "@/lib/forms/mapping";
import { buildFormReadForm, FORM_READ_PAGES_MAX } from "@/lib/forms/read-upload";
import { shrinkImage } from "@/lib/forms/shrink-image";
import { PLACE_LABELS } from "@/lib/labels";

// 黒塗りの画面は写真・PDF を選んで読取を押したときだけ読み込む（ブラウザだけ。pdf.js をサーバーの束に入れない）
const RedactSheet = dynamic(() => import("@/components/person/RedactSheet").then((m) => m.RedactSheet), { ssr: false });

type Fail = { label: string };

async function post(url: string, body: BodyInit, json = false): Promise<{ ok: true; id: string } | { ok: false; label: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      body,
      headers: json ? { "Content-Type": "application/json" } : undefined,
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; label?: string } | null;
    if (res.ok && data?.ok && data.id) return { ok: true, id: data.id };
    return { ok: false, label: data?.label ?? L.aiFailed };
  } catch {
    return { ok: false, label: L.aiFailed };
  }
}

export function FormReadPanel({ aiReady }: { aiReady: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"read" | "manual" | null>(null);
  const [fail, setFail] = useState<Fail | null>(null);
  const [title, setTitle] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [redacting, setRedacting] = useState<File[] | null>(null);

  useEffect(() => {
    if (busy !== "read") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // 読取: 写真は端末で縮めて JPEG に（T68。順は 縮小 → 塗り → 送る）。PDF はそのまま黒塗りの画面へ。JPEG・PNG・PDF のほかは断る
  const read = async () => {
    if (!file) return;
    setFail(null);
    const shrunk = await shrinkImage(file, Number.POSITIVE_INFINITY);
    if (!shrunk.ok) {
      setFail({ label: shrunk.error === "type" ? PLACE_LABELS.fileKinds : L.fileLarge });
      return;
    }
    setRedacting([shrunk.file]);
  };

  // 塗った後の頁（頭から FORM_READ_PAGES_MAX 頁）を 1 要求で送る
  const send = async (pages: RedactedPage[]) => {
    setRedacting(null);
    setBusy("read");
    setFail(null);
    const r = await post("/api/forms/read", buildFormReadForm(pages.slice(0, FORM_READ_PAGES_MAX)));
    if (r.ok) {
      router.push(`/forms/mapping/${encodeURIComponent(r.id)}`);
      return;
    }
    setFail({ label: r.label });
    setBusy(null);
  };

  const manual = async () => {
    const t = title.trim();
    if (!t) return;
    setBusy("manual");
    setFail(null);
    const r = await post("/api/forms/mappings", JSON.stringify({ title: t }), true);
    if (r.ok) {
      router.push(`/forms/mapping/${encodeURIComponent(r.id)}`);
      return;
    }
    setFail({ label: r.label });
    setBusy(null);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <section aria-labelledby="read-title" className="rounded-lg bg-panel p-3">
        <h2 id="read-title" className="flex items-baseline gap-2 font-bold">
          {L.read}
          <span className="text-xs font-normal text-muted">写真 JPEG・PNG／PDF {FORM_READ_PAGES_MAX} 頁まで</span>
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className={`${BTN_SIDE} cursor-pointer`} data-press>
            <PaperIcon aria-hidden className="size-3.5 shrink-0" />
            選択
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="sr-only"
              disabled={busy !== null}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setFail(null);
              }}
            />
          </label>
          <span className="min-w-0 flex-1 truncate text-sm" data-file>
            {file ? file.name : <span className="text-muted">未選択</span>}
          </span>
          <button type="button" className={BTN_MAIN} disabled={!aiReady || !file || busy !== null || redacting !== null} onClick={read} data-press="overlay">
            <ReadIcon aria-hidden className="size-3.5 shrink-0" />
            {busy === "read" ? L.reading : L.read}
          </button>
        </div>
        {busy === "read" && (
          // AI の待ちの印（T44）。待った秒も添える
          <Loader72
            className="mt-2 text-sm"
            label={
              <>
                {L.reading} <span className="tabular-nums">{seconds}</span> 秒
              </>
            }
          />
        )}
      </section>

      <section aria-labelledby="manual-title" className="rounded-lg bg-panel p-3">
        <h2 id="manual-title" className="font-bold">
          {L.manual}
        </h2>
        <div className="mt-2 flex gap-2">
          <input
            className={INPUT}
            placeholder="様式の題名"
            aria-label="様式の題名"
            maxLength={LIMITS.title}
            value={title}
            disabled={busy !== null}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="button" className={`${BTN_SIDE} shrink-0`} disabled={!title.trim() || busy !== null} onClick={manual} data-press>
            <AddIcon aria-hidden className="size-3.5 shrink-0" />
            {L.manual}
          </button>
        </div>
      </section>

      {fail && (
        <p role="alert" className="text-sm font-bold text-danger md:col-span-2">
          {fail.label}
        </p>
      )}

      {redacting && <RedactSheet files={redacting} onCancel={() => setRedacting(null)} onSend={(pages) => void send(pages)} />}
    </div>
  );
}
