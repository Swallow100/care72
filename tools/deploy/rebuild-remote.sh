# remote D1 を作り直して再配信する。作者が端末で打つ。使い方: bash tools/deploy/rebuild-remote.sh <commit>
set -e
DEPLOY_DIR="${DEPLOY_DIR:-/c/Users/choco/dev/care72-deploy}"; [ -d "$DEPLOY_DIR" ] || git -C /c/Users/choco/dev/care72 worktree add --detach "$DEPLOY_DIR" "$1"; cd "$DEPLOY_DIR"
git checkout -q -- . && git checkout -q --detach "$1"
echo "== commit: $(git log --format='%h %s' -1)"
echo "== npm ci"; npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -1
echo "== drop（sqlite_master から全部、外部キーは後回し。残れば繰り返す）"
for i in 1 2 3 4; do
  # wrangler が JSON の前に知らせ（版の案内など）を出すことがあるので、最初の [ から読む。読めなければ理由を出して止める
  LIST=$(npx wrangler d1 execute care72 --remote --json --command "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%'" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('[')));console.log(j[0].results.map(r=>r.name).join(' '))}catch(e){console.error('表の一覧が読めない: '+s.slice(0,200))}})")
  [ -n "$LIST" ] || break
  echo "  落とす: $LIST"
  STMT="PRAGMA defer_foreign_keys = true;"
  for t in $(echo "$LIST" | tr ' ' '\n' | tac); do STMT="$STMT DROP TABLE IF EXISTS \"$t\";"; done
  npx wrangler d1 execute care72 --remote --json --command "$STMT" 2>&1 | grep -iE '"error"|rror|Executed' | head -3
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
# workers.dev のホスト名はアカウント名を含むのでリポジトリに書かない。確かめるときは環境変数 WORKERS_DEV_HOST で渡す（閉じていれば 1042 か 404）
for h in care72.app ${WORKERS_DEV_HOST:-}; do curl -s -m 30 "https://$h/api/health"; echo " ($h)"; curl -s -m 30 -o /dev/null -w "  top %{http_code} -> %{redirect_url}\n" "https://$h/"; done
npx wrangler d1 execute care72 --remote --json --command "select count(*) as n from people" 2>/dev/null | grep -o '"n": *[0-9]*'
