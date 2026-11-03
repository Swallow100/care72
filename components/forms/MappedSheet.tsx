// 汎用の差し込みの紙面（A4 縦、様式の寸法）。対応表の欄の順に、欄の名前と台帳の値を 2 列の表で並べる（lib/forms/mapped-sheet.ts）。
// 元の様式の見た目（罫線・欄の位置）は再現しない。頁は対応表の頁ごと（表・裏）。段の見出しがあれば段ごとに枠を分ける。
// 題名は上に 1 行、右上に作成日・事業所・作成者と元の様式。頁の下の端に文書名・対象者・頁番号。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。見た目は paper.css と mapped-paper.css（読み込むのはページの側）。

import type { CSSProperties } from "react";
import type { MappedSheet as Sheet } from "@/lib/forms/mapped-sheet";
import { paperText } from "@/lib/forms/paper-text";
import { FormCell } from "./FormCell";
import { PaperFoot } from "./PaperFoot";

const cols: CSSProperties = { gridTemplateColumns: "50mm minmax(0, 1fr)" };

export type MappedSheetMeta = {
  /** 作成日（和暦の文字） */
  date: string;
  /** 対応表を確かめた日と人 */
  checked: string;
  /** 作った事業所 */
  office?: string | null;
  /** 作った人（担当のケアマネ） */
  author?: string | null;
};

export function MappedSheet({ sheet, meta }: { sheet: Sheet; meta: MappedSheetMeta }) {
  const total = sheet.pages.length;
  const by = [meta.office, meta.author ? `${meta.author}（ケアマネ）` : null].filter(Boolean).join(" ");
  return (
    <div className="paper-scroll">
      <div className="paper-stack" data-paper-root data-sheet="mapped" data-person={sheet.personId}>
        {sheet.pages.map((p, i) => (
          <section key={p.page} className="paper form mapped" aria-label={`${p.page} ページ`} data-page={p.page}>
            <div className="head-row">
              <h1 className="title">{sheet.title}</h1>
              <div className="top-col">
                <span className="nowrap">{paperText(meta.date)} 作成</span>
                {by && <span className="nowrap">{by}</span>}
                <span className="nowrap">様式 {sheet.issuer}</span>
              </div>
            </div>
            <div className="top">
              <span>
                対象者 <span>{sheet.name}</span>
              </span>
            </div>
            {p.sections.map((s, j) => (
              <div key={`${s.section}-${j}`} className="blk" data-section={s.section || undefined}>
                {s.section && <div className="blk-h">{s.section}</div>}
                <div className="grid" style={cols}>
                  {s.rows.map((r) => (
                    <div key={r.field.id} className="row" data-field={r.field.id} data-item={r.field.item ?? ""}>
                      <span className="lbl">{r.field.label}</span>
                      <span className="f-v">
                        <FormCell cell={r.cell} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="small-note foot-note">
              <p>※欄の順は元の様式のとおり。値は台帳から差し込み（対応表 確認 {meta.checked}）</p>
            </div>
            <PaperFoot doc={sheet.title} name={sheet.name} page={i + 1} total={total} />
          </section>
        ))}
      </div>
    </div>
  );
}
