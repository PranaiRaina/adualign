"""
Geospatial helpers for the ADU Feasibility Engine.

System-wide geometry interchange remains in WGS-84 (EPSG:4326). For buffering
and splitting we temporarily project into a local metric CRS centered on the
target parcel, then transform results back to WGS-84.
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import cast

from shapely.geometry import Polygon, MultiPolygon, shape, mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, split, unary_union
from pyproj import Transformer, Geod

# --- Conversion & Geometry Constants ---
SQ_M_TO_SQ_FT = 10.763910416709722
FT_TO_M = 0.3048

# Buffer & Simplification Constants
DEFAULT_STRUCTURE_BUFFER_FT = 6.0
SIMPLIFY_TOLERANCE_PROPERTY_M = 0.01
SIMPLIFY_TOLERANCE_PROPERTY_RELAXED_M = 0.05
SIMPLIFY_TOLERANCE_OBSTACLE_M = 0.1

# Yard Partitioning Constants
MIN_EDGE_LENGTH_M = 1.0
DOT_PRODUCT_TOLERANCE = 0.1
EDGE_LENGTH_WEIGHT = 0.3
MIN_PROJ_RANGE_M = 1.0
MIN_YARD_POLYGON_AREA_M2 = 1.0
YARD_DEPTH_TOLERANCE_M = 1.0
# When a wall sits on the parcel edge, split() needs the cut line anchored in the interior.
YARD_BASELINE_NUDGE_STEP_M = 0.05
YARD_BASELINE_NUDGE_MAX_M = 5.0


def _nudge_baseline_anchor_into_parcel(
    x: float,
    y: float,
    dir_x: float,
    dir_y: float,
    parcel: Polygon | MultiPolygon,
) -> tuple[float, float]:
    """Step from (x, y) along unit(dir) until Shapely contains() is true (strict interior)."""
    from math import hypot
    from shapely.geometry import Point

    length = hypot(dir_x, dir_y)
    if length < 1e-12:
        return x, y
    ux, uy = dir_x / length, dir_y / length
    unioned = unary_union(parcel)
    if not isinstance(unioned, (Polygon, MultiPolygon)) or unioned.is_empty:
        return x, y
    step = 0.0
    while step <= YARD_BASELINE_NUDGE_MAX_M:
        step += YARD_BASELINE_NUDGE_STEP_M
        px, py = x + ux * step, y + uy * step
        if unioned.contains(Point(px, py)):
            return px, py
    return x, y


@dataclass
class DetectedObstacle:
    """A single obstacle with a name and WGS-84 polygon."""

    name: str
    polygon_wgs84: Polygon  # in WGS-84 for frontend rendering
    area_sqft: float
    confidence: float


def geojson_to_shapely(geojson_geometry: dict) -> Polygon | MultiPolygon:
    """Convert a GeoJSON Geometry dict to a Shapely Polygon/MultiPolygon."""
    geom = shape(geojson_geometry)
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    raise TypeError(f"Expected Polygon or MultiPolygon, got {type(geom).__name__}")


def shapely_to_geojson(geom: Polygon | MultiPolygon) -> dict:
    """Convert a Shapely geometry back to a GeoJSON dict."""
    return mapping(geom)


_WGS84_GEOD = Geod(ellps="WGS84")


@lru_cache(maxsize=32)
def _cached_transformers(
    centroid_x: float,
    centroid_y: float,
) -> tuple[Transformer, Transformer]:
    """
    Build (and cache) local azimuthal-equidistant transformers for a given
    centroid. Keyed on rounded centroid coords so nearby geometries share
    the same transformer pair.
    """
    local_crs = (
        f"+proj=aeqd +lat_0={centroid_y} +lon_0={centroid_x} "
        "+x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs"
    )
    to_local = Transformer.from_crs("EPSG:4326", local_crs, always_xy=True)
    to_wgs84 = Transformer.from_crs(local_crs, "EPSG:4326", always_xy=True)
    return to_local, to_wgs84


def _local_transformers(
    reference_geom_wgs84: Polygon | MultiPolygon,
) -> tuple[Transformer, Transformer]:
    """
    Build local azimuthal-equidistant transformers centered on reference geometry.
    Uses an LRU cache keyed on the centroid to avoid redundant instantiation
    when processing many buildings against the same parcel.
    """
    c = reference_geom_wgs84.centroid
    # Round to 7 decimal places (~1 cm precision) for stable cache keys
    return _cached_transformers(round(c.x, 7), round(c.y, 7))


def _project_to_local_meters(
    geom_wgs84: Polygon | MultiPolygon,
    reference_geom_wgs84: Polygon | MultiPolygon,
) -> Polygon | MultiPolygon:
    to_local, _ = _local_transformers(reference_geom_wgs84)
    projected = transform(to_local.transform, geom_wgs84)
    polygonal = _polygonal_or_none(projected)
    if polygonal is None:
        raise TypeError("Projected geometry must remain polygonal")
    return polygonal


def _project_from_local_meters(
    geom_local: Polygon | MultiPolygon,
    reference_geom_wgs84: Polygon | MultiPolygon,
) -> Polygon | MultiPolygon:
    _, to_wgs84 = _local_transformers(reference_geom_wgs84)
    projected = transform(to_wgs84.transform, geom_local)
    polygonal = _polygonal_or_none(projected)
    if polygonal is None:
        raise TypeError("Projected geometry must remain polygonal")
    return polygonal


def _polygonal_or_none(geom: BaseGeometry) -> Polygon | MultiPolygon | None:
    if isinstance(geom, (Polygon, MultiPolygon)):
        return geom
    return None


def _project_simplified(
    geom_wgs84: Polygon | MultiPolygon,
    reference_geom_wgs84: Polygon | MultiPolygon,
    tolerance_m: float,
) -> Polygon | MultiPolygon:
    """Project to local meters, then topology-preserving simplify."""
    projected = _project_to_local_meters(geom_wgs84, reference_geom_wgs84)
    return cast(
        Polygon | MultiPolygon,
        projected.simplify(tolerance_m, preserve_topology=True),
    )


def _area_sqft_wgs84(geom_wgs84: Polygon | MultiPolygon) -> float:
    area_m2, _ = _WGS84_GEOD.geometry_area_perimeter(geom_wgs84)
    return abs(area_m2) * SQ_M_TO_SQ_FT


def buffer_wgs84_by_feet(
    geom_wgs84: Polygon | MultiPolygon,
    distance_ft: float,
    reference_geom_wgs84: Polygon | MultiPolygon | None = None,
) -> Polygon | MultiPolygon | None:
    """Buffer a WGS-84 geometry by feet and return WGS-84 geometry."""
    ref = reference_geom_wgs84 if reference_geom_wgs84 is not None else geom_wgs84
    local = _project_to_local_meters(geom_wgs84, ref)
    buffered = _polygonal_or_none(local.buffer(distance_ft * FT_TO_M))
    if buffered is None or buffered.is_empty:
        return None
    return _project_from_local_meters(buffered, ref)


def min_rotated_rect_dims_ft(
    geom_wgs84: Polygon | MultiPolygon,
) -> tuple[float, float] | None:
    """Approximate length/width (ft) from minimum rotated rectangle."""
    local = _project_to_local_meters(geom_wgs84, geom_wgs84)
    if local.is_empty:
        return None
    if isinstance(local, MultiPolygon):
        local = max(local.geoms, key=lambda g: g.area)
    min_rect = _polygonal_or_none(local.minimum_rotated_rectangle)
    if not isinstance(min_rect, Polygon):
        return None
    coords = list(min_rect.exterior.coords)
    if len(coords) < 3:
        return None
    from math import hypot

    side1_m = hypot(coords[0][0] - coords[1][0], coords[0][1] - coords[1][1])
    side2_m = hypot(coords[1][0] - coords[2][0], coords[1][1] - coords[2][1])
    length_ft = max(side1_m, side2_m) / FT_TO_M
    width_ft = min(side1_m, side2_m) / FT_TO_M
    return length_ft, width_ft


def calculate_area_sqft(polygon_wgs84: Polygon | MultiPolygon) -> float:
    """Return geodesic area in square feet for a WGS-84 polygon or multipolygon."""
    return _area_sqft_wgs84(polygon_wgs84)


def compute_buildable_zone(
    property_wgs84: Polygon,
    setback_ft: float,
    obstacle_polygons_wgs84: list[Polygon | MultiPolygon],
) -> Polygon | MultiPolygon | None:
    """
    Compute the legal buildable zone within a property.

    1. Project property to a local metric CRS.
    2. Apply inward setback buffer.
    3. Subtract all obstacle polygons.
    4. Project result back to WGS-84 for frontend rendering.

    Returns the buildable zone in WGS-84, or None if no area remains.
    """
    prop_local = _project_simplified(
        property_wgs84, property_wgs84, SIMPLIFY_TOLERANCE_PROPERTY_RELAXED_M
    )
    setback_m = setback_ft * FT_TO_M
    safe_zone = _polygonal_or_none(prop_local.buffer(-setback_m))
    if safe_zone is None or safe_zone.is_empty:
        return None

    for obstacle in obstacle_polygons_wgs84:
        obstacle_local = _project_simplified(
            obstacle, property_wgs84, SIMPLIFY_TOLERANCE_OBSTACLE_M
        )
        safe_zone = _polygonal_or_none(safe_zone.difference(obstacle_local))
        if safe_zone is None or safe_zone.is_empty:
            return None

    # Ensure valid geometry
    if not isinstance(safe_zone, (Polygon, MultiPolygon)):
        return None

    if not safe_zone.is_valid:
        safe_zone = _polygonal_or_none(safe_zone.buffer(0))
        if safe_zone is None:
            return None

    if isinstance(safe_zone, (Polygon, MultiPolygon)):
        return _project_from_local_meters(safe_zone, property_wgs84)
    return None


def get_buildable_area_sqft(
    property_wgs84: Polygon,
    setback_ft: float,
    obstacle_polygons_wgs84: list[Polygon | MultiPolygon],
    precomputed_zone: Polygon | MultiPolygon | None = None,
) -> float:
    """Calculate the area of the buildable zone in square feet.

    If *precomputed_zone* is provided (from a prior ``compute_buildable_zone``
    call with the same inputs), the expensive geometry work is skipped and the
    area is derived directly.
    """
    if precomputed_zone is not None:
        return _area_sqft_wgs84(precomputed_zone)

    # Fallback: compute from scratch (kept for backward-compat callers)
    prop_local = _project_simplified(
        property_wgs84, property_wgs84, SIMPLIFY_TOLERANCE_PROPERTY_M
    )
    setback_m = setback_ft * FT_TO_M
    safe_zone = _polygonal_or_none(prop_local.buffer(-setback_m))
    if safe_zone is None or safe_zone.is_empty:
        return 0.0

    for obstacle in obstacle_polygons_wgs84:
        obstacle_local = _project_simplified(
            obstacle, property_wgs84, SIMPLIFY_TOLERANCE_OBSTACLE_M
        )
        safe_zone = _polygonal_or_none(safe_zone.difference(obstacle_local))
        if safe_zone is None or safe_zone.is_empty:
            return 0.0

    safe_zone_wgs84 = _project_from_local_meters(safe_zone, property_wgs84)
    return _area_sqft_wgs84(safe_zone_wgs84)


def compute_attached_buildable_zone(
    property_wgs84: Polygon,
    setback_ft: float,
    primary_structure_wgs84: Polygon | MultiPolygon,
    secondary_obstacles_wgs84: list[Polygon | MultiPolygon],
    structure_buffer_ft: float = DEFAULT_STRUCTURE_BUFFER_FT,
) -> Polygon | MultiPolygon | None:
    """
    Compute the buildable zone for an *attached* ADU.

    Unlike the detached variant the primary structure is **not** treated as an
    obstacle with a 6 ft clearance buffer.  Instead:
      1. Apply ``setback_ft`` inward buffer on the property boundary.
      2. Buffer each **secondary** obstacle by ``structure_buffer_ft`` and subtract.
      3. Subtract the raw primary-structure footprint (no buffer) so the
         buildable zone terminates exactly at the house walls.
      4. Project back to WGS-84.

    Returns the attached buildable zone in WGS-84, or ``None`` if nothing remains.
    """
    prop_local = _project_simplified(
        property_wgs84, property_wgs84, SIMPLIFY_TOLERANCE_PROPERTY_M
    )
    setback_m = setback_ft * FT_TO_M
    safe_zone = _polygonal_or_none(prop_local.buffer(-setback_m))
    if safe_zone is None or safe_zone.is_empty:
        return None

    # Subtract secondary structures with the standard clearance buffer
    buffer_m = structure_buffer_ft * FT_TO_M
    for sec in secondary_obstacles_wgs84:
        sec_local = _project_simplified(
            sec, property_wgs84, SIMPLIFY_TOLERANCE_OBSTACLE_M
        )
        sec_buffered = _polygonal_or_none(sec_local.buffer(buffer_m))
        if sec_buffered is None:
            continue
        safe_zone = _polygonal_or_none(safe_zone.difference(sec_buffered))
        if safe_zone is None or safe_zone.is_empty:
            return None

    # Subtract the primary structure footprint directly (no buffer)
    primary_local = _project_simplified(
        primary_structure_wgs84, property_wgs84, SIMPLIFY_TOLERANCE_OBSTACLE_M
    )
    safe_zone = _polygonal_or_none(safe_zone.difference(primary_local))
    if safe_zone is None or safe_zone.is_empty:
        return None

    # Ensure valid geometry
    if not isinstance(safe_zone, (Polygon, MultiPolygon)):
        return None
    if not safe_zone.is_valid:
        safe_zone = _polygonal_or_none(safe_zone.buffer(0))
        if safe_zone is None:
            return None

    if isinstance(safe_zone, (Polygon, MultiPolygon)):
        return _project_from_local_meters(safe_zone, property_wgs84)
    return None


def get_attached_buildable_area_sqft(
    property_wgs84: Polygon,
    setback_ft: float,
    primary_structure_wgs84: Polygon | MultiPolygon,
    secondary_obstacles_wgs84: list[Polygon | MultiPolygon],
    structure_buffer_ft: float = DEFAULT_STRUCTURE_BUFFER_FT,
) -> float:
    """Calculate the area of the attached buildable zone in square feet."""
    zone = compute_attached_buildable_zone(
        property_wgs84,
        setback_ft,
        primary_structure_wgs84,
        secondary_obstacles_wgs84,
        structure_buffer_ft,
    )
    if zone is None:
        return 0.0
    return _area_sqft_wgs84(zone)


def partition_yards(
    property_wgs84: Polygon,
    front_line_coords: list[list[float]],
    primary_structure_wgs84: Polygon | MultiPolygon | None = None,
) -> dict[str, Polygon | MultiPolygon | None]:
    """
    Partition a property into front, rear, and side yards based on
    a user-selected front lot line and the primary structure footprint.

    Algorithm:
    1. Project everything to a local metric CRS for accurate measurements.
    2. Establish a rough front→rear axis from property centroid to front lot line.
    3. Find the front-facing and rear-facing house wall edges independently.
    4. Draw front cut parallel to the front wall, rear cut parallel to the rear wall.
    5. Split property and classify pieces as front / rear / side yard.
    6. Project results back to WGS-84.

    Returns dict with keys: front_yard, rear_yard, side_yard (all WGS-84).
    """
    import math
    from shapely.geometry import LineString, GeometryCollection, Polygon

    prop_local = _project_simplified(
        property_wgs84, property_wgs84, SIMPLIFY_TOLERANCE_PROPERTY_M
    )

    # Project front lot line to local meters
    to_local, _ = _local_transformers(property_wgs84)
    fl_start = to_local.transform(front_line_coords[0][0], front_line_coords[0][1])
    fl_end = to_local.transform(front_line_coords[1][0], front_line_coords[1][1])
    front_mid = ((fl_start[0] + fl_end[0]) / 2, (fl_start[1] + fl_end[1]) / 2)

    # Rough front direction: centroid → front lot line midpoint
    prop_centroid = prop_local.centroid
    fc_dx = front_mid[0] - prop_centroid.x
    fc_dy = front_mid[1] - prop_centroid.y
    fc_len = math.hypot(fc_dx, fc_dy)
    if fc_len > 0:
        fc_dx /= fc_len
        fc_dy /= fc_len

    # Inward (front→rear) direction is opposite of front direction
    perp_dx = -fc_dx
    perp_dy = -fc_dy

    # Collect structure edges with their angles, midpoints, and lengths
    struct_ft = None
    if primary_structure_wgs84 is not None:
        struct_ft = _project_simplified(
            primary_structure_wgs84, property_wgs84, SIMPLIFY_TOLERANCE_OBSTACLE_M
        )
        if struct_ft.is_empty or struct_ft.area <= 0:
            struct_ft = None

    target_geom = struct_ft if struct_ft is not None else prop_local

    if isinstance(target_geom, Polygon):
        all_coords = [list(target_geom.exterior.coords)]
    else:
        all_coords = []
        for geom in target_geom.geoms:
            if isinstance(geom, Polygon):
                all_coords.append(list(geom.exterior.coords))

    edges = []
    for coords in all_coords:
        for i in range(len(coords) - 1):
            p1 = coords[i]
            p2 = coords[i + 1]
            edx = p2[0] - p1[0]
            edy = p2[1] - p1[1]
            length = math.hypot(edx, edy)
            if length < MIN_EDGE_LENGTH_M:
                continue
            mid_x = (p1[0] + p2[0]) / 2
            mid_y = (p1[1] + p2[1]) / 2
            angle = math.atan2(edy, edx)
            # Projection of edge midpoint onto the front→rear axis
            proj = (mid_x - front_mid[0]) * perp_dx + (mid_y - front_mid[1]) * perp_dy
            # Edge normal (outward-facing for CCW polygon)
            nx = -edy / length
            ny = edx / length
            edges.append(
                {
                    "p1": p1,
                    "p2": p2,
                    "mid": (mid_x, mid_y),
                    "angle": angle,
                    "length": length,
                    "proj": proj,
                    "normal": (nx, ny),
                }
            )

    def _edge_is_front_facing(edge):
        """True if the edge's normal points toward the front (street side)."""
        nx, ny = edge["normal"]
        dot = nx * fc_dx + ny * fc_dy
        return dot > DOT_PRODUCT_TOLERANCE

    def _edge_is_rear_facing(edge):
        """True if the edge's normal points toward the rear."""
        nx, ny = edge["normal"]
        dot = nx * perp_dx + ny * perp_dy
        return dot > DOT_PRODUCT_TOLERANCE

    # Find the front-facing wall: front-facing edges sorted by projection (smallest = closest to front)
    front_facing = [e for e in edges if _edge_is_front_facing(e)]
    rear_facing = [e for e in edges if _edge_is_rear_facing(e)]

    # Best front wall = front-facing edge with smallest projection (closest to street),
    # weighted by length to prefer major walls over tiny bump-outs
    if front_facing:
        # Among front-facing edges, pick the one closest to the front (min proj) and longest
        proj_range = (
            max(e["proj"] for e in edges) - min(e["proj"] for e in edges)
            if edges
            else MIN_PROJ_RANGE_M
        )
        if proj_range < MIN_PROJ_RANGE_M:
            proj_range = MIN_PROJ_RANGE_M
        # Score: prefer small projection (close to front) and long edges
        best_front_edge = min(
            front_facing, key=lambda e: e["proj"] - e["length"] * EDGE_LENGTH_WEIGHT
        )
        front_wall_angle = best_front_edge["angle"]
        front_par_dx = math.cos(front_wall_angle)
        front_par_dy = math.sin(front_wall_angle)
    else:
        # Fallback: use the front lot line angle itself
        fl_dx = fl_end[0] - fl_start[0]
        fl_dy = fl_end[1] - fl_start[1]
        front_wall_angle = math.atan2(fl_dy, fl_dx)
        front_par_dx = math.cos(front_wall_angle)
        front_par_dy = math.sin(front_wall_angle)

    if rear_facing:
        # Among rear-facing edges, pick the one farthest from front (max proj) and longest
        best_rear_edge = max(
            rear_facing, key=lambda e: e["proj"] + e["length"] * EDGE_LENGTH_WEIGHT
        )
        rear_wall_angle = best_rear_edge["angle"]
        rear_par_dx = math.cos(rear_wall_angle)
        rear_par_dy = math.sin(rear_wall_angle)
    else:
        # Fallback: mirror front wall angle
        rear_par_dx = front_par_dx
        rear_par_dy = front_par_dy

    # Get the property bounding box diagonal for "infinite" line extension
    bounds = prop_local.bounds
    diag = math.hypot(bounds[2] - bounds[0], bounds[3] - bounds[1]) * 2

    if struct_ft is not None:
        # Use the actual wall edge midpoints as baseline anchors so the
        # cutting line passes directly through the wall, not offset from it.
        if front_facing:
            # Anchor the front cut on the best front wall edge itself
            front_base_x, front_base_y = best_front_edge["mid"]
        else:
            # Fallback: use perp-axis projection of the front-most vertex
            struct_coords = (
                list(struct_ft.exterior.coords)
                if isinstance(struct_ft, Polygon)
                else list(struct_ft.geoms[0].exterior.coords)
            )
            projections = [
                ((cx - front_mid[0]) * perp_dx + (cy - front_mid[1]) * perp_dy, cx, cy)
                for cx, cy in struct_coords
            ]
            min_proj = min(projections, key=lambda t: t[0])
            front_base_x = min_proj[1]
            front_base_y = min_proj[2]

        if rear_facing:
            # Anchor the rear cut on the best rear wall edge itself
            rear_base_x, rear_base_y = best_rear_edge["mid"]
        else:
            struct_coords = (
                list(struct_ft.exterior.coords)
                if isinstance(struct_ft, Polygon)
                else list(struct_ft.geoms[0].exterior.coords)
            )
            projections = [
                ((cx - front_mid[0]) * perp_dx + (cy - front_mid[1]) * perp_dy, cx, cy)
                for cx, cy in struct_coords
            ]
            max_proj = max(projections, key=lambda t: t[0])
            rear_base_x = max_proj[1]
            rear_base_y = max_proj[2]
    else:
        # No structure: split the property into thirds along the perp axis
        if not isinstance(prop_local, Polygon):
            prop_local = max(prop_local.geoms, key=lambda geom: geom.area)
        prop_coords = list(prop_local.exterior.coords)
        projections = [
            ((cx - front_mid[0]) * perp_dx + (cy - front_mid[1]) * perp_dy, cx, cy)
            for cx, cy in prop_coords
        ]

        min_perp = min(p[0] for p in projections)
        max_perp = max(p[0] for p in projections)
        third = (max_perp - min_perp) / 3

        front_base_x = front_mid[0] + perp_dx * (min_perp + third)
        front_base_y = front_mid[1] + perp_dy * (min_perp + third)
        rear_base_x = front_mid[0] + perp_dx * (min_perp + 2 * third)
        rear_base_y = front_mid[1] + perp_dy * (min_perp + 2 * third)

    # Inward-pointing normals for cut lines (same convention as classification below).
    f_nx = -front_par_dy
    f_ny = front_par_dx
    if f_nx * perp_dx + f_ny * perp_dy < 0:
        f_nx, f_ny = -f_nx, -f_ny

    r_nx = -rear_par_dy
    r_ny = rear_par_dx
    if r_nx * perp_dx + r_ny * perp_dy < 0:
        r_nx, r_ny = -r_nx, -r_ny

    # Wall midpoints on the lot line put the splitter on the boundary; GEOS split then
    # fails or leaves one piece. Nudge anchors into the parcel along wall normals.
    if struct_ft is not None:
        prop_for_nudge = unary_union(prop_local)
        if (
            isinstance(prop_for_nudge, (Polygon, MultiPolygon))
            and not prop_for_nudge.is_empty
        ):
            front_base_x, front_base_y = _nudge_baseline_anchor_into_parcel(
                front_base_x, front_base_y, f_nx, f_ny, prop_for_nudge
            )
            rear_base_x, rear_base_y = _nudge_baseline_anchor_into_parcel(
                rear_base_x, rear_base_y, -r_nx, -r_ny, prop_for_nudge
            )

    # Create the two cutting lines — each parallel to its respective wall
    front_cut = LineString(
        [
            (front_base_x - front_par_dx * diag, front_base_y - front_par_dy * diag),
            (front_base_x + front_par_dx * diag, front_base_y + front_par_dy * diag),
        ]
    )
    rear_cut = LineString(
        [
            (rear_base_x - rear_par_dx * diag, rear_base_y - rear_par_dy * diag),
            (rear_base_x + rear_par_dx * diag, rear_base_y + rear_par_dy * diag),
        ]
    )

    # Split the property polygon by the two cutting lines
    def _extract_polys(geom):
        """Extract all Polygon instances from a geometry."""
        if isinstance(geom, Polygon):
            return [geom]
        if isinstance(geom, (MultiPolygon, GeometryCollection)):
            result = []
            for g in geom.geoms:
                result.extend(_extract_polys(g))
            return result
        return []

    # First cut: split by front baseline
    try:
        pieces_after_front = split(prop_local, front_cut)
    except Exception:
        pieces_after_front = GeometryCollection([prop_local])

    all_pieces = []
    for piece in pieces_after_front.geoms:
        try:
            sub_pieces = split(piece, rear_cut)
            all_pieces.extend(_extract_polys(sub_pieces))
        except Exception:
            all_pieces.extend(_extract_polys(piece))

    # Classify each piece based on its centroid's depth relative to the cut lines
    front_polys = []
    rear_polys = []
    side_polys = []

    for poly in all_pieces:
        if poly.is_empty or poly.area < MIN_YARD_POLYGON_AREA_M2:
            continue
        cx, cy = poly.centroid.x, poly.centroid.y

        # Depth relative to front baseline (negative = toward street)
        front_depth = (cx - front_base_x) * f_nx + (cy - front_base_y) * f_ny
        # Depth relative to rear baseline (positive = toward rear)
        rear_depth = (cx - rear_base_x) * r_nx + (cy - rear_base_y) * r_ny

        if front_depth < -YARD_DEPTH_TOLERANCE_M:
            front_polys.append(poly)
        elif rear_depth > YARD_DEPTH_TOLERANCE_M:
            rear_polys.append(poly)
        else:
            side_polys.append(poly)

    def _merge_and_project(polys):
        if not polys:
            return None
        merged = unary_union(polys)
        if merged.is_empty:
            return None
        return _project_from_local_meters(merged, property_wgs84)

    front_yard = _merge_and_project(front_polys)
    rear_yard = _merge_and_project(rear_polys)
    side_yard = _merge_and_project(side_polys)

    return {
        "front_yard": front_yard,
        "rear_yard": rear_yard,
        "side_yard": side_yard,
    }
