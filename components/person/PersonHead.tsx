// 本人のページの上。大事な物を大きく: 優先と理由、医療の印、時計の残り、緊急連絡先。
// その上の 1 行に 名前・年齢・介護度・計画・未確認。
// 優先は平時が骨格の段（色は時計の長さ。医療の印と同じ）、発災時（T09 で災害モードを入れたとき）は色と言葉と理由の 1 行。

import type { PersonHead as Head } from "@/lib/person";
import { BLANK_LABELS, HEAD_LABELS } from "@/lib/labels";
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
  urgent: "bg-state-urgent",
  check: "bg-state-check",
  unknown: "bg-state-unknown",
  ok: "bg-state-ok",
};

export function PersonHead({ head, level, titleId }: { head: Head; level: Level; titleId: string }) {
  const H = level === 1 ? "h1" : "h2";
  const p = head.priority;
  return (
    <section aria-labelledby={titleId} className="overflow-hidden rounded-lg bg-panel">
      {p.kind === "triage" && <div className={`h-1 ${BAND[p.tone]}`} aria-hidden="true" />}
      <div className="p-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <H id={titleId} className="text-xl font-bold">
            {head.name}
          </H>
          <span className="text-sm text-muted">{head.kana}</span>
          <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <Fact label={HEAD_LABELS.age}>
              {head.age === null ? <span className="text-muted">{BLANK_LABELS.unconfirmed}</span> : <span className="tabular-nums">{head.age} 歳</span>}
            </Fact>
            <Fact label={HEAD_LABELS.careLevel}>{head.careLevel ?? <span className="text-muted">{BLANK_LABELS.unconfirmed}</span>}</Fact>
            <Fact label={HEAD_LABELS.plan}>{head.plan}</Fact>
            <Fact label={HEAD_LABELS.unconfirmed}>
              <span
                className={`tabular-nums ${head.unconfirmed > 0 ? `font-bold ${TONE_TEXT.check}` : "text-muted"}`}
                data-tone={head.unconfirmed > 0 ? "check" : undefined}
              >
                {head.unconfirmed}
              </span>
            </Fact>
          </dl>
        </div>

        <div className="mt-2 grid gap-2 @2xl:grid-cols-2 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1.4fr)]">
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
                <p className={`text-sm font-bold ${TONE_TEXT[p.tone]}`}>{p.reason}</p>
              </div>
            )}
          </Cell>
          <Cell label={HEAD_LABELS.marks}>
            {head.marks.length === 0 ? (
              <span className="text-sm text-muted">{BLANK_LABELS.none}</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {head.marks.map((m) =>
                  m.tone ? (
                    <StateTag key={m.label} tone={m.tone} size="md">
                      {m.label}
                    </StateTag>
                  ) : (
                    <span key={m.label} className="rounded bg-panel px-1.5 py-0.5 text-sm">
                      {m.label}
                    </span>
                  ),
                )}
              </span>
            )}
          </Cell>
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
        </div>
      </div>
    </section>
  );
}
