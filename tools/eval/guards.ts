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
  // T162: 使う側の模擬の 1 回目（persona r1）で迷った画面。直したあとの回の数はまだ無いので、次の本物の回（r2）から 0 を守る
  {
    id: "persona-plan-print-dead-end",
    bench: "persona",
    item: "count:persona:dead_end:/people/[id]/forms/matsuyama",
    op: "<=",
    value: 0,
    since: "r2",
    task: "T162",
    label: "計画書の印刷を押して何も変わらないと読まれない",
    suspects: ["components/ui/PrintButton.tsx", "lib/forms/print.ts", "components/forms/paper.css"],
  },
  {
    id: "persona-drill-dead-end",
    bench: "persona",
    item: "count:persona:dead_end:/drill/[id]",
    op: "<=",
    value: 0,
    since: "r2",
    task: "T162",
    label: "訓練の着信の窓と次までで行き止まらない",
    suspects: ["components/drill/IncomingCall.tsx", "components/drill/DrillControls.tsx"],
  },
  {
    id: "persona-form9-misread",
    bench: "persona",
    item: "count:persona:misread:/forms/batch",
    op: "<=",
    value: 0,
    since: "r2",
    task: "T162",
    label: "一括印刷で押した物と違う書類を開かない",
    suspects: ["components/forms/DocumentList.tsx"],
  },
  {
    id: "persona-assign-dead-end",
    bench: "persona",
    item: "count:persona:dead_end:/office",
    op: "<=",
    value: 0,
    since: "r2",
    task: "T162",
    label: "担当の変更で移す先を選べる",
    suspects: ["components/office/AssignForm.tsx", "components/ui/Select.tsx", "tools/eval/persona/surface.ts"],
  },
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
  // 使う側の模擬（T156）: 手元の種の頁に、架空の形でない電話・種でない事業所が出たら筋を止める門（tools/eval/persona/guard.ts）。0 のはず
  {
    id: "persona-gate-none",
    bench: "persona",
    item: "persona.gate",
    op: "<=",
    value: 0,
    since: "r6",
    task: "T156",
    label: "使う人の AI に種の外の値の頁を渡さない",
    suspects: ["tools/eval/persona/guard.ts", "seed/people.ts"],
  },
  // T163: 使う側の模擬の 1 回目で医療班の筋が受け入れに届かなかった（訓練の外に受入依頼の道が無く、受入一覧 0 人）。
  // 発災開始の種の受入依頼と依頼の行の「受入」を足した。医療班の筋の受け入れの目標が届かなければ外れる
  {
    id: "persona-medical-receive",
    bench: "persona",
    item: "count:persona:unreached:medical.receive",
    op: "<=",
    value: 0,
    since: "r8",
    task: "T163",
    label: "医療班の筋で受入依頼から受け入れられる",
    suspects: ["components/staff/StaffRequests.tsx", "lib/custody/requests.ts", "lib/seed/requests.ts", "app/staff/page.tsx"],
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
  // T165: 評価の 7 回目で、本人役の言葉に訓練の裏側の言葉（問いの途中で止まった）・前に替えた予備をまた替えたと言う言葉・
  // 済んでいない予定（119 へ掛ける）の言い直しが出た。どれも門が落とすので画面の言葉では 0
  {
    id: "drill-backstage-none",
    bench: "drill",
    item: "count:drill:facts:backstage",
    op: "<=",
    value: 0,
    since: "r8",
    task: "T165",
    label: "本人役の言葉に訓練の裏側の言葉を出さない",
    suspects: ["lib/drill/person-facts.ts", "lib/drill/persona.ts", "lib/drill/scenarios.ts"],
  },
  {
    id: "drill-swap-news-none",
    bench: "drill",
    item: "count:drill:facts:swap_news",
    op: "<=",
    value: 0,
    since: "r8",
    task: "T165",
    label: "前に替えた予備をまた替えたと言わない",
    suspects: ["lib/drill/person-facts.ts"],
  },
  {
    id: "drill-repeat-intent-none",
    bench: "drill",
    item: "count:drill:facts:repeat_intent",
    op: "<=",
    value: 0,
    since: "r8",
    task: "T165",
    label: "済んでいない予定を新しく言い直さない",
    suspects: ["lib/drill/person-facts.ts", "lib/drill/engine.ts"],
  },
  // T160: 評価の 6 回目（書類）の日付の欄・選ぶ欄・連絡先。値は 6 回目の記録の数え直し（17 様式 × 入力 55）で直したあとの数。
  // 日付の要修正 165 → 0、連絡先の置けず 84 → 0。置けない日付 110 → 55 の残りは時津町の刷ってある記号（△△年□月◇◇日）の上に書く形で、
  // 記号に重ねないので空けるのが答え。当てたのに紙に出ない選択肢 24 は、災害診療記録の性別（女性の 2 つの選択肢）が台帳の値で決まらない物と吹田市の避難の手段の添えの 1 枚
  { id: "forms-date-fix-none", bench: "forms", item: "forms.dateFix", op: "<=", value: 0, since: "r7", task: "T160", label: "日付の欄に要修正を出さない", suspects: ["lib/forms/split-parts.ts", "lib/forms/overlay-sheet.ts", "lib/forms/mapped-sheet.ts"] },
  { id: "forms-contact-placed", bench: "forms", item: "forms.unplacedContact", op: "<=", value: 0, since: "r7", task: "T160", label: "緊急連絡先・支援者の欄を置けなくしない", suspects: ["lib/forms/overlay-sheet.ts", "lib/forms/mapped-sheet.ts"] },
  { id: "forms-date-unplaced", bench: "forms", item: "forms.unplacedDate", op: "<=", value: 55, since: "r7", task: "T160", label: "置けない日付を増やさない", suspects: ["lib/forms/split-parts.ts", "lib/forms/overlay-sheet.ts"] },
  { id: "forms-option-picked", bench: "forms", item: "forms.unplacedPicked", op: "<=", value: 24, since: "r7", task: "T160", label: "当てた選択肢を紙に出さない数を増やさない", suspects: ["lib/forms/option-values.ts", "lib/forms/mapped-sheet.ts", "lib/forms/overlay-sheet.ts", "lib/forms/form-shape.ts"] },
  // T164: 評価の 7 回目で、□・選択肢の後ろの括弧を親と同じ項目の字の欄に読んだ様式で、括弧に項目の値を丸ごと書き（災害診療記録の常用薬の括弧に
  // 薬の全部や「なし」）、親の選ぶ欄の添えが置けなかった（当てたのに紙に出ない選択肢 57、置き間違い 348）。括弧の子の欄の直しで、7 回目の記録の
  // 数え直しは当てたのに紙に出ない選択肢 23・正解に無い印 0。置き間違いは 6 回目（195）より増やさない
  { id: "forms-mark-extra-none", bench: "forms", item: "forms.markExtra", op: "<=", value: 0, since: "r8", task: "T164", label: "台帳に無い選択肢に印を付けない", suspects: ["lib/forms/option-values.ts", "lib/forms/mapped-sheet.ts"] },
  { id: "forms-paper-wrong", bench: "forms", item: "forms.paperWrong", op: "<=", value: 195, since: "r8", task: "T164", label: "紙の置き間違いを 6 回目より増やさない", suspects: ["lib/forms/mapped-sheet.ts", "lib/forms/overlay-sheet.ts", "lib/forms/form-shape.ts"] },
  // T166: 使う側の模擬の 2 回目で迷った所。数は直した形の値で、本物の回はまだ（docs/progress/t166.md）
  { id: "persona-medical-role", bench: "persona", item: "count:persona:unreached:medical.role", op: "<=", value: 0, since: "r9", task: "T166", label: "医療班の筋で医療班の役に入れる", suspects: ["components/person/RequestSection.tsx", "components/ui/RoleMenu.tsx", "tools/eval/persona/surface.ts"] },
  { id: "persona-medical-note", bench: "persona", item: "count:persona:unreached:medical.note", op: "<=", value: 0, since: "r9", task: "T166", label: "医療班の筋が記録の追記まで行く", suspects: ["app/staff/page.tsx", "components/staff/StaffRequests.tsx", "tools/eval/persona/surface.ts"] },
  { id: "persona-ledger-not-found", bench: "persona", item: "count:persona:not_found:/", op: "<=", value: 2, since: "r9", task: "T166", label: "編集の面の目次と保存で迷わない", suspects: ["components/person/SectionEdit.tsx", "lib/labels.ts"] },
  { id: "persona-auto-reached", bench: "persona", item: "count:persona:unreached:judge10.auto", op: "<=", value: 0, since: "r9", task: "T166", label: "鳴っている着信があっても自動進行を押せる", suspects: ["components/drill/IncomingCall.tsx", "components/drill/DrillControls.tsx"] },
  { id: "persona-first-disaster", bench: "persona", item: "count:persona:unreached:first.disaster", op: "<=", value: 0, since: "r9", task: "T166", label: "訓練の画面から事業所の発災開始に着ける", suspects: ["app/drill/[id]/page.tsx", "lib/drill/labels.ts", "app/office/page.tsx"] },
  { id: "persona-office-exit", bench: "persona", item: "count:persona:back:/bosai/warning/", op: "<=", value: 0, since: "r9", task: "T166", label: "気象庁の出典を押してアプリの外へ出ない", suspects: ["components/office/JmaAlertsView.tsx", "lib/jma/labels.ts"] },
  { id: "persona-admin-reset", bench: "persona", item: "count:persona:unreached:admin.reset", op: "<=", value: 0, since: "r9", task: "T166", label: "管理者が最初に戻すに着ける", suspects: ["app/office/page.tsx", "components/ui/PrintButton.tsx", "lib/ui/labels.ts"] },
  { id: "persona-form9-preview-misread", bench: "persona", item: "count:persona:misread:/office/form9", op: "<=", value: 0, since: "r9", task: "T166", label: "様式 9 の見本の帯をデータを戻す物と読まない", suspects: ["components/ui/PrintButton.tsx", "lib/ui/labels.ts"] },
  // T169: 右の面の見直し・未確認と、飛んだ先の紫の案内。数は直した形の値で、本物の回はまだ（docs/progress/t169.md）。全部の未確認の欄で飛べることは lib/intake/t169.test.ts が見る
  { id: "persona-veteran-person", bench: "persona", item: "count:persona:unreached:veteran.person", op: "<=", value: 0, since: "r9", task: "T169", label: "本人のページの未確認の項目に着ける", suspects: ["components/list/SidePane.tsx", "lib/map/side.ts", "lib/intake/targets.ts"] },
  { id: "persona-list-dead-end", bench: "persona", item: "count:persona:dead_end:/", op: "<=", value: 0, since: "r9", task: "T169", label: "見直し・未確認の行と未確認の印から飛んで行き止まらない", suspects: ["components/person/TargetLink.tsx", "components/person/SectionEdit.tsx", "lib/intake/targets.ts"] },
  // T167: 評価の 8 回目で呼び出しが 91.4/回・上限との比 90.7%（run-01 の 137 回のうち本人役の通話 72）。相づち・聞き返し・同じ問いをコードの短い返事にした。
  // r8 の通話の並びに当てると 136 往復のうち本人役 51（切った分を除く 94 往復の 54%）、1 回の訓練は最大 85 回ほど。値は r7 の数を超えない形で守る
  { id: "drill-calls-per-run", bench: "drill", item: "drill.callsPerRun", op: "<=", value: 89.6, since: "r9", task: "T167", label: "AI の呼び出しを 7 回目より増やさない", suspects: ["lib/drill/talk-quick.ts", "lib/drill/hooks.ts", "tools/eval/drill/drive.ts"] },
  { id: "drill-cap-ratio", bench: "drill", item: "drill.capRatioMax", op: "<=", value: 0.747, since: "r9", task: "T167", label: "1 訓練の上限との比を 7 回目より増やさない", suspects: ["lib/drill/talk-quick.ts", "lib/drill/hooks.ts", "tools/eval/drill/drive.ts"] },
  { id: "drill-talk-ai-share", bench: "drill", item: "drill.talkAiShare", op: "<=", value: 0.7, since: "r9", task: "T167", label: "通話の返事を本人役に頼りすぎない（相づち・同じ問いはコード）", suspects: ["lib/drill/talk-quick.ts"] },
  // T167: 避難所や病院へ移ったあとに家にいる言い方（審査役 3 回とも）。門（帳面のいる所でも見る・「家で〜」・「病院へ移りました」）で画面の言葉では 0
  { id: "drill-place-text-none", bench: "drill", item: "count:drill:facts:place_text", op: "<=", value: 0, since: "r9", task: "T167", label: "いる所と食い違う言葉を出さない", suspects: ["lib/drill/person-facts.ts", "lib/drill/persona.ts"] },
  // T167: 届いた電源を「電気が戻った」と言う・戻ったあとに「まだ停電」と言う。門が直す・落とすので画面の言葉では 0
  { id: "drill-power-said-none", bench: "drill", item: "count:drill:facts:power_said", op: "<=", value: 0, since: "r9", task: "T167", label: "停電の戻りと家の電気を食い違わせない", suspects: ["lib/drill/person-facts.ts", "lib/drill/persona.ts"] },
  // T167: 仮想の回の出来事の無い人 8/10。世界の刻みに表の人ごとの出来事を足した（lib/drill/quiet-event.ts）
  { id: "drill-virtual-no-kind", bench: "drill", item: "drill.personNoKindVirtual", op: "<=", value: 0.3, since: "r9", task: "T167", label: "仮想の回で出来事の無い人を 3 割より増やさない", suspects: ["lib/drill/quiet-event.ts", "lib/drill/event-catalog.ts", "lib/drill/world-apply.ts"] },
  // T168: 評価の 8 回目の災害診療記録で、括弧の刷っていない「□アレルギー」に印は付くのに物の名前が紙に残らなかった（取りこぼし 18）。□ の右の空きに
  // 中身の欄を補い、8 回目の記録の数え直しで 0。連絡先の置けず 23（forms-contact-placed）と正解に無い印 1（forms-mark-extra-none）も同じ数え直しで 0
  { id: "forms-mark-content", bench: "forms", item: "forms.markNoContent", op: "<=", value: 0, since: "r9", task: "T168", label: "印を付けた □ の中身を紙から落とさない", suspects: ["lib/forms/trailing-field.ts", "lib/forms/read-post.ts", "lib/forms/mapped-sheet.ts"] },
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
