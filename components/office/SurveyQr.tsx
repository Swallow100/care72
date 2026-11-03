"use client";

// アンケートの共有のリンクの QR（docs/tasks/T65.md）。画面に小さく出し、「QR保存」で PNG を保存する（Word の紙に貼る）。
// PNG は白地に黒、周りの白（4 点）込みで一辺 1200px 前後（点 1 つを整数の px にしてぼかさない）。名前に token を入れない。
// 描くのは端末の canvas（新しい API・頁を足さない。ログインなしで開ける頁を増やさない）。

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DownloadIcon } from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import { qrMatrix, qrSvgPath, QR_QUIET } from "@/lib/qr/image";
import { SURVEY_OFFICE_LABELS as L } from "@/lib/survey/text";

/** 保存する PNG の名前 */
export const SURVEY_QR_FILE = "care72-survey-qr.png";

/** PNG の一辺の目安（px） */
const TARGET_PX = 1200;

/** QR の点の並びを canvas に描いて PNG にする */
function qrPng(url: string): Promise<Blob | null> {
  const m = qrMatrix(url);
  const box = m.size + QR_QUIET * 2;
  const scale = Math.max(4, Math.round(TARGET_PX / box));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = box * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (m.dark[y][x]) ctx.fillRect((x + QR_QUIET) * scale, (y + QR_QUIET) * scale, scale, scale);
    }
  }
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** 画面に出す小さな QR（白地に黒。ダークでも反転させない） */
export function SurveyQrImage({ url, px = 112 }: { url: string; px?: number }) {
  const m = qrMatrix(url);
  const box = m.size + QR_QUIET * 2;
  return (
    <svg
      viewBox={`0 0 ${box} ${box}`}
      width={px}
      height={px}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR"
      className="block shrink-0 rounded"
      data-survey-qr
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={qrSvgPath(m)} fill="#000" />
    </svg>
  );
}

export function SurveyQrSave({ url, inPanel2 = false }: { url: string; inPanel2?: boolean }) {
  const [failed, setFailed] = useState(false);
  async function save() {
    setFailed(false);
    try {
      const blob = await qrPng(url);
      if (!blob) throw new Error("png");
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = SURVEY_QR_FILE;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setFailed(true);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Button kind={inPanel2 ? "plainIn" : "plain"} icon={DownloadIcon} onClick={() => void save()}>
        {L.qrSave}
      </Button>
      {failed && (
        <span role="status" className="text-sm">
          <StateText tone="check">{L.failed}</StateText>
        </span>
      )}
    </span>
  );
}
