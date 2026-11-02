import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { ColorCounts } from "@/components/disaster/ColorCounts";
import { DisasterBadge } from "@/components/disaster/DisasterBadge";
import { AddCareManager } from "@/components/office/AddCareManager";
import { UnlistedFold } from "@/components/office/UnlistedFold";
import { UnlistedRows } from "@/components/office/UnlistedRows";
import { StateTag, TONE_TEXT } from "@/components/person/parts";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { PLAN_TONES } from "@/lib/caseload";
import { ALERT_LEVELS, DISASTER_KINDS, OUTAGE_SCOPES, type DisasterKind } from "@/lib/db/types";
import { loadDisasterState, loadOfficeLog, loadOfficeTowns, type OfficeLogItem, type TownCount } from "@/lib/disaster/db";
import { OFFICE_INFO_PATH, OFFICE_MODE_PATH, OFFICE_PATH, officeHref, parseConfirm, parseFormError } from "@/lib/disaster/http";
import { disasterScope } from "@/lib/disaster/scope";
import {
  DISASTER_FORM_ERROR_LABELS,
  DISASTER_KIND_LABELS,
  DISASTER_LABELS,
  disasterMark,
  elapsedText,
  inOutageArea,
  infoOf,
  isDisaster,
  MAX_TEXT_LENGTH,
  OUTAGE_SCOPE_LABELS,
  shortJst,
  toLocalInput,
  toSituation,
  type DisasterState,
} from "@/lib/disaster/state";
import { colorCounts, NORMAL_ORDER_LABELS } from "@/lib/forms/form9";
import { form9Scope, loadForm9 } from "@/lib/forms/form9-db";
import { FORM9_CSV_PATH, FORM9_PATH } from "@/lib/forms/form9-href";
import { PLAN_STATUS_LABELS } from "@/lib/labels";
import { parsePeopleError } from "@/lib/office/http";
import { ASSIGN_ANCHOR, NEW_PERSON_PATH, OFFICE_PEOPLE_PATH } from "@/lib/office/http-paths";
import { OFFICE_ERROR_LABELS, OFFICE_LABELS, type PeopleActionError } from "@/lib/office/labels";
import { listCareManagers, listOfficePeople, type CareManagerItem, type OfficePersonItem } from "@/lib/office/people";
import { officeActor } from "@/lib/office/scope";
import { CUSTODY_LABELS } from "@/lib/custody/labels";
import { OFFICE_TAKE_PATH, UNAFFILIATED_ANCHOR } from "@/lib/custody/paths";
import { listUnaffiliated, type UnaffiliatedItem } from "@/lib/custody/takeover";
import { canResetDemo, OFFICE_RESET_PATH, officeResetHref, parseResetState, type ResetState } from "@/lib/seed/http";
import { RESET_LABELS } from "@/lib/seed/labels";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    confirm?: string | string[];
    error?: string | string[];
    people_error?: string | string[];
    reset?: string | string[];
  }>;
};

// 事業所の設定（docs/SPEC.md「画面 7 事業所の設定」）。1 画面に 災害モード・担当の割当・様式 9 への入口・ケアマネ・事業所の経過。
// - 災害モードの切替（大雨・地震・平時に戻す）と災害の情報の入力（T09）。ケアマネの役（管理者でなくても）が押せる。
//   切替と情報は人が入れる（気象庁の情報からの自動の切替は作っていない）。言葉は事業所の状態で、警報の言葉は使わない
// - 担当の割当・一覧から外す（T30）。ケアマネの役（管理者でなくても）。ケアマネ追加は管理者だけ（初期パスワードは画面に 1 回だけ）
// 行政・医療班・本人・家族はそれぞれの入口へ送る
export default async function OfficePage({ searchParams }: Props) {
  const principal = await requirePage("caseload");
  const scope = disasterScope(principal);
  const actor = officeActor(principal);
  if (!scope || !actor || !principal.office) return <Message title="事業所なし" />;
  const q = await searchParams;
  const now = new Date().toISOString();
  const today = todayJst();

  let state: DisasterState;
  let log: OfficeLogItem[];
  let towns: TownCount[];
  let careManagers: CareManagerItem[];
  let officePeople: OfficePersonItem[];
  let unaffiliated: UnaffiliatedItem[];
  let counts: ReturnType<typeof colorCounts> | null = null;
  let people = 0;
  try {
    const { env } = await getCloudflareContext({ async: true });
    [state, log, towns, careManagers, officePeople, unaffiliated] = await Promise.all([
      loadDisasterState(env.DB, scope.officeId),
      loadOfficeLog(env.DB, scope.officeId),
      loadOfficeTowns(env.DB, scope.officeId),
      listCareManagers(env.DB, scope.officeId),
      listOfficePeople(env.DB, scope.officeId, today),
      listUnaffiliated(env.DB, today),
    ]);
    const f9 = form9Scope(principal);
    const situation = toSituation(state, now);
    if (f9) {
      const form9 = await loadForm9(env.DB, f9, { today, situation });
      people = form9?.sheet.rows.length ?? 0;
      counts = situation && form9 ? colorCounts(form9.sheet.rows) : null;
    }
  } catch (e) {
    console.error("事業所の画面を読めない", e);
    return <Message title="読込失敗" />;
  }

  const disaster = isDisaster(state);
  const confirm = disaster && parseConfirm(q.confirm);
  const error = parseFormError(q.error);
  const peopleError = parsePeopleError(q.people_error);

  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <h1 className="text-2xl font-bold">{DISASTER_LABELS.page}</h1>
        <span className="text-sm">{principal.office.name}</span>
        <DisasterBadge mark={disasterMark(state, now)} link={false} />
        <span className="text-xs text-muted">{shortJst(now)} 時点</span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-bold text-danger">
          {DISASTER_FORM_ERROR_LABELS[error]}
        </p>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-3">
          <ModeSection state={state} now={now} confirm={confirm} />
          {disaster && <InfoSection state={state} towns={towns} />}
          {/* 所属なし（T23）は引き受ける人がいるときだけ。担当の長い表の前に置く */}
          <UnaffiliatedSection people={unaffiliated} />
          <AssignSection people={officePeople} careManagers={careManagers} error={peopleError} />
        </div>
        <div className="grid min-w-0 content-start gap-3">
          <Form9Section people={people} counts={counts} />
          <CareManagerSection careManagers={careManagers} admin={actor.admin} />
          {/* デモ事業所の「最初に戻す」（T26）。審査員と管理者だけ */}
          {canResetDemo(principal) && <ResetSection state={parseResetState(q.reset)} />}
          <LogSection log={log} />
        </div>
      </div>
    </main>
  );
}

const SECTION = "rounded-lg bg-panel p-3";
const BUTTON = "rounded-md px-4 py-2 text-sm font-bold";

/** 災害モードの切替。今の状態は枠と太字（下地は敷かない）。大雨・地震はすぐ切り替え、平時に戻すは確認の欄を通す */
function ModeSection({ state, now, confirm }: { state: DisasterState; now: string; confirm: boolean }) {
  const disaster = isDisaster(state);
  return (
    <section aria-labelledby="mode-title" className={SECTION}>
      <h2 id="mode-title" className="font-bold">
        {DISASTER_LABELS.mode}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {DISASTER_KINDS.map((k) => (
          <ModeButton key={k} kind={k} state={state} />
        ))}
      </div>
      {confirm && (
        <form
          method="post"
          action={OFFICE_MODE_PATH}
          className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-panel2 px-3 py-2"
        >
          <input type="hidden" name="kind" value="normal" />
          <input type="hidden" name="confirm" value="1" />
          <input type="hidden" name="version" value={state.version} />
          <span className="text-sm">停電・警戒レベル・断水・道路は消去</span>
          <button type="submit" className={`${BUTTON} bg-danger text-on-accent`} data-press="overlay">
            {DISASTER_LABELS.backToNormal}
          </button>
          <Link href={OFFICE_PATH} className="rounded px-3 py-1.5 text-sm" data-press>
            {DISASTER_LABELS.cancel}
          </Link>
        </form>
      )}
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">状態</dt>
        <dd className={disaster ? `font-bold ${TONE_TEXT.check}` : ""}>{DISASTER_KIND_LABELS[state.kind]}</dd>
        {disaster && state.startedAt && (
          <>
            <dt className="text-muted">{DISASTER_LABELS.startedAt}</dt>
            <dd className="tabular-nums">
              {shortJst(state.startedAt)}
              <span className="text-muted"> 経過 {elapsedText(state.startedAt, now) ?? "—"}</span>
            </dd>
            <dt className="text-muted">{DISASTER_LABELS.startedBy}</dt>
            <dd>{state.startedByName ?? "—"}</dd>
          </>
        )}
        {state.updatedAt && (
          <>
            <dt className="text-muted">更新</dt>
            <dd className="tabular-nums">
              {state.updatedByName ?? "—"} {shortJst(state.updatedAt)}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}

function ModeButton({ kind, state }: { kind: DisasterKind; state: DisasterState }) {
  const label = DISASTER_KIND_LABELS[kind];
  if (kind === state.kind) {
    return (
      <span aria-current="true" className={`${BUTTON} ring-2 ring-inset ring-accent`}>
        {label}
      </span>
    );
  }
  // 平時に戻すは確認の欄を開くだけ（URL の confirm）
  if (kind === "normal") {
    return (
      <Link href={officeHref({ confirm: true })} className={`${BUTTON} bg-panel2`} data-press>
        {label}
      </Link>
    );
  }
  return (
    <form method="post" action={OFFICE_MODE_PATH}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="version" value={state.version} />
      <button type="submit" className={`${BUTTON} bg-accent text-on-accent`} data-press="overlay">
        {label}
      </button>
    </form>
  );
}

const INPUT = "rounded-md bg-panel2 px-2 py-1.5 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent";
const CHOICE = "flex items-center gap-1.5 rounded-md bg-panel2 px-2 py-1 text-sm";

/** 災害の情報。発災・停電（範囲・開始・地区）・警戒レベル・断水・道路。保存で変わった所が経過に残る */
function InfoSection({ state, towns }: { state: DisasterState; towns: TownCount[] }) {
  const info = infoOf(state);
  if (!info) return null;
  const inArea = (t: string | null) => info.outage.scope === "area" && t !== null && info.outage.towns.includes(t);
  const outageCount =
    info.outage.scope === "none"
      ? 0
      : towns.filter((t) => info.outage.scope === "office" || inOutageArea(info.outage.towns, t.town)).reduce((n, t) => n + t.count, 0);
  const noTown = towns.find((t) => t.town === null);
  return (
    <form method="post" action={OFFICE_INFO_PATH} aria-labelledby="info-title" className={SECTION}>
      <input type="hidden" name="version" value={state.version} />
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="info-title" className="font-bold">
          {DISASTER_LABELS.info}
        </h2>
        {info.outage.scope !== "none" && (
          <span className="text-sm">
            <span className="text-muted">{DISASTER_LABELS.inOutage}</span>{" "}
            <span className={`font-bold tabular-nums ${TONE_TEXT.check}`}>{outageCount}</span> 人
          </span>
        )}
      </div>

      <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-muted">{DISASTER_LABELS.startedAt}</span>
          <input type="datetime-local" name="started" required defaultValue={toLocalInput(info.startedAt)} className={`${INPUT} tabular-nums`} />
        </label>

        <fieldset className="text-sm">
          <legend className="text-muted">{DISASTER_LABELS.level}</legend>
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            <label className={CHOICE}>
              <input type="radio" name="level" value="" defaultChecked={info.alertLevel === null} className="accent-accent" />
              {DISASTER_LABELS.levelNone}
            </label>
            {ALERT_LEVELS.map((l) => (
              <label key={l} className={`${CHOICE} tabular-nums`}>
                <input type="radio" name="level" value={l} defaultChecked={info.alertLevel === l} className="accent-accent" />
                {l}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="text-sm sm:col-span-2">
          <legend className="text-muted">{DISASTER_LABELS.outage}</legend>
          <div className="mt-0.5 flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="flex flex-wrap gap-1.5">
              {OUTAGE_SCOPES.map((s) => (
                <label key={s} className={CHOICE}>
                  <input type="radio" name="outage" value={s} defaultChecked={info.outage.scope === s} className="accent-accent" />
                  {OUTAGE_SCOPE_LABELS[s]}
                </label>
              ))}
            </div>
            <label className="flex flex-col gap-0.5">
              <span className="text-muted">{DISASTER_LABELS.outageAt}</span>
              <input
                type="datetime-local"
                name="outage_at"
                defaultValue={toLocalInput(info.outage.startedAt)}
                className={`${INPUT} tabular-nums`}
              />
            </label>
          </div>
          <div className="mt-2">
            <span className="text-muted">{DISASTER_LABELS.towns}</span>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {towns
                .filter((t): t is TownCount & { town: string } => t.town !== null)
                .map((t) => (
                  <label key={t.town} className={CHOICE}>
                    <input type="checkbox" name="town" value={t.town} defaultChecked={inArea(t.town)} className="accent-accent" />
                    {t.town}
                    <span className="text-xs text-muted tabular-nums">{t.count}</span>
                  </label>
                ))}
              {noTown && (
                <span className="self-center text-xs text-muted">
                  {DISASTER_LABELS.noTown} {noTown.count}（停電に含む）
                </span>
              )}
            </div>
          </div>
        </fieldset>

        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-muted">{DISASTER_LABELS.water}</span>
          <input type="text" name="water" maxLength={MAX_TEXT_LENGTH} defaultValue={info.water ?? ""} className={INPUT} />
        </label>
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="text-muted">{DISASTER_LABELS.road}</span>
          <input type="text" name="road" maxLength={MAX_TEXT_LENGTH} defaultValue={info.road ?? ""} className={INPUT} />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button type="submit" className={`${BUTTON} bg-accent text-on-accent`} data-press="overlay">
          {DISASTER_LABELS.save}
        </button>
      </div>
    </form>
  );
}

/** 様式 9 への入口。災害モードは色ごとの人数（ルールの表）、平時は並びの言い方 */
function Form9Section({ people, counts }: { people: number; counts: ReturnType<typeof colorCounts> | null }) {
  return (
    <section aria-labelledby="form9-title" className={SECTION}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="form9-title" className="font-bold">
          様式9
        </h2>
        <span className="text-sm">
          <span className="font-bold tabular-nums">{people}</span> 人
        </span>
      </div>
      {counts ? (
        <ColorCounts counts={counts} className="mt-1" />
      ) : (
        <p className="mt-1 text-xs text-muted">並び {NORMAL_ORDER_LABELS.join(" → ")}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href={FORM9_PATH} className={`${BUTTON} bg-panel2`} data-press>
          表示
        </Link>
        <a href={FORM9_CSV_PATH} download className={`${BUTTON} bg-panel2`} data-press>
          CSV出力
        </a>
      </div>
    </section>
  );
}

const LOG_TONE: Record<OfficeLogItem["kind"], string> = {
  disaster_on: `font-bold ${TONE_TEXT.check}`,
  disaster_off: "font-bold",
  disaster_info: "font-bold",
  person_added: "font-bold",
  person_assigned: "font-bold",
  person_unlisted: "font-bold",
  person_relisted: "font-bold",
  care_manager_added: "font-bold",
  person_taken: "font-bold",
};

const CELL = "bg-panel2 px-2 py-1.5 align-middle first:rounded-l last:rounded-r";
/** 行（面の中の灰色）の上の選ぶ欄。地は白 */
const SELECT_IN =
  "min-w-0 rounded-md bg-panel px-2 py-1 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent";

/**
 * 担当の割当（T30）。事業所の利用者を全部（カナの順）、行ごとに担当を選んで「変更」、「外す」で一覧から外す（消さない）。
 * 外した人は表の下の畳み「外した人 N」から戻す。表は区分の中で送る（max-h）
 */
function AssignSection({
  people,
  careManagers,
  error,
}: {
  people: OfficePersonItem[];
  careManagers: CareManagerItem[];
  error: PeopleActionError | null;
}) {
  const listed = people.filter((p) => p.unlistedAt === null);
  const unlisted = people.filter((p): p is OfficePersonItem & { unlistedAt: string } => p.unlistedAt !== null);
  const nameOf = new Map(careManagers.map((c) => [c.id, c.name]));
  return (
    <section id={ASSIGN_ANCHOR} aria-labelledby="assign-title" className={`${SECTION} scroll-mt-4`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="assign-title" className="font-bold">
          {OFFICE_LABELS.assignments}
        </h2>
        <span className="text-sm">
          <span className="font-bold tabular-nums">{listed.length}</span> {OFFICE_LABELS.people}
        </span>
        <Link href={NEW_PERSON_PATH} className={`${BUTTON} ml-auto self-center bg-panel2`} data-press>
          {OFFICE_LABELS.addPerson}
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm font-bold text-danger">
          {OFFICE_ERROR_LABELS[error]}
        </p>
      )}
      {listed.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{OFFICE_LABELS.none}</p>
      ) : (
        <div className="mt-2 max-h-[55dvh] overflow-auto">
          <table className="w-full min-w-[36rem] border-separate border-spacing-y-0.5 text-left text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="whitespace-nowrap text-xs text-muted">
                <th className="px-2 py-1 font-normal">{OFFICE_LABELS.name}</th>
                <th className="px-2 py-1 font-normal">{OFFICE_LABELS.age}</th>
                <th className="px-2 py-1 font-normal">{OFFICE_LABELS.plan}</th>
                <th className="px-2 py-1 font-normal">{OFFICE_LABELS.careManager}</th>
                <th className="px-2 py-1 font-normal">
                  <span className="sr-only">{OFFICE_LABELS.unlist}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.map((p) => (
                <tr key={p.id}>
                  <td className={CELL}>
                    <Link href={`/people/${encodeURIComponent(p.id)}`} className="-mx-1 rounded px-1 font-bold" data-press>
                      {p.name}
                    </Link>
                    <span className="ml-2 text-xs text-muted">{p.kana}</span>
                  </td>
                  <td className={`${CELL} whitespace-nowrap tabular-nums`}>{p.age ?? "—"}</td>
                  <td className={`${CELL} whitespace-nowrap`}>
                    <StateTag tone={PLAN_TONES[p.plan]}>{PLAN_STATUS_LABELS[p.plan]}</StateTag>
                  </td>
                  <td className={CELL}>
                    <form method="post" action={OFFICE_PEOPLE_PATH} className="flex items-center gap-1.5">
                      <input type="hidden" name="action" value="assign" />
                      <input type="hidden" name="person" value={p.id} />
                      <input type="hidden" name="from" value={p.careManagerId ?? ""} />
                      <input type="hidden" name="back" value="office" />
                      <select
                        name="to"
                        defaultValue={p.careManagerId ?? ""}
                        aria-label={`${p.name} ${OFFICE_LABELS.careManager}`}
                        className={SELECT_IN}
                      >
                        {p.careManagerId === null || !nameOf.has(p.careManagerId) ? (
                          <option value="" disabled>
                            {OFFICE_LABELS.unassigned}
                          </option>
                        ) : null}
                        {careManagers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="rounded-md bg-panel px-2.5 py-1 text-sm font-bold" data-press>
                        {OFFICE_LABELS.assign}
                      </button>
                    </form>
                  </td>
                  <td className={`${CELL} text-right`}>
                    <form method="post" action={OFFICE_PEOPLE_PATH}>
                      <input type="hidden" name="action" value="unlist" />
                      <input type="hidden" name="person" value={p.id} />
                      <input type="hidden" name="back" value="office" />
                      <button type="submit" className="rounded-md px-2.5 py-1 text-sm text-muted" data-press>
                        {OFFICE_LABELS.unlist}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <UnlistedFold count={unlisted.length} inPanel>
        <UnlistedRows
          inPanel
          rows={unlisted.map((p) => ({
            id: p.id,
            name: p.name,
            kana: p.kana,
            unlistedAt: p.unlistedAt,
            href: `/people/${encodeURIComponent(p.id)}`,
          }))}
          back="office"
        />
      </UnlistedFold>
    </section>
  );
}

/** ケアマネ（T30）。足した順に名前・管理者の印・ID・担当の人数。管理者だけ「ケアマネ追加」（初期パスワードは画面に 1 回だけ） */
function CareManagerSection({ careManagers, admin }: { careManagers: CareManagerItem[]; admin: boolean }) {
  return (
    <section aria-labelledby="cm-title" className={SECTION}>
      <h2 id="cm-title" className="flex items-baseline gap-2 font-bold">
        {OFFICE_LABELS.careManagers}
        <span className="text-sm font-normal text-muted tabular-nums">{careManagers.length}</span>
      </h2>
      <ul className="mt-2 space-y-0.5 text-sm">
        {careManagers.map((c) => (
          <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 rounded bg-panel2 px-2 py-1.5">
            <span className="font-bold">{c.name}</span>
            {c.admin && <span className="text-xs text-muted">{OFFICE_LABELS.admin}</span>}
            {c.loginId && (
              <span className="text-xs text-muted">
                {OFFICE_LABELS.loginId} {c.loginId}
              </span>
            )}
            <span className="ml-auto tabular-nums">
              {c.people}
              <span className="text-xs text-muted"> {OFFICE_LABELS.people}</span>
            </span>
          </li>
        ))}
      </ul>
      {admin && <AddCareManager />}
    </section>
  );
}

/** 事業所の経過。新しい順。誰が・いつ・何を */
function LogSection({ log }: { log: OfficeLogItem[] }) {
  return (
    <section aria-labelledby="log-title" className={SECTION}>
      <h2 id="log-title" className="flex items-baseline gap-2 font-bold">
        {DISASTER_LABELS.log}
        <span className="text-sm font-normal text-muted tabular-nums">{log.length}</span>
      </h2>
      {log.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{DISASTER_LABELS.none}</p>
      ) : (
        <ol className="mt-2 max-h-[60dvh] space-y-0.5 overflow-y-auto text-sm">
          {log.map((e) => (
            <li key={e.id} className="rounded bg-panel2 px-2 py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={LOG_TONE[e.kind]}>{e.label}</span>
                {e.person && <span>{e.person}</span>}
                {e.body && <span className="min-w-0 break-words">{e.body}</span>}
              </div>
              <div className="text-xs text-muted tabular-nums">
                {e.who} {e.when}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * 所属なし（T23）。医療班・行政がその場で登録した人（台帳に無かった人）。カナ・年齢・避難所・登録の時刻だけを出し、
 * 「引受」で自分の事業所・自分の担当に移す（引き受ける前は本人のページを開けない）。0 人なら区分を出さない
 */
function UnaffiliatedSection({ people }: { people: UnaffiliatedItem[] }) {
  if (people.length === 0) return null;
  return (
    <section id={UNAFFILIATED_ANCHOR} aria-labelledby="unaffiliated-title" className={`${SECTION} scroll-mt-4`}>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="unaffiliated-title" className="font-bold">
          {CUSTODY_LABELS.unaffiliated}
        </h2>
        <span className="text-sm">
          <span className="font-bold tabular-nums">{people.length}</span> {OFFICE_LABELS.people}
        </span>
      </div>
      <div className="mt-2 max-h-[40dvh] overflow-y-auto">
        <table className="w-full border-separate border-spacing-y-0.5 text-sm" data-table="unaffiliated">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="px-2 font-normal">{CUSTODY_LABELS.kana}</th>
              <th className="px-2 font-normal">{CUSTODY_LABELS.age}</th>
              <th className="px-2 font-normal">{CUSTODY_LABELS.shelter}</th>
              <th className="px-2 font-normal">{CUSTODY_LABELS.registeredAt}</th>
              <th className="px-2" />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} data-unaffiliated={p.id}>
                <td className={`${CELL} font-bold`}>{p.kana}</td>
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>
                  {p.age ?? "—"}
                  {p.ageReported && <span className="ml-1 text-xs text-muted">{CUSTODY_LABELS.reportedAge}</span>}
                </td>
                <td className={CELL}>{p.shelters.join("・") || "—"}</td>
                <td className={`${CELL} whitespace-nowrap tabular-nums`}>{p.createdWhen}</td>
                <td className={`${CELL} text-right`}>
                  <form method="post" action={OFFICE_TAKE_PATH}>
                    <input type="hidden" name="person" value={p.id} />
                    <button type="submit" className="rounded-md bg-accent px-3 py-1 text-sm font-bold text-on-accent" data-press="overlay">
                      {CUSTODY_LABELS.take}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * デモ事業所の「最初に戻す」（T26）。審査員（ケアマネの役）と管理者だけに出す。押すと確認の欄（URL の reset=confirm）を開き、
 * 確認の欄の赤いボタンで種に戻す。毎日 4:00 にも自動で戻る。経過には残さない
 */
function ResetSection({ state }: { state: ResetState | null }) {
  return (
    <section aria-labelledby="reset-title" className={SECTION} data-reset>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="reset-title" className="font-bold">
          {RESET_LABELS.title}
        </h2>
        <span className="text-xs text-muted tabular-nums">{RESET_LABELS.daily}</span>
        {state === "done" && (
          <span role="status" className="text-sm font-bold">
            {RESET_LABELS.done}
          </span>
        )}
        {state === "failed" && (
          <span role="alert" className="text-sm font-bold text-danger">
            {RESET_LABELS.failed}
          </span>
        )}
      </div>
      {state === "confirm" ? (
        <form method="post" action={OFFICE_RESET_PATH} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-panel2 px-3 py-2">
          <input type="hidden" name="confirm" value="1" />
          <span className="text-sm">{RESET_LABELS.confirm}</span>
          <button type="submit" className={`${BUTTON} bg-danger text-on-accent`} data-press="overlay">
            {RESET_LABELS.reset}
          </button>
          <Link href={OFFICE_PATH} className="rounded px-3 py-1.5 text-sm" data-press>
            {RESET_LABELS.cancel}
          </Link>
        </form>
      ) : (
        <div className="mt-2">
          <Link href={officeResetHref("confirm")} className={`${BUTTON} inline-block bg-panel2 text-danger`} data-press>
            {RESET_LABELS.reset}
          </Link>
        </div>
      )}
    </section>
  );
}

function Message({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <section className="rounded-lg bg-panel p-6">
        <h1 className="text-xl font-bold">{title}</h1>
      </section>
    </main>
  );
}
