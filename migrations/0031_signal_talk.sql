-- 声の聞き取りの会話（docs/tasks/T137.md）。信号の行に列を 1 つ足すだけ（表は建て直さない）。
-- talk: 本人のスマホの赤の信号の会話の記録（lib/signals/talk.ts の TalkLog の JSON）。問いの文（AI が作った物は by が ai）、
--   本人の言葉（言い換えない）、聞こえ方（無音・不明瞭）、決まった問いのまま取れた答え、応答不明瞭の印、終わり方、締めの文。
--   端末が聞くたびに送り（後勝ち。往復の多い物・締めた物が勝つ）、録音を添えるときにも送る。
--   色と連絡の順に使わない（lib/triage の入力に無い）。Claude には仮名化の門を通した文だけを渡す
ALTER TABLE signals ADD COLUMN talk TEXT CHECK (talk IS NULL OR json_valid(talk));
