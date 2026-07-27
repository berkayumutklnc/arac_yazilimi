from diag_service.wot.analyzer import parse_wot_csv, analyze


def test_parse_wot_csv_reads_known_columns_case_insensitively():
    csv_text = (
        "Time_s,RPM,AFR,Boost_Target_Bar,Boost_Actual_Bar,Ignition_Retard_Deg\n"
        "0.0,3000,12.0,1.0,1.0,0.0\n"
        "0.1,4000,13.5,1.2,1.05,6.0\n"
    )

    rows = parse_wot_csv(csv_text)

    assert len(rows) == 2
    assert rows[0].row_index == 0
    assert rows[0].afr == 12.0
    assert rows[1].boost_target_bar == 1.2
    assert rows[1].ignition_retard_deg == 6.0


def test_parse_wot_csv_leaves_missing_or_invalid_values_as_none():
    csv_text = "afr,boost_target_bar,boost_actual_bar,ignition_retard_deg\n" "not-a-number,,1.0,\n"

    rows = parse_wot_csv(csv_text)

    assert len(rows) == 1
    assert rows[0].afr is None
    assert rows[0].boost_target_bar is None
    assert rows[0].boost_actual_bar == 1.0
    assert rows[0].ignition_retard_deg is None


def test_analyze_collects_findings_from_all_matching_rows():
    csv_text = (
        "afr,boost_target_bar,boost_actual_bar,ignition_retard_deg\n"
        "12.0,1.0,1.0,0.0\n"  # clean row, no findings
        "12.0,1.0,0.8,0.0\n"  # boost leak (diff 0.2)
        "13.5,1.0,1.0,7.0\n"  # afr lean + ignition retard
    )
    rows = parse_wot_csv(csv_text)

    findings = analyze(rows)

    rule_ids = [f.rule_id for f in findings]
    assert "boost_leak" in rule_ids
    assert "afr_lean" in rule_ids
    assert "ignition_retard" in rule_ids
    # temiz satırdan (row_index=0) hiçbir bulgu gelmemeli
    assert all(f.row_index != 0 for f in findings)


def test_analyze_returns_empty_findings_for_clean_data():
    csv_text = (
        "afr,boost_target_bar,boost_actual_bar,ignition_retard_deg\n"
        "12.0,1.0,1.0,0.0\n"
        "12.2,1.1,1.05,1.0\n"
    )
    rows = parse_wot_csv(csv_text)

    assert analyze(rows) == []
