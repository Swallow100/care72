// T172: PC のカメラで QR を読む。組み込みの読み取りが無い端末は jsQR で読む。カメラの頼み方と断りの理由。
// 本物の QR の点の並び（lib/qr/image.ts、本人の 1 枚の裏と同じ物）を絵にして jsQR に渡し、トークンまで取れることを確かめる。

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { CAMERA_CONSTRAINTS, cameraAvailable, cameraProblemOf, detectorOf, nativeReader, QrCamera, tokenOfCodes } from "../../components/staff/QrCamera.tsx";
import { qrMatrix, QR_QUIET } from "../qr/image.ts";
import { qrTokenFrom } from "./entry.ts";
import { ENTRY_LABELS } from "./labels.ts";

/** 点の並びを RGBA の絵に（白地に黒、1 マス scale 画素、周りに静かな余白） */
function rgbaOf(url: string, scale = 4) {
  const m = qrMatrix(url);
  const cells = m.size + QR_QUIET * 2;
  const w = cells * scale;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  const dark = (x: number, y: number) => {
    const cx = Math.floor(x / scale) - QR_QUIET;
    const cy = Math.floor(y / scale) - QR_QUIET;
    return cx >= 0 && cy >= 0 && cx < m.size && cy < m.size && m.dark[cy]![cx]!;
  };
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      if (!dark(x, y)) continue;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }
  return { data, w };
}

describe("jsQR で読む", () => {
  it("本人の 1 枚の QR の URL を読み、トークンだけを取り出す", () => {
    const token = `${"a".repeat(40)}.${"b".repeat(43)}`;
    const url = `https://care72.app/q/${token}`;
    const { data, w } = rgbaOf(url);
    const code = jsQR(data, w, w, { inversionAttempts: "dontInvert" });
    expect(code?.data).toBe(url);
    expect(qrTokenFrom(code?.data)).toBe(token);
    expect(tokenOfCodes([{ rawValue: code?.data }])).toBe(token);
  });

  it("QR でない絵は読まない", () => {
    const w = 64;
    const data = new Uint8ClampedArray(w * w * 4).fill(200);
    expect(jsQR(data, w, w, { inversionAttempts: "dontInvert" })).toBeNull();
  });
});

describe("読み方の選び方", () => {
  it("組み込みの読み取りが無い端末は jsQR に回す（null）", async () => {
    expect(detectorOf({})).toBeNull();
    expect(await nativeReader(null)).toBeNull();
  });
  it("部品はあるが QR を読めない端末も jsQR に回す。作れない部品も", async () => {
    class NoQr {
      static getSupportedFormats = async () => ["ean_13"];
      detect = async () => [];
    }
    expect(await nativeReader(NoQr as never)).toBeNull();
    class Broken {
      constructor() {
        throw new Error("無い");
      }
    }
    expect(await nativeReader(Broken as never)).toBeNull();
  });
  it("QR を読める組み込みの読み取りがあれば使う", async () => {
    class Good {
      static getSupportedFormats = async () => ["qr_code"];
      detect = async () => [{ rawValue: "x" }];
    }
    const read = await nativeReader(Good as never);
    expect(await read!({} as HTMLVideoElement)).toEqual([{ rawValue: "x" }]);
  });
});

describe("カメラの頼み方", () => {
  it("背面は ideal で頼む（前面だけの PC でも開く）。音は取らない", () => {
    expect(CAMERA_CONSTRAINTS).toEqual({ video: { facingMode: { ideal: "environment" } }, audio: false });
  });
  it("カメラの口の有無で分ける。BarcodeDetector の有無では分けない", () => {
    expect(cameraAvailable({ mediaDevices: { getUserMedia: () => {} } })).toBe(true);
    expect(cameraAvailable({})).toBe(false);
    expect(cameraAvailable(undefined)).toBe(false);
  });
  it("断りの理由を分ける", () => {
    expect(cameraProblemOf({ name: "NotFoundError" })).toBe("none");
    expect(cameraProblemOf({ name: "NotAllowedError" })).toBe("denied");
    expect(cameraProblemOf({ name: "NotReadableError" })).toBe("busy");
    expect(cameraProblemOf(new Error("x"))).toBe("failed");
  });
  it("言葉は短く", () => {
    for (const w of [ENTRY_LABELS.cameraNone, ENTRY_LABELS.cameraDenied, ENTRY_LABELS.cameraBusy, ENTRY_LABELS.cameraFail]) {
      expect(w.length).toBeLessThanOrEqual(5);
    }
  });
});

describe("頁を重くしない・送らない", () => {
  const src = readFileSync(new URL("../../components/staff/QrCamera.tsx", import.meta.url), "utf8");
  it("jsQR は動的 import だけ（頁の最初の読み込みに入れない）", () => {
    expect(src).toContain('await import("jsqr")');
    expect(src).not.toMatch(/^import .*jsqr/m);
  });
  it("映像を送る・残す口が無い（fetch・toDataURL・toBlob・MediaRecorder）", () => {
    expect(src).not.toMatch(/fetch\(|toDataURL|toBlob|MediaRecorder|localStorage|sendBeacon/);
  });
  it("描いた直後はサーバーと同じ形（カメラの口を確かめる前）", () => {
    expect(renderToStaticMarkup(createElement(QrCamera, { onToken: () => {} }))).toContain('data-camera="os"');
  });
});
