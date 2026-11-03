// アンケートの頁と API の道（画面の部品からも読むので、サーバーの物を import しない）。

/** 答えの頁 /survey/<token>。ログインなしで開ける頁はこれだけ */
export const SURVEY_PAGE_PREFIX = "/survey/";

/** 送信の API（ログインなし）/api/survey/<token> */
export const surveySubmitPath = (token: string): string => `/api/survey/${encodeURIComponent(token)}`;

/** リンクを作る API（事業所の画面から。ケアマネの役） */
export const SURVEY_LINKS_API_PATH = "/api/survey/links";

/** 招待の URL（送る相手に渡す物）。origin は要求の URL から（手元の dev と配信で同じに動く） */
export const surveyUrl = (origin: string, token: string): string => `${origin}${SURVEY_PAGE_PREFIX}${token}`;
