// 安否確認の結果の言葉（T149）。担当一覧の行の詳細のボタンの横と、API の応答に出す。2〜4 字の漢語と数だけ。

import type { SafetyResult } from "./http.ts";
import { PUSH_LABELS } from "./labels.ts";

export function safetyLabel(r: SafetyResult): string {
  if (r.ok) {
    if (r.total === 0) return PUSH_LABELS.none;
    if (r.sent === 0) return PUSH_LABELS.failed;
    return `${PUSH_LABELS.sent} ${r.sent}`;
  }
  switch (r.error) {
    case "not_configured":
      return `${PUSH_LABELS.notify} ${PUSH_LABELS.notConfigured}`;
    case "normal":
      return PUSH_LABELS.normal;
    case "wait":
      return PUSH_LABELS.wait;
    case "login_required":
      return PUSH_LABELS.loginRequired;
    case "forbidden":
      return PUSH_LABELS.forbidden;
    case "not_found":
      return PUSH_LABELS.notFound;
    case "invalid":
      return PUSH_LABELS.invalid;
  }
}
