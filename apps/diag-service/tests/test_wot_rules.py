from diag_service.wot.schemas import WotRow
from diag_service.wot.rules import (
    rule_boost_leak,
    rule_boost_overboost,
    rule_afr_lean,
    rule_afr_rich,
    rule_ignition_retard,
    RULES,
)


def row(**overrides) -> WotRow:
    defaults = dict(
        row_index=0,
        afr=12.0,
        boost_target_bar=1.0,
        boost_actual_bar=1.0,
        ignition_retard_deg=0.0,
    )
    defaults.update(overrides)
    return WotRow(**defaults)


class TestBoostLeakRule:
    def test_does_not_trigger_when_diff_at_threshold(self):
        assert rule_boost_leak(row(boost_target_bar=1.0, boost_actual_bar=0.9)) is None

    def test_triggers_when_diff_exceeds_threshold(self):
        finding = rule_boost_leak(row(boost_target_bar=1.0, boost_actual_bar=0.89))
        assert finding is not None
        assert finding.rule_id == "boost_leak"
        assert "boost kaçağı" in finding.message.lower()

    def test_does_not_trigger_when_actual_meets_or_exceeds_target(self):
        assert rule_boost_leak(row(boost_target_bar=1.0, boost_actual_bar=1.0)) is None


class TestBoostOverboostRule:
    def test_does_not_trigger_at_threshold(self):
        assert rule_boost_overboost(row(boost_target_bar=1.0, boost_actual_bar=1.15)) is None

    def test_triggers_beyond_threshold(self):
        finding = rule_boost_overboost(row(boost_target_bar=1.0, boost_actual_bar=1.16))
        assert finding is not None
        assert finding.rule_id == "boost_overboost"


class TestAfrLeanRule:
    def test_does_not_trigger_at_threshold(self):
        assert rule_afr_lean(row(afr=12.8)) is None

    def test_triggers_beyond_threshold(self):
        finding = rule_afr_lean(row(afr=13.5))
        assert finding is not None
        assert finding.rule_id == "afr_lean"
        assert finding.severity == "high"


class TestAfrRichRule:
    def test_does_not_trigger_at_threshold(self):
        assert rule_afr_rich(row(afr=10.5)) is None

    def test_triggers_below_threshold(self):
        finding = rule_afr_rich(row(afr=9.8))
        assert finding is not None
        assert finding.rule_id == "afr_rich"


class TestIgnitionRetardRule:
    def test_does_not_trigger_at_threshold(self):
        assert rule_ignition_retard(row(ignition_retard_deg=5.0)) is None

    def test_triggers_beyond_threshold(self):
        finding = rule_ignition_retard(row(ignition_retard_deg=5.1))
        assert finding is not None
        assert finding.rule_id == "ignition_retard"
        assert "vuruntu" in finding.message.lower()


def test_all_rules_return_none_for_missing_values():
    empty_row = WotRow(row_index=0)
    for rule in RULES:
        assert rule(empty_row) is None


def test_rules_registry_contains_all_five_rules():
    assert RULES == [
        rule_boost_leak,
        rule_boost_overboost,
        rule_afr_lean,
        rule_afr_rich,
        rule_ignition_retard,
    ]
