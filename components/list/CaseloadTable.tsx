// 担当一覧の平時の表（app/page.tsx から分けた。T56 でテストから描くため）。
// 列は 連絡順（骨格の段。本人のページの上の「連絡順」と同じ言葉と数、T187）・氏名・年齢・医療・ハザード・支援者・計画。どの列でも並べ替えられる。
// 横に送らない: 768px 未満は医療・ハザード・支援者を省き、氏名の下に医療の印（時計の長さつき）を出す。
// 768px 以上の医療の列も同じ印（受け持ちの表・発災時の表と同じ MedicalCell。T56）。

import Link from "next/link";
import { StateTag, StateText } from "@/components/ui/Tag";
import { PlanState } from "./PlanState";
import { TABLE, TD } from "@/components/ui/table";
import { rowLink, type CaseloadFilter, type CaseloadRow, type SortDir, type SortKey } from "@/lib/caseload";
import { CARE_LEVEL_LABELS, TIER_LABELS } from "@/lib/labels";
import { tierColumnLabel } from "@/lib/list/labels";
import { MedicalCell, NarrowMarks } from "./NarrowMarks";
import { SortHeader } from "./SortHeader";

const CELL = TD;
const WIDE = "hidden md:table-cell";

export function CaseloadTable({
  rows,
  sort,
  dir,
  filter,
}: {
  rows: CaseloadRow[];
  sort: SortKey;
  /** 並びの向き（T58）。無ければ列の既定 */
  dir?: SortDir;
  /** 今の絞込（見出しと氏名のリンクが持ち越す） */
  filter?: CaseloadFilter;
}) {
  const view = { ...(dir ? { dir } : {}), ...(filter ? { filter } : {}) };
  return (
    <table className={TABLE} data-table="caseload">
      <thead>
        <tr>
          <SortHeader k="tier" sort={sort} dir={dir} filter={filter} label={tierColumnLabel(false)} className="w-14 text-center" narrowWrap />
          <SortHeader k="kana" sort={sort} dir={dir} filter={filter} />
          <SortHeader k="age" sort={sort} dir={dir} filter={filter} />
          <SortHeader k="medical" sort={sort} dir={dir} filter={filter} className={WIDE} />
          <SortHeader k="hazard" sort={sort} dir={dir} filter={filter} className={WIDE} />
          <SortHeader k="supporter" sort={sort} dir={dir} filter={filter} className={WIDE} />
          <SortHeader k="plan" sort={sort} dir={dir} filter={filter} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          // 行のどこを押しても本人のページへ（氏名のリンクの ::after を行いっぱいに広げる。行の中にほかの押せる物は無い）。
          // 押したときの灰色は行全体（data-press-host で行に。色は app/globals.css の tr[data-press]）
          <tr key={r.id} className="relative" data-press="">
            <td className={`${CELL} text-center`}>
              <span className="text-lg leading-6 font-bold" title={TIER_LABELS[r.tier]}>
                {r.tier}
              </span>
            </td>
            <td className={CELL}>
              <Link
                href={rowLink(sort, null, r.id, view).href}
                className="-mx-1 rounded px-1 font-bold after:absolute after:inset-0 after:content-['']"
                data-press
                data-press-host="tr"
              >
                {r.name}
              </Link>
              <span className="ml-1.5 text-xs text-muted">{r.kana}</span>
              {/* 768px 未満は医療の列を省くので、医療の印を氏名の下に（発災時の表・受け持ちの表と同じ部品。残りは時計の長さ。T54） */}
              <NarrowMarks items={r.markItems} fallback={r.devices} />
            </td>
            <td className={`${CELL} whitespace-nowrap`}>
              {r.age ?? "—"}
              <span className="text-muted"> 歳</span>
              <div className="text-xs">{r.careLevel ? CARE_LEVEL_LABELS[r.careLevel] : "—"}</div>
            </td>
            <td className={`${CELL} ${WIDE}`}>
              <MedicalCell items={r.markItems} fallback={r.devices} />
            </td>
            <td className={`${CELL} ${WIDE}`}>{r.hazards.length === 0 ? <span className="text-muted">なし</span> : r.hazards.join("・")}</td>
            <td className={`${CELL} ${WIDE} whitespace-nowrap`}>
              {r.supporters > 0 ? `${r.supporters} 人` : <StateText tone="check">なし</StateText>}
            </td>
            <td className={`${CELL} whitespace-nowrap`}>
              {/* 避難計画は 2 番目の状態なので色の文字（塗りの印は安否の状態だけ）。下に別に最後に出た訓練の日（T146） */}
              <PlanState plan={r.plan} drill={r.drill} />
              {/* 未確認の数は言葉ごと黄の塗りの印（右の面・書類の紙面の帯と同じ形。前の黄の細い帯は何の印か伝わらなかった。T96） */}
              {r.pending > 0 && (
                <div className="mt-0.5" data-row-pending={r.pending}>
                  <StateTag tone="check">
                    未確認 <span className="tabular-nums">{r.pending}</span>
                  </StateTag>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
