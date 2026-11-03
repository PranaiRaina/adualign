from api.rate_limiting.llm_pricing import (
    ROLLING_AVG_BUFFER_MULTIPLIER,
    ROLLING_AVG_MIN_SAMPLES,
)
from api.rate_limiting.reservation_engine import (
    COST_ACCOUNTING_SCHEMA_VERSION,
    get_reservation_micros,
    update_rolling_average,
)


class FakeRedis:
    def __init__(self):
        self.data: dict[str, int | str] = {}

    def get(self, key: str):
        return self.data.get(key)

    def set(self, key: str, value, ex=None):
        self.data[key] = value

    def delete(self, key: str):
        self.data.pop(key, None)

    def incrby(self, key: str, amount: int):
        current = int(self.data.get(key, 0) or 0)
        new_value = current + amount
        self.data[key] = new_value
        return new_value


def test_rolling_average_inactive_before_min_samples():
    client = FakeRedis()
    for _ in range(ROLLING_AVG_MIN_SAMPLES - 1):
        update_rolling_average("rag", 5_000, client=client)

    assert get_reservation_micros("rag", 6_000, client=client) == 6_000


def test_rolling_average_activates_with_buffer():
    client = FakeRedis()
    for _ in range(ROLLING_AVG_MIN_SAMPLES):
        update_rolling_average("rag", 5_000, client=client)

    assert get_reservation_micros("rag", 6_000, client=client) == int(
        5_000 * ROLLING_AVG_BUFFER_MULTIPLIER
    )


def test_version_mismatch_ignores_stale_keys_for_all_routes():
    client = FakeRedis()
    client.set("rolling_avg:version", "stale-version")
    client.set("rolling_avg:rag", 9_999)
    client.set("rolling_avg:rag:sum", 99_999)
    client.set("rolling_avg:rag:count", 99)
    client.set("rolling_avg:report", 8_888)
    client.set("rolling_avg:report:sum", 88_888)
    client.set("rolling_avg:report:count", 88)

    rag_reservation = get_reservation_micros("rag", 6_000, client=client)
    report_reservation = get_reservation_micros("report", 7_000, client=client)

    assert rag_reservation == 6_000
    assert report_reservation == 7_000
    assert client.get("rolling_avg:version") == COST_ACCOUNTING_SCHEMA_VERSION
