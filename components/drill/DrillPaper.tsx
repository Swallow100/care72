// 訓練記録の紙面（docs/tasks/T22.md）。事業所の年 1 回の訓練の記録に使える A4 縦の文書。印刷で PDF にする。
// 並び: 題と事業所・実施日・実施者 → 概要（想定・開始・状態・経過・参加者・前回）→ 採点（数字 4 つと前回、内訳）→
// 講評（AI の印、直した物は修正済）→ 確認欄（管理者・確認日・印を手で）→ 対応履歴（経過の時間ごとに、状況・対応・着信）。
// 数字は機械（lib/drill/score.ts）で、ここで数え直さない。言葉は画面と同じ（lib/drill/score-labels.ts）。紙の書き方（数字と単位を詰める）は
// lib/forms/paper-text の paperText を描く直前にだけ通す。
// T94: 採点に内訳（空振り・重複・頼み事の未対応・通話の往復）と空振り・重複の表、対応履歴に「事実」の列（その手を打った時に分かっていた事）、
// 自由対応の読み替え、通話の往復の数、訪問の様子と頼み事の 1 行（T93 の欄があるとき）。区切りの見出しは分の時刻（連続の時計）。
// T59: 開始の前に選んだ物（職員・夜間発災）と取り消した手の数（「取消 N」）は、あるときだけ概要に。手のメモは対応の行の下に（採点は変えない）。状態を持たない（Server Component のまま、テストで renderToStaticMarkup できる）。
// T105: 終わりに「発生と把握」の見比べ（起きたことと、ケアマネが把握した時刻・経路。遅れ・未把握の印）。分け方は経過のタブと同じ表
// （lib/drill/timeline.ts）。数の 1 行は採点の内訳の下にも同じ形で（「発生 12・公表 8・遅れ 3・未把握 1」。数は採点に残さず、描くときに数える）。
// 紙の決まりは components/forms/paper.css、流し方は components/drill/drill-paper.css。

import { Fragment } from "react";
import { AI_STATUS_LABELS, type AiStatus } from "@/lib/claude/status";
import { ACTION_STATUS_LABELS } from "@/lib/drill/actions";
import { aiStopBand, aiStopParts, isStopIncident } from "@/lib/drill/ai-stop";
import { callerLabel } from "@/lib/drill/calls";
import type { ActionRecord } from "@/lib/drill/engine";
import {
  ACTION_LABELS,
  ACTION_UI,
  BASIS_LABEL,
  calleeText,
  clockLabel,
  DRILL_LABELS,
  EVENT_KIND_LABELS,
  fictionLabels,
  LOG_LABELS,
  SCENARIO_LABELS,
  STATUS_LABELS,
  T59_LABELS,
} from "@/lib/drill/labels";
import { incidentLabel } from "@/lib/drill/event-catalog";
import { awareCounts, awareText, buildDrillLog, type Awareness, type LogRow } from "@/lib/drill/timeline";
import type { DrillRecord, StoredReview } from "@/lib/drill/record";
import type { ReviewBody } from "@/lib/drill/review";
import { knownOf, rowOf, talkTurns, visitOf } from "@/lib/drill/score";
import { askWords, factWords, REVIEW_ERROR_LABELS, REVIEW_KIND_LABELS, REVIEW_UI, SCORE_LABELS } from "@/lib/drill/score-labels";
import { extraText, scoreView } from "@/lib/drill/score-view";
import { isVirtual, lastHour, scenarioOf } from "@/lib/drill/scenarios";
import { hourSpanText, hourText } from "@/lib/drill/time-text";
import { cssString } from "@/components/forms/Form9Paper";
import { paperText } from "@/lib/forms/paper-text";
import { warekiText } from "@/lib/forms/wareki";
import { checkMark, isSourceId, sourceById } from "@/lib/sources";

export type DrillPaperRecord = Pick<DrillRecord, "screen" | "score" | "review" | "calls" | "previous">;

const t = paperText;

/** JST の日付（YYYY-MM-DD）と時刻（HH:MM） */
function jst(iso: string): { date: string; time: string } {
  const d = new Date(Date.parse(iso) + 9 * 3600_000);
  if (Number.isNaN(d.getTime())) return { date: iso.slice(0, 10), time: "" };
  const s = d.toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
}

/** 画面と紙面に出す講評（lib/drill/record.ts の shownReview と同じ） */
function shownOf(r: StoredReview | null): (ReviewBody & { edited: boolean }) | null {
  if (!r || r.state !== "done") return null;
  return r.edited ? { ...r.edited, edited: true } : { ...r.ai, edited: false };
}

/**
 * 講評が無いときの言い方。AI が作れなかったら「AI 停止（上限到達）」（画面の講評と同じ言葉。T76）。
 * 作っていない講評は、今 AI が未設定なら「AI 停止（未設定）」、ほかは「講評なし」
 */
function noReviewText(r: StoredReview | null, ai: AiStatus | null): string {
  if (!r) return ai?.kind === "unset" ? `${REVIEW_UI.stopped}（${REVIEW_ERROR_LABELS.not_configured}）` : REVIEW_UI.none;
  if (r.state === "pending") return REVIEW_UI.creating;
  if (r.state === "failed") return `${REVIEW_UI.stopped}（${REVIEW_ERROR_LABELS[r.error] ?? REVIEW_UI.failed}）`;
  return REVIEW_UI.none;
}

/** 概要の AI の行（「停止 上限到達 経過 6 時間〜 想定のみ」）。見出しの「AI」と重ねない */
function stopLine(b: NonNullable<ReturnType<typeof aiStopBand>>): string {
  const p = aiStopParts(b);
  return [AI_STATUS_LABELS.stop, p.reason, p.span, p.effect, p.resume].filter(Boolean).join(" ");
}

/**
 * 対応履歴の区切りの見出しの時間（「6〜9 時間」）。連続の時計（T90）の区切りは分の時刻なので「3 時間 35 分〜7 時間 25 分」
 * （小数の時間をそのまま書かない）。整数の時間だけの刻みは前と同じ書き方
 */
type HistoryRow =
  | { kind: "action"; at: number; order: number; a: ActionRecord }
  | { kind: "call"; at: number; order: number; c: DrillPaperRecord["calls"][number] };

export function DrillPaper({ record, office, today, ai = null }: { record: DrillPaperRecord; office: string; today: string; ai?: AiStatus | null }) {
  const { screen, score, review, calls, previous } = record;
  const names = screen.names;
  const name = (p: string | null) => (p ? (names[p] ?? p) : ACTION_UI.whole);
  const view = scoreView(score, names, previous);
  const wastedIds = new Set(view.extra.wasted.map((w) => w.action));
  const repeatIds = new Set(view.extra.repeat.map((r) => r.action));
  // 空振りと重複の表は手を打った順に（同じ手が両方なら空振りを先に）
  const minuteOf = new Map(screen.state.actions.map((a) => [a.id, a.atMinute]));
  const choiceRows = [
    ...view.extra.wasted.map((w) => ({ key: `w-${w.action}`, action: w.action, at: w.at, name: w.name, act: w.act, kind: SCORE_LABELS.wasted, why: w.why, order: 0 })),
    ...view.extra.repeat.map((r) => ({
      key: `r-${r.action}`,
      action: r.action,
      at: r.at,
      name: r.name,
      act: r.act,
      kind: SCORE_LABELS.repeat,
      why: `${SCORE_LABELS.gap} ${r.gap} 分`,
      order: 1,
    })),
  ].sort((x, y) => (minuteOf.get(x.action) ?? 0) - (minuteOf.get(y.action) ?? 0) || x.order - y.order);
  const started = jst(screen.drill.started_at);
  const shown = shownOf(review);
  const scenario = screen.drill.scenario;
  const prev = view.previous ? jst(view.previous.startedAt) : null;

  // 対応履歴: 経過の時間（刻み）ごとに、状況と、その間に打った対応・掛かってきた着信
  const actions = screen.state.actions;
  const undone = screen.state.undone ?? 0;
  const opts = screen.state.options;
  const settings = [
    opts?.staff !== undefined ? `${T59_LABELS.staff} ${opts.staff} ${T59_LABELS.people}` : null,
    opts?.night ? T59_LABELS.night : null,
  ]
    .filter(Boolean)
    .join("・");
  // AI 停止は刻みごとに積まず、概要の 1 行（画面の帯と同じ。T76）
  const stop = aiStopBand(screen.ticks, { virtual: isVirtual(scenario), running: false, now: null });
  // 発生と把握の見比べ（T105）。終わった訓練なので非公表の物も出す
  const log = buildDrillLog(screen.ticks, actions, { finished: true });
  const aware = awareCounts(log);
  const viaOf = (w: Awareness): string => {
    if (w.via === "public") return LOG_LABELS.public;
    if (w.via === "signal") return LOG_LABELS.viaSignal;
    const a = w.from ? actions.find((x) => `h-${x.id}` === w.from) : undefined;
    return a ? ACTION_LABELS[a.kind] : "";
  };
  const groups = screen.ticks
    .map((tick, i) => {
      // 刻みは前の刻みの時刻からこの刻みの時刻まで（10 分版は 12 → 72 時間のように広い）
      const from = i > 0 ? screen.ticks[i - 1].hour : null;
      const rows: HistoryRow[] = [
        ...actions.filter((a) => a.step === tick.step).map((a, i) => ({ kind: "action" as const, at: a.atMinute, order: i * 2, a })),
        ...calls.filter((c) => c.step === tick.step).map((c, i) => ({ kind: "call" as const, at: c.minute, order: i * 2 + 1, c })),
      ].sort((x, y) => x.at - y.at || x.order - y.order);
      return { tick, rows, from, incidents: tick.incidents.filter((e) => !isStopIncident(e, tick)) };
    })
    .filter((g) => g.rows.length > 0 || g.incidents.length > 0);

  return (
    <div className="paper paper-drill" data-paper-root data-sheet="drill-record" data-drill={screen.drill.id}>
      {/* 頁の下の端の左（2 頁目からもどの事業所のいつの訓練か分かるように） */}
      <style>{`@page drill-record { @bottom-left { content: ${cssString(`${SCORE_LABELS.paper}　${office}　${t(warekiText(started.date))}`)}; } }`}</style>
      <div className="head-row">
        <h1 className="title">{SCORE_LABELS.paper}</h1>
        <div className="top-col">
          <span>
            {SCORE_LABELS.office} {office}
          </span>
          <span className="nowrap">
            {SCORE_LABELS.date} {t(warekiText(started.date))}
          </span>
          {screen.drill.startedByName && (
            <span>
              {SCORE_LABELS.startedBy} {screen.drill.startedByName}
            </span>
          )}
          <span className="nowrap">
            {SCORE_LABELS.made} {t(warekiText(today))}
          </span>
        </div>
      </div>

      {/* 概要 */}
      <section className="drill-sec" data-block="summary">
        <h2 className="drill-h">{SCORE_LABELS.summary}</h2>
        <dl className="drill-facts">
          <dt>{SCORE_LABELS.scenario}</dt>
          <dd>{t(`${SCENARIO_LABELS[scenario]}（${lastHour(scenarioOf(scenario))} ${DRILL_LABELS.hours}）`)}</dd>
          <dt>{SCORE_LABELS.status}</dt>
          <dd>{STATUS_LABELS[screen.drill.status]}</dd>
          <dt>{SCORE_LABELS.startedAt}</dt>
          <dd className="nowrap">{t(`${warekiText(started.date)} ${started.time}`)}</dd>
          <dt>{SCORE_LABELS.elapsed}</dt>
          <dd className="nowrap">{t(clockLabel(score.endMinute))}</dd>
          <dt>{SCORE_LABELS.participants}</dt>
          <dd className="wide">
            {t(`${score.participants.length} 人`)}（{score.participants.map((p) => name(p)).join("・")}）
            <span data-fictional>{t(`、${fictionLabels(screen.fiction).title}`)}</span>
          </dd>
          <dt>{SCORE_LABELS.previous}</dt>
          <dd className="wide">
            {view.previous && prev ? t(`${warekiText(prev.date)} ${SCENARIO_LABELS[view.previous.scenario]}`) : SCORE_LABELS.noPrevious}
          </dd>
          {settings && (
            <>
              <dt>{T59_LABELS.settings}</dt>
              <dd className="wide" data-settings>
                {t(settings)}
              </dd>
            </>
          )}
          {stop && (
            <>
              <dt>{AI_STATUS_LABELS.ai}</dt>
              <dd className="wide" data-ai-stop={stop.reason}>
                {t(stopLine(stop))}
              </dd>
            </>
          )}
          {undone > 0 && (
            <>
              <dt>{T59_LABELS.undone}</dt>
              <dd className="wide" data-undone={undone}>
                {t(`${undone} ${ACTION_UI.count}`)}
              </dd>
            </>
          )}
        </dl>
      </section>

      {/* 採点 */}
      <section className="drill-sec" data-block="score">
        <h2 className="drill-h">{SCORE_LABELS.score}</h2>
        <table className="sheet drill-table">
          <colgroup>
            <col style={{ width: "34%" }} />
            <col style={{ width: "33%" }} />
            <col style={{ width: "33%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{SCORE_LABELS.item}</th>
              <th className="num">{SCORE_LABELS.thisTime}</th>
              <th className="num">{SCORE_LABELS.previous}</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.key} data-score-key={r.key}>
                <td>
                  {r.label}
                  {r.sub && <span className="p-sub"> {r.sub}</span>}
                  {r.key === "ended" && <span className="drill-ai"> AI</span>}
                </td>
                <td className="num big nowrap">{t(r.now)}</td>
                <td className="num nowrap">{r.prev === null ? SCORE_LABELS.none : t(r.prev)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="drill-sub">
          {SCORE_LABELS.reached}
          {view.ended && ` ${SCORE_LABELS.reachedBy}`}
        </h3>
        <table className="sheet drill-table" data-detail="reached">
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "54%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{SCORE_LABELS.person}</th>
              <th>{SCORE_LABELS.clock}</th>
              <th>{SCORE_LABELS.outAt}</th>
              <th className="num">{SCORE_LABELS.tries}</th>
            </tr>
          </thead>
          <tbody>
            {view.reached.length === 0 && (
              <tr>
                <td colSpan={4}>{SCORE_LABELS.none}</td>
              </tr>
            )}
            {view.reached.map((r) => (
              <tr key={r.person} data-person={r.person}>
                <td>{r.name}</td>
                <td>{t(r.text)}</td>
                <td className="nowrap">{t(r.outAt)}</td>
                <td className="num">{r.tries}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 仮想モード（T53）: 世界（AI）が決めた結末。上の条件到達（時計の計算）とは別の数 */}
        {view.ended && (
          <>
            <h3 className="drill-sub">
              {SCORE_LABELS.ended} {SCORE_LABELS.endedBy} <span className="drill-ai">AI</span>
            </h3>
            <table className="sheet drill-table" data-detail="ended">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "36%" }} />
                <col style={{ width: "32%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>{SCORE_LABELS.person}</th>
                  <th>{SCORE_LABELS.endedText}</th>
                  <th>{SCORE_LABELS.reason}</th>
                  <th>{SCORE_LABELS.endedAt}</th>
                </tr>
              </thead>
              <tbody>
                {view.ended.length === 0 && (
                  <tr>
                    <td colSpan={4}>{SCORE_LABELS.none}</td>
                  </tr>
                )}
                {view.ended.map((e) => (
                  <tr key={e.person} data-person={e.person}>
                    <td>{e.name}</td>
                    <td>{t(e.text)}</td>
                    <td>{e.reason ? t(e.reason) : ""}</td>
                    <td className="nowrap">{t(e.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h3 className="drill-sub">{SCORE_LABELS.misses}</h3>
        <table className="sheet drill-table" data-detail="misses">
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "54%" }} />
            <col style={{ width: "28%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{SCORE_LABELS.person}</th>
              <th>{SCORE_LABELS.reason}</th>
              <th>{SCORE_LABELS.expected}</th>
            </tr>
          </thead>
          <tbody>
            {view.misses.length === 0 && (
              <tr>
                <td colSpan={3}>{SCORE_LABELS.none}</td>
              </tr>
            )}
            {view.misses.map((m) => (
              <tr key={m.person} data-person={m.person}>
                <td>{m.name}</td>
                <td>{m.why}</td>
                <td>{m.expected ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="drill-sub">
          {SCORE_LABELS.form9} {SCORE_LABELS.form9Doc}
        </h3>
        <table className="sheet drill-table" data-detail="blanks">
          <colgroup>
            <col style={{ width: "18%" }} />
            <col style={{ width: "82%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{SCORE_LABELS.person}</th>
              <th>{SCORE_LABELS.column}</th>
            </tr>
          </thead>
          <tbody>
            {view.blanks.length === 0 && (
              <tr>
                <td colSpan={2}>{SCORE_LABELS.none}</td>
              </tr>
            )}
            {view.blanks.map((b) => (
              <tr key={b.person} data-person={b.person}>
                <td>{b.name}</td>
                <td>{b.columns}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {SCORE_LABELS.calls} {view.calls}
        </p>

        {/* T94: 手の選び方の内訳。数は機械、4 つの数字には入れない。空振り・重複・頼み事の未対応がある時だけ表 */}
        <p data-detail="extra">{t(extraText(view.extra.counts))}</p>
        <p data-detail="aware">{t(awareText(aware))}</p>
        {choiceRows.length > 0 && (
          <table className="sheet drill-table" data-detail="choice">
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "32%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>{SCORE_LABELS.at}</th>
                <th>{SCORE_LABELS.person}</th>
                <th>{SCORE_LABELS.action}</th>
                <th>{SCORE_LABELS.kind}</th>
                <th>{SCORE_LABELS.reason}</th>
              </tr>
            </thead>
            <tbody>
              {choiceRows.map((c) => (
                <tr key={c.key} {...(c.order === 0 ? { "data-wasted": c.action } : { "data-repeat": c.action })}>
                  <td className="nowrap">{t(c.at)}</td>
                  <td>{c.name}</td>
                  <td>{c.act}</td>
                  <td>{c.kind}</td>
                  <td>{t(c.why)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.extra.asks.length > 0 && (
          <table className="sheet drill-table" data-detail="asks">
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "82%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>{SCORE_LABELS.person}</th>
                <th>
                  {SCORE_LABELS.asks} {SCORE_LABELS.asksOpen}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.extra.asks.map((a) => (
                <tr key={a.person} data-person={a.person}>
                  <td>{a.name}</td>
                  <td>{a.kinds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 講評 */}
      <section className="drill-sec drill-review" data-block="review">
        <h2 className="drill-h">
          {REVIEW_UI.review} {shown && <span className="drill-ai">AI</span>}
          {shown?.edited && <span className="p-sub"> {REVIEW_UI.edited}</span>}
        </h2>
        {shown ? (
          <>
            {shown.summary && (
              <p data-review-summary>
                <span className="f-l">{REVIEW_UI.summary}</span>
                {t(shown.summary)}
              </p>
            )}
            {shown.findings.length > 0 && (
              <table className="sheet drill-table">
                <colgroup>
                  <col style={{ width: "9%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "45%" }} />
                  <col style={{ width: "32%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{SCORE_LABELS.kind}</th>
                    <th>{SCORE_LABELS.target}</th>
                    <th>{REVIEW_UI.findings}</th>
                    <th>{BASIS_LABEL}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.findings.map((f, i) => {
                    const basis = f.basis && isSourceId(f.basis) ? sourceById(f.basis) : null;
                    return (
                      <tr key={i} data-finding={f.kind}>
                        <td>{REVIEW_KIND_LABELS[f.kind]}</td>
                        <td>{f.person ? name(f.person) : REVIEW_UI.whole}</td>
                        <td>{t(f.text)}</td>
                        <td>
                          {basis ? (
                            <>
                              {basis.publisher} {basis.year}
                              {checkMark(basis.id) === "未確認" && <span className="p-unc">（{checkMark(basis.id)}）</span>}
                            </>
                          ) : (
                            SCORE_LABELS.none
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <p data-review-none>{noReviewText(review, ai)}</p>
        )}
      </section>

      {/* 確認欄（手で書く） */}
      <section className="drill-sec" data-block="confirm">
        <h2 className="drill-h">{SCORE_LABELS.confirm}</h2>
        <div className="drill-confirm">
          <div>
            <span className="f-l">{SCORE_LABELS.manager}</span>
          </div>
          <div>
            <span className="f-l">{SCORE_LABELS.checkedOn}</span>
          </div>
          <div>
            <span className="f-l">{SCORE_LABELS.stamp}</span>
          </div>
        </div>
      </section>

      {/* 対応履歴 */}
      <section className="drill-sec" data-block="history">
        <h2 className="drill-h">{SCORE_LABELS.history}</h2>
        <table className="sheet drill-table">
          <colgroup>
            <col style={{ width: "14%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "21%" }} />
            <col style={{ width: "23%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{SCORE_LABELS.at}</th>
              <th>{SCORE_LABELS.action}</th>
              <th>{SCORE_LABELS.target}</th>
              <th>{SCORE_LABELS.callee}</th>
              <th>{SCORE_LABELS.facts}</th>
              <th>{SCORE_LABELS.result}</th>
            </tr>
          </thead>
          {groups.map(({ tick, rows, from, incidents }) => (
            <tbody key={tick.step} data-hour={tick.hour}>
              <tr className="hour">
                <td colSpan={6}>
                  {t(`${SCORE_LABELS.elapsed} ${from !== null && from + 1 < tick.hour ? hourSpanText(from, tick.hour) : hourText(tick.hour)}`)}
                  {incidents.map((e, i) => (
                    <span key={i} className="incident">
                      {SCORE_LABELS.situation} {t(clockLabel(Math.round(e.at * 60)))} {t(e.text)}
                      {e.ai && <span className="drill-ai"> AI</span>}
                    </span>
                  ))}
                </td>
              </tr>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6}>{SCORE_LABELS.noAction}</td>
                </tr>
              )}
              {rows.map((r) => {
                if (r.kind === "call") {
                  return (
                    <tr key={r.c.signal} data-call={r.c.response ?? "open"}>
                      <td className="nowrap">{t(clockLabel(r.c.minute))}</td>
                      <td>{SCORE_LABELS.calls}</td>
                      <td>{name(r.c.person)}</td>
                      <td>{callerLabel(r.c.source, screen.contacts[r.c.person] ?? [])}</td>
                      <td />
                      <td>
                        {r.c.response === "answer" ? SCORE_LABELS.answered : r.c.response === "decline" ? SCORE_LABELS.declined : SCORE_LABELS.open}
                      </td>
                    </tr>
                  );
                }
                const a = r.a;
                // その手を打った時に分かっていた事実（T94。手の前の状態と、その時の世界の電話・施設の休止）
                const facts = factWords(knownOf(a, screen.ticks), rowOf(a)?.id ?? a.kind);
                const turns = talkTurns(a);
                const visit = visitOf(a);
                const marks = [wastedIds.has(a.id) ? SCORE_LABELS.wasted : null, repeatIds.has(a.id) ? SCORE_LABELS.repeat : null].filter(Boolean);
                return (
                  <Fragment key={a.id}>
                    <tr data-action={a.kind}>
                      <td className="nowrap">{t(clockLabel(a.atMinute))}</td>
                      <td>
                        {ACTION_LABELS[a.kind]}
                        {/* 自由対応は読み替えた手（ケアマネの文は紙に出さない。T91） */}
                        {a.kind === "free" && a.as && (
                          <span className="p-sub" data-reading={a.as}>
                            {" "}
                            {SCORE_LABELS.reading} {ACTION_LABELS[a.as]}
                          </span>
                        )}
                      </td>
                      <td>{name(a.person)}</td>
                      <td>{calleeText(a) ?? ""}</td>
                      <td data-facts={a.id}>{t(facts.join("・"))}</td>
                      <td>
                        {a.result ? ACTION_STATUS_LABELS[a.result.status] : ACTION_UI.during}
                        {/* 通話の往復（T93）は畳んで数だけ */}
                        {turns > 0 && <span data-talk={turns}>{t(`・${turns} ${SCORE_LABELS.talks}`)}</span>}
                        {marks.length > 0 && <span data-mark={marks.join(" ")}>・{marks.join("・")}</span>}
                        {/* 通話で聞いた安否を表に渡さなかった手（T84、至急維持）。本番の電話と同じ言葉 */}
                        {screen.refused?.[a.id] && <span data-heard-refused> {t(screen.refused[a.id])}</span>}
                      </td>
                    </tr>
                    {visit && (
                      <tr data-visit={a.id}>
                        <td />
                        <td colSpan={5}>
                          {visit.condition && (
                            <>
                              {SCORE_LABELS.condition} {t(visit.condition)}
                              {visit.ai && <span className="drill-ai"> AI</span>}
                            </>
                          )}
                          {visit.condition && visit.asks.length > 0 && "　"}
                          {visit.asks.length > 0 && `${SCORE_LABELS.asks} ${askWords(visit.asks)}`}
                        </td>
                      </tr>
                    )}
                    {a.memo && (
                      <tr data-memo={a.id}>
                        <td />
                        <td colSpan={5}>
                          {T59_LABELS.memo} {a.memo}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </section>

      {/* 発生と把握（T105） */}
      <section className="drill-sec" data-block="compare">
        <h2 className="drill-h">{LOG_LABELS.compare}</h2>
        <p>{t(awareText(aware))}</p>
        <table className="sheet drill-table" data-detail="compare">
          <colgroup>
            <col style={{ width: "14%" }} />
            <col style={{ width: "36%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "14%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>{SCORE_LABELS.at}</th>
              <th>{LOG_LABELS.happened}</th>
              <th>{SCORE_LABELS.target}</th>
              <th>{LOG_LABELS.knownAt}</th>
              <th>{LOG_LABELS.via}</th>
              <th>{LOG_LABELS.mark}</th>
            </tr>
          </thead>
          <tbody>
            {log.occur.length === 0 && (
              <tr>
                <td colSpan={6}>{SCORE_LABELS.none}</td>
              </tr>
            )}
            {log.occur.map((r) => {
              const w = log.aware[r.key];
              return (
                <tr key={r.key} data-occur={r.key} data-aware={w?.mark ?? (w?.via === "public" ? "public" : "known")}>
                  <td className="nowrap">{t(clockLabel(r.minute))}</td>
                  <td>
                    {happenedText(r)}
                    {rowAi(r) && <span className="drill-ai"> AI</span>}
                  </td>
                  <td>{r.person ? name(r.person) : ACTION_UI.whole}</td>
                  <td className="nowrap">{w?.at !== null && w?.at !== undefined ? t(clockLabel(w.at)) : ""}</td>
                  <td>{w && w.at !== null ? viaOf(w) : ""}</td>
                  <td className="nowrap">
                    {w?.mark === "late" ? t(`${LOG_LABELS.late} ${clockLabel(w.lag ?? 0)}`) : w?.mark === "never" ? LOG_LABELS.never : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** 見比べの「起きたこと」（種類の印と文）。本人のする事は「行動」 */
function happenedText(r: LogRow): string {
  if (r.source === "incident") return t(`${incidentLabel(r.e) ?? EVENT_KIND_LABELS[r.e.change.kind]} ${r.e.text}`);
  if (r.source === "doing") return t(`${LOG_LABELS.doing} ${r.t.doing ?? ""}`);
  return "";
}

/** 見比べの行が AI の物か（監督・世界・本人役） */
function rowAi(r: LogRow): boolean {
  if (r.source === "incident") return r.e.ai;
  if (r.source === "doing") return r.t.ai;
  return false;
}
