// 様式 9（災害時利用者一覧表 安否確認優先順位）の紙面。A4 横の表で、人数に合わせて頁が続く（見出しの行は各頁の上に繰り返す）。
// 列はひな形の 12 列の順と言葉（FORM9_COLUMNS）、そのあとにケア72 の列。紙の幅に収めるため、緊急連絡先 1・2 は 1 つの欄に 2 行で。
// 画面（/office/form9）では出さず、印刷のときだけ出す（画面の表は Form9Table）。頁の下の端の文書名と頁番号は form9-paper.css の @page。
// 発災時は表のあとに市町村への報告の下書き（lib/forms/form9-report.ts の文。Claude は呼ばない）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。

import type { Form9Row, Form9Sheet } from "@/lib/forms/form9";
import { paperText } from "@/lib/forms/paper-text";
import { KeepNumbers } from "./FormCell";

/** 題名（ひな形のシートの題名 FORM9_TITLE を、紙の書き方の全角の括弧に） */
export const FORM9_PAPER_TITLE = "様式9：災害時利用者一覧表（安否確認優先順位）";

/** 頁の下の端の文字（CSS の文字列。名前に引用符や改行があっても壊れないように） */
export function cssString(s: string): string {
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\n\r]/g, " ")}"`;
}

/** 列（幅は mm。合わせて 280mm = A4 横 297mm − 左右 8.5mm） */
const COLS: ReadonlyArray<{ key: string; mm: number }> = [
  { key: "no", mm: 7 },
  { key: "medicalCare", mm: 19 },
  { key: "environment", mm: 15 },
  { key: "evacuation", mm: 18 },
  { key: "area", mm: 15 },
  { key: "nameAge", mm: 19 },
  { key: "address", mm: 13 },
  { key: "shelter", mm: 14 },
  { key: "facility", mm: 12 },
  { key: "notes", mm: 13 },
  { key: "careManager", mm: 9 },
  { key: "checkedAt", mm: 18 },
  { key: "color", mm: 11 },
  { key: "reason", mm: 21 },
  { key: "emergency", mm: 30 },
  { key: "means", mm: 20 },
  { key: "result", mm: 15 },
  { key: "manual", mm: 11 },
];

/** 安否確認できた日（2026-11-03 01:39）を紙の幅に合わせて 11/3 01:39 に（年は作成日でわかる） */
export function shortAt(v: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(v);
  return m ? `${Number(m[1])}/${Number(m[2])} ${m[3]}` : v;
}

/** 欄の文字。紙の書き方（数字と単位を詰める）。raw は本人の言葉の入る欄（特記）で台帳の文のまま */
function Text({ v, raw = false }: { v: string; raw?: boolean }) {
  return v ? <KeepNumbers text={raw ? v : paperText(v)} /> : null;
}

function Row({ r }: { r: Form9Row }) {
  const c = r.cells;
  return (
    <tr data-person={r.id} data-rank={r.rank}>
      <td className="num">{r.rank}</td>
      <td>
        <Text v={c.medicalCare} />
      </td>
      <td>
        <Text v={c.environment} />
      </td>
      <td>
        <Text v={c.evacuation} />
      </td>
      <td>
        <Text v={c.area} />
      </td>
      <td>
        <span className="who">{r.name}</span>
        {r.age != null && <span className="age">（{r.age}）</span>}
        <span className="kana">{r.kana}</span>
      </td>
      <td>
        <Text v={c.address} />
      </td>
      <td>
        <Text v={c.shelter} />
      </td>
      <td>
        <Text v={c.facility} />
      </td>
      <td>
        <Text v={c.notes} raw />
      </td>
      <td>
        <Text v={c.careManager} />
      </td>
      <td>
        <Text v={shortAt(c.checkedAt)} />
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
};

export function Form9Paper({ sheet, office, date, order, report }: Form9PaperProps) {
  const title = FORM9_PAPER_TITLE;
  return (
    <div className="print-only" data-paper-print>
      <style>{`@page form9 { @bottom-left { content: ${cssString(`${title}　${office}`)}; } }`}</style>
      <section className="paper paper-flow form9-paper" data-paper-root data-sheet="form9" aria-label={title}>
        <div className="head-row">
          <h1 className="title">{title}</h1>
          <div className="top-col">
            <span className="nowrap">事業所名 {office}</span>
            <span className="nowrap">作成 {paperText(date)}</span>
            <span className="nowrap">{order}</span>
          </div>
        </div>
        <table className="sheet form9-table">
          <colgroup>
            {COLS.map((col) => (
              <col key={col.key} style={{ width: `${col.mm}mm` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2}>No</th>
              <th colSpan={3}>優先順位※</th>
              <th rowSpan={2}>地域・区分</th>
              <th rowSpan={2}>氏名（年齢）</th>
              <th rowSpan={2}>住所（自治会）</th>
              <th colSpan={2}>想定される避難場所</th>
              <th rowSpan={2}>特記</th>
              <th rowSpan={2}>担当ケアマネ</th>
              <th rowSpan={2}>安否確認できた日</th>
              <th colSpan={6} className="added">ケア72 の欄</th>
            </tr>
            <tr>
              <th>医療・介護</th>
              <th>環境</th>
              <th>避難</th>
              <th>避難所</th>
              <th>介護・医療機関</th>
              <th className="added">優先</th>
              <th className="added">優先の理由</th>
              <th className="added">緊急連絡先</th>
              <th className="added">安否確認の方法</th>
              <th className="added">安否確認の結果</th>
              <th className="added">備考（順位の手直し）</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </tbody>
        </table>
        <div className="small-note">
          <p>※No から安否確認できた日までは厚生労働省の BCP ひな形（自然災害）様式9 の列。そのあとはケア72 の欄（優先・理由・緊急連絡先・安否確認の方法と結果・順位の手直し）</p>
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
  );
}
