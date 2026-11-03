from __future__ import annotations

import asyncio
import datetime
import time
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from shapely.geometry import Polygon
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from api import main
from api.database.models import (
    Draft,
    Project,
    Report,
    User,
    UserServiceBalance,
    UserServiceTransaction,
)
from api.database.repository import (
    SERVICE_TYPE_ADDRESS_ACCESS,
    ServiceCreditRepository,
)
from api.rate_limiting import map_search_usage
from api.schemas import AnalyzeRequest, MapSearchUsage

USER_ID = "user-map-search"


@pytest.fixture
def session_factory(tmp_path, monkeypatch) -> Iterator[sessionmaker[Session]]:
    engine = create_engine(f"sqlite:///{tmp_path / 'map-search-usage.db'}")
    User.__table__.create(bind=engine)
    Project.__table__.create(bind=engine)
    Report.__table__.create(bind=engine)
    Draft.__table__.create(bind=engine)
    UserServiceBalance.__table__.create(bind=engine)
    UserServiceTransaction.__table__.create(bind=engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    with factory() as db:
        db.add(User(id=USER_ID, email="owner@example.com", name="Owner"))
        db.commit()
        ServiceCreditRepository.grant_credits(
            db,
            user_id=USER_ID,
            service_type=SERVICE_TYPE_ADDRESS_ACCESS,
            amount=3,
            reason="purchase",
            actor_type="system",
            idempotency_key="test-starting-credits",
        )

    monkeypatch.setattr(map_search_usage, "SessionLocal", factory)
    yield factory
    engine.dispose()


def test_map_search_debits_one_credit_and_dedupes(session_factory):
    charge = map_search_usage.reserve_map_search_charge(
        user_id=USER_ID,
        project_id=None,
        map_search_id="search-1",
    )

    assert charge.commit() == MapSearchUsage(
        charged=True,
        credits_charged=1,
        remaining_credits=2,
        status="charged",
    )

    duplicate = map_search_usage.reserve_map_search_charge(
        user_id=USER_ID,
        project_id=None,
        map_search_id="search-1",
    )
    assert duplicate.usage == MapSearchUsage(
        remaining_credits=2,
        status="deduped",
    )

    with session_factory() as db:
        balance = ServiceCreditRepository.get_balance(
            db, user_id=USER_ID, service_type=SERVICE_TYPE_ADDRESS_ACCESS
        )
        debits = (
            db.query(UserServiceTransaction)
            .filter(UserServiceTransaction.reason == "map_search_charge")
            .all()
        )
        assert balance is not None and balance.balance == 2
        assert len(debits) == 1
        assert debits[0].delta == -1


def test_map_search_failure_refunds_once(session_factory):
    charge = map_search_usage.reserve_map_search_charge(
        user_id=USER_ID,
        project_id=None,
        map_search_id="search-refund",
    )

    first = charge.cancel_failed()
    second = charge.cancel_failed()

    assert first.remaining_credits == 3
    assert second.remaining_credits == 3
    with session_factory() as db:
        refunds = (
            db.query(UserServiceTransaction)
            .filter(UserServiceTransaction.reason == "refund")
            .all()
        )
        assert len(refunds) == 1
        assert refunds[0].delta == 1


def test_map_search_existing_project_is_exempt(session_factory):
    with session_factory() as db:
        db.add(Project(id="project-status", user_id=USER_ID, status="project"))
        db.commit()

    charge = map_search_usage.reserve_map_search_charge(
        user_id=USER_ID,
        project_id="project-status",
        map_search_id="search-project",
    )

    assert charge.usage.status == "exempt_existing_project"
    assert charge.usage.charged is False


def test_map_search_without_credits_returns_402(session_factory):
    for index in range(3):
        map_search_usage.reserve_map_search_charge(
            user_id=USER_ID,
            project_id=None,
            map_search_id=f"spent-{index}",
        ).commit()

    with pytest.raises(HTTPException) as exc_info:
        map_search_usage.reserve_map_search_charge(
            user_id=USER_ID,
            project_id=None,
            map_search_id="over-limit",
        )

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail["service_type"] == "address_access"
    assert exc_info.value.detail["balance"] == 0


@pytest.mark.anyio
async def test_analyze_response_reports_credit_charge(monkeypatch):
    square = Polygon(
        [
            (-117.0, 33.0),
            (-117.0, 33.001),
            (-116.999, 33.001),
            (-116.999, 33.0),
            (-117.0, 33.0),
        ]
    )

    class DummyCharge:
        usage = MapSearchUsage(
            charged=True,
            credits_charged=1,
            remaining_credits=9,
            status="charged",
        )

        def commit(self):
            return self.usage

        def cancel_failed(self):
            return MapSearchUsage(status="failed", remaining_credits=10)

    async def fake_fetch_parcel_by_coords(*args, **kwargs):
        return SimpleNamespace(
            polygon=square,
            apn="parcel-123",
            address="123 Main St",
            primary_structure_sqft=None,
            home_sqft=1810.0,
            primary_structure_dimensions=None,
            secondary_structures_sqft=None,
            valid_building_geoms=[],
        )

    async def fake_lookup_county_by_coords(*args, **kwargs):
        return "Orange County"

    monkeypatch.setattr(main, "reserve_map_search_charge", lambda **_: DummyCharge())
    monkeypatch.setattr(main, "fetch_parcel_by_coords", fake_fetch_parcel_by_coords)
    monkeypatch.setattr(main, "lookup_county_by_coords", fake_lookup_county_by_coords)

    response = await main.analyze_property(
        AnalyzeRequest(
            lat=33.0,
            lng=-117.0,
            location="irvine_ca",
            building_footprints=[],
            map_search_id="search-response",
        ),
        current_user=User(
            id=USER_ID,
            email="owner@example.com",
            name="Owner",
            created_at=datetime.datetime.now(datetime.UTC),
        ),
    )

    assert response.map_search_usage.credits_charged == 1
    assert response.map_search_usage.remaining_credits == 9
    assert response.home_sqft == 1810.0


@pytest.mark.anyio
async def test_analyze_refunds_when_parcel_fetch_raises(monkeypatch):
    class DummyCharge:
        usage = MapSearchUsage(charged=True, credits_charged=1, status="charged")
        cancel_count = 0

        def commit(self):
            raise AssertionError("commit should not run")

        def cancel_failed(self):
            self.cancel_count += 1
            return MapSearchUsage(status="failed")

    charge = DummyCharge()

    async def fake_fetch_parcel_by_coords(*args, **kwargs):
        raise RuntimeError("ReportAll outage")

    monkeypatch.setattr(main, "reserve_map_search_charge", lambda **_: charge)
    monkeypatch.setattr(main, "fetch_parcel_by_coords", fake_fetch_parcel_by_coords)

    with pytest.raises(RuntimeError, match="ReportAll outage"):
        await main.analyze_property(
            AnalyzeRequest(
                lat=33.0,
                lng=-117.0,
                location="irvine_ca",
                building_footprints=[],
                map_search_id="search-fetch-error",
            ),
            current_user=User(id=USER_ID, email="owner@example.com", name="Owner"),
        )

    assert charge.cancel_count == 1


@pytest.mark.anyio
async def test_analyze_returns_503_and_refunds_when_parcel_service_fails(monkeypatch):
    class DummyCharge:
        usage = MapSearchUsage(charged=True, credits_charged=1, status="charged")
        cancel_count = 0

        def commit(self):
            raise AssertionError("commit should not run")

        def cancel_failed(self):
            self.cancel_count += 1
            return MapSearchUsage(status="failed")

    charge = DummyCharge()

    async def fake_fetch_parcel_by_coords(*args, **kwargs):
        raise main.ParcelServiceError("ReportAll HTTP 401")

    monkeypatch.setattr(main, "reserve_map_search_charge", lambda **_: charge)
    monkeypatch.setattr(main, "fetch_parcel_by_coords", fake_fetch_parcel_by_coords)

    with pytest.raises(HTTPException) as exc_info:
        await main.analyze_property(
            AnalyzeRequest(
                lat=33.0,
                lng=-117.0,
                location="irvine_ca",
                building_footprints=[],
                map_search_id="search-service-error",
            ),
            current_user=User(id=USER_ID, email="owner@example.com", name="Owner"),
        )

    assert exc_info.value.status_code == 503
    assert charge.cancel_count == 1


def _analyze_fakes(
    monkeypatch, *, parcel_found=True, io_delay_s=0.2, county_delay_s=None
):
    """Stub /analyze I/O with fixed latencies; returns county call records."""
    square = Polygon(
        [(-117.0, 33.0), (-117.0, 33.001), (-116.999, 33.001), (-116.999, 33.0)]
    )
    county_calls = {"started": 0, "finished": 0}

    class DummyCharge:
        usage = MapSearchUsage(status="not_chargeable")

        def commit(self):
            return self.usage

        def cancel_failed(self):
            return MapSearchUsage(status="failed")

    async def fake_fetch_parcel_by_coords(*args, **kwargs):
        await asyncio.sleep(io_delay_s)
        if not parcel_found:
            return None
        return SimpleNamespace(
            polygon=square,
            apn=None,
            address=None,
            primary_structure_sqft=None,
            home_sqft=None,
            primary_structure_dimensions=None,
            secondary_structures_sqft=None,
            valid_building_geoms=[],
        )

    async def fake_lookup_county_by_coords(*args, **kwargs):
        county_calls["started"] += 1
        await asyncio.sleep(io_delay_s if county_delay_s is None else county_delay_s)
        county_calls["finished"] += 1
        return "Orange County"

    monkeypatch.setattr(main, "reserve_map_search_charge", lambda **_: DummyCharge())
    monkeypatch.setattr(main, "fetch_parcel_by_coords", fake_fetch_parcel_by_coords)
    monkeypatch.setattr(main, "lookup_county_by_coords", fake_lookup_county_by_coords)
    return county_calls


_ANALYZE_REQUEST = AnalyzeRequest(
    lat=33.0, lng=-117.0, location="irvine_ca", building_footprints=[]
)


@pytest.mark.anyio
async def test_analyze_overlaps_county_lookup_with_parcel_fetch(monkeypatch):
    _analyze_fakes(monkeypatch, io_delay_s=0.2)

    start = time.perf_counter()
    response = await main.analyze_property(
        _ANALYZE_REQUEST,
        current_user=User(id=USER_ID, email="owner@example.com", name="Owner"),
    )
    elapsed = time.perf_counter() - start

    assert response.county == "Orange County"
    # Sequential would take >= 0.4s (0.2 parcel + 0.2 county).
    assert elapsed < 0.35


@pytest.mark.anyio
async def test_analyze_cancels_county_lookup_when_no_parcel(monkeypatch):
    county_calls = _analyze_fakes(
        monkeypatch, parcel_found=False, io_delay_s=0.05, county_delay_s=0.1
    )

    with pytest.raises(HTTPException) as exc_info:
        await main.analyze_property(
            _ANALYZE_REQUEST,
            current_user=User(id=USER_ID, email="owner@example.com", name="Owner"),
        )
    await asyncio.sleep(0.2)  # longer than the county delay

    assert exc_info.value.status_code == 404
    assert county_calls["finished"] == 0


def test_analyze_request_requires_coordinates():
    with pytest.raises(ValidationError):
        AnalyzeRequest(
            location="irvine_ca",
            building_footprints=[],
        )


def test_analyze_request_rejects_drawn_boundary_without_coordinates():
    # user_drawn_geojson is no longer a supported input mode; a request
    # carrying only a drawn polygon must fail for missing lat/lng.
    with pytest.raises(ValidationError):
        AnalyzeRequest.model_validate(
            {
                "location": "irvine_ca",
                "building_footprints": [],
                "user_drawn_geojson": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-117.0, 33.0],
                            [-117.0, 33.001],
                            [-116.999, 33.001],
                            [-116.999, 33.0],
                            [-117.0, 33.0],
                        ]
                    ],
                },
            }
        )
