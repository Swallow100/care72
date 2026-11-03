"use client";

// 本人のスマホの災害モード。流れ（lib/signals/phone.ts）にブラウザの物（fetch・localStorage・音・マイク・Web Speech）を渡し、
// 状態を PhoneView で描く。ブラウザの物は描いたあと（useEffect）に作る（サーバーの描画では触らない）。
//
// - 送れなかった信号は端末に残し、開いたとき・つながったとき・20 秒ごとに送り直す（lib/signals/outbox.ts）
// - 上（2 つのボタン）と終わりの画面にいる間だけ 30 秒ごとに読み直す（平時に戻った・災害の種類が替わった）。
//   答えている途中・録っている途中は読み直さない
// - 端末の位置（T69b）は、本人が「いまの 場所を おくりますか」で はい を押したときだけ 1 回取る（Geolocation、10 秒・高精度なし）。
//   取れない・断られたら何も送らない。送るのは本文の JSON で、URL に載せない（lib/signals/outbox.ts の location）

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
import { createOutbox, fetchTransport, VOICE_PATH, type ReportedPosition, type StorageLike } from "@/lib/signals/outbox";
import { createPhone, type Phone, type PhoneState } from "@/lib/signals/phone";
import type { ShelterOption } from "@/lib/signals/questions";
import { PhoneView, type PhoneActions } from "./PhoneView";

const REFRESH_MS = 30_000;
const FLUSH_MS = 20_000;
/** 端末の位置を待つ上限（T69b） */
const LOCATE_MS = 10_000;

/** 端末の位置を 1 回（T69b）。Geolocation が無い・断られた・10 秒で取れないときは null */
function locateOnce(): Promise<ReportedPosition | null> | null {
  const geo = typeof navigator !== "undefined" ? navigator.geolocation : undefined;
  if (!geo) return null;
  return new Promise((resolve) => {
    try {
      geo.getCurrentPosition(
        (p) =>
          resolve({
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null,
            at: new Date(p.timestamp || Date.now()).toISOString(),
          }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: LOCATE_MS, maximumAge: 60_000 },
      );
    } catch {
      resolve(null);
    }
  });
}

function storageOf(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** hasDevice: 台帳に機器がある（聞き取りの機器の問いを出す。T49）。shelters: 台帳の避難先 1・2（T69b） */
export function PhoneDisaster({
  personId,
  hasDevice = false,
  shelters = [],
}: {
  personId: string;
  hasDevice?: boolean;
  shelters?: ShelterOption[];
}) {
  const router = useRouter();
  const [state, setState] = useState<PhoneState>({ step: "top" });
  const [nowMs, setNowMs] = useState(0);
  const phone = useRef<Phone | null>(null);
  const shelterCount = shelters.length;

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
      sendAnswers: (item) => outbox.sendAnswers(item),
      sendLocation: (item) => outbox.sendLocation(item),
      hasDevice,
      shelters: shelterCount,
      // 位置を取れる端末だけ「いまの 場所を おくりますか」を出す
      locate: typeof navigator !== "undefined" && navigator.geolocation ? () => locateOnce() ?? Promise.resolve(null) : undefined,
      // 声の問い（T49）は端末の読み上げ。読み上げの無い端末は声の問いを出さず、今まで通り定型文へ
      speak: synth && Utterance ? (text) => player.say(text) : undefined,
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
  }, [personId, hasDevice, shelterCount]);

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
      answer: (c) => phone.current?.answer(c),
      skip: () => phone.current?.skip(),
      locate: (send) => phone.current?.locate(send),
      extend: () => phone.current?.extend(),
      finish: () => phone.current?.finish(),
      again: () => phone.current?.again(),
    }),
    [],
  );

  return <PhoneView state={state} nowMs={nowMs} on={on} shelters={shelters} />;
}
