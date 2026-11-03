// 新しい人の同意の行を全部「未確認」で作る（T69a。監査 docs/progress/real-use-audit-20261104.md の 7）。
// 利用者追加（lib/office/people.ts の createPerson）と、医療班・行政がその場で作る人（lib/custody/store.ts の registerOnSite）が同じ batch に入れる。
// 種類は CONSENT_KINDS から（種類が足されても自動で入る）。範囲・期限・備考は空、記録した人は作った人、時刻は作った時刻。もう行があれば何もしない。
// 行が無いときも画面は「未確認」と読む（lib/consent/scope.ts の consentOf・lib/person.ts の consentBlocks）ので見え方は同じだが、
// 誰がいつ作った人の同意がまだかを表に残す。未確認の行は経過の「同意」に出さない（lib/person.ts の timelineItems）。
// 今ある人には足さない（migration で埋めない）。

import type { D1Database } from "@cloudflare/workers-types";
import { CONSENT_KINDS } from "../db/types.ts";

/** officeId を渡すと、本人がその事業所にいるときだけ入る（null は事業所を見ない。その場で作る人は所属なし） */
export function unconfirmedConsents(db: D1Database, personId: string, recordedBy: string | null, at: string, officeId: string | null) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO consents (person_id, kind, status, scope, recorded_by, recorded_at, expires_at, note)
       SELECT p.id, j.value, 'unconfirmed', NULL, ?2, ?3, NULL, NULL
         FROM people p, json_each(?4) j
        WHERE p.id = ?1 AND (?5 IS NULL OR p.office_id = ?5)`,
    )
    .bind(personId, recordedBy, at, JSON.stringify(CONSENT_KINDS), officeId);
}
