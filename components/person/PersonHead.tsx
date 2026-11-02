// 本人のページの上。大事な物を大きく: 優先と理由、医療の印、時計の残り、緊急連絡先。
// その上の 1 行に 名前・年齢・介護度・計画・未確認。
// 優先は平時が骨格の段（色は時計の長さ。医療の印と同じ）、発災時（T09 で災害モードを入れたとき）は色と言葉と理由の 1 行。
// 見る人の範囲（head.show、lib/consent/scope.ts）の外の物は欄ごと出さない（医療班・行政に同意の無い人は名前・カナ・年齢と状態の色だけ）。

import type { PersonHead as Head } from "@/lib/person";
import { BLANK_LABELS, HEAD_LABELS } from "@/lib/labels";
import { Mark } from "@/components/ui/Tag";
import { LineText, StateTag, TONE_TEXT, type Level } from "./parts";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 上の 4 つの面の中の枠 */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-panel2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

/** 発災時の上の細い帯（ルールの表の色）。面全体は塗らない */
const BAND: Record<string, string> = {
  urgent: "bg-state-urgent-fill",
  check: "bg-state-check-fill",
  unknown: "bg-state-unknown-fill",
  ok: "bg-state-ok-fill",
};

export function PersonHead({ head, level, titleId }: { head: Head; level: Level; titleId: string }) {
  const H = level === 1 ? "h1" : "h2";
  const p = head.priority;
  const { show } = head;
  // 優先: 医療が範囲にあれば骨格の段か色と理由。範囲の外でも発災時の色と言葉は出す（理由は空）
  const priority = show.medical || p.kind === "triage";
  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-lg bg-panel">
      {p.kind === "triage" && <div className={`h-1 ${BAND[p.tone]}`} aria-hidden="true" />}
      <div className="p-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <H id={titleId} className="text-xl leading-8 font-bold">
            {head.name}
          </H>
          <span className="text-sm text-muted">{head.kana}</span>
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <Fact label={HEAD_LABELS.age}>
              {head.age === null ? <span className="text-muted">{BLANK_LABELS.unconfirmed}</span> : <span className="tabular-nums">{head.age} 歳</span>}
            </Fact>
            {show.medical && (
              <Fact label={HEAD_LABELS.careLevel}>{head.careLevel ?? <span className="text-muted">{BLANK_LABELS.unconfirmed}</span>}</Fact>
            )}
            {show.plan && <Fact label={HEAD_LABELS.plan}>{head.plan}</Fact>}
            {show.plan && (
              <Fact label={HEAD_LABELS.unconfirmed}>
                <span
                  className={`tabular-nums ${head.unconfirmed > 0 ? `font-bold ${TONE_TEXT.check}` : "text-muted"}`}
                  data-tone={head.unconfirmed > 0 ? "check" : undefined}
                >
                  {head.unconfirmed}
                </span>
              </Fact>
            )}
          </dl>
        </div>

        {(priority || show.medical || show.people) && (
          <div className="mt-2 grid gap-2 @2xl:grid-cols-2 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.4fr)]">
            {priority && (
              <Cell label={HEAD_LABELS.priority}>
                {p.kind === "tier" ? (
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl leading-none font-bold tabular-nums ${p.tone ? TONE_TEXT[p.tone] : ""}`} data-tone={p.tone ?? undefined}>
                      {p.tier}
                    </span>
                    <span className="text-sm">{p.label}</span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <StateTag tone={p.tone} size="md">{p.label}</StateTag>
                    {p.reason && <p className={`text-sm font-bold ${TONE_TEXT[p.tone]}`}>{p.reason}</p>}
                  </div>
                )}
              </Cell>
            )}
            {show.medical && (
              <Cell label={HEAD_LABELS.marks}>
                {head.marks.length === 0 ? (
                  <span className="text-sm text-muted">{BLANK_LABELS.none}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {/* 医療の印は地を塗らず、時計の長さの色は印に（塗りの印は優先の状態だけ）。項目名に時計のいちばん短い残り（「酸素 4h」）。
                        残りの無い項目（走らない時計・値の無い時計）は項目名だけ */}
                    {head.marks.map((m) => (
                      <Mark key={m.label} inPanel2 size="md" tone={m.tone ?? null}>
                        {m.remaining ? `${m.label} ${m.remaining}` : m.label}
                      </Mark>
                    ))}
                  </span>
                )}
              </Cell>
            )}
            {show.medical && (
              <Cell label={HEAD_LABELS.clocks}>
                {head.clocks.length === 0 ? (
                  <span className="text-sm text-muted">{BLANK_LABELS.none}</span>
                ) : (
                  <ul className="space-y-0.5">
                    {head.clocks.map((k) => (
                      <li key={k.id} className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-sm">{k.label}</span>
                        {k.value ? (
                          <span className={`font-bold tabular-nums ${k.tone ? TONE_TEXT[k.tone] : ""}`} data-tone={k.tone ?? undefined}>
                            {k.value}
                          </span>
                        ) : (
                          <span className="text-sm text-muted">{BLANK_LABELS.unconfirmed}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Cell>
            )}
            {show.people && (
              <Cell label={HEAD_LABELS.emergency}>
                {head.emergency.length === 0 ? (
                  <span className="text-sm text-muted">{BLANK_LABELS.none}</span>
                ) : (
                  <div className="space-y-0.5 text-sm">
                    {head.emergency.map((line, i) => (
                      <LineText key={i} line={line} />
                    ))}
                  </div>
                )}
              </Cell>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
