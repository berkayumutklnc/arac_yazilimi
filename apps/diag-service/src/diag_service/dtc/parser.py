import re

# ISO 15031-6 / SAE J2012 DTC formatı: harf (P/C/B/U) + 4 rakam. Kelime sınırı
# (\b) ile "PP0420" gibi sahte alt-dizi eşleşmeleri elenir.
CODE_PATTERN = re.compile(r"\b[PCBU]\d{4}\b")


def extract_codes(text: str) -> list[str]:
    seen: set[str] = set()
    codes: list[str] = []
    for match in CODE_PATTERN.findall(text):
        if match not in seen:
            seen.add(match)
            codes.append(match)
    return codes
