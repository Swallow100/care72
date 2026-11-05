"use client";

// 訓練の画面が上の帯に訓練の印を置く（T125、components/HeaderMarkSlot）。描く物は無い。画面を離れると消す

import { useEffect } from "react";
import { setDrillHeaderMark } from "@/components/HeaderMarkSlot";
import type { DrillHeaderMark as Mark } from "@/lib/drill/header-mark";

export function DrillHeaderMark({ mark }: { mark: Mark }) {
  const key = JSON.stringify(mark);
  useEffect(() => {
    setDrillHeaderMark(JSON.parse(key) as Mark);
    return () => setDrillHeaderMark(null);
  }, [key]);
  return null;
}
