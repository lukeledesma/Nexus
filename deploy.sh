#!/usr/bin/env bash
# deploy.sh — Push local commits to GitHub and deploy to production server.
# Usage: ./deploy.sh [--rsync] [--branch BRANCH] [--dry-run]
#
# Modes:
#   default  — SSH in, git pull origin main, bundle install, assets:precompile, restart puma
#   --rsync  — rsync app files to server (skip git), then bundle/assets/restart

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
REMOTE_HOST="172.232.163.176"
REMOTE_USER="luke"
SSH_KEY="$HOME/.ssh/id_ed25519"
REMOTE_APP="/home/luke/apps/nexus"
REMOTE_RUBY="/home/luke/.rbenv/versions/3.2.3/bin"
BRANCH="${BRANCH:-main}"
USE_RSYNC=false
DRY_RUN=false

# Find local repo root (where this script lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[deploy]${NC} $*"; }
success() { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()    { echo -e "${YELLOW}[deploy]${NC} $*"; }
die()     { echo -e "${RED}[deploy] ERROR:${NC} $*" >&2; exit 1; }

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rsync)     USE_RSYNC=true ;;
    --branch)    shift; BRANCH="$1" ;;
    --dry-run)   DRY_RUN=true ;;
    -h|--help)
      echo "Usage: $0 [--rsync] [--branch BRANCH] [--dry-run]"
      exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

SSH_CMD="ssh -i $SSH_KEY -o ConnectTimeout=10"

# ── Preflight: load SSH key into agent ────────────────────────────────────────
if ! ssh-add -l 2>/dev/null | grep -q "$SSH_KEY"; then
  info "Adding SSH key to agent (enter passphrase if prompted) ..."
  ssh-add "$SSH_KEY" || die "Failed to add SSH key: $SSH_KEY"
fi

# ── Preflight: SSH connectivity ────────────────────────────────────────────────
info "Checking SSH connectivity to $REMOTE_USER@$REMOTE_HOST ..."
if ! $SSH_CMD -o BatchMode=yes "$REMOTE_USER@$REMOTE_HOST" "echo ok" &>/dev/null; then
  die "Cannot reach $REMOTE_USER@$REMOTE_HOST. Check VPN, SSH key, or server status."
fi
success "SSH OK"

# ── Step 1: Push to GitHub ─────────────────────────────────────────────────────
cd "$SCRIPT_DIR"

info "Pushing local commits to GitHub (branch: $BRANCH) ..."
if [[ "$DRY_RUN" == true ]]; then
  warn "[dry-run] would run: git push origin $BRANCH"
else
  git push origin "$BRANCH" || die "git push failed. Commit your changes first."
fi

LOCAL_COMMIT=$(git rev-parse --short HEAD)
success "GitHub up to date — local HEAD: $LOCAL_COMMIT"

# ── Step 2a: Deploy via git pull (default) ─────────────────────────────────────
if [[ "$USE_RSYNC" == false ]]; then
  info "Pulling on server and rebuilding ..."
  REMOTE_CMD=$(cat <<EOF
set -e
export PATH="$REMOTE_RUBY:\$PATH"
cd $REMOTE_APP
git config --global --add safe.directory $REMOTE_APP 2>/dev/null || true
git fetch origin
git reset --hard origin/$BRANCH
git clean -fd
DEPLOY_COMMIT=\$(git rev-parse --short HEAD)
echo "DEPLOY_COMMIT=\$DEPLOY_COMMIT"
bundle config set --local without 'development test'
bundle install --quiet
SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production bundle exec rails assets:precompile --quiet
sudo systemctl restart puma
PUMA_STATUS=\$(sudo systemctl is-active puma)
echo "PUMA_STATUS=\$PUMA_STATUS"
EOF
)
  if [[ "$DRY_RUN" == true ]]; then
    warn "[dry-run] would SSH and run remote bundle/assets/restart commands"
  else
    OUTPUT=$($SSH_CMD "$REMOTE_USER@$REMOTE_HOST" "$REMOTE_CMD") || die "Remote deploy commands failed."
    echo "$OUTPUT"
    DEPLOY_COMMIT=$(echo "$OUTPUT" | grep '^DEPLOY_COMMIT=' | cut -d= -f2)
    PUMA_STATUS=$(echo "$OUTPUT" | grep '^PUMA_STATUS=' | cut -d= -f2)
  fi
fi

# ── Step 2b: Deploy via rsync ──────────────────────────────────────────────────
if [[ "$USE_RSYNC" == true ]]; then
  info "Syncing files via rsync ..."
  RSYNC_FLAGS="-az --delete"
  [[ "$DRY_RUN" == true ]] && RSYNC_FLAGS="$RSYNC_FLAGS --dry-run"

  for dir in app config db public; do
    rsync $RSYNC_FLAGS \
      -e "ssh -i $SSH_KEY -o ConnectTimeout=10" \
      "$SCRIPT_DIR/$dir/" \
      "$REMOTE_USER@$REMOTE_HOST:$REMOTE_APP/$dir/"
  done
  for f in Gemfile Gemfile.lock; do
    rsync $RSYNC_FLAGS \
      -e "ssh -i $SSH_KEY -o ConnectTimeout=10" \
      "$SCRIPT_DIR/$f" \
      "$REMOTE_USER@$REMOTE_HOST:$REMOTE_APP/$f"
  done

  info "Running bundle/assets/restart on server ..."
  REMOTE_CMD=$(cat <<EOF
set -e
export PATH="$REMOTE_RUBY:\$PATH"
cd $REMOTE_APP
DEPLOY_COMMIT=\$(git rev-parse --short HEAD 2>/dev/null || echo rsync)
echo "DEPLOY_COMMIT=\$DEPLOY_COMMIT"
bundle config set --local without 'development test'
bundle install --quiet
SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production bundle exec rails assets:precompile --quiet
sudo systemctl restart puma
PUMA_STATUS=\$(sudo systemctl is-active puma)
echo "PUMA_STATUS=\$PUMA_STATUS"
EOF
)
  if [[ "$DRY_RUN" == false ]]; then
    OUTPUT=$($SSH_CMD "$REMOTE_USER@$REMOTE_HOST" "$REMOTE_CMD") || die "Remote commands failed."
    echo "$OUTPUT"
    DEPLOY_COMMIT=$(echo "$OUTPUT" | grep '^DEPLOY_COMMIT=' | cut -d= -f2)
    PUMA_STATUS=$(echo "$OUTPUT" | grep '^PUMA_STATUS=' | cut -d= -f2)
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════${NC}"
echo -e "${GREEN} Deploy complete!${NC}"
echo -e "${GREEN}══════════════════════════════════${NC}"
echo -e "  Local commit : ${CYAN}$LOCAL_COMMIT${NC}"
[[ -n "${DEPLOY_COMMIT:-}" ]] && echo -e "  Server commit: ${CYAN}$DEPLOY_COMMIT${NC}"
[[ -n "${PUMA_STATUS:-}" ]]   && echo -e "  Puma status  : ${CYAN}$PUMA_STATUS${NC}"
echo ""
