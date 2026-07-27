from .schemas import Finding, WotRow

# Eşik değerleri: makul varsayılan sabitler, kalibrasyon gerektiğinde tek yerden değişir.
BOOST_LEAK_THRESHOLD_BAR = 0.1
BOOST_OVERBOOST_THRESHOLD_BAR = 0.15
AFR_LEAN_THRESHOLD = 12.8
AFR_RICH_THRESHOLD = 10.5
IGNITION_RETARD_THRESHOLD_DEG = 5.0


def rule_boost_leak(row: WotRow) -> Finding | None:
    if row.boost_target_bar is None or row.boost_actual_bar is None:
        return None
    diff = row.boost_target_bar - row.boost_actual_bar
    if diff > BOOST_LEAK_THRESHOLD_BAR:
        return Finding(
            rule_id="boost_leak",
            severity="high",
            message="Olası boost kaçağı: hedef basınca ulaşılamıyor.",
            row_index=row.row_index,
            details={
                "target_bar": row.boost_target_bar,
                "actual_bar": row.boost_actual_bar,
                "diff_bar": diff,
            },
        )
    return None


def rule_boost_overboost(row: WotRow) -> Finding | None:
    if row.boost_target_bar is None or row.boost_actual_bar is None:
        return None
    diff = row.boost_actual_bar - row.boost_target_bar
    if diff > BOOST_OVERBOOST_THRESHOLD_BAR:
        return Finding(
            rule_id="boost_overboost",
            severity="high",
            message="Olası aşırı basınç (overboost): gerçek basınç hedefi belirgin aşıyor.",
            row_index=row.row_index,
            details={
                "target_bar": row.boost_target_bar,
                "actual_bar": row.boost_actual_bar,
                "diff_bar": diff,
            },
        )
    return None


def rule_afr_lean(row: WotRow) -> Finding | None:
    if row.afr is None:
        return None
    if row.afr > AFR_LEAN_THRESHOLD:
        return Finding(
            rule_id="afr_lean",
            severity="high",
            message="Yakıt karışımı fakir (lean) — motor hasarı riski.",
            row_index=row.row_index,
            details={"afr": row.afr, "threshold": AFR_LEAN_THRESHOLD},
        )
    return None


def rule_afr_rich(row: WotRow) -> Finding | None:
    if row.afr is None:
        return None
    if row.afr < AFR_RICH_THRESHOLD:
        return Finding(
            rule_id="afr_rich",
            severity="low",
            message="Yakıt karışımı zengin (rich) — verimsizlik.",
            row_index=row.row_index,
            details={"afr": row.afr, "threshold": AFR_RICH_THRESHOLD},
        )
    return None


def rule_ignition_retard(row: WotRow) -> Finding | None:
    if row.ignition_retard_deg is None:
        return None
    if row.ignition_retard_deg > IGNITION_RETARD_THRESHOLD_DEG:
        return Finding(
            rule_id="ignition_retard",
            severity="high",
            message="Olası vuruntu (knock) — ateşleme avansı geri çekildi.",
            row_index=row.row_index,
            details={
                "ignition_retard_deg": row.ignition_retard_deg,
                "threshold_deg": IGNITION_RETARD_THRESHOLD_DEG,
            },
        )
    return None


RULES = [
    rule_boost_leak,
    rule_boost_overboost,
    rule_afr_lean,
    rule_afr_rich,
    rule_ignition_retard,
]
