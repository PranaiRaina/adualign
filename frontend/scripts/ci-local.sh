#!/usr/bin/env bash
# Mirror GitHub Actions CI locally for Plotalign-Frontend.
#
# Usage (from Plotalign-Frontend):
#   ./scripts/ci-local.sh

set -euo pipefail

FRONTEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '%s\n' "$1"
}

die() {
  log "ERROR: $1"
  exit 1
}

usage() {
  cat <<'EOF'
Run local CI checks that mirror Plotalign-Frontend/.github/workflows/ci.yml.

Options:
  -h, --help    Show this help

Environment (optional overrides):
  NEXT_PUBLIC_API_URL              Default: http://127.0.0.1:8000
  NEXT_PUBLIC_SUPABASE_URL         Default: https://stub.supabase.example
  NEXT_PUBLIC_SUPABASE_ANON_KEY    Default: stub-anon-key
  NEXT_PUBLIC_MAPBOX_TOKEN         Default: stub-mapbox-token
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h | --help)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1 (use --help)"
        ;;
    esac
  done
}

require_command() {
  local cmd="$1"
  local hint="$2"
  command -v "${cmd}" >/dev/null 2>&1 || die "${hint}"
}

run_frontend_ci() {
  require_command pnpm "Install pnpm: https://pnpm.io/installation"

  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:8000}"
  export NEXT_PUBLIC_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://stub.supabase.example}"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-stub-anon-key}"
  export NEXT_PUBLIC_MAPBOX_TOKEN="${NEXT_PUBLIC_MAPBOX_TOKEN:-stub-mapbox-token}"

  log ""
  log "=== Frontend CI (Plotalign-Frontend) ==="

  cd "${FRONTEND_ROOT}"

  log "-> pnpm install --frozen-lockfile"
  pnpm install --frozen-lockfile

  log "-> pnpm run format:check"
  pnpm run format:check

  log "-> pnpm run lint"
  pnpm run lint

  log "-> pnpm run type-check"
  pnpm run type-check

  log "-> pnpm run build"
  pnpm run build

  log "Frontend CI passed."
}

main() {
  parse_args "$@"

  log "Plotalign local CI"
  log "Frontend root: ${FRONTEND_ROOT}"

  run_frontend_ci

  log ""
  log "Frontend CI checks passed."
}

main "$@"
