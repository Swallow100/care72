// 医療要約の画面の右に置く「原本」（画面だけ。紙に出さない）。要約は台帳の値を災害診療記録 2018 の順に並べ替えた物なので、
// 元の台帳（本人のページの 基本・医療・避難・人 の区分）を同じ画面に並べ、医療班・ケアマネが見比べられるようにする
// （アドバイザーの返事 docs/DECISIONS.md 11/3 14:1x の (3)）。中身は本人のページと同じ物で、見る人の範囲（lib/consent/scope.ts）のまま。

import { PersonView } from "@/components/person/PersonView";
import type { PersonView as View, SectionId } from "@/lib/person";

/** 要約の元になる区分（同意・書類・経過は出さない） */
const SOURCE_SECTIONS: readonly SectionId[] = ["basic", "medical", "people", "evacuation"];

export function MedicalSource({ view }: { view: View }) {
  const sections = view.sections.filter((s) => SOURCE_SECTIONS.includes(s.id));
  return (
    <aside className="screen-only text-sm" aria-labelledby="medical-source-title" data-medical-source>
      <h2 id="medical-source-title" className="mb-1.5 px-1 text-[1rem] leading-6 font-bold">
        原本
      </h2>
      <PersonView view={{ ...view, sections, writes: [] }} level={2} />
    </aside>
  );
}
