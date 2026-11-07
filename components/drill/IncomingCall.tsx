"use client";

// 訓練の着信の画面（docs/tasks/T21.md、docs/SPEC.md「着信はアプリ内の着信画面と声」）。訓練の画面の上に重ねる。本物の回線は使わない。
// - 今の刻みの安否のうち電話の形の物（lib/drill/calls.ts、1 刻みに 2 件まで）を、鳴らす順に 1 件ずつ出す
// - 鳴っている間: 相手の役割（「家族 夫」）と本人の名前（ケアマネの画面なので名前を出す。名前は声の生成に渡さない）、応答・拒否。
//   着信音は端末で作る短い音で、約 10 秒で止める（鳴りっぱなしにしない）
// - 応答: 声（Gemini TTS、サーバーが R2 に訓練ごとに置く）と文字。声が無い（鍵が未設定・生成の失敗）ときは文字だけ。
//   声は鳴っている間に取り寄せておき、応答の押下で流す。終話で次の着信へ
// - 通話の中で返す（T127、T155 で会話に）: 外へ掛けた電話と同じ通話の画面（components/drill/CallTalk）。文字を打つか、マイクで話して送る
//   （話した声は欄に文字で出て、送る前に直せる。声で入れた行は「声」の印）。問い・指示の候補（安否・けが・機器・薬・移動・避難先・待機・119勧奨、
//   lib/drill/dialogue.ts の CALL_IN_ASKS）は補助。押すと POST /api/drill/<id>/call/talk（読んだ刻みと手の数を送る。違えば競合）。返ってきた往復の全部を描く
//   （読み直さない。読み直すと着信の並びが組み直されるため）。1 つの着信に 8 回まで、1 回でケアマネの時計が文の長さで 1〜3 分進む。
//   相手の返事は声を作れれば流し、無ければ文字。終話で切った時刻を残し、画面を読み直す（時計・経過・頼み事）
// - 応答・拒否はサーバーの訓練の記録に残す（POST /api/drill/<id>/call、T22 の採点が読む。1 つの着信に 1 回）。
//   この端末の sessionStorage にも覚え、画面を読み直しても鳴り直さない。応答して切っていない着信は、読み直しても通話中のまま出る
// - 鳴っている間・通話中は早送りを止める（window の care72:ringing。components/drill/DrillControls が聞く）
// - T162: 窓の右上に「後で」。窓を閉じて訓練の画面（上の帯・次まで・事業所への切替）を押せるようにし、画面の下の 1 行「着信 N 件」の
//   「着信表示」で同じ着信（通話中なら通話中のまま）に戻る。応答・拒否は記録しない（次まで進めると、その刻みの着信は鳴らないまま過ぎる）。
//   窓の上に「N / M」と「対応済 K」（切ったあとに次の着信が鳴ると、同じ窓のままに見えて切れていないと読まれた）
// - T166: 鳴っている間は窓で画面を止めない（右下の面。上の帯・次まで・自動進行・事業所への入口が押せる。前は窓の外を押せず「押せない」と読まれた）。
//   応答した通話の間だけ今までどおり画面の上に重ねる。「後で」は時間を進める物と読まれたので「保留」
// - T184: 鳴っている間は右下の窓でなく、画面の下の幅いっぱいの帯に 1 行で（1280×800 で窓が手配の右の列と地図に重なった）。
//   帯と保留の 1 行の高さぶんの余白を画面の終わりに足す（IncomingRoom）
// 色は安否の印（塗り）だけ。押したときは灰色だけ（Button の data-press）。

import { PhoneXMarkIcon, SpeakerWaveIcon } from "@heroicons/react/20/solid";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AiMark } from "@/components/person/parts";
import { Button } from "@/components/ui/Button";
import { LaterIcon, PhoneIcon } from "@/components/ui/Icon";
import { StateTag, type Tone } from "@/components/ui/Tag";
import { CALL_IN_ASKS, type TalkLine } from "@/lib/drill/dialogue";
import { CALL_UI, clockLabel, DRILL_LABELS } from "@/lib/drill/labels";
import { COLOR_LABELS } from "@/lib/labels";
import type { FictionKind } from "@/lib/drill/fiction";
import { FictionalMark } from "./Fictional";
import { CallLines, CallReply, callLeft, type CallSend } from "./CallTalk";
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
  /** 応答して切っていない（読み直したあとも通話中で出す。T127） */
  answered?: boolean;
  /** それまでの往復（T127） */
  lines?: TalkLine[];
};

/** 早送りを止める合図（DrillControls が聞く） */
export const RINGING_EVENT = "care72:ringing";

const TONES: Record<IncomingCallItem["color"], Tone> = { green: "ok", red: "urgent", unknown: "unknown" };
const TONE_WORDS: Record<IncomingCallItem["color"], string> = { green: COLOR_LABELS.green, red: COLOR_LABELS.red, unknown: COLOR_LABELS.gray };
const FOCUS = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

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

/**
 * 応答・拒否を訓練の記録に残す（lib/drill/responses.ts）。結果を待たずに進める（同じ着信の 2 回目はサーバーが残さない）。
 * 送れなくても着信の画面は進める（採点で未応答に数えるだけ）。往復の口は応答の記録が無ければ応答として残すので、待たなくてよい
 */
function sendResponse(drillId: string, signal: string, response: "answer" | "decline"): Promise<void> {
  return fetch(`/api/drill/${encodeURIComponent(drillId)}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signal, response }),
    keepalive: true,
  }).then(
    () => {},
    () => {},
  );
}

/** 声を取り寄せて端末の URL に（作れない・失敗は null） */
async function fetchVoice(href: string): Promise<string | null> {
  try {
    const res = await fetch(href);
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("audio/")) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/** 往復の行の声の行き先（着信の声に &line=N を足す。lib/drill/voice.ts の voiceHref と同じ形） */
const lineVoice = (voice: string | null, line: number): string | null => (voice ? `${voice}&line=${line}` : null);

/** 字を打つ欄でない input の種類 */
const NOT_TYPING = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image", "hidden"]);

type Focused = { tagName?: string; type?: string; readOnly?: boolean; disabled?: boolean; isContentEditable?: boolean };

/** 着信の画面の外の入力欄（文字の欄・書ける所）に焦点があるか（T182）。el は今の焦点（既定は document.activeElement） */
export function typingOutside(box: { contains: (n: never) => boolean } | null, el: Focused | null = typeof document === "undefined" ? null : (document.activeElement as Focused | null)): boolean {
  if (!el || (box && box.contains(el as never))) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === "TEXTAREA") return !el.readOnly && !el.disabled;
  if (tag === "INPUT") return !el.readOnly && !el.disabled && !NOT_TYPING.has((el.type ?? "text").toLowerCase());
  return false;
}

type Voice = { state: "none" } | { state: "loading"; ready: Promise<string | null> } | { state: "ready"; url: string };

export function IncomingCall({
  drillId,
  calls,
  fiction,
  step,
  actions,
}: {
  drillId: string;
  calls: ReadonlyArray<IncomingCallItem>;
  /** 名前のそばの印（T70。デモ以外は本人役） */
  fiction?: FictionKind;
  /** 画面で読んだ今の刻みと手の数（通話の中で返すときの競合の門。T127）。無ければ返す欄を出さない */
  step?: number;
  actions?: number;
}) {
  const router = useRouter();
  /** まだ応答・拒否していない着信（読み込んだあとに sessionStorage から決める。最初の描画は空） */
  const [queue, setQueue] = useState<IncomingCallItem[]>([]);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<"ringing" | "talking">("ringing");
  const [playing, setPlaying] = useState(false);
  const [voiceOk, setVoiceOk] = useState(true);
  const [lines, setLines] = useState<TalkLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  /** 「保留」で窓を畳んだ（下の 1 行から戻る）。着信が替われば開き直す */
  const [later, setLater] = useState(false);
  const voiceRef = useRef<Voice>({ state: "none" });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const urlsRef = useRef<string[]>([]);
  const answerRef = useRef<Promise<void> | null>(null);
  const talkedRef = useRef(false);
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
  }, [drillId, ids]);

  // 着信が替わったら、通話中の着信（応答して切っていない）は通話中から、ほかは鳴る所から
  const currentId = current?.signal ?? null;
  useEffect(() => {
    const c = callsRef.current.find((x) => x.signal === currentId);
    setPhase(c?.answered ? "talking" : "ringing");
    setLines(c?.lines ?? []);
    setError(null);
    setClosed(false);
    setLater(false);
    answerRef.current = null;
    talkedRef.current = (c?.lines?.length ?? 0) > 0;
  }, [currentId]);

  // 鳴っている間・通話中は早送りを止める。読み上げとキーボードは着信の画面へ（ボタンに枠を出さないよう面に置く）
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(RINGING_EVENT, { detail: current !== null && !later }));
  }, [current, later]);
  useEffect(() => {
    if (later) return;
    // 鳴っている間、着信の外の入力欄（手のメモなど）を打っている途中なら焦点を移さない（T182。打った字が途中で着信の画面へ飛んだ）。応答すれば通話の画面へ
    if (phase === "ringing" && typingOutside(boxRef.current)) return;
    boxRef.current?.focus();
  }, [current, phase, later]);

  // 着信音（鳴っている間だけ。保留にしたら止める）
  useEffect(() => {
    if (!current || phase !== "ringing" || later) return;
    return ring();
  }, [current, phase, later]);

  // 声を鳴っている間に取り寄せる（応答の押下ですぐ流す）。作れない・失敗は文字だけ
  useEffect(() => {
    setPlaying(false);
    setVoiceOk(current?.voice != null);
    if (!current?.voice) {
      voiceRef.current = { state: "none" };
      return;
    }
    let alive = true;
    const ready = fetchVoice(current.voice).then((url) => {
      if (url) urlsRef.current.push(url);
      return url;
    });
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

  const playUrl = useCallback(async (url: string | null) => {
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

  const play = useCallback(async () => {
    const v = voiceRef.current;
    await playUrl(v.state === "ready" ? v.url : v.state === "loading" ? await v.ready : null);
  }, [playUrl]);

  const done = useCallback(() => {
    if (!current) return;
    // 鳴っている間の終わりは拒否。通話中の終話は切った時刻を残し（往復を続けられないように）、画面を読み直す
    if (phase === "ringing") void sendResponse(drillId, current.signal, "decline");
    else if (step !== undefined && actions !== undefined) {
      const answered = answerRef.current ?? Promise.resolve();
      void answered.then(() =>
        fetch(`/api/drill/${encodeURIComponent(drillId)}/call/talk`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step, actions, signal: current.signal, end: true }),
          keepalive: true,
        }).catch(() => {}),
      );
    }
    audioRef.current?.pause();
    setPlaying(false);
    const seen = readSeen(drillId);
    seen.add(current.signal);
    writeSeen(drillId, seen);
    // 往復で時計と経過が動いた着信は、切ったら画面を読み直す
    if (phase === "talking" && talkedRef.current) router.refresh();
    setQueue((q) => q.slice(1));
  }, [actions, current, drillId, phase, router, step]);

  const answer = () => {
    if (current) answerRef.current = sendResponse(drillId, current.signal, "answer");
    setPhase("talking");
    void play();
  };

  const send = async (body: CallSend): Promise<boolean> => {
    if (!current || step === undefined || actions === undefined) return false;
    setBusy(true);
    setError(null);
    try {
      await (answerRef.current ?? Promise.resolve());
      const res = await fetch(`/api/drill/${encodeURIComponent(drillId)}/call/talk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, actions, signal: current.signal, ...body }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; label?: string; lines?: TalkLine[] } | null;
      if (!res.ok || !json?.ok || !Array.isArray(json.lines)) {
        setError(json?.label ?? String(res.status));
        if (res.status === 409) setClosed(true);
        return false;
      }
      talkedRef.current = true;
      setLines(json.lines);
      // 相手の返事の声（作れれば流す。無ければ文字だけ）
      const last = json.lines.length - 1;
      const href = json.lines[last]?.who === "them" ? lineVoice(current.voice, last) : null;
      if (href) {
        void fetchVoice(href).then((url) => {
          if (!url) return;
          urlsRef.current.push(url);
          void playUrl(url);
        });
      }
      return true;
    } catch {
      setError(DRILL_LABELS.network);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;
  const index = total - queue.length + 1;
  if (later) {
    // 窓を閉じている間: 画面の下の 1 行（訓練の画面は押せる）。押すと同じ着信の窓に戻る
    return (
      <>
        <IncomingRoom />
        <div
          role="region"
          aria-label={CALL_UI.incoming}
          className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-panel px-4 py-2 text-sm shadow-[0_-1px_0_rgb(0_0_0/0.12)]"
          data-incoming-later={current.signal}
        >
          <CallInIcon aria-hidden className="size-4 shrink-0" />
          <span className="font-bold">
            {phase === "ringing" ? CALL_UI.incoming : CALL_UI.talking} <span className="tabular-nums">{queue.length}</span> {CALL_UI.unit}
          </span>
          <span>
            {current.caller} {current.name}
          </span>
          <Button kind="main" size="sm" icon={PhoneIcon} onClick={() => setLater(false)} data-incoming-action="reopen">
            {CALL_UI.reopen}
          </Button>
        </div>
      </>
    );
  }
  const canReply = phase === "talking" && step !== undefined && actions !== undefined && !closed && callLeft(lines) > 0;
  const talkingNow = phase === "talking";
  if (!talkingNow) {
    // 鳴っている間（T184）: 画面の下の幅いっぱいの帯に 1 行で（相手・名前・出ない・出る・保留）。前は右下の窓で、1280×800 で手配の右の列と
    // 地図に重なり、出るまで一部が押せなかった。帯の高さぶんの余白を画面の終わりに足すので、送れば全部の物に手が届く。画面は止めない（T166）
    return (
      <>
        <IncomingRoom />
        <div
          role="dialog"
          aria-labelledby="incoming-caller"
          className="fixed inset-x-0 bottom-0 z-50 bg-panel shadow-[0_-1px_0_rgb(0_0_0/0.12)] dark:bg-panel2"
          data-incoming={current.signal}
          data-phase={phase}
        >
          <div ref={boxRef} tabIndex={-1} className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 outline-none">
            <div className="flex items-center gap-2 text-sm">
              <CallInIcon aria-hidden className="size-4 shrink-0" />
              <span className="font-bold">{CALL_UI.incoming}</span>
              <span className="text-muted tabular-nums">{clockLabel(current.minute)}</span>
              {total > 1 && (
                <span className="text-muted tabular-nums" data-incoming-count>
                  {index} / {total}
                </span>
              )}
              {index > 1 && (
                <span role="status" className="text-muted" data-incoming-done={index - 1}>
                  {CALL_UI.handled} <span className="tabular-nums">{index - 1}</span>
                </span>
              )}
            </div>
            <h2 id="incoming-caller" className="text-xl leading-8 font-bold" data-incoming-caller>
              {current.caller}
            </h2>
            <p className="text-lg leading-7" data-incoming-name>
              {current.name}
              <FictionalMark kind={fiction} />
            </p>
            {error && (
              <p role="alert" className="text-xs font-bold text-danger" data-incoming-error>
                {error}
              </p>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button kind="quiet" icon={LaterIcon} onClick={() => setLater(true)} data-incoming-action="later">
                {CALL_UI.later}
              </Button>
              <Button kind="danger" size="lg" icon={PhoneXMarkIcon} onClick={done} data-incoming-action="decline">
                {CALL_UI.decline}
              </Button>
              <Button kind="main" size="lg" icon={PhoneIcon} onClick={answer} className="min-w-40" data-incoming-action="answer">
                {CALL_UI.answer}
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }
  // 応答した通話の間だけ画面の上に重ねる（T166）
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-caller"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[8vh]"
      data-incoming={current.signal}
      data-phase={phase}
    >
      <div ref={boxRef} tabIndex={-1} className="w-full max-w-xl rounded-lg bg-panel p-5 outline-none">
        <div className="flex items-center gap-2 text-sm">
          <CallInIcon aria-hidden className="size-4 shrink-0" />
          <span className="font-bold">{CALL_UI.talking}</span>
          <span className="text-muted tabular-nums">{clockLabel(current.minute)}</span>
          {total > 1 && (
            <span className="text-muted tabular-nums" data-incoming-count>
              {index} / {total}
            </span>
          )}
          {index > 1 && (
            <span role="status" className="text-muted" data-incoming-done={index - 1}>
              {CALL_UI.handled} <span className="tabular-nums">{index - 1}</span>
            </span>
          )}
          <Button kind="quiet" size="sm" icon={LaterIcon} className="ml-auto" onClick={() => setLater(true)} data-incoming-action="later">
            {CALL_UI.later}
          </Button>
        </div>
        <h2 id="incoming-caller" className="mt-3 text-2xl leading-9 font-bold" data-incoming-caller>
          {current.caller}
        </h2>
        <p className="text-lg leading-7" data-incoming-name>
          {current.name}
          <FictionalMark kind={fiction} />
        </p>

        <div className="mt-4" data-incoming-speech>
          <CallLines
            speaker={current.caller}
            first={{ text: current.saying, ai: current.ai, lead: <StateTag tone={TONES[current.color]}>{TONE_WORDS[current.color]}</StateTag> }}
            lines={lines}
          />
          {voiceOk && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted" data-incoming-voice={playing ? "playing" : "ready"}>
              <SpeakerWaveIcon aria-hidden className="size-3.5 shrink-0" />
              <span>{playing ? CALL_UI.playing : CALL_UI.voice}</span>
              <AiMark small title="AI の音声（Gemini TTS）" />
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-1.5 text-xs font-bold text-danger" data-incoming-error>
            {error}
          </p>
        )}

        <div className="sticky bottom-0 -mx-5 mt-3 bg-panel px-5 pt-1" data-incoming-reply={canReply ? "" : undefined}>
          <CallReply
            asks={CALL_IN_ASKS}
            lines={lines}
            canReply={canReply}
            busy={busy}
            onSend={send}
            onHangUp={done}
            mark="incoming"
            extra={
              voiceOk ? (
                <Button kind="plain" size="lg" icon={SpeakerWaveIcon} onClick={() => void play()} disabled={playing} data-incoming-action="play">
                  {CALL_UI.play}
                </Button>
              ) : null
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 画面の下の帯（鳴っている間・保留の 1 行）の高さぶんの余白（T184）。帯は画面に重ねて留めるので、画面の終わりに同じ高さを足し、
 * 送れば帯の下に隠れた物（地図・手配の列の末尾）にも手が届くように
 */
function IncomingRoom() {
  return <div aria-hidden className="h-40 sm:h-24" data-incoming-room />;
}
