// 訓練の採点（docs/tasks/T22.md）。訓練の画面の右の欄の上に、終わった・中断した訓練だけ出す。サーバーで描く（講評だけ client）。
// - 数字 4 つ（順番一致・報告遅延・空欄 様式 9・条件到達）は機械で数えた物（lib/drill/score.ts）。前回（同じ事業所・同じ災害の前の
//   終わった訓練）の数字を横に並べる。数字に色を付けない（色は状態の 4 色だけ。採点は状態ではない）
// - 内訳: 条件到達の人（時計と超過時刻）、順番相違の人と理由、様式 9 の空欄、着信の応答・拒否の数
// - 講評は components/drill/ReviewBox（Opus 1 回、AI の印、直せる）
// 正解・不正解の印や点数は出さない。「死亡」とは書かず「条件到達」

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
        <Detail title={SCORE_LABELS.reached} empty={view.reached.length === 0} k="reached">
          {view.reached.map((r) => (
            <li key={r.person} data-person={r.person}>
              <span className="font-bold">{r.name}</span> {r.text}
              <span className="ml-1.5 text-xs text-muted tabular-nums">
                {SCORE_LABELS.outAt} {r.outAt}
              </span>
            </li>
          ))}
        </Detail>
        <Detail title={SCORE_LABELS.misses} empty={view.misses.length === 0} k="misses">
          {view.misses.map((m) => (
            <li key={m.person} data-person={m.person}>
              <span className="font-bold">{m.name}</span> {m.why}
              {m.expected && (
                <span className="ml-1.5 text-xs text-muted">
                  {SCORE_LABELS.expected} {m.expected}
                </span>
              )}
            </li>
          ))}
        </Detail>
        <Detail title={`${SCORE_LABELS.form9} ${SCORE_LABELS.form9Doc}`} empty={view.blanks.length === 0} k="blanks">
          {view.blanks.map((b) => (
            <li key={b.person} data-person={b.person}>
              <span className="font-bold">{b.name}</span> {b.columns}
            </li>
          ))}
        </Detail>
        <div className="flex flex-wrap items-baseline gap-x-2" data-score-detail="calls">
          <span className={LABEL}>{SCORE_LABELS.calls}</span>
          <span className="tabular-nums">{view.calls}</span>
        </div>
      </section>

      <ReviewBox drillId={drillId} initial={review} canReview={canReview} names={names} />
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
