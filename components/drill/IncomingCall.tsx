"use client";

// 訓練の着信の画面（docs/tasks/T21.md、docs/SPEC.md「着信はアプリ内の着信画面と声」）。訓練の画面の上に重ねる。本物の回線は使わない。
// - 今の刻みの安否のうち電話の形の物（lib/drill/calls.ts、1 刻みに 2 件まで）を、鳴らす順に 1 件ずつ出す
// - 鳴っている間: 相手の役割（「家族 夫」）と本人の名前（ケアマネの画面なので名前を出す。名前は声の生成に渡さない）、応答・拒否。
//   着信音は端末で作る短い音で、約 10 秒で止める（鳴りっぱなしにしない）
// - 応答: 声（Gemini TTS、サーバーが R2 に訓練ごとに置く）と文字。声が無い（鍵が未設定・生成の失敗）ときは文字だけ。
//   声は鳴っている間に取り寄せておき、応答の押下で流す。終話で次の着信へ
// - 応答・拒否した着信はこの端末の sessionStorage に覚え、画面を読み直しても鳴り直さない（訓練の記録には残さない）
// - 鳴っている間は早送りを止める（window の care72:ringing。components/drill/DrillControls が聞く）
// 色は安否の印（塗り）だけ。押したときは灰色だけ（Button の data-press）。

import { PhoneXMarkIcon, SpeakerWaveIcon } from "@heroicons/react/20/solid";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { PhoneIcon } from "@/components/ui/Icon";
import { StateTag, type Tone } from "@/components/ui/Tag";
import { CALL_UI, clockLabel } from "@/lib/drill/labels";
import { COLOR_LABELS } from "@/lib/labels";
import { CallInIcon } from "./icons";

export type IncomingCallItem = {
  /** 安否の signals の id（声の clip と、鳴らした印の鍵） */
  signal: string;
  /** 本人の名前 */
  name: string;
  /** 相手の言い方（「家族 夫」） */
  caller: string;
  color: "green" | "red" | "unknown";
  saying: string;
  /** 言う事が本人役（Claude）の物 */
  ai: boolean;
  /** 掛かってきた時刻（発災からの分） */
  minute: number;
  /** 声の行き先（/api/drill/voice?…）。声を作れない（鍵が未設定）なら null で文字だけ */
  voice: string | null;
};

/** 早送りを止める合図（DrillControls が聞く） */
export const RINGING_EVENT = "care72:ringing";

const TONES: Record<IncomingCallItem["color"], Tone> = { green: "ok", red: "urgent", unknown: "unknown" };
const TONE_WORDS: Record<IncomingCallItem["color"], string> = { green: COLOR_LABELS.green, red: COLOR_LABELS.red, unknown: COLOR_LABELS.gray };

const seenKey = (drillId: string) => `care72:drill:${drillId}:calls`;

function readSeen(drillId: string): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(seenKey(drillId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeSeen(drillId: string, seen: ReadonlySet<string>) {
  try {
    window.sessionStorage.setItem(seenKey(drillId), JSON.stringify([...seen]));
  } catch {
    // 覚えられなくても鳴り直すだけ
  }
}

/** 着信音の回数（2 回鳴って休む × 4 ≒ 10 秒） */
const RINGS = 4;
const RING_GAP = 2.6;

/** 端末で作る着信音。止める関数を返す。音を出せない（自動再生の制限など）ときは何もしない */
function ring(): () => void {
  let ctx: AudioContext | null = null;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return () => {};
    ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 880;
    osc.connect(gain);
    const t0 = ctx.currentTime + 0.05;
    for (let r = 0; r < RINGS; r++) {
      for (const off of [0, 0.5]) {
        gain.gain.setValueAtTime(0.05, t0 + r * RING_GAP + off);
        gain.gain.setValueAtTime(0, t0 + r * RING_GAP + off + 0.35);
      }
    }
    osc.start(t0);
    osc.stop(t0 + RINGS * RING_GAP);
    void ctx.resume().catch(() => {});
  } catch {
    // 音が出せなくても画面は出す
  }
  return () => {
    void ctx?.close().catch(() => {});
  };
}

type Voice = { state: "none" } | { state: "loading"; ready: Promise<string | null> } | { state: "ready"; url: string };

export function IncomingCall({ drillId, calls }: { drillId: string; calls: ReadonlyArray<IncomingCallItem> }) {
  /** まだ応答・拒否していない着信（読み込んだあとに sessionStorage から決める。最初の描画は空） */
  const [queue, setQueue] = useState<IncomingCallItem[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<"ringing" | "talking">("ringing");
  const [playing, setPlaying] = useState(false);
  const [voiceOk, setVoiceOk] = useState(true);
  const voiceRef = useRef<Voice>({ state: "none" });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  const current = queue[0] ?? null;
  // 画面を読み直すたびに配列は新しくなるので、着信の id の並びが変わったときだけ並べ直す（通話中に読み直しても切らない）
  const callsRef = useRef(calls);
  callsRef.current = calls;
  const ids = calls.map((c) => c.signal).join(",");

  useEffect(() => {
    const seen = readSeen(drillId);
    const open = callsRef.current.filter((c) => !seen.has(c.signal));
    setQueue(open);
    setTotal(open.length);
    setPhase("ringing");
  }, [drillId, ids]);

  // 鳴っている間は早送りを止める。読み上げとキーボードは着信の画面へ（ボタンに枠を出さないよう面に置く）
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(RINGING_EVENT, { detail: current !== null }));
  }, [current]);
  useEffect(() => {
    boxRef.current?.focus();
  }, [current, phase]);

  // 着信音（鳴っている間だけ）
  useEffect(() => {
    if (!current || phase !== "ringing") return;
    return ring();
  }, [current, phase]);

  // 声を鳴っている間に取り寄せる（応答の押下ですぐ流す）。作れない・失敗は文字だけ
  useEffect(() => {
    setPlaying(false);
    setVoiceOk(current?.voice != null);
    if (!current?.voice) {
      voiceRef.current = { state: "none" };
      return;
    }
    let alive = true;
    const ready = fetch(current.voice)
      .then(async (res) => {
        if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) return null;
        const url = URL.createObjectURL(await res.blob());
        urlsRef.current.push(url);
        return url;
      })
      .catch(() => null);
    voiceRef.current = { state: "loading", ready };
    void ready.then((url) => {
      if (!alive) return;
      voiceRef.current = url ? { state: "ready", url } : { state: "none" };
      if (!url) setVoiceOk(false);
    });
    return () => {
      alive = false;
    };
  }, [current]);

  // 閉じるときに音と取り寄せた声を片付ける
  useEffect(
    () => () => {
      audioRef.current?.pause();
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
    },
    [],
  );

  const play = useCallback(async () => {
    const v = voiceRef.current;
    const url = v.state === "ready" ? v.url : v.state === "loading" ? await v.ready : null;
    if (!url) {
      setVoiceOk(false);
      return;
    }
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => setPlaying(false);
    a.onerror = () => {
      setPlaying(false);
      setVoiceOk(false);
    };
    setPlaying(true);
    await a.play().catch(() => {
      setPlaying(false);
      setVoiceOk(false);
    });
  }, []);

  const done = useCallback(() => {
    if (!current) return;
    audioRef.current?.pause();
    setPlaying(false);
    const seen = readSeen(drillId);
    seen.add(current.signal);
    writeSeen(drillId, seen);
    setQueue((q) => q.slice(1));
    setPhase("ringing");
  }, [current, drillId]);

  const answer = () => {
    setPhase("talking");
    void play();
  };

  if (!current) return null;
  const index = total - queue.length + 1;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-caller"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[12vh]"
      data-incoming={current.signal}
      data-phase={phase}
    >
      <div ref={boxRef} tabIndex={-1} className="w-full max-w-md rounded-lg bg-panel p-5 outline-none shadow-[0_2px_8px_rgb(0_0_0/0.18)] dark:shadow-[0_2px_10px_rgb(0_0_0/0.6)]">
        <div className="flex items-center gap-2 text-sm">
          <CallInIcon aria-hidden className="size-4 shrink-0" />
          <span className="font-bold">{phase === "ringing" ? CALL_UI.incoming : CALL_UI.talking}</span>
          <span className="text-muted tabular-nums">{clockLabel(current.minute)}</span>
          {total > 1 && (
            <span className="ml-auto text-muted tabular-nums" data-incoming-count>
              {index} / {total}
            </span>
          )}
        </div>
        <h2 id="incoming-caller" className="mt-3 text-2xl leading-9 font-bold" data-incoming-caller>
          {current.caller}
        </h2>
        <p className="text-lg leading-7" data-incoming-name>
          {current.name}
        </p>

        {phase === "talking" && (
          <div className="mt-4 rounded-md bg-panel2 px-3 py-2.5" data-incoming-speech>
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <StateTag tone={TONES[current.color]}>{TONE_WORDS[current.color]}</StateTag>
              <span>{current.caller}</span>
              {current.ai && <AiMark small />}
            </div>
            {/* text-base は使わない（地の色の名前と重なる。app/globals.css） */}
            <p className="mt-1.5 text-[1.125rem] leading-7">「{current.saying}」</p>
            {voiceOk && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" data-incoming-voice={playing ? "playing" : "ready"}>
                <SpeakerWaveIcon aria-hidden className="size-3.5 shrink-0" />
                <span>{playing ? CALL_UI.playing : CALL_UI.voice}</span>
                <AiMark small title="AI の音声（Gemini TTS）" />
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          {phase === "ringing" ? (
            <>
              <Button kind="danger" size="lg" icon={PhoneXMarkIcon} onClick={done} data-incoming-action="decline">
                {CALL_UI.decline}
              </Button>
              <Button kind="main" size="lg" icon={PhoneIcon} onClick={answer} className="flex-1" data-incoming-action="answer">
                {CALL_UI.answer}
              </Button>
            </>
          ) : (
            <>
              {voiceOk && (
                <Button kind="plain" size="lg" icon={SpeakerWaveIcon} onClick={() => void play()} disabled={playing} data-incoming-action="play">
                  {CALL_UI.play}
                </Button>
              )}
              <Button kind="danger" size="lg" icon={PhoneXMarkIcon} onClick={done} className="flex-1" data-incoming-action="hangup">
                {CALL_UI.hangUp}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
