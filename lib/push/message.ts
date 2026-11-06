// 「大丈夫ですか」の通知の文と押した先（T149）。文は固定で、名前・病名・住所・時刻など人の中身を入れない
// （通知は鍵のかかった画面にも出て、家族や周りの人の目にも入る）。押した先は本人・家族の頁（安否のボタン）だけ。
// Service Worker（lib/offline/sw-core.js の notificationOf）が同じ決まりで読み、決まりの外の中身は固定の文と /me にする。

/** 通知の題（アプリの名前） */
export const PUSH_TITLE = "ケア72";

/** 本文。本人には「大丈夫ですか」、家族・支援者には本人のことを聞く（名前は入れない） */
export const PUSH_BODY = { self: "大丈夫ですか", family: "ご本人は 大丈夫ですか" } as const;

/** 押した先（本人・家族の頁。災害モードなら安否のボタン） */
export const PUSH_URL = { self: "/me", family: "/family" } as const;

/** 同じ印の通知は端末で 1 つにまとめる（何度送っても積み重ならない） */
export const PUSH_TAG = "care72-safety";

/** 届くまで待つ長さ（秒）。電源が切れた端末にも、戻ってから 12 時間のうちなら届く */
export const PUSH_TTL_SEC = 12 * 60 * 60;

export type PushAudience = keyof typeof PUSH_BODY;

/** 送る中身（暗号化する前の JSON）。t 題・b 本文・u 押した先・g 印 */
export type PushMessage = { t: string; b: string; u: string; g: string };

export function pushMessage(audience: PushAudience): PushMessage {
  return { t: PUSH_TITLE, b: PUSH_BODY[audience], u: PUSH_URL[audience], g: PUSH_TAG };
}

/** 本人用（連絡先なし）か家族用か */
export function audienceOf(contactId: string | null): PushAudience {
  return contactId === null ? "self" : "family";
}
