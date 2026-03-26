#!/usr/bin/env bash
# deploy_github.sh — Push local Nexus app changes to GitHub.
# Usage: ./deploy/deploy_github.sh [--message "commit message"] [--no-prompt]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
BRANCH="main"
COMMIT_MSG=""
NO_PROMPT=false

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[github]${NC} $*"; }
success() { echo -e "${GREEN}[github]${NC} $*"; }
warn()    { echo -e "${YELLOW}[github]${NC} $*"; }
die()     { echo -e "${RED}[github] ERROR:${NC} $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message|-m) shift; COMMIT_MSG="$1" ;;
    --no-prompt)  NO_PROMPT=true ;;
    -h|--help)
      echo "Usage: $0 [--message \"msg\"] [--no-prompt]"
      exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

cd "$REPO" || die "Repo not found: $REPO"

if ! git remote get-url origin &>/dev/null; then
  warn "No git remote 'origin' found."
  echo "To add one, run:"
  echo "  git remote add origin https://github.com/lukeledesma/Nexus.git"
  exit 1
fi

info "Repo: $REPO"
info "Remote: $(git remote get-url origin)"
echo ""

CHANGES=$(git status --porcelain)
if [[ -z "$CHANGES" ]]; then
  success "Nothing to commit — already up to date."
  CURRENT=$(git rev-parse --short HEAD)
  echo -e "  HEAD: ${CYAN}$CURRENT${NC}"
  exit 0
fi

echo "Changes:"
git status --short
echo ""

if [[ "$NO_PROMPT" == false ]]; then
  if [[ -z "$COMMIT_MSG" ]]; then
    printf "Commit message (leave blank to abort): "
    read -r COMMIT_MSG
    [[ -z "$COMMIT_MSG" ]] && die "Aborted — no commit message provided."
  fi
fi

info "Staging all changes..."
git add -A

info "Committing: \"$COMMIT_MSG\""
git commit -m "$COMMIT_MSG"

info "Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

COMMIT=$(git rev-parse --short HEAD)
echo ""
echo -e "${GREEN}══════════════════════════════════${NC}"
echo -e "${GREEN} GitHub push complete!${NC}"
echo -e "${GREEN}══════════════════════════════════${NC}"
echo -e "  Commit : ${CYAN}$COMMIT${NC}"
echo -e "  Branch : ${CYAN}$BRANCH${NC}"
echo -e "  Remote : ${CYAN}$(git remote get-url origin)${NC}"
echo ""
