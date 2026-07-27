from diag_service.dtc.parser import extract_codes
from diag_service.dtc.catalog import lookup


def test_extract_codes_from_csv_line():
    text = "timestamp,code,desc\n2024-01-01,P0420,Catalyst efficiency below threshold\n"
    assert extract_codes(text) == ["P0420"]


def test_extract_codes_from_free_text_log():
    text = "ECU raporu: aktif arizalar P0300 ve P0171 tespit edildi, ayrica U0100 var."
    assert extract_codes(text) == ["P0300", "P0171", "U0100"]


def test_extract_codes_dedups_preserving_first_occurrence_order():
    text = "P0420 seen again later: P0420, then P0100"
    assert extract_codes(text) == ["P0420", "P0100"]


def test_extract_codes_ignores_invalid_looking_tokens():
    text = "no codes here, just P042 and PP0420 and 0420P"
    assert extract_codes(text) == []


def test_extract_codes_returns_empty_list_for_empty_text():
    assert extract_codes("") == []


def test_lookup_known_code_returns_description():
    description = lookup("P0420")
    assert description is not None
    assert "catalyst" in description.lower()


def test_lookup_unknown_code_returns_none():
    assert lookup("P9999") is None
