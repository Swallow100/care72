-- 連絡先のフリガナ・住所・携帯番号（docs/tasks/T117.md、docs/progress/t117.md）。0027・0028 は本番に当て済みなので 0029。
-- 計画書（松山市）の近親者・避難支援等実施者 1・2 の【フリガナ】【住所】【携帯番号】は台帳に置き場が無く、いつも未確認だった。
-- contacts.kana: 名前のフリガナ（カタカナ）。氏名と同じ扱いで Claude に渡さない（lib/pseudonym の ClaudeContact に無い）。
-- contacts.address: 住所は市町村と町名まで（本人の住所 ledger.basic.address と同じく番地は持たない）。Claude に渡さない。
-- contacts.mobile: 2 つ目の電話（携帯）。phone は 1 つ目（固定か、携帯しか無い人の携帯）。Claude に渡さない。
--   前からの「備考に携帯」と書いた phone は、紙では今までどおり携帯番号の欄に出す（lib/forms/matsuyama.ts の phoneCells）。移さない。
-- どれも NULL が「まだ無い」。足すだけで今の行と読む所は変わらない（ALTER TABLE ADD COLUMN、既定は NULL）。
ALTER TABLE contacts ADD COLUMN kana TEXT;
ALTER TABLE contacts ADD COLUMN address TEXT;
ALTER TABLE contacts ADD COLUMN mobile TEXT;
