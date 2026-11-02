// 本人のページの本体（読む側）。単独のページ（/people/[id]）と、担当一覧の右の面（/?open=<id>）で同じ物を出す。
// 区分の順は lib/person.ts の sectionOrder（発災時は経過が一番上）。入れる欄（T03）はここに置かない。

import type { Block, ClockView, PersonView as View, Row, Section } from "@/lib/person";
import { BLANK_LABELS } from "@/lib/labels";
import { Blank, PendingMark, RowItem, StateTag, TONE_TEXT, type Level } from "./parts";
import { PersonHead } from "./PersonHead";
import { Timeline } from "./Timeline";

export function PersonView({ view, level }: { view: View; level: Level }) {
  const base = `person-${view.head.id}`;
  return (
    <div className="space-y-3" data-mode={view.mode}>
      <PersonHead head={view.head} level={level} titleId={`${base}-title`} />
      {view.sections.map((s) => (
        <SectionPanel key={s.id} section={s} level={level} titleId={`${base}-${s.id}`} />
      ))}
    </div>
  );
}

function SectionPanel({ section, level, titleId }: { section: Section; level: Level; titleId: string }) {
  const H = level === 1 ? "h2" : "h3";
  return (
    <section aria-labelledby={titleId} className="rounded-lg bg-panel p-5" data-section={section.id}>
      <div className="flex items-baseline gap-3">
        <H id={titleId} className="text-lg font-bold">
          {section.label}
        </H>
        {section.unconfirmed > 0 && (
          <StateTag tone="check">
            {BLANK_LABELS.unconfirmed} <span className="tabular-nums">{section.unconfirmed}</span>
          </StateTag>
        )}
      </div>
      <div className="mt-3">
        <Blocks blocks={section.blocks} />
      </div>
    </section>
  );
}

/** 続く欄の行は 1 つの dl に、経過はそのまま */
function Blocks({ blocks }: { blocks: readonly Block[] }) {
  const timeline = blocks.find((b) => b.type === "timeline");
  if (timeline?.type === "timeline") return <Timeline items={timeline.items} />;
  return (
    <dl className="space-y-2.5">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "row":
            return <RowItem key={b.row.key} row={b.row} />;
          case "clocks":
            return <ClocksRow key="clocks" label={b.label} clocks={b.clocks} />;
          case "documents":
            return b.documents.map((d) => (
              <DocumentRow key={d.key} row={{ key: `documents.${d.key}`, label: d.label, status: d.status }} />
            ));
          case "timeline":
            return <Timeline key={i} items={b.items} />;
        }
      })}
    </dl>
  );
}

function DocumentRow({ row }: { row: Pick<Row, "key" | "label"> & { status: string } }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4" data-field={row.key}>
      <dt className="pt-0.5 text-sm text-muted">{row.label}</dt>
      <dd className="text-muted">{row.status}</dd>
    </div>
  );
}

const TH = "px-3 py-2 font-normal";
const TD = "px-3 py-2 align-top";

/** 時計（値・単位・出典・頼り先の確認）。値の無い時計は未確認、走らない時計（本人の状態）は値を持たない */
function ClocksRow({ label, clocks }: { label: string; clocks: readonly ClockView[] }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4" data-field="clocks">
      <dt className="pt-0.5 text-sm text-muted">{label}</dt>
      <dd className="min-w-0">
        {clocks.length === 0 ? (
          <span>{BLANK_LABELS.none}</span>
        ) : (
          <div className="overflow-x-auto rounded-md bg-panel2">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="whitespace-nowrap text-muted">
                <tr>
                  <th className={TH}>項目</th>
                  <th className={TH}>種類</th>
                  <th className={TH}>値</th>
                  <th className={TH}>起点</th>
                  <th className={TH}>出典</th>
                  <th className={TH}>頼り先</th>
                </tr>
              </thead>
              <tbody>
                {clocks.map((k) => (
                  <tr key={k.id} data-clock={k.id}>
                    <td className={TD}>
                      <div className="text-base">{k.label}</div>
                      {k.note && <div className="text-muted">{k.note}</div>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{k.kind}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      <ClockValue clock={k} />
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{k.start}</td>
                    <td className={TD}>
                      {k.source ?? <Blank />}
                      {k.sourceNote && <div className="text-muted">{k.sourceNote}</div>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {k.depends ? (
                        <StateTag tone={k.depends.unchecked ? "check" : "ok"}>
                          {k.depends.on} {k.depends.check}
                        </StateTag>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </dd>
    </div>
  );
}

function ClockValue({ clock }: { clock: ClockView }) {
  if (clock.pending.length > 0) {
    return (
      <span className="inline-flex flex-col">
        {clock.value && <span>{clock.value}</span>}
        <PendingMark pending={clock.pending} />
      </span>
    );
  }
  if (clock.value) {
    return (
      <span className={`text-base ${clock.tone ? `font-bold ${TONE_TEXT[clock.tone]}` : ""}`} data-tone={clock.tone ?? undefined}>
        {clock.value}
      </span>
    );
  }
  if (!clock.runs) return <span className="text-muted">—</span>;
  return <Blank />;
}
