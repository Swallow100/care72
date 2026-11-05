import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { countColors } from "@/components/disaster/ColorCounts";
import { Classification } from "@/components/list/Classification";
import { Hearing } from "@/components/list/Hearing";
import { Summary } from "@/components/list/Summary";
import { CaseloadTable } from "@/components/list/CaseloadTable";
import { DisasterSummary } from "@/components/list/DisasterSummary";
import { DisasterTable } from "@/components/list/DisasterTable";
import { FilterBar } from "@/components/list/FilterBar";
import type { ClassificationSlot, HearingSlot, SummarySlot } from "@/components/list/RowDetail";
import { SidePane, type SideMapOptions } from "@/components/list/SidePane";
import { CaseloadEmpty } from "@/components/office/CaseloadEmpty";
import { UnlistedFold } from "@/components/office/UnlistedFold";
import { UnlistedRows } from "@/components/office/UnlistedRows";
import { PersonWithIntake } from "@/components/person/PersonWithIntake";
import { REASON_TEXT, StateTag } from "@/components/person/parts";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { AddPersonIcon, CloseIcon, DownloadIcon, PrintIcon } from "@/components/ui/Icon";
import { PageHead, Panel } from "@/components/ui/Panel";
import { TABLE_BOX } from "@/components/ui/table";
import { todayJst } from "@/lib/age";
import type { Principal } from "@/lib/auth/principal";
import { caseloadScope } from "@/lib/auth/scope";
import { classViewOf } from "@/lib/classify/view";
import { requirePage } from "@/lib/auth/server";
import { aiStatusFor } from "@/lib/claude/cloudflare";
import { intakePropsOf, type IntakeProps } from "@/lib/intake/props";
import {
  caseloadHref,
  closeHref,
  filterActive,
  filterOptions,
  loadCaseload,
  parseOpen,
  rowLink,
  type Caseload,
  type CaseloadRow,
  type ListView,
  type SortKey,
} from "@/lib/caseload";
import { CASELOAD_CSV_PATH, EXPORT_LABELS, OWN_SHEETS_PATH } from "@/lib/forms/export-paths";
import { listHref, listView, type ListViewResult } from "@/lib/list/view";
import { personDisaster } from "@/lib/disaster/person";
import { elapsedText, shortJst } from "@/lib/disaster/state";
import { stateLabel, TIER_LABELS } from "@/lib/labels";
import { nowcastOn } from "@/lib/jma/nowcast";
import { buildSidePane, sideDisasterOf } from "@/lib/map/side";
import { loadOfficePlace } from "@/lib/office/place";
import { mapRegionOf } from "@/lib/office/region";
import { parsePeopleError } from "@/lib/office/http";
import { NEW_PERSON_PATH } from "@/lib/office/http-paths";
import { canSeeSetup } from "@/lib/office/setup";
import { OFFICE_ERROR_LABELS, OFFICE_LABELS } from "@/lib/office/labels";
import { loadPlanForm, planFormView } from "@/lib/forms/plan-form";
import { COLOR_TONES, loadPersonPage, toPersonView, type PersonView as View } from "@/lib/person";
import type { TriageResult } from "@/lib/triage/index";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Param = string | string[];
type Props = {
  searchParams: Promise<{
    sort?: Param;
    dir?: Param;
    open?: Param;
    color?: Param;
    area?: Param;
    mark?: Param;
    q?: Param;
    people_error?: Param;
  }>;
};

/**
 * 行の詳細の「分類と直す口」（T12 の components/list/Classification.tsx）。録音か文字起こしのある信号ごとに描く。
 * 信号の行は SELECT * なので ai_* の列も入っている。担当一覧を開けるのはケアマネの役だけなので、直す口はいつも出す（API もケアマネ以外は 403）
 */
const CLASSIFICATION: ClassificationSlot = (s) => <Classification signalId={s.id} view={classViewOf(s.row)} editable inset />;

/** 行の詳細の「聞き取り」（T49）。押した答えと Claude の聞き取りメモ（AI の印）。ケアマネが直せる。色と順は動かさない。場所の欄に避難先の名前と申告位置（T69b） */
const HEARING: HearingSlot = (s) => (
  <Hearing
    signalId={s.id}
    source={{ answers: s.row.answers, ai_memo: s.row.ai_memo, memo: s.row.memo }}
    place={s.place}
    editable
    inset
  />
);

/** 行の詳細の「まとめ」（T69b）。Claude のまとめ（AI の印）と本人の言葉を並べる。ケアマネが直せる・まとめが無ければ「生成」。色と順は動かさない */
const SUMMARY: SummarySlot = (s) => <Summary signalId={s.id} summary={s.summary} transcript={s.transcript} editable inset />;

// 担当一覧。ケアマネは自分の担当、審査員（ケアマネの役）はデモ事業所の山本の担当。
// 行を押すと本人のページが右に開き（?open=<id>）、一覧は左に圧縮される。狭い幅は本人のページだけ。
// ログインしていなければ /login へ、行政・医療班・本人・家族・役を選ぶ前の審査員は、それぞれの入口へ送る（requirePage）
// 災害モード（lib/disaster）のときは発災時の表（components/list/DisasterTable、T13）: 先頭に状態（至急・要確認・未知・無事）と
// 優先の番号、残り・最終連絡の列を足し、既定の並びがルールの表の順。行を押すと行の下に詳細（電話・録音・上書き）が開く。
// 上に色ごとの人数と発災・停電からの経過。今の時刻で当て直すので、ヘッダーの読み直し（1 分ごと）で色と並びが進む
export default async function CaseloadPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const q = await searchParams;
  const open = parseOpen(q.open);
  const scope = caseloadScope(principal);

  const now = new Date().toISOString();
  let data: Caseload | null;
  // 右の面の地図の真ん中（ピンが無いとき。事業所の中心、T68）と、気象庁の雨雲（旗 JMA_NOWCAST が on のとき。デモ事業所も。T72・T103）
  // 「位置は架空」はデモ事業所（種の架空の位置）だけ。本物の事業所の地図には出さない（T114）
  let map: SideMapOptions = { center: null, nowcast: false, fictional: false };
  try {
    const { env } = await getCloudflareContext({ async: true });
    data = scope ? await loadCaseload(env.DB, scope, todayJst(), now) : null;
    if (principal.office) {
      const place = await loadOfficePlace(env.DB, principal.office.id).catch(() => null);
      // 地域（中心と広さ、T148）: ピンが無いときの初めの表示と「地域」のボタン。ピンがあれば初めはピンが全部入る表示のまま
      const region = place ? mapRegionOf(place) : null;
      map = { center: place?.center ?? null, region, fictional: principal.office.kind === "demo", nowcast: nowcastOn(env) };
    }
  } catch (e) {
    console.error("担当一覧を読めない", e);
    return <Message title="読込失敗" />;
  }
  if (!data) return <Message title="担当なし" />;

  const disaster = data.situation !== null;
  // 並び・向き・絞込（T58）は CSV・一括印刷（T62）と同じ listView（lib/list/view.ts）で当てる（3 つの行と順を必ずそろえる）。
  // 平時は発災時だけの列（状態・残り・最終連絡）の並びを優先に戻し、色で絞らない。
  // 絞っても優先の番号は絞る前のまま（toCaseloadRows で振った rank）。上の人数は絞る前の数
  const lv = listView(data, q);
  const { key, dir, filter, all, rows } = lv;
  const view: ListView = { dir, filter };
  const count = filterActive(filter) ? `${rows.length} / ${all.length} 人` : `${all.length} 人`;
  const options = filterOptions(data.rows);
  // 色ごとの人数（絞る前）。上の人数と絞込の帯の状態の切替で同じ数
  const colorCounts = countColors(all.flatMap((r) => (r.triage ? [r.triage.color] : [])));
  const filterBar = (actions?: React.ReactNode) => (
    <FilterBar
      filter={filter}
      areas={options.areas}
      marks={options.marks}
      disaster={disaster}
      colorCounts={colorCounts}
      sort={key}
      dir={dir}
      open={open}
      actions={actions}
    />
  );
  const peopleError = parsePeopleError(q.people_error);
  // 一覧から外した人（T30）。一覧の下の畳み「外した人 N」
  const unlisted = (
    <UnlistedFold count={data.unlisted.length}>
      <UnlistedRows rows={data.unlisted.map((u) => ({ ...u, href: rowLink(key, open, u.id, view).href }))} back="caseload" />
    </UnlistedFold>
  );

  if (open) {
    return (
      <main className="mx-auto grid max-w-[90rem] gap-3 px-4 py-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* 内側で送らない（送るのは画面全体の縦 1 本）。10 人前後なら本人のページと並んで収まる */}
        <section aria-labelledby="caseload-title" className="hidden self-start lg:block">
          <div className="flex items-center gap-2 px-1">
            <h1 id="caseload-title" className="text-[1rem] leading-6 font-bold">
              担当一覧
            </h1>
            <span className="text-sm text-muted tabular-nums">{count}</span>
            <ButtonLink href={NEW_PERSON_PATH} kind="plain" size="sm" icon={AddPersonIcon} className="ml-auto">
              {OFFICE_LABELS.addPerson}
            </ButtonLink>
          </div>
          <Panel as="div" className="mt-2 px-2.5 py-2">
            {filterBar()}
          </Panel>
          <CompactList rows={rows} sort={key} open={open} view={view} />
          {unlisted}
        </section>
        <PersonPanel principal={principal} id={open} sort={key} list={view} now={now} />
      </main>
    );
  }

  // 右の面（T14）: 平時は計画の内訳・見直し・未確認・地図。災害モード（T09）は地図が上で、ピンは行の lib/triage の色、
  // 震度のデモは事業所の災害の種類から
  // 震度のデモの絵はデモ事業所だけ（T72。本物の事業所の地図には出さない）。作り物の雨雲は描かない（訓練だけ。T103）
  const side = buildSidePane(all, {
    sort: key,
    disaster: data.situation ? sideDisasterOf(all, data.disaster, { office: principal.office?.kind ?? "regular" }) : null,
  });
  const s = data.situation;
  // 発災時は列が多く表に約 64rem 要るので広く使い、右の面を横に出すのは 1536px（2xl）から（それ未満は表の下、components/list/SidePane）
  return (
    <main
      className={`mx-auto grid gap-6 px-4 py-6 ${
        disaster
          ? "max-w-[90rem] 2xl:grid-cols-[minmax(0,1fr)_22rem]"
          : "max-w-6xl lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]"
      }`}
    >
      <section aria-labelledby="caseload-title" className="min-w-0">
        {/* 利用者追加（T30）は見出しの段の右上。事業所のケアマネ追加と同じ形（主の操作・人＋のアイコン・32px）。
            書き出し（T62: CSV出力・一括印刷）は絞込の帯の右端の 1 か所だけ（T78。前は見出しの段にも同じ 2 つがあった） */}
        <PageHead
          id="caseload-title"
          title="担当一覧"
          count={count}
          actions={
            <ButtonLink href={NEW_PERSON_PATH} kind="main" icon={AddPersonIcon}>
              {OFFICE_LABELS.addPerson}
            </ButtonLink>
          }
        />
        {/* 災害モードは色ごとの人数（大きく）と発災・停電からの経過（平時の計画の人数は右の面の「計画」） */}
        {s && (
          <Panel as="div" className="mt-3 px-4">
            <DisasterSummary
              counts={colorCounts}
              disaster={elapsedText(s.disasterAt, s.now)}
              outage={s.outageAt ? { elapsed: elapsedText(s.outageAt, s.now), area: s.outageTowns !== null } : null}
              at={shortJst(now)}
              current={filter.color}
              href={(c) => caseloadHref({ sort: key, dir, filter: { ...filter, color: filter.color === c ? null : c } })}
            />
          </Panel>
        )}
        <Panel as="div" className="mt-3 px-3 py-2">
          {/* 書き出しは絞ったあとに押す流れなので、絞込の帯の右端に 1 か所（T62・T78） */}
          {filterBar(<ExportButtons view={lv} />)}
        </Panel>
        {peopleError && (
          <p role="alert" className="mt-2 text-sm font-bold text-danger">
            {OFFICE_ERROR_LABELS[peopleError]}
          </p>
        )}
        {rows.length === 0 ? (
          <CaseloadEmpty addPerson={all.length === 0 && canSeeSetup(principal)} />
        ) : (
          // 横に送らない。PC の幅（1024px 以上）は全部の列、狭い幅は列を省く（表の部品）
          <div className={`mt-3 ${TABLE_BOX}`}>
            {disaster ? (
              <DisasterTable rows={rows} sort={key} dir={dir} filter={filter} classification={CLASSIFICATION} hearing={HEARING} summary={SUMMARY} />
            ) : (
              <CaseloadTable rows={rows} sort={key} dir={dir} filter={filter} />
            )}
          </div>
        )}
        {unlisted}
      </section>
      <SidePane data={side} map={map} />
    </main>
  );
}

/** 右の面。範囲の外（違う事業所・無い id）は面に「該当なし」と出し、一覧は残す。災害モードなら経過が上、色と理由 */
async function PersonPanel({
  principal,
  id,
  sort,
  list,
  now,
}: {
  principal: Principal;
  id: string;
  sort: SortKey;
  /** 一覧の並びの向きと絞込（閉じたときに残す） */
  list: ListView;
  now: string;
}) {
  let view: View | null = null;
  let intake: IntakeProps | null = null;
  let failed = false;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const rows = await loadPersonPage(env.DB, principal, id);
    const d = rows ? await personDisaster(env.DB, rows, now) : null;
    const planForm = rows ? planFormView(await loadPlanForm(env.DB, rows.person.office_id)) : undefined;
    view = rows && d ? toPersonView(rows, { today: todayJst(), mode: d.mode, triage: d.triage, situation: d.situation, planForm }) : null;
    // 入れる欄（T03）はケアマネの役だけ（担当一覧はケアマネの役しか開けない）
    // AI の状態（未設定・上限到達・本日残り）は lib/claude/status.ts の 1 か所（T76）
    intake = rows && principal.role === "care_manager" ? intakePropsOf(rows, await aiStatusFor(rows.person.office_id)) : null;
  } catch (e) {
    console.error("本人のページを読めない", e);
    failed = true;
  }
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <ButtonLink href={closeHref(sort, list)} kind="quiet" size="sm" icon={CloseIcon} className="-ml-2">
          閉じる
        </ButtonLink>
      </div>
      {view ? (
        <PersonWithIntake view={view} level={2} intake={intake} />
      ) : (
        <Panel>
          <h2 className="text-[1rem] leading-6 font-bold">{failed ? "読込失敗" : "該当なし"}</h2>
        </Panel>
      )}
    </div>
  );
}

/** 右に開いている間の一覧。優先・氏名・医療の印だけに圧縮する。選んだ行は枠と太字。発災時は色の印と優先の番号。
 * 1 つの面にまとめ、行は地の色の 1px のすき間で分ける */
function CompactList({ rows, sort, open, view }: { rows: CaseloadRow[]; sort: SortKey; open: string; view: ListView }) {
  return (
    <ul className="mt-2 grid gap-px overflow-hidden rounded-lg bg-base">
      {rows.map((r) => {
        const link = rowLink(sort, open, r.id, view);
        return (
          <li key={r.id}>
            <Link
              href={link.href}
              replace={link.replace}
              aria-current={link.current ? "true" : undefined}
              className={`grid ${r.triage ? "grid-cols-[3rem_minmax(0,1fr)]" : "grid-cols-[2rem_minmax(0,1fr)]"} items-baseline gap-x-2 bg-panel px-2.5 py-1.5 text-sm ${
                link.current ? "font-bold outline-2 -outline-offset-2 outline-accent" : ""
              }`}
              data-press="overlay"
            >
              {r.triage ? (
                <span className="text-center">
                  <TriageTag triage={r.triage} />
                  {r.rank !== null && <span className="mt-0.5 block text-xs text-muted">{r.rank}</span>}
                </span>
              ) : (
                <span className="text-center font-bold" title={TIER_LABELS[r.tier]}>
                  {r.tier}
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate">{r.name}</span>
                {r.triage ? (
                  <span className={`block truncate text-xs font-bold ${REASON_TEXT[COLOR_TONES[r.triage.color]]}`} title={r.triage.reason}>
                    {r.triage.reason}
                  </span>
                ) : (
                  r.marks.length > 0 && <span className="block truncate text-xs font-normal text-muted">{r.marks.join("・")}</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 書き出しの 2 つ（T62）。今の並びと絞込の query を持ち越す（右に開く本人は持ち越さない）。
 * CSV出力は様式 9 と同じ字・アイコン・download の a。一括印刷は本人の 1 枚を人数分の頁へ移り、すぐ印刷の窓（?print=1）。
 * どちらも移る物なので無色（印刷の操作の色は移った先の頁の「印刷」）。一括印刷は先読みしない（人数分の D1 を読むので）
 */
function ExportButtons({ view }: { view: ListViewResult }) {
  return (
    <>
      <a href={listHref(CASELOAD_CSV_PATH, view)} download className={buttonClass("plain")} data-press data-export="csv">
        <DownloadIcon aria-hidden className="size-4 shrink-0" />
        {EXPORT_LABELS.csv}
      </a>
      <ButtonLink href={listHref(OWN_SHEETS_PATH, view, { print: "1" })} kind="plain" icon={PrintIcon} prefetch={false} data-export="print">
        {EXPORT_LABELS.batchPrint}
      </ButtonLink>
    </>
  );
}

/** ルールの表の色の印（至急・要確認・不明・無事。受入・搬送から来た緑は「受入」「搬送」、T78）。色だけにせず文字を添える */
function TriageTag({ triage, size = "sm" }: { triage: Pick<TriageResult, "color" | "greenVia">; size?: "sm" | "md" }) {
  return (
    <StateTag tone={COLOR_TONES[triage.color]} size={size}>
      {stateLabel(triage)}
    </StateTag>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <Panel>
        <h1 className="text-xl font-bold">{title}</h1>
      </Panel>
    </main>
  );
}
