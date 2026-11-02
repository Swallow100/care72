// 汎用の差し込みの紙面（A4 縦）。対応表の欄の順に、欄の名前と台帳の値を 2 列の表で並べる（lib/forms/mapped-sheet.ts）。
// 元の様式の見た目（罫線・欄の位置）は再現しない。頁は対応表の頁ごと。段の見出しがあれば段ごとに枠を分ける。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。見た目は paper.css と mapped-paper.css（読み込むのはページの側）。

import type { CSSProperties } from "react";
import type { MappedSheet as Sheet } from "@/lib/forms/mapped-sheet";
import { FormCell } from "./FormCell";

const cols: CSSProperties = { gridTemplateColumns: "48mm minmax(0, 1fr)" };

export type MappedSheetMeta = {
  /** 作成日（和暦の文字） */
  date: string;
  /** 対応表を確かめた日と人 */
  checked: string;
};

export function MappedSheet({ sheet, meta }: { sheet: Sheet; meta: MappedSheetMeta }) {
  const total = sheet.pages.length;
  return (
    <div className="paper-scroll">
      <div className="paper-stack">
        {sheet.pages.map((p, i) => (
          <section key={p.page} className="paper mapped" aria-label={`${p.page} ページ`} data-page={p.page}>
            <div className="top">
              <span>{sheet.issuer}</span>
              <span className="nowrap">
                {i + 1} / {total}
              </span>
            </div>
            <h1 className="title">{sheet.title}</h1>
            <div className="top">
              <span>
                対象者 <span className="p-strong">{sheet.name}</span>
              </span>
              <span className="nowrap">{meta.date} 作成</span>
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
            <div className="small-note foot-note">ケア72 様式対応 確認 {meta.checked}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
