// アンケートの頁と API の道（画面の部品からも読むので、サーバーの物を import しない）。

/** 答えの頁 /survey/<token>。ログインなしで開ける頁はこれだけ */
export const SURVEY_PAGE_PREFIX = "/survey/";

/** 送信の API（ログインなし）/api/survey/<token> */
export const surveySubmitPath = (token: string): string => `/api/survey/${encodeURIComponent(token)}`;

/** リンクを作る API（事業所の画面から。ケアマネの役） */
export const SURVEY_LINKS_API_PATH = "/api/survey/links";

/** 招待の URL（送る相手に渡す物）。origin は要求の URL から（手元の dev と配信で同じに動く） */
export const surveyUrl = (origin: string, token: string): string => `${origin}${SURVEY_PAGE_PREFIX}${token}`;

/** 送れた端末の印（cookie の名前）。Path は答えの頁（/survey/<token>）だけにする */
export const SURVEY_DONE_COOKIE = "care72_survey_done";

/** 送れた端末の印（localStorage の鍵）。cookie が消されたときの控え */
export const surveyDoneStorageKey = (token: string): string => `care72.survey.done.${token}`;

/** 送れた端末の印の cookie（送信の API の応答に付ける）。60 日 */
export const surveyDoneCookie = (token: string, secure: boolean): string =>
  `${SURVEY_DONE_COOKIE}=1; Path=${SURVEY_PAGE_PREFIX}${token}; Max-Age=${60 * 24 * 60 * 60}; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`;
