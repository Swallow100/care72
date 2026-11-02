# remote D1 を作り直して再配信する。使い方: bash rebuild-remote.sh <commit>
set -e
cd /c/Users/choco/dev/care72-deploy
git checkout -q -- . && git checkout -q --detach "$1"
echo "== commit: $(git log --format='%h %s' -1)"
echo "== npm ci"; npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -1
echo "== drop (子から順、外部キーは後回し)"
npx wrangler d1 execute care72 --remote --json --command "PRAGMA defer_foreign_keys = true; DROP TABLE IF EXISTS form9_rank_edits; DROP TABLE IF EXISTS form_mappings; DROP TABLE IF EXISTS office_timeline_entries; DROP TABLE IF EXISTS disaster_state; DROP TABLE IF EXISTS ai_calls; DROP TABLE IF EXISTS timeline_entries; DROP TABLE IF EXISTS signals; DROP TABLE IF EXISTS drill_events; DROP TABLE IF EXISTS drills; DROP TABLE IF EXISTS clocks; DROP TABLE IF EXISTS consents; DROP TABLE IF EXISTS contacts; DROP TABLE IF EXISTS people; DROP TABLE IF EXISTS accounts; DROP TABLE IF EXISTS offices; DROP TABLE IF EXISTS d1_migrations;" 2>&1 | grep -c '"success": true'
LEFT=$(npx wrangler d1 execute care72 --remote --json --command "select count(*) as t from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%'" 2>/dev/null | grep -o '[0-9]*' | tail -1)
[ "$LEFT" = "0" ] || { echo "表が残っている: $LEFT（新しい表を DROP の一覧に足す）"; exit 1; }
echo "== migrations"; npx wrangler d1 migrations apply care72 --remote 2>&1 | grep -E "ERROR|0001|0002|0003" | head -4
echo "== seed"; node seed/build-sql.ts 2>&1 | tail -1
npx wrangler d1 execute care72 --remote --file=seed/generated/seed.sql 2>&1 | grep -E "rows_written|rror" | head -2
echo "== build"
npm run -s cf:build > "$HOME/care72-build.log" 2>&1 || { echo "cf:build failed"; grep -n -i error "$HOME/care72-build.log" | head -10; exit 1; }
echo "cf:build ok"
echo "== deploy"; npx wrangler deploy 2>&1 | grep -v -i token | grep -E "Uploaded care72|Version|rror"
echo "== check"
curl -s -m 30 https://care72.kyudo-platform.workers.dev/api/health; echo
curl -s -m 30 -o /dev/null -w "top status %{http_code} redirect=%{redirect_url}\n" https://care72.kyudo-platform.workers.dev/
npx wrangler d1 execute care72 --remote --json --command "select count(*) as n from people" 2>/dev/null | grep -o '"n": *[0-9]*'
