import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RouteMapApp, type TrackBindings, type TrackSnapshot } from "./RouteMapApp";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };
type PathSegment = string | number;
type CountryOption = {
  code: string;
  name: string;
  regions: Array<{ code: string; name: string }>;
};
type SpecialNoteDefinition = {
  noteId: string;
  icon: string;
  templateText: string;
  placeholders: string[];
};
type LocalizedText = Record<string, string>;
type PointOfInterest = {
  coordinates: [number, number];
  name: LocalizedText;
  description: LocalizedText;
};
type ParkingLot = {
  coordinates: [number, number];
  name: LocalizedText;
};
type CanyonJsonEditorProps = {
  mapViewMode: "compact" | "expanded";
  onToggleMapView: () => void;
};
type SectionDeleteConfirmState = {
  path: PathSegment[];
  index: number;
  sectionLabel: string;
};

const DEFAULT_JSON_PATH = "data/Kobelache/data.json";
const COUNTRY_ASSET_PATH = "assets/countries_and_regions.json";
const SPECIAL_NOTES_ASSET_PATH = "assets/special_notes_possibilities.json";
const PARKING_LOT_SUGGESTIONS_ASSET_PATH = "assets/parking_lot_suggestions.json";
const DEFAULT_LANGUAGE_STORAGE_KEY = "canyon-editor.default-language";
const LANGUAGE_KEY_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2})?$/i;
const STATIC_LANGUAGE_KEYS = ["de", "en", "es", "fr", "it", "pt"] as const;
const STATIC_LANGUAGE_SET = new Set<string>(STATIC_LANGUAGE_KEYS);

const ROOT_EDITABLE_KEYS = new Set(["name", "description", "location", "sections"]);
const LOCATION_EDITABLE_KEYS = new Set(["country_code", "region_code"]);
const SECTION_EDITABLE_KEYS = new Set([
  "name",
  "authors",
  "descriptions",
  "special_notes",
  "difficulties",
  "durations_in_minutes",
  "tour_dimensions_in_meter",
  "max_rappel_in_meter",
  "recommended_ropes",
  "topo",
]);
const SECTION_DESCRIPTION_KEYS = new Set(["approach", "canyon", "exit"]);
const SECTION_DURATION_KEYS = [
  "approach_no_shuttle",
  "approach_with_shuttle",
  "canyon",
  "exit_no_shuttle",
  "exit_with_shuttle",
] as const;
const SECTION_DIMENSION_KEYS = ["elevation_start", "elevation_exit", "horizontal_length"] as const;
const COMMITMENT_ROMAN_BY_VALUE = ["0", "I", "II", "III", "IV", "V", "VI"] as const;
const COMMITMENT_VALUE_BY_ROMAN: Record<string, number> = {
  0: 0,
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
};
const IGNORED_KEYS = new Set([
  "coordinates",
  "parking_lots",
  "points_of_interest",
  "tracks_access",
  "track_canyon",
  "official_partner",
  "images",
]);

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSectionPath(path: PathSegment[]): boolean {
  return path.length === 2 && path[0] === "sections" && typeof path[1] === "number";
}

function isSectionsArrayPath(path: PathSegment[]): boolean {
  return path.length === 1 && path[0] === "sections";
}

function isSectionDescriptionsPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "descriptions"
  );
}

function isLocationPath(path: PathSegment[]): boolean {
  return path.length === 1 && path[0] === "location";
}

function isMainNamePath(path: PathSegment[]): boolean {
  return path.length === 1 && path[0] === "name";
}

function isCountryCodePath(path: PathSegment[]): boolean {
  return path.length === 2 && path[0] === "location" && path[1] === "country_code";
}

function isRegionCodePath(path: PathSegment[]): boolean {
  return path.length === 2 && path[0] === "location" && path[1] === "region_code";
}

function isDifficultiesPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "difficulties"
  );
}

function isDurationsPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "durations_in_minutes"
  );
}

function isTourDimensionsPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "tour_dimensions_in_meter"
  );
}

function isSpecialNotesPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "special_notes"
  );
}

function isCompactStringArrayPath(path: PathSegment[]): boolean {
  const lastSegment = path[path.length - 1];
  return lastSegment === "authors";
}

function toPathKey(path: PathSegment[]): string {
  if (path.length === 0) {
    return "$";
  }

  let key = typeof path[0] === "number" ? `[${path[0]}]` : String(path[0]);
  for (let index = 1; index < path.length; index += 1) {
    const segment = path[index];
    key += typeof segment === "number" ? `[${segment}]` : `.${segment}`;
  }

  return key;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getDirectoryPath(filePath: string | null): string | null {
  if (!filePath) {
    return null;
  }

  const normalized = filePath.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  if (slashIndex < 1) {
    return null;
  }

  return normalized.slice(0, slashIndex);
}

function formatCommitmentDifficulty(value: JsonValue): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  if (!Number.isInteger(value) || value < 0 || value >= COMMITMENT_ROMAN_BY_VALUE.length) {
    return String(value);
  }

  return COMMITMENT_ROMAN_BY_VALUE[value];
}

function parseCommitmentDifficulty(value: string): number | null {
  const normalized = value.trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  return COMMITMENT_VALUE_BY_ROMAN[normalized] ?? null;
}

function parseArabicDifficulty(value: string): number | null {
  const normalized = value.trim();
  if (!/^[0-7]$/.test(normalized)) {
    return null;
  }

  return Number.parseInt(normalized, 10);
}

function clampInRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseCoordinatePair(value: JsonValue): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const [lng, lat] = value;
  if (
    typeof lng !== "number" ||
    !Number.isFinite(lng) ||
    typeof lat !== "number" ||
    !Number.isFinite(lat)
  ) {
    return null;
  }

  return [lng, lat];
}

function createEmptyLocalizedText(): LocalizedText {
  const value: LocalizedText = {};
  for (const language of STATIC_LANGUAGE_KEYS) {
    value[language] = "";
  }
  return value;
}

function normalizeLocalizedText(value: JsonValue): LocalizedText {
  if (!isJsonObject(value)) {
    return createEmptyLocalizedText();
  }

  const normalized = createEmptyLocalizedText();
  for (const language of STATIC_LANGUAGE_KEYS) {
    const current = value[language];
    normalized[language] = typeof current === "string" ? current : "";
  }

  return normalized;
}

function parsePointsOfInterest(value: JsonValue): PointOfInterest[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const points: PointOfInterest[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) {
      continue;
    }

    const coordinates = parseCoordinatePair(entry.coordinates ?? null);
    if (!coordinates) {
      continue;
    }

    points.push({
      coordinates,
      name: normalizeLocalizedText(entry.name ?? null),
      description: normalizeLocalizedText(entry.description ?? null),
    });
  }

  return points;
}

function serializePointsOfInterest(points: PointOfInterest[]): JsonValue[] {
  return points.map((point) => ({
    coordinates: point.coordinates,
    name: { ...point.name },
    description: { ...point.description },
  }));
}

function parseParkingLots(value: JsonValue): ParkingLot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parkingLots: ParkingLot[] = [];
  for (const entry of value) {
    if (!isJsonObject(entry)) {
      continue;
    }

    const coordinates = parseCoordinatePair(entry.coordinates ?? null);
    if (!coordinates) {
      continue;
    }

    parkingLots.push({
      coordinates,
      name: normalizeLocalizedText(entry.name ?? null),
    });
  }

  return parkingLots;
}

function serializeParkingLots(parkingLots: ParkingLot[]): JsonValue[] {
  return parkingLots.map((parkingLot) => ({
    coordinates: parkingLot.coordinates,
    name: { ...parkingLot.name },
  }));
}

function normalizeTrackLink(link: string): string {
  const normalized = link.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }

  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("./")) {
    return normalized;
  }

  if (normalized.startsWith("/")) {
    return `.${normalized}`;
  }

  return `./${normalized}`;
}

function buildTrackBindings(canyonData: JsonObject | null, canyonFilePath: string | null): TrackBindings {
  if (!canyonData) {
    return {
      canyonFilePath,
      sections: [],
      access: [],
    };
  }

  const sectionsRaw = Array.isArray(canyonData.sections) ? canyonData.sections : [];
  const sections: TrackBindings["sections"] = sectionsRaw
    .map((entry, index) => {
      if (!isJsonObject(entry)) {
        return null;
      }

      const sectionId = Number.isFinite(Number(entry.id)) ? Number(entry.id) : index;
      const sectionName =
        typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : `Section ${index + 1}`;
      const filePath =
        typeof entry.track_canyon === "string" && entry.track_canyon.trim()
          ? normalizeTrackLink(entry.track_canyon)
          : null;

      return {
        sectionIndex: index,
        sectionId,
        sectionName,
        filePath,
      };
    })
    .filter((entry): entry is TrackBindings["sections"][number] => entry !== null);

  const accessRaw = Array.isArray(canyonData.tracks_access) ? canyonData.tracks_access : [];
  const access: TrackBindings["access"] = accessRaw
    .map((entry, index) => {
      if (typeof entry !== "string" || !entry.trim()) {
        return null;
      }

      return {
        accessIndex: index,
        filePath: normalizeTrackLink(entry),
      };
    })
    .filter((entry): entry is TrackBindings["access"][number] => entry !== null);

  return {
    canyonFilePath,
    sections,
    access,
  };
}

function cloneJsonValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function isLanguageObject(value: JsonValue): value is JsonObject {
  if (!isJsonObject(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }

  for (const key of keys) {
    if (!LANGUAGE_KEY_PATTERN.test(key)) {
      return false;
    }

    if (typeof value[key] !== "string") {
      return false;
    }
  }

  return true;
}

function parseCountriesFromAsset(payload: unknown): CountryOption[] {
  if (!isJsonObject(payload) || !isJsonObject(payload.countries)) {
    return [];
  }

  const countries: CountryOption[] = [];
  for (const [code, entry] of Object.entries(payload.countries)) {
    if (!isJsonObject(entry)) {
      continue;
    }

    const countryName = typeof entry.name === "string" && entry.name.trim() ? entry.name : code;
    const regions: Array<{ code: string; name: string }> = [];

    if (isJsonObject(entry.regions)) {
      for (const [regionCode, regionName] of Object.entries(entry.regions)) {
        if (typeof regionName !== "string") {
          continue;
        }

        regions.push({
          code: regionCode,
          name: regionName,
        });
      }
    }

    regions.sort((left, right) => left.name.localeCompare(right.name));
    countries.push({
      code,
      name: countryName,
      regions,
    });
  }

  countries.sort((left, right) => left.name.localeCompare(right.name));
  return countries;
}

function extractPlaceholders(templateText: string): string[] {
  const placeholders: string[] = [];
  const seen = new Set<string>();
  const matcher = /{{\s*([A-Z0-9_]+)\s*}}/g;
  let match: RegExpExecArray | null = matcher.exec(templateText);

  while (match) {
    const key = match[1];
    if (!seen.has(key)) {
      seen.add(key);
      placeholders.push(key);
    }

    match = matcher.exec(templateText);
  }

  return placeholders;
}

function parseSpecialNoteDefinitions(payload: unknown): SpecialNoteDefinition[] {
  if (!isJsonObject(payload) || !isJsonObject(payload.possible_special_notes)) {
    return [];
  }

  const definitions: SpecialNoteDefinition[] = [];
  const seenNoteIds = new Set<string>();
  for (const [noteId, rawDefinition] of Object.entries(payload.possible_special_notes)) {
    if (seenNoteIds.has(noteId)) {
      continue;
    }

    if (!isJsonObject(rawDefinition)) {
      continue;
    }

    const icon = typeof rawDefinition.icon === "string" ? rawDefinition.icon.trim() : "";
    const templateText = typeof rawDefinition.text === "string" ? rawDefinition.text : "";
    if (!icon || !templateText) {
      continue;
    }

    definitions.push({
      noteId,
      icon,
      templateText,
      placeholders: extractPlaceholders(templateText),
    });
    seenNoteIds.add(noteId);
  }

  definitions.sort((left, right) => left.noteId.localeCompare(right.noteId));
  return definitions;
}

function normalizeParams(value: JsonValue): Record<string, string> {
  if (!isJsonObject(value)) {
    return {};
  }

  const params: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      params[key] = raw;
      continue;
    }

    if (typeof raw === "number" || typeof raw === "boolean") {
      params[key] = String(raw);
    }
  }

  return params;
}

function resolveSpecialNoteText(templateText: string, params: Record<string, string>): string {
  return templateText.replace(/{{\s*([A-Z0-9_]+)\s*}}/g, (match, key: string) => {
    const value = params[key];
    return typeof value === "string" && value.trim() ? value : match;
  });
}

function getNoteIdFromEntry(
  entry: JsonValue,
  noteIdByIcon: Map<string, string>,
): string | null {
  if (!isJsonObject(entry)) {
    return null;
  }

  if (typeof entry.note_id === "string" && entry.note_id.trim()) {
    return entry.note_id.trim();
  }

  if (typeof entry.icon === "string" && entry.icon.trim()) {
    return noteIdByIcon.get(entry.icon.trim()) ?? null;
  }

  return null;
}

function parseStaticLanguagePastePayload(payload: unknown): { value: JsonObject | null; error: string | null } {
  if (!isJsonObject(payload)) {
    return {
      value: null,
      error: "The pasted content must be a JSON object.",
    };
  }

  for (const key of Object.keys(payload)) {
    if (!STATIC_LANGUAGE_SET.has(key)) {
      return {
        value: null,
        error: `Unsupported language key "${key}". Allowed keys: ${STATIC_LANGUAGE_KEYS.join(", ")}.`,
      };
    }
  }

  const output: JsonObject = {};
  for (const language of STATIC_LANGUAGE_KEYS) {
    const rawValue = payload[language];
    if (typeof rawValue !== "string") {
      return {
        value: null,
        error: `Language "${language}" must be a string.`,
      };
    }

    output[language] = rawValue;
  }

  return { value: output, error: null };
}

function parseParkingLotSuggestionsFromAsset(payload: unknown): LocalizedText[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  const suggestions: LocalizedText[] = [];
  for (const entry of payload) {
    const validation = parseStaticLanguagePastePayload(entry);
    if (!validation.value) {
      continue;
    }

    const suggestion: LocalizedText = {};
    for (const language of STATIC_LANGUAGE_KEYS) {
      suggestion[language] = typeof validation.value[language] === "string" ? validation.value[language] : "";
    }

    suggestions.push(suggestion);
  }

  return suggestions;
}

function createEmptyNewCanyonData(template: JsonObject, canyonName: string): JsonObject {
  const description: JsonObject = {};
  for (const language of STATIC_LANGUAGE_KEYS) {
    description[language] = "";
  }

  const location: JsonObject = {
    country_code: "",
    region_code: "",
  };

  return {
    ...template,
    name: canyonName,
    description,
    location,
    sections: [],
  };
}

function shouldRenderChild(parentPath: PathSegment[], key: string, value: JsonValue): boolean {
  if (value === null) {
    return false;
  }

  if (IGNORED_KEYS.has(key)) {
    return false;
  }

  if (parentPath.length === 0) {
    return ROOT_EDITABLE_KEYS.has(key);
  }

  if (isLocationPath(parentPath)) {
    return LOCATION_EDITABLE_KEYS.has(key);
  }

  if (isSectionPath(parentPath)) {
    if (key === "name") {
      return false;
    }

    return SECTION_EDITABLE_KEYS.has(key);
  }

  if (isSectionDescriptionsPath(parentPath)) {
    return SECTION_DESCRIPTION_KEYS.has(key);
  }

  return true;
}

function valueAtPath(root: JsonValue, path: PathSegment[]): JsonValue {
  let current: JsonValue = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return null;
      }

      current = current[segment] ?? null;
      continue;
    }

    if (!isJsonObject(current) || !(segment in current)) {
      return null;
    }

    current = current[segment] ?? null;
  }

  return current;
}

function setAtPath(root: JsonValue, path: PathSegment[], nextValue: JsonValue): JsonValue {
  if (path.length === 0) {
    return nextValue;
  }

  const [head, ...rest] = path;
  if (typeof head === "number") {
    const currentArray = Array.isArray(root) ? root : [];
    const clone = currentArray.slice();
    clone[head] = setAtPath(clone[head] ?? null, rest, nextValue);
    return clone;
  }

  const currentObject = isJsonObject(root) ? root : {};
  const clone: JsonObject = { ...currentObject };
  clone[head] = setAtPath(clone[head] ?? null, rest, nextValue);
  return clone;
}

function removeArrayIndex(root: JsonValue, arrayPath: PathSegment[], index: number): JsonValue {
  const currentArray = valueAtPath(root, arrayPath);
  if (!Array.isArray(currentArray) || index < 0 || index >= currentArray.length) {
    return root;
  }

  const clone = currentArray.slice();
  clone.splice(index, 1);
  return setAtPath(root, arrayPath, clone);
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }

  const clone = items.slice();
  const [moved] = clone.splice(fromIndex, 1);
  if (typeof moved === "undefined") {
    return items;
  }

  clone.splice(toIndex, 0, moved);
  return clone;
}

function withGeneratedSectionIds(root: JsonObject): JsonObject {
  const sectionsValue = root.sections;
  if (!Array.isArray(sectionsValue)) {
    return root;
  }

  const nextSections = sectionsValue.map((entry, index) => {
    if (!isJsonObject(entry)) {
      return entry;
    }

    return {
      ...entry,
      id: index,
    } as JsonValue;
  });

  return {
    ...root,
    sections: nextSections,
  };
}

function defaultFromSample(sample: JsonValue): JsonValue {
  if (sample === null) {
    return "";
  }

  if (typeof sample === "string") {
    return "";
  }

  if (typeof sample === "number") {
    return 0;
  }

  if (typeof sample === "boolean") {
    return false;
  }

  if (Array.isArray(sample)) {
    return [];
  }

  const output: JsonObject = {};
  for (const [key, value] of Object.entries(sample)) {
    output[key] = defaultFromSample(value);
  }
  return output;
}

function createDefaultSection(existingSections: JsonValue[]): JsonObject {
  let maxId = -1;
  for (const section of existingSections) {
    if (isJsonObject(section) && typeof section.id === "number" && Number.isFinite(section.id)) {
      maxId = Math.max(maxId, section.id);
    }
  }

  return {
    id: maxId + 1,
    name: "Part1",
    authors: [],
    descriptions: {
      approach: { en: "" },
      canyon: { en: "" },
      exit: { en: "" },
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
    recommended_ropes: "",
    topo: "",
  };
}

function newArrayItem(path: PathSegment[], arrayValue: JsonValue[]): JsonValue {
  if (path.length === 1 && path[0] === "sections") {
    return createDefaultSection(arrayValue);
  }

  if (arrayValue.length > 0) {
    return defaultFromSample(arrayValue[0]);
  }

  const lastSegment = path[path.length - 1];
  if (lastSegment === "authors") {
    return "";
  }

  return "";
}

function isTopoPath(path: PathSegment[]): boolean {
  return (
    path.length === 3 &&
    path[0] === "sections" &&
    typeof path[1] === "number" &&
    path[2] === "topo"
  );
}

export function CanyonJsonEditor({ mapViewMode, onToggleMapView }: CanyonJsonEditorProps): JSX.Element {
  const trackSnapshotRef = useRef<TrackSnapshot | null>(null);
  const [canyonData, setCanyonData] = useState<JsonObject | null>(null);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Loading data/Kobelache/data.json...");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [specialNoteDefinitions, setSpecialNoteDefinitions] = useState<SpecialNoteDefinition[]>([]);
  const [parkingLotSuggestions, setParkingLotSuggestions] = useState<LocalizedText[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [languageTabs, setLanguageTabs] = useState<Record<string, string>>({});
  const [defaultLanguage, setDefaultLanguage] = useState<(typeof STATIC_LANGUAGE_KEYS)[number]>(() => {
    if (typeof window === "undefined") {
      return "en";
    }

    const stored = window.localStorage.getItem(DEFAULT_LANGUAGE_STORAGE_KEY);
    if (stored && STATIC_LANGUAGE_SET.has(stored)) {
      return stored as (typeof STATIC_LANGUAGE_KEYS)[number];
    }

    return "en";
  });
  const [languagePasteTargetPath, setLanguagePasteTargetPath] = useState<PathSegment[] | null>(null);
  const [languagePasteDraft, setLanguagePasteDraft] = useState("");
  const [languagePasteError, setLanguagePasteError] = useState("");
  const [topoWarningMessage, setTopoWarningMessage] = useState("");
  const [isNewCanyonModalOpen, setIsNewCanyonModalOpen] = useState(false);
  const [newCanyonNameDraft, setNewCanyonNameDraft] = useState("");
  const [newCanyonNameError, setNewCanyonNameError] = useState("");
  const [sectionDeleteConfirm, setSectionDeleteConfirm] = useState<SectionDeleteConfirmState | null>(null);

  const baseDirectory = useMemo(() => getDirectoryPath(currentFilePath), [currentFilePath]);
  const topoDefaultDirectory = useMemo(
    () => (baseDirectory ? `${baseDirectory}/topos` : null),
    [baseDirectory],
  );
  const countryByCode = useMemo(() => {
    return new Map(countries.map((country) => [country.code, country] as const));
  }, [countries]);
  const specialNoteById = useMemo(() => {
    return new Map(specialNoteDefinitions.map((definition) => [definition.noteId, definition] as const));
  }, [specialNoteDefinitions]);
  const specialNoteIdByIcon = useMemo(() => {
    return new Map(specialNoteDefinitions.map((definition) => [definition.icon, definition.noteId] as const));
  }, [specialNoteDefinitions]);
  const selectedCountryCode = useMemo(() => {
    if (!canyonData) {
      return "";
    }

    const countryValue = valueAtPath(canyonData, ["location", "country_code"]);
    return typeof countryValue === "string" ? countryValue : "";
  }, [canyonData]);
  const selectedCountryRegions = useMemo(() => {
    return countryByCode.get(selectedCountryCode)?.regions ?? [];
  }, [countryByCode, selectedCountryCode]);
  const overviewCoordinate = useMemo(() => {
    if (!canyonData) {
      return null;
    }

    return parseCoordinatePair(valueAtPath(canyonData, ["coordinates"]));
  }, [canyonData]);
  const pointsOfInterest = useMemo(() => {
    if (!canyonData) {
      return [];
    }

    return parsePointsOfInterest(valueAtPath(canyonData, ["points_of_interest"]));
  }, [canyonData]);
  const parkingLots = useMemo(() => {
    if (!canyonData) {
      return [];
    }

    return parseParkingLots(valueAtPath(canyonData, ["parking_lots"]));
  }, [canyonData]);
  const trackBindings = useMemo(
    () => buildTrackBindings(canyonData, currentFilePath),
    [canyonData, currentFilePath],
  );

  const onTrackSnapshotChange = useCallback((snapshot: TrackSnapshot): void => {
    trackSnapshotRef.current = snapshot;
  }, []);

  const clearValidationError = useCallback((pathKey: string): void => {
    setValidationErrors((current) => {
      if (!(pathKey in current)) {
        return current;
      }

      const next = { ...current };
      delete next[pathKey];
      return next;
    });
  }, []);

  const setValidationError = useCallback((pathKey: string, message: string): void => {
    setValidationErrors((current) => ({
      ...current,
      [pathKey]: message,
    }));
  }, []);

  const clearDraft = useCallback((pathKey: string): void => {
    setInputDrafts((current) => {
      if (!(pathKey in current)) {
        return current;
      }

      const next = { ...current };
      delete next[pathKey];
      return next;
    });
  }, []);

  const setPathValue = useCallback(
    (path: PathSegment[], nextValue: JsonValue): void => {
      setCanyonData((current) => {
        if (!current) {
          return current;
        }

        const updated = setAtPath(current, path, nextValue);
        if (!isJsonObject(updated)) {
          return current;
        }

        if (isSectionsArrayPath(path) || path[0] === "sections") {
          return withGeneratedSectionIds(updated);
        }

        return updated;
      });

      clearValidationError(toPathKey(path));
    },
    [clearValidationError],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(DEFAULT_LANGUAGE_STORAGE_KEY, defaultLanguage);
  }, [defaultLanguage]);

  useEffect(() => {
    let canceled = false;

    async function loadInitialJson(): Promise<void> {
      const result = await window.api.loadJsonFromPath(DEFAULT_JSON_PATH);
      if (canceled) {
        return;
      }

      if (!result.canceled && result.data && isJsonObject(result.data)) {
        setCanyonData(withGeneratedSectionIds(cloneJsonValue(result.data)));
        trackSnapshotRef.current = null;
        setCurrentFilePath(result.filePath ?? null);
        setStatusMessage(result.filePath ?? DEFAULT_JSON_PATH);
        return;
      }

      const template = await window.api.createNewJsonTemplate("New Canyon");
      if (canceled) {
        return;
      }

      setCanyonData(isJsonObject(template) ? cloneJsonValue(template) : null);
      trackSnapshotRef.current = null;
      setCurrentFilePath(null);
      setStatusMessage(
        result.error ? `Could not load default JSON: ${result.error}` : "Started with a new JSON template.",
      );
    }

    void loadInitialJson().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unexpected initialization error.";
      setStatusMessage(message);
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadParkingLotSuggestions(): Promise<void> {
      const result = await window.api.loadJsonFromPath(PARKING_LOT_SUGGESTIONS_ASSET_PATH);
      if (canceled) {
        return;
      }

      if (result.canceled || !result.data) {
        return;
      }

      setParkingLotSuggestions(parseParkingLotSuggestionsFromAsset(result.data));
    }

    void loadParkingLotSuggestions().catch(() => {
      if (!canceled) {
        setParkingLotSuggestions([]);
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadSpecialNotes(): Promise<void> {
      const result = await window.api.loadJsonFromPath(SPECIAL_NOTES_ASSET_PATH);
      if (canceled) {
        return;
      }

      if (result.canceled || !result.data) {
        return;
      }

      setSpecialNoteDefinitions(parseSpecialNoteDefinitions(result.data));
    }

    void loadSpecialNotes().catch(() => {
      if (!canceled) {
        setSpecialNoteDefinitions([]);
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadCountries(): Promise<void> {
      const result = await window.api.loadJsonFromPath(COUNTRY_ASSET_PATH);
      if (canceled) {
        return;
      }

      if (result.canceled || !result.data) {
        return;
      }

      const parsedCountries = parseCountriesFromAsset(result.data);
      setCountries(parsedCountries);
    }

    void loadCountries().catch(() => {
      if (!canceled) {
        setCountries([]);
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!canyonData) {
      return;
    }

    if (!selectedCountryCode) {
      return;
    }

    const selectedCountry = countryByCode.get(selectedCountryCode);
    if (!selectedCountry) {
      return;
    }

    const regionValue = valueAtPath(canyonData, ["location", "region_code"]);
    if (typeof regionValue !== "string") {
      return;
    }

    if (!regionValue) {
      return;
    }

    const validRegionCodes = new Set(selectedCountry.regions.map((region) => region.code));
    if (!validRegionCodes.has(regionValue)) {
      setPathValue(["location", "region_code"], "");
    }
  }, [canyonData, countryByCode, selectedCountryCode, setPathValue]);

  const onLoadJson = useCallback(async (): Promise<void> => {
    const result = await window.api.loadJsonFromDialog();
    if (result.canceled) {
      setStatusMessage("Load canceled.");
      return;
    }

    if (result.error) {
      setStatusMessage(`Load failed: ${result.error}`);
      return;
    }

    if (!result.data || !isJsonObject(result.data)) {
      setStatusMessage("Loaded file is not a valid JSON object.");
      return;
    }

    setCanyonData(withGeneratedSectionIds(cloneJsonValue(result.data)));
    trackSnapshotRef.current = null;
    setCurrentFilePath(result.filePath ?? null);
    setValidationErrors({});
    setInputDrafts({});
    setCollapsedGroups({});
    setLanguageTabs({});
    setStatusMessage(result.filePath ?? "JSON file");
  }, []);

  const onNewJson = useCallback((): void => {
    setIsNewCanyonModalOpen(true);
    setNewCanyonNameDraft("");
    setNewCanyonNameError("");
  }, []);

  const onCloseNewCanyonModal = useCallback((): void => {
    setIsNewCanyonModalOpen(false);
    setNewCanyonNameError("");
  }, []);

  const onCreateNewCanyon = useCallback(async (): Promise<void> => {
    const canyonName = newCanyonNameDraft.trim();
    if (!canyonName) {
      setNewCanyonNameError("Canyon name is required.");
      return;
    }

    const folderResult = await window.api.createCanyonFolder(canyonName);
    if (folderResult.error) {
      setNewCanyonNameError(folderResult.error);
      return;
    }

    const template = await window.api.createNewJsonTemplate(canyonName);
    if (!isJsonObject(template)) {
      setNewCanyonNameError("Could not create JSON template.");
      return;
    }

    const nextData = createEmptyNewCanyonData(cloneJsonValue(template), canyonName);
    setCanyonData(withGeneratedSectionIds(nextData));
    trackSnapshotRef.current = null;
    setCurrentFilePath(folderResult.dataJsonPath ?? null);
    setValidationErrors({});
    setInputDrafts({});
    setCollapsedGroups({});
    setLanguageTabs({});
    setIsNewCanyonModalOpen(false);
    setNewCanyonNameError("");
    setStatusMessage(`Created new canyon folder: ${folderResult.folderPath ?? "data"}`);
  }, [newCanyonNameDraft]);

  const onSaveJson = useCallback(async (): Promise<void> => {
    if (!canyonData) {
      setStatusMessage("Nothing to save.");
      return;
    }

    if (Object.keys(validationErrors).length > 0) {
      setStatusMessage("Resolve validation errors before saving.");
      return;
    }

    setIsSaving(true);
    try {
      const result = await window.api.saveCanyonWithTracks({
        currentFilePath,
        canyonName: typeof canyonData.name === "string" ? canyonData.name : "canyon",
        canyonData,
        trackSnapshot: trackSnapshotRef.current,
      });

      if (result.canceled) {
        setStatusMessage("Save canceled.");
        return;
      }

      if (result.error) {
        setStatusMessage(`Save failed: ${result.error}`);
        return;
      }

      if (result.filePath) {
        setCurrentFilePath(result.filePath);
      }

      if (result.data && isJsonObject(result.data)) {
        setCanyonData(withGeneratedSectionIds(cloneJsonValue(result.data)));
      }

      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        setStatusMessage(`Saved with warnings: ${result.warnings.join(" | ")}`);
        return;
      }

      setStatusMessage(`Saved ${result.filePath ?? "JSON file"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected save error.";
      setStatusMessage(message);
    } finally {
      setIsSaving(false);
    }
  }, [canyonData, currentFilePath, validationErrors]);

  const onNumberDraftChange = useCallback(
    (path: PathSegment[], nextText: string): void => {
      const key = toPathKey(path);
      setInputDrafts((current) => ({
        ...current,
        [key]: nextText,
      }));

      if (!nextText.trim()) {
        setValidationError(key, "Number is required.");
        return;
      }

      const parsed = Number(nextText);
      if (!Number.isFinite(parsed)) {
        setValidationError(key, "Must be a valid number.");
        return;
      }

      setPathValue(path, parsed);
      clearValidationError(key);
    },
    [clearValidationError, setPathValue, setValidationError],
  );

  const onDifficultyArabicDraftChange = useCallback(
    (path: PathSegment[], nextText: string): void => {
      const key = toPathKey(path);
      setInputDrafts((current) => ({
        ...current,
        [key]: nextText,
      }));

      const parsed = parseArabicDifficulty(nextText);
      if (parsed === null) {
        setValidationError(key, "Use a single digit from 0 to 7.");
        return;
      }

      setPathValue(path, parsed);
      clearValidationError(key);
    },
    [clearValidationError, setPathValue, setValidationError],
  );

  const onDifficultyRomanDraftChange = useCallback(
    (path: PathSegment[], nextText: string): void => {
      const key = toPathKey(path);
      const normalizedText = nextText.toUpperCase();

      setInputDrafts((current) => ({
        ...current,
        [key]: normalizedText,
      }));

      const parsed = parseCommitmentDifficulty(normalizedText);
      if (parsed === null) {
        setValidationError(key, "Use 0, I, II, III, IV, V, or VI.");
        return;
      }

      setPathValue(path, parsed);
      clearValidationError(key);
    },
    [clearValidationError, setPathValue, setValidationError],
  );

  const onDifficultyArabicStep = useCallback(
    (path: PathSegment[], draftValue: string, storedValue: JsonValue, delta: number): void => {
      const key = toPathKey(path);
      const draftNumber = parseArabicDifficulty(draftValue);
      const storedNumber =
        typeof storedValue === "number" && Number.isFinite(storedValue)
          ? clampInRange(Math.trunc(storedValue), 0, 7)
          : 0;
      const next = clampInRange((draftNumber ?? storedNumber) + delta, 0, 7);

      setInputDrafts((current) => ({
        ...current,
        [key]: String(next),
      }));
      setPathValue(path, next);
      clearValidationError(key);
    },
    [clearValidationError, setPathValue],
  );

  const onDifficultyRomanStep = useCallback(
    (path: PathSegment[], draftValue: string, storedValue: JsonValue, delta: number): void => {
      const key = toPathKey(path);
      const draftNumber = parseCommitmentDifficulty(draftValue);
      const storedNumber =
        typeof storedValue === "number" && Number.isFinite(storedValue)
          ? clampInRange(Math.trunc(storedValue), 0, 6)
          : 0;
      const next = clampInRange((draftNumber ?? storedNumber) + delta, 0, 6);

      setInputDrafts((current) => ({
        ...current,
        [key]: COMMITMENT_ROMAN_BY_VALUE[next],
      }));
      setPathValue(path, next);
      clearValidationError(key);
    },
    [clearValidationError, setPathValue],
  );

  const buildSpecialNoteEntry = useCallback(
    (noteId: string, params: Record<string, string>): JsonObject => {
      const outputParams: JsonObject = {};
      for (const [key, value] of Object.entries(params)) {
        outputParams[key] = value;
      }

      return {
        note_id: noteId,
        params: outputParams,
      };
    },
    [],
  );

  const onSpecialNoteToggle = useCallback(
    (path: PathSegment[], currentNotes: JsonValue[], noteId: string, nextSelected: boolean): void => {
      const filtered = currentNotes.filter((entry) => getNoteIdFromEntry(entry, specialNoteIdByIcon) !== noteId);
      if (!nextSelected) {
        setPathValue(path, filtered);
        return;
      }

      const definition = specialNoteById.get(noteId);
      if (!definition) {
        setPathValue(path, filtered);
        return;
      }

      const params: Record<string, string> = {};
      for (const placeholder of definition.placeholders) {
        params[placeholder] = "";
      }

      setPathValue(path, [...filtered, buildSpecialNoteEntry(noteId, params)]);
    },
    [buildSpecialNoteEntry, setPathValue, specialNoteById, specialNoteIdByIcon],
  );

  const onSpecialNoteParamChange = useCallback(
    (
      path: PathSegment[],
      currentNotes: JsonValue[],
      noteId: string,
      parameterKey: string,
      parameterValue: string,
    ): void => {
      let updatedAny = false;
      const updatedNotes = currentNotes.map((entry) => {
        if (!isJsonObject(entry)) {
          return entry;
        }

        const resolvedNoteId = getNoteIdFromEntry(entry, specialNoteIdByIcon);
        if (resolvedNoteId !== noteId) {
          return entry;
        }

        const currentParams = normalizeParams(entry.params ?? null);
        const nextParams = {
          ...currentParams,
          [parameterKey]: parameterValue,
        };
        updatedAny = true;
        return buildSpecialNoteEntry(noteId, nextParams);
      });

      if (updatedAny) {
        setPathValue(path, updatedNotes);
      }
    },
    [buildSpecialNoteEntry, setPathValue, specialNoteIdByIcon],
  );

  const onSpecialNoteRemoveUnknown = useCallback(
    (path: PathSegment[], currentNotes: JsonValue[], indexToRemove: number): void => {
      const nextNotes = currentNotes.filter((_, index) => index !== indexToRemove);
      setPathValue(path, nextNotes);
    },
    [setPathValue],
  );

  const onTopoFilePick = useCallback(
    async (path: PathSegment[]): Promise<void> => {
      if (!baseDirectory) {
        setStatusMessage("Select or create a canyon JSON first before choosing a topo file.");
        return;
      }

      const result = await window.api.pickFile({
        baseDir: baseDirectory,
        defaultPath: topoDefaultDirectory,
        title: "Select topo file",
        filters: [{ name: "Topo Images", extensions: ["webp", "png", "jpg", "jpeg"] }],
      });

      if (result.canceled) {
        return;
      }

      const relativePath = typeof result.relativePath === "string" ? result.relativePath : "";
      const normalizedRelativePath = relativePath.replace(/\\/g, "/");
      if (!normalizedRelativePath.startsWith("./topos/")) {
        setPathValue(path, "");
        const warningMessage = "Invalid topo selection. The image must be located in the /topos folder.";
        setStatusMessage(warningMessage);
        setTopoWarningMessage(warningMessage);
        return;
      }

      const storedTopoPath = `/${normalizedRelativePath.slice(2)}`;
      setPathValue(path, storedTopoPath);
    },
    [baseDirectory, setPathValue, setStatusMessage, topoDefaultDirectory],
  );

  const onCountryCodeChange = useCallback(
    (nextCountryCode: string): void => {
      setPathValue(["location", "country_code"], nextCountryCode);
      setPathValue(["location", "region_code"], "");
    },
    [setPathValue],
  );

  const onOverviewCoordinateSet = useCallback(
    (coordinate: [number, number]): void => {
      setPathValue(["coordinates"], coordinate);
    },
    [setPathValue],
  );

  const onPointsOfInterestChange = useCallback(
    (nextPointsOfInterest: PointOfInterest[]): void => {
      setPathValue(["points_of_interest"], serializePointsOfInterest(nextPointsOfInterest));
    },
    [setPathValue],
  );
  const onParkingLotsChange = useCallback(
    (nextParkingLots: ParkingLot[]): void => {
      setPathValue(["parking_lots"], serializeParkingLots(nextParkingLots));
    },
    [setPathValue],
  );

  const openLanguagePasteModal = useCallback((path: PathSegment[]): void => {
    setLanguagePasteTargetPath(path);
    setLanguagePasteDraft("");
    setLanguagePasteError("");
  }, []);

  const closeLanguagePasteModal = useCallback((): void => {
    setLanguagePasteTargetPath(null);
    setLanguagePasteError("");
  }, []);

  const onApplyLanguagePaste = useCallback((): void => {
    if (!languagePasteTargetPath) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(languagePasteDraft);
    } catch {
      setLanguagePasteError("Invalid JSON format.");
      return;
    }

    const validation = parseStaticLanguagePastePayload(parsed);
    if (!validation.value || validation.error) {
      setLanguagePasteError(validation.error ?? "Invalid language JSON payload.");
      return;
    }

    setPathValue(languagePasteTargetPath, validation.value);
    setLanguagePasteTargetPath(null);
    setLanguagePasteError("");
  }, [languagePasteDraft, languagePasteTargetPath, setPathValue]);

  const onConfirmSectionDelete = useCallback((): void => {
    if (!sectionDeleteConfirm) {
      return;
    }

    setCanyonData((current) => {
      if (!current) {
        return current;
      }
      const next = removeArrayIndex(current, sectionDeleteConfirm.path, sectionDeleteConfirm.index);
      if (!isJsonObject(next)) {
        return current;
      }
      return withGeneratedSectionIds(next);
    });
    setSectionDeleteConfirm(null);
  }, [sectionDeleteConfirm]);

  const renderNode = useCallback(
    (value: JsonValue, path: PathSegment[], label: string): JSX.Element | null => {
      if (value === null) {
        return null;
      }

      const pathKey = toPathKey(path);
      const isCollapsed = collapsedGroups[pathKey] ?? false;
      const validationError = validationErrors[pathKey];

      if (isLanguageObject(value)) {
        const activeLanguage =
          languageTabs[pathKey] && STATIC_LANGUAGE_SET.has(languageTabs[pathKey])
            ? languageTabs[pathKey]
            : defaultLanguage;
        const cardTitle =
          path.length === 1 && path[0] === "description" ? "Short Characteristic" : titleCase(label);
        const isShortCharacteristic = path.length === 1 && path[0] === "description";

        return (
          <section className="json-card">
            <div className="json-card-header">
              <div className="json-language-header-left">
                <h3>{cardTitle}</h3>
                <button
                  type="button"
                  onClick={() => openLanguagePasteModal(path)}
                >
                  Paste JSON
                </button>
              </div>
            </div>

            <div className="json-language-tabs">
              {STATIC_LANGUAGE_KEYS.map((language) => (
                <button
                  type="button"
                  key={language}
                  className={`json-language-tab${activeLanguage === language ? " active" : ""}`}
                  onClick={() =>
                    setLanguageTabs((current) => ({
                      ...current,
                      [pathKey]: language,
                    }))
                  }
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>

            <div
              className={`json-language-content${isShortCharacteristic ? " json-language-content-short-characteristic" : ""}`}
            >
              <textarea
                value={typeof value[activeLanguage] === "string" ? value[activeLanguage] : ""}
                rows={4}
                onChange={(event) => setPathValue([...path, activeLanguage], event.target.value)}
              />
            </div>
          </section>
        );
      }

      if (Array.isArray(value)) {
        const isSectionsArray = isSectionsArrayPath(path);

        if (isSpecialNotesPath(path)) {
          const selectedByNoteId = new Map<string, { index: number; params: Record<string, string> }>();
          const unknownEntries: Array<{ index: number; entry: JsonValue }> = [];

          for (let index = 0; index < value.length; index += 1) {
            const entry = value[index];
            const noteId = getNoteIdFromEntry(entry, specialNoteIdByIcon);
            if (!noteId || !specialNoteById.has(noteId)) {
              unknownEntries.push({ index, entry });
              continue;
            }

            if (!selectedByNoteId.has(noteId)) {
              const params = isJsonObject(entry) ? normalizeParams(entry.params ?? null) : {};
              selectedByNoteId.set(noteId, { index, params });
            }
          }

          const selectedNoteIds = new Set(selectedByNoteId.keys());

          return (
            <div className="json-input-field json-special-notes-field">
              <label>{titleCase(label)}</label>
              {specialNoteDefinitions.length === 0 ? (
                <p className="json-empty-text">No special note definitions available.</p>
              ) : (
                <div className="json-special-note-options">
                  {specialNoteDefinitions.map((definition) => {
                    const selected = selectedByNoteId.get(definition.noteId);
                    const currentParams = { ...(selected?.params ?? {}) };
                    for (const placeholder of definition.placeholders) {
                      if (!(placeholder in currentParams)) {
                        currentParams[placeholder] = "";
                      }
                    }

                    const resolvedText = resolveSpecialNoteText(definition.templateText, currentParams);

                    return (
                      <div key={definition.noteId} className="json-special-note-option">
                      <input
                        type="checkbox"
                        checked={selectedNoteIds.has(definition.noteId)}
                        onChange={(event) =>
                          onSpecialNoteToggle(path, value, definition.noteId, event.target.checked)
                        }
                      />
                      <span className="json-special-note-icon">{definition.icon}</span>
                      <span className="json-special-note-option-body">
                        <span className="json-special-note-option-head">
                          <span className="json-special-note-key">{definition.noteId}</span>
                          {selected && definition.placeholders.length > 0 ? (
                            <span className="json-special-note-inline-params">
                              {definition.placeholders.map((placeholder) => (
                                <label key={placeholder} className="json-special-note-inline-param">
                                  <span>{placeholder}</span>
                                  <input
                                    type="text"
                                    value={currentParams[placeholder] ?? ""}
                                    onChange={(event) =>
                                      onSpecialNoteParamChange(
                                        path,
                                        value,
                                        definition.noteId,
                                        placeholder,
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                              ))}
                            </span>
                          ) : null}
                        </span>
                        <span className="json-special-note-template">{resolvedText}</span>
                      </span>
                    </div>
                    );
                  })}
                </div>
              )}

              {unknownEntries.length > 0 ? (
                <div className="json-special-note-unknown-list">
                  {unknownEntries.map((unknown) => {
                let unknownLabel = `Entry ${unknown.index + 1}`;
                if (isJsonObject(unknown.entry) && typeof unknown.entry.note_id === "string") {
                  unknownLabel = unknown.entry.note_id;
                } else if (isJsonObject(unknown.entry) && typeof unknown.entry.icon === "string") {
                  unknownLabel = `Legacy icon ${unknown.entry.icon}`;
                }

                return (
                  <div key={`${pathKey}.unknown.${unknown.index}`} className="json-special-note-unknown-row">
                    <div className="json-special-note-unknown-title">
                        <span className="json-special-note-key">{unknownLabel}</span>
                    </div>
                      <button
                        type="button"
                        className="json-danger-button"
                        onClick={() => onSpecialNoteRemoveUnknown(path, value, unknown.index)}
                      >
                        Remove
                      </button>
                    <p className="json-special-note-resolved">
                      Unknown special note entry. Add it to `assets/special_notes_possibilities.json` or remove it.
                    </p>
                  </div>
                );
              })}
                </div>
              ) : null}
            </div>
          );
        }

        if (isCompactStringArrayPath(path) && value.every((item) => typeof item === "string")) {
          const lastSegment = path[path.length - 1];
          const itemLabel = lastSegment === "authors" ? "Author" : "Note";

          return (
            <div className="json-input-field json-compact-list">
              <div className="json-compact-list-header">
                <label>{titleCase(label)}</label>
                <button
                  type="button"
                  onClick={() => setPathValue(path, [...value, ""])}
                >
                  + Add {itemLabel}
                </button>
              </div>

              {value.length === 0 ? <p className="json-empty-text">No entries.</p> : null}

              {value.map((entry, index) => (
                <div className="json-compact-list-row" key={`${pathKey}.${index}`}>
                  <input
                    type="text"
                    value={entry}
                    onChange={(event) => {
                      const next = value.slice();
                      next[index] = event.target.value;
                      setPathValue(path, next);
                    }}
                  />
                  <button
                    type="button"
                    className="json-danger-button"
                    onClick={() => {
                      const next = value.slice();
                      next.splice(index, 1);
                      setPathValue(path, next);
                    }}
                    aria-label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`}
                    title="Remove"
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          );
        }

        if (isSectionsArray) {
          return (
            <div className="json-sections-block">
              <div className="json-sections-list">
                {value.length === 0 ? <p className="json-empty-text">No sections.</p> : null}
                {value.map((item, index) => {
                  if (item === null) {
                    return null;
                  }

                  const itemPath = [...path, index];
                  const itemPathKey = toPathKey(itemPath);
                  const itemCollapsed = collapsedGroups[itemPathKey] ?? true;
                  const itemTitle = `Section ${index + 1}`;
                  const sectionName =
                    isJsonObject(item) && typeof item.name === "string" ? item.name : "";

                  return (
                    <article key={itemPathKey} className="json-array-item">
                      <div className="json-array-item-header">
                        <div className="json-array-item-main">
                          <button
                            type="button"
                            className="json-chevron-toggle"
                            onClick={() =>
                              setCollapsedGroups((current) => ({
                                ...current,
                                [itemPathKey]: !itemCollapsed,
                              }))
                            }
                            aria-label={`${itemCollapsed ? "Expand" : "Collapse"} ${itemTitle}`}
                            title={itemCollapsed ? "Expand section" : "Collapse section"}
                          >
                            {itemCollapsed ? "\u25BC" : "\u25B2"}
                          </button>
                          <input
                            type="text"
                            className="json-section-name-header-input"
                            value={sectionName}
                            onChange={(event) => setPathValue([...itemPath, "name"], event.target.value)}
                            placeholder="Section name"
                            aria-label={`Section ${index + 1} name`}
                          />
                        </div>
                        <div className="json-array-item-actions">
                          <button
                            type="button"
                            className="json-array-arrow-btn"
                            disabled={index === 0}
                            onClick={() => {
                              const moved = moveArrayItem(value, index, index - 1);
                              setPathValue(path, moved);
                            }}
                            aria-label={`Move ${itemTitle} up`}
                            title="Move up"
                          >
                            {"\u2191"}
                          </button>
                          <button
                            type="button"
                            className="json-array-arrow-btn"
                            disabled={index >= value.length - 1}
                            onClick={() => {
                              const moved = moveArrayItem(value, index, index + 1);
                              setPathValue(path, moved);
                            }}
                            aria-label={`Move ${itemTitle} down`}
                            title="Move down"
                          >
                            {"\u2193"}
                          </button>
                          <button
                            type="button"
                            className="json-danger-button"
                            onClick={() =>
                              setSectionDeleteConfirm({
                                path: [...path],
                                index,
                                sectionLabel: sectionName.trim() || itemTitle,
                              })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {!itemCollapsed ? (
                        <div className="json-array-item-content">{renderNode(item, itemPath, itemTitle)}</div>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="json-sections-toolbar">
                <button
                  type="button"
                  onClick={() => {
                    const nextItem = newArrayItem(path, value);
                    const nextSectionPathKey = toPathKey([...path, value.length]);
                    setPathValue(path, [...value, nextItem]);
                    setCollapsedGroups((current) => ({
                      ...current,
                      [nextSectionPathKey]: false,
                    }));
                  }}
                >
                  + Add Section
                </button>
              </div>
            </div>
          );
        }

        return (
          <section className="json-card">
            <div className="json-card-header">
              <button
                type="button"
                className="json-collapse-button"
                onClick={() =>
                  setCollapsedGroups((current) => ({
                    ...current,
                    [pathKey]: !isCollapsed,
                  }))
                }
              >
                {isCollapsed ? "+" : "-"} {titleCase(label)} ({value.length})
              </button>

              <button
                type="button"
                onClick={() => {
                  const nextItem = newArrayItem(path, value);
                  setPathValue(path, [...value, nextItem]);
                }}
              >
                + Add new element
              </button>
            </div>

            {!isCollapsed ? (
              <div className="json-array-body">
                {value.length === 0 ? <p className="json-empty-text">No elements.</p> : null}
                {value.map((item, index) => {
                  if (item === null) {
                    return null;
                  }

                  const itemPath = [...path, index];
                  const itemPathKey = toPathKey(itemPath);
                  const itemCollapsed = collapsedGroups[itemPathKey] ?? false;
                  const itemTitle = `Element ${index + 1}`;

                  return (
                    <article key={itemPathKey} className="json-array-item">
                      <div className="json-array-item-header">
                        <div className="json-array-item-main">
                          <button
                            type="button"
                            className="json-collapse-button"
                            onClick={() =>
                              setCollapsedGroups((current) => ({
                                ...current,
                                [itemPathKey]: !itemCollapsed,
                              }))
                            }
                            aria-label={`${itemCollapsed ? "Expand" : "Collapse"} ${itemTitle}`}
                          >
                            {itemCollapsed ? "+" : "-"} {itemTitle}
                          </button>
                        </div>
                        <div className="json-array-item-actions">
                          <button
                            type="button"
                            className="json-danger-button"
                            onClick={() =>
                              setCanyonData((current) => {
                                if (!current) {
                                  return current;
                                }
                                const next = removeArrayIndex(current, path, index);
                                if (!isJsonObject(next)) {
                                  return current;
                                }
                                return next;
                              })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {!itemCollapsed ? (
                        <div className="json-array-item-content">{renderNode(item, itemPath, itemTitle)}</div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      }

      if (isJsonObject(value)) {
        if (path.length === 0) {
          const rootName = renderNode(value.name ?? "", ["name"], "name");
          const rootDescription = renderNode(value.description ?? {}, ["description"], "description");
          const rootLocation = renderNode(value.location ?? {}, ["location"], "location");
          const rootSections = renderNode(
            Array.isArray(value.sections) ? value.sections : [],
            ["sections"],
            "sections",
          );

          return (
            <div className="json-root-layout">
              <div className={`json-overview-strip ${mapViewMode}`}>
                {mapViewMode === "expanded" ? (
                  <button
                    type="button"
                    className="json-overview-map-backdrop"
                    onClick={onToggleMapView}
                    aria-label="Collapse map overlay"
                  />
                ) : null}
                <div className="json-overview-main">
                  <div className="json-overview-row">{rootName}</div>
                  <div className="json-overview-row">{rootDescription}</div>
                  <div className="json-overview-row">{rootLocation}</div>
                </div>
                <div className={`json-overview-map-pane ${mapViewMode}`}>
                  {mapViewMode === "compact" ? (
                    <button
                      type="button"
                      className={`json-overview-map-toggle ${mapViewMode}`}
                      onClick={onToggleMapView}
                      aria-label="Enlarge map"
                      title="Enlarge map"
                    >
                      Enlarge map
                    </button>
                  ) : null}
                  <div className="json-overview-map-inner">
                    <RouteMapApp
                      viewMode={mapViewMode}
                      defaultLanguage={defaultLanguage}
                      overviewCoordinate={overviewCoordinate}
                      onSetOverviewCoordinate={onOverviewCoordinateSet}
                      pointsOfInterest={pointsOfInterest}
                      onPointsOfInterestChange={onPointsOfInterestChange}
                      parkingLots={parkingLots}
                      onParkingLotsChange={onParkingLotsChange}
                      parkingLotSuggestions={parkingLotSuggestions}
                      trackBindings={trackBindings}
                      onTrackSnapshotChange={onTrackSnapshotChange}
                    />
                  </div>
                </div>
              </div>
              <div className="json-sections-strip">{rootSections}</div>
            </div>
          );
        }

        if (isLocationPath(path)) {
          const countryField = renderNode(value.country_code ?? "", [...path, "country_code"], "country_code");
          const regionField = renderNode(value.region_code ?? "", [...path, "region_code"], "region_code");

          return (
            <div className="json-location-row">
              <div>{countryField}</div>
              <div>{regionField}</div>
            </div>
          );
        }

        if (isDifficultiesPath(path)) {
          const verticalPath = [...path, "vertical"];
          const aquaticPath = [...path, "aquatic"];
          const commitmentPath = [...path, "general"];

          const verticalKey = toPathKey(verticalPath);
          const aquaticKey = toPathKey(aquaticPath);
          const commitmentKey = toPathKey(commitmentPath);

          const verticalDisplay =
            inputDrafts[verticalKey] ?? (typeof value.vertical === "number" ? String(value.vertical) : "");
          const aquaticDisplay =
            inputDrafts[aquaticKey] ?? (typeof value.aquatic === "number" ? String(value.aquatic) : "");
          const commitmentDisplay = inputDrafts[commitmentKey] ?? formatCommitmentDifficulty(value.general);

          return (
            <div className="json-input-field">
              <label>{titleCase(label)}</label>
              <div className="json-difficulties-inline">
                <div className="json-difficulty-token">
                  <span className="json-difficulty-static">v</span>
                  <input
                    id={`field-${verticalKey}`}
                    className="json-difficulty-digit-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-7]"
                    maxLength={1}
                    value={verticalDisplay}
                    onChange={(event) => onDifficultyArabicDraftChange(verticalPath, event.target.value)}
                    onBlur={() => clearDraft(verticalKey)}
                    aria-label="Vertical difficulty"
                  />
                  <div className="json-difficulty-stepper">
                    <button
                      type="button"
                      aria-label="Increase vertical difficulty"
                      onClick={() => onDifficultyArabicStep(verticalPath, verticalDisplay, value.vertical, 1)}
                    >
                      {"\u25B2"}
                    </button>
                    <button
                      type="button"
                      aria-label="Decrease vertical difficulty"
                      onClick={() => onDifficultyArabicStep(verticalPath, verticalDisplay, value.vertical, -1)}
                    >
                      {"\u25BC"}
                    </button>
                  </div>
                </div>
                <div className="json-difficulty-token">
                  <span className="json-difficulty-static">a</span>
                  <input
                    id={`field-${aquaticKey}`}
                    className="json-difficulty-digit-input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-7]"
                    maxLength={1}
                    value={aquaticDisplay}
                    onChange={(event) => onDifficultyArabicDraftChange(aquaticPath, event.target.value)}
                    onBlur={() => clearDraft(aquaticKey)}
                    aria-label="Aquatic difficulty"
                  />
                  <div className="json-difficulty-stepper">
                    <button
                      type="button"
                      aria-label="Increase aquatic difficulty"
                      onClick={() => onDifficultyArabicStep(aquaticPath, aquaticDisplay, value.aquatic, 1)}
                    >
                      {"\u25B2"}
                    </button>
                    <button
                      type="button"
                      aria-label="Decrease aquatic difficulty"
                      onClick={() => onDifficultyArabicStep(aquaticPath, aquaticDisplay, value.aquatic, -1)}
                    >
                      {"\u25BC"}
                    </button>
                  </div>
                </div>
                <div className="json-difficulty-token">
                  <input
                    id={`field-${commitmentKey}`}
                    className="json-difficulty-roman-input"
                    type="text"
                    inputMode="text"
                    maxLength={3}
                    value={commitmentDisplay}
                    onChange={(event) => onDifficultyRomanDraftChange(commitmentPath, event.target.value)}
                    onBlur={() => clearDraft(commitmentKey)}
                    aria-label="Commitment difficulty"
                  />
                  <div className="json-difficulty-stepper">
                    <button
                      type="button"
                      aria-label="Increase commitment difficulty"
                      onClick={() => onDifficultyRomanStep(commitmentPath, commitmentDisplay, value.general, 1)}
                    >
                      {"\u25B2"}
                    </button>
                    <button
                      type="button"
                      aria-label="Decrease commitment difficulty"
                      onClick={() => onDifficultyRomanStep(commitmentPath, commitmentDisplay, value.general, -1)}
                    >
                      {"\u25BC"}
                    </button>
                  </div>
                </div>
              </div>
              {validationErrors[verticalKey] ? <p className="json-inline-error">{validationErrors[verticalKey]}</p> : null}
              {validationErrors[aquaticKey] ? <p className="json-inline-error">{validationErrors[aquaticKey]}</p> : null}
              {validationErrors[commitmentKey] ? <p className="json-inline-error">{validationErrors[commitmentKey]}</p> : null}
            </div>
          );
        }

        if (isDurationsPath(path)) {
          return (
            <div className="json-input-field">
              <label>{titleCase(label)}</label>
              <div
                className="json-horizontal-fields"
                style={{ gridTemplateColumns: `repeat(${SECTION_DURATION_KEYS.length}, minmax(0, 1fr))` }}
              >
                {SECTION_DURATION_KEYS.map((fieldKey) => {
                  const fieldPath = [...path, fieldKey];
                  const fieldPathKey = toPathKey(fieldPath);
                  const fieldValue = value[fieldKey];
                  const displayValue =
                    inputDrafts[fieldPathKey] ??
                    (typeof fieldValue === "number" ? String(fieldValue) : "");

                  return (
                    <label key={fieldKey} className="json-horizontal-field-item">
                      <span>{titleCase(fieldKey)}</span>
                      <input
                        type="number"
                        value={displayValue}
                        onChange={(event) => onNumberDraftChange(fieldPath, event.target.value)}
                        onBlur={() => clearDraft(fieldPathKey)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        }

        if (isTourDimensionsPath(path)) {
          return (
            <div className="json-input-field">
              <label>{titleCase(label)}</label>
              <div
                className="json-horizontal-fields"
                style={{ gridTemplateColumns: `repeat(${SECTION_DIMENSION_KEYS.length}, minmax(0, 1fr))` }}
              >
                {SECTION_DIMENSION_KEYS.map((fieldKey) => {
                  const fieldPath = [...path, fieldKey];
                  const fieldPathKey = toPathKey(fieldPath);
                  const fieldValue = value[fieldKey];
                  const displayValue =
                    inputDrafts[fieldPathKey] ??
                    (typeof fieldValue === "number" ? String(fieldValue) : "");

                  return (
                    <label key={fieldKey} className="json-horizontal-field-item">
                      <span>{titleCase(fieldKey)}</span>
                      <input
                        type="number"
                        value={displayValue}
                        onChange={(event) => onNumberDraftChange(fieldPath, event.target.value)}
                        onBlur={() => clearDraft(fieldPathKey)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        }

        const entries = Object.entries(value).filter(([key, child]) =>
          shouldRenderChild(path, key, child),
        );

        if (entries.length === 0 && path.length > 0) {
          return null;
        }

        if (isSectionDescriptionsPath(path)) {
          return (
            <div className="json-descriptions-plain">
              {entries.map(([key, child]) => (
                <div className="json-field-row" key={`${pathKey}.${key}`}>
                  {renderNode(child, [...path, key], key)}
                </div>
              ))}
            </div>
          );
        }

        const normalEntries = isSectionPath(path)
          ? entries.filter(
              ([entryKey]) =>
                entryKey !== "max_rappel_in_meter" &&
                entryKey !== "recommended_ropes" &&
                entryKey !== "topo",
            )
          : entries;

        const maxRappelValue = isSectionPath(path) ? value.max_rappel_in_meter ?? null : null;
        const recommendedRopesValue = isSectionPath(path) ? value.recommended_ropes ?? null : null;
        const topoValue = isSectionPath(path) && typeof value.topo === "string" ? value.topo : null;
        const objectBody = (
          <div className="json-object-body">
            {normalEntries.map(([key, child]) => (
              <div className="json-field-row" key={`${pathKey}.${key}`}>
                {renderNode(child, [...path, key], key)}
              </div>
            ))}
            {isSectionPath(path) && (maxRappelValue !== null || recommendedRopesValue !== null) ? (
              <div className="json-two-col-row">
                {maxRappelValue !== null ? (
                  <div className="json-field-row">
                    {renderNode(maxRappelValue, [...path, "max_rappel_in_meter"], "max_rappel_in_meter")}
                  </div>
                ) : null}
                {recommendedRopesValue !== null ? (
                  <div className="json-field-row">
                    {renderNode(recommendedRopesValue, [...path, "recommended_ropes"], "recommended_ropes")}
                  </div>
                ) : null}
              </div>
            ) : null}
            {isSectionPath(path) && topoValue !== null ? (
              <div className="json-field-row">
                {renderNode(topoValue, [...path, "topo"], "topo")}
              </div>
            ) : null}
          </div>
        );

        if (isSectionPath(path)) {
          return objectBody;
        }

        return (
          <section className="json-card">
            {path.length > 0 && !isSectionDescriptionsPath(path) ? (
              <div className="json-card-header">
                <button
                  type="button"
                  className="json-collapse-button"
                  onClick={() =>
                    setCollapsedGroups((current) => ({
                      ...current,
                      [pathKey]: !isCollapsed,
                    }))
                  }
                >
                  {isCollapsed ? "+" : "-"} {titleCase(label)}
                </button>
              </div>
            ) : null}

            {!isCollapsed ? objectBody : null}
          </section>
        );
      }

      if (typeof value === "number") {
        const draftValue = inputDrafts[pathKey] ?? String(value);
        return (
          <div className="json-input-field">
            <label htmlFor={`field-${pathKey}`}>{titleCase(label)}</label>
            <input
              id={`field-${pathKey}`}
              type="number"
              value={draftValue}
              onChange={(event) => onNumberDraftChange(path, event.target.value)}
              onBlur={() => clearDraft(pathKey)}
            />
            {validationError ? <p className="json-inline-error">{validationError}</p> : null}
          </div>
        );
      }

      if (typeof value === "boolean") {
        return (
          <div className="json-input-field">
            <label className="json-checkbox-label" htmlFor={`field-${pathKey}`}>
              <input
                id={`field-${pathKey}`}
                type="checkbox"
                checked={value}
                onChange={(event) => setPathValue(path, event.target.checked)}
              />
              <span>{titleCase(label)}</span>
            </label>
          </div>
        );
      }

      if (isMainNamePath(path)) {
        return (
          <div className="json-main-name-field">
            <input
              id={`field-${pathKey}`}
              className="json-main-name-input"
              type="text"
              value={value}
              onChange={(event) => setPathValue(path, event.target.value)}
              placeholder="Canyon name"
            />
          </div>
        );
      }

      if (isCountryCodePath(path)) {
        const hasCurrentCountry = countries.some((country) => country.code === value);

        return (
          <div className="json-input-field">
            <label htmlFor={`field-${pathKey}`}>{titleCase(label)}</label>
            <select
              id={`field-${pathKey}`}
              value={value}
              onChange={(event) => onCountryCodeChange(event.target.value)}
            >
              {!hasCurrentCountry && value ? (
                <option value={value}>{value}</option>
              ) : null}
              <option value="">Select country</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.code} - {country.name}
                </option>
              ))}
            </select>
          </div>
        );
      }

      if (isRegionCodePath(path)) {
        const regionCodes = new Set(selectedCountryRegions.map((region) => region.code));
        const selectedValue = regionCodes.has(value) ? value : "";

        return (
          <div className="json-input-field">
            <label htmlFor={`field-${pathKey}`}>{titleCase(label)}</label>
            <select
              id={`field-${pathKey}`}
              value={selectedValue}
              onChange={(event) => setPathValue(path, event.target.value)}
              disabled={selectedCountryRegions.length === 0}
            >
              <option value="">
                {selectedCountryRegions.length === 0 ? "No regions for selected country" : "Select region"}
              </option>
              {selectedCountryRegions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.code} - {region.name}
                </option>
              ))}
            </select>
          </div>
        );
      }

      if (isTopoPath(path)) {
        return (
          <div className="json-input-field">
            <label>{titleCase(label)}</label>
            <div className="json-topo-picker">
              <button type="button" onClick={() => void onTopoFilePick(path)}>
                Select topo file
              </button>
              <span title={value}>{value || "Not set"}</span>
            </div>
          </div>
        );
      }

      return (
        <div className="json-input-field">
          <label htmlFor={`field-${pathKey}`}>{titleCase(label)}</label>
          {value.length > 120 || /description/i.test(label) ? (
            <textarea
              id={`field-${pathKey}`}
              rows={4}
              value={value}
              onChange={(event) => setPathValue(path, event.target.value)}
            />
          ) : (
            <input
              id={`field-${pathKey}`}
              type="text"
              value={value}
              onChange={(event) => setPathValue(path, event.target.value)}
            />
          )}
        </div>
      );
    },
    [
      clearDraft,
      collapsedGroups,
      countries,
      defaultLanguage,
      onCountryCodeChange,
      onDifficultyArabicDraftChange,
      onDifficultyArabicStep,
      onDifficultyRomanDraftChange,
      onDifficultyRomanStep,
      languageTabs,
      overviewCoordinate,
      pointsOfInterest,
      parkingLots,
      parkingLotSuggestions,
      trackBindings,
      onNumberDraftChange,
      onOverviewCoordinateSet,
      onPointsOfInterestChange,
      onParkingLotsChange,
      onTrackSnapshotChange,
      openLanguagePasteModal,
      onSpecialNoteParamChange,
      onSpecialNoteRemoveUnknown,
      onSpecialNoteToggle,
      onTopoFilePick,
      onToggleMapView,
      selectedCountryRegions,
      setPathValue,
      specialNoteById,
      specialNoteDefinitions,
      specialNoteIdByIcon,
      validationErrors,
      inputDrafts,
      mapViewMode,
    ],
  );

  return (
    <div className="json-editor-shell">
      <header className="json-toolbar">
        <div className="json-toolbar-buttons">
          <button type="button" onClick={() => void onNewJson()}>
            New canyon
          </button>
          <button type="button" onClick={() => void onLoadJson()}>
            Load canyon
          </button>
          <button type="button" disabled={!canyonData || isSaving} onClick={() => void onSaveJson()}>
            {isSaving ? "Saving..." : "Save canyon"}
          </button>
          <label className="json-default-language-selector">
            <span>Default language</span>
            <select
              value={defaultLanguage}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (STATIC_LANGUAGE_SET.has(nextValue)) {
                  setDefaultLanguage(nextValue as (typeof STATIC_LANGUAGE_KEYS)[number]);
                }
              }}
            >
              {STATIC_LANGUAGE_KEYS.map((language) => (
                <option key={language} value={language}>
                  {language.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="json-status">{statusMessage}</p>
      </header>

      <section className="json-editor-body">
        {canyonData ? (
          <>
            {renderNode(canyonData, [], "Canyon")}
          </>
        ) : (
          <div className="json-empty-text">No JSON loaded.</div>
        )}
      </section>

      {languagePasteTargetPath ? (
        <div className="json-modal-backdrop" role="presentation">
          <div className="json-modal" role="dialog" aria-modal="true" aria-label="Paste language JSON">
            <div className="json-modal-header">
              <h3>Paste language JSON</h3>
              <button type="button" className="json-modal-close" onClick={closeLanguagePasteModal} aria-label="Close">
                X
              </button>
            </div>
            <p className="json-modal-help">
              Provide valid JSON with exactly these keys: {STATIC_LANGUAGE_KEYS.join(", ")}.
            </p>
            <textarea
              value={languagePasteDraft}
              rows={12}
              onChange={(event) => {
                setLanguagePasteDraft(event.target.value);
                if (languagePasteError) {
                  setLanguagePasteError("");
                }
              }}
            />
            {languagePasteError ? <p className="json-inline-error">{languagePasteError}</p> : null}
            <div className="json-modal-actions">
              <button type="button" className="json-modal-apply" onClick={onApplyLanguagePaste}>
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isNewCanyonModalOpen ? (
        <div className="json-modal-backdrop" role="presentation">
          <div className="json-modal" role="dialog" aria-modal="true" aria-label="Create new canyon">
            <div className="json-modal-header">
              <h3>Create new canyon</h3>
              <button
                type="button"
                className="json-modal-close"
                onClick={onCloseNewCanyonModal}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <p className="json-modal-help">
              Enter the canyon name. A new folder will be created in <code>data/</code>.
            </p>
            <div className="json-input-field">
              <label htmlFor="new-canyon-name-input">Canyon name</label>
              <input
                id="new-canyon-name-input"
                type="text"
                autoFocus
                value={newCanyonNameDraft}
                onChange={(event) => {
                  setNewCanyonNameDraft(event.target.value);
                  if (newCanyonNameError) {
                    setNewCanyonNameError("");
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void onCreateNewCanyon();
                  }
                }}
              />
            </div>
            {newCanyonNameError ? <p className="json-inline-error">{newCanyonNameError}</p> : null}
            <div className="json-modal-actions">
              <button type="button" className="json-modal-apply" onClick={() => void onCreateNewCanyon()}>
                Create new canyon
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {sectionDeleteConfirm ? (
        <div className="json-modal-backdrop" role="presentation">
          <div className="json-modal json-modal-confirm" role="dialog" aria-modal="true" aria-label="Delete section">
            <div className="json-modal-header">
              <h3>Delete section</h3>
              <button
                type="button"
                className="json-modal-close"
                onClick={() => setSectionDeleteConfirm(null)}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <p className="json-modal-help">
              Do you really want to delete <strong>{sectionDeleteConfirm.sectionLabel}</strong>?
            </p>
            <div className="json-modal-actions">
              <button type="button" className="json-modal-keep" onClick={() => setSectionDeleteConfirm(null)}>
                Keep
              </button>
              <button type="button" className="json-modal-delete" onClick={onConfirmSectionDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {topoWarningMessage ? (
        <div className="json-modal-backdrop" role="presentation">
          <div
            className="json-modal json-modal-error"
            role="dialog"
            aria-modal="true"
            aria-label="Invalid topo selection"
          >
            <div className="json-modal-header">
              <h3>Invalid topo selection</h3>
              <button
                type="button"
                className="json-modal-close"
                onClick={() => setTopoWarningMessage("")}
                aria-label="Close"
              >
                X
              </button>
            </div>
            <p className="json-modal-help">{topoWarningMessage}</p>
            <div className="json-modal-actions">
              <button type="button" className="json-modal-error-close" onClick={() => setTopoWarningMessage("")}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
