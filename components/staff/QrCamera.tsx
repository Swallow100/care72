"use client";

// 端末のカメラで本人の 1 枚の裏の QR を読む（T152、受入の入り方の「QR 読取」）。
// アプリの中で読むのは、ブラウザの組み込みの読み取り（BarcodeDetector）が使える端末だけ（Android の Chrome など。依存は足さない）。
// 使えない端末（iPhone・iPad の Safari など）はボタンを出さず「写すと受入頁」の 1 語だけ: 端末のカメラのアプリで QR を写すと
// QR の頁（/q/<token>）が開き、そこの「受入」から受け入れる。
// 読めた文字からトークンだけを取り出し（lib/custody/entry.ts の qrTokenFrom）、カメラを止めてから onToken に渡す。
// 映像は端末の中だけで読み、送らない・残さない。テストと絵は偽のカメラ（Chrome の fake device）と偽の読み取りで確かめる。

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CameraIcon, CloseIcon } from "@/components/ui/Icon";
import { qrTokenFrom } from "@/lib/custody/entry";
import { ENTRY_LABELS } from "@/lib/custody/labels";

type Detector = { detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>> };
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

/** 読み取りの間隔（ミリ秒） */
const SCAN_MS = 250;

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

export function QrCamera({ onToken }: { onToken: (token: string) => void }) {
  // 描いた直後は分からない（サーバーと同じ形で描き、端末で確かめてからボタンに替える）
  const [supported, setSupported] = useState<boolean | null>(null);
  const [on, setOn] = useState(false);
  const [error, setError] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(false);

  useEffect(() => {
    setSupported(detectorOf(window) !== null && typeof navigator.mediaDevices?.getUserMedia === "function");
  }, []);

  const stop = useCallback(() => {
    live.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setOn(false);
  }, []);

  // 画面を離れたらカメラを止める
  useEffect(() => stop, [stop]);

  async function start() {
    const Ctor = detectorOf(window);
    if (!Ctor) return;
    setError(false);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      stream.current = s;
      live.current = true;
      setOn(true);
      const v = video.current;
      if (!v) return stop();
      v.srcObject = s;
      await v.play().catch(() => {});
      const detector = new Ctor({ formats: ["qr_code"] });
      const tick = async () => {
        if (!live.current) return;
        try {
          if (v.readyState >= 2) {
            const token = tokenOfCodes(await detector.detect(v));
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
    } catch {
      stop();
      setError(true);
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
          <Button kind="main" icon={CameraIcon} onClick={start} data-camera-start>
            {ENTRY_LABELS.cameraStart}
          </Button>
        )}
        {error && (
          <span role="alert" className="text-sm font-bold text-danger">
            {ENTRY_LABELS.cameraFail}
          </span>
        )}
      </div>
      {/* 映像は止めている間も場所を取らない（hidden）。黒い箱を常に置かない */}
      <video ref={video} muted playsInline hidden={!on} className="aspect-square w-full max-w-64 rounded-md bg-panel2 object-cover" />
    </div>
  );
}
