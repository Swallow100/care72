# remote D1 を作り直して再配信する。作者が端末で打つ。使い方: bash tools/deploy/rebuild-remote.sh <commit>
set -e
DEPLOY_DIR="${DEPLOY_DIR:-/c/Users/choco/dev/care72-deploy}"; [ -d "$DEPLOY_DIR" ] || git -C /c/Users/choco/dev/care72 worktree add --detach "$DEPLOY_DIR" "$1"; cd "$DEPLOY_DIR"
git checkout -q -- . && git checkout -q --detach "$1"
echo "== commit: $(git log --format='%h %s' -1)"
echo "== npm ci"; npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -1
echo "== drop（sqlite_master から全部、外部キーは後回し。残れば繰り返す）"
for i in 1 2 3 4; do
  LIST=$(npx wrangler d1 execute care72 --remote --json --command "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%'" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j[0].results.map(r=>r.name).join(' '))}catch(e){}})")
  [ -n "$LIST" ] || break
  STMT="PRAGMA defer_foreign_keys = true;"
  for t in $(echo "$LIST" | tr ' ' '\n' | tac); do STMT="$STMT DROP TABLE IF EXISTS \"$t\";"; done
  npx wrangler d1 execute care72 --remote --json --command "$STMT" > /dev/null 2>&1 || true
done
LEFT=$(npx wrangler d1 execute care72 --remote --json --command "select count(*) as t from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%'" 2>/dev/null | grep -o '"t": *[0-9]*' | grep -o '[0-9]*')
[ "$LEFT" = "0" ] || { echo "表が残っている: $LEFT"; exit 1; }
echo "== migrations"; npx wrangler d1 migrations apply care72 --remote 2>&1 | grep -E "ERROR|00[0-9][0-9]_" | head -4
echo "== seed"; node seed/build-sql.ts 2>&1 | tail -1
npx wrangler d1 execute care72 --remote --file=seed/generated/seed.sql 2>&1 | grep -E "rows_written|rror" | head -2
echo "== build"
npm run -s cf:build > "$HOME/care72-build.log" 2>&1 || { echo "cf:build failed"; grep -n -i error "$HOME/care72-build.log" | head -10; exit 1; }
echo "cf:build ok"
echo "== deploy"; npx wrangler deploy 2>&1 | grep -v -i token | grep -E "Uploaded care72|Version|custom domain|rror"
echo "== check"
for h in care72.app care72.kyudo-platform.workers.dev; do curl -s -m 30 "https://$h/api/health"; echo " ($h)"; curl -s -m 30 -o /dev/null -w "  top %{http_code} -> %{redirect_url}\n" "https://$h/"; done
npx wrangler d1 execute care72 --remote --json --command "select count(*) as n from people" 2>/dev/null | grep -o '"n": *[0-9]*'
CHECK_COMMIT=$(git rev-parse --short=7 HEAD) CHECK_WORKERS_DEV_HOST="${WORKERS_DEV_HOST:-}" node tools/deploy/check-remote.mjs https://care72.app || echo "check に FAIL がある（出した commit と /api/health の commit を含む）"
