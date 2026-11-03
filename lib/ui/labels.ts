// 共通の部品（T44）の画面の言葉。窓の題とボタンは 2〜4 字の漢語、待ちの印は呼ぶ側が渡す。
// 本人・家族のスマホの追加の案内は、やさしい日本語とふりがな（書き方は lib/forms/easy-words.ts の "{漢字|よみ}"）。
// 新しく足した言葉は docs/progress/t44.md の「言葉」の一覧にも書く（設計の側が Gemini に通して採否を決める）。

/** アプリ内の確認・お知らせの窓（lib/ui/dialog.ts・components/ui/DialogHost.tsx） */
export const DIALOG_LABELS = {
  confirm: "確認",
  alert: "お知らせ",
  ok: "決定",
  close: "閉じる",
  cancel: "取消",
} as const;

/** 呼ぶ側の確認の窓（題・決める方のボタン）。本文は各画面の既存の言葉 */
export const CONFIRM_LABELS = {
  resetTitle: "初期化",
  resetOk: "戻す",
  normalTitle: "平時復帰",
  normalOk: "戻す",
  unlistTitle: "一覧除外",
  unlistOk: "外す",
  abandonTitle: "訓練中断",
  abandonOk: "中断",
  abandonBody: "中断すると再開不可",
} as const;

/** AI の待ちの印（components/ui/Loader72.tsx）の文字 */
export const WAIT_LABELS = {
  /** 入れる欄の分ける（Sonnet が台帳の欄に分ける間） */
  split: "分けています",
  /** 訓練の進める・早送り（本人役・家族役が次の 1 刻みを考える間） */
  think: "考えています",
  /** 本人のスマホの録る間（Haiku が録音を聞く間） */
  listen: "聞いています",
  /** 様式の読み取り（Opus が写真・PDF を読む間） */
  read: "読み取っています",
  /** 訓練の講評（Opus が講評を書く間） */
  review: "書いています",
} as const;

/** 選ぶ部品（components/ui/Select.tsx）の言葉 */
export const SELECT_LABELS = {
  /** 何も選んでいないとき（薄い字） */
  none: "未選択",
  /** 検索の欄の名前 */
  search: "検索",
  /** 検索で 1 つも当たらないとき */
  empty: "該当なし",
  /** 複数で 3 つ以上選んだときのボタンの字（N 件） */
  count: "件",
} as const;

/** ホーム画面に追加の案内（本人・家族のスマホ。components/phone/InstallHint.tsx） */
export const INSTALL_PHRASES = {
  /** 案内の 1 行目 */
  lead: "ホーム{画面|がめん}に {入|い}れると すぐ {開|ひら}けます",
  /** Android の Chrome の 1 押しで入るボタン */
  add: "{追加|ついか}",
  close: "{閉|と}じる",
  /** iPhone の Safari の手順（共有 → ホーム画面に追加 → 追加） */
  iosShare: "{共有|きょうゆう}を {押|お}す",
  iosAdd: "「ホーム{画面|がめん}に {追加|ついか}」を {押|お}す",
  iosDone: "{右上|みぎうえ}の「{追加|ついか}」を {押|お}す",
  /** Android で 1 押しの画面がまだ来ていないとき（Chrome のメニューから） */
  androidMenu: "{右上|みぎうえ}の メニューを {押|お}す",
  androidAdd: "「ホーム{画面|がめん}に {追加|ついか}」を {押|お}す",
  /** LINE の中で開いているとき（外のブラウザへ） */
  line: "LINE の {中|なか}では {入|い}れられません",
  openBrowser: "ブラウザで {開|ひら}く",
  /** iPhone のほかのアプリの中（Safari へ出るボタンが無い） */
  inApp: "Safari で {開|ひら}いて ください",
} as const;
