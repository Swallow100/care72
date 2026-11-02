// 担当一覧の発災時の表（docs/tasks/T13.md）。平時と同じ列に、先頭の「状態」（色の印と 2 字）と「優先」（ルールの表の並びの番号）、
// 「残り」（走っている時計でいちばん短い物）と「最終連絡」を足す。列は減らさない。どの列でも並べ替えられ、既定は優先の順。
// 色・理由・番号は lib/triage の結果をそのまま出す（ここで決め直さない）。行を押すと行の下に詳細（RowDetail）が開く。
// 氏名のリンクは今までどおり本人のページを右に開く（?open=）。

import Link from "next/link";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { PLAN_TONES, rowLink, type CaseloadRow, type SortKey } from "@/lib/caseload";
import { CARE_LEVEL_LABELS, COLOR_LABELS, PLAN_STATUS_LABELS, TIER_LABELS } from "@/lib/labels";
import { DETAIL_LABELS } from "@/lib/list/labels";
import { COLOR_TONES } from "@/lib/person";
import { ExpandRow } from "./ExpandRow";
import { RowDetail, type ClassificationSlot } from "./RowDetail";
import { SortHeader } from "./SortHeader";

const CELL = "bg-panel px-1.5 py-2 align-top first:rounded-l-md last:rounded-r-md";
const COLS = 10;

export function DisasterTable({
  rows,
  sort,
  classification,
}: {
  rows: CaseloadRow[];
  sort: SortKey;
  /** 分類と直す口（T12 の部品）。信号ごとに描く。無ければ RowDetail が読むだけで出す */
  classification?: ClassificationSlot;
}) {
  return (
    <table className="w-full min-w-[50rem] border-separate border-spacing-y-0.5 text-left text-sm" data-table="disaster">
      <thead>
        <tr className="whitespace-nowrap text-muted">
          <SortHeader k="state" sort={sort} className="w-[5.5rem] text-center" />
          <SortHeader k="tier" sort={sort} className="w-12 text-center" />
          <SortHeader k="kana" sort={sort} />
          <SortHeader k="remain" sort={sort} />
          <SortHeader k="contact" sort={sort} />
          <SortHeader k="age" sort={sort} />
          <SortHeader k="medical" sort={sort} />
          <SortHeader k="hazard" sort={sort} />
          <SortHeader k="supporter" sort={sort} />
          <SortHeader k="plan" sort={sort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <ExpandRow
            key={r.id}
            id={r.id}
            cols={COLS}
            label={r.name}
            cellClass={CELL}
            head={
              r.triage ? (
                <StateTag tone={COLOR_TONES[r.triage.color]} size="md">
                  {COLOR_LABELS[r.triage.color]}
                </StateTag>
              ) : null
            }
            cells={<Cells row={r} sort={sort} />}
            detail={r.detail ? <RowDetail detail={r.detail} classification={classification} /> : null}
          />
        ))}
      </tbody>
    </table>
  );
}

function Cells({ row: r, sort }: { row: CaseloadRow; sort: SortKey }) {
  const t = r.triage;
  return (
    <>
      <td className={`${CELL} text-center`}>
        <span className="text-lg font-bold tabular-nums" title={TIER_LABELS[r.tier]} data-rank>
          {r.rank ?? "—"}
        </span>
      </td>
      <td className={`${CELL} min-w-[10rem]`}>
        <Link href={rowLink(sort, null, r.id).href} className="-mx-1 rounded px-1 font-bold" data-press>
          {r.name}
        </Link>
        <span className="ml-1 text-xs text-muted">{r.kana}</span>
        {t && (
          <div className={`mt-0.5 font-bold ${TONE_TEXT[COLOR_TONES[t.color]]}`} data-reason>
            {t.reason}
          </div>
        )}
        {t?.override && (
          <div className="mt-0.5 text-xs text-muted" data-override={t.override.expired ? "expired" : "active"}>
            {DETAIL_LABELS.override} {COLOR_LABELS[t.override.baseAtOverride]}→{COLOR_LABELS[t.override.to]}
            {t.override.expired ? ` ${DETAIL_LABELS.expired}` : ""}
          </div>
        )}
      </td>
      <td className={`${CELL} min-w-[5.5rem]`}>
        {r.remain ? (
          <>
            <div className={`whitespace-nowrap font-bold tabular-nums ${r.remain.tone ? TONE_TEXT[r.remain.tone] : ""}`}>
              {r.remain.text}
            </div>
            <div className="text-xs text-muted">{r.remain.label}</div>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        {r.lastContact ? (
          <>
            <div className="tabular-nums">{r.lastContact.when.split(" ")[1]}</div>
            <div className="text-xs text-muted">
              {r.lastContact.source}
              {r.lastContact.ago ? ` ${r.lastContact.ago}${DETAIL_LABELS.ago}` : ""}
            </div>
          </>
        ) : (
          <span className="text-muted">{DETAIL_LABELS.noContact}</span>
        )}
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        <span className="tabular-nums">{r.age ?? "—"}</span>
        <span className="text-muted"> 歳</span>
        <div className="text-xs">{r.careLevel ? CARE_LEVEL_LABELS[r.careLevel] : "—"}</div>
      </td>
      <td className={CELL}>
        {r.marks.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.marks.map((m) => (
              <span key={m} className="whitespace-nowrap rounded bg-panel2 px-1 py-px text-xs">
                {m}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className={CELL}>
        {r.hazards.length === 0 ? (
          <span className="text-muted">なし</span>
        ) : (
          r.hazards.map((h) => (
            <div key={h} className="whitespace-nowrap">
              {h}
            </div>
          ))
        )}
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        {r.supporters > 0 ? <span className="tabular-nums">{r.supporters} 人</span> : <span className="text-state-check">なし</span>}
      </td>
      <td className={`${CELL} whitespace-nowrap`}>
        <StateTag tone={PLAN_TONES[r.plan]}>{PLAN_STATUS_LABELS[r.plan]}</StateTag>
        {r.pending > 0 && <div className="mt-0.5 text-xs font-bold text-state-check tabular-nums">未確認 {r.pending}</div>}
      </td>
    </>
  );
}
