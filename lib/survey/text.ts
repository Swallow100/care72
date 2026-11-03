// アンケートの Web 版（docs/tasks/T42.md）の言葉。案内の文と画面の言葉はここ 1 か所に置く。
// 案内の文は、設計の側が Gemini に通し、作者が読んでから相手に送る。直すときはここだけを直す
// （全文は docs/progress/t42.md にも写してある。直したら写しも直す）。
// 問いと選択肢の言葉は tools/survey/questions.ts が正で、ここには持たない（紙・README の記号と同じ並び）。

/** 案内の題（見出し。読点・句点なし） */
export const SURVEY_TITLE = "アンケートのお願い";

/**
 * 案内の文。宛名は付けない（リンクは誰に送っても同じ文）。1 段落 1 行で、スマホの大きな字で 15 行ほど。
 * 頼み → 作者と事情（作品・締切）→ 触らなくてよいこと・名前は要らない → 使い道 → お礼 の順。
 * 11/3 12:4x に設計の側が Gemini の校正を受けて 5 段落に詰めた（事実は変えず、前置きを短く。docs/DECISIONS.md）。
 */
export const SURVEY_INVITATION: ReadonlyArray<string> = [
  "突然のお願いで恐縮です。お時間のあるときに、5 分ほどご協力いただけませんか。",
  "私は医学部の学生で、家族にケアマネジャーがいます。在宅の要介護の方の個別避難計画づくりを手伝う道具「ケア72」を、ハッカソン（Built with Claude: Japan 2026、締切 11 月 8 日）の作品として作っています。計画づくりの負担を、現場の方の声で確かめたくてお願いしています。",
  "アプリを触る必要も、訓練をする必要もありません。下の問いに答えて送るだけです。答えたくない問いは空けて構いません。お名前・事業所名・利用者のことは書かないでください。",
  "答えは「5 人中 3 人」のような人数にまとめ、作品の説明と動画に使います。書いていただいた文は、最後の問いで「よい」を選んだ方の物だけを、名前を伏せて引用することがあります。",
  "ご協力いただけましたら、本当にありがたく思います。",
];

/** 問いの前の 1 行（QUESTIONS.md の「個別避難計画」の説明と同じ） */
export const SURVEY_PLAN_NOTE = "個別避難計画＝災害のときの、一人ひとりの避難の計画書。市町村の様式に書くもの";

/** 問 3 の下の 1 行（QUESTIONS.md と同じ） */
export const SURVEY_SUPPORTER_NOTE = "支援者＝避難のとき、迎えに来てくれる人";

/** 送ったあとの文（見出しは SURVEY_LABELS.sent「送信しました」。相手は外の人なので状態の 2 字でなく文で） */
export const SURVEY_THANKS: ReadonlyArray<string> = ["ご協力ありがとうございました。"];

/** 答えの頁の言葉（ボタン・見出し・状態は 2〜4 字） */
export const SURVEY_LABELS = {
  about: "あなたについて",
  questions: "問い",
  free: "記入欄",
  multi: "複数可",
  submit: "送信",
  sending: "送信中",
  sent: "送信しました",
  /** 開いてから 15 秒たっていない */
  tooFast: "少し待って再送信",
  /** 同じ所から 1 時間に 20 回を超えた */
  limited: "回数超過",
  /** リンクが無い・使用済み・期限切れ（送る前に別の画面で答えたなど） */
  gone: "リンク無効",
  /** どの問いにも答えていない */
  empty: "未回答",
  /** Turnstile の確かめが済んでいない・通らない */
  turnstile: "確認未完了",
  failed: "送信失敗",
  /** 自由記述の残りの字数 */
  chars: "字",
} as const;

/** 事業所の画面（/office）の「アンケート」の言葉 */
export const SURVEY_OFFICE_LABELS = {
  title: "アンケート",
  create: "リンク作成",
  memo: "宛先控え",
  memoPlaceholder: "例 ケアマネA",
  made: "作成済",
  links: "リンク",
  answers: "回答",
  none: "回答なし",
  noLinks: "リンクなし",
  copyAll: "全員写し",
  copyRow: "写し",
  expires: "期限",
  submitted: "受付",
  judge: "審査員",
  quoteOk: "引用可",
  quoteNo: "引用不可",
  /** 自由記述に名前・電話らしい物（tools/survey/answers.ts の findRisks） */
  risk: "要確認",
  close: "閉じる",
  failed: "作成失敗",
} as const;

/** リンクの状態（未開封・開封済・回答済・期限切れ） */
export const SURVEY_LINK_STATES = ["unopened", "opened", "answered", "expired"] as const;
export type SurveyLinkState = (typeof SURVEY_LINK_STATES)[number];
export const SURVEY_LINK_STATE_LABELS: Record<SurveyLinkState, string> = {
  unopened: "未開封",
  opened: "開封済",
  answered: "回答済",
  expired: "期限切れ",
};
