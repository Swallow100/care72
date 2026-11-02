"use client";

// 訓練の開始（大雨の想定・地震の想定・10 分版）。押すと 0 時間まで当てて保存し、訓練の画面へ。
// 事業所に進行中があれば断られる（実施中あり）。そのときは一覧の進行中から再開か中断。
// 主の操作の色は 10 分版（審査員がまず押す方、11/3 03:3x の確定）だけ。大雨・地震の想定は無色。押してから画面が移るまで、押したボタンに灰色を残す（data-pending）。

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DrillScenario } from "@/lib/db/types";
import { Button } from "@/components/ui/Button";
import { PlayIcon } from "@/components/ui/Icon";
import { DRILL_LABELS, SCENARIO_LABELS } from "@/lib/drill/labels";

/** 主の操作の色にする想定 */
const MAIN_SCENARIO: DrillScenario = "short";

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
        setBusy(null);
        router.refresh();
        return;
      }
      // 訓練の画面が出るまで押したボタンの灰色を残す（busy は戻さない。画面が移ればこの部品は消える）
      router.push(`/drill/${encodeURIComponent(body.id)}`);
    } catch {
      setError(DRILL_LABELS.network);
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-start>
      {scenarios.map((s) => (
        <Button
          key={s}
          kind={s === MAIN_SCENARIO ? "main" : "plain"}
          icon={PlayIcon}
          onClick={() => void start(s)}
          disabled={disabled || busy !== null}
          data-scenario={s}
          data-pending={busy === s ? "" : undefined}
        >
          {SCENARIO_LABELS[s]}
        </Button>
      ))}
      {error && (
        <span role="alert" className="text-sm font-bold text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
