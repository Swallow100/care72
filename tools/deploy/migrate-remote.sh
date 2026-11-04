# 表を落とさずに、新しい migration だけ当てて再配信する（11/4 からの既定の配信）。作者が端末で打つ。使い方: bash tools/deploy/migrate-remote.sh <commit>
# d1_migrations に無い番号だけが当たる。種は入れ直さない（デモ事業所は毎朝 4 時の戻しと /office の「最初に戻す」で種に戻る）。
# 前提: 入った番号の migration を書き換えない。錠（docs/deploy/migrations.lock）と違えば何もせずに止まる。
# 順: build → migrations → deploy。build が落ちれば表に触らない。migrations が落ちれば deploy しない（落ちた番号は巻き戻る）。
# wrangler の出力を変数に取るので、migrations apply の確かめ（Ok to proceed?）は聞かれずに yes で進む。
# 作り直し（表を全部落として種から）は tools/deploy/rebuild-remote.sh。本物のデータがあると止まる。
set -e
# DEPLOY_DIR が無ければ、今の checkout の隣に配信用の worktree（care72-deploy）を作る
REPO="$(git rev-parse --show-toplevel)"
DEPLOY_DIR="${DEPLOY_DIR:-$REPO/../care72-deploy}"; [ -d "$DEPLOY_DIR" ] || git -C "$REPO" worktree add --detach "$DEPLOY_DIR" "$1"; cd "$DEPLOY_DIR"
git checkout -q -- . && git checkout -q --detach "$1"
echo "== commit: $(git log --format='%h %s' -1)"
echo "== npm ci"; npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -1
echo "== 錠（入った番号の migration が変わっていないか）"
node tools/deploy/lock-migrations.ts --check || { echo "錠と違う 停止"; exit 1; }
echo "== build"
npm run -s cf:build > "$HOME/care72-build.log" 2>&1 || { echo "cf:build failed"; grep -n -i error "$HOME/care72-build.log" | head -10; exit 1; }
echo "cf:build ok"
echo "== migrations（d1_migrations に無い番号だけ。表は落とさない）"
# 管（| grep）に通すと wrangler の終了コードが消えて、落ちても deploy に進むので、変数に取って確かめる
MIG=$(npx wrangler d1 migrations apply care72 --remote 2>&1) || { echo "migrations 失敗 停止"; echo "$MIG" | grep -v -i token | tail -20; exit 1; }
if echo "$MIG" | grep -qE '❌|ERROR|SQLITE_|constraint failed'; then echo "migrations 失敗 停止"; echo "$MIG" | grep -v -i token | tail -20; exit 1; fi
echo "$MIG" | grep -v -i token | grep -E "No migrations|[0-9]{4}_[^ ]*\.sql" | head -30 || true
echo "== deploy"
DEP=$(npx wrangler deploy 2>&1) || { echo "deploy 失敗"; echo "$DEP" | grep -v -i token | tail -20; exit 1; }
echo "$DEP" | grep -v -i token | grep -E "Uploaded care72|Version|custom domain|schedule|rror" || true
echo "== check"
# workers.dev のホスト名はアカウント名を含むのでリポジトリに書かない。確かめるときは環境変数 WORKERS_DEV_HOST で渡す（閉じていれば 1042 か 404）
for h in care72.app ${WORKERS_DEV_HOST:-}; do curl -s -m 30 "https://$h/api/health"; echo " ($h)"; curl -s -m 30 -o /dev/null -w "  top %{http_code} -> %{redirect_url}\n" "https://$h/"; done
npx wrangler d1 execute care72 --remote --json --command "select count(*) as n from people" 2>/dev/null | grep -o '"n": *[0-9]*'
CHECK_COMMIT=$(git rev-parse --short=7 HEAD) CHECK_WORKERS_DEV_HOST="${WORKERS_DEV_HOST:-}" node tools/deploy/check-remote.mjs https://care72.app || echo "check に FAIL がある（出した commit と /api/health の commit を含む）"
