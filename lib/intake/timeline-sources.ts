// 入れる欄の保存の経過の本文の頭（lib/intake/save.ts の timelineBody が書く）。台帳（D1）に入る本文はこの形のまま。
// 本人のページの変更履歴（T143、lib/timeline/history.ts）は、この頭を読んで分かる 1 行（「既往を手で入力」）に言い換える。
// save.ts から分けたのは、本人のページの組み立て（lib/person.ts）が save.ts を読まずに済むように（save.ts は lib/person.ts を読む）。

/**
 * 経過の本文の頭: AI の分け方を人が確かめた・問いへの答え（手入力）・本人のページの面で手で直した・外した・値を確かめた。
 * 手で直したときは 1 つの保存で「ケアマネが直した: 〜。ケアマネが外した: 〜」と並べる
 */
export const TIMELINE_SOURCES = {
  ai: "AI の分け方、人が確認",
  manual: "手入力",
  edit: "ケアマネが直した",
  removed: "ケアマネが外した",
  seen: "ケアマネが確認した",
} as const;

export type TimelineSource = keyof typeof TIMELINE_SOURCES;
