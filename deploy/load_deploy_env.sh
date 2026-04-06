#!/usr/bin/env bash
# Sourced by deploy scripts. Loads deploy/deploy.local.env if present (gitignored).
_D="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$_D/deploy.local.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$_D/deploy.local.env"
  set +a
fi
unset _D
