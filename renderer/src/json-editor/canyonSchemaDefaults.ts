type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type LanguageCode = "de" | "en" | "es" | "fr" | "it" | "pt";

const STATIC_LANGUAGE_KEYS: readonly LanguageCode[] = ["de", "en", "es", "fr", "it", "pt"];
const DEFAULT_RECOMMENDED_ROPES = "2x 0m";

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonObject;
}

function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function normalizeJsonArray(value: unknown): JsonValue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value as JsonValue[];
}

export function isFiniteCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function normalizeCoordinatePair(value: unknown): [number, number] | null {
  if (!isFiniteCoordinatePair(value)) {
    return null;
  }

  return [value[0], value[1]];
}

export function createEmptyLocalizedText(): Record<string, string> {
  const value: Record<string, string> = {};
  for (const language of STATIC_LANGUAGE_KEYS) {
    value[language] = "";
  }

  return value;
}

function normalizeLocalizedText(value: unknown): Record<string, string> {
  const source = asObject(value);
  const normalized: Record<string, string> = {};

  if (source) {
    for (const [key, entry] of Object.entries(source)) {
      if (typeof entry === "string") {
        normalized[key] = entry;
      }
    }
  }

  for (const language of STATIC_LANGUAGE_KEYS) {
    normalized[language] = source && typeof source[language] === "string" ? source[language] : "";
  }

  return normalized;
}

function normalizeLocation(value: unknown): JsonObject {
  const source = asObject(value) ?? {};
  return {
    ...source,
    country_code: normalizeString(source.country_code),
    region_code: normalizeString(source.region_code),
  };
}

function normalizeTourDimensions(value: unknown): JsonObject {
  const source = asObject(value) ?? {};
  return {
    ...source,
    elevation_start: normalizeNumber(source.elevation_start),
    elevation_exit: normalizeNumber(source.elevation_exit),
    horizontal_length: normalizeNumber(source.horizontal_length),
  };
}

function normalizeDifficulties(value: unknown): JsonObject {
  const source = asObject(value) ?? {};
  return {
    ...source,
    vertical: normalizeNumber(source.vertical),
    aquatic: normalizeNumber(source.aquatic),
    general: normalizeNumber(source.general),
  };
}

function normalizeDurations(value: unknown): JsonObject {
  const source = asObject(value) ?? {};
  return {
    ...source,
    approach_no_shuttle: normalizeNumber(source.approach_no_shuttle),
    approach_with_shuttle: normalizeNumber(source.approach_with_shuttle),
    canyon: normalizeNumber(source.canyon),
    exit_no_shuttle: normalizeNumber(source.exit_no_shuttle),
    exit_with_shuttle: normalizeNumber(source.exit_with_shuttle),
  };
}

function normalizeDescriptions(value: unknown): JsonObject {
  const source = asObject(value) ?? {};
  return {
    ...source,
    approach: normalizeLocalizedText(source.approach),
    canyon: normalizeLocalizedText(source.canyon),
    exit: normalizeLocalizedText(source.exit),
  };
}

function normalizeSectionImages(value: unknown): JsonObject {
  const source = asObject(value) ?? {};
  return {
    ...source,
    cover: typeof source.cover === "undefined" ? null : source.cover,
    additional: Array.isArray(source.additional) ? (source.additional as JsonValue[]) : [],
  };
}

function normalizePointOfInterestEntry(value: unknown): JsonObject | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  return {
    ...source,
    coordinates: normalizeCoordinatePair(source.coordinates),
    name: normalizeLocalizedText(source.name),
    description: normalizeLocalizedText(source.description),
  };
}

function normalizeParkingLotEntry(value: unknown): JsonObject | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  return {
    ...source,
    coordinates: normalizeCoordinatePair(source.coordinates),
    name: normalizeLocalizedText(source.name),
  };
}

export function createDefaultSection(index = 0): JsonObject {
  return {
    id: index,
    name: "",
    authors: [],
    descriptions: {
      approach: createEmptyLocalizedText(),
      canyon: createEmptyLocalizedText(),
      exit: createEmptyLocalizedText(),
    },
    special_notes: [],
    difficulties: {
      vertical: 0,
      aquatic: 0,
      general: 0,
    },
    durations_in_minutes: {
      approach_no_shuttle: 0,
      approach_with_shuttle: 0,
      canyon: 0,
      exit_no_shuttle: 0,
      exit_with_shuttle: 0,
    },
    tour_dimensions_in_meter: {
      elevation_start: 0,
      elevation_exit: 0,
      horizontal_length: 0,
    },
    max_rappel_in_meter: 0,
    recommended_ropes: DEFAULT_RECOMMENDED_ROPES,
    catchment_area_in_km2: null,
    track_canyon: "",
    topo: "",
    subjective_rating: 0,
    quality_anchoring: 0,
    subjective_rating_count: 0,
    quality_anchoring_count: 0,
    official_partner: null,
    images: {
      cover: null,
      additional: [],
    },
  };
}

function toValidSectionId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return null;
  }

  return value;
}

function nextUnusedSectionId(usedSectionIds: Set<number>): number {
  let nextId = 0;
  while (usedSectionIds.has(nextId)) {
    nextId += 1;
  }

  return nextId;
}

function normalizeSection(value: unknown, sectionId: number): JsonObject | null {
  const source = asObject(value);
  if (!source) {
    return null;
  }

  const defaults = createDefaultSection(sectionId);
  return {
    ...source,
    ...defaults,
    id: sectionId,
    name: normalizeString(source.name),
    authors: normalizeStringArray(source.authors),
    descriptions: normalizeDescriptions(source.descriptions),
    special_notes: normalizeJsonArray(source.special_notes),
    difficulties: normalizeDifficulties(source.difficulties),
    durations_in_minutes: normalizeDurations(source.durations_in_minutes),
    tour_dimensions_in_meter: normalizeTourDimensions(source.tour_dimensions_in_meter),
    max_rappel_in_meter: normalizeNumber(source.max_rappel_in_meter),
    recommended_ropes: normalizeString(source.recommended_ropes, DEFAULT_RECOMMENDED_ROPES),
    catchment_area_in_km2: normalizeNullableNumber(source.catchment_area_in_km2),
    track_canyon: normalizeString(source.track_canyon),
    topo: normalizeString(source.topo),
    subjective_rating: normalizeNumber(source.subjective_rating),
    quality_anchoring: normalizeNumber(source.quality_anchoring),
    subjective_rating_count: normalizeNumber(source.subjective_rating_count),
    quality_anchoring_count: normalizeNumber(source.quality_anchoring_count),
    official_partner: typeof source.official_partner === "undefined" ? null : source.official_partner,
    images: normalizeSectionImages(source.images),
  };
}

export function normalizeCanyonForEditor(input: unknown): JsonObject {
  const source = asObject(input) ?? {};
  const sections: JsonObject[] = [];
  const usedSectionIds = new Set<number>();
  if (Array.isArray(source.sections)) {
    for (const sectionValue of source.sections) {
      const sectionSource = asObject(sectionValue);
      if (!sectionSource) {
        continue;
      }

      let sectionId = toValidSectionId(sectionSource.id);
      if (sectionId === null || usedSectionIds.has(sectionId)) {
        sectionId = nextUnusedSectionId(usedSectionIds);
      }
      usedSectionIds.add(sectionId);

      const normalizedSection = normalizeSection(sectionSource, sectionId);
      if (normalizedSection) {
        sections.push(normalizedSection);
      }
    }
  }

  const pointsOfInterest = Array.isArray(source.points_of_interest)
    ? source.points_of_interest
        .map((entry) => normalizePointOfInterestEntry(entry))
        .filter((entry): entry is JsonObject => entry !== null)
    : [];

  const parkingLots = Array.isArray(source.parking_lots)
    ? source.parking_lots
        .map((entry) => normalizeParkingLotEntry(entry))
        .filter((entry): entry is JsonObject => entry !== null)
    : [];

  const rootIdValue = source.id;
  const rootId =
    typeof rootIdValue === "number" && Number.isFinite(rootIdValue)
      ? rootIdValue
      : rootIdValue === null
        ? null
        : typeof rootIdValue === "string"
          ? rootIdValue
          : null;

  return {
    ...source,
    id: rootId,
    coordinates: normalizeCoordinatePair(source.coordinates),
    name: normalizeString(source.name),
    description: normalizeLocalizedText(source.description),
    location: normalizeLocation(source.location),
    parking_lots: parkingLots,
    points_of_interest: pointsOfInterest,
    tracks_access: normalizeStringArray(source.tracks_access),
    cover_image: typeof source.cover_image === "undefined" ? null : source.cover_image,
    sections,
  };
}
