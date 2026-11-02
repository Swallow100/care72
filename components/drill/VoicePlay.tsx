"use client";

// 電話に出た人の言う事の声（T21）。押すとサーバーの声（GET /api/drill/voice、Gemini TTS を R2 に訓練ごとに置いた物）を流す。
// 声を作れない（鍵が未設定・失敗）ときは消えて文字だけになる。声は AI の音声なので AI の印を添える。

import { SpeakerWaveIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { CALL_UI } from "@/lib/drill/labels";

export function VoicePlay({ href }: { href: string }) {
  const [state, setState] = useState<"idle" | "playing" | "none">("idle");
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => ref.current?.pause(), []);
  if (state === "none") return null;
  const play = () => {
    ref.current?.pause();
    const a = new Audio(href);
    ref.current = a;
    a.onended = () => setState("idle");
    a.onerror = () => setState("none");
    setState("playing");
    a.play().catch(() => setState("none"));
  };
  return (
    <span className="inline-flex items-center gap-1" data-voice-play={state}>
      <Button kind="plainIn" size="sm" icon={SpeakerWaveIcon} onClick={play} disabled={state === "playing"}>
        {state === "playing" ? CALL_UI.playing : CALL_UI.play}
      </Button>
      <AiMark small title="AI の音声（Gemini TTS）" />
    </span>
  );
}
