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
  // T161: 評価の 6 回目で岐阜市の一覧の様式（4 頁）の共有の対応表ができず、2 つ目の事業所が AI を呼び直した（頁の組の鍵が 3 頁まで）。
  // 1 つ目に読めない頁があり共有に入れなかった物は数えない（tools/eval/scorecard-items.ts の sharedMissOf）
  {
    id: "forms-shared-copied",
    bench: "forms",
    item: "forms.sharedMiss",
    op: "<=",
    value: 0,
    since: "r7",
    task: "T161",
    label: "一覧の様式の対応表を別の事業所が AI を呼ばずに写す",
    suspects: ["lib/forms/shared-mapping.ts", "lib/forms/read-post.ts"],
  },
  // 評価の 6 回目で本人役の普通の言い方（続柄＋の＋語尾まで含めたかな）が画面に（氏名）で出た（1 件）のを T159 で直した。戻ったら外れる
  {
    id: "drill-overmask-none",
    bench: "drill",
    item: "drill.overmask",
    op: "<=",
    value: 0,
    since: "r7",
    task: "T159",
    label: "画面の（氏名）が名前の無い所に出ない",
    suspects: ["lib/pseudonym/forms.ts", "lib/pseudonym/index.ts"],
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
