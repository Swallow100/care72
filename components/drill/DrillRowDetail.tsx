// 訓練の左の表の行の下に開く詳細（担当一覧の行の詳細と同じ中身の並べ方）。中身は lib/list/detail.ts の buildRowDetail が作った物。
// 訓練では本番の電話の記録・優先の上書き（本人の経過に書く部品）を出さない。電話・出向くなどの手は T20 の「対応」。
// 連絡先は名前と続柄だけ（訓練の画面から本物の番号にかけない）。安否の時刻は訓練の経過で出す。
// 本人役（T18、Claude）が作った安否には AI の印（aiSignals は lib/drill/view.ts の DrillScreen から）。
// ケアマネが通話・訪問で聞いた安否（T21）は「通話」「訪問」と添える（人が聞いた結果なので AI の印なし。「確認済」は緑の理由だけ）。
// 本人役の赤（本人の言う事つき）は、言う事を声にした物を「録音」として置く（発災時の録音と同じ場所。T21、声は AI の音声）。

import { AiMark, StateTag, TONE_TEXT } from "@/components/person/parts";
import { CALL_UI, DRILL_LABELS } from "@/lib/drill/labels";
import { COLOR_LABELS } from "@/lib/labels";
import type { RowDetail } from "@/lib/list/detail";
import { DETAIL_LABELS } from "@/lib/list/labels";

const HOUR_MS = 3_600_000;

export function DrillRowDetail({
  detail: d,
  startedAt,
  aiSignals = [],
  heard = {},
  recordings = {},
}: {
  detail: RowDetail;
  startedAt: string;
  aiSignals?: ReadonlyArray<string>;
  /** ケアマネが通話・訪問で聞いた安否の id → 通話か訪問か */
  heard?: Readonly<Record<string, "call" | "visit">>;
  /** 本人の赤の言う事の声（安否の id → 声の行き先）。声を作れなければ空で文字だけ */
  recordings?: Readonly<Record<string, string>>;
}) {
  const ai = new Set(aiSignals);
  const hourOf = (iso: string) => Math.round(((Date.parse(iso) - Date.parse(startedAt)) / HOUR_MS) * 10) / 10;
  return (
    <div className="@container space-y-2 text-sm" data-detail-of={d.personId}>
      <div className="flex flex-wrap items-baseline gap-x-3 pt-1">
        <span className="text-xs text-muted">{DETAIL_LABELS.reason}</span>
        <span className={`text-[15px] font-bold ${TONE_TEXT[d.tone]}`} data-reason>
          {d.reason}
        </span>
      </div>
      {/* 表の幅で並べる（圧縮した表は 2 列、広げた表は 3 列） */}
      <div className="grid gap-2 @sm:grid-cols-2 @3xl:grid-cols-3">
        <div className="space-y-2">
          <Part title={DETAIL_LABELS.contacts}>
            {d.contacts.length === 0 ? (
              <p className="text-muted">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-0.5">
                {d.contacts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-1.5">
                    <span className="text-xs text-muted">{c.kindLabel}</span>
                    {c.name && <span className="font-bold">{c.name}</span>}
                    {c.relation && <span className="text-xs text-muted">{c.relation}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Part>
          <Part title={DETAIL_LABELS.supporters}>
            {d.supporters.length === 0 ? (
              <p className="font-bold tone-check">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-0.5">
                {d.supporters.map((s) => (
                  <li key={`${s.order}-${s.name}`} className="flex flex-wrap gap-x-1.5">
                    <span className="text-xs text-muted tabular-nums">{s.order}</span>
                    <span className="font-bold">{s.name}</span>
                    <span className="text-xs text-muted">{s.parts.join("・")}</span>
                  </li>
                ))}
              </ul>
            )}
          </Part>
        </div>
        <div className="space-y-2">
          <Part title={DETAIL_LABELS.clocks}>
            {d.clocks.length === 0 ? (
              <p className="text-muted">{DETAIL_LABELS.none}</p>
            ) : (
              <ul className="space-y-1">
                {d.clocks.map((k) => (
                  <li key={k.id} className="flex flex-wrap items-baseline gap-x-2" data-clock={k.id}>
                    <span className="font-bold">{k.label}</span>
                    {k.remaining ? (
                      <span className={`font-bold tabular-nums ${k.tone ? TONE_TEXT[k.tone] : "text-muted"}`}>{k.remaining}</span>
                    ) : (
                      <span className="text-muted">{k.length ? null : DETAIL_LABELS.unconfirmed}</span>
                    )}
                    <span className="text-xs text-muted">
                      {k.kindLabel} {k.length ?? DETAIL_LABELS.unconfirmed} {k.start}
                    </span>
                    {k.depends && (
                      <span className={`text-xs ${k.depends.unchecked ? "font-bold tone-check" : "text-muted"}`}>
                        {k.depends.on} {k.depends.check}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Part>
          <Part title={DETAIL_LABELS.destinations}>
            <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-2 gap-y-0.5">
              <dt className="text-xs text-muted">1</dt>
              <dd>{d.destinations.first ?? <span className="text-muted">{DETAIL_LABELS.unconfirmed}</span>}</dd>
              <dt className="text-xs text-muted">2</dt>
              <dd>{d.destinations.second ?? <span className="text-muted">{DETAIL_LABELS.unconfirmed}</span>}</dd>
              <dt className="text-xs text-muted">{DETAIL_LABELS.transport}</dt>
              <dd>{d.destinations.transport ?? <span className="text-muted">{DETAIL_LABELS.unconfirmed}</span>}</dd>
            </dl>
          </Part>
        </div>
        <Part title={DETAIL_LABELS.signals}>
          {d.signals.length === 0 ? (
            <p className="text-muted">{DETAIL_LABELS.noContact}</p>
          ) : (
            <ul className="space-y-1.5">
              {d.signals.map((s) => (
                <li key={s.id} data-signal={s.id}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-xs text-muted tabular-nums">
                      {hourOf(s.at)} {DRILL_LABELS.hours}
                    </span>
                    <span className="text-xs text-muted">{s.source}</span>
                    {heard[s.id] && (
                      <span className="text-xs font-bold" data-heard={heard[s.id]}>
                        {heard[s.id] === "visit" ? CALL_UI.heardVisit : CALL_UI.heardCall}
                      </span>
                    )}
                    {ai.has(s.id) && <AiMark small />}
                    <StateTag tone={s.tone}>
                      {s.color === "red" ? COLOR_LABELS.red : s.color === "green" ? COLOR_LABELS.green : COLOR_LABELS.gray}
                    </StateTag>
                    <span>{s.body}</span>
                  </div>
                  {recordings[s.id] && (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-muted">{CALL_UI.recording}</span>
                      <AiMark small title="AI の音声（Gemini TTS）" />
                      <audio controls preload="none" src={recordings[s.id]} className="h-8 min-w-0 flex-1" data-recording={s.id} />
                    </div>
                  )}
                  {s.transcript && <p className="mt-0.5">「{s.transcript}」</p>}
                </li>
              ))}
            </ul>
          )}
        </Part>
      </div>
    </div>
  );
}

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md bg-panel2 p-2">
      <h3 className="mb-1 text-[0.8125rem] font-bold">{title}</h3>
      {children}
    </section>
  );
}
