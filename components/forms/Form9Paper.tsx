// 様式 9（災害時利用者一覧表 安否確認優先順位）の紙面。A4 横。画面（/office/form9）では出さず、印刷のときだけ出す（画面の表は Form9Table）。
// T101: ひな形（厚労省の BCP ひな形の様式9 のシート）の枠のまま刷る。列幅・行の高さ・余白・字の大きさはひな形の Excel の値（lib/forms/frame-form9.ts）。
//   1 枚のひな形は 20 行。21 人目からは同じ枠の 2 枚目（No は続き）。値は欄の大きさに収まる字（6.57pt から 6pt）で、収まらなければ欄に「別紙」。
//   ひな形に無いケア72 の欄（連絡順・理由・緊急連絡先・安否確認の方法と結果・順位の手直し）と、欄に収まらない値は、あとの「別紙」の表に。
//   発災時は別紙のあとに市町村への報告の下書き（lib/forms/form9-report.ts の文。Claude は呼ばない）。
//   fill（?fill=1）で、人のいる行の値の無い欄の内側を要確認の黄の薄い色で塗る（罫線から離す。既定は色なし）。
// 頁の下の端の文書名と頁番号は別紙の頁だけ（form9-paper.css の @page form9。ひな形の頁には刷らない）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。

import type { CSSProperties } from "react";
import { FORM9_COLUMNS, type Form9Row, type Form9Sheet } from "@/lib/forms/form9";
import {
  form9Cell,
  FORM9_COL_X,
  FORM9_FONT_PT,
  FORM9_HEADS,
  FORM9_MARGIN_MM,
  FORM9_ROW_Y,
  FORM9_ROWS_PER_PAGE,
  FORM9_VALUE_COLS,
  form9Lines,
  type Form9ValueColumn,
} from "@/lib/forms/frame-form9";
import { ANNEX_MARK, fitText, FONT_MIN_PT } from "@/lib/forms/overlay-sheet";
import { paperText } from "@/lib/forms/paper-text";
import { KeepNumbers } from "./FormCell";

/** 題名（ひな形のシートの題名 FORM9_TITLE を、紙の書き方の全角の括弧に） */
export const FORM9_PAPER_TITLE = "様式9：災害時利用者一覧表（安否確認優先順位）";

/** 頁の下の端の文字（CSS の文字列。名前に引用符や改行があっても壊れないように） */
export function cssString(s: string): string {
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r]/g, " ")}"`;
}

/** 安否確認できた日（2026-11-03 01:39）を紙の幅に合わせて 11/3 01:39 に（年は作成日でわかる） */
export function shortAt(v: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(v);
  return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}` : v;
}

/** 頁の内容の箱（A4 横 − ひな形の余白、mm） */
const CONTENT_W = 261;
const CONTENT_H = 172;
const mm = (n: number) => `${Math.round(n * 1000) / 1000}mm`;
/** 頁の内容の箱（@page の余白 = ひな形の余白）の左上からの位置 */
const ox = (x: number) => x - FORM9_MARGIN_MM.left;
const oy = (y: number) => y - FORM9_MARGIN_MM.top;

/** 欄の字（紙の書き方。特記は本人の言葉なので台帳の文のまま） */
function cellValue(r: Form9Row, col: Form9ValueColumn): string {
  const v = col === "checkedAt" ? shortAt(r.cells.checkedAt) : r.cells[col];
  return col === "notes" ? v : paperText(v);
}

/** ひな形の欄に置く字。収まらなければ「別紙」 */
export type Form9Placed = { col: Form9ValueColumn; text: string; lines: string[]; fontPt: number; annex: boolean };

/** 1 行の値をひな形の欄の大きさに収める（6.57pt から 6pt）。値の無い欄は lines が空 */
export function placeForm9Row(r: Form9Row): Form9Placed[] {
  return FORM9_VALUE_COLS.map(({ id, col }) => {
    const text = cellValue(r, id);
    if (!text) return { col: id, text, lines: [], fontPt: FORM9_FONT_PT.cell, annex: false };
    const box = form9Cell(`${col}7`);
    const fitted = fitText([text], box.w, box.h, FORM9_FONT_PT.cell);
    if (fitted) return { col: id, text, lines: fitted.lines, fontPt: fitted.fontPt, annex: false };
    const mark = fitText([ANNEX_MARK], box.w, box.h, FORM9_FONT_PT.cell);
    return { col: id, text, lines: [ANNEX_MARK], fontPt: mark?.fontPt ?? FONT_MIN_PT, annex: true };
  });
}

/** 未記入の欄（人のいる行の、値の無いひな形の欄）。色付けの版で塗る所と、画面の数 */
export function form9Blanks(rows: readonly Form9Row[]): Array<{ id: string; col: Form9ValueColumn }> {
  return rows.flatMap((r) => FORM9_VALUE_COLS.filter(({ id }) => cellValue(r, id) === "").map(({ id }) => ({ id: r.id, col: id })));
}

const LABEL = new Map(FORM9_COLUMNS.map((c) => [c.id, c.csv]));

/** ひな形の 1 枚（20 行）。first は 1 行目の No */
function Sheet({ rows, first, office, date, title, fill }: { rows: Form9Row[]; first: number; office: string; date: string; title: string; fill: boolean }) {
  const colW = (c: string) => form9Cell(`${c}7`).w;
  const left = ox(FORM9_COL_X[1]);
  const top = oy(FORM9_ROW_Y[4]);
  const headH = [FORM9_ROW_Y[5] - FORM9_ROW_Y[4], FORM9_ROW_Y[6] - FORM9_ROW_Y[5]];
  const rowH = form9Cell("B7").h;
  const at = (ref: string): CSSProperties => {
    const c = form9Cell(ref);
    return { position: "absolute", left: mm(ox(c.x)), top: mm(oy(c.y)), height: mm(c.h) };
  };
  const head = (ref: string) => FORM9_HEADS.find((h) => h.ref === ref)!;
  const H = ({ r, rowSpan, colSpan }: { r: string; rowSpan?: number; colSpan?: number }) => (
    <th rowSpan={rowSpan} colSpan={colSpan} data-cell={r}>
      {head(r)
        .text.split("\n")
        .map((l, i) => (
          <span key={i} className="f9-hl">
            {l}
          </span>
        ))}
    </th>
  );
  return (
    <section className="paper form9-sheet" aria-label={`${title} ${Math.floor(first / FORM9_ROWS_PER_PAGE) + 1} 枚目`} data-first={first}>
      {/* ひな形の並び: B2 に題、4 行目の左（B4）に事業所名・右（M4、右寄せ）に作成 */}
      <h1 className="title f9-at" style={{ ...at("B2"), width: mm(FORM9_COL_X[13] - FORM9_COL_X[1]) }}>
        {title}
      </h1>
      <div className="top f9-at" style={{ ...at("B4"), width: mm(FORM9_COL_X[13] - FORM9_COL_X[1]) }}>
        <span className="nowrap">事業所名：{office}</span>
        <span className="nowrap">作成：{paperText(date)}</span>
      </div>
      {/* ひな形の罫線（B5:M26 の細線）。表の罫線でなく線で描く（表の罫線は画素に丸められて列の幅がずれるため） */}
      <svg className="f9-lines" viewBox={`0 0 ${CONTENT_W} ${CONTENT_H}`} aria-hidden>
        {form9Lines().map((l) => (
          <line key={l.id} x1={ox(l.x1)} y1={oy(l.y1)} x2={ox(l.x2)} y2={oy(l.y2)} data-line={l.id} />
        ))}
      </svg>
      <table className="f9-grid" style={{ left: mm(left), top: mm(top) }} data-grid>
        <colgroup>
          {[..."BCDEFGHIJKLM"].map((c) => (
            <col key={c} style={{ width: mm(colW(c)) }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ height: mm(headH[0]) }}>
            <H r="B5:B6" rowSpan={2} />
            <H r="C5:E5" colSpan={3} />
            <H r="F5:F6" rowSpan={2} />
            <H r="G5:G6" rowSpan={2} />
            <H r="H5:H6" rowSpan={2} />
            <H r="I5:J5" colSpan={2} />
            <H r="K5:K6" rowSpan={2} />
            <H r="L5:L6" rowSpan={2} />
            <H r="M5:M6" rowSpan={2} />
          </tr>
          <tr style={{ height: mm(headH[1]) }}>
            <H r="C6" />
            <H r="D6" />
            <H r="E6" />
            <H r="I6" />
            <H r="J6" />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: FORM9_ROWS_PER_PAGE }, (_, i) => {
            const r = rows[i] ?? null;
            const placed = r ? placeForm9Row(r) : null;
            return (
              <tr key={i} style={{ height: mm(rowH) }} data-person={r?.id} data-rank={r?.rank}>
                <td className="num">
                  <span className="f9-in" style={{ height: mm(rowH - 0.3) }}>
                    {first + i}
                  </span>
                </td>
                {FORM9_VALUE_COLS.map(({ id }, j) => {
                  const p = placed?.[j];
                  return (
                    <td key={id} data-col={id}>
                      <span className="f9-in" style={{ height: mm(rowH - 0.3) }}>
                        {fill && r && p && p.lines.length === 0 && <span className="f9-fill" data-fill-cell={`${r.id}:${id}`} aria-hidden />}
                        {p && p.lines.length > 0 && (
                          <span className="f9-v" style={{ fontSize: `${p.fontPt}pt` }} data-font={p.fontPt} data-annex={p.annex ? "1" : undefined}>
                            {p.lines.map((l, k) => (
                              <span key={k} className="f9-ln">
                                {l}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** 別紙の表の行（ケア72 の欄と、ひな形の欄に収まらない値） */
function AnnexRow({ r }: { r: Form9Row }) {
  const c = r.cells;
  const over = placeForm9Row(r).filter((p) => p.annex);
  const Text = ({ v, raw = false }: { v: string; raw?: boolean }) => (v ? <KeepNumbers text={raw ? v : paperText(v)} /> : null);
  return (
    <tr data-person={r.id} data-rank={r.rank}>
      <td className="num">{r.rank}</td>
      <td>
        <span className="who">{r.name}</span>
        <span className="kana">{r.kana}</span>
      </td>
      <td className="color" data-color={r.color ?? ""}>
        {c.color}
      </td>
      <td>
        <Text v={c.reason} />
      </td>
      <td>
        {[c.emergency1, c.emergency2]
          .filter((v) => v)
          .map((v, i) => (
            <span key={i} className="line">
              <Text v={v} />
            </span>
          ))}
      </td>
      <td>
        <Text v={c.means} />
      </td>
      <td>
        <Text v={c.result} />
      </td>
      <td>
        <Text v={c.manual} />
      </td>
      <td data-overflow={over.length}>
        {over.map((p) => (
          <span key={p.col} className="line">
            {LABEL.get(p.col)}：<Text v={p.text} raw={p.col === "notes"} />
          </span>
        ))}
      </td>
    </tr>
  );
}

export type Form9PaperProps = {
  sheet: Form9Sheet;
  office: string;
  /** 作成日（和暦の文字） */
  date: string;
  /** 並びの説明（「発災時 色 → 時計の残り → … 2026-11-03 02:47 時点」・「平時 優先の骨格の段 → …」） */
  order: string;
  /** 発災時の市町村への報告の下書き。平時は null */
  report: string | null;
  /** 未記入の色付けの版（T101）。既定は色なし */
  fill?: boolean;
};

export function Form9Paper({ sheet, office, date, order, report, fill = false }: Form9PaperProps) {
  const title = FORM9_PAPER_TITLE;
  const chunks: Form9Row[][] = [];
  for (let i = 0; i < Math.max(1, sheet.rows.length); i += FORM9_ROWS_PER_PAGE) chunks.push(sheet.rows.slice(i, i + FORM9_ROWS_PER_PAGE));
  return (
    <div className="print-only" data-paper-print>
      <style>{`@page form9 { @bottom-left { content: ${cssString(`${title} 別紙　${office}`)}; } }`}</style>
      <div data-paper-root data-sheet="form9" data-fill={fill ? "1" : undefined}>
        {chunks.map((rows, i) => (
          <Sheet key={i} rows={rows} first={i * FORM9_ROWS_PER_PAGE + 1} office={office} date={date} title={title} fill={fill} />
        ))}
        <section className="paper paper-flow form9-paper" aria-label={`${title} 別紙`} data-annex>
          <p className="f9-annex-h">
            別紙　{title}　{office}　作成 {paperText(date)}
          </p>
          <p className="f9-annex-order">{order}</p>
          <table className="sheet form9-table">
            <colgroup>
              {[6, 22, 10, 30, 46, 26, 26, 22, 73].map((w, i) => (
                <col key={i} style={{ width: `${w}mm` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>No</th>
                <th>氏名</th>
                <th>連絡順</th>
                <th>連絡順の理由</th>
                <th>緊急連絡先</th>
                <th>安否確認の方法</th>
                <th>安否確認の結果</th>
                <th>備考（順位の手直し）</th>
                <th>様式の欄に収まらない値</th>
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r) => (
                <AnnexRow key={r.id} r={r} />
              ))}
            </tbody>
          </table>
          <div className="small-note">
            <p>※厚生労働省の BCP ひな形（自然災害）様式9 の枠のまま刷った表の別紙。No は様式9 の No と同じ。連絡順からはケア72 の欄（様式9 に無い）と、様式の欄に収まらない値（欄に「別紙」）</p>
          </div>
          {report && (
            <div className="blk report" data-block="report">
              <div className="blk-h">市町村への報告（下書き）</div>
              {/* 段（空行で区切った塊）ごとに 1 つの段落。2 段組で、段の途中では割らない */}
              <div className="report-text">
                {report.split(/\n{2,}/).map((part, i) => (
                  <p key={i}>{paperText(part)}</p>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
