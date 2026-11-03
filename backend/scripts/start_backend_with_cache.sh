#!/usr/bin/env bash

set -euo pipefail

REDIS_CONTAINER_NAME="${REDIS_CONTAINER_NAME:-plotalign-redis}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:7}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_START_TIMEOUT_SECONDS="${REDIS_START_TIMEOUT_SECONDS:-10}"
LOCAL_REDIS_LOG_FILE="${LOCAL_REDIS_LOG_FILE:-/tmp/plotalign-redis.log}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_LOG_DIR="${PROJECT_ROOT}/logs"
DEFAULT_BACKEND_LOG_FILE="${PROJECT_ROOT}/logs/local_debug.jsonl"
LOCAL_REDIS_PID=""
REDIS_START_MODE=""
CACHE_USES_LOCAL_REDIS="false"

log() {
  printf '%s\n' "$1"
}

env_file_has_value() {
  local key="$1"
  local env_file="${PROJECT_ROOT}/.env"

  [ -f "${env_file}" ] && grep -Eq "^[[:space:]]*${key}[[:space:]]*=[[:space:]]*[^[:space:]#]+" "${env_file}"
}

has_upstash_cache_config() {
  { [ -n "${UPSTASH_REDIS_REST_URL:-}" ] || env_file_has_value "UPSTASH_REDIS_REST_URL"; } &&
    { [ -n "${UPSTASH_REDIS_REST_TOKEN:-}" ] || env_file_has_value "UPSTASH_REDIS_REST_TOKEN"; }
}

is_redis_reachable() {
  nc -z "${REDIS_HOST}" "${REDIS_PORT}" >/dev/null 2>&1
}

wait_for_redis() {
  local attempt=0

  while [ "${attempt}" -lt "${REDIS_START_TIMEOUT_SECONDS}" ]; do
    if is_redis_reachable; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  return 1
}

docker_is_available() {
  command -v docker >/dev/null 2>&1
}

redis_server_is_available() {
  command -v redis-server >/dev/null 2>&1
}

redis_cli_is_available() {
  command -v redis-cli >/dev/null 2>&1
}

docker_container_exists() {
  docker ps -a --format '{{.Names}}' | grep -Fx "${REDIS_CONTAINER_NAME}" >/dev/null 2>&1
}

detect_local_redis_pid() {
  if ! redis_cli_is_available; then
    return 1
  fi

  local redis_pid
  redis_pid="$(redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" INFO server 2>/dev/null | awk -F: '/process_id/ {print $2}' | tr -d '\r')"
  if [ -z "${redis_pid}" ]; then
    return 1
  fi

  printf '%s\n' "${redis_pid}"
}

start_docker_redis() {
  if ! docker_is_available; then
    return 1
  fi

  if docker_container_exists; then
    docker start "${REDIS_CONTAINER_NAME}" >/dev/null
  else
    docker run -d \
      --name "${REDIS_CONTAINER_NAME}" \
      -p "${REDIS_PORT}:6379" \
      "${REDIS_IMAGE}" >/dev/null
  fi

  REDIS_START_MODE="docker"
  wait_for_redis
}

start_local_redis() {
  if ! redis_server_is_available; then
    return 1
  fi

  if redis-server --daemonize yes >/dev/null 2>&1; then
    REDIS_START_MODE="local"
    LOCAL_REDIS_PID="$(detect_local_redis_pid || true)"
    wait_for_redis
    return $?
  fi

  redis-server >"${LOCAL_REDIS_LOG_FILE}" 2>&1 &
  LOCAL_REDIS_PID=$!
  REDIS_START_MODE="local"
  wait_for_redis
}

start_redis() {
  if is_redis_reachable; then
    REDIS_START_MODE="already-running"
  elif start_docker_redis; then
    :
  elif start_local_redis; then
    :
  else
    log "ERROR: Unable to start Redis."
    log "Tried Docker container '${REDIS_CONTAINER_NAME}' and local 'redis-server'."
    log "Install Docker or Redis locally, then rerun this script."
    exit 1
  fi

  case "${REDIS_START_MODE}" in
    already-running)
      log "Using existing Redis on ${REDIS_HOST}:${REDIS_PORT}."
      ;;
    docker)
      log "Using Redis started via Docker on ${REDIS_HOST}:${REDIS_PORT}."
      ;;
    local)
      log "Using local redis-server on ${REDIS_HOST}:${REDIS_PORT}."
      ;;
    *)
      log "ERROR: Redis startup returned an unknown mode: ${REDIS_START_MODE}"
      exit 1
      ;;
  esac
}

start_cache_backend() {
  if has_upstash_cache_config; then
    log "Using Upstash Redis REST cache."
    return
  fi

  CACHE_USES_LOCAL_REDIS="true"
  log "Upstash Redis REST cache is not configured; local Redis is required for cache fallback."
}

ensure_local_redis_if_needed() {
  if [ "${CACHE_USES_LOCAL_REDIS}" = "true" ]; then
    start_redis
    return
  fi
}

stop_process() {
  local pid="$1"
  local name="$2"
  if [ -z "${pid}" ] || ! kill -0 "${pid}" >/dev/null 2>&1; then
    return
  fi

  log "Stopping ${name}..."
  kill "${pid}" >/dev/null 2>&1 || true

  local attempt=0
  while [ "${attempt}" -lt 5 ]; do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      return
    fi
    sleep 1
    attempt=$((attempt + 1))
  done

  log "${name} did not exit cleanly; forcing shutdown."
  kill -9 "${pid}" >/dev/null 2>&1 || true
}

stop_started_redis() {
  case "${REDIS_START_MODE}" in
    docker)
      log "Stopping Redis Docker container..."
      docker stop "${REDIS_CONTAINER_NAME}" >/dev/null 2>&1 || true
      ;;
    local)
      if [ -n "${LOCAL_REDIS_PID}" ] && kill -0 "${LOCAL_REDIS_PID}" >/dev/null 2>&1; then
        log "Stopping local redis-server..."
        kill "${LOCAL_REDIS_PID}" >/dev/null 2>&1 || true
      fi
      ;;
  esac
}

cleanup() {
  stop_started_redis
}

configure_local_logging() {
  export APP_ENV="${APP_ENV:-local}"
  export LOG_LEVEL="${LOG_LEVEL:-INFO}"
  export LOG_FILE_LEVEL="${LOG_FILE_LEVEL:-DEBUG}"
  export LOG_TO_FILE="${LOG_TO_FILE:-true}"
  export LOG_FILE_PATH="${LOG_FILE_PATH:-${DEFAULT_BACKEND_LOG_FILE}}"

  mkdir -p "${DEFAULT_LOG_DIR}"

  log "Logging: console=${LOG_LEVEL}, file=${LOG_FILE_LEVEL} -> ${LOG_FILE_PATH}"
}

main() {
  trap cleanup EXIT INT TERM

  start_cache_backend
  ensure_local_redis_if_needed

  cd "${PROJECT_ROOT}"
  configure_local_logging
  log "Starting backend server..."
  uv run uvicorn api.main:app --reload
}

main "$@"
