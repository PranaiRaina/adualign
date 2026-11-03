"""
FastAPI application for the ADU Feasibility Engine.

Endpoint: POST /analyze
Accepts lat/lng coordinates, fetches the parcel boundary from Regrid,
detects obstacles via LangSAM, applies zoning setbacks, and returns
the full analysis with renderable GeoJSON layers.
"""
# ruff: noqa: E402

from dotenv import load_dotenv

load_dotenv()

import asyncio
import logging
import os
from typing import Any, cast

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from shapely.geometry import MultiPolygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import Polygon
from starlette.concurrency import run_in_threadpool

from engine.geometry import (
    shapely_to_geojson,
    calculate_area_sqft,
    compute_buildable_zone,
    compute_attached_buildable_zone,
    get_buildable_area_sqft,
    get_attached_buildable_area_sqft,
    buffer_wgs84_by_feet,
    partition_yards,
    geojson_to_shapely,
)
from engine.geometry import DetectedObstacle as EngineObstacle
from engine.geocoding import lookup_county_by_coords
from engine.parcel import ParcelServiceError, fetch_parcel_by_coords

from RAG_pipeline import router as rag_router
from financial_chatbot.router import router as financial_router
from orchestrator.router import router as orchestrator_router
from listing_subagent.router import router as editor_router

from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    GeoJSONGeometry,
    DetectedObstacle as ApiObstacle,
    RecomputeBuildableRequest,
    RecomputeBuildableResponse,
    PartitionYardsRequest,
    PartitionYardsResponse,
    FireHazardInfo,
)
from .rate_limiting.map_search_usage import (
    reserve_map_search_charge,
)
from .cache.keys import build_cache_key, build_recompute_request_id
from .cache.redis_cache import get_cache
from .config.cache_settings import get_cache_settings
from .config.zoning_rules import get_zoning_rule
from .authentication.auth import router as auth_router, get_current_user
from .database.models import User
from .errors import ExceptionSanitizerMiddleware, GENERIC_ERROR_MESSAGE
from .http_client import close_shared_async_client
from .logging_config import RequestIdMiddleware, setup_logging
from .routers.reports import (
    router as reports_router,
    util_router as reports_utils_router,
)
from .routers.listings import router as listings_router
from .routers.usage import router as usage_router
from .routers.admin import router as admin_router
from .routers.internal import router as internal_router
from .routers.feedback import router as feedback_router

setup_logging()
logger = logging.getLogger(__name__)

MANUAL_FIRE_HAZARD_SEVERITY = "Unknown"
MANUAL_FIRE_HAZARD_ZONE_TYPE = "Manual"


def _as_polygonal(geom: BaseGeometry) -> Polygon | MultiPolygon:
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    raise TypeError(f"Expected polygonal geometry, got {type(geom).__name__}")


def _as_polygon(geom: BaseGeometry) -> Polygon:
    if isinstance(geom, Polygon):
        return geom
    raise TypeError(f"Expected Polygon, got {type(geom).__name__}")


def _primary_polygon(geom: Polygon | MultiPolygon) -> Polygon:
    if isinstance(geom, Polygon):
        return geom
    return max(geom.geoms, key=lambda candidate: candidate.area)


# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ADU Feasibility Engine",
    version="1.0.0",
    description="Fully automated ADU feasibility analysis from lat/lng.",
)

# Frontend origins allowed to call this API. Production/stable Vercel domains
# are listed explicitly; the regex additionally admits Vercel preview
# deployments (e.g. adualign-frontend-<hash>-<team>.vercel.app).
# Override/extend via a comma-separated CORS_ALLOWED_ORIGINS env var.
_default_allowed_origins = [
    "https://adualign.com",
    "https://www.adualign.com",
    "https://adualign-frontend.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_env_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]
ALLOWED_ORIGINS = _env_origins or _default_allowed_origins
# ponytail: matches any team slug for the adualign-frontend project's previews;
# pin the Vercel team slug (…-<team>\.vercel\.app) if you want it tighter.
VERCEL_PREVIEW_ORIGIN_REGEX = r"https://adualign-frontend-[a-z0-9-]+\.vercel\.app"

# Innermost user middleware (added first): its sanitized-500 response flows back
# out through CORS + request-id so it keeps their headers and the request id.
app.add_middleware(ExceptionSanitizerMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=VERCEL_PREVIEW_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestIdMiddleware)

app.include_router(auth_router)
app.include_router(rag_router.router)
app.include_router(financial_router)
app.include_router(orchestrator_router)
app.include_router(editor_router)
app.include_router(reports_utils_router)
app.include_router(reports_router)
app.include_router(listings_router)
app.include_router(usage_router)
app.include_router(admin_router)
app.include_router(internal_router)
app.include_router(feedback_router)


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_shared_async_client()


@app.on_event("startup")
def startup():
    # Schema migration is NOT run here. It races across replicas and couples
    # deploys to migrations. Run it once per deploy as a one-shot step instead:
    #     uv run python scripts/migrate.py
    #
    # Scheduled usage resets run via Supabase pg_cron hitting
    # POST /internal/usage-resets/run every 15 minutes. A catch-up sweep runs
    # here in the background in case the app was down when a reset was due.
    import threading

    from api.rate_limiting.usage_resets import reset_due_chat_usage

    def _catchup() -> None:
        try:
            reset_due_chat_usage()
        except Exception as exc:
            logger.warning("Usage reset catch-up sweep failed: %s", exc)

    threading.Thread(target=_catchup, name="usage-reset-catchup", daemon=True).start()
    logger.info("ADU Feasibility Engine starting up...")


# Cost estimates
_COST_PER_SQFT_LOW = 200.0
_COST_PER_SQFT_HIGH = 400.0
# ---------------------------------------------------------------------------
# Main endpoint
# ---------------------------------------------------------------------------


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_property(
    req: AnalyzeRequest,
    current_user: User = Depends(get_current_user),
) -> AnalyzeResponse:
    """
    Fully automated ADU feasibility analysis.

    Pipeline:
      1. Resolve parcel boundary via ReportAll.
      2. Detect obstacles via LangSAM.
      3. Apply zoning setbacks + subtract obstacles.
      4. Return renderable GeoJSON layers + stats.
    """
    # -- Resolve zoning rules ------------------------------------------------
    try:
        zoning = get_zoning_rule(req.location)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # -- Resolve parcel boundary via ReportAll --------------------------------
    parcel_source = "reportall"
    detected_buildings_geojson: list[GeoJSONGeometry] = []

    logger.info(f"Auto-fetching parcel from ReportAll: lat={req.lat}, lng={req.lng}")
    map_search_charge = await run_in_threadpool(
        reserve_map_search_charge,
        user_id=cast(str, current_user.id),
        project_id=req.project_id,
        map_search_id=req.map_search_id,
    )
    map_search_usage = map_search_charge.usage

    # County depends only on lat/lng, so overlap its cache/Mapbox round trip
    # with the ReportAll fetch instead of running it afterwards. Started after
    # the credit reservation so a 402 never triggers a wasted Mapbox call.
    county_task = asyncio.create_task(lookup_county_by_coords(req.lat, req.lng))

    charge_resolved = False
    try:
        # Convert the frontend's raw GeoJSON dictionaries into Shapely objects
        shapely_buildings = []
        for feat in req.building_footprints:
            try:
                # Assuming the geometries sent are dictionaries (representing GeoJSON)
                s_geom = geojson_to_shapely(
                    {
                        "type": feat.type,
                        "coordinates": feat.coordinates,
                    }
                )
                if s_geom.is_valid:
                    shapely_buildings.append(s_geom)
            except Exception as e:
                logger.warning(f"Skipping invalid frontend building geometry: {e}")

        try:
            parcel_data = await fetch_parcel_by_coords(
                req.lat, req.lng, building_footprints=shapely_buildings
            )
        except ParcelServiceError:
            failed_usage = await run_in_threadpool(map_search_charge.cancel_failed)
            charge_resolved = True
            raise HTTPException(
                status_code=503,
                detail={
                    "message": "Parcel data is temporarily unavailable. Please try again in a few minutes.",
                    "map_search_usage": failed_usage.model_dump(mode="json"),
                },
            )
        if parcel_data is None:
            failed_usage = await run_in_threadpool(map_search_charge.cancel_failed)
            charge_resolved = True
            raise HTTPException(
                status_code=404,
                detail={
                    "message": "No parcel found at this location. Try a more specific address or a nearby property.",
                    "map_search_usage": failed_usage.model_dump(mode="json"),
                },
            )
        map_search_usage = map_search_charge.commit()
        charge_resolved = True
    except BaseException:
        county_task.cancel()
        raise
    finally:
        if not charge_resolved:
            await run_in_threadpool(map_search_charge.cancel_failed)
    property_poly = _as_polygonal(parcel_data.polygon)
    parcel_apn = parcel_data.apn
    parcel_address = parcel_data.address
    county = await county_task

    # Extract the building measurements if we found any
    primary_sqft = parcel_data.primary_structure_sqft
    primary_dims = parcel_data.primary_structure_dimensions
    secondary_sqft = parcel_data.secondary_structures_sqft

    if parcel_data.valid_building_geoms:
        for bg in parcel_data.valid_building_geoms:
            bg_geojson = shapely_to_geojson(bg)
            detected_buildings_geojson.append(
                GeoJSONGeometry(
                    type=bg_geojson["type"],
                    coordinates=bg_geojson["coordinates"],
                )
            )

    fire_hazard_info = FireHazardInfo(
        severity=MANUAL_FIRE_HAZARD_SEVERITY,
        zone_type=MANUAL_FIRE_HAZARD_ZONE_TYPE,
    )

    if not property_poly.is_valid:
        property_poly = _as_polygonal(property_poly.buffer(0))

    # -- Calculate property area ---------------------------------------------
    property_area_sqft = calculate_area_sqft(property_poly)

    # -- Compute buildable zone (Safe Zone) ----------------------------------
    setback = min(zoning.setback_side_ft, zoning.setback_rear_ft)
    obstacle_details: list[EngineObstacle] = []
    obstacle_polygons_wgs84: list[Polygon | MultiPolygon] = []

    # Building Separation Buffer: 6 feet per user requirement
    if parcel_data and parcel_data.valid_building_geoms:
        for i, b_wgs in enumerate(parcel_data.valid_building_geoms):
            try:
                # Expand the building by 6 feet to create the "no-build" separation zone
                b_buffered_wgs84 = buffer_wgs84_by_feet(b_wgs, 6.0, property_poly)
                if b_buffered_wgs84 is None:
                    continue
                obstacle_polygons_wgs84.append(b_buffered_wgs84)

                # Add to official obstructions report for HUD visibility
                obstacle_details.append(
                    EngineObstacle(
                        name=f"Building Separation ({i + 1})",
                        polygon_wgs84=_as_polygon(
                            b_buffered_wgs84
                            if isinstance(b_buffered_wgs84, Polygon)
                            else max(b_buffered_wgs84.geoms, key=lambda g: g.area)
                        ),
                        area_sqft=calculate_area_sqft(
                            b_buffered_wgs84
                            if isinstance(b_buffered_wgs84, Polygon)
                            else max(b_buffered_wgs84.geoms, key=lambda g: g.area)
                        ),
                        confidence=1.0,
                    )
                )
            except Exception as e:
                logger.warning(f"Could not buffer building for separation: {e}")

    property_polygon = _primary_polygon(property_poly)
    buildable_zone = compute_buildable_zone(
        property_polygon, setback, obstacle_polygons_wgs84
    )
    buildable_area = get_buildable_area_sqft(
        property_polygon,
        setback,
        obstacle_polygons_wgs84,
        precomputed_zone=buildable_zone,
    )

    # -- Convert engine obstacles to API models -----------------------------
    final_obstacles = []
    for obs in obstacle_details:
        obs_geojson_raw = shapely_to_geojson(obs.polygon_wgs84)
        final_obstacles.append(
            ApiObstacle(
                name=obs.name,
                area_sqft=round(obs.area_sqft, 1),
                confidence=obs.confidence,
                geojson=GeoJSONGeometry(
                    type=obs_geojson_raw["type"],
                    coordinates=obs_geojson_raw["coordinates"],
                ),
            )
        )

    # -- Build response GeoJSON layers ---------------------------------------
    property_geojson_raw = shapely_to_geojson(property_poly)
    property_geojson = GeoJSONGeometry(
        type=property_geojson_raw["type"],
        coordinates=property_geojson_raw["coordinates"],
    )
    unbuildable_geojson: GeoJSONGeometry | None = None

    # -- Determine validity --------------------------------------------------
    if buildable_zone is None or buildable_area < zoning.min_sqft:
        # If nothing is buildable, the entire property is the unbuildable zone
        unbuildable_geojson = property_geojson
        return AnalyzeResponse(
            is_valid=False,
            message=(
                f"Insufficient buildable area ({buildable_area:.0f} sq ft). "
                f"Minimum required: {zoning.min_sqft:.0f} sq ft after "
                f"{setback}-ft setbacks and obstacle clearance."
            ),
            property_geojson=property_geojson,
            buildable_zone_geojson=None,
            unbuildable_zone_geojson=unbuildable_geojson,
            obstacles=final_obstacles,
            property_area_sqft=round(property_area_sqft, 1),
            buildable_area_sqft=round(buildable_area, 1),
            setback_ft=setback,
            max_adu_sqft=zoning.max_sqft_detached,
            parcel_source=parcel_source,
            apn=parcel_apn,
            parcel_address=parcel_address,
            county=county,
            detected_buildings=detected_buildings_geojson,
            fire_hazard=fire_hazard_info,
            map_search_usage=map_search_usage,
        )

    effective_buildable = min(buildable_area, zoning.max_sqft_detached)
    est_cost_low = round(effective_buildable * _COST_PER_SQFT_LOW, 2)
    est_cost_high = round(effective_buildable * _COST_PER_SQFT_HIGH, 2)

    zone_geojson_raw = shapely_to_geojson(buildable_zone)
    zone_geojson = GeoJSONGeometry(
        type=zone_geojson_raw["type"],
        coordinates=zone_geojson_raw["coordinates"],
    )

    # Compute the unbuildable zone (Property - Buildable)
    try:
        unbuildable_poly = _as_polygonal(property_poly.difference(buildable_zone))
        unbuildable_geojson_raw = shapely_to_geojson(unbuildable_poly)
        unbuildable_geojson = GeoJSONGeometry(
            type=unbuildable_geojson_raw["type"],
            coordinates=unbuildable_geojson_raw["coordinates"],
        )
    except Exception as e:
        logger.warning(f"Could not compute unbuildable zone: {e}")

    return AnalyzeResponse(
        is_valid=True,
        message=(
            f"ADU eligible! {effective_buildable:,.0f} sq ft of buildable space. "
            f"Max ADU allowed: {zoning.max_sqft_detached:,.0f} sq ft."
        ),
        property_geojson=property_geojson,
        buildable_zone_geojson=zone_geojson,
        unbuildable_zone_geojson=unbuildable_geojson,
        obstacles=final_obstacles,
        property_area_sqft=round(property_area_sqft, 1),
        buildable_area_sqft=round(effective_buildable, 1),
        setback_ft=setback,
        max_adu_sqft=zoning.max_sqft_detached,
        est_cost_low=est_cost_low,
        est_cost_high=est_cost_high,
        parcel_source=parcel_source,
        apn=parcel_apn,
        parcel_address=parcel_address,
        county=county,
        primary_structure_sqft=primary_sqft,
        home_sqft=parcel_data.home_sqft,
        primary_structure_dimensions=primary_dims,
        secondary_structures_sqft=secondary_sqft,
        detected_buildings=detected_buildings_geojson,
        fire_hazard=fire_hazard_info,
        map_search_usage=map_search_usage,
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/public-config")
def public_config():
    """Unauthenticated marketing/config numbers the frontend displays.

    Served from the same constants that enforce them so UI copy can't drift.
    """
    from api.database.repository import SIGNUP_ADDRESS_CREDIT_AMOUNT

    return {"signup_address_credits": SIGNUP_ADDRESS_CREDIT_AMOUNT}


# ---------------------------------------------------------------------------
# Recompute buildable zone (lightweight, no parcel fetch)
# ---------------------------------------------------------------------------


@app.post("/recompute-buildable", response_model=RecomputeBuildableResponse)
async def recompute_buildable(
    req: RecomputeBuildableRequest,
    current_user: User = Depends(get_current_user),
) -> RecomputeBuildableResponse:
    """Recompute the buildable zone using only the active (non-disabled) buildings.

    When ``adu_type`` is ``'attached'`` and a ``primary_structure_geojson`` is
    provided the endpoint uses :func:`compute_attached_buildable_zone` which
    does **not** apply a clearance buffer around the primary structure (the ADU
    is meant to attach directly to it).
    """
    from shapely.geometry import shape

    try:
        property_poly = cast(
            Polygon,
            shape(
                {
                    "type": req.property_geojson.type,
                    "coordinates": req.property_geojson.coordinates,
                }
            ),
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid property geometry.")

    cache_settings = get_cache_settings()
    recompute_cache_key = _build_recompute_cache_key(
        cache_settings.redis_prefix,
        req,
    )
    cached_response = await _get_cached_recompute_response(recompute_cache_key)
    if cached_response is not None:
        return cached_response

    # ── Attached mode ──────────────────────────────────────────────────
    if req.adu_type == "attached" and req.primary_structure_geojson is not None:
        try:
            primary_poly = geojson_to_shapely(
                {
                    "type": req.primary_structure_geojson.type,
                    "coordinates": req.primary_structure_geojson.coordinates,
                }
            )
        except Exception:
            raise HTTPException(
                status_code=400,
                detail="Invalid primary structure geometry.",
            )

        # Secondary obstacles = active_buildings minus the primary
        secondary_obstacles: list[Polygon | MultiPolygon] = []
        for bg in req.active_buildings:
            try:
                b_wgs = geojson_to_shapely(
                    {"type": bg.type, "coordinates": bg.coordinates}
                )
                secondary_obstacles.append(b_wgs)
            except Exception as e:
                logger.warning(f"Skipping invalid building in attached recompute: {e}")

        buildable_zone = compute_attached_buildable_zone(
            property_poly,
            req.setback_ft,
            primary_poly,
            secondary_obstacles,
        )
        buildable_area = get_attached_buildable_area_sqft(
            property_poly,
            req.setback_ft,
            primary_poly,
            secondary_obstacles,
        )

    # ── Detached mode (default) ────────────────────────────────────────
    else:
        obstacle_polygons_wgs84 = []
        for bg in req.active_buildings:
            try:
                b_wgs = geojson_to_shapely(
                    {"type": bg.type, "coordinates": bg.coordinates}
                )
                buffered = buffer_wgs84_by_feet(b_wgs, 6.0, property_poly)
                if buffered is not None:
                    obstacle_polygons_wgs84.append(buffered)
            except Exception as e:
                logger.warning(f"Skipping invalid building in recompute: {e}")

        buildable_zone = compute_buildable_zone(
            property_poly, req.setback_ft, obstacle_polygons_wgs84
        )
        buildable_area = get_buildable_area_sqft(
            property_poly, req.setback_ft, obstacle_polygons_wgs84
        )

    # ── Build GeoJSON response ─────────────────────────────────────────
    zone_geojson: GeoJSONGeometry | None = None
    unbuildable_geojson: GeoJSONGeometry | None = None

    if buildable_zone is not None:
        zone_raw = shapely_to_geojson(buildable_zone)
        zone_geojson = GeoJSONGeometry(
            type=zone_raw["type"], coordinates=zone_raw["coordinates"]
        )

        try:
            unbuildable_poly = _as_polygonal(property_poly.difference(buildable_zone))
            unbuildable_raw = shapely_to_geojson(unbuildable_poly)
            unbuildable_geojson = GeoJSONGeometry(
                type=unbuildable_raw["type"], coordinates=unbuildable_raw["coordinates"]
            )
        except Exception:
            pass

    response = RecomputeBuildableResponse(
        buildable_zone_geojson=zone_geojson,
        unbuildable_zone_geojson=unbuildable_geojson,
        buildable_area_sqft=round(buildable_area, 1),
    )
    await _cache_recompute_response(
        recompute_cache_key,
        response,
        cache_settings.redis_ttl_recompute_seconds,
    )
    return response


@app.post("/partition-yards", response_model=PartitionYardsResponse)
def partition_yards_endpoint(
    req: PartitionYardsRequest,
    current_user: User = Depends(get_current_user),
) -> PartitionYardsResponse:
    """Partition a property into front, rear, and side yards
    based on a user-selected front lot line."""

    try:
        property_poly = cast(
            Polygon,
            shape(
                {
                    "type": req.property_geojson.type,
                    "coordinates": req.property_geojson.coordinates,
                }
            ),
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid property geometry.")

    primary_structure = None
    if req.primary_structure_geojson:
        try:
            primary_structure = geojson_to_shapely(
                {
                    "type": req.primary_structure_geojson.type,
                    "coordinates": req.primary_structure_geojson.coordinates,
                }
            )
        except Exception as e:
            logger.warning(f"Invalid primary structure geometry, ignoring: {e}")

    try:
        yards = partition_yards(
            property_poly,
            req.front_lot_line,
            primary_structure,
        )
    except Exception:
        logger.exception("Yard partitioning failed")
        raise HTTPException(
            status_code=500,
            detail=GENERIC_ERROR_MESSAGE,
        )

    def _to_geojson(geom):
        if geom is None:
            return None
        raw = shapely_to_geojson(geom)
        return GeoJSONGeometry(type=raw["type"], coordinates=raw["coordinates"])

    return PartitionYardsResponse(
        front_yard_geojson=_to_geojson(yards["front_yard"]),
        rear_yard_geojson=_to_geojson(yards["rear_yard"]),
        side_yard_geojson=_to_geojson(yards["side_yard"]),
    )


def _recompute_response_to_cache(
    response: RecomputeBuildableResponse,
) -> dict[str, Any]:
    return {
        "buildable_zone_geojson": (
            response.buildable_zone_geojson.model_dump()
            if response.buildable_zone_geojson is not None
            else None
        ),
        "unbuildable_zone_geojson": (
            response.unbuildable_zone_geojson.model_dump()
            if response.unbuildable_zone_geojson is not None
            else None
        ),
        "buildable_area_sqft": response.buildable_area_sqft,
    }


def _recompute_response_from_cache(
    payload: dict[str, Any],
) -> RecomputeBuildableResponse | None:
    buildable_area_sqft = payload.get("buildable_area_sqft")
    if buildable_area_sqft is None:
        return None
    buildable_zone_geojson = payload.get("buildable_zone_geojson")
    unbuildable_zone_geojson = payload.get("unbuildable_zone_geojson")
    return RecomputeBuildableResponse(
        buildable_zone_geojson=(
            GeoJSONGeometry(**buildable_zone_geojson)
            if buildable_zone_geojson is not None
            else None
        ),
        unbuildable_zone_geojson=(
            GeoJSONGeometry(**unbuildable_zone_geojson)
            if unbuildable_zone_geojson is not None
            else None
        ),
        buildable_area_sqft=float(buildable_area_sqft),
    )


def _build_recompute_cache_key(
    prefix: str,
    request: RecomputeBuildableRequest,
) -> str:
    return build_cache_key(
        prefix,
        "recompute_buildable",
        build_recompute_request_id(
            property_geojson=request.property_geojson.model_dump(),
            setback_ft=request.setback_ft,
            adu_type=request.adu_type,
            active_buildings=[
                building.model_dump() for building in request.active_buildings
            ],
            primary_structure_geojson=(
                request.primary_structure_geojson.model_dump()
                if request.primary_structure_geojson is not None
                else None
            ),
        ),
    )


async def _get_cached_recompute_response(
    cache_key: str,
) -> RecomputeBuildableResponse | None:
    try:
        cached_payload = await get_cache().get_json(
            cache_key,
            resource="recompute_buildable",
        )
    except Exception as e:
        logger.warning(f"Recompute cache lookup failed cleanly: {e}")
        return None
    if cached_payload is None:
        return None
    return _recompute_response_from_cache(cached_payload)


async def _cache_recompute_response(
    cache_key: str,
    response: RecomputeBuildableResponse,
    ttl_seconds: int,
) -> None:
    try:
        await get_cache().set_json(
            cache_key,
            _recompute_response_to_cache(response),
            ttl_seconds=ttl_seconds,
            resource="recompute_buildable",
        )
    except Exception as e:
        logger.warning(f"Recompute cache write failed cleanly: {e}")
