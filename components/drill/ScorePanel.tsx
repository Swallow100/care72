// 訓練の採点（docs/tasks/T22.md）。訓練の画面の右の欄の上に、終わった・中断した訓練だけ出す。サーバーで描く（講評だけ client）。
// - 数字 4 つ（順番一致・報告遅延・空欄 様式 9・条件到達）は機械で数えた物（lib/drill/score.ts）。前回（同じ事業所・同じ災害の前の
//   終わった訓練）の数字を横に並べる。数字に色を付けない（色は状態の 4 色だけ。採点は状態ではない）
// - 内訳: 条件到達の人（時計と超過時刻）、順番相違の人と理由、様式 9 の空欄、着信の応答・拒否の数
// - 講評は components/drill/ReviewBox（Opus 1 回、AI の印、直せる）
// - 仮想モード（T53）は「結末 AI 筋書」（世界が決めた人）を「条件到達 時計計算」と別の数で出し、内訳に結末の 1 文と理由（AI の印）
// 正解・不正解の印や点数は出さない。「死亡」とは書かず「条件到達」

import { AiMark } from "@/components/person/parts";
import { LABEL, PanelHead } from "@/components/ui/Panel";
import { shortJst } from "@/lib/disaster/state";
import type { StoredReview } from "@/lib/drill/record";
import { SCORE_LABELS } from "@/lib/drill/score-labels";
import { previousText, type ScoreView } from "@/lib/drill/score-view";
import { ReviewBox } from "./ReviewBox";

export function ScorePanel({
  drillId,
  view,
  review,
  canReview,
  names,
}: {
  drillId: string;
  view: ScoreView;
  review: StoredReview | null;
  canReview: boolean;
  names: Readonly<Record<string, string>>;
}) {
  return (
    <div className="space-y-3" data-score>
      <section aria-labelledby={`score-${drillId}`} className="space-y-1.5">
        <PanelHead id={`score-${drillId}`} title={SCORE_LABELS.score} sub={<span className={LABEL}>{previousText(view.previous, shortJst)}</span>} />
        <dl className="grid grid-cols-2 gap-1.5">
          {view.rows.map((r) => (
            <div key={r.key} className="rounded bg-panel2 px-2 py-1.5" data-score-key={r.key}>
              <dt className={LABEL}>
                {r.label}
                {r.sub && <span className="ml-1">{r.sub}</span>}
                {r.key === "ended" && (
                  <span className="ml-1">
                    <AiMark small />
                  </span>
                )}
              </dt>
              <dd className="text-xl leading-7 font-bold tabular-nums" data-score-now>
                {r.now}
              </dd>
              {r.prev !== null && (
                <dd className="text-xs text-muted tabular-nums" data-score-prev>
                  {SCORE_LABELS.previous} {r.prev}
                </dd>
              )}
            </div>
          ))}
        </dl>
      </section>

      <section aria-label={SCORE_LABELS.detail} className="space-y-1.5 text-sm">
        <Detail title={view.ended ? `${SCORE_LABELS.reached} ${SCORE_LABELS.reachedBy}` : SCORE_LABELS.reached} empty={view.reached.length === 0} k="reached">
          {view.reached.map((r) => (
            <li key={r.person} data-person={r.person}>
              <span className="font-bold">{r.name}</span> {r.text}
              <span className="ml-1.5 text-xs text-muted tabular-nums">
                {SCORE_LABELS.outAt} {r.outAt}
              </span>
            </li>
          ))}
        </Detail>
        {view.ended && (
          <Detail title={`${SCORE_LABELS.ended} ${SCORE_LABELS.endedBy}`} empty={view.ended.length === 0} k="ended">
            {view.ended.map((e) => (
              <li key={e.person} data-person={e.person}>
                <span className="font-bold">{e.name}</span> <AiMark small /> {e.text}
                {e.reason && <span className="ml-1.5 text-xs text-muted">{e.reason}</span>}
                <span className="ml-1.5 text-xs text-muted tabular-nums">
                  {SCORE_LABELS.endedAt} {e.at}
                </span>
              </li>
            ))}
          </Detail>
        )}
        <Detail title={SCORE_LABELS.misses} empty={view.misses.length === 0} k="misses">
          {/* 同じ理由の人は 1 行にまとめる（後手は最優先の人が人ごとに違うので 1 人 1 行） */}
          {groupBy(view.misses, (m) => (m.expected ? `${m.person}` : m.why)).map((g) => (
            <li key={g.key} data-miss={g.items[0].why}>
              <span className="font-bold">{g.items[0].why}</span> {g.items.map((m) => m.name).join("・")}
              {g.items[0].expected && (
                <span className="ml-1.5 text-xs text-muted">
                  {SCORE_LABELS.expected} {g.items[0].expected}
                </span>
              )}
            </li>
          ))}
        </Detail>
        <Detail title={`${SCORE_LABELS.form9} ${SCORE_LABELS.form9Doc}`} empty={view.blanks.length === 0} k="blanks">
          {groupBy(view.blanks, (b) => b.columns).map((g) => (
            <li key={g.key} data-blank={g.key}>
              <span className="font-bold">{g.key}</span> {g.items.map((b) => b.name).join("・")}
            </li>
          ))}
        </Detail>
        <div className="flex flex-wrap items-baseline gap-x-2" data-score-detail="calls">
          <span className={LABEL}>{SCORE_LABELS.calls}</span>
          <span className="tabular-nums">{view.calls}</span>
        </div>
        {/* T94: 手の選び方の内訳（空振り・重複・頼み事の未対応・通話の往復）。数は機械、4 つの大きな数字には入れない */}
        <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" data-score-detail="extra">
          <Count label={SCORE_LABELS.wasted} n={view.extra.counts.wasted} k="wasted" />
          <Count label={SCORE_LABELS.repeat} n={view.extra.counts.repeat} k="repeat" />
          <Count label={`${SCORE_LABELS.asks} ${SCORE_LABELS.asksOpen}`} n={view.extra.counts.asksOpen} k="asks" />
          <Count label={SCORE_LABELS.talk} n={view.extra.counts.talks} unit={SCORE_LABELS.talks} k="talks" />
        </dl>
        {view.extra.wasted.length > 0 && (
          <Detail title={SCORE_LABELS.wasted} empty={false} k="wasted">
            {view.extra.wasted.map((w) => (
              <li key={w.action} data-action={w.action}>
                <span className="font-bold">{w.name}</span> {w.act} {w.why}
                <span className="ml-1.5 text-xs text-muted tabular-nums">{w.at}</span>
              </li>
            ))}
          </Detail>
        )}
        {view.extra.repeat.length > 0 && (
          <Detail title={SCORE_LABELS.repeat} empty={false} k="repeat">
            {view.extra.repeat.map((r) => (
              <li key={r.action} data-action={r.action}>
                <span className="font-bold">{r.name}</span> {r.act}
                <span className="ml-1.5 text-xs text-muted tabular-nums">
                  {SCORE_LABELS.gap} {r.gap} 分・{r.at}
                </span>
              </li>
            ))}
          </Detail>
        )}
        {view.extra.asks.length > 0 && (
          <Detail title={`${SCORE_LABELS.asks} ${SCORE_LABELS.asksOpen}`} empty={false} k="asks">
            {view.extra.asks.map((a) => (
              <li key={a.person} data-person={a.person}>
                <span className="font-bold">{a.name}</span> {a.kinds}
              </li>
            ))}
          </Detail>
        )}
      </section>

      <ReviewBox drillId={drillId} initial={review} canReview={canReview} names={names} />
    </div>
  );
}

/** 鍵の同じ物をまとめる（最初に出た順） */
function groupBy<T>(items: ReadonlyArray<T>, keyOf: (x: T) => string): Array<{ key: string; items: T[] }> {
  const out = new Map<string, T[]>();
  for (const x of items) out.set(keyOf(x), [...(out.get(keyOf(x)) ?? []), x]);
  return [...out].map(([key, items]) => ({ key, items }));
}

/** 内訳の数 1 つ（「空振り 2」「通話 3 往復」） */
function Count({ label, n, unit, k }: { label: string; n: number; unit?: string; k: string }) {
  return (
    <div className="flex items-baseline gap-x-1" data-extra={k}>
      <dt className={LABEL}>{label}</dt>
      <dd className="tabular-nums">
        {n}
        {unit && <span className="ml-0.5">{unit}</span>}
      </dd>
    </div>
  );
}

function Detail({ title, empty, k, children }: { title: string; empty: boolean; k: string; children: React.ReactNode }) {
  return (
    <div data-score-detail={k}>
      <div className={LABEL}>{title}</div>
      {empty ? <p className="text-muted">{SCORE_LABELS.none}</p> : <ul className="space-y-0.5">{children}</ul>}
    </div>
  );
}
