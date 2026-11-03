// 担当一覧の発災時の表（docs/tasks/T13.md）。平時と同じ列に、先頭の「状態」（色の印と 2 字）と「優先」（ルールの表の並びの番号）、
// 「残り」（走っている時計でいちばん短い物）と「最終連絡」を足す。列は減らさない。どの列でも並べ替えられ、既定は優先の順。
// 色・理由・番号は lib/triage の結果をそのまま出す（ここで決め直さない）。行を押すと行の下に詳細（RowDetail）が開く。
// 氏名のリンクは今までどおり本人のページを右に開く（?open=）。

import Link from "next/link";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { StateText } from "@/components/ui/Tag";
import { TABLE } from "@/components/ui/table";
import { PLAN_TONES, rowLink, type CaseloadFilter, type CaseloadRow, type ListView, type SortDir, type SortKey } from "@/lib/caseload";
import { CARE_LEVEL_LABELS, COLOR_LABELS, PLAN_STATUS_LABELS, TIER_LABELS } from "@/lib/labels";
import { DETAIL_LABELS } from "@/lib/list/labels";
import { COLOR_TONES } from "@/lib/person";
import { ExpandRow } from "./ExpandRow";
import { MedicalCell, NarrowMarks } from "./NarrowMarks";
import { RowDetail, type ClassificationSlot, type HearingSlot, type SummarySlot } from "./RowDetail";
import { SortHeader } from "./SortHeader";

const CELL = "bg-panel px-1.5 py-1.5 align-top";

/**
 * 横に送らない。PC の幅（1024px 以上）は全部の列。狭い幅は列を省く: 640px 未満は最終連絡、768px 未満は医療・避難計画、
 * 1024px 未満は年齢・ハザード・支援者。状態・優先・氏名と理由・残りはいつも出す。768px 未満は医療の印を氏名の下に（T54）。
 * 医療の印はどの幅でも時計の残りつき（768px 以上は医療の列に。T56）
 */
const SM = "hidden sm:table-cell";
const MD = "hidden md:table-cell";
const LG = "hidden lg:table-cell";
const COLS = 10;

/**
 * 担当一覧の外で同じ表を使うとき（訓練 T17）の口。並べ替えの行き先、氏名の行き先（null なら文字だけ）、行の下の詳細
 * （訓練は本番の電話・優先修正の部品を出さない）。無ければ担当一覧のまま
 */
export type TableSlots = {
  sortHref: (k: SortKey) => string;
  nameHref: (id: string) => string | null;
  detail: (row: CaseloadRow) => React.ReactNode;
  /** 名前のそばの印（訓練の「架空」。T48）。無ければ出さない */
  nameMark?: (row: CaseloadRow) => React.ReactNode;
  /** 氏名の下の足し物（訓練の仮想モードの「結末」、T50）。無ければ何も出さない */
  nameNote?: (id: string) => React.ReactNode;
};

export function DisasterTable({
  rows,
  sort,
  dir,
  filter,
  classification,
  hearing,
  summary,
  slots,
}: {
  rows: CaseloadRow[];
  sort: SortKey;
  /** 並びの向き（T58）。無ければ列の既定。訓練（slots）は使わない */
  dir?: SortDir;
  /** 今の絞込（見出しと氏名のリンクが持ち越す） */
  filter?: CaseloadFilter;
  /** 分類と直す口（T12 の部品）。信号ごとに描く。無ければ RowDetail が読むだけで出す */
  classification?: ClassificationSlot;
  /** 聞き取りの欄と直す口（T49） */
  hearing?: HearingSlot;
  /** 録音のまとめと直す口（T69b） */
  summary?: SummarySlot;
  slots?: TableSlots;
}) {
  const h = (k: SortKey) => slots?.sortHref(k);
  const view: ListView = { ...(dir ? { dir } : {}), ...(filter ? { filter } : {}) };
  return (
    <table className={TABLE} data-table="disaster">
      <thead>
        <tr>
          <SortHeader k="state" sort={sort} dir={dir} filter={filter} href={h("state")} className="w-[4.75rem] text-center" />
          <SortHeader k="tier" sort={sort} dir={dir} filter={filter} href={h("tier")} className="w-8 text-center sm:w-10" />
          <SortHeader k="kana" sort={sort} dir={dir} filter={filter} href={h("kana")} />
          <SortHeader k="remain" sort={sort} dir={dir} filter={filter} href={h("remain")} />
          <SortHeader k="contact" sort={sort} dir={dir} filter={filter} href={h("contact")} className={SM} />
          <SortHeader k="age" sort={sort} dir={dir} filter={filter} href={h("age")} className={LG} />
          <SortHeader k="medical" sort={sort} dir={dir} filter={filter} href={h("medical")} className={MD} />
          <SortHeader k="hazard" sort={sort} dir={dir} filter={filter} href={h("hazard")} className={LG} />
          <SortHeader k="supporter" sort={sort} dir={dir} filter={filter} href={h("supporter")} className={LG} />
          <SortHeader k="plan" sort={sort} dir={dir} filter={filter} href={h("plan")} className={MD} />
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
            cells={<Cells row={r} sort={sort} view={view} nameHref={slots ? slots.nameHref(r.id) : undefined} nameMark={slots?.nameMark?.(r)} note={slots?.nameNote?.(r.id)} />}
            detail={slots ? slots.detail(r) : r.detail ? <RowDetail detail={r.detail} classification={classification} hearing={hearing} summary={summary} /> : null}
          />
        ))}
      </tbody>
    </table>
  );
}

function Cells({
  row: r,
  sort,
  view,
  nameHref,
  nameMark,
  note,
}: {
  row: CaseloadRow;
  sort: SortKey;
  view: ListView;
  nameHref?: string | null;
  nameMark?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const t = r.triage;
  const href = nameHref === undefined ? rowLink(sort, null, r.id, view).href : nameHref;
  return (
    <>
      <td className={`${CELL} text-center`}>
        <span className="text-lg leading-6 font-bold" title={TIER_LABELS[r.tier]} data-rank>
          {r.rank ?? "—"}
        </span>
      </td>
      <td className={`${CELL} sm:min-w-[9rem]`}>
        {href === null ? (
          <span className="font-bold">{r.name}</span>
        ) : (
          <Link href={href} className="-mx-1 rounded px-1 font-bold" data-press>
            {r.name}
          </Link>
        )}
        {nameMark}
        <span className="ml-1 text-xs text-muted">{r.kana}</span>
        {note}
        <NarrowMarks items={r.markItems} fallback={r.devices} />
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
      {/* 残りは状態の色が付くとき（至急・要確認）は塗りの印に、付かないときは本文色の文字（人数の帯と同じ考え。黄は文字に使わない。T66） */}
      <td className={`${CELL} sm:min-w-[5.5rem]`}>
        {r.remain ? (
          <>
            <div className="whitespace-nowrap font-bold tabular-nums" data-remain={r.remain.tone ?? "none"}>
              {r.remain.tone ? (
                <StateTag tone={r.remain.tone} size="fit">
                  {r.remain.text}
                </StateTag>
              ) : (
                r.remain.text
              )}
            </div>
            <div className="text-xs text-muted">{r.remain.label}</div>
          </>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className={`${CELL} ${SM} whitespace-nowrap`}>
        {r.lastContact ? (
          <>
            <div>{r.lastContact.when.split(" ")[1]}</div>
            <div className="text-xs text-muted">
              {r.lastContact.source}
              {r.lastContact.ago ? ` ${r.lastContact.ago}${DETAIL_LABELS.ago}` : ""}
            </div>
          </>
        ) : (
          <span className="text-muted">{DETAIL_LABELS.noContact}</span>
        )}
      </td>
      <td className={`${CELL} ${LG} whitespace-nowrap`}>
        <span>{r.age ?? "—"}</span>
        <span className="text-muted"> 歳</span>
        <div className="text-xs">{r.careLevel ? CARE_LEVEL_LABELS[r.careLevel] : "—"}</div>
      </td>
      <td className={`${CELL} ${MD}`}>
        {/* 受け持ちの表と同じ印（時計のいちばん短い残りつき、残りの色は印の文字。T56） */}
        <MedicalCell items={r.markItems} fallback={r.devices} />
      </td>
      <td className={`${CELL} ${LG}`}>
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
      <td className={`${CELL} ${LG} whitespace-nowrap`}>
        {r.supporters > 0 ? <span>{r.supporters} 人</span> : <StateText tone="check">なし</StateText>}
      </td>
      <td className={`${CELL} ${MD} whitespace-nowrap`}>
        {/* 避難計画は 2 番目の状態なので色の文字（塗りの印は安否の状態だけ） */}
        <StateText tone={PLAN_TONES[r.plan]}>{PLAN_STATUS_LABELS[r.plan]}</StateText>
        {r.pending > 0 && <div className="text-xs font-bold tone-check">未確認 {r.pending}</div>}
      </td>
    </>
  );
}
