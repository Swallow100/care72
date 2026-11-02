// テストの差し替え: 内閣府の個別避難計画の様式例（表・裏）を Opus が読んだときの返事の形を、手で起こした固定の JSON。
// 本物の Opus の返事ではない（本物の API はテストで呼ばない）。欄の名前と順は取組指針の様式例から起こした。PDF はリポジトリに入れない。
// 本番の鍵で最初に確かめること（この返事と本物の返事の違い）は docs/progress/t08.md。

import type { ReadResult } from "./mapping.ts";

/** 避難行動要支援者の避難行動支援に関する取組指針（令和 3 年 5 月改定、令和 7 年 6 月更新）。様式例は 99〜100 頁 */
export const CAO_GUIDELINE_URL = "https://www.bousai.go.jp/taisaku/hisaisyagyousei/youengosya/r3/pdf/shishin_r7.pdf";
export const CAO_GUIDELINE_PAGES = "99〜100 頁「個別避難計画の様式例（表）（裏）」";

type F = ReadResult["fields"][number];

const contactBlock = (
  section: string,
  row: string,
  prefix: "emergency1" | "emergency2" | "supporter1" | "supporter2",
  nameLabel: string,
): F[] => [
  { page: 1, section, label: "フリガナ", position: `表 ${row} 1 行目`, shape: "text", options: [], item: null, confidence: "medium", reason: "連絡先のカナは台帳に無い" },
  { page: 1, section, label: nameLabel, position: `表 ${row} 2 行目`, shape: "text", options: [], item: `${prefix}.name`, confidence: "high", reason: "氏名が合う" },
  { page: 1, section, label: "住所", position: `表 ${row} 3 行目`, shape: "text", options: [], item: `${prefix}.address`, confidence: "medium", reason: "住所は無く近さだけ" },
  {
    page: 1,
    section,
    label: "連絡先（電話番号１・電話番号２・メールアドレス・その他）",
    position: `表 ${row} 4 行目`,
    shape: "lines",
    options: [],
    item: `${prefix}.phone`,
    confidence: "high",
    reason: "電話番号が合う",
  },
];

const check = (label: string, item: string | null, confidence: F["confidence"], reason: string, n: number): F => ({
  page: 2,
  section: "避難時に配慮しなくてはならない事項",
  label,
  position: `裏 上の段 ${n} 行目`,
  shape: "check",
  options: [],
  item,
  confidence,
  reason,
});

export const CAO_FORM_READ: ReadResult = {
  title: "個別避難計画",
  issuer: "内閣府（様式例）",
  pages: 2,
  fields: [
    { page: 1, section: "", label: "氏名", position: "表 1 段目 左", shape: "text", options: [], item: "person.name", confidence: "high", reason: "本人の氏名" },
    { page: 1, section: "", label: "生年月日", position: "表 2 段目 左", shape: "date", options: [], item: "person.birth", confidence: "high", reason: "生年月日が合う" },
    { page: 1, section: "", label: "性別", position: "表 2 段目 中", shape: "choice", options: ["男", "女"], item: "basic.sex", confidence: "high", reason: "性別が合う" },
    { page: 1, section: "", label: "年齢", position: "表 2 段目 右", shape: "text", options: [], item: "person.age", confidence: "high", reason: "年齢が合う" },
    { page: 1, section: "", label: "住所又は居所", position: "表 3 段目 左", shape: "text", options: [], item: "basic.address", confidence: "high", reason: "本人の住所" },
    { page: 1, section: "", label: "電話番号", position: "表 3 段目 右 1 行目", shape: "phone", options: [], item: "self.phone", confidence: "high", reason: "本人の固定電話" },
    { page: 1, section: "", label: "ＦＡＸ番号", position: "表 3 段目 右 2 行目", shape: "phone", options: [], item: null, confidence: "medium", reason: "FAX 番号は台帳に無い" },
    { page: 1, section: "", label: "携帯番号", position: "表 3 段目 右 3 行目", shape: "phone", options: [], item: "self.mobile", confidence: "high", reason: "本人の携帯" },
    { page: 1, section: "", label: "メールアドレス", position: "表 3 段目 右 4 行目", shape: "text", options: [], item: "basic.contactMeans", confidence: "low", reason: "アドレスは無くメールの有無だけ" },
    { page: 1, section: "", label: "同居家族等", position: "表 4 段目", shape: "lines", options: [], item: "people.together", confidence: "high", reason: "同居の人" },
    { page: 1, section: "避難場所", label: "名称", position: "表 5 段目 1 行目", shape: "text", options: [], item: "evacuation.destination1", confidence: "high", reason: "避難先の名称" },
    { page: 1, section: "避難場所", label: "住所", position: "表 5 段目 2 行目", shape: "text", options: [], item: null, confidence: "medium", reason: "避難先の住所は台帳に無い" },
    ...contactBlock("緊急時の連絡先①", "6 段目", "emergency1", "氏名（団体名）"),
    ...contactBlock("緊急時の連絡先②", "7 段目", "emergency2", "氏名（団体名）"),
    ...contactBlock("避難支援等実施者情報①", "8 段目", "supporter1", "氏名（団体名及び代表者）"),
    ...contactBlock("避難支援等実施者情報②", "9 段目", "supporter2", "氏名（団体名及び代表者）"),
    check("介護保険の認定を受けている【要介護状態区分】", "care.careLevel", "high", "要介護度が合う", 1),
    check("手帳所持【障害名・等級】", "care.handbook", "high", "手帳の種類と等級", 2),
    check("難病の特定医療費、小児慢性特定疾病医療費の支給認定を受けている", "care.intractableDisease", "medium", "支給認定の有無は無く病名だけ", 3),
    check("医療機器の装着等をしている", "medical.devices", "high", "医療機器が合う", 4),
    check("立つことや歩行ができない", "care.walking", "high", "歩行の項目", 5),
    check("音が聞こえない（聞き取りにくい）", "care.hearing", "high", "聴覚の項目", 5),
    check("物が見えない（見えにくい）", "care.vision", "high", "視覚の項目", 6),
    check("言葉や文字の理解がむずかしい", "care.understanding", "high", "理解の項目", 6),
    check("危険なことを判断できない", "care.judgment", "high", "判断の項目", 7),
    check("顔を見ても知人や家族とわからない", "care.orientation", "high", "見当識の項目", 7),
    check("その他", null, "low", "決められない", 8),
    { page: 2, section: "", label: "特記事項", position: "裏 中の段", shape: "lines", options: [], item: "notes.words", confidence: "medium", reason: "本人の言葉・特記" },
    { page: 2, section: "", label: "避難支援時の留意事項", position: "裏 下の段", shape: "lines", options: [], item: "care.issues", confidence: "medium", reason: "避難の課題をまとめた物" },
  ],
};
