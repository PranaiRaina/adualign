"""Yard partition helpers and GEOS split behavior (boundary vs interior cut lines)."""

from shapely.geometry import LineString, Polygon
from shapely.ops import split

from engine.geometry import _nudge_baseline_anchor_into_parcel


def test_nudge_baseline_anchor_moves_off_boundary():
    sq = Polygon([(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)])
    from shapely.geometry import Point

    x, y = _nudge_baseline_anchor_into_parcel(50, 0, 0, 1, sq)
    assert y > 0
    assert sq.contains(Point(x, y))


def test_geos_split_along_polygon_edge_does_not_partition():
    """Document why yard cut anchors must be nudged into the parcel interior."""
    sq = Polygon([(0, 0), (100, 0), (100, 100), (0, 100), (0, 0)])
    on_boundary = LineString([(-100, 0), (200, 0)])
    slightly_in = LineString([(-100, 0.05), (200, 0.05)])

    assert len(split(sq, on_boundary).geoms) == 1
    assert len(split(sq, slightly_in).geoms) == 2
