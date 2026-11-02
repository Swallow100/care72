// 本人のページの上: 名前・年齢・介護度・医療の印・優先・計画・未確認。
// 優先は平時が骨格の段（色は時計の長さ。医療の印と同じ）、発災時（T09 で災害モードを入れたとき）は色と言葉と理由の 1 行。

import type { PersonHead as Head } from "@/lib/person";
import { StateTag, TONE_TEXT, type Level } from "./parts";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd>{children}</dd>
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
      <div className="p-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <H id={titleId} className="text-2xl font-bold">
            {head.name}
          </H>
          <span className="text-muted">{head.kana}</span>
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <Fact label="年齢">
            {head.age === null ? <span className="text-muted">未確認</span> : <span className="tabular-nums">{head.age} 歳</span>}
          </Fact>
          <Fact label="介護度">{head.careLevel ?? <span className="text-muted">未確認</span>}</Fact>
          <Fact label="医療">
            {head.marks.length === 0 ? (
              <span className="text-muted">なし</span>
            ) : (
              <span className="inline-flex flex-wrap gap-1">
                {head.marks.map((m) =>
                  m.tone ? (
                    <StateTag key={m.label} tone={m.tone}>
                      {m.label}
                    </StateTag>
                  ) : (
                    <span key={m.label} className="rounded bg-panel2 px-1.5 py-0.5 text-sm">
                      {m.label}
                    </span>
                  ),
                )}
              </span>
            )}
          </Fact>
          <Fact label="優先">
            {p.kind === "tier" ? (
              <span className="inline-flex items-baseline gap-2">
                <span className={`text-lg font-bold tabular-nums ${p.tone ? TONE_TEXT[p.tone] : ""}`} data-tone={p.tone ?? undefined}>
                  {p.tier}
                </span>
                <span className="text-sm text-muted">{p.label}</span>
              </span>
            ) : (
              <StateTag tone={p.tone}>{p.label}</StateTag>
            )}
          </Fact>
          <Fact label="計画">{head.plan}</Fact>
          <Fact label="未確認">
            <span
              className={`tabular-nums ${head.unconfirmed > 0 ? `font-bold ${TONE_TEXT.check}` : "text-muted"}`}
              data-tone={head.unconfirmed > 0 ? "check" : undefined}
            >
              {head.unconfirmed}
            </span>
          </Fact>
        </dl>
        {p.kind === "triage" && <p className={`mt-3 font-bold ${TONE_TEXT[p.tone]}`}>{p.reason}</p>}
      </div>
    </section>
  );
}
