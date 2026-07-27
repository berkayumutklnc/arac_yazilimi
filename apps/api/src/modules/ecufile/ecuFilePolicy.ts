// Yasal sınır filtresi (CLAUDE.md kural 1): DPF/EGR/AdBlue/katalizör iptali veya
// immobilizer atlatmaya işaret eden dosya adı/metadata kalıpları tespit edilirse
// yükleme reddedilir. Bu bir güvenlik/uyum kontrolüdür — istisna eklenmez.
export interface IllegalContentMatch {
  id: string;
  label: string;
}

interface BannedPattern extends IllegalContentMatch {
  matches: (normalized: string) => boolean;
}

const TURKISH_CHAR_MAP: Record<string, string> = {
  ç: "c",
  ğ: "g",
  ı: "i",
  ö: "o",
  ş: "s",
  ü: "u",
};

const ACTION_WORDS = "off|delete|remove|removal|disable|kapat|iptal";

const BANNED_PATTERNS: BannedPattern[] = [
  {
    id: "dpf_off",
    label: "DPF iptali",
    matches: (n) => new RegExp(`dpf(${ACTION_WORDS})`).test(n),
  },
  {
    id: "egr_delete",
    label: "EGR iptali",
    matches: (n) => new RegExp(`egr(${ACTION_WORDS})`).test(n),
  },
  {
    id: "adblue_off",
    label: "AdBlue iptali",
    matches: (n) => new RegExp(`adblue(${ACTION_WORDS})`).test(n),
  },
  {
    id: "catalyst_delete",
    label: "Katalizör iptali",
    matches: (n) => new RegExp(`(katalizor|katalitik|catalyst)(${ACTION_WORDS})`).test(n),
  },
  {
    id: "immobilizer_bypass",
    label: "Immobilizer atlatma",
    matches: (n) => new RegExp(`(immobilizer|immo)(bypass|atlatma|${ACTION_WORDS})`).test(n),
  },
];

function normalize(text: string): string {
  const lowered = text.toLowerCase();
  const transliterated = Array.from(lowered)
    .map((char) => TURKISH_CHAR_MAP[char] ?? char)
    .join("");
  return transliterated.replace(/[^a-z0-9]/g, "");
}

export function detectIllegalContent(text: string): IllegalContentMatch | null {
  const normalized = normalize(text);
  const match = BANNED_PATTERNS.find((pattern) => pattern.matches(normalized));
  return match ? { id: match.id, label: match.label } : null;
}
