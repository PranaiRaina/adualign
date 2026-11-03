# syntax=docker/dockerfile:1
# Backend image — FastAPI app served by uvicorn, managed by uv.
# Build context: Run from the backend repo root:
#   docker build -t plotalign-backend .

FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# 1) Install dependencies first (cached unless the lockfile changes).
COPY uv.lock pyproject.toml ./
RUN uv sync --frozen --no-install-project --no-dev

# 2) Copy the source and install the project itself.
COPY . .
RUN uv sync --frozen --no-dev

EXPOSE 8000

CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
