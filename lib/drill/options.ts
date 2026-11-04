// 開始の前に選ぶ物（T59）の小さな決まり。画面（components/drill/StartButtons）とサーバー（lib/drill/engine.ts・http.ts）で同じ物を使う。

/** 職員の空きは 0〜9 人 */
export const STAFF_MAX = 9;

export const isStaffCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= STAFF_MAX;

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
