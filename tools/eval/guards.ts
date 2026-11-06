// 評価の台の守り（T157）。直した物が次の回で戻らないように、受け入れの確かめ（数で言える物）を台の確かめに足す表。
// 各台の報告（drill の run.ts・forms の cli.ts・talk の run.ts）が回の数（tools/eval/scorecard-items.ts の valuesOf）と
// 同じ原因の指摘の数（`count:<cause>`）で確かめ、外れた物を重さ「重」の指摘（rule guard:<id>）にして findings.json に足す。
// 点数の表（tools/eval/scorecard.ts）も、守りの項目をしきい値と同じに見る（外れたら「（外）」）。
//
// 足し方（docs/progress/t157.md の「守りの足し方」）: 下書き（npm run eval:drafts）の「受け入れの確かめ」の行を写し、
// id（台-何-どうなるか）・since（守りを始めた回）・task（直した作業）・label（守る事の短い言葉）を書く。value は直したあとの回の数。

import { findingId, meets, type Accept, type Bench, type Finding } from "./findings.ts";

export type Guard = Accept & {
  id: string;
  bench: Bench;
  /** 守りを始めた回（直したあとの最初の回） */
  since: string;
  /** 直した作業 */
  task: string;
  /** 守る事（短く） */
  label: string;
  /** 戻ったときに疑うファイル */
  suspects?: string[];
};

export const GUARDS: ReadonlyArray<Guard> = [
  // 見本（T157）: 評価の 4 回目で本人役の言葉が 60 字で文の途中で切れた（27/164）のを T139 で直し、5 回目で 0/65 になった。戻ったら外れる
  {
    id: "drill-cut-none",
    bench: "drill",
    item: "drill.cut",
    op: "<=",
    value: 0,
    since: "r5",
    task: "T139",
    label: "本人役の言葉が文の途中で終わらない",
    suspects: ["lib/drill/persona.ts", "lib/drill/clip.ts"],
  },
  // T158: 評価の 6 回目で、予備で動いているのに残りの数を予備と言わない言葉が 4（r6 の記録に今の台を当てた数）。門が「予備の」を足すので画面の言葉では 0
  {
    id: "drill-spare-said",
    bench: "drill",
    item: "count:drill:facts:spare_unsaid",
    op: "<=",
    value: 0,
    since: "r7",
    task: "T158",
    label: "予備で動いている残りの数を予備と言わずに出さない",
    suspects: ["lib/drill/person-facts.ts"],
  },
  // T158: 家に置いてきた栄養剤の残りの時間を言う言葉が 1。門が落とすので画面の言葉では 0
  {
    id: "drill-left-remain-none",
    bench: "drill",
    item: "count:drill:facts:left_remain",
    op: "<=",
    value: 0,
    since: "r7",
    task: "T158",
    label: "家に置いてきた栄養剤の残りの時間を言わない",
    suspects: ["lib/drill/person-facts.ts", "lib/drill/persona.ts"],
  },
];

/** 守りの確かめ。values は回の項目の数、counts は同じ原因の指摘の数（causeCounts）。数の無い項目は確かめない */
export function guardFindings(args: {
  bench: Bench;
  run: string;
  values: Readonly<Record<string, number>>;
  counts: Readonly<Record<string, number>>;
  repro: string[];
  guards?: ReadonlyArray<Guard>;
}): Finding[] {
  const out: Finding[] = [];
  for (const g of args.guards ?? GUARDS) {
    if (g.bench !== args.bench) continue;
    const v = g.item.startsWith("count:") ? (args.counts[g.item.slice("count:".length)] ?? 0) : args.values[g.item];
    if (v === undefined || meets(v, g.op, g.value)) continue;
    const cause = `guard:${g.id}`;
    out.push({
      id: findingId(cause),
      bench: g.bench,
      cause,
      rule: cause,
      title: `守りが外れた: ${g.label}（${g.task} で直した物）`,
      where: { file: `${g.item} ${g.op} ${g.value}、今 ${Math.round(v * 1000) / 1000}` },
      severity: "high",
      count: 1,
      repro: args.repro,
      suspects: g.suspects ?? [],
      accept: { item: g.item, op: g.op, value: g.value },
      firstSeen: args.run,
    });
  }
  return out;
}

/** 項目の守り（点数の表のしきい値と一緒に見る） */
export function guardsOn(item: string, guards: ReadonlyArray<Guard> = GUARDS): Guard[] {
  return guards.filter((g) => g.item === item);
}
