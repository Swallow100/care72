"use client";

// 様式の読取（写真・PDF → /api/forms/read）と手作成（/api/forms/mappings）。読めたら確かめる画面へ送る。
// AI 未設定のときは読取を押せず、手作成の道だけ残す。読取は Opus で数十秒かかるので、待った秒を出す。

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BTN_MAIN, BTN_SIDE, INPUT } from "@/components/person/intake-ui";
import { AddIcon, PaperIcon, ReadIcon } from "@/components/ui/Icon";
import { Loader72 } from "@/components/ui/Loader72";
import { FORM_FILE_MAX_BYTES, LIMITS, MAPPING_LABELS as L } from "@/lib/forms/mapping";

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

  useEffect(() => {
    if (busy !== "read") return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const read = async () => {
    if (!file) return;
    if (file.size > FORM_FILE_MAX_BYTES) {
      setFail({ label: L.fileLarge });
      return;
    }
    setBusy("read");
    setFail(null);
    const body = new FormData();
    body.append("file", file);
    const r = await post("/api/forms/read", body);
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
          <span className="text-xs font-normal text-muted">写真 JPEG・PNG／PDF 5MB まで</span>
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
          <button type="button" className={BTN_MAIN} disabled={!aiReady || !file || busy !== null} onClick={read} data-press="overlay">
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
    </div>
  );
}
