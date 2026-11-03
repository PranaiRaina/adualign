import dataclasses

import pytest

from api.config.zoning_rules import ZONING_RULES, ZoningRule, get_zoning_rule


def test_get_zoning_rule_returns_registered_location():
    rule = get_zoning_rule("irvine_ca")

    assert isinstance(rule, ZoningRule)
    assert rule.location_name == "Irvine, CA"
    assert rule.max_sqft_detached == 1200.0
    assert rule.max_sqft_junior == 500.0


def test_get_zoning_rule_returns_same_object_as_registry():
    assert get_zoning_rule("irvine_ca") is ZONING_RULES["irvine_ca"]


def test_get_zoning_rule_unknown_location_raises_value_error():
    with pytest.raises(ValueError) as excinfo:
        get_zoning_rule("atlantis_xx")

    message = str(excinfo.value)
    assert "atlantis_xx" in message
    # Error should guide the caller toward a supported location.
    assert "irvine_ca" in message


def test_get_zoning_rule_lists_supported_locations_sorted():
    # Stub two extra locations so the sorted ordering is observable.
    extra = {
        "zzz_last": dataclasses.replace(
            ZONING_RULES["irvine_ca"], location_name="Last"
        ),
        "aaa_first": dataclasses.replace(
            ZONING_RULES["irvine_ca"], location_name="First"
        ),
    }
    ZONING_RULES.update(extra)
    try:
        with pytest.raises(ValueError) as excinfo:
            get_zoning_rule("missing")
        supported = str(excinfo.value).split("Supported locations:")[1]
        assert supported.index("aaa_first") < supported.index("irvine_ca")
        assert supported.index("irvine_ca") < supported.index("zzz_last")
    finally:
        for key in extra:
            ZONING_RULES.pop(key, None)


def test_zoning_rule_is_frozen():
    rule = get_zoning_rule("irvine_ca")
    with pytest.raises(dataclasses.FrozenInstanceError):
        rule.max_sqft_detached = 9999.0  # type: ignore[misc]
