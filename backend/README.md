# ADUalign - AI Powered ADU Feasibility API 🏡

This is the FastAPI backend for the ADUalign platform. it handles parcel fetching, reverse geocoding, building detection, and geometric feasibility analysis for Accessory Dwelling Units (ADUs).

## 🛠 Tech Stack
- **Framework:** [FastAPI](https://fastapi.tiangolo.com/)
- **Package Manager:** [uv](https://github.com/astral-sh/uv)
- **Geometry Logic:** [Shapely](https://shapely.readthedocs.io/), [GeoJSON](https://geojson.org/)
- **AI/LLM:** OpenAI (GPT-4), RAG Pipeline
- **Linter/Formatter:** [Ruff](https://github.com/astral-sh/ruff)

## 🚀 Getting Started

### 1. Prerequisites
- Python 3.12+
- `uv` installed (`curl -LsSf https://astral-sh/uv/install.sh | sh`)

### 2. Setup Environment
```bash
# Create and activate virtual environment
uv venv
source .venv/bin/activate

# Install dependencies
uv sync

# Configure environment variables (fill in real values; see comments inside)
cp .env.example .env
```
