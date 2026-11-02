// 市町村への安否報告の下書き（発災時）。表の上の帯。所在の内訳と、決まった形の文（コピーできる。文は欄の中で送らず全部出す、T38）。
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
      {/* 文は全部を出す（欄の中で送らない。画面全体の縦 1 本だけで読む）。段（空の行で区切った塊）ごとに、広い画面は 2〜3 列に並べて
          背を低くする（段の途中で列を割らない）。手で写すときはこの箱を選ぶ（コピーできないときは自動で選ぶ） */}
      <div
        id={TEXT_ID}
        role="region"
        aria-label="報告の文"
        className="mt-2 gap-x-6 rounded bg-panel2 p-2 text-xs leading-relaxed select-text md:columns-2 xl:columns-3"
      >
        {text.split(/\n{2,}/).map((block, i) => (
          <p key={i} className="break-inside-avoid pb-2 break-words whitespace-pre-wrap last:pb-0">
            {block}
          </p>
        ))}
      </div>
    </section>
  );
}
