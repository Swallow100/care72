import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { countColors } from "@/components/disaster/ColorCounts";
import { Classification } from "@/components/list/Classification";
import { DisasterSummary } from "@/components/list/DisasterSummary";
import { DisasterTable } from "@/components/list/DisasterTable";
import type { ClassificationSlot } from "@/components/list/RowDetail";
import { SidePane } from "@/components/list/SidePane";
import { SortHeader } from "@/components/list/SortHeader";
import { UnlistedFold } from "@/components/office/UnlistedFold";
import { UnlistedRows } from "@/components/office/UnlistedRows";
import { PersonWithIntake } from "@/components/person/PersonWithIntake";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { ButtonLink } from "@/components/ui/Button";
import { AddPersonIcon, CloseIcon } from "@/components/ui/Icon";
import { PageHead, Panel } from "@/components/ui/Panel";
import { Mark, StateText } from "@/components/ui/Tag";
import { TABLE, TABLE_BOX, TD } from "@/components/ui/table";
import { todayJst } from "@/lib/age";
import type { Principal } from "@/lib/auth/principal";
import { caseloadScope } from "@/lib/auth/scope";
import { classViewOf } from "@/lib/classify/view";
import { requirePage } from "@/lib/auth/server";
import { hasAnthropicKey } from "@/lib/claude/client";
import { intakePropsOf, type IntakeProps } from "@/lib/intake/props";
import {
  closeHref,
  DISASTER_SORT_KEYS,
  loadCaseload,
  parseOpen,
  PLAN_TONES,
  rowLink,
  sortCaseload,
  SORT_KEYS,
  type Caseload,
  type CaseloadRow,
  type SortKey,
} from "@/lib/caseload";
import { personDisaster } from "@/lib/disaster/person";
import { elapsedText, shortJst } from "@/lib/disaster/state";
import { CARE_LEVEL_LABELS, COLOR_LABELS, PLAN_STATUS_LABELS, TIER_LABELS } from "@/lib/labels";
import { buildSidePane, sideDisasterOf } from "@/lib/map/side";
import { parsePeopleError } from "@/lib/office/http";
import { NEW_PERSON_PATH } from "@/lib/office/http-paths";
import { OFFICE_ERROR_LABELS, OFFICE_LABELS } from "@/lib/office/labels";
import { COLOR_TONES, loadPersonPage, toPersonView, type PersonView as View } from "@/lib/person";
import type { Color } from "@/lib/triage/index";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ sort?: string | string[]; open?: string | string[]; people_error?: string | string[] }>;
};

/**
 * 行の詳細の「分類と直す口」（T12 の components/list/Classification.tsx）。録音か文字起こしのある信号ごとに描く。
 * 信号の行は SELECT * なので ai_* の列も入っている。担当一覧を開けるのはケアマネの役だけなので、直す口はいつも出す（API もケアマネ以外は 403）
 */
const CLASSIFICATION: ClassificationSlot = (s) => <Classification signalId={s.id} view={classViewOf(s.row)} editable inset />;

function isSortKey(v: unknown): v is SortKey {
  return typeof v === "string" && SORT_KEYS.includes(v as SortKey);
}

// 担当一覧。ケアマネは自分の担当、審査員（ケアマネの役）はデモ事業所の山本の担当。
// 行を押すと本人のページが右に開き（?open=<id>）、一覧は左に圧縮される。狭い幅は本人のページだけ。
// ログインしていなければ /login へ、行政・医療班・本人・家族・役を選ぶ前の審査員は、それぞれの入口へ送る（requirePage）
// 災害モード（lib/disaster）のときは発災時の表（components/list/DisasterTable、T13）: 先頭に状態（至急・要確認・未知・無事）と
// 優先の番号、残り・最終連絡の列を足し、既定の並びがルールの表の順。行を押すと行の下に詳細（電話・録音・上書き）が開く。
// 上に色ごとの人数と発災・停電からの経過。今の時刻で当て直すので、ヘッダーの読み直し（1 分ごと）で色と並びが進む
export default async function CaseloadPage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const q = await searchParams;
  const asked: SortKey = isSortKey(q.sort) ? q.sort : "tier";
  const open = parseOpen(q.open);
  const scope = caseloadScope(principal);

  const now = new Date().toISOString();
  let data: Caseload | null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    data = scope ? await loadCaseload(env.DB, scope, todayJst(), now) : null;
  } catch (e) {
    console.error("担当一覧を読めない", e);
    return <Message title="読込失敗" />;
  }
  if (!data) return <Message title="担当なし" />;

  const disaster = data.situation !== null;
  // 発災時だけの列（状態・残り・最終連絡）の並びは、平時は優先に戻す
  const key: SortKey = !disaster && DISASTER_SORT_KEYS.includes(asked) ? "tier" : asked;
  const rows = sortCaseload(data.rows, key);
  const peopleError = parsePeopleError(q.people_error);
  // 一覧から外した人（T30）。一覧の下の畳み「外した人 N」
  const unlisted = (
    <UnlistedFold count={data.unlisted.length}>
      <UnlistedRows rows={data.unlisted.map((u) => ({ ...u, href: rowLink(key, open, u.id).href }))} back="caseload" />
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
            <span className="text-sm text-muted">{rows.length} 人</span>
            <ButtonLink href={NEW_PERSON_PATH} kind="plain" size="sm" icon={AddPersonIcon} className="ml-auto">
              {OFFICE_LABELS.addPerson}
            </ButtonLink>
          </div>
          <CompactList rows={rows} sort={key} open={open} />
          {unlisted}
        </section>
        <PersonPanel principal={principal} id={open} sort={key} now={now} />
      </main>
    );
  }

  // 右の面（T14）: 平時は計画の内訳・見直し・未確認・地図。災害モード（T09）は地図が上で、ピンは行の lib/triage の色、
  // 雨雲・震度のデモは事業所の災害の種類と警戒レベルから
  const side = buildSidePane(rows, { sort: key, disaster: data.situation ? sideDisasterOf(rows, data.disaster) : null });
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
        {/* 利用者追加（T30）は見出しの段の右上。事業所のケアマネ追加と同じ形（主の操作・人＋のアイコン・32px） */}
        <PageHead
          id="caseload-title"
          title="担当一覧"
          count={`${rows.length} 人`}
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
              counts={countColors(rows.flatMap((r) => (r.triage ? [r.triage.color] : [])))}
              disaster={elapsedText(s.disasterAt, s.now)}
              outage={s.outageAt ? { elapsed: elapsedText(s.outageAt, s.now), area: s.outageTowns !== null } : null}
              at={shortJst(now)}
            />
          </Panel>
        )}
        {peopleError && (
          <p role="alert" className="mt-2 text-sm font-bold text-danger">
            {OFFICE_ERROR_LABELS[peopleError]}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="mt-3 rounded-lg bg-panel px-3 py-2 text-muted">なし</p>
        ) : (
          // 横に送らない。PC の幅（1024px 以上）は全部の列、狭い幅は列を省く（表の部品）
          <div className={`mt-3 ${TABLE_BOX}`}>
            {disaster ? (
              <DisasterTable rows={rows} sort={key} classification={CLASSIFICATION} />
            ) : (
              <CaseloadTable rows={rows} sort={key} />
            )}
          </div>
        )}
        {unlisted}
      </section>
      <SidePane data={side} />
    </main>
  );
}

/** 右の面。範囲の外（違う事業所・無い id）は面に「該当なし」と出し、一覧は残す。災害モードなら経過が上、色と理由 */
async function PersonPanel({ principal, id, sort, now }: { principal: Principal; id: string; sort: SortKey; now: string }) {
  let view: View | null = null;
  let intake: IntakeProps | null = null;
  let failed = false;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const rows = await loadPersonPage(env.DB, principal, id);
    const d = rows ? await personDisaster(env.DB, rows, now) : null;
    view = rows && d ? toPersonView(rows, { today: todayJst(), mode: d.mode, triage: d.triage, situation: d.situation }) : null;
    // 入れる欄（T03）はケアマネの役だけ（担当一覧はケアマネの役しか開けない）
    intake = rows && principal.role === "care_manager" ? intakePropsOf(rows, hasAnthropicKey(env)) : null;
  } catch (e) {
    console.error("本人のページを読めない", e);
    failed = true;
  }
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between">
        <ButtonLink href={closeHref(sort)} kind="quiet" size="sm" icon={CloseIcon} className="-ml-2">
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
function CompactList({ rows, sort, open }: { rows: CaseloadRow[]; sort: SortKey; open: string }) {
  return (
    <ul className="mt-2 grid gap-px overflow-hidden rounded-lg bg-base">
      {rows.map((r) => {
        const link = rowLink(sort, open, r.id);
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
                  <TriageTag color={r.triage.color} />
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
                  <span className={`block truncate text-xs font-bold ${TONE_TEXT[COLOR_TONES[r.triage.color]]}`} title={r.triage.reason}>
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

const CELL = TD;

/**
 * 平時の表。列は 優先（骨格の段）・氏名・年齢・医療・ハザード・支援者・計画。どの列でも並べ替えられる。
 * 横に送らない: 768px 未満は医療・ハザード・支援者を省き、氏名の下に医療の印を出す
 */
function CaseloadTable({ rows, sort }: { rows: CaseloadRow[]; sort: SortKey }) {
  const wide = "hidden md:table-cell";
  return (
    <table className={TABLE}>
      <thead>
        <tr>
          <SortHeader k="tier" sort={sort} className="w-14 text-center" />
          <SortHeader k="kana" sort={sort} />
          <SortHeader k="age" sort={sort} />
          <SortHeader k="medical" sort={sort} className={wide} />
          <SortHeader k="hazard" sort={sort} className={wide} />
          <SortHeader k="supporter" sort={sort} className={wide} />
          <SortHeader k="plan" sort={sort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className={`${CELL} text-center`}>
              <span className="text-lg leading-6 font-bold" title={TIER_LABELS[r.tier]}>
                {r.tier}
              </span>
            </td>
            <td className={CELL}>
              <Link href={rowLink(sort, null, r.id).href} className="-mx-1 rounded px-1 font-bold" data-press>
                {r.name}
              </Link>
              <span className="ml-1.5 text-xs text-muted">{r.kana}</span>
              {r.marks.length > 0 && <div className="mt-0.5 text-xs text-muted md:hidden">{r.marks.join("・")}</div>}
            </td>
            <td className={`${CELL} whitespace-nowrap`}>
              {r.age ?? "—"}
              <span className="text-muted"> 歳</span>
              <div className="text-xs">{r.careLevel ? CARE_LEVEL_LABELS[r.careLevel] : "—"}</div>
            </td>
            <td className={`${CELL} ${wide}`}>
              {r.marks.length === 0 ? (
                <span className="text-muted">—</span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {r.marks.map((m) => (
                    <Mark key={m}>{m}</Mark>
                  ))}
                </div>
              )}
            </td>
            <td className={`${CELL} ${wide}`}>{r.hazards.length === 0 ? <span className="text-muted">なし</span> : r.hazards.join("・")}</td>
            <td className={`${CELL} ${wide} whitespace-nowrap`}>
              {r.supporters > 0 ? `${r.supporters} 人` : <StateText tone="check">なし</StateText>}
            </td>
            <td className={`${CELL} whitespace-nowrap`}>
              {/* 避難計画は 2 番目の状態なので色の文字（塗りの印は安否の状態だけ） */}
              <StateText tone={PLAN_TONES[r.plan]}>{PLAN_STATUS_LABELS[r.plan]}</StateText>
              {r.pending > 0 && <div className="text-xs font-bold tone-check">未確認 {r.pending}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** ルールの表の色の印（至急・要確認・不明・無事）。色だけにせず文字を添える */
function TriageTag({ color, size = "sm" }: { color: Color; size?: "sm" | "md" }) {
  return (
    <StateTag tone={COLOR_TONES[color]} size={size}>
      {COLOR_LABELS[color]}
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
