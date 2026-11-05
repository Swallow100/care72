// 本人のページの本体（読む側）。単独のページ（/people/[id]）と、担当一覧の右の面（/?open=<id>）で同じ物を出す。
// 簡素にしない。台帳の項目は区分ごとに全部出し、小さな字と密度で PC の 1 画面に収める。
// 大事な物（優先と理由・医療の印・時計の残り・緊急連絡先）は上に大きく、細かい物は小さく。
// 区分は面の幅に合わせて 1〜3 段に流す（container query）。区分の順は lib/person.ts の sectionOrder（発災時は経過が一番上）。
// 入れる欄（T03）はここに置かない。経過の書き足し（T24）は経過の区分の上（書ける種類があるときだけ）。
// 見える区分と欄は lib/person.ts の toPersonView が見る人の範囲（lib/consent/scope.ts）で決める。ここは来た物を描くだけ。
// 経過（T143）: 人が書き足す記録だけを経過の区分に。平時は畳んで「経過 3 件」と最後の 1 行、発災時に記録があれば開いた形（今どおり上）。
// 台帳を直した跡（入力・同意・台帳作成など。item.history）は区分の並びの下に「変更履歴」として畳んで置く（components/person/ChangeHistory）。

import { RouteMapPanel } from "@/components/map/RouteMap";
import { ButtonLink } from "@/components/ui/Button";
import { PaperIcon, PrintIcon } from "@/components/ui/Icon";
import { StateText } from "@/components/ui/Tag";
import type { Block, ClockView, DocumentView, PersonView as View, Section } from "@/lib/person";
import { BLANK_LABELS } from "@/lib/labels";
import { isEditSection, type EditData } from "@/lib/intake/edit";
import { PendingMark, RowItem, type Level } from "./parts";
import { ClockLines } from "./ClockLines";
import { SectionEdit } from "./SectionEdit";
import { PersonHead } from "./PersonHead";
import { Timeline, TimelineSummary, recordItems } from "./Timeline";
import { TimelineComposer } from "./TimelineComposer";
import { ChangeHistory } from "./ChangeHistory";
import { Fold } from "./Fold";
import { FOLD_LABELS } from "@/lib/timeline/labels";
import { COMPOSER_LABELS } from "@/lib/consent/labels";
import type { PageMode, TimelineItem } from "@/lib/person";

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
        {view.sections.map((s) =>
          s.id === "timeline" ? (
            <TimelinePanel
              key={s.id}
              section={s}
              level={level}
              titleId={`${base}-${s.id}`}
              mode={view.mode}
              composer={view.writes.length > 0 ? <TimelineComposer personId={view.head.id} kinds={view.writes} /> : null}
              composerOpen={view.writesOpen}
            />
          ) : (
            <SectionPanel
              key={s.id}
              section={s}
              level={level}
              titleId={`${base}-${s.id}`}
              edit={edit}
              // 避難経路の地図（T102）。ケアマネの役で開いたときだけ、避難の面の下に（位置を扱うので面の編集と同じ人だけ）
              after={s.id === "evacuation" && edit ? <RouteMapPanel data={edit} /> : null}
            />
          ),
        )}
      </div>
      {/* 台帳を直した跡（T143）。区分の並びの下に、ページの幅で畳んで */}
      <ChangeHistory items={historyItems(view.sections)} idBase={base} level={level} />
    </div>
  );
}

/** 経過の区分の行 */
function timelineOf(section: Section): TimelineItem[] {
  return section.blocks.flatMap((b) => (b.type === "timeline" ? b.items : []));
}

/** 変更履歴の行（経過の区分の行のうち台帳を直した跡。見る人の範囲で絞った後の物） */
function historyItems(sections: readonly Section[]): TimelineItem[] {
  const s = sections.find((x) => x.id === "timeline");
  return s ? timelineOf(s).filter((t) => t.history) : [];
}

/**
 * 経過の区分（T24・T63・T79・T143）。平時は畳み（「経過 3 件」と最後の 1 行）、発災時は記録があれば開く。行が無ければ「記録なし」の一言。
 * 書き足しの欄（書ける種類があるときだけ）は、災害モードと医療班・行政の役（composerOpen）は見出しの下にいつも、
 * 平時のケアマネは畳みの中（開いた時だけ。行が無ければ「追記」で開く）
 */
function TimelinePanel({
  section,
  level,
  titleId,
  mode,
  composer,
  composerOpen,
}: {
  section: Section;
  level: Level;
  titleId: string;
  mode: PageMode;
  composer: React.ReactNode;
  composerOpen: boolean;
}) {
  const H = level === 1 ? "h2" : "h3";
  const items = recordItems(timelineOf(section));
  const head = (
    <H id={titleId} className="text-[1rem] leading-6 font-bold">
      {section.label}
    </H>
  );
  const writer = composer ? <div className="mt-1.5">{composer}</div> : null;
  const folded = composerOpen ? null : writer;
  const empty = (
    <p className="mt-1 text-xs text-muted" data-timeline-empty>
      {FOLD_LABELS.empty}
    </p>
  );
  return (
    <section aria-labelledby={titleId} className="mb-2 break-inside-avoid rounded-lg bg-panel px-3 py-2.5 text-sm" data-section="timeline">
      {items.length === 0 && !folded ? (
        <>
          <div className="flex items-baseline gap-2">
            {head}
            <span className="text-xs text-muted" data-timeline-empty>
              {FOLD_LABELS.empty}
            </span>
          </div>
          {composerOpen && writer}
        </>
      ) : (
        <Fold
          // 災害モードに切り替わったら開き直す（平時の畳みを持ち越さない）
          key={mode}
          id={`${titleId}-list`}
          name="timeline"
          head={head}
          count={items.length}
          openLabel={COMPOSER_LABELS.title}
          between={composerOpen ? writer : null}
          defaultOpen={mode === "disaster" && items.length > 0}
          summary={items.length > 0 ? <TimelineSummary item={items[items.length - 1]} /> : empty}
        >
          {folded}
          {items.length > 0 && <Timeline items={items} />}
        </Fold>
      )}
    </section>
  );
}

function SectionPanel({
  section,
  level,
  titleId,
  edit = null,
  children,
  after = null,
}: {
  section: Section;
  level: Level;
  titleId: string;
  edit?: EditData | null;
  children?: React.ReactNode;
  /** 面の行の下に足す物（避難の面の経路地図、T102） */
  after?: React.ReactNode;
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
      {/* 見る方の画面で区分の中が全部当たり前の値だった（T143） */}
      {section.quiet && (
        <span className="text-xs text-muted" data-section-quiet>
          {BLANK_LABELS.usual}
        </span>
      )}
    </>
  );
  const body = (
    <>
      {children}
      <Blocks blocks={section.blocks} />
      {after}
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

/** 欄の行は 1 つの dl に、経過はそのまま。行の詳細の「全部」（T132、components/list/FullDetail.tsx）も同じこれで面を描く */
export function Blocks({ blocks }: { blocks: readonly Block[] }) {
  // 経過は人が書き足す記録だけ（台帳を直した跡は Timeline が外す。T143）
  const timeline = blocks.find((b) => b.type === "timeline");
  if (timeline?.type === "timeline") return <Timeline items={timeline.items} />;
  return (
    <dl className="space-y-1">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "row":
            return <RowItem key={b.row.key} row={b.row} />;
          case "clocks":
            return <ClocksRow key="clocks" label={b.label} clocks={b.clocks} quiet={b.quiet === true} />;
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

/**
 * 時計。区分（機器・物品・薬・状態）の見出しで束ね、1 つの時計を 2 行で: 物の名前ときっかけから長さ（「停電から 2 時間」）、
 * その下に小さく出典・確認日・メモ。言葉は担当一覧・訓練の行の詳細と同じ所（lib/ledger-words.ts、components/person/ClockLines。T132）
 */
function ClocksRow({ label, clocks, quiet }: { label: string; clocks: readonly ClockView[]; quiet: boolean }) {
  return (
    <div className={LABEL_COL} data-field="clocks">
      <dt className="pt-px text-xs text-muted">{label}</dt>
      <dd className="min-w-0">
        {clocks.length === 0 ? (
          <span>{BLANK_LABELS.none}</span>
        ) : (
          <ClockLines
            boxed
            quiet={quiet}
            items={clocks.map((k) => ({
              id: k.id,
              text: k.text,
              tone: k.tone,
              toneOnSpan: true,
              // 台帳の未確認（理由つき）は長さの所に。値があるのに未確認の印の付いた時計は長さの右に
              ...(k.pending.length > 0
                ? k.text.missing
                  ? { missingMark: <PendingMark pending={k.pending} /> }
                  : { after: <PendingMark pending={k.pending} /> }
                : {}),
              note: k.note,
            }))}
          />
        )}
      </dd>
    </div>
  );
}

