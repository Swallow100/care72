"use client";

// 元の様式の原本の取り込み（T101。紙面の画面の上の帯、印刷で消える）。押すと公式の URL の PDF をサーバー経由で取り
// （lib/forms/originals-http.ts。版のハッシュを確かめる）、ブラウザの pdf.js で刷る解像度（400dpi）の PNG にして事業所に置く。
// 公式の頁から取れないとき（止まっている・版が変わった）は、事業所が落とした原本の PDF を選んで同じ流れに。版が違えば断る。
// 原本は配信に入れない（docs/progress/t101.md「原本の置き場」）。Claude は呼ばない。
// 帯の移り（T114）: 原本未取込 → 取得中・確認中 → 変換中 → 保存中 → 取込済（反映中）→ 描き直して原本の紙に替わる（この帯ごと消える）。
// 保存できたあと描き直すまでの数秒も「取込済 反映中」で押せない（前は「原本未取込」に戻って、取り込めたか分からなかった）。
// 描き直しても紙が替わらない（帯が残る）ときは「取込済」と「再表示」。途中で投げた物も含め、失敗はいつも理由の短い言葉で止める。

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { DownloadIcon, ReadIcon, RetryIcon } from "@/components/ui/Icon";
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

/** 帯の言葉（2〜4 字） */
export const IMPORT_LABELS = {
  missing: "原本未取込",
  fetch: "原本取込",
  fetching: "取得中",
  checking: "確認中",
  converting: "変換中",
  saving: "保存中",
  done: "取込済",
  reflecting: "反映中",
  reload: "再表示",
  pick: "原本選択",
  page: "公式頁",
} as const;

type Step = (typeof IMPORT_LABELS)["fetching" | "checking" | "converting" | "saving"];
export type ImportState = { kind: "idle" } | { kind: "busy"; step: Step } | { kind: "done" } | { kind: "error"; label: string; pick: boolean };

/** 失敗の言葉（応答の error が無い・知らない物は fallback） */
function errorLabel(error: OriginalError | undefined, fallback: OriginalError): string {
  return (error && ORIGINAL_ERROR_LABELS[error]) || ORIGINAL_ERROR_LABELS[fallback];
}

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

/** 取り込みの流れが使う物（画面は本物、テストは偽物を渡す） */
export type ImportDeps = {
  id: OriginalId;
  spec: Pick<(typeof ORIGINALS)[OriginalId], "sha256" | "usePages">;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  sha256Hex: (pdf: Uint8Array) => Promise<string>;
  rasterize: (pdf: Uint8Array, pages: readonly number[]) => Promise<Map<number, Blob>>;
  set: (s: ImportState) => void;
};

/** 失敗で止める（応答の本文に error があればその言葉） */
async function failWith(d: ImportDeps, error: OriginalError, pick: boolean, res?: Response | null): Promise<false> {
  const body = res ? ((await res.json().catch(() => null)) as { error?: OriginalError } | null) : null;
  d.set({ kind: "error", label: errorLabel(body?.error, error), pick });
  return false;
}

/** PDF の版を確かめ、頁を PNG にして事業所に置く。置けたら「取込済」にして true（描き直しは呼び手） */
export async function importPdf(d: ImportDeps, pdf: Uint8Array): Promise<boolean> {
  let same: boolean;
  try {
    same = (await d.sha256Hex(pdf)) === d.spec.sha256;
  } catch {
    return failWith(d, "invalid", true);
  }
  if (!same) return failWith(d, "version", true);
  d.set({ kind: "busy", step: IMPORT_LABELS.converting });
  let pages: Map<number, Blob>;
  try {
    pages = await d.rasterize(pdf, d.spec.usePages);
  } catch {
    return failWith(d, "invalid", true);
  }
  d.set({ kind: "busy", step: IMPORT_LABELS.saving });
  let res: Response | null;
  try {
    const form = new FormData();
    form.set("pdf", new Blob([pdf.slice()], { type: "application/pdf" }), `${d.id}.pdf`);
    for (const [n, blob] of pages) form.set(`page${n}`, blob, `${n}.png`);
    res = await d.fetch(originalImportHref(d.id), { method: "POST", body: form });
  } catch {
    res = null;
  }
  if (!res?.ok) return failWith(d, "store_failed", false, res);
  // 保存できた。描き直すまで「取込済 反映中」（「原本未取込」に戻さない）
  d.set({ kind: "done" });
  return true;
}

/** 公式の頁から取る（サーバー経由）。取れなければ「原本選択」「公式頁」を出す */
export async function importFromSource(d: ImportDeps): Promise<boolean> {
  d.set({ kind: "busy", step: IMPORT_LABELS.fetching });
  let pdf: Uint8Array;
  try {
    const res = await d.fetch(originalSourceHref(d.id));
    if (!res.ok) return failWith(d, "source_failed", true, res);
    pdf = new Uint8Array(await res.arrayBuffer());
  } catch {
    return failWith(d, "source_failed", true);
  }
  return importPdf(d, pdf);
}

/** 事業所が落とした原本の PDF を選んだとき */
export async function importFromFile(d: ImportDeps, file: Pick<Blob, "arrayBuffer">): Promise<boolean> {
  d.set({ kind: "busy", step: IMPORT_LABELS.checking });
  let pdf: Uint8Array;
  try {
    pdf = new Uint8Array(await file.arrayBuffer());
  } catch {
    return failWith(d, "invalid", true);
  }
  return importPdf(d, pdf);
}

export function OriginalImport({ id }: { id: OriginalId }) {
  const spec = ORIGINALS[id];
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  // 描き直し（router.refresh）が済むまで真。済むと親が原本の紙に替え、この帯ごと消える
  const [reflecting, startReflect] = useTransition();
  const deps: ImportDeps = { id, spec, fetch: (input, init) => fetch(input, init), sha256Hex, rasterize, set: setState };

  function reflect() {
    startReflect(() => router.refresh());
  }

  return (
    <ImportBand
      id={id}
      state={state}
      reflecting={reflecting}
      officialUrl={spec.url}
      onFetch={() => void importFromSource(deps).then((ok) => ok && reflect())}
      onReload={reflect}
      onPick={() => fileRef.current?.click()}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFromFile(deps, file).then((ok) => ok && reflect());
        }}
      />
    </ImportBand>
  );
}

/**
 * 帯の見た目（状態から描くだけ。テストは各状態をこれで描く）。
 * - 取込済の前: 黄の「原本未取込」と主の「原本取込」（途中はその段の言葉で押せない）。失敗は赤の太字の理由と、選べるなら「原本選択」「公式頁」
 * - 取込済: 緑の「取込済」。描き直しの間は「反映中」で押せない。描き直しても帯が残れば「再表示」
 */
export function ImportBand({
  id,
  state,
  reflecting,
  officialUrl,
  onFetch,
  onReload,
  onPick,
  children,
}: {
  id: OriginalId;
  state: ImportState;
  reflecting: boolean;
  officialUrl: string;
  onFetch: () => void;
  onReload: () => void;
  onPick: () => void;
  children?: React.ReactNode;
}) {
  if (state.kind === "done") {
    return (
      <span className="flex flex-wrap items-center gap-2" data-original-import={id} data-import-state={reflecting ? "reflecting" : "done"} role="status">
        <StateTag tone="ok">{IMPORT_LABELS.done}</StateTag>
        <Button kind="plain" size="sm" icon={RetryIcon} disabled={reflecting} onClick={onReload} data-original-reload>
          {reflecting ? IMPORT_LABELS.reflecting : IMPORT_LABELS.reload}
        </Button>
        {children}
      </span>
    );
  }
  const busy = state.kind === "busy";
  return (
    <span className="flex flex-wrap items-center gap-2" data-original-import={id} data-import-state={state.kind}>
      <StateTag tone="check">{IMPORT_LABELS.missing}</StateTag>
      <Button kind="main" size="sm" icon={DownloadIcon} disabled={busy} onClick={onFetch} data-original-fetch>
        {busy ? state.step : IMPORT_LABELS.fetch}
      </Button>
      {state.kind === "error" && (
        <>
          <span className="text-sm font-bold text-danger" role="alert">
            {state.label}
          </span>
          {state.pick && (
            <>
              <Button kind="plain" size="sm" icon={ReadIcon} onClick={onPick}>
                {IMPORT_LABELS.pick}
              </Button>
              <a href={officialUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline underline-offset-2" data-press>
                {IMPORT_LABELS.page}
              </a>
            </>
          )}
        </>
      )}
      {children}
    </span>
  );
}
