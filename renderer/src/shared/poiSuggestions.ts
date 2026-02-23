export type LocalizedText = Record<string, string>;

export type PoiSuggestionPreset = {
  buttonText: string;
  name: LocalizedText;
  description: LocalizedText;
};

const STATIC_LANGUAGE_KEYS = ["de", "en", "es", "fr", "it", "pt"] as const;
const STATIC_LANGUAGE_SET = new Set<string>(STATIC_LANGUAGE_KEYS);

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseLocalizedText(value: unknown): LocalizedText | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  for (const key of Object.keys(value)) {
    if (!STATIC_LANGUAGE_SET.has(key)) {
      return null;
    }
  }

  const parsed: LocalizedText = {};
  for (const language of STATIC_LANGUAGE_KEYS) {
    const rawValue = value[language];
    if (typeof rawValue !== "string") {
      return null;
    }

    parsed[language] = rawValue;
  }

  return parsed;
}

export function parsePoiSuggestionsFromAsset(payload: unknown): PoiSuggestionPreset[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const suggestions: PoiSuggestionPreset[] = [];
  for (const entry of payload) {
    if (!isObjectRecord(entry)) {
      continue;
    }

    const rawButtonText = entry.button_text;
    if (typeof rawButtonText !== "string") {
      continue;
    }

    const buttonText = rawButtonText.trim();
    if (!buttonText) {
      continue;
    }

    const name = parseLocalizedText(entry.name);
    const description = parseLocalizedText(entry.description);
    if (!name || !description) {
      continue;
    }

    suggestions.push({
      buttonText,
      name,
      description,
    });
  }

  return suggestions;
}

