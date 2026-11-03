import os
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("SUPABASE_DATABASE_URL", "sqlite:///./test-pagination.db")

from api.authentication.auth import get_current_user
from api.database.core import get_db
from api.routers.listings import router as listings_router
from api.routers.reports import router as reports_router


def _build_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(reports_router)
    app.include_router(listings_router)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="user-123")
    app.dependency_overrides[get_db] = lambda: object()
    return app


def test_projects_limit_above_max_rejected():
    client = TestClient(_build_test_app())

    response = client.get("/projects", params={"limit": 101})

    assert response.status_code == 422


def test_projects_negative_offset_rejected():
    client = TestClient(_build_test_app())

    response = client.get("/projects", params={"offset": -1})

    assert response.status_code == 422


def test_listings_limit_above_max_rejected():
    client = TestClient(_build_test_app())

    response = client.get("/listings/", params={"limit": 101})

    assert response.status_code == 422


def test_listings_negative_skip_rejected():
    client = TestClient(_build_test_app())

    response = client.get("/listings/", params={"skip": -1})

    assert response.status_code == 422
