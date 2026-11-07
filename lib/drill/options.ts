// 開始の前に選ぶ物（T59）の小さな決まり。画面（components/drill/StartButtons）とサーバー（lib/drill/engine.ts・http.ts）で同じ物を使う。

/** 職員の空きは 0〜9 人 */
export const STAFF_MAX = 9;

export const isStaffCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= STAFF_MAX;

/**
 * 訓練の参加者の上限（T186）。担当一覧がこれより多ければ、開始の画面で入れる人を選ぶ（既定は担当一覧の順の上から）。
 * サーバー（lib/drill/db.ts の startDrill）もこれを越える開始は断る
 */
export const PARTICIPANTS_LIMIT = 20;

/** 担当一覧が上限を越えるか（越えれば開始の画面で選ぶ） */
export const overParticipants = (total: number): boolean => total > PARTICIPANTS_LIMIT;

/** 既定の参加者: 担当一覧の順（よみ）の上から上限まで。上限以下なら全員 */
export function defaultParticipants<T>(caseload: ReadonlyArray<T>): T[] {
  return caseload.slice(0, PARTICIPANTS_LIMIT);
}

/** T186 の参加者の選択の言葉（「選択 18 / 20」・上から 20 人に戻す・全部外す） */
export const T186_LABELS = {
  picked: "選択",
  reset: "既定",
  clear: "解除",
  alone: "独居",
} as const;

/**
 * T104 の開始の設定の言葉。規模は仮想だけに効くので名前に「仮想」を入れる。自宅は訓練する人（自分）の住む所で、
 * 連続の時計の大雨想定・地震想定の監督が自分の出来事に使う
 */
export const T104_LABELS = {
  scale: "仮想規模",
  scaleAuto: "おまかせ",
  home: "自宅",
  homeNear: "事業所付近",
} as const;
