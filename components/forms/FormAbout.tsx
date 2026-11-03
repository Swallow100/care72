// 紙面の画面の上の帯（components/ui/PaperBar）のすぐ下に置く、何の書類かの 1 行（画面だけ。紙には出さない）。
// 言葉は書類の一覧（lib/forms/catalog.ts）から。元の様式のリンクがあれば添える（リポジトリには入れない、開いて照らすだけ）。
// 既定の幅と余白は PaperBar の既定（紙の幅）と同じ。QR の画面のように外の枠に従うときは className で渡す。

import { aboutLine, type CatalogEntry } from "@/lib/forms/catalog";

const PAPER_BOX = "screen-only mx-auto -mt-2 mb-4 max-w-[calc(210mm+2rem)] px-4";

export function FormAbout({ entry, about, className = PAPER_BOX }: { entry: CatalogEntry; about?: string; className?: string }) {
  return (
    <p className={`${className} text-xs text-muted`} data-form-about={entry.id}>
      {about ?? aboutLine(entry)}
      {entry.url && (
        <>
          {" "}
          <a href={entry.url} target="_blank" rel="noreferrer" className="-mx-0.5 rounded px-0.5 text-accent underline underline-offset-2" data-press>
            元様式
          </a>
        </>
      )}
    </p>
  );
}
