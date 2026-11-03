# ADUalign

ADUalign checks whether a California property can fit an **Accessory Dwelling Unit (ADU)**. Search an address and it loads the parcel boundary, computes the setback-compliant buildable area, lets you place and validate an ADU on a satellite map, estimates the cost, and answers permitting and zoning questions with an AI advisor grounded in California HCD guidance.

- **Live:** [adualign.com](https://adualign.com)
- **Recognition:** 2nd Place Overall (113 teams), IrvineHacks 2026

> **Review snapshot.** This is a read-only copy of the ADUalign codebase, which is developed in a private repository, shared here for reference. History has been squashed to a single commit and internal docs have been removed. All rights reserved; no license is granted.

## What it does

1. **Find the lot.** Search an address; the backend fetches the parcel boundary (ReportAll), detects existing structures, and resolves the county (Mapbox).
2. **Compute what's buildable.** A Shapely/pyproj geometry engine applies setbacks and structure clearances to produce the buildable zone, and splits the lot into front, side and rear yards from a front-yard click.
3. **Design the ADU.** Place a detached or attached unit (rectangle, L, T or U profiles) on a satellite map; placement is validated live against setbacks, overlaps and the size limits that apply.
4. **Estimate the cost.** A cost model applies size, type and county multipliers plus automatic add-ons (solar mandate, fire-resilient materials, contingency) and optional complications.
5. **Ask the AI advisor.** A LangGraph pipeline checks the question with a guardrail, routes it, rewrites it with the project's context, retrieves and grades California HCD handbook passages (pgvector), falls back to vetted web search when the handbook isn't enough, and streams a cited answer.
6. **Generate a report.** A feasibility report covers the property overview, zoning and regulatory analysis, and a financial snapshot.

Usage is metered: map searches use credits from an idempotent Postgres ledger, and AI usage is capped by per-user cost budgets enforced with Redis reservations.

## Architecture

```
Next.js frontend (Vercel) ──HTTPS──►  FastAPI backend (Railway, Docker)
  Mapbox GL map + search                ├─ Geometry engine: Shapely / pyproj
  Supabase Auth (session)               ├─ LangGraph orchestrator → Corrective-RAG + finance agent
                                        ├─ Supabase Postgres + pgvector (projects, ledger, embeddings)
                                        ├─ Upstash Redis (parcel cache, rate limits, LLM budgets)
                                        └─ ReportAll (parcels), Mapbox (county), OpenRouter (LLM),
                                           Gemini (embeddings), Serper (web search)
```

| Area | Where to look |
|---|---|
| Parcel fetch, buildable-zone geometry, ADU placement | `backend/engine/`, `POST /analyze` in `backend/api/main.py` |
| AI advisor: guardrail → routing → RAG (rephrase, retrieve, grade, evidence check, web search, generate) | `backend/orchestrator/`, `backend/RAG_pipeline/` |
| LLM cost budgets (Redis reservations, pipelined), map credit ledger (atomic Postgres CTE) | `backend/api/rate_limiting/`, `backend/api/database/repository.py` |
| Cost estimates | `backend/financial_chatbot/` |
| Reports | `backend/api/report_composer.py`, `backend/api/routers/reports.py` |
| Map designer, chat UI, reports UI | `frontend/components/map/`, `frontend/components/rag-chat/`, `frontend/app/` |

The backend exposes 51 REST/SSE endpoints and has 550 pytest tests, including Postgres concurrency tests for the credit ledger.

## Running locally

Each service has a `.env.example` listing every variable it needs (placeholders only).

```bash
# Backend (Python 3.13, uv)
cd backend
uv sync
cp .env.example .env            # fill in real values
uv run uvicorn api.main:app --reload --port 8000
uv run pytest tests -q          # Postgres race tests run when TEST_POSTGRES_URL is set

# Frontend (Node 18+, pnpm)
cd frontend
pnpm install
cp .env.example .env.local      # fill in real values
pnpm dev                        # http://localhost:3000
```
