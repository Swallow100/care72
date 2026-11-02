"use client";

// 訓練の開始（大雨の想定・地震の想定・10 分版）。押すと 0 時間まで当てて保存し、訓練の画面へ。
// 事業所に進行中があれば断られる（実施中あり）。そのときは一覧の進行中から再開か中断。

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DrillScenario } from "@/lib/db/types";
import { DRILL_LABELS, SCENARIO_LABELS } from "@/lib/drill/labels";

export function StartButtons({ scenarios, disabled }: { scenarios: ReadonlyArray<DrillScenario>; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<DrillScenario | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (scenario: DrillScenario) => {
    setBusy(scenario);
    setError(null);
    try {
      const res = await fetch("/api/drill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; id?: string; label?: string } | null;
      if (!res.ok || !body?.ok || !body.id) {
        setError(body?.label ?? String(res.status));
        router.refresh();
        return;
      }
      router.push(`/drill/${encodeURIComponent(body.id)}`);
    } catch {
      setError(DRILL_LABELS.network);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-start>
      {scenarios.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => void start(s)}
          disabled={disabled || busy !== null}
          className="rounded-md bg-accent px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-60"
          data-press="overlay"
          data-scenario={s}
        >
          {SCENARIO_LABELS[s]}
        </button>
      ))}
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
