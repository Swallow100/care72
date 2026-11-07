// 受け入れた人の画面（T152）。医療班・行政の役で本人のページ（/people/[id]）を開いた時の出し方。
// 上から: 氏名・状態・医療の印と、受け入れた避難所と時刻 → 要約（薬・機器・アレルギー・連絡先）→ 経過（書き足しの欄と行）→ 残りの区分。
// 中身は本人のページの組み立て（見る人の範囲を通した物）を並べ替えるだけ（lib/custody/received.ts の receivedLayout）。
// 医療が範囲の外の人（医療班への提供に同意なし・未確認）は、要約の所に同意の状態だけ（医療要約の書類の頁と同じ言葉）。
// 経過の書き足し（components/person/TimelineComposer）は書ける種類があるときだけ、経過の見出しのすぐ下に。
// 今は行政の役だけ（医療班からケアマネへの伝達はなし。T172、lib/consent/relay.ts）。
// 経過の行は人が書き足す記録だけ（components/person/Timeline が台帳を直した跡を外す。T143）。台帳を直した跡は本人のページと同じく
// いちばん下の「変更履歴」（components/person/ChangeHistory、畳み）。
// 状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。

import { WITHHELD_LABELS } from "@/components/forms/MedicalWithheld";
import { ChangeHistory } from "@/components/person/ChangeHistory";
import { Blocks } from "@/components/person/PersonView";
import { FieldValue, REASON_TEXT, StateTag } from "@/components/person/parts";
import { TimelineComposer } from "@/components/person/TimelineComposer";
import { ButtonLink } from "@/components/ui/Button";
import { PaperIcon, PrintIcon } from "@/components/ui/Icon";
import { Mark, StateText } from "@/components/ui/Tag";
import { SHOWN_VIA_LABELS, RECEIVED_LABELS } from "@/lib/custody/labels";
import { receivedLayout, type OpenCustody, type SummaryCell } from "@/lib/custody/received";
import type { ConsentStatus } from "@/lib/db/types";
import { shortJst } from "@/lib/disaster/state";
import { BLANK_LABELS, CONSENT_KIND_LABELS, CONSENT_STATUS_LABELS, HEAD_LABELS } from "@/lib/labels";
import type { DocumentView, PersonView, Section } from "@/lib/person";

/** 発災時の上の細い帯（ルールの表の色）。面全体は塗らない（本人のページの上と同じ） */
const BAND: Record<string, string> = {
  urgent: "bg-state-urgent-fill",
  check: "bg-state-check-fill",
  unknown: "bg-state-unknown-fill",
  ok: "bg-state-ok-fill",
};

const PANEL = "rounded-lg bg-panel px-3 py-2.5 text-sm";
const H2 = "text-[1rem] leading-6 font-bold";

/** 書類の区分から医療要約（開ける人だけ href がある） */
function medicalDocument(sections: readonly Section[]): DocumentView | null {
  for (const s of sections) {
    if (s.id !== "documents") continue;
    for (const b of s.blocks) {
      if (b.type !== "documents") continue;
      const d = b.documents.find((x) => x.key === "medical" && x.href);
      if (d) return d;
    }
  }
  return null;
}

const printHref = (href: string) => `${href}${href.includes("?") ? "&" : "?"}print=1`;

export function ReceivedPerson({
  view,
  custody,
  consent,
}: {
  view: PersonView;
  /** 自分の開いた受け持ち（避難所・時刻・入り方）。読めなければ null（行を出さない） */
  custody: OpenCustody | null;
  /** 医療班への提供の同意（医療が範囲の外の人の要約の所に出す） */
  consent: ConsentStatus;
}) {
  const { head } = view;
  const layout = receivedLayout(view);
  const doc = medicalDocument(view.sections);
  const titleId = `received-${head.id}`;
  const p = head.priority;
  // 優先: 医療が範囲にあれば骨格の段か色と理由。範囲の外でも発災時の色と言葉は出す（理由は空。本人のページの上と同じ）
  const priority = head.show.medical || p.kind === "triage";
  // 台帳を直した跡（T143 の history。見る人の範囲で絞った後の経過の行から）
  const history = (layout.timeline?.blocks ?? []).flatMap((b) => (b.type === "timeline" ? b.items : [])).filter((t) => t.history);
  return (
    <div className="@container space-y-2" data-received={head.id}>
      <section aria-labelledby={titleId} className="overflow-hidden rounded-lg bg-panel" data-received-head>
        {p.kind === "triage" && <div className={`h-1 ${BAND[p.tone]}`} aria-hidden="true" />}
        <div className="space-y-1.5 p-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 id={titleId} className="text-xl leading-8 font-bold">
              {head.name}
            </h1>
            <span className="text-sm text-muted">{head.kana}</span>
            <span className="text-sm">
              <span className="text-xs text-muted">{HEAD_LABELS.age}</span>{" "}
              {head.age === null ? <span className="text-muted">{BLANK_LABELS.blank}</span> : <span className="tabular-nums">{head.age} 歳</span>}
            </span>
            {head.show.medical && head.careLevel && (
              <span className="text-sm">
                <span className="text-xs text-muted">{HEAD_LABELS.careLevel}</span> {head.careLevel}
              </span>
            )}
            {custody && (
              <span className="text-sm" data-custody={custody.custodyId}>
                <span className="text-xs text-muted">{RECEIVED_LABELS.received}</span>{" "}
                <span className="font-bold">{custody.shelter}</span> <span className="tabular-nums">{shortJst(custody.receivedAt)}</span>{" "}
                <span className="text-xs text-muted">{SHOWN_VIA_LABELS[custody.via]}</span>
              </span>
            )}
          </div>
          {(priority || head.marks.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {priority &&
                (p.kind === "tier" ? (
                  <span className="flex items-baseline gap-1.5 text-sm" data-priority="tier">
                    <span className="text-xs text-muted">{HEAD_LABELS.priority}</span>
                    <span className="text-lg leading-none font-bold tabular-nums">{p.tier}</span>
                    <span>{p.label}</span>
                  </span>
                ) : (
                  <span className="flex flex-wrap items-baseline gap-x-2" data-priority="triage">
                    <StateTag tone={p.tone} size="md">
                      {p.label}
                    </StateTag>
                    {p.reason && <span className={`text-sm font-bold ${REASON_TEXT[p.tone]}`}>{p.reason}</span>}
                  </span>
                ))}
              {/* 医療の印と時計のいちばん短い残り（「酸素 4h」。本人のページの上と同じ印） */}
              {head.marks.length > 0 && (
                <span className="flex flex-wrap gap-1" data-marks>
                  <span className="sr-only">{HEAD_LABELS.marks}</span>
                  {head.marks.map((m) => (
                    <Mark key={m.label} size="md" tone={m.tone ?? null}>
                      {m.remaining ? `${m.label} ${m.remaining}` : m.label}
                    </Mark>
                  ))}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 要約: 医療班が先に見る 4 つ。医療要約の書類を開ける人は全文と印刷 */}
      <section aria-labelledby={`${titleId}-summary`} className={PANEL} data-received-summary>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 id={`${titleId}-summary`} className={H2}>
            {RECEIVED_LABELS.summary}
          </h2>
          {doc?.href && (
            <div className="ml-auto flex flex-wrap gap-1.5">
              <ButtonLink href={doc.href} size="sm" icon={PaperIcon} data-summary-full>
                {RECEIVED_LABELS.full}
              </ButtonLink>
              <ButtonLink href={printHref(doc.href)} size="sm" icon={PrintIcon} data-summary-print>
                {RECEIVED_LABELS.print}
              </ButtonLink>
            </div>
          )}
        </div>
        {layout.summary ? (
          <div className="mt-1.5 grid gap-2 @2xl:grid-cols-2 @5xl:grid-cols-4">
            {layout.summary.map((c) => (
              <SummaryBox key={c.part} cell={c} />
            ))}
          </div>
        ) : (
          // 医療が範囲の外（同意なし・未確認）: 同意の状態だけ。記録の日・人・備考は出さない（QR の頁と同じ）
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1" data-withheld={consent}>
            <StateTag tone="check" size="md">
              {consent === "refused" ? WITHHELD_LABELS.refused : WITHHELD_LABELS.unconfirmed}
            </StateTag>
            <span className="font-bold">
              {CONSENT_KIND_LABELS.medical} {CONSENT_STATUS_LABELS[consent === "refused" ? "refused" : "unconfirmed"]}
            </span>
          </div>
        )}
      </section>

      {/* 経過: 行と、書ける役の書き足し（行政）。範囲の外なら出さない */}
      {layout.timeline && (
        <section aria-labelledby={`${titleId}-timeline`} className={PANEL} data-section="timeline">
          <h2 id={`${titleId}-timeline`} className={H2}>
            {RECEIVED_LABELS.timeline}
          </h2>
          {view.writes.length > 0 && (
            <div className="mt-1.5">
              <TimelineComposer personId={head.id} kinds={view.writes} />
            </div>
          )}
          <div className="mt-1.5">
            <Blocks blocks={layout.timeline.blocks} />
          </div>
        </section>
      )}

      {/* 残りの区分（医療の残り・関係者・避難・書類）。面の幅に合わせて 1〜3 段 */}
      {layout.rest.length > 0 && (
        <div className="gap-x-2 @[40rem]:columns-2 @5xl:columns-3" data-received-rest>
          {layout.rest.map((s) => (
            <section
              key={s.id}
              aria-labelledby={`${titleId}-${s.id}`}
              className={`mb-2 break-inside-avoid ${PANEL}`}
              data-section={s.id}
            >
              <div className="flex items-baseline gap-2">
                <h2 id={`${titleId}-${s.id}`} className={H2}>
                  {s.label}
                </h2>
                {s.unconfirmed > 0 && (
                  <StateText tone="check" className="text-xs">
                    {BLANK_LABELS.unconfirmed} {s.unconfirmed}
                  </StateText>
                )}
              </div>
              <div className="mt-1.5">
                <Blocks blocks={s.blocks} />
              </div>
            </section>
          ))}
        </div>
      )}

      <ChangeHistory items={history} idBase={`received-${head.id}`} level={1} />
    </div>
  );
}

/** 要約の 1 つ（薬・機器・アレルギー・連絡先）。欄の名前は箱の見出しにし、値だけを並べる */
function SummaryBox({ cell }: { cell: SummaryCell }) {
  return (
    <div className="min-w-0 rounded-md bg-panel2 px-3 py-2" data-summary={cell.part}>
      <h3 className="text-xs text-muted">{cell.label}</h3>
      <div className="mt-0.5 space-y-1">
        {cell.blocks.length === 0 ? (
          <span className="text-muted">{BLANK_LABELS.blank}</span>
        ) : (
          cell.blocks.map((b, i) =>
            b.type === "row" ? (
              <div key={b.row.key} data-field={b.row.key}>
                {/* 2 つ目からは何の行か分かるように欄の名前（連絡先の緊急連絡先と一覧） */}
                {i > 0 && <div className="text-xs text-muted">{b.row.label}</div>}
                <FieldValue field={b.row.field} pending={b.row.pending} apart={b.row.apart === true} />
              </div>
            ) : null,
          )
        )}
      </div>
    </div>
  );
}

