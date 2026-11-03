import importlib
import os
import sys
import types
from types import SimpleNamespace

import pytest
from fastapi import APIRouter
from shapely.geometry import Polygon

from api.cache.keys import build_recompute_request_id, rounded_lat_lng_id
from api.cache.redis_cache import set_cache_for_testing
from api.schemas import GeoJSONGeometry, RecomputeBuildableRequest
from engine import fire_hazard, geocoding, parcel


class FakeCache:
    def __init__(
        self,
        preload=None,
        get_error: Exception | None = None,
        set_error: Exception | None = None,
    ):
        self.data = dict(preload or {})
        self.get_error = get_error
        self.set_error = set_error
        self.set_calls: list[dict] = []
        self.get_calls: list[dict] = []

    async def get_json(self, key: str, *, resource: str):
        self.get_calls.append({"key": key, "resource": resource})
        if self.get_error is not None:
            raise self.get_error
        return self.data.get(key)

    async def set_json(
        self, key: str, value: dict, *, ttl_seconds: int, resource: str
    ) -> None:
        self.set_calls.append(
            {
                "key": key,
                "value": value,
                "ttl_seconds": ttl_seconds,
                "resource": resource,
            }
        )
        if self.set_error is not None:
            raise self.set_error
        self.data[key] = value


class DummyResponse:
    def __init__(self, payload: dict) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


@pytest.fixture(autouse=True)
def reset_cache_singleton():
    set_cache_for_testing(None)
    yield
    set_cache_for_testing(None)


def _parcel_geometry() -> Polygon:
    return Polygon(
        [
            (-117.0, 33.0),
            (-117.0, 33.01),
            (-116.99, 33.01),
            (-116.99, 33.0),
            (-117.0, 33.0),
        ]
    )


def _building_small() -> Polygon:
    return Polygon(
        [
            (-116.9995, 33.0005),
            (-116.9995, 33.0010),
            (-116.9990, 33.0010),
            (-116.9990, 33.0005),
            (-116.9995, 33.0005),
        ]
    )


def _building_large() -> Polygon:
    return Polygon(
        [
            (-116.9985, 33.0005),
            (-116.9985, 33.0025),
            (-116.9965, 33.0025),
            (-116.9965, 33.0005),
            (-116.9985, 33.0005),
        ]
    )


def test_build_reportall_params_uses_current_api_version(monkeypatch):
    monkeypatch.setattr(parcel, "REPORTALL_API_KEY", "test-key")

    params = parcel._build_reportall_params(34.29812, -118.52262, "test-key")

    assert params == {
        "client": "test-key",
        "spatial_intersect": "POINT(-118.52262 34.29812)",
        "si_srid": 4326,
        "rpp": 1,
        "v": 9,
    }


def test_redact_reportall_client_hides_credentials():
    url = (
        "https://reportallusa.com/api/parcels.php"
        "?client=secret-key&spatial_intersect=POINT%28-118.52262+34.29812%29"
        "&si_srid=4326&v=9"
    )

    redacted = parcel._redact_reportall_client(url)

    assert "secret-key" not in redacted
    assert "client=%5BREDACTED%5D" in redacted
    assert "spatial_intersect=POINT%28-118.52262+34.29812%29" in redacted


def test_credential_fingerprint_avoids_full_secret():
    fingerprint = parcel._credential_fingerprint("secret-key")

    # Opaque, stable, and leaks no recoverable part of the secret.
    assert fingerprint.startswith("sha256:")
    assert "secret" not in fingerprint
    assert fingerprint == parcel._credential_fingerprint("secret-key")
    assert fingerprint != parcel._credential_fingerprint("other-key")


@pytest.mark.anyio
async def test_fetch_parcel_cache_miss_then_set(monkeypatch):
    fake_cache = FakeCache()
    monkeypatch.setattr(parcel, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        parcel,
        "get_cache_settings",
        lambda: SimpleNamespace(redis_prefix="plotalign", redis_ttl_parcel_seconds=123),
    )
    monkeypatch.setattr(parcel, "_get_reportall_api_key", lambda: "test-key")

    payload = {
        "status": "OK",
        "results": [
            {
                "geom_as_wkt": _parcel_geometry().wkt,
                "apn": "parcel-123",
                "calculated_acreage": "0.25",
                "owner": "Owner",
                "site_address": "123 Main St",
            }
        ],
    }

    class DummyClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params, timeout):
            return DummyResponse(payload)

    monkeypatch.setattr(parcel.httpx, "AsyncClient", DummyClient)

    result = await parcel.fetch_parcel_by_coords(33.0, -117.0)

    assert result is not None
    assert result.apn == "parcel-123"
    assert len(fake_cache.set_calls) == 1
    assert fake_cache.set_calls[0]["ttl_seconds"] == 123
    assert fake_cache.set_calls[0]["resource"] == "parcel"


@pytest.mark.anyio
async def test_fetch_parcel_cache_hit_skips_http_and_recomputes_buildings(monkeypatch):
    parcel_key = "plotalign:v1:map:parcel_v2:33.00000:-117.00000"
    fake_cache = FakeCache(
        preload={
            parcel_key: {
                "polygon_wkt": _parcel_geometry().wkt,
                "apn": "parcel-123",
                "acreage": 0.25,
                "owner": "Owner",
                "address": "123 Main St",
            }
        }
    )
    monkeypatch.setattr(parcel, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        parcel,
        "get_cache_settings",
        lambda: SimpleNamespace(redis_prefix="plotalign", redis_ttl_parcel_seconds=123),
    )
    monkeypatch.setattr(parcel, "_get_reportall_api_key", lambda: "test-key")

    class FailingClient:
        async def __aenter__(self):
            raise AssertionError("HTTP client should not be used on cache hit")

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *args, **kwargs):
            raise AssertionError("HTTP client should not be used on cache hit")

    monkeypatch.setattr(parcel.httpx, "AsyncClient", FailingClient)

    result = await parcel.fetch_parcel_by_coords(
        33.0,
        -117.0,
        building_footprints=[_building_small(), _building_large()],
    )

    assert result is not None
    assert result.raw is None
    assert result.valid_building_geoms is not None
    assert len(result.valid_building_geoms) == 2
    assert result.primary_structure_sqft is not None
    assert result.secondary_structures_sqft is not None
    assert len(result.secondary_structures_sqft) == 1
    assert fake_cache.set_calls == []


@pytest.mark.anyio
async def test_fetch_parcel_redis_error_fails_open(monkeypatch):
    fake_cache = FakeCache(get_error=RuntimeError("redis down"))
    monkeypatch.setattr(parcel, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        parcel,
        "get_cache_settings",
        lambda: SimpleNamespace(redis_prefix="plotalign", redis_ttl_parcel_seconds=321),
    )
    monkeypatch.setattr(parcel, "_get_reportall_api_key", lambda: "test-key")

    payload = {
        "status": "OK",
        "results": [
            {
                "geom_as_wkt": _parcel_geometry().wkt,
                "apn": "parcel-123",
                "calculated_acreage": "0.25",
                "owner": "Owner",
                "site_address": "123 Main St",
            }
        ],
    }

    class DummyClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params, timeout):
            return DummyResponse(payload)

    monkeypatch.setattr(parcel.httpx, "AsyncClient", DummyClient)

    result = await parcel.fetch_parcel_by_coords(33.0, -117.0)

    assert result is not None
    assert len(fake_cache.set_calls) == 1
    assert fake_cache.set_calls[0]["ttl_seconds"] == 321


def _patch_reportall_payload(monkeypatch, payload):
    monkeypatch.setattr(parcel, "get_cache", lambda: FakeCache())
    monkeypatch.setattr(
        parcel,
        "get_cache_settings",
        lambda: SimpleNamespace(redis_prefix="plotalign", redis_ttl_parcel_seconds=1),
    )
    monkeypatch.setattr(parcel, "_get_reportall_api_key", lambda: "secret-key-123")

    class DummyClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params, timeout):
            return DummyResponse(payload)

    monkeypatch.setattr(parcel.httpx, "AsyncClient", DummyClient)


@pytest.mark.anyio
async def test_fetch_parcel_no_results_returns_none_without_logging_key(
    monkeypatch, caplog
):
    _patch_reportall_payload(
        monkeypatch,
        {
            "status": "OK",
            "count": 0,
            "results": [],
            "query": "client=secret-key-123&rpp=1",
        },
    )

    result = await parcel.fetch_parcel_by_coords(33.0, -117.0)

    assert result is None
    assert "secret-key-123" not in caplog.text


@pytest.mark.anyio
async def test_fetch_parcel_api_error_raises_without_logging_key(monkeypatch, caplog):
    _patch_reportall_payload(
        monkeypatch,
        {"status": "ERROR", "message": "bad", "query": "client=secret-key-123"},
    )

    with pytest.raises(parcel.ParcelServiceError):
        await parcel.fetch_parcel_by_coords(33.0, -117.0)

    assert "secret-key-123" not in caplog.text


@pytest.mark.anyio
async def test_fetch_parcel_missing_api_key_raises_before_cache(monkeypatch):
    fake_cache = FakeCache()
    monkeypatch.setattr(parcel, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(parcel, "_get_reportall_api_key", lambda: "")

    with pytest.raises(ValueError):
        await parcel.fetch_parcel_by_coords(33.0, -117.0)

    assert fake_cache.get_calls == []
    assert fake_cache.set_calls == []


@pytest.mark.anyio
async def test_lookup_county_by_coords_returns_district_name(monkeypatch):
    fake_cache = FakeCache()
    monkeypatch.setattr(geocoding, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        geocoding,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_county_seconds=654,
        ),
    )
    monkeypatch.setenv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "mapbox-token")

    payload = {
        "features": [
            {
                "properties": {
                    "context": {
                        "district": {"name": "Orange County"},
                    }
                }
            }
        ]
    }

    class DummyClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params, timeout=None):
            return DummyResponse(payload)

    monkeypatch.setattr(geocoding.httpx, "AsyncClient", DummyClient)

    result = await geocoding.lookup_county_by_coords(33.0, -117.0)

    assert result == "Orange County"
    assert len(fake_cache.set_calls) == 1
    assert fake_cache.set_calls[0]["ttl_seconds"] == 654
    assert fake_cache.set_calls[0]["resource"] == "county"


@pytest.mark.anyio
async def test_lookup_county_by_coords_cache_hit_skips_http(monkeypatch):
    county_key = "plotalign:v1:map:county:33.00000:-117.00000"
    fake_cache = FakeCache(preload={county_key: {"county": "Orange County"}})
    monkeypatch.setattr(geocoding, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        geocoding,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_county_seconds=654,
        ),
    )
    monkeypatch.setenv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "mapbox-token")

    class FailingClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            raise AssertionError("HTTP client should not be used on cache hit")

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, *args, **kwargs):
            raise AssertionError("HTTP client should not be used on cache hit")

    monkeypatch.setattr(geocoding.httpx, "AsyncClient", FailingClient)

    result = await geocoding.lookup_county_by_coords(33.0, -117.0)

    assert result == "Orange County"
    assert fake_cache.set_calls == []


@pytest.mark.anyio
async def test_lookup_county_by_coords_does_not_cache_empty_result(monkeypatch):
    fake_cache = FakeCache()
    monkeypatch.setattr(geocoding, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        geocoding,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_county_seconds=654,
        ),
    )
    monkeypatch.setenv("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", "mapbox-token")

    class DummyClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params, timeout=None):
            return DummyResponse({"features": []})

    monkeypatch.setattr(geocoding.httpx, "AsyncClient", DummyClient)

    result = await geocoding.lookup_county_by_coords(33.0, -117.0)

    assert result is None
    assert fake_cache.set_calls == []


@pytest.mark.anyio
async def test_fire_hazard_cache_hit_skips_http(monkeypatch):
    fire_key = "plotalign:v1:map:fire_hazard:33.00000:-117.00000"
    fake_cache = FakeCache(
        preload={
            fire_key: {
                "severity": "High",
                "zone_type": "SRA",
                "source_layer": "layer",
            }
        }
    )
    monkeypatch.setattr(fire_hazard, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        fire_hazard,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_fire_hazard_seconds=456,
        ),
    )

    class FailingClient:
        async def __aenter__(self):
            raise AssertionError("HTTP client should not be used on cache hit")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr(fire_hazard.httpx, "AsyncClient", FailingClient)

    result = await fire_hazard.check_fire_hazard(33.0, -117.0)

    assert result.severity == "High"
    assert fake_cache.set_calls == []


@pytest.mark.anyio
async def test_fire_hazard_unknown_result_is_not_cached(monkeypatch):
    fake_cache = FakeCache()
    monkeypatch.setattr(fire_hazard, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        fire_hazard,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_fire_hazard_seconds=456,
        ),
    )

    async def no_sleep(*args, **kwargs):
        return None

    monkeypatch.setattr("asyncio.sleep", no_sleep)

    class TimeoutClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params):
            raise fire_hazard.httpx.TimeoutException("timeout")

    monkeypatch.setattr(fire_hazard.httpx, "AsyncClient", TimeoutClient)

    result = await fire_hazard.check_fire_hazard(33.0, -117.0)

    assert result.severity == "Unknown"
    assert fake_cache.set_calls == []


@pytest.mark.anyio
async def test_fire_hazard_none_result_is_cached_with_ttl(monkeypatch):
    fake_cache = FakeCache()
    monkeypatch.setattr(fire_hazard, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        fire_hazard,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_fire_hazard_seconds=789,
        ),
    )

    responses = iter(
        [
            DummyResponse({"features": []}),
            DummyResponse({"features": []}),
        ]
    )

    class DummyClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params):
            return next(responses)

    monkeypatch.setattr(fire_hazard.httpx, "AsyncClient", DummyClient)

    result = await fire_hazard.check_fire_hazard(33.0, -117.0)

    assert result.severity == "None"
    assert len(fake_cache.set_calls) == 1
    assert fake_cache.set_calls[0]["ttl_seconds"] == 789


@pytest.mark.anyio
async def test_fire_hazard_redis_error_fails_open(monkeypatch):
    fake_cache = FakeCache(get_error=RuntimeError("redis down"))
    monkeypatch.setattr(fire_hazard, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        fire_hazard,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_fire_hazard_seconds=456,
        ),
    )

    responses = iter(
        [
            DummyResponse(
                {
                    "features": [
                        {"attributes": {"FHSZ_Descr": "Very High"}},
                    ]
                }
            )
        ]
    )

    class DummyClient:
        def __init__(self, timeout=None):
            self.timeout = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, params):
            return next(responses)

    monkeypatch.setattr(fire_hazard.httpx, "AsyncClient", DummyClient)

    result = await fire_hazard.check_fire_hazard(33.0, -117.0)

    assert result.severity == "Very High"
    assert len(fake_cache.set_calls) == 1


def _load_api_main(monkeypatch):
    os.environ.setdefault("SUPABASE_DATABASE_URL", "sqlite:///:memory:")
    for module_name in [
        "api.main",
        "api.authentication.auth",
        "api.routers.reports",
        "api.routers.listings",
        "RAG_pipeline",
        "financial_chatbot.router",
        "orchestrator.router",
        "listing_subagent.router",
    ]:
        sys.modules.pop(module_name, None)

    auth_stub = types.ModuleType("api.auth")
    auth_stub.router = APIRouter()
    auth_stub.get_current_user = lambda: {"id": "test-user"}
    reports_stub = types.ModuleType("api.routers.reports")
    reports_stub.router = APIRouter()
    reports_stub.util_router = APIRouter()
    listings_stub = types.ModuleType("api.routers.listings")
    listings_stub.router = APIRouter()
    rag_stub = types.ModuleType("RAG_pipeline")
    rag_stub.router = SimpleNamespace(router=APIRouter())
    financial_stub = types.ModuleType("financial_chatbot.router")
    financial_stub.router = APIRouter()
    orchestrator_stub = types.ModuleType("orchestrator.router")
    orchestrator_stub.router = APIRouter()
    listing_stub = types.ModuleType("listing_subagent.router")
    listing_stub.router = APIRouter()

    monkeypatch.setitem(sys.modules, "api.authentication.auth", auth_stub)
    monkeypatch.setitem(sys.modules, "api.routers.reports", reports_stub)
    monkeypatch.setitem(sys.modules, "api.routers.listings", listings_stub)
    monkeypatch.setitem(sys.modules, "RAG_pipeline", rag_stub)
    monkeypatch.setitem(sys.modules, "financial_chatbot.router", financial_stub)
    monkeypatch.setitem(sys.modules, "orchestrator.router", orchestrator_stub)
    monkeypatch.setitem(sys.modules, "listing_subagent.router", listing_stub)
    return importlib.import_module("api.main")


def _geojson_polygon(coords):
    return GeoJSONGeometry(type="Polygon", coordinates=[coords])


@pytest.mark.anyio
async def test_recompute_buildable_cache_hit_skips_recompute_and_uses_ttl(monkeypatch):
    api_main = _load_api_main(monkeypatch)
    fake_cache = FakeCache()
    monkeypatch.setattr(api_main, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        api_main,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_recompute_seconds=7200,
        ),
    )

    calls = {"compute": 0}

    def fake_compute_buildable_zone(property_poly, setback_ft, obstacle_polygons_wgs84):
        calls["compute"] += 1
        return property_poly

    def fake_get_buildable_area_sqft(
        property_poly, setback_ft, obstacle_polygons_wgs84
    ):
        return 456.7

    monkeypatch.setattr(api_main, "compute_buildable_zone", fake_compute_buildable_zone)
    monkeypatch.setattr(
        api_main, "get_buildable_area_sqft", fake_get_buildable_area_sqft
    )

    request = RecomputeBuildableRequest(
        property_geojson=_geojson_polygon(
            [
                [-117.0, 33.0],
                [-117.0, 33.01],
                [-116.99, 33.01],
                [-116.99, 33.0],
                [-117.0, 33.0],
            ]
        ),
        setback_ft=4.0,
        active_buildings=[
            _geojson_polygon(
                [
                    [-116.9995, 33.0005],
                    [-116.9995, 33.0010],
                    [-116.9990, 33.0010],
                    [-116.9990, 33.0005],
                    [-116.9995, 33.0005],
                ]
            ),
            _geojson_polygon(
                [
                    [-116.9985, 33.0005],
                    [-116.9985, 33.0015],
                    [-116.9975, 33.0015],
                    [-116.9975, 33.0005],
                    [-116.9985, 33.0005],
                ]
            ),
        ],
    )

    response1 = await api_main.recompute_buildable(request)
    response2 = await api_main.recompute_buildable(request)

    assert response1.buildable_area_sqft == 456.7
    assert response2.buildable_area_sqft == 456.7
    assert calls["compute"] == 1
    assert len(fake_cache.set_calls) == 1
    assert fake_cache.set_calls[0]["ttl_seconds"] == 7200


@pytest.mark.anyio
async def test_recompute_buildable_key_is_order_insensitive(monkeypatch):
    api_main = _load_api_main(monkeypatch)
    fake_cache = FakeCache()
    monkeypatch.setattr(api_main, "get_cache", lambda: fake_cache)
    monkeypatch.setattr(
        api_main,
        "get_cache_settings",
        lambda: SimpleNamespace(
            redis_prefix="plotalign",
            redis_ttl_recompute_seconds=7200,
        ),
    )

    calls = {"compute": 0}

    def fake_compute_buildable_zone(property_poly, setback_ft, obstacle_polygons_wgs84):
        calls["compute"] += 1
        return property_poly

    def fake_get_buildable_area_sqft(
        property_poly, setback_ft, obstacle_polygons_wgs84
    ):
        return 222.2

    monkeypatch.setattr(api_main, "compute_buildable_zone", fake_compute_buildable_zone)
    monkeypatch.setattr(
        api_main, "get_buildable_area_sqft", fake_get_buildable_area_sqft
    )

    building_a = _geojson_polygon(
        [
            [-116.9995, 33.0005],
            [-116.9995, 33.0010],
            [-116.9990, 33.0010],
            [-116.9990, 33.0005],
            [-116.9995, 33.0005],
        ]
    )
    building_b = _geojson_polygon(
        [
            [-116.9985, 33.0005],
            [-116.9985, 33.0015],
            [-116.9975, 33.0015],
            [-116.9975, 33.0005],
            [-116.9985, 33.0005],
        ]
    )
    property_geojson = _geojson_polygon(
        [
            [-117.0, 33.0],
            [-117.0, 33.01],
            [-116.99, 33.01],
            [-116.99, 33.0],
            [-117.0, 33.0],
        ]
    )
    request_a = RecomputeBuildableRequest(
        property_geojson=property_geojson,
        setback_ft=4.0,
        active_buildings=[building_a, building_b],
    )
    request_b = RecomputeBuildableRequest(
        property_geojson=property_geojson,
        setback_ft=4.0,
        active_buildings=[building_b, building_a],
    )

    response1 = await api_main.recompute_buildable(request_a)
    response2 = await api_main.recompute_buildable(request_b)

    assert response1.buildable_area_sqft == 222.2
    assert response2.buildable_area_sqft == 222.2
    assert calls["compute"] == 1


def test_cache_keys_are_stable():
    property_geojson = {
        "type": "Polygon",
        "coordinates": [
            [
                [-117.0, 33.0],
                [-117.0, 33.01],
                [-116.99, 33.01],
                [-116.99, 33.0],
                [-117.0, 33.0],
            ]
        ],
    }
    building_a = {
        "type": "Polygon",
        "coordinates": [
            [
                [-116.9995000001, 33.0005000001],
                [-116.9995000001, 33.0010000001],
                [-116.9990000001, 33.0010000001],
                [-116.9990000001, 33.0005000001],
                [-116.9995000001, 33.0005000001],
            ]
        ],
    }
    building_b = {
        "type": "Polygon",
        "coordinates": [
            [
                [-116.9985, 33.0005],
                [-116.9985, 33.0015],
                [-116.9975, 33.0015],
                [-116.9975, 33.0005],
                [-116.9985, 33.0005],
            ]
        ],
    }

    key_a = build_recompute_request_id(
        property_geojson=property_geojson,
        setback_ft=4.00000001,
        adu_type="detached",
        active_buildings=[building_a, building_b],
        primary_structure_geojson=None,
    )
    key_b = build_recompute_request_id(
        property_geojson=property_geojson,
        setback_ft=4.0,
        adu_type="detached",
        active_buildings=[building_b, building_a],
        primary_structure_geojson=None,
    )

    assert key_a == key_b
    assert rounded_lat_lng_id(
        33.0000001, -117.0000001, decimals=5
    ) == rounded_lat_lng_id(33.0, -117.0, decimals=5)


@pytest.mark.parametrize(
    ("bldg_sqft", "buildings", "expected"),
    [
        ("1810", "1", 1810.0),
        ("1810", None, 1810.0),
        ("1810", "2", None),
        ("0", "1", None),
        (None, None, None),
    ],
)
def test_parcel_base_home_sqft_guard(bldg_sqft, buildings, expected):
    record = {"geom_as_wkt": _parcel_geometry().wkt}
    if bldg_sqft is not None:
        record["bldg_sqft"] = bldg_sqft
    if buildings is not None:
        record["buildings"] = buildings

    parcel_base = parcel._parcel_base_from_api_result(record)

    assert parcel_base is not None
    assert parcel_base["home_sqft"] == expected


def test_parcel_cache_roundtrip_preserves_home_sqft():
    parcel_base = parcel._parcel_base_from_api_result(
        {"geom_as_wkt": _parcel_geometry().wkt, "bldg_sqft": "1810", "buildings": "1"}
    )
    assert parcel_base is not None

    restored = parcel._parcel_base_from_cache(parcel._parcel_base_to_cache(parcel_base))

    assert restored is not None
    assert restored["home_sqft"] == 1810.0


def test_parcel_cache_missing_home_sqft_key_is_none():
    # Entries cached before home_sqft existed must deserialize as unknown.
    stale_payload = {"polygon_wkt": _parcel_geometry().wkt, "apn": "parcel-123"}

    restored = parcel._parcel_base_from_cache(stale_payload)

    assert restored is not None
    assert restored["home_sqft"] is None
