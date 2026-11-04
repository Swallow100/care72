# remote D1 を作り直して再配信する。作者が端末で打つ。使い方: bash tools/deploy/rebuild-remote.sh <commit>
# 11/4 から既定の配信は tools/deploy/migrate-remote.sh（表を落とさない）。これは作り直しが要るときだけ。
# 本物の事業所のデータ（デモ事業所の外の利用者・訓練、種に無いアカウント・事業所）があれば、何もせずに止まる。
# 消してよいときだけ ALLOW_DATA_LOSS=1 bash tools/deploy/rebuild-remote.sh <commit>（survey_ の表はどちらでも残す）
set -e
# DEPLOY_DIR が無ければ、今の checkout の隣に配信用の worktree（care72-deploy）を作る
REPO="$(git rev-parse --show-toplevel)"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO/../care72-deploy}"; [ -d "$DEPLOY_DIR" ] || git -C "$REPO" worktree add --detach "$DEPLOY_DIR" "$1"; cd "$DEPLOY_DIR"
git checkout -q -- . && git checkout -q --detach "$1"
echo "== commit: $(git log --format='%h %s' -1)"
echo "== npm ci"; npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -1
echo "== 守り（本物の事業所のデータがあれば止める。数が読めないときも止める。前段・drop より前）"
node tools/deploy/guard-remote.mjs || { echo "作り直し 停止（表には触っていない）"; exit 1; }
echo "== 前段（migrations/0021 を drop の前に流す。survey_shares・survey_links に offices への外部キーが残っていると、リンクが 1 本でもあれば drop が落ちる。何度流しても同じ）"
# migrations apply と同じ道（--command。1 つの取引なので、落ちれば巻き戻って行は変わらない）。落ちたら drop に進まず止める。
# survey_ の 4 表がまだ無い D1（作ったばかり）では飛ばす（0021 は 4 表を建て直すので、無いと落ちる。migrations が 0004・0016 のあとに流す）
HAS=$(npx wrangler d1 execute care72 --remote --json --command "select count(*) as t from sqlite_master where type='table' and name in ('survey_links','survey_answers','survey_shares','survey_responses')" 2>/dev/null | grep -o '"t": *[0-9]*' | grep -o '[0-9]*' || true)
if [ "$HAS" = "4" ]; then
  # npx は Windows で cmd.exe を通り、複数行の長い --command を「コマンド ラインが長すぎます」で断るので、node で wrangler を直に呼ぶ
  PRE=$(node node_modules/wrangler/bin/wrangler.js d1 execute care72 --remote --json --command="$(cat migrations/0021_survey_no_office_fk.sql)" 2>&1) || { echo "前段が落ちた"; echo "$PRE" | grep -v -i token | head -20; exit 1; }
  if echo "$PRE" | grep -qiE '"error"|SQLITE_|constraint failed'; then echo "前段が落ちた"; echo "$PRE" | grep -v -i token | head -20; exit 1; fi
  echo "  外部キーを外した（survey_ の行はそのまま）"
else
  echo "  survey_ の表が 4 つそろっていない（${HAS:-読めない}）。前段は飛ばす"
fi
echo "== drop（sqlite_master から全部、外部キーは後回し。残れば繰り返す。survey_ の表は本物の答えが入るので落とさない）"
KEEP="and name not like 'survey_%'"
for i in 1 2 3 4; do
  # wrangler が JSON の前に知らせ（版の案内など）を出すことがあるので、最初の [ から読む。読めなければ理由を出して止める
  LIST=$(npx wrangler d1 execute care72 --remote --json --command "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' $KEEP" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s.slice(s.indexOf('[')));console.log(j[0].results.map(r=>r.name).join(' '))}catch(e){console.error('表の一覧が読めない: '+s.slice(0,200))}})")
  [ -n "$LIST" ] || break
  echo "  落とす: $LIST"
  STMT="PRAGMA defer_foreign_keys = true;"
  for t in $(echo "$LIST" | tr ' ' '\n' | tac); do STMT="$STMT DROP TABLE IF EXISTS \"$t\";"; done
  npx wrangler d1 execute care72 --remote --json --command "$STMT" 2>&1 | grep -iE '"error"|rror|Executed' | head -3
done
LEFT=$(npx wrangler d1 execute care72 --remote --json --command "select count(*) as t from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' $KEEP" 2>/dev/null | grep -o '"t": *[0-9]*' | grep -o '[0-9]*')
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
CHECK_COMMIT=$(git rev-parse --short=7 HEAD) CHECK_WORKERS_DEV_HOST="${WORKERS_DEV_HOST:-}" node tools/deploy/check-remote.mjs https://care72.app || echo "check に FAIL がある（出した commit と /api/health の commit を含む）"
