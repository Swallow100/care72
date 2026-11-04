// 紙面の画面の上の帯（components/ui/PaperBar）のすぐ下に置く、何の書類かの 1 行の小さな注（画面だけ。紙には出さない）。
// 中身は正式な名前・誰が誰に出す・版だけ（lib/forms/catalog.ts の aboutParts。説明の文は出さない。T79）。
// 元の様式のリンクがあれば添える（リポジトリには入れない、開いて照らすだけ）。
// 既定の幅と余白は PaperBar の既定（紙の幅）と同じ。QR の画面のように外の枠に従うときは className で渡す。
// 見出しに正式な名前が既にある画面（様式9）は official={false} で名前を省く。

import { aboutParts, ABOUT_SEPARATOR, type CatalogEntry } from "@/lib/forms/catalog";

const PAPER_BOX = "screen-only mx-auto -mt-2 mb-4 max-w-[calc(210mm+2rem)] px-4";

export function FormAbout({
  entry,
  official = true,
  className = PAPER_BOX,
}: {
  entry: CatalogEntry;
  official?: boolean;
  className?: string;
}) {
  return (
    <p className={`${className} text-xs text-muted`} data-form-about={entry.id}>
      {aboutParts(entry, { official }).join(ABOUT_SEPARATOR)}
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
