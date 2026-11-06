"use client";

// 本人のページの書類の段（T150）。最初は計画書・医療要約・本人の 1 枚（lib/person-documents.ts の FIRST_DOCUMENTS）の行だけを、
// 名前と「表示」「印刷」の 1 行で出す。ほかの書類と、書類ごとの「何の書類か」の 1 行（lib/forms/catalog.ts）は「他 N 件」で開く。
// 紙面ができた書類（href あり）は「表示」と「印刷」を並べ、1 押しで印刷の画面まで行ける。まだの物は「準備中」。
// 開け閉めは手元の状態だけ（初めは閉じている。サーバーの描画と食い違わない）。<details> の既定の▼は使わない。
// 面の行（PersonView の Blocks）と同じ dl の中に置くので、行は div > dt・dd の形のまま。

import { useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { OpenIcon, PaperIcon, PrintIcon } from "@/components/ui/Icon";
import { DOCUMENT_FOLD_LABELS as L } from "@/lib/labels";
import type { DocumentView } from "@/lib/person";
import { splitDocuments } from "@/lib/person-documents";

const LABEL_COL = "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2";

/** 印刷の行き先。紙面の画面を ?print=1 で開くと、開いてすぐ印刷の画面が出る（components/ui/PrintButton の auto） */
export function printHref(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}print=1`;
}

export function DocumentSection({ documents }: { documents: readonly DocumentView[] }) {
  const [open, setOpen] = useState(false);
  const { first, rest } = splitDocuments(documents);
  const hasAbout = documents.some((d) => d.about);
  const foldable = rest.length > 0 || hasAbout;
  const shown = open ? [...first, ...rest] : first;
  return (
    <>
      {shown.map((d) => (
        <DocumentRow key={d.key} doc={d} about={open} />
      ))}
      {foldable && (
        <div className={LABEL_COL} data-documents-fold={open ? "open" : "closed"}>
          <dt className="sr-only">{open ? L.close : L.detail}</dt>
          <dd className="col-start-2">
            <Button
              kind="quiet"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              data-documents-toggle
            >
              {open ? L.close : rest.length > 0 ? `${L.more} ${rest.length} ${L.unit}` : L.detail}
              <OpenIcon aria-hidden className={`size-3.5 shrink-0 text-muted ${open ? "rotate-180" : ""}`} />
            </Button>
          </dd>
        </div>
      )}
    </>
  );
}

/** 書類の行。about は「何の書類か」の 1 行を出すか（開いたときだけ） */
function DocumentRow({ doc, about }: { doc: DocumentView; about: boolean }) {
  return (
    <div className={`${LABEL_COL} items-center`} data-field={`documents.${doc.key}`}>
      <dt className="text-xs text-muted">{doc.label}</dt>
      <dd className={doc.href ? "flex flex-wrap gap-1" : "text-xs text-muted"}>
        {doc.href ? (
          <>
            {/* 読み上げの名前は書類の名前から（T162。行ごとに同じ「表示」「印刷」が並び、スマホ入口の「表示」を計画書と取り違えた） */}
            <ButtonLink href={doc.href} kind="plain" size="sm" icon={PaperIcon} aria-label={`${doc.label} ${doc.status}`}>
              {doc.status}
            </ButtonLink>
            <ButtonLink href={printHref(doc.href)} kind="plain" size="sm" icon={PrintIcon} aria-label={`${doc.label} ${L.print}`} data-print-link={doc.key}>
              {L.print}
            </ButtonLink>
          </>
        ) : (
          doc.status
        )}
      </dd>
      {/* 何の書類か（正式な名前・誰が誰に出す・版。lib/forms/catalog.ts） */}
      {about && doc.about && (
        <dd className="col-start-2 text-xs text-muted" data-document-about={doc.key}>
          {doc.about}
        </dd>
      )}
    </div>
  );
}
