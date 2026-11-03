"""Tests for shared property footprint helpers."""

from api.property_context import (
    footprint_mentioned_in_text,
    is_non_rectangular_adu_shape,
    normalize_adu_shape,
)


def test_normalize_adu_shape_accepts_hyphen_and_underscore():
    assert normalize_adu_shape("l-shape") == "l-shape"
    assert normalize_adu_shape("l_shape") == "l-shape"


def test_is_non_rectangular_adu_shape():
    assert is_non_rectangular_adu_shape("l-shape")
    assert is_non_rectangular_adu_shape("t_shape")
    assert not is_non_rectangular_adu_shape("rectangle")


def test_footprint_mentioned_in_text_detects_table_and_labels():
    assert footprint_mentioned_in_text("| ADU dimensions | 20.0 x 40.0 ft |")
    assert footprint_mentioned_in_text("Overall footprint is 10 x 20")
    assert not footprint_mentioned_in_text("Planned ADU size is 800 sq ft")
