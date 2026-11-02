"use client";

// 本人のスマホの災害モード。流れ（lib/signals/phone.ts）にブラウザの物（fetch・localStorage・音・マイク・Web Speech）を渡し、
// 状態を PhoneView で描く。ブラウザの物は描いたあと（useEffect）に作る（サーバーの描画では触らない）。
//
// - 送れなかった信号は端末に残し、開いたとき・つながったとき・20 秒ごとに送り直す（lib/signals/outbox.ts）
// - 上（2 つのボタン）と終わりの画面にいる間だけ 30 秒ごとに読み直す（平時に戻った・災害の種類が替わった）。
//   答えている途中・録っている途中は読み直さない

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { speechRecognitionOf } from "@/lib/speech/dictation";
import {
  createPromptPlayer,
  primeMicrophone,
  startRecording,
  startTranscript,
  type AudioLike,
  type GetUserMedia,
  type RecorderCtor,
  type SynthLike,
  type UtteranceLike,
} from "@/lib/signals/media";
import { createOutbox, fetchTransport, VOICE_PATH, type StorageLike } from "@/lib/signals/outbox";
import { createPhone, type Phone, type PhoneState } from "@/lib/signals/phone";
import { PhoneView, type PhoneActions } from "./PhoneView";

const REFRESH_MS = 30_000;
const FLUSH_MS = 20_000;

function storageOf(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function PhoneDisaster({ personId }: { personId: string }) {
  const router = useRouter();
  const [state, setState] = useState<PhoneState>({ step: "top" });
  const [nowMs, setNowMs] = useState(0);
  const phone = useRef<Phone | null>(null);

  useEffect(() => {
    // 端末の残りの持ち主は「役:本人」（家族のスマホ T11 は family:）
    const outbox = createOutbox({ storage: storageOf(), owner: `self:${personId}`, transport: fetchTransport() });
    const audio = typeof Audio === "function" ? (new Audio() as unknown as AudioLike) : null;
    const synth = "speechSynthesis" in window ? (window.speechSynthesis as unknown as SynthLike) : null;
    const Utterance =
      typeof SpeechSynthesisUtterance === "function"
        ? (SpeechSynthesisUtterance as unknown as new (text: string) => UtteranceLike)
        : null;
    const player = createPromptPlayer({ audio, voiceUrl: VOICE_PATH, synth, Utterance });
    const devices = navigator.mediaDevices;
    const getUserMedia: GetUserMedia | null = devices?.getUserMedia
      ? (c) => devices.getUserMedia(c)
      : null;
    const Recorder = typeof MediaRecorder === "function" ? (MediaRecorder as unknown as RecorderCtor) : null;
    const queryPermission = navigator.permissions
      ? () => navigator.permissions.query({ name: "microphone" as PermissionName }).then((s) => s.state)
      : undefined;

    const p = createPhone({
      sendSignal: (b) => outbox.sendSignal(b),
      sendRecording: (item, a) => outbox.sendRecording(item, a),
      prime: () => {
        player.prime();
        void primeMicrophone({ getUserMedia, queryPermission });
      },
      playPrompt: () => player.play(),
      startRecording: () => startRecording({ getUserMedia, Recorder }),
      startTranscript: (events) => startTranscript(speechRecognitionOf(window), events),
      onChange: setState,
    });
    phone.current = p;

    void outbox.flush();
    const onOnline = () => void outbox.flush();
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(() => void outbox.flush(), FLUSH_MS);
    return () => {
      p.dispose();
      phone.current = null;
      window.removeEventListener("online", onOnline);
      window.clearInterval(timer);
    };
  }, [personId]);

  // 上と終わりの画面にいる間だけ読み直す
  const idle = state.step === "top" || state.step === "done";
  useEffect(() => {
    if (!idle) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [idle, router]);

  // 録っている間は残りの秒を数える
  const recording = state.step === "recording";
  useEffect(() => {
    if (!recording) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const on = useMemo<PhoneActions>(
    () => ({
      green: () => phone.current?.green(),
      red: () => phone.current?.red(),
      where: (w) => phone.current?.where(w),
      answer: (v) => phone.current?.answer(v),
      extend: () => phone.current?.extend(),
      finish: () => phone.current?.finish(),
      again: () => phone.current?.again(),
    }),
    [],
  );

  return <PhoneView state={state} nowMs={nowMs} on={on} />;
}
