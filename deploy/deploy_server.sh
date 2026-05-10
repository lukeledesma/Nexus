#!/usr/bin/env bash
# deploy_server.sh — Deploy this app to production (laptop origin should be github.com/lukeledesma/Nexus).
# Usage: ./deploy/deploy_server.sh [--rsync] [--branch BRANCH] [--dry-run] [--purge-runtime]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/load_deploy_env.sh"

# Set NEXUS_DEPLOY_* in the shell, or once in deploy/deploy.local.env (see deploy.local.env.example).
REMOTE_HOST="${NEXUS_DEPLOY_HOST:-}"
REMOTE_USER="${NEXUS_DEPLOY_USER:-deploy}"
SSH_KEY="${NEXUS_DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_APP="${NEXUS_DEPLOY_APP:-/home/$REMOTE_USER/apps/nexus}"
REMOTE_RUBY="${NEXUS_DEPLOY_RUBY:-/home/$REMOTE_USER/.rbenv/versions/3.2.3/bin}"
BRANCH="${BRANCH:-main}"
USE_RSYNC=false
DRY_RUN=false
PURGE_RUNTIME=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[server]${NC} $*"; }
success() { echo -e "${GREEN}[server]${NC} $*"; }
warn()    { echo -e "${YELLOW}[server]${NC} $*"; }
die()     { echo -e "${RED}[server] ERROR:${NC} $*" >&2; exit 1; }

[[ -n "$REMOTE_HOST" ]] || die "Set NEXUS_DEPLOY_HOST (or copy deploy/deploy.local.env.example → deploy/deploy.local.env). See docs/COMMANDS.md."

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rsync)    USE_RSYNC=true ;;
    --branch)   shift; BRANCH="$1" ;;
    --dry-run)  DRY_RUN=true ;;
    --purge-runtime) PURGE_RUNTIME=true ;;
    -h|--help)
      echo "Usage: $0 [--rsync] [--branch BRANCH] [--dry-run] [--purge-runtime]"
      exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

if [[ "$PURGE_RUNTIME" == true ]]; then
  CLEAN_CMD="git clean -ffdx"
else
  # Keep user/runtime workspace files between deploys while fully cleaning code artifacts.
  CLEAN_CMD="git clean -ffdx -e storage/workspace/ -e storage/contracts/"
fi

SSH_CMD="ssh -i $SSH_KEY -o ConnectTimeout=10"

if ! ssh-add -l 2>/dev/null | grep -q "$SSH_KEY"; then
  info "Adding SSH key to agent (enter passphrase if prompted) ..."
  ssh-add "$SSH_KEY" || die "Failed to add SSH key: $SSH_KEY"
fi

info "Checking SSH connectivity to $REMOTE_USER@$REMOTE_HOST ..."
if ! $SSH_CMD -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "echo ok" &>/dev/null; then
  die "Cannot reach $REMOTE_USER@$REMOTE_HOST — check VPN or server status."
fi
success "SSH OK"

cd "$LOCAL_REPO"
LOCAL_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
REMOTE_REPO_URL=$(git remote get-url origin 2>/dev/null || true)
[[ -z "$REMOTE_REPO_URL" ]] && die "Missing origin remote in $LOCAL_REPO"
info "Local HEAD: $LOCAL_COMMIT"

build_and_restart() {
  cat <<EOF
set -e
export PATH="$REMOTE_RUBY:\$PATH"
cd $REMOTE_APP

load_puma_env() {
  while IFS= read -r entry; do
    case "\$entry" in
      RAILS_ENV=*|RAILS_MASTER_KEY=*|SECRET_KEY_BASE=*|NEXUS_DATABASE_PASSWORD=*|NEXUS_DB_NAME=*|NEXUS_DB_USER=*|NEXUS_CACHE_DB_NAME=*|NEXUS_QUEUE_DB_NAME=*|NEXUS_CABLE_DB_NAME=*)
        export "\$entry"
        ;;
    esac
  done < <(sed -n 's/^Environment="\([A-Z0-9_]*=.*\)"$/\1/p' < <(systemctl cat puma 2>/dev/null))
}

load_puma_env
export RAILS_ENV=production

bundle config set --local without 'development test'
bundle install --quiet
if [ -f package.json ]; then
  if command -v yarn &>/dev/null; then yarn install --silent; else npm install --silent; fi
fi
PENDING_MIGRATIONS=\$(bundle exec rails db:migrate:status 2>/dev/null | awk '/^[[:space:]]*down/ { count++ } END { print count + 0 }')
if [ "\$PENDING_MIGRATIONS" -gt 0 ]; then
  bundle exec rails db:migrate
fi
SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production bundle exec rails assets:clobber --quiet
SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production bundle exec rails assets:precompile --quiet
sudo systemctl restart puma
PUMA_STATUS=\$(sudo systemctl is-active puma)
echo "PUMA_STATUS=\$PUMA_STATUS"
if sudo nginx -t 2>/dev/null; then
  sudo systemctl reload nginx 2>/dev/null || true
fi
if systemctl is-active nginx >/dev/null 2>&1; then
  NGINX_STATUS=$(systemctl is-active nginx)
elif sudo -n systemctl is-active nginx >/dev/null 2>&1; then
  NGINX_STATUS=$(sudo -n systemctl is-active nginx)
else
  NGINX_STATUS=unknown
fi
echo "NGINX_STATUS=\$NGINX_STATUS"
DEPLOY_COMMIT=\$(git rev-parse --short HEAD 2>/dev/null || echo rsync)
echo "DEPLOY_COMMIT=\$DEPLOY_COMMIT"
EOF
}

DEPLOY_COMMIT=""
PUMA_STATUS=""
NGINX_STATUS=""

if [[ "$USE_RSYNC" == false ]]; then
  info "Pulling on server (branch: $BRANCH) ..."
  PULL_CMD=$(cat <<EOF
set -e
export PATH="$REMOTE_RUBY:\$PATH"
if [ ! -d "$REMOTE_APP/.git" ]; then
  mkdir -p "$(dirname "$REMOTE_APP")"
  git clone "$REMOTE_REPO_URL" "$REMOTE_APP"
fi
cd $REMOTE_APP
git config --global --add safe.directory $REMOTE_APP 2>/dev/null || true
git fetch origin
git reset --hard origin/$BRANCH
if ! $CLEAN_CMD; then
  echo "[server] Initial clean failed; retrying after clearing bootsnap cache"
  rm -rf "$REMOTE_APP/tmp/cache/bootsnap" 2>/dev/null || true
  rm -rf "$REMOTE_APP/tmp/cache" 2>/dev/null || true
  $CLEAN_CMD
fi
EOF
)
  FULL_CMD="$PULL_CMD
$(build_and_restart)"

  if [[ "$DRY_RUN" == true ]]; then
    warn "[dry-run] would pull + build on server"
  else
    OUTPUT=$($SSH_CMD "$REMOTE_USER@$REMOTE_HOST" "$FULL_CMD") || die "Remote deploy failed."
    echo "$OUTPUT"
    DEPLOY_COMMIT=$(echo "$OUTPUT" | grep '^DEPLOY_COMMIT=' | cut -d= -f2)
    PUMA_STATUS=$(echo "$OUTPUT"  | grep '^PUMA_STATUS='   | cut -d= -f2)
    NGINX_STATUS=$(echo "$OUTPUT" | grep '^NGINX_STATUS='  | cut -d= -f2)
  fi
fi

if [[ "$USE_RSYNC" == true ]]; then
  info "Syncing files via rsync ..."
  RSYNC_FLAGS="-az --delete"
  [[ "$DRY_RUN" == true ]] && RSYNC_FLAGS="$RSYNC_FLAGS --dry-run"

  rsync $RSYNC_FLAGS \
    -e "ssh -i $SSH_KEY -o ConnectTimeout=10" \
    --exclude ".git" \
    --exclude "log/*" \
    --exclude "tmp/*" \
    --exclude "storage/*" \
    "$LOCAL_REPO/" \
    "$REMOTE_USER@$REMOTE_HOST:$REMOTE_APP/"

  BUILD_CMD=$(build_and_restart)
  if [[ "$DRY_RUN" == false ]]; then
    OUTPUT=$($SSH_CMD "$REMOTE_USER@$REMOTE_HOST" "$BUILD_CMD") || die "Remote build failed."
    echo "$OUTPUT"
    DEPLOY_COMMIT=$(echo "$OUTPUT" | grep '^DEPLOY_COMMIT=' | cut -d= -f2)
    PUMA_STATUS=$(echo "$OUTPUT"  | grep '^PUMA_STATUS='   | cut -d= -f2)
    NGINX_STATUS=$(echo "$OUTPUT" | grep '^NGINX_STATUS='  | cut -d= -f2)
  fi
fi

echo ""
echo -e "${GREEN}══════════════════════════════════${NC}"
echo -e "${GREEN} Deploy complete!${NC}"
echo -e "${GREEN}══════════════════════════════════${NC}"
echo -e "  Local commit : ${CYAN}$LOCAL_COMMIT${NC}"
[[ -n "$DEPLOY_COMMIT" ]] && echo -e "  Server commit: ${CYAN}$DEPLOY_COMMIT${NC}"
[[ -n "$PUMA_STATUS"   ]] && echo -e "  Puma status  : ${CYAN}$PUMA_STATUS${NC}"
[[ -n "$NGINX_STATUS"  ]] && echo -e "  Nginx status : ${CYAN}$NGINX_STATUS${NC}"
echo ""
