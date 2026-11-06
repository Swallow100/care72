// 事業所の画面（/office）の災害モードの区分の中の気象庁の欄（T72 の 2）。中身は lib/jma/alerts.ts、ここは並べるだけ。
// - 警報・注意報は気象庁の正式な名前・市町村・状態・発表時刻・発表官署のまま。状態の 4 色（安否の色）は使わない。警報の名前だけ太字
// - 該当 N 人（住所の市が同じ利用者の数。名前は出さない）。担当一覧の絞込は町名なので、市でのリンクは付けない（docs/progress/t72.md の問い）
// - 警報（注意報でない物）があり平時なら「切替」を赤の文字で。押すと下の切替のボタンへ送るだけ（自動では切り替えない）
// - 地震は直近 24 時間で、事業所と利用者の市の観測点の震度があるときだけ。観測点の名前を添える（利用者の家の震度と言い切らない）
// - 取れていなければ「未取得」と最後に取れた時刻。下に出典の 1 行

import { ExternalIcon, GoToIcon } from "@/components/ui/Icon";
import { JMA_ANCHOR, JMA_LABELS, splitSource, WARNING_SOURCE, intensityLabel, magnitudeLabel } from "@/lib/jma/labels";
import type { JmaAlertsData } from "@/lib/jma/alerts";
import { shortJst } from "@/lib/disaster/state";

/** 切替（Button の md と同じ高さ 32px・角・太字。面の中の灰の上なので白の地、文字だけ赤） */
const SWITCH = "relative ml-auto inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded bg-panel px-3 text-sm font-bold whitespace-nowrap text-danger";

const FOCUS = "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-accent";

/** 出典の文を押せる字の前後に（文は変えない） */
const source = splitSource(WARNING_SOURCE);

/** 時刻だけ（HH:MM、日本の時刻） */
function hm(iso: string): string {
  return shortJst(iso).split(" ")[1] ?? iso;
}

export function JmaAlertsView({
  data,
  disaster,
  switchHref,
}: {
  data: JmaAlertsData;
  /** 事業所が災害モードか（平時のときだけ「切替」を勧める） */
  disaster: boolean;
  /** 「切替」の行き先（同じ画面の切替のボタン） */
  switchHref: string;
}) {
  const suggest = !disaster && data.rows.some((r) => r.warning);
  return (
    <section id={JMA_ANCHOR} aria-label={JMA_LABELS.title} className="mt-2 grid scroll-mt-20 gap-1 rounded bg-panel2 px-3 py-2 text-sm" data-jma>
      <div className="flex min-h-8 flex-wrap items-center gap-x-2">
        <span className="font-bold">{JMA_LABELS.title}</span>
        {data.fetch.ok ? (
          <span className="text-xs text-muted tabular-nums" data-jma-fetch="ok">
            {data.fetch.at ? hm(data.fetch.at) : "—"} {JMA_LABELS.fetched}
          </span>
        ) : (
          <span className="text-xs font-bold tabular-nums" data-jma-fetch="stale">
            {JMA_LABELS.unfetched} {data.fetch.at ? shortJst(data.fetch.at) : "—"}
          </span>
        )}
        {suggest && (
          <a href={switchHref} data-press className={`${SWITCH} ${FOCUS}`} data-jma-switch>
            <GoToIcon aria-hidden className="size-4 shrink-0" />
            {JMA_LABELS.switch}
          </a>
        )}
      </div>

      {data.rows.length === 0 ? (
        <p className="text-xs text-muted" data-jma-none>
          {JMA_LABELS.warning}・{JMA_LABELS.advisory} {JMA_LABELS.none}
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {data.rows.map((r) => (
            <li
              key={`${r.areaCode}-${r.typeCode}-${r.kind}`}
              className="flex flex-wrap items-baseline gap-x-2"
              data-jma-row={r.warning ? "warning" : "advisory"}
            >
              <span className={r.warning ? "font-bold" : ""}>{r.kind}</span>
              <span>{r.areaName}</span>
              <span className="text-xs text-muted">{r.status}</span>
              <span className="text-xs text-muted tabular-nums">
                {shortJst(r.issuedAt)} {r.officeName}
              </span>
              <span className="ml-auto text-xs tabular-nums" data-jma-people={r.people}>
                {JMA_LABELS.matched} <span className="text-sm font-bold">{r.people}</span> 人
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.quakes.length > 0 && (
        <ul className="grid gap-0.5">
          {data.quakes.map((q) => (
            <li key={q.eventId} className="flex flex-wrap items-baseline gap-x-2" data-jma-quake>
              <span className="font-bold">{JMA_LABELS.quake}</span>
              <span className="text-xs text-muted tabular-nums">{shortJst(q.at)}</span>
              {q.hypocenter && <span>{q.hypocenter}</span>}
              <span className="tabular-nums">{magnitudeLabel(q.magnitude)}</span>
              {q.cities.map((c) => (
                <span key={c.city} className="tabular-nums">
                  {c.city} {intensityLabel(c.intensity)}
                  <span className="text-xs text-muted">（{c.point}）</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}

      {data.noCity > 0 && (
        <p className="text-xs text-muted tabular-nums" data-jma-no-city>
          {JMA_LABELS.noCity} {data.noCity} 人
        </p>
      )}

      <p className="text-[11px] leading-4 text-muted" data-jma-source>
        {source.before}
        <a
          href={WARNING_SOURCE.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${WARNING_SOURCE.link} ${JMA_LABELS.external}`}
          data-press
          className={`inline-flex items-baseline gap-0.5 underline underline-offset-2 ${FOCUS}`}
        >
          {WARNING_SOURCE.link}
          <ExternalIcon aria-hidden className="size-3 shrink-0 self-center" />
        </a>
        {source.after}
      </p>
    </section>
  );
}
