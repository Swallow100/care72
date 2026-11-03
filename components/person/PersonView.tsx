// 本人のページの本体（読む側）。単独のページ（/people/[id]）と、担当一覧の右の面（/?open=<id>）で同じ物を出す。
// 簡素にしない。台帳の項目は区分ごとに全部出し、小さな字と密度で PC の 1 画面に収める。
// 大事な物（優先と理由・医療の印・時計の残り・緊急連絡先）は上に大きく、細かい物は小さく。
// 区分は面の幅に合わせて 1〜3 段に流す（container query）。区分の順は lib/person.ts の sectionOrder（発災時は経過が一番上）。
// 入れる欄（T03）はここに置かない。経過の書き足し（T24）は経過の区分の上（書ける種類があるときだけ）。
// 見える区分と欄は lib/person.ts の toPersonView が見る人の範囲（lib/consent/scope.ts）で決める。ここは来た物を描くだけ。

import { ButtonLink } from "@/components/ui/Button";
import { PaperIcon, PrintIcon } from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import type { Block, ClockView, DocumentView, PersonView as View, Section } from "@/lib/person";
import { BLANK_LABELS, CLOCK_PARTS } from "@/lib/labels";
import { isEditSection, type EditData } from "@/lib/intake/edit";
import { Blank, PendingMark, RowItem, TONE_TEXT, type Level } from "./parts";
import { SectionEdit } from "./SectionEdit";
import { PersonHead } from "./PersonHead";
import { Timeline } from "./Timeline";
import { TimelineComposer } from "./TimelineComposer";

/**
 * edit はケアマネの役で開いたときだけ（入れる欄と同じ）。渡すと面の右上に「編集」（T45、components/person/SectionEdit.tsx）。
 * 書類と経過の面は編集しない
 */
export function PersonView({ view, level, edit = null }: { view: View; level: Level; edit?: EditData | null }) {
  const base = `person-${view.head.id}`;
  return (
    <div className="@container space-y-2" data-mode={view.mode}>
      <PersonHead head={view.head} level={level} titleId={`${base}-title`} />
      <div className="gap-x-2 @[40rem]:columns-2 @5xl:columns-3">
        {view.sections.map((s) => (
          <SectionPanel key={s.id} section={s} level={level} titleId={`${base}-${s.id}`} edit={edit}>
            {/* 経過の書き足し（T24）。書ける種類（役と同意。lib/consent/scope.ts）があるときだけ、経過の上に */}
            {s.id === "timeline" && view.writes.length > 0 && <TimelineComposer personId={view.head.id} kinds={view.writes} />}
          </SectionPanel>
        ))}
      </div>
    </div>
  );
}

function SectionPanel({
  section,
  level,
  titleId,
  edit = null,
  children,
}: {
  section: Section;
  level: Level;
  titleId: string;
  edit?: EditData | null;
  children?: React.ReactNode;
}) {
  const H = level === 1 ? "h2" : "h3";
  const head = (
    <>
      <H id={titleId} className="text-[1rem] leading-6 font-bold">
        {section.label}
      </H>
      {section.unconfirmed > 0 && (
        <StateText tone="check" className="text-xs">
          {BLANK_LABELS.unconfirmed} {section.unconfirmed}
        </StateText>
      )}
    </>
  );
  const body = (
    <>
      {children}
      <Blocks blocks={section.blocks} />
    </>
  );
  if (edit && isEditSection(section.id)) {
    return (
      <section aria-labelledby={titleId} className="mb-2 break-inside-avoid rounded-lg bg-panel px-3 py-2.5 text-sm" data-section={section.id}>
        <SectionEdit section={section.id} data={edit} head={head}>
          {body}
        </SectionEdit>
      </section>
    );
  }
  return (
    <section
      aria-labelledby={titleId}
      className="mb-2 break-inside-avoid rounded-lg bg-panel px-3 py-2.5 text-sm"
      data-section={section.id}
    >
      <div className="flex items-baseline gap-2">{head}</div>
      <div className="mt-1.5">{body}</div>
    </section>
  );
}

/** 欄の行は 1 つの dl に、経過はそのまま */
function Blocks({ blocks }: { blocks: readonly Block[] }) {
  const timeline = blocks.find((b) => b.type === "timeline");
  if (timeline?.type === "timeline") return <Timeline items={timeline.items} />;
  return (
    <dl className="space-y-1">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "row":
            return <RowItem key={b.row.key} row={b.row} />;
          case "clocks":
            return <ClocksRow key="clocks" label={b.label} clocks={b.clocks} />;
          case "documents":
            return b.documents.map((d) => <DocumentRow key={d.key} doc={d} />);
          case "timeline":
            return <Timeline key={i} items={b.items} />;
        }
      })}
    </dl>
  );
}

const LABEL_COL = "grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2";

/** 印刷の行き先。紙面の画面を ?print=1 で開くと、開いてすぐ印刷の画面が出る（components/ui/PrintButton の auto） */
function printHref(href: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}print=1`;
}

/**
 * 書類の行。紙面ができた書類（href あり）は「表示」と「印刷」を並べ、1 押しで印刷の画面まで行ける。
 * まだの物は「準備中」
 */
function DocumentRow({ doc }: { doc: DocumentView }) {
  return (
    <div className={`${LABEL_COL} items-center`} data-field={`documents.${doc.key}`}>
      <dt className="text-xs text-muted">{doc.label}</dt>
      <dd className={doc.href ? "flex flex-wrap gap-1" : "text-xs text-muted"}>
        {doc.href ? (
          <>
            <ButtonLink href={doc.href} kind="plain" size="sm" icon={PaperIcon}>
              {doc.status}
            </ButtonLink>
            <ButtonLink href={printHref(doc.href)} kind="plain" size="sm" icon={PrintIcon} data-print-link={doc.key}>
              印刷
            </ButtonLink>
          </>
        ) : (
          doc.status
        )}
      </dd>
      {/* 何の書類か（正式な名前・誰が誰に出す・版。lib/forms/catalog.ts） */}
      {doc.about && (
        <dd className="col-start-2 text-xs text-muted" data-document-about={doc.key}>
          {doc.about}
        </dd>
      )}
    </div>
  );
}

/** 時計（値・単位・出典・確認・頼り先）。1 つの時計を 2 行で: 名前と値、その下に小さく種類・起点・出典・確認 */
function ClocksRow({ label, clocks }: { label: string; clocks: readonly ClockView[] }) {
  return (
    <div className={LABEL_COL} data-field="clocks">
      <dt className="pt-px text-xs text-muted">{label}</dt>
      <dd className="min-w-0">
        {clocks.length === 0 ? (
          <span>{BLANK_LABELS.none}</span>
        ) : (
          <ul className="space-y-1">
            {clocks.map((k) => (
              <li key={k.id} className="rounded bg-panel2 px-2 py-1" data-clock={k.id}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span>{k.label}</span>
                  <ClockValue clock={k} />
                  {k.depends && (
                    <StateText tone={k.depends.unchecked ? "check" : "ok"} className="text-xs">
                      {k.depends.on} {k.depends.check}
                    </StateText>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                  <span>{k.kind}</span>
                  <span>
                    {CLOCK_PARTS.start} {k.start}
                  </span>
                  <span>
                    {CLOCK_PARTS.source} {k.source ?? BLANK_LABELS.unconfirmed}
                    {k.sourceNote && ` ${k.sourceNote}`}
                  </span>
                  <span className="tabular-nums">
                    {CLOCK_PARTS.confirmed} {k.confirmed ?? BLANK_LABELS.unconfirmed}
                  </span>
                  {k.note && <span>{k.note}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}

function ClockValue({ clock }: { clock: ClockView }) {
  if (clock.pending.length > 0) {
    return (
      <>
        {clock.value && <span className="font-bold tabular-nums">{clock.value}</span>}
        <PendingMark pending={clock.pending} />
      </>
    );
  }
  if (clock.value) {
    return (
      <span className={`tabular-nums ${clock.tone ? `font-bold ${TONE_TEXT[clock.tone]}` : ""}`} data-tone={clock.tone ?? undefined}>
        {clock.value}
      </span>
    );
  }
  if (!clock.runs) return <span className="text-muted">—</span>;
  return <Blank />;
}
