-- 事業所が計画書に使う様式（docs/tasks/T47.md の 4）。自治体で様式が違うので事業所ごとに選ぶ。
-- matsuyama は松山市の様式（既定）、cao は内閣府の様式例、mapping:<form_mappings.id> は事業所が確かめた対応表（T08）。
-- 対応表が下書きに戻った・消えたときは、読む側（lib/forms/plan-form.ts）が松山市の様式に戻す。
ALTER TABLE offices ADD COLUMN plan_form TEXT NOT NULL DEFAULT 'matsuyama'
  CHECK (plan_form IN ('matsuyama', 'cao') OR (plan_form GLOB 'mapping:*' AND length(plan_form) BETWEEN 9 AND 72));
