"use client";

// 端末のカメラで本人の 1 枚の裏の QR を読む（T152、受入の入り方の「QR 読取」。PC は T172）。
// 読み方は 2 つ: ブラウザの組み込みの読み取り（BarcodeDetector。Android の Chrome など）があればそれ、無ければ jsQR（Windows の Chrome・Safari など）。
// jsQR は「カメラ起動」を押した時に読みに行く（動的 import。頁の最初の読み込みを重くしない）。
// PC は前面のカメラしか無いので、背面（environment）は ideal で頼み、外れても開く。
// カメラの口が無いブラウザ（http の頁など）だけ、ボタンを出さず「写すと受入頁」の 1 語: 端末のカメラのアプリで QR を写すと
// QR の頁（/q/<token>）が開き、そこの「受入」から受け入れる。カメラが無い・断られた時は理由を短く出す。
// 読めた文字からトークンだけを取り出し（lib/custody/entry.ts の qrTokenFrom）、カメラを止めてから onToken に渡す。
// 映像は端末の中だけで読み、送らない・残さない（jsQR に渡す絵も画面に置かない canvas の中だけ）。テストと絵は偽のカメラ（Chrome の fake device）で確かめる。

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CameraIcon, CloseIcon } from "@/components/ui/Icon";
import { qrTokenFrom } from "@/lib/custody/entry";
import { ENTRY_LABELS } from "@/lib/custody/labels";

type Detector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>> };
type DetectorCtor = (new (opts: { formats: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> };

/** 読み取りの間隔（ミリ秒） */
const SCAN_MS = 250;
/** jsQR に渡す絵の長い辺（大きいと 1 回が重い） */
const SCAN_SIZE = 640;

/** ブラウザの読み取りの部品（無ければ null） */
export function detectorOf(w: unknown): DetectorCtor | null {
  const d = (w as { BarcodeDetector?: unknown } | null | undefined)?.BarcodeDetector;
  return typeof d === "function" ? (d as DetectorCtor) : null;
}

/** 読めた文字の並びから、初めのトークン（無ければ null） */
export function tokenOfCodes(codes: ReadonlyArray<{ rawValue?: string }>): string | null {
  for (const c of codes) {
    const t = qrTokenFrom(c.rawValue);
    if (t) return t;
  }
  return null;
}

/** カメラの口があるか（無いのは http の頁・古いブラウザ） */
export function cameraAvailable(nav: unknown): boolean {
  return typeof (nav as { mediaDevices?: { getUserMedia?: unknown } } | null | undefined)?.mediaDevices?.getUserMedia === "function";
}

/** カメラの頼み方。外れても開くように背面は ideal（前面だけの PC でも開く） */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: { ideal: "environment" } }, audio: false };

export type CameraProblem = "none" | "denied" | "busy" | "failed";

/** getUserMedia の断りの理由 */
export function cameraProblemOf(e: unknown): CameraProblem {
  switch ((e as { name?: unknown } | null)?.name) {
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "none";
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "failed";
  }
}

const PROBLEM_LABELS: Record<CameraProblem, string> = {
  none: ENTRY_LABELS.cameraNone,
  denied: ENTRY_LABELS.cameraDenied,
  busy: ENTRY_LABELS.cameraBusy,
  failed: ENTRY_LABELS.cameraFail,
};

/** 絵から読む関数（1 回分）。読めなければ空 */
type Reader = (v: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;

/** 組み込みの読み取りが QR を読めるなら、その読み方。読めない・作れない端末は null（jsQR に回す） */
export async function nativeReader(Ctor: DetectorCtor | null): Promise<Reader | null> {
  if (!Ctor) return null;
  try {
    // Android で部品だけあって QR を読めない端末がある
    if (Ctor.getSupportedFormats && !(await Ctor.getSupportedFormats()).includes("qr_code")) return null;
    const detector = new Ctor({ formats: ["qr_code"] });
    return (v) => detector.detect(v);
  } catch {
    return null;
  }
}

/** jsQR の読み方。絵は画面に置かない canvas の中だけ */
async function jsqrReader(): Promise<Reader> {
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (v) => {
    if (!ctx || v.videoWidth === 0) return [];
    const k = Math.min(1, SCAN_SIZE / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * k);
    const h = Math.round(v.videoHeight * k);
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(v, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    return code ? [{ rawValue: code.data }] : [];
  };
}

export function QrCamera({ onToken }: { onToken: (token: string) => void }) {
  // 描いた直後は分からない（サーバーと同じ形で描き、端末で確かめてからボタンに替える）
  const [supported, setSupported] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(false);
  // 起動を待つ間に止めた・画面を離れた時に、遅れて開いたカメラを止める
  const attempt = useRef(0);

  useEffect(() => {
    setSupported(cameraAvailable(navigator));
  }, []);

  const stop = useCallback(() => {
    attempt.current += 1;
    live.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setOn(false);
    setStarting(false);
  }, []);

  // 画面を離れたらカメラを止める
  useEffect(() => stop, [stop]);

  async function start() {
    const mine = ++attempt.current;
    setProblem(null);
    setStarting(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      if (mine !== attempt.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const read = (await nativeReader(detectorOf(window))) ?? (await jsqrReader());
      if (mine !== attempt.current) return;
      live.current = true;
      setOn(true);
      setStarting(false);
      const v = video.current;
      if (!v) return stop();
      v.srcObject = s;
      await v.play().catch(() => {});
      const tick = async () => {
        if (!live.current) return;
        try {
          if (v.readyState >= 2) {
            const token = tokenOfCodes(await read(v));
            if (token) {
              stop();
              onToken(token);
              return;
            }
          }
        } catch {
          // 1 回読めなくても続ける（映像の準備前など）
        }
        if (live.current) timer.current = setTimeout(tick, SCAN_MS);
      };
      void tick();
    } catch (e) {
      if (mine !== attempt.current) return;
      stop();
      setProblem(cameraProblemOf(e));
    }
  }

  if (!supported) {
    return (
      <p className="text-sm" data-camera="os">
        {ENTRY_LABELS.cameraOs}
      </p>
    );
  }
  return (
    <div className="space-y-1.5" data-camera="app">
      <div className="flex flex-wrap items-center gap-2">
        {on ? (
          <Button kind="quiet" size="sm" icon={CloseIcon} onClick={stop}>
            {ENTRY_LABELS.cameraStop}
          </Button>
        ) : (
          <Button kind="main" icon={CameraIcon} onClick={start} disabled={starting} data-pending={starting || undefined} data-camera-start>
            {ENTRY_LABELS.cameraStart}
          </Button>
        )}
        {problem && (
          <span role="alert" className="text-sm font-bold text-danger" data-camera-problem={problem}>
            {PROBLEM_LABELS[problem]}
          </span>
        )}
      </div>
      {/* 映像は止めている間も場所を取らない（hidden）。黒い箱を常に置かない */}
      <video ref={video} muted playsInline hidden={!on} className="aspect-square w-full max-w-64 rounded-md bg-panel2 object-cover" />
    </div>
  );
}
