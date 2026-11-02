// 市町村への安否報告の下書き（発災時）。表の上の帯。所在の内訳と、決まった形の文（コピーできる）。
// 色ごとの人数は画面の見出しの行にあるので、ここでは所在だけを数で出す。
// 文は lib/forms/form9-report.ts が作る（Claude は呼ばない）。

import { LOCATION_LABELS, type Form9Location } from "@/lib/forms/form9";
import type { Form9Tally } from "@/lib/forms/form9-report";
import { CopyButton } from "./CopyButton";

const LOCATIONS: ReadonlyArray<Form9Location> = ["home", "shelter", "other", "transported", "unknown"];
const TEXT_ID = "form9-report-text";

export function Form9Report({ text, tally }: { text: string; tally: Form9Tally }) {
  return (
    <section aria-labelledby="form9-report-title" className="rounded-lg bg-panel p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="form9-report-title" className="font-bold">
          報告下書き
        </h2>
        <dl className="flex flex-wrap gap-x-3 text-sm">
          {LOCATIONS.map((loc) => (
            <div key={loc} className="flex items-baseline gap-1">
              <dt className="text-muted">{LOCATION_LABELS[loc]}</dt>
              <dd className="font-bold tabular-nums">{tally.locations[loc]}</dd>
            </div>
          ))}
        </dl>
        {tally.shelters.length > 0 && (
          <span className="text-xs text-muted">{tally.shelters.map((s) => `${s.name} ${s.count}`).join("・")}</span>
        )}
        <span className="ml-auto">
          <CopyButton text={text} targetId={TEXT_ID} />
        </span>
      </div>
      <textarea
        id={TEXT_ID}
        readOnly
        value={text}
        rows={7}
        className="mt-2 w-full resize-y rounded-md bg-panel2 p-2 text-xs leading-relaxed text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent"
        aria-label="報告の文"
      />
    </section>
  );
}
