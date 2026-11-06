"use client";

// 外へ掛けた電話の通話（docs/tasks/T93.md の 4、T155 で通話の画面に）。対応の欄の最新の結果（LatestResult）の、電話に出た人の最初の言葉の下に置く。
// - 往復の吹き出し（TalkLines）: ケアマネの言葉は右、電話に出た人の言葉は左。本人役（Haiku）の言葉は AI の印、頼み事は灰の文字の印、
//   声で入れた自分の言葉は「声」の印（T155）
// - 続けられる電話（出て言葉があり、8 往復に届かず、切っていない）は、着信と同じ通話の画面（components/drill/CallTalk）を画面の上に重ねて出す。
//   文字を打つか、マイクで話して送る（話した声は欄に文字で出て、送る前に直せる）。問いの候補 7 つは補助。
//   押すと POST /api/drill/<id>/talk（読んだ刻みと手の数を送る。違えば競合）。返ってきた往復の全部を描き、画面を読み直す（時計・経過・頼み事）
// - 相手の返事は声を作れれば流す（GET /api/drill/voice の act と line。T155）。無ければ文字
// - 切ると切った時刻を残して閉じる。通話の画面が出ている間は早送りを止める（IncomingCall と同じ合図）
// 吹き出しは面の地（枠線なし）。押したときは灰色だけ（Button の data-press）。

import { SpeakerWaveIcon } from "@heroicons/react/20/solid";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CALL_OUT_ASKS, canTalk, TALK_UI, type TalkLine } from "@/lib/drill/dialogue";
import type { ActionRecord } from "@/lib/drill/engine";
import { CALL_UI, clockLabel, DRILL_LABELS } from "@/lib/drill/labels";
import { CallLines, CallReply, type CallSend } from "./CallTalk";
import { CallInIcon } from "./icons";
import { RINGING_EVENT as RINGING } from "./IncomingCall";
import { TalkLines } from "./TalkLines";

export { AskMarks, TalkLines } from "./TalkLines";


/** 声を流す（作れない・失敗は false） */
function playHref(audio: { current: HTMLAudioElement | null }, href: string, onEnd: () => void): Promise<boolean> {
  audio.current?.pause();
  const a = new Audio(href);
  audio.current = a;
  a.onended = onEnd;
  a.onerror = onEnd;
  return a.play().then(
    () => true,
    () => {
      onEnd();
      return false;
    },
  );
}

/**
 * 外へ掛けた電話の通話（最新の電話の手だけ）。step・actions は画面で読んだ今の刻みと手の数（競合の門）。
 * 続けられる間は通話の画面を重ねて出し、続けられない電話は吹き出しだけ
 */
export function TalkBox({
  drillId,
  step,
  actions,
  action,
  speaker,
  name,
  voice,
}: {
  drillId: string;
  step: number;
  actions: number;
  action: ActionRecord;
  speaker: string;
  /** 本人の名前（通話の画面の頭） */
  name?: string;
  /** 最初の言葉の声の行き先（/api/drill/voice?…&act=a3）。声を作れなければ null で文字だけ */
  voice?: string | null;
}) {
  const router = useRouter();
  const r = action.result;
  const stored = r?.talk ?? [];
  const [lines, setLines] = useState<TalkLine[]>(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  // 読み直した記録の方が長ければそちら（別の端末で足した往復）
  const shown = stored.length > lines.length ? stored : lines;
  // 通話の画面は切るまで出す（8 往復に届いても、切るで切った時刻を残す。着信と同じ）。返せるのは続けられる間だけ
  const open = !closed && r?.status === "connected" && r.speech !== null && r.talkEnd === undefined;

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(RINGING, { detail: open }));
    if (open) boxRef.current?.focus();
  }, [open]);
  useEffect(
    () => () => {
      audio.current?.pause();
      window.dispatchEvent(new CustomEvent(RINGING, { detail: false }));
    },
    [],
  );

  const play = useCallback(async (href: string | null) => {
    if (!href) return;
    setPlaying(true);
    await playHref(audio, href, () => setPlaying(false));
  }, []);

  // 通話の画面が出たら最初の言葉を一度流す（自動の再生が止められたら「聞く」で）
  const firstPlayed = useRef(false);
  useEffect(() => {
    if (!open || firstPlayed.current || shown.length > 0) return;
    firstPlayed.current = true;
    void play(voice ?? null);
  }, [open, play, shown.length, voice]);

  const post = (body: CallSend | { end: true }) =>
    fetch(`/api/drill/${encodeURIComponent(drillId)}/talk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, actions, action: action.id, ...body }),
    });

  const send = async (body: CallSend): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await post(body);
      const json = (await res.json().catch(() => null)) as { ok?: boolean; label?: string; lines?: TalkLine[] } | null;
      if (!res.ok || !json?.ok || !Array.isArray(json.lines)) {
        setError(json?.label ?? String(res.status));
        if (res.status === 409) setStopped(true);
        return false;
      }
      setLines(json.lines);
      router.refresh();
      // 相手の返事の声（作れれば流す。無ければ文字だけ）
      const last = json.lines.length - 1;
      if (voice && json.lines[last]?.who === "them") void play(`${voice}&line=${last}`);
      return true;
    } catch {
      setError(DRILL_LABELS.network);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const hangUp = () => {
    audio.current?.pause();
    setPlaying(false);
    setClosed(true);
    void post({ end: true })
      .catch(() => {})
      .then(() => router.refresh());
  };

  // 切ったあとの吹き出しの頼み事の印は押せる（T166）。通話の窓の中は文字のまま
  if (!open) return shown.length > 0 ? <TalkLines lines={shown} speaker={speaker} askPerson={action.person} /> : null;
  const rounds = shown.filter((l) => l.who === "cm").length;
  // 通話の間は通話の画面だけ（後ろの結果の欄には最初の言葉が残る。切ると往復の吹き出しが結果の欄に出る）
  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`talk-callee-${action.id}`}
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[6vh]"
        data-talk-box={action.id}
        data-talk-rounds={rounds}
      >
        <div
          ref={boxRef}
          tabIndex={-1}
          className="w-full max-w-xl rounded-lg bg-panel p-5 outline-none"
        >
          <div className="flex items-center gap-2 text-sm">
            <CallInIcon aria-hidden className="size-4 shrink-0 -scale-x-100" />
            <span className="font-bold">{CALL_UI.talking}</span>
            <span className="text-muted">{TALK_UI.calling}</span>
            <span className="text-muted tabular-nums">{clockLabel(action.atMinute)}</span>
          </div>
          <h2 id={`talk-callee-${action.id}`} className="mt-3 text-2xl leading-9 font-bold" data-talk-callee>
            {speaker}
          </h2>
          {name && <p className="text-lg leading-7">{name}</p>}
          <div className="mt-4">
            <CallLines speaker={speaker} first={r?.speech ? { text: r.speech, ai: r.speechAi } : null} lines={shown} />
          </div>
          {error && (
            <p role="alert" className="mt-1.5 text-xs font-bold text-danger" data-talk-error>
              {error}
            </p>
          )}
          <div className="sticky bottom-0 -mx-5 mt-3 bg-panel px-5 pt-1 pb-0">
            <CallReply
              asks={CALL_OUT_ASKS}
              lines={shown}
              canReply={!stopped && canTalk({ ...r!, talk: shown })}
              busy={busy}
              onSend={send}
              onHangUp={hangUp}
              mark="talk"
              extra={
                voice ? (
                  <Button kind="plain" size="lg" icon={SpeakerWaveIcon} onClick={() => void play(voice)} disabled={playing} data-talk-play>
                    {playing ? CALL_UI.playing : CALL_UI.play}
                  </Button>
                ) : null
              }
            />
          </div>
        </div>
      </div>
    </>
  );
}
