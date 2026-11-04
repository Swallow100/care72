"use client";

// 元の様式の原本の取り込み（T101。紙面の画面の上の帯、印刷で消える）。押すと公式の URL の PDF をサーバー経由で取り
// （lib/forms/originals-http.ts。版のハッシュを確かめる）、ブラウザの pdf.js で刷る解像度（400dpi）の PNG にして事業所に置く。
// 公式の頁から取れないとき（止まっている・版が変わった）は、事業所が落とした原本の PDF を選んで同じ流れに。版が違えば断る。
// 原本は配信に入れない（docs/progress/t101.md「原本の置き場」）。Claude は呼ばない。

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DownloadIcon, ReadIcon } from "@/components/ui/Icon";
import { StateTag } from "@/components/ui/Tag";
import {
  ORIGINAL_ERROR_LABELS,
  ORIGINALS,
  originalImportHref,
  originalSourceHref,
  rasterScale,
  sha256Hex,
  type OriginalError,
  type OriginalId,
} from "@/lib/forms/originals";

type State = { kind: "idle" } | { kind: "busy"; step: string } | { kind: "error"; label: string; pick: boolean };

/** PDF の頁を刷る解像度の PNG に（白い地。iPhone の canvas の上限を超えるなら解像度を下げる） */
async function rasterize(pdf: Uint8Array, pages: readonly number[]): Promise<Map<number, Blob>> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  }
  const task = pdfjs.getDocument({ data: pdf.slice(), enableXfa: false });
  const doc = await task.promise;
  const out = new Map<number, Blob>();
  try {
    for (const n of pages) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: rasterScale(base.width, base.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (!blob) throw new Error("png");
      out.set(n, blob);
    }
  } finally {
    void task.destroy();
  }
  return out;
}

export function OriginalImport({ id }: { id: OriginalId }) {
  const spec = ORIGINALS[id];
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  async function importPdf(pdf: Uint8Array) {
    if ((await sha256Hex(pdf)) !== spec.sha256) {
      setState({ kind: "error", label: ORIGINAL_ERROR_LABELS.version, pick: true });
      return;
    }
    setState({ kind: "busy", step: "変換中" });
    let pages: Map<number, Blob>;
    try {
      pages = await rasterize(pdf, spec.usePages);
    } catch {
      setState({ kind: "error", label: ORIGINAL_ERROR_LABELS.invalid, pick: true });
      return;
    }
    setState({ kind: "busy", step: "保存中" });
    const form = new FormData();
    form.set("pdf", new Blob([pdf.slice()], { type: "application/pdf" }), `${id}.pdf`);
    for (const [n, blob] of pages) form.set(`page${n}`, blob, `${n}.png`);
    const res = await fetch(originalImportHref(id), { method: "POST", body: form }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: OriginalError } | null;
      setState({ kind: "error", label: ORIGINAL_ERROR_LABELS[body?.error ?? "store_failed"] ?? ORIGINAL_ERROR_LABELS.store_failed, pick: false });
      return;
    }
    setState({ kind: "idle" });
    router.refresh();
  }

  async function fromSource() {
    setState({ kind: "busy", step: "取得中" });
    const res = await fetch(originalSourceHref(id)).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: OriginalError } | null;
      setState({ kind: "error", label: ORIGINAL_ERROR_LABELS[body?.error ?? "source_failed"] ?? ORIGINAL_ERROR_LABELS.source_failed, pick: true });
      return;
    }
    await importPdf(new Uint8Array(await res.arrayBuffer()));
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setState({ kind: "busy", step: "確認中" });
    await importPdf(new Uint8Array(await file.arrayBuffer()));
  }

  const busy = state.kind === "busy";
  return (
    <span className="flex flex-wrap items-center gap-2" data-original-import={id}>
      <StateTag tone="check">原本未取込</StateTag>
      <Button kind="main" size="sm" icon={DownloadIcon} disabled={busy} onClick={fromSource} data-original-fetch>
        {busy ? state.step : "原本取込"}
      </Button>
      {state.kind === "error" && (
        <>
          <span className="text-sm font-bold text-danger" role="alert">
            {state.label}
          </span>
          {state.pick && (
            <>
              <Button kind="plain" size="sm" icon={ReadIcon} onClick={() => fileRef.current?.click()}>
                原本選択
              </Button>
              <a href={spec.url} target="_blank" rel="noreferrer" className="text-sm text-accent underline underline-offset-2" data-press>
                公式頁
              </a>
            </>
          )}
        </>
      )}
      <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={(e) => void fromFile(e.target.files?.[0])} />
    </span>
  );
}
