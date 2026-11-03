"""
Pydantic models for the ADU Feasibility Engine API.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str = Field(description="User's email address")
    password: str = Field(description="Plain text password")
    role: str = Field(default="buyer", description="Role: 'buyer' or 'seller'")
    name: str = Field(description="Full name of the user")


class Token(BaseModel):
    access_token: str
    token_type: str


class UserProfile(BaseModel):
    id: str
    name: str
    email: str
    role: str
    avatarUrl: str | None = None


class GeoJSONGeometry(BaseModel):
    """A minimal GeoJSON Geometry (Polygon or MultiPolygon)."""

    type: str = "Polygon"
    coordinates: list = Field(
        ...,
        description="Nested array of coordinate rings.",
    )


class AnalyzeRequest(BaseModel):
    """Payload for the /analyze endpoint."""

    lat: float = Field(
        description="Latitude for auto-fetching parcel boundary via ReportAll.",
    )
    lng: float = Field(
        description="Longitude for auto-fetching parcel boundary via ReportAll.",
    )
    location: str = Field(
        default="irvine_ca",
        description="Location key for zoning rules (e.g. 'irvine_ca').",
    )
    building_footprints: list[GeoJSONGeometry] = Field(
        default_factory=list,
        description="Building polygons extracted from the frontend Mapbox viewer for footprint calculation.",
    )
    project_id: Optional[str] = Field(
        default=None,
        description="Existing project context for saved map sessions.",
    )
    map_search_id: Optional[str] = Field(
        default=None,
        description="Stable client id for deduping a fresh map search across reloads.",
    )


class FireHazardInfo(BaseModel):
    """CAL FIRE Hazard Severity Zone result for a given property."""

    severity: str = "None"
    """'None' | 'Moderate' | 'High' | 'Very High'"""

    zone_type: str = "None"
    """'SRA' | 'LRA' | 'Manual' | 'None'"""


class DetectedObstacle(BaseModel):
    """A single detected obstacle with renderable geometry."""

    name: str
    area_sqft: float
    confidence: float
    geojson: GeoJSONGeometry


class MapSearchUsage(BaseModel):
    """Address-credit metadata for a map property search."""

    charged: bool = False
    credits_charged: int = 0
    remaining_credits: int | None = None
    status: Literal[
        "charged",
        "deduped",
        "exempt_existing_project",
        "not_chargeable",
        "failed",
    ] = "not_chargeable"


class AnalyzeResponse(BaseModel):
    """Full analysis result returned to the frontend."""

    is_valid: bool
    message: str
    property_geojson: GeoJSONGeometry = Field(
        ..., description="Parcel boundary polygon for rendering."
    )
    buildable_zone_geojson: GeoJSONGeometry | None = Field(
        default=None,
        description="Computed buildable zone polygon for rendering.",
    )
    unbuildable_zone_geojson: GeoJSONGeometry | None = Field(
        default=None,
        description="The inverse of the buildable zone (property minus buildable zone).",
    )
    obstacles: list[DetectedObstacle] = Field(
        default_factory=list,
        description="Detected obstacles with renderable GeoJSON.",
    )
    property_area_sqft: float
    buildable_area_sqft: float
    setback_ft: float
    max_adu_sqft: float
    est_cost_low: float | None = None
    est_cost_high: float | None = None
    parcel_source: str = Field(
        default="manual",
        description="'reportall' if auto-fetched, 'manual' if user-drawn.",
    )
    apn: str | None = Field(
        default=None,
        description="Assessor Parcel Number from ReportAll (if available).",
    )
    parcel_address: str | None = Field(
        default=None,
        description="Site address from ReportAll (if available).",
    )
    county: str | None = Field(
        default=None,
        description="County name derived from reverse geocoding (if available).",
    )
    primary_structure_sqft: float | None = Field(
        default=None,
        description="Computed square footage of the primary dwelling.",
    )
    home_sqft: float | None = Field(
        default=None,
        description="Assessor-reported living area of the primary home (advisory).",
    )
    primary_structure_dimensions: str | None = Field(
        default=None,
        description="Approximate dimensions (LxW) of the primary dwelling.",
    )
    secondary_structures_sqft: list[float] | None = Field(
        default=None,
        description="Computed square footages of secondary buildings inside the parcel.",
    )
    detected_buildings: list[GeoJSONGeometry] = Field(
        default_factory=list,
        description="GeoJSON geometries of validated building footprints inside the parcel for rendering as exclusion zones.",
    )
    fire_hazard: FireHazardInfo | None = Field(
        default=None,
        description="CAL FIRE FHSZ classification for this property (None if coordinates not available).",
    )
    map_search_usage: MapSearchUsage = Field(default_factory=MapSearchUsage)


class RecomputeBuildableRequest(BaseModel):
    """Lightweight request for recomputing the buildable zone after toggling buildings."""

    property_geojson: GeoJSONGeometry
    setback_ft: float
    active_buildings: list[GeoJSONGeometry] = Field(
        default_factory=list,
        description="Only the buildings that should still block ADU placement.",
    )
    adu_type: str = Field(
        default="detached",
        description="'detached' or 'attached'. Attached mode uses a different buildable zone computation.",
    )
    primary_structure_geojson: GeoJSONGeometry | None = Field(
        default=None,
        description="Primary structure footprint (required when adu_type='attached').",
    )


class RecomputeBuildableResponse(BaseModel):
    """Updated buildable/unbuildable zones."""

    buildable_zone_geojson: GeoJSONGeometry | None = None
    unbuildable_zone_geojson: GeoJSONGeometry | None = None
    buildable_area_sqft: float


class PartitionYardsRequest(BaseModel):
    """Request to partition a property into front, rear, and side yards."""

    property_geojson: GeoJSONGeometry = Field(
        ..., description="The parcel boundary polygon."
    )
    front_lot_line: list[list[float]] = Field(
        ...,
        description="Two [lng, lat] coordinate pairs defining the user-selected front lot line edge.",
    )
    primary_structure_geojson: GeoJSONGeometry | None = Field(
        default=None,
        description="The primary structure footprint polygon (used to refine the partition).",
    )


class PartitionYardsResponse(BaseModel):
    """Partitioned yard zones returned to the frontend."""

    front_yard_geojson: GeoJSONGeometry | None = None
    rear_yard_geojson: GeoJSONGeometry | None = None
    side_yard_geojson: GeoJSONGeometry | None = None
