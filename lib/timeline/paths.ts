// 経過の書き足し（docs/tasks/T24.md）の場所と上限。画面（client の部品）からも読むので、ここは D1 に触らない。
export const TIMELINE_API = "/api/timeline";

/** 自由文の長さの上限（字） */
export const BODY_MAX = 400;

/** 経過の撤回（docs/tasks/T63.md） */
export const RETRACT_API = "/api/timeline/retract";

/** 撤回の理由の長さの上限（字。migrations/0014 の CHECK と同じ） */
export const RETRACT_NOTE_MAX = 40;
