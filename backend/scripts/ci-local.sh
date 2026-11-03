#!/usr/bin/env bash
# Mirror GitHub Actions CI locally for Plotalign-Backend.
#
# Usage (from Plotalign-Backend):
#   ./scripts/ci-local.sh
#
# Backend checks need Postgres with pgvector on 127.0.0.1:5432. If nothing is
# listening there, this script starts pgvector/pgvector:pg16 in Docker (when available).

set -euo pipefail

BACKEND_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

POSTGRES_CONTAINER_NAME="${POSTGRES_CONTAINER_NAME:-plotalign-ci-postgres}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-pgvector/pgvector:pg16}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-postgres}"
POSTGRES_START_TIMEOUT_SECONDS="${POSTGRES_START_TIMEOUT_SECONDS:-30}"

POSTGRES_START_MODE=""

log() {
  printf '%s\n' "$1"
}

die() {
  log "ERROR: $1"
  exit 1
}

usage() {
  cat <<'EOF'
Run local CI checks that mirror Plotalign-Backend/.github/workflows/ci.yml.

Options:
  -h, --help    Show this help

Environment (optional overrides):
  POSTGRES_CONTAINER_NAME   Docker container name (default: plotalign-ci-postgres)
  POSTGRES_HOST             Postgres host (default: 127.0.0.1)
  POSTGRES_PORT             Postgres port (default: 5432)
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

is_postgres_reachable() {
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" >/dev/null 2>&1
    return $?
  fi

  nc -z "${POSTGRES_HOST}" "${POSTGRES_PORT}" >/dev/null 2>&1
}

wait_for_postgres() {
  local attempt=0

  while [ "${attempt}" -lt "${POSTGRES_START_TIMEOUT_SECONDS}" ]; do
    if is_postgres_reachable; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  return 1
}

docker_is_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

docker_container_exists() {
  docker ps -a --format '{{.Names}}' | grep -Fx "${POSTGRES_CONTAINER_NAME}" >/dev/null 2>&1
}

start_docker_postgres() {
  docker_is_available || return 1

  if docker_container_exists; then
    docker start "${POSTGRES_CONTAINER_NAME}" >/dev/null
  else
    docker run -d \
      --name "${POSTGRES_CONTAINER_NAME}" \
      -e "POSTGRES_USER=${POSTGRES_USER}" \
      -e "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
      -e "POSTGRES_DB=${POSTGRES_DB}" \
      -p "${POSTGRES_PORT}:5432" \
      "${POSTGRES_IMAGE}" >/dev/null
  fi

  POSTGRES_START_MODE="docker"
  wait_for_postgres
}

ensure_postgres() {
  if is_postgres_reachable; then
    POSTGRES_START_MODE="already-running"
    log "Using existing Postgres on ${POSTGRES_HOST}:${POSTGRES_PORT}."
    return 0
  fi

  log "Postgres not reachable; starting ${POSTGRES_IMAGE} via Docker..."
  start_docker_postgres || die "Could not start Postgres. Install Docker or run Postgres on ${POSTGRES_HOST}:${POSTGRES_PORT}."
  log "Postgres is ready on ${POSTGRES_HOST}:${POSTGRES_PORT}."
}

run_backend_ci() {
  require_command uv "Install uv: https://docs.astral.sh/uv/"
  require_command psql "Install the PostgreSQL client (psql)."

  ensure_postgres

  export SUPABASE_DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  export LANGCHAIN_TRACING_V2=false
  export LANGSMITH_TRACING=false
  export PGPASSWORD="${POSTGRES_PASSWORD}"

  log ""
  log "=== Backend CI (Plotalign-Backend) ==="

  cd "${BACKEND_ROOT}"

  log "-> uv python install 3.13"
  uv python install 3.13

  log "-> uv sync --frozen"
  uv sync --frozen

  log "-> apply base schema"
  psql -h "${POSTGRES_HOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 \
    -f docs/db_schema.github_actions.sql

  log "-> ensure_database_schema()"
  uv run python -c "from api.database.core import ensure_database_schema; ensure_database_schema()"

  log "-> ruff check"
  uv run ruff check .

  log "-> ruff format --check"
  uv run ruff format --check .

  log "-> mypy"
  uv run mypy api orchestrator financial_chatbot RAG_pipeline

  log "-> pytest"
  uv run pytest -q

  log "Backend CI passed."
}

main() {
  parse_args "$@"

  log "Plotalign local CI"
  log "Backend root: ${BACKEND_ROOT}"

  run_backend_ci

  log ""
  log "Backend CI checks passed."
}

main "$@"
