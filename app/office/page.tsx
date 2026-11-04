import { getCloudflareContext } from "@opennextjs/cloudflare";
import Link from "next/link";
import { ColorCounts } from "@/components/disaster/ColorCounts";
import { DisasterBadge } from "@/components/disaster/DisasterBadge";
import { AddCareManager } from "@/components/office/AddCareManager";
import { AssignForm } from "@/components/office/AssignForm";
import { AssignMany, PickAll, PickBox } from "@/components/office/AssignMany";
import { AssignRow } from "@/components/office/AssignRow";
import { CareManagerRow } from "@/components/office/CareManagerRow";
import { FormChoice } from "@/components/office/FormChoice";
import { MoreFold } from "@/components/office/MoreFold";
import { JmaAlerts } from "@/components/office/JmaAlerts";
import { OfficePlace } from "@/components/office/OfficePlace";
import { SetupPanel } from "@/components/office/SetupPanel";
import { UnlistedFold } from "@/components/office/UnlistedFold";
import { UnlistedRows } from "@/components/office/UnlistedRows";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { AddPersonIcon, CloseIcon, DownloadIcon, PaperIcon } from "@/components/ui/Icon";
import { LinkPending } from "@/components/ui/LinkPending";
import { Page, PageHead, Panel, PanelHead } from "@/components/ui/Panel";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { CHOICE_INPUT, CHOICE_LABEL } from "@/components/ui/choice";
import { TABLE, TABLE_BOX, TD, TH } from "@/components/ui/table";
import { StateTag, StateText, TONE_TEXT } from "@/components/ui/Tag";
import { todayJst } from "@/lib/age";
import { requirePage } from "@/lib/auth/server";
import { PLAN_TONES } from "@/lib/caseload";
import { ALERT_LEVELS, DISASTER_KINDS, OUTAGE_SCOPES, type DisasterKind, type GeoPoint } from "@/lib/db/types";
import { loadDisasterState, loadOfficeLog, loadOfficeTowns, type OfficeLogItem, type TownCount } from "@/lib/disaster/db";
import { OFFICE_INFO_PATH, OFFICE_MODE_PATH, OFFICE_PATH, parseConfirm, parseFormError } from "@/lib/disaster/http";
import { disasterScope } from "@/lib/disaster/scope";
import {
  DISASTER_FORM_ERROR_LABELS,
  DISASTER_KIND_LABELS,
  DISASTER_LABELS,
  disasterMark,
  hasAlertLevel,
  elapsedText,
  inOutageArea,
  infoOf,
  isDisaster,
  MAX_TEXT_LENGTH,
  modeConfirm,
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
import { parseAssignedMany, parsePeopleError } from "@/lib/office/http";
import { ASSIGN_ANCHOR, CARE_MANAGERS_ANCHOR, NEW_PERSON_PATH, OFFICE_PEOPLE_PATH } from "@/lib/office/http-paths";
import { assignManyText, OFFICE_ERROR_LABELS, OFFICE_LABELS, type PeopleActionError } from "@/lib/office/labels";
import { activeCareManagers, listCareManagers, listOfficePeople, type CareManagerItem, type OfficePersonItem } from "@/lib/office/people";
import { officeActor } from "@/lib/office/scope";
import { canSeeSetup, isSetupLater, loadOfficeCenter, SETUP_LATER_COOKIE, setupItems, setupLaterCookie, type SetupItem } from "@/lib/office/setup";
import { CUSTODY_LABELS } from "@/lib/custody/labels";
import { OFFICE_TAKE_PATH, UNAFFILIATED_ANCHOR } from "@/lib/custody/paths";
import { listUnaffiliated, type UnaffiliatedItem } from "@/lib/custody/takeover";
import { canResetDemo, OFFICE_RESET_PATH, parseResetState, type ResetState } from "@/lib/seed/http";
import { RESET_LABELS } from "@/lib/seed/labels";
import { CONFIRM_LABELS } from "@/lib/ui/labels";
import { SurveyPanel } from "@/components/office/SurveyPanel";
import { loadSurveyOverview, type SurveyOverview } from "@/lib/survey/store";
import { cookies, headers } from "next/headers";

// D1 を毎回読む
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    confirm?: string | string[];
    error?: string | string[];
    people_error?: string | string[];
    reset?: string | string[];
    form_error?: string | string[];
    moved?: string | string[];
    skipped?: string | string[];
  }>;
};

// 事業所の設定（docs/SPEC.md「画面 7 事業所の設定」）。1 画面に 災害モード・担当の割当・様式 9 への入口・ケアマネ・事業所の経過。
// - 災害モードの切替（大雨・台風・土砂・地震・津波・その他・平時に戻す。T60）と災害の情報の入力（T09）。ケアマネの役（管理者でなくても）が押せる。
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
  let survey: SurveyOverview;
  let counts: ReturnType<typeof colorCounts> | null = null;
  let people = 0;
  // 準備の欄（T98）。管理者だけ（審査員のケアマネの役は管理者でないので出ない）
  let setup: SetupItem[] = [];
  try {
    const { env } = await getCloudflareContext({ async: true });
    let center: GeoPoint | null;
    [state, log, towns, careManagers, officePeople, unaffiliated, survey, center] = await Promise.all([
      loadDisasterState(env.DB, scope.officeId),
      loadOfficeLog(env.DB, scope.officeId),
      loadOfficeTowns(env.DB, scope.officeId),
      listCareManagers(env.DB, scope.officeId),
      listOfficePeople(env.DB, scope.officeId, today),
      // 所属なしの人。審査員の壁の中はデモのアカウントが登録した人だけ、外はそれ以外（T81）
      listUnaffiliated(env.DB, actor, today),
      // アンケート（T42）。審査員（と審査員が足したアカウント）は審査員が作った物だけ、本物は作った本人と壁の外の管理者だけ（T81）
      loadSurveyOverview(env.DB, actor.officeId, { walled: actor.walled === true, admin: principal.admin, accountId: principal.accountId }, now),
      // 準備の欄の地域（事業所の中心）。管理者のときだけ読む
      canSeeSetup(principal) ? loadOfficeCenter(env.DB, scope.officeId) : Promise.resolve(null),
    ]);
    if (canSeeSetup(principal)) {
      setup = setupItems({
        center,
        careManagers,
        people: officePeople,
        careManagerLater: isSetupLater((await cookies()).get(SETUP_LATER_COOKIE)?.value, scope.officeId),
      });
    }
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
  const moved = parseAssignedMany(q);
  const reset = canResetDemo(principal) ? parseResetState(q.reset) : null;


  return (
    <Page width="full" className="max-w-6xl">
      <PageHead
        title={DISASTER_LABELS.page}
        sub={
          <>
            <span className="text-sm text-muted">{principal.office.name}</span>
            <DisasterBadge mark={disasterMark(state, now)} link={false} />
            <span className="text-xs text-muted">{shortJst(now)} 時点</span>
          </>
        }
      />
      {error && (
        <p role="alert" className="mt-2 text-sm font-bold text-danger">
          {DISASTER_FORM_ERROR_LABELS[error]}
        </p>
      )}
      {/* 最初に戻すのあとの知らせ（T79）。戻すと画面の頭に来るので、右下の「初期化」の区分でなくここに出す */}
      {reset === "done" && (
        <p role="status" className="mt-2 text-sm" data-reset-notice="done">
          <StateText tone="ok">{RESET_LABELS.done}</StateText>
        </p>
      )}
      {reset === "failed" && (
        <p role="alert" className="mt-2 text-sm font-bold text-danger" data-reset-notice="failed">
          {RESET_LABELS.failed}
        </p>
      )}
      {/* 準備の欄（T98）。管理者だけ、残っている物だけ。全部済めば出さない */}
      <SetupPanel items={setup} laterCookie={setupLaterCookie(scope.officeId)} className="mt-3" />

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-3">
          <ModeSection state={state} now={now} confirm={confirm} officeId={scope.officeId} />
          <OfficePlace officeId={scope.officeId} admin={actor.placeEdit} error={q.form_error === "place"} />
          {disaster && <InfoSection state={state} towns={towns} />}
          {/* 所属なし（T23）は引き受ける人がいるときだけ。担当の長い表の前に置く */}
          <UnaffiliatedSection people={unaffiliated} />
          <AssignSection people={officePeople} careManagers={careManagers} error={peopleError} moved={moved} />
          {/* ケアマネ向けアンケートの招待のリンクと答え（T42） */}
          <SurveyPanel overview={survey} origin={await requestOrigin()} />
        </div>
        <div className="grid min-w-0 content-start gap-3">
          <Form9Section people={people} counts={counts} />
          <FormChoice officeId={scope.officeId} error={q.form_error === "bad"} />
          <Panel id={CARE_MANAGERS_ANCHOR} aria-labelledby="cm-title" className="scroll-mt-4">
            <AddCareManager count={careManagers.length} admin={actor.admin}>
              {/* 審査員のケアマネの役の書き手（acct-judge）はケアマネの一覧にいない。試用事業所（T115）では管理者の行が自分 */}
              <CareManagerList
                careManagers={careManagers}
                selfId={principal.judge && !principal.sandbox ? null : principal.accountId}
                ownPassword={!principal.judge}
                manage={actor.admin}
                walled={actor.walled === true}
              />
            </AddCareManager>
          </Panel>
          {/* デモ事業所の「最初に戻す」（T26）。審査員と管理者だけ */}
          {canResetDemo(principal) && <ResetSection state={reset} />}
          <LogSection log={log} />
        </div>
      </div>
    </Page>
  );
}

/** 今の要求の origin（アンケートのリンクの URL を作る。手元の dev と配信で同じに動く） */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** 切替のボタンの段（気象庁の欄の「切替」が送る所） */
const MODE_BUTTONS_ID = "mode-buttons";

/** 災害モードの切替。今の状態は枠と太字（下地は敷かない）、ほかは無色。災害の種類はすぐ切り替え、平時に戻すは確認の欄を通す */
function ModeSection({ state, now, confirm, officeId }: { state: DisasterState; now: string; confirm: boolean; officeId: string }) {
  const disaster = isDisaster(state);
  return (
    <Panel aria-labelledby="mode-title">
      <PanelHead id="mode-title" title={DISASTER_LABELS.mode} />
      {/* 気象庁の警報・注意報と地震（T72）。切替は勧めるだけで、押すのは人 */}
      <JmaAlerts officeId={officeId} disaster={disaster} now={now} switchHref={`#${MODE_BUTTONS_ID}`} />
      <div id={MODE_BUTTONS_ID} className="mt-2 flex scroll-mt-20 flex-wrap items-center gap-1.5">
        {DISASTER_KINDS.map((k) => (
          <ModeButton key={k} kind={k} state={state} />
        ))}
      </div>
      {confirm && (
        <form method="post" action={OFFICE_MODE_PATH} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-panel2 px-3 py-2">
          <input type="hidden" name="kind" value="normal" />
          <input type="hidden" name="confirm" value="1" />
          <input type="hidden" name="version" value={state.version} />
          <span className="text-sm">{DISASTER_LABELS.clearOnNormal}</span>
          <SubmitButton kind="dangerFill" icon="RestoreIcon">{DISASTER_LABELS.backToNormal}</SubmitButton>
          <ButtonLink href={OFFICE_PATH} kind="quiet" icon={CloseIcon}>
            {DISASTER_LABELS.cancel}
          </ButtonLink>
        </form>
      )}
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">状態</dt>
        <dd>
          {disaster ? (
            <StateTag tone="check">{DISASTER_KIND_LABELS[state.kind]}</StateTag>
          ) : (
            DISASTER_KIND_LABELS[state.kind]
          )}
        </dd>
        {disaster && state.startedAt && (
          <>
            <dt className="text-muted">{DISASTER_LABELS.startedAt}</dt>
            <dd>
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
            <dd>
              {state.updatedByName ?? "—"} {shortJst(state.updatedAt)}
            </dd>
          </>
        )}
      </dl>
    </Panel>
  );
}

function ModeButton({ kind, state }: { kind: DisasterKind; state: DisasterState }) {
  const label = DISASTER_KIND_LABELS[kind];
  if (kind === state.kind) {
    return (
      <span aria-current="true" className={buttonClass("quiet", "md", "outline-2 -outline-offset-2 outline-accent")}>
        {label}
      </span>
    );
  }
  // 平時に戻すと、平時から災害モードへは、アプリ内の確認の窓で決めてから送る（T44・T79）。
  // 平時に戻すは窓が出せないとき（JS が動く前）サーバーが確認の欄（URL の confirm）へ戻す。災害の種類どうしは窓なし
  const c = modeConfirm(state, kind);
  const confirm =
    c?.step === "to_normal"
      ? {
          title: CONFIRM_LABELS.normalTitle,
          message: c.message,
          details: c.details,
          ok: CONFIRM_LABELS.normalOk,
          icon: "RestoreIcon" as const,
          danger: true,
          fields: { confirm: "1" },
        }
      : c?.step === "to_disaster"
        ? { title: CONFIRM_LABELS.disasterTitle, message: c.message, details: c.details, ok: CONFIRM_LABELS.disasterOk }
        : undefined;
  return (
    <form method="post" action={OFFICE_MODE_PATH}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="version" value={state.version} />
      <SubmitButton confirm={confirm}>{label}</SubmitButton>
    </form>
  );
}

const INPUT = "h-8 rounded bg-panel2 px-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";
const CHOICE = CHOICE_LABEL;

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
    <Panel aria-labelledby="info-title">
      <form method="post" action={OFFICE_INFO_PATH}>
        <input type="hidden" name="version" value={state.version} />
        <PanelHead
          id="info-title"
          title={DISASTER_LABELS.info}
          sub={
            info.outage.scope !== "none" && (
              <span className="text-sm">
                <span className="text-muted">{DISASTER_LABELS.inOutage}</span>{" "}
                <span className={`font-bold ${TONE_TEXT.check}`}>{outageCount}</span> 人
              </span>
            )
          }
        />

        <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">{DISASTER_LABELS.startedAt}</span>
            <input type="datetime-local" name="started" required defaultValue={toLocalInput(info.startedAt)} className={INPUT} />
          </label>

          {/* 警戒レベルは大雨の場面の種類（大雨・台風・土砂）だけ。地震・津波・その他では出さない（docs/DECISIONS.md「地図と災害の情報」） */}
          {hasAlertLevel(state.kind) && (
          <fieldset>
            <legend className="text-xs text-muted">{DISASTER_LABELS.level}</legend>
            <div className="mt-0.5 flex flex-wrap gap-1">
              <label className={CHOICE}>
                <input type="radio" name="level" value="" defaultChecked={info.alertLevel === null} className={CHOICE_INPUT} />
                {DISASTER_LABELS.levelNone}
              </label>
              {ALERT_LEVELS.map((l) => (
                <label key={l} className={CHOICE}>
                  <input type="radio" name="level" value={l} defaultChecked={info.alertLevel === l} className={CHOICE_INPUT} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          )}

          <fieldset className="sm:col-span-2">
            <legend className="text-xs text-muted">{DISASTER_LABELS.outage}</legend>
            <div className="mt-0.5 flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="flex flex-wrap gap-1">
                {OUTAGE_SCOPES.map((s) => (
                  <label key={s} className={CHOICE}>
                    <input type="radio" name="outage" value={s} defaultChecked={info.outage.scope === s} className={CHOICE_INPUT} />
                    {OUTAGE_SCOPE_LABELS[s]}
                  </label>
                ))}
              </div>
              <label className="flex flex-col gap-0.5">
                <span className="text-xs text-muted">{DISASTER_LABELS.outageAt}</span>
                <input type="datetime-local" name="outage_at" defaultValue={toLocalInput(info.outage.startedAt)} className={INPUT} />
              </label>
            </div>
            <div className="mt-2">
              <span className="text-xs text-muted">{DISASTER_LABELS.towns}</span>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {towns
                  .filter((t): t is TownCount & { town: string } => t.town !== null)
                  .map((t) => (
                    <label key={t.town} className={CHOICE}>
                      <input type="checkbox" name="town" value={t.town} defaultChecked={inArea(t.town)} className={CHOICE_INPUT} />
                      {t.town}
                      <span className="text-xs text-muted">{t.count}</span>
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

          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">{DISASTER_LABELS.water}</span>
            <input type="text" name="water" maxLength={MAX_TEXT_LENGTH} defaultValue={info.water ?? ""} className={INPUT} />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-muted">{DISASTER_LABELS.road}</span>
            <input type="text" name="road" maxLength={MAX_TEXT_LENGTH} defaultValue={info.road ?? ""} className={INPUT} />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <SubmitButton kind="main" icon="SaveIcon">
            {DISASTER_LABELS.save}
          </SubmitButton>
        </div>
      </form>
    </Panel>
  );
}

/** 様式 9 への入口。災害モードは色ごとの人数（ルールの表）、平時は並びの言い方 */
function Form9Section({ people, counts }: { people: number; counts: ReturnType<typeof colorCounts> | null }) {
  return (
    <Panel aria-labelledby="form9-title">
      <PanelHead id="form9-title" title="様式9" count={`${people} 人`} />
      {counts ? (
        <ColorCounts counts={counts} className="mt-1" />
      ) : (
        <p className="mt-1 text-xs text-muted">並び {NORMAL_ORDER_LABELS.join(" → ")}</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ButtonLink href={FORM9_PATH} icon={PaperIcon}>
          表示
        </ButtonLink>
        <a href={FORM9_CSV_PATH} download className={buttonClass("plain", "md")} data-press>
          <DownloadIcon aria-hidden className="size-4 shrink-0" />
          CSV出力
        </a>
      </div>
    </Panel>
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
  care_manager_changed: "font-bold",
};

/**
 * 担当の割当（T30）。事業所の利用者を全部（カナの順）、行ごとに担当を選んで「変更」。行の右端の「詳細」で開いた行の中に
 * 登録・更新の時刻と「外す」（一覧から外す。消さない。一覧に赤を並べない）。
 * 外した人は表の下の畳み「外した人 N」から戻す。表は 1 つの面の中で、ページの流れのまま（区分の中で送らない）。
 * 一括変更（T60）: 各行の左のチェック・見出しの全選択・表の上の帯（担当ごとの選択・移動先・一括変更）。戻ったら「変更済 N 人・飛ばし M 人」
 */
function AssignSection({
  people,
  careManagers,
  error,
  moved,
}: {
  people: OfficePersonItem[];
  careManagers: CareManagerItem[];
  error: PeopleActionError | null;
  moved: { moved: number; skipped: number } | null;
}) {
  const listed = people.filter((p) => p.unlistedAt === null);
  const unlisted = people.filter((p): p is OfficePersonItem & { unlistedAt: string } => p.unlistedAt !== null);
  // 割当の候補は使える人だけ（停止した人は選べない。T61）
  const cms = activeCareManagers(careManagers).map((c) => ({ id: c.id, name: c.name }));
  // 停止した人が担当のまま一覧に戻った人（外した人を戻したとき）は、今の担当を選べない印つきで出す（未割当と読ませない）
  const stopped = new Map(careManagers.filter((c) => c.disabled).map((c) => [c.id, `${c.name} ${OFFICE_LABELS.disabled}`]));
  const rowCms = (current: string | null) => {
    const name = current === null ? undefined : stopped.get(current);
    return current !== null && name !== undefined ? [...cms, { id: current, name, disabled: true }] : cms;
  };
  return (
    <Panel id={ASSIGN_ANCHOR} aria-labelledby="assign-title" className="scroll-mt-4">
      <PanelHead
        id="assign-title"
        title={OFFICE_LABELS.assignments}
        count={`${listed.length} ${OFFICE_LABELS.people}`}
        sub={
          moved && (
            <span role="status" className="text-sm" data-assigned-many>
              <StateText tone="ok">{assignManyText(moved)}</StateText>
            </span>
          )
        }
        actions={
          <ButtonLink href={`${NEW_PERSON_PATH}?back=office`} kind="main" icon={AddPersonIcon}>
            {OFFICE_LABELS.addPerson}
          </ButtonLink>
        }
      />
      {error && (
        <p role="alert" className="mt-1 text-sm font-bold text-danger">
          {OFFICE_ERROR_LABELS[error]}
        </p>
      )}
      {listed.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{OFFICE_LABELS.none}</p>
      ) : (
        <AssignMany rows={listed.map((p) => ({ id: p.id, name: p.name, careManagerId: p.careManagerId }))} careManagers={cms}>
        <div className={`mt-1 ${TABLE_BOX}`}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={`${TH} w-8 pr-0`}>
                  <PickAll />
                </th>
                <th className={TH}>{OFFICE_LABELS.name}</th>
                {/* 640 未満は年齢と避難計画の列を省き、氏名の下の 1 行に出す（チェックの列を足しても 375 で氏名が 1 字ずつ折れないように。T60） */}
                <th className={`${TH} hidden sm:table-cell`}>{OFFICE_LABELS.age}</th>
                <th className={`${TH} hidden sm:table-cell`}>{OFFICE_LABELS.plan}</th>
                <th className={TH}>{OFFICE_LABELS.careManager}</th>
                <th className={TH}>
                  <span className="sr-only">{OFFICE_LABELS.detail}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.map((p) => (
                <AssignRow
                  key={p.id}
                  id={p.id}
                  cols={6}
                  label={p.name}
                  cellClass={`${TD} align-middle`}
                  cells={
                    <>
                      <td className={`${TD} w-8 pr-0 align-middle`}>
                        <PickBox id={p.id} label={p.name} />
                      </td>
                      <td className={`${TD} align-middle`}>
                        <Link href={`/people/${encodeURIComponent(p.id)}`} className="relative -mx-1 rounded px-1 font-bold" data-press>
                          {p.name}
                          <LinkPending />
                        </Link>
                        <span className="ml-1.5 text-xs text-muted">{p.kana}</span>
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs sm:hidden" data-narrow-line>
                          <span className="text-muted tabular-nums">
                            {OFFICE_LABELS.age} {p.age ?? "—"}
                          </span>
                          <StateText tone={PLAN_TONES[p.plan]}>{PLAN_STATUS_LABELS[p.plan]}</StateText>
                        </span>
                      </td>
                      <td className={`${TD} hidden align-middle whitespace-nowrap sm:table-cell`}>{p.age ?? "—"}</td>
                      <td className={`${TD} hidden align-middle whitespace-nowrap sm:table-cell`}>
                        <StateText tone={PLAN_TONES[p.plan]}>{PLAN_STATUS_LABELS[p.plan]}</StateText>
                      </td>
                      <td className={`${TD} align-middle`}>
                        <AssignForm personId={p.id} personName={p.name} careManagerId={p.careManagerId} careManagers={rowCms(p.careManagerId)} />
                      </td>
                    </>
                  }
                  detail={
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-1 text-sm">
                      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                        <div className="flex items-baseline gap-1.5">
                          <dt className="text-xs text-muted">{OFFICE_LABELS.createdAt}</dt>
                          <dd>{shortJst(p.createdAt)}</dd>
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <dt className="text-xs text-muted">{OFFICE_LABELS.updatedAt}</dt>
                          <dd>{shortJst(p.updatedAt)}</dd>
                        </div>
                      </dl>
                      {/* 一覧から外す（消さない）。外した人は表の下の「外した人」から戻す */}
                      <form method="post" action={OFFICE_PEOPLE_PATH} className="ml-auto">
                        <input type="hidden" name="action" value="unlist" />
                        <input type="hidden" name="person" value={p.id} />
                        <input type="hidden" name="back" value="office" />
                        <SubmitButton
                          kind="danger"
                          size="sm"
                          icon="UnlistIcon"
                          confirm={{ title: CONFIRM_LABELS.unlistTitle, message: p.name, ok: CONFIRM_LABELS.unlistOk, danger: true, icon: "UnlistIcon" }}
                        >
                          {OFFICE_LABELS.unlist}
                        </SubmitButton>
                      </form>
                    </div>
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        </AssignMany>
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
    </Panel>
  );
}

/**
 * ケアマネの一覧（T30）。足した順に名前・管理者の印・ID・担当の人数。見出しと「ケアマネ追加」は AddCareManager。
 * 行ごとの改名・管理者・停止・再発行（管理者だけ）と、自分の行のパスワード変更は CareManagerRow（T61）。停止した人も印つきで出す。
 * 審査員の壁の中（walled、T81）は、審査員が足したアカウントの行だけ変えられる（サーバーも lib/office/staff.ts で断る）
 */
function CareManagerList({
  careManagers,
  selfId,
  ownPassword,
  manage,
  walled,
}: {
  careManagers: CareManagerItem[];
  selfId: string | null;
  /** 自分の行のパスワード変更（審査員の試用事業所の管理者は持たない。T115） */
  ownPassword: boolean;
  manage: boolean;
  walled: boolean;
}) {
  return (
    <ul className="mt-2 grid gap-px text-sm">
      {careManagers.map((c) => (
        <CareManagerRow
          key={c.id}
          item={c}
          self={c.id === selfId}
          ownPassword={ownPassword}
          manage={manage && (!walled || c.judgeMade === true)}
        />
      ))}
    </ul>
  );
}

/** 事業所の経過。新しい順。誰が・いつ・何を。長いときは新しい 8 件を出し、残りは「全 N 件」で開く（区分の中で送らない） */
function LogSection({ log }: { log: OfficeLogItem[] }) {
  return (
    <Panel aria-labelledby="log-title">
      <PanelHead id="log-title" title={DISASTER_LABELS.log} count={log.length} />
      {log.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{DISASTER_LABELS.none}</p>
      ) : (
        <MoreFold
          first={8}
          className="mt-2 grid gap-px text-sm"
          items={log.map((e) => (
            <li key={e.id} className="rounded bg-panel2 px-2 py-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={LOG_TONE[e.kind]}>{e.label}</span>
                {e.person && <span>{e.person}</span>}
                {e.body && <span className="min-w-0 break-words">{e.body}</span>}
              </div>
              <div className="text-xs text-muted">
                {e.who} {e.when}
              </div>
            </li>
          ))}
        />
      )}
    </Panel>
  );
}

/**
 * 所属なし（T23）。医療班・行政がその場で登録した人（台帳に無かった人）。カナ・年齢・避難所・登録の時刻だけを出し、
 * 「引受」で自分の事業所・自分の担当に移す（引き受ける前は本人のページを開けない）。0 人なら区分を出さない
 */
function UnaffiliatedSection({ people }: { people: UnaffiliatedItem[] }) {
  if (people.length === 0) return null;
  return (
    <Panel id={UNAFFILIATED_ANCHOR} aria-labelledby="unaffiliated-title" className="scroll-mt-4">
      <PanelHead id="unaffiliated-title" title={CUSTODY_LABELS.unaffiliated} count={`${people.length} ${OFFICE_LABELS.people}`} />
      <div className={`mt-2 ${TABLE_BOX}`}>
        <table className={TABLE} data-table="unaffiliated">
          <thead>
            <tr>
              <th className={TH}>{CUSTODY_LABELS.kana}</th>
              <th className={TH}>{CUSTODY_LABELS.age}</th>
              <th className={TH}>{CUSTODY_LABELS.shelter}</th>
              <th className={TH}>{CUSTODY_LABELS.registeredAt}</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} data-unaffiliated={p.id}>
                <td className={`${TD} align-middle font-bold`}>{p.kana}</td>
                <td className={`${TD} align-middle whitespace-nowrap`}>
                  {p.age ?? "—"}
                  {p.ageReported && <span className="ml-1 text-xs text-muted">{CUSTODY_LABELS.reportedAge}</span>}
                </td>
                <td className={`${TD} align-middle`}>{p.shelters.join("・") || "—"}</td>
                <td className={`${TD} align-middle whitespace-nowrap`}>{p.createdWhen}</td>
                <td className={`${TD} align-middle text-right`}>
                  <form method="post" action={OFFICE_TAKE_PATH}>
                    <input type="hidden" name="person" value={p.id} />
                    <SubmitButton kind="main" size="sm">
                      {CUSTODY_LABELS.take}
                    </SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * デモ事業所の「最初に戻す」（T26）。審査員（ケアマネの役）と管理者だけに出す。押すとアプリ内の確認の窓（T44）を出し、
 * 窓の赤い塗りのボタンで種に戻す。JS が動く前に押したときは確認の欄（URL の reset=confirm）を開く。毎日 4:00 にも自動で戻る。経過には残さない
 */
function ResetSection({ state }: { state: ResetState | null }) {
  return (
    <Panel aria-labelledby="reset-title" data-reset>
      <PanelHead
        id="reset-title"
        title={RESET_LABELS.title}
        sub={
          <>
            <span className="text-xs text-muted">{RESET_LABELS.daily}</span>
            {/* 知らせ（role）は画面の頭の 1 行に出す。ここは区分の中の印だけ */}
            {state === "done" && (
              <span className="text-sm">
                <StateText tone="ok">{RESET_LABELS.done}</StateText>
              </span>
            )}
            {state === "failed" && <span className="text-sm font-bold text-danger">{RESET_LABELS.failed}</span>}
          </>
        }
      />
      {state === "confirm" ? (
        <form method="post" action={OFFICE_RESET_PATH} className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded bg-panel2 px-3 py-2">
          <input type="hidden" name="confirm" value="1" />
          <span className="text-sm">{RESET_LABELS.confirm}</span>
          <SubmitButton kind="dangerFill" icon="RetryIcon">{RESET_LABELS.reset}</SubmitButton>
          <ButtonLink href={OFFICE_PATH} kind="quiet" icon={CloseIcon}>
            {RESET_LABELS.cancel}
          </ButtonLink>
        </form>
      ) : (
        // アプリ内の確認の窓で決めてから送る（T44）。窓が出せないときはサーバーが確認の欄（URL の reset=confirm）へ戻す
        <form method="post" action={OFFICE_RESET_PATH} className="mt-2">
          <SubmitButton
            kind="danger"
            icon="RetryIcon"
            confirm={{
              title: CONFIRM_LABELS.resetTitle,
              message: RESET_LABELS.confirm,
              ok: CONFIRM_LABELS.resetOk,
              icon: "RestoreIcon",
              danger: true,
              fields: { confirm: "1" },
            }}
          >
            {RESET_LABELS.reset}
          </SubmitButton>
        </form>
      )}
    </Panel>
  );
}

function Message({ title }: { title: string }) {
  return (
    <Page width="full" className="max-w-6xl">
      <Panel className="p-6">
        <h1 className="text-xl font-bold">{title}</h1>
      </Panel>
    </Page>
  );
}
