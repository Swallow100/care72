// 開始の前に選ぶ物（T59）の小さな決まり。画面（components/drill/StartButtons）とサーバー（lib/drill/engine.ts・http.ts）で同じ物を使う。

/** 職員の空きは 0〜9 人 */
export const STAFF_MAX = 9;

export const isStaffCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= STAFF_MAX;
