import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import { RouteMapApp, type TrackBindings, type TrackSnapshot } from "./RouteMapApp";
import { buildTrackBindings, withSectionTourDimensionsFromTracks } from "./json-editor/trackUtils";
import { normalizeTrackLink } from "./shared/trackLinks";
import { parseCommandsToCopyFromAsset, type CommandToCopy } from "./shared/commandsToCopy";
import { parsePoiSuggestionsFromAsset, type PoiSuggestionPreset } from "./shared/poiSuggestions";
import {
  buildRequiredDataChecklist,
  type ChecklistNode,
  type ChecklistStatus,
  isValidTopoPath,
} from "./json-editor/requiredDataChecklist";
import {
  createDefaultSection,
  createEmptyLocalizedText,
  normalizeCanyonForEditor,
} from "./json-editor/canyonSchemaDefaults";

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
  coordinates: [number, number] | null;
  name: LocalizedText;
  description: LocalizedText;
};
type ParkingLot = {
  coordinates: [number, number] | null;
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
type ChecklistExpansionState = "expanded" | "collapsed";
type SaveFeedbackPopup = {
  tone: "success" | "warning";
  message: string;
  missingItems: string[];
  hiddenCount: number;
};

const COUNTRY_ASSET_PATH = "assets/countries_and_regions.json";
const SPECIAL_NOTES_ASSET_PATH = "assets/special_notes_possibilities.json";
const PARKING_LOT_SUGGESTIONS_ASSET_PATH = "assets/parking_lot_suggestions.json";
const POI_SUGGESTIONS_ASSET_PATH = "assets/poi_suggestions.json";
const COMMANDS_TO_COPY_ASSET_PATH = "assets/commands_to_copy.json";
const DEFAULT_LANGUAGE_STORAGE_KEY = "canyon-editor.default-language";
const LANGUAGE_KEY_PATTERN = /^[a-z]{2}(?:-[A-Za-z]{2})?$/i;
const STATIC_LANGUAGE_KEYS = ["de", "en", "es", "fr", "it", "pt"] as const;
const STATIC_LANGUAGE_SET = new Set<string>(STATIC_LANGUAGE_KEYS);
const LANGUAGE_TEXTAREA_PLACEHOLDER: Record<(typeof STATIC_LANGUAGE_KEYS)[number], string> = {
  de: "Hier deutschen Text einf\u00FCgen",
  en: "Put in some English text here",
  es: "Pon aqu\u00ED texto en espa\u00F1ol",
  fr: "Mettez ici du texte fran\u00E7ais",
  it: "Inserisci qui del testo italiano",
  pt: "Coloque aqui texto em portugu\u00EAs",
};
const LOCALIZED_JSON_PLACEHOLDER = `{
  "de": "",
  "en": "",
  "es": "",
  "fr": "",
  "it": "",
  "pt": ""
}`;

const ROOT_EDITABLE_KEYS = new Set(["name", "description", "location", "sections"]);
const LOCATION_EDITABLE_KEYS = new Set(["country_code", "region_code"]);
const SECTION_EDITABLE_KEYS = new Set([
  "name",
  "authors",
  "descriptions",
  "special_notes",
  "difficulties",
  "durations_in_minutes",
  "max_rappel_in_meter",
  "recommended_ropes",
  "catchment_area_in_km2",
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
const DEFAULT_RECOMMENDED_ROPES = "2x 0m";
const SAVE_FEEDBACK_MAX_ITEMS = 12;
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

    points.push({
      coordinates: parseCoordinatePair(entry.coordinates ?? null),
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

    parkingLots.push({
      coordinates: parseCoordinatePair(entry.coordinates ?? null),
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

function createEditorSection(index: number, name = ""): JsonObject {
  return {
    ...createDefaultSection(index),
    name,
    authors: [""],
  };
}

function createEmptyNewCanyonData(template: JsonObject, canyonName: string): JsonObject {
  const initialSection = createEditorSection(0, "Part1");

  return normalizeCanyonForEditor({
    ...template,
    name: canyonName,
    coordinates: null,
    sections: [initialSection],
  });
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

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
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

function newArrayItem(path: PathSegment[], arrayValue: JsonValue[]): JsonValue {
  if (path.length === 1 && path[0] === "sections") {
    return createEditorSection(arrayValue.length);
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

function hasLinkedTrackBindings(trackBindings: TrackBindings): boolean {
  const hasSectionTrackLink = trackBindings.sections.some((binding) => Boolean(binding.filePath));
  const hasAccessTrackLink = trackBindings.access.length > 0;
  return hasSectionTrackLink || hasAccessTrackLink;
}

function collectInvalidTopoSections(canyonData: Record<string, unknown>): string[] {
  const sections = Array.isArray(canyonData.sections) ? canyonData.sections : [];
  const invalid: string[] = [];

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    if (!isJsonObject(section)) {
      continue;
    }

    const topoValue = section.topo;
    if (topoValue === null || typeof topoValue === "undefined") {
      continue;
    }

    if (typeof topoValue !== "string") {
      invalid.push(typeof section.name === "string" && section.name.trim() ? section.name.trim() : `Section ${sectionIndex + 1}`);
      continue;
    }

    if (!topoValue.trim()) {
      continue;
    }

    if (!isValidTopoPath(topoValue)) {
      invalid.push(typeof section.name === "string" && section.name.trim() ? section.name.trim() : `Section ${sectionIndex + 1}`);
    }
  }

  return invalid;
}

function collectMissingChecklistLeafPaths(nodes: ChecklistNode[]): string[] {
  const missing: string[] = [];

  const visit = (node: ChecklistNode, parentPath: string[]): void => {
    const currentPath = [...parentPath, node.label];
    if (node.children.length === 0) {
      if (node.status === "missing") {
        missing.push(currentPath.join(" > "));
      }
      return;
    }

    node.children.forEach((child) => visit(child, currentPath));
  };

  nodes.forEach((node) => visit(node, []));
  return missing;
}

function TrashIcon({ className = "icon-trash" }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1Z" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 10v6" />
      <path d="M14 10v6" />
    </svg>
  );
}

function CopyIcon({ className = "icon-copy" }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </svg>
  );
}

export function CanyonJsonEditor({ mapViewMode, onToggleMapView }: CanyonJsonEditorProps): JSX.Element {
  const trackSnapshotRef = useRef<TrackSnapshot | null>(null);
  const previousRequiredChecklistStatusByIdRef = useRef<Record<string, ChecklistStatus>>({});
  const copiedCommandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canyonData, setCanyonData] = useState<JsonObject | null>(null);
  const [trackSnapshot, setTrackSnapshot] = useState<TrackSnapshot | null>(null);
  const [mapSessionKey, setMapSessionKey] = useState(0);
  const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [specialNoteDefinitions, setSpecialNoteDefinitions] = useState<SpecialNoteDefinition[]>([]);
  const [poiSuggestions, setPoiSuggestions] = useState<PoiSuggestionPreset[]>([]);
  const [parkingLotSuggestions, setParkingLotSuggestions] = useState<LocalizedText[]>([]);
  const [commandsToCopy, setCommandsToCopy] = useState<CommandToCopy[]>([]);
  const [copiedCommandIndex, setCopiedCommandIndex] = useState<number | null>(null);
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
  const [saveFeedbackPopup, setSaveFeedbackPopup] = useState<SaveFeedbackPopup | null>(null);
  const [requiredChecklistExpansion, setRequiredChecklistExpansion] = useState<
    Record<string, ChecklistExpansionState>
  >({});

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
  const requiredChecklistTree = useMemo(
    () =>
      buildRequiredDataChecklist({
        canyonData,
        trackSnapshot,
      }),
    [canyonData, trackSnapshot],
  );
  const { requiredChecklistStatusById, requiredChecklistLeafTotal, requiredChecklistLeafPresent } = useMemo(() => {
    const statusById: Record<string, ChecklistStatus> = {};
    let leafTotal = 0;
    let leafPresent = 0;

    const visit = (node: ChecklistNode): void => {
      statusById[node.id] = node.status;
      if (node.children.length === 0) {
        leafTotal += 1;
        if (node.status === "present") {
          leafPresent += 1;
        }
        return;
      }

      node.children.forEach((child) => visit(child));
    };

    requiredChecklistTree.forEach((node) => visit(node));

    return {
      requiredChecklistStatusById: statusById,
      requiredChecklistLeafTotal: leafTotal,
      requiredChecklistLeafPresent: leafPresent,
    };
  }, [requiredChecklistTree]);

  const onTrackSnapshotChange = useCallback((snapshot: TrackSnapshot): void => {
    trackSnapshotRef.current = snapshot;
    setTrackSnapshot(snapshot);

    const nextAccessTrackLinks = snapshot.tracks
      .filter((track) => track.kind === "access")
      .map((track) => normalizeTrackLink(track.filePath))
      .filter((link): link is string => Boolean(link));

    setCanyonData((current) => {
      if (!current) {
        return current;
      }

      const currentAccessTrackLinks = Array.isArray(current.tracks_access)
        ? current.tracks_access
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => normalizeTrackLink(entry))
            .filter((entry): entry is string => Boolean(entry))
        : [];

      if (areStringArraysEqual(currentAccessTrackLinks, nextAccessTrackLinks)) {
        return current;
      }

      return normalizeCanyonForEditor({
        ...current,
        tracks_access: nextAccessTrackLinks,
      });
    });
  }, []);
  const dismissSaveFeedbackPopup = useCallback((): void => {
    setSaveFeedbackPopup(null);
  }, []);
  const showSaveFeedbackPopup = useCallback(
    (missingItems: string[]): void => {
      const hiddenCount = Math.max(0, missingItems.length - SAVE_FEEDBACK_MAX_ITEMS);
      const visibleMissingItems = missingItems.slice(0, SAVE_FEEDBACK_MAX_ITEMS);
      const tone = visibleMissingItems.length === 0 ? "success" : "warning";
      const message =
        tone === "success"
          ? "All fields were set correctly"
          : "Canyon saved, but the following fields are missing:";
      setSaveFeedbackPopup({
        tone,
        message,
        missingItems: visibleMissingItems,
        hiddenCount,
      });
    },
    [],
  );

  useEffect(() => {
    const previousStatusById = previousRequiredChecklistStatusByIdRef.current;
    setRequiredChecklistExpansion((current) => {
      let changed = false;
      const next: Record<string, ChecklistExpansionState> = {};
      for (const [nodeId, expansionState] of Object.entries(current)) {
        const nextStatus = requiredChecklistStatusById[nodeId];
        if (!nextStatus) {
          changed = true;
          continue;
        }

        const previousStatus = previousStatusById[nodeId];
        if (previousStatus && previousStatus !== nextStatus) {
          changed = true;
          continue;
        }

        next[nodeId] = expansionState;
      }

      if (!changed && Object.keys(next).length === Object.keys(current).length) {
        return current;
      }

      return next;
    });

    previousRequiredChecklistStatusByIdRef.current = requiredChecklistStatusById;
  }, [requiredChecklistStatusById]);

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
          return normalizeCanyonForEditor(updated);
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
    return () => {
      if (copiedCommandTimeoutRef.current) {
        clearTimeout(copiedCommandTimeoutRef.current);
        copiedCommandTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadPoiSuggestions(): Promise<void> {
      const result = await window.api.loadJsonFromPath(POI_SUGGESTIONS_ASSET_PATH);
      if (canceled) {
        return;
      }

      if (result.canceled || !result.data) {
        setPoiSuggestions([]);
        return;
      }

      setPoiSuggestions(parsePoiSuggestionsFromAsset(result.data));
    }

    void loadPoiSuggestions().catch(() => {
      if (!canceled) {
        setPoiSuggestions([]);
      }
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

    async function loadCommandsToCopy(): Promise<void> {
      const result = await window.api.loadJsonFromPath(COMMANDS_TO_COPY_ASSET_PATH);
      if (canceled) {
        return;
      }

      if (result.canceled || !result.data) {
        setCommandsToCopy([]);
        return;
      }

      setCommandsToCopy(parseCommandsToCopyFromAsset(result.data));
    }

    void loadCommandsToCopy().catch(() => {
      if (!canceled) {
        setCommandsToCopy([]);
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

    setCanyonData(normalizeCanyonForEditor(cloneJsonValue(result.data)));
    trackSnapshotRef.current = null;
    setTrackSnapshot(null);
    setCurrentFilePath(result.filePath ?? null);
    setValidationErrors({});
    setInputDrafts({});
    setCollapsedGroups({});
    setRequiredChecklistExpansion({});
    setLanguageTabs({});
    dismissSaveFeedbackPopup();
    setStatusMessage(result.filePath ?? "JSON file");
  }, [dismissSaveFeedbackPopup]);

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
    setCanyonData(normalizeCanyonForEditor(nextData));
    trackSnapshotRef.current = null;
    setTrackSnapshot(null);
    setCurrentFilePath(folderResult.dataJsonPath ?? null);
    setValidationErrors({});
    setInputDrafts({});
    setCollapsedGroups({});
    setRequiredChecklistExpansion({});
    setLanguageTabs({});
    dismissSaveFeedbackPopup();
    setIsNewCanyonModalOpen(false);
    setNewCanyonNameError("");
    setStatusMessage(`Created new canyon folder: ${folderResult.folderPath ?? "data"}`);
  }, [dismissSaveFeedbackPopup, newCanyonNameDraft]);

  const onSaveJson = useCallback(async (): Promise<void> => {
    if (!canyonData) {
      setStatusMessage("Nothing to save.");
      return;
    }

    if (Object.keys(validationErrors).length > 0) {
      setStatusMessage("Resolve validation errors before saving.");
      return;
    }

    const hasLinkedTracks = hasLinkedTrackBindings(trackBindings);
    const trackSnapshot = trackSnapshotRef.current;
    const expectedLinkedTrackCount =
      trackBindings.sections.filter((binding) => Boolean(binding.filePath)).length +
      trackBindings.access.length;
    if (
      hasLinkedTracks &&
      (!trackSnapshot || trackSnapshot.tracks.length === 0 || trackSnapshot.tracks.length < expectedLinkedTrackCount)
    ) {
      setStatusMessage("Track data is not fully loaded yet. Wait until tracks are ready, then save again.");
      return;
    }

    const normalizedCanyonData = normalizeCanyonForEditor(cloneJsonValue(canyonData));
    const canyonDataForSave = withSectionTourDimensionsFromTracks(
      normalizedCanyonData,
      trackSnapshot,
    );

    const invalidTopoSections = collectInvalidTopoSections(canyonDataForSave);
    if (invalidTopoSections.length > 0) {
      const visibleCount = Math.min(invalidTopoSections.length, 4);
      const listedSections = invalidTopoSections.slice(0, visibleCount).join(", ");
      const hiddenCount = Math.max(0, invalidTopoSections.length - visibleCount);
      const warningMessage = `Invalid topo path in ${listedSections}${hiddenCount > 0 ? ` (+${hiddenCount} more)` : ""}. Use /topos/*.webp|png|jpg|jpeg.`;
      setStatusMessage(warningMessage);
      setTopoWarningMessage(warningMessage);
      return;
    }

    const checklistForSave = buildRequiredDataChecklist({
      canyonData: canyonDataForSave,
      trackSnapshot,
    });
    const missingChecklistLeafPaths = collectMissingChecklistLeafPaths(checklistForSave);

    dismissSaveFeedbackPopup();
    setIsSaving(true);
    try {
      const result = await window.api.saveCanyonWithTracks({
        currentFilePath,
        canyonName: typeof canyonDataForSave.name === "string" ? canyonDataForSave.name : "canyon",
        canyonData: canyonDataForSave,
        trackSnapshot,
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
        setCanyonData(normalizeCanyonForEditor(cloneJsonValue(result.data)));
      }

      trackSnapshotRef.current = null;
      setTrackSnapshot(null);
      setMapSessionKey((current) => current + 1);

      showSaveFeedbackPopup(missingChecklistLeafPaths);
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
  }, [
    canyonData,
    currentFilePath,
    dismissSaveFeedbackPopup,
    showSaveFeedbackPopup,
    trackBindings,
    validationErrors,
  ]);

  const onCopyCommand = useCallback(async (command: string, index: number): Promise<void> => {
    try {
      await window.api.copyTextToClipboard(command);
      setCopiedCommandIndex(index);

      if (copiedCommandTimeoutRef.current) {
        clearTimeout(copiedCommandTimeoutRef.current);
      }

      copiedCommandTimeoutRef.current = setTimeout(() => {
        setCopiedCommandIndex((current) => (current === index ? null : current));
        copiedCommandTimeoutRef.current = null;
      }, 240);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected clipboard error.";
      setStatusMessage(`Copy failed: ${message}`);
    }
  }, []);

  const onCommandStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    const container = event.currentTarget;
    const delta = Math.abs(event.deltaX) > 0 ? event.deltaX : event.deltaY;
    if (delta === 0) {
      return;
    }

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    if (maxScrollLeft <= 0) {
      return;
    }

    const previousLeft = container.scrollLeft;
    const nextLeft = Math.min(Math.max(previousLeft + delta, 0), maxScrollLeft);
    if (nextLeft === previousLeft) {
      return;
    }

    container.scrollLeft = nextLeft;
    event.preventDefault();
  }, []);

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
      if (parsed < 0) {
        setValidationError(key, "Must be 0 or greater.");
        return;
      }

      setPathValue(path, parsed);
      clearValidationError(key);
    },
    [clearValidationError, setPathValue, setValidationError],
  );
  const onNullableNumberDraftChange = useCallback(
    (path: PathSegment[], nextText: string): void => {
      const key = toPathKey(path);
      setInputDrafts((current) => ({
        ...current,
        [key]: nextText,
      }));

      if (!nextText.trim()) {
        setPathValue(path, null);
        clearValidationError(key);
        return;
      }

      const parsed = Number(nextText);
      if (!Number.isFinite(parsed)) {
        setValidationError(key, "Must be a valid number.");
        return;
      }
      if (parsed < 0) {
        setValidationError(key, "Must be 0 or greater.");
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
      return normalizeCanyonForEditor(next);
    });
    setSectionDeleteConfirm(null);
  }, [sectionDeleteConfirm]);

  const onToggleRequiredChecklistNode = useCallback((nodeId: string, expanded: boolean): void => {
    setRequiredChecklistExpansion((current) => {
      const nextState: ChecklistExpansionState = expanded ? "collapsed" : "expanded";
      if (current[nodeId] === nextState) {
        return current;
      }

      return {
        ...current,
        [nodeId]: nextState,
      };
    });
  }, []);

  const renderRequiredChecklistNode = useCallback(
    (node: ChecklistNode, depth = 0): JSX.Element => {
      const hasChildren = node.children.length > 0;
      const visualDepth = Math.min(depth, 4);
      const autoCollapsed = hasChildren && node.status === "present";
      const manualState = requiredChecklistExpansion[node.id];
      const isExpanded = hasChildren
        ? manualState
          ? manualState === "expanded"
          : !autoCollapsed
        : false;
      const toggleNode = (): void => {
        onToggleRequiredChecklistNode(node.id, isExpanded);
      };

      return (
        <li key={node.id} className="json-required-tree-item" data-depth={visualDepth}>
          <div
            className={`json-required-node-row ${node.status}${hasChildren ? " has-children" : ""}`}
            data-depth={visualDepth}
            role={hasChildren ? "button" : undefined}
            tabIndex={hasChildren ? 0 : undefined}
            aria-expanded={hasChildren ? isExpanded : undefined}
            onClick={hasChildren ? toggleNode : undefined}
            onKeyDown={
              hasChildren
                ? (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleNode();
                    }
                  }
                : undefined
            }
          >
            <span
              className={`json-required-node-marker${hasChildren ? " branch" : " leaf"}${
                hasChildren ? (isExpanded ? " expanded" : " collapsed") : ""
              }`}
              aria-hidden="true"
            >
              {hasChildren ? (isExpanded ? "\u25BE" : "\u25B8") : null}
            </span>
            <span className="json-required-node-label">{node.label}</span>
            <span
              className={`json-required-node-status ${
                node.status === "present" ? "present" : node.status === "missing" ? "missing" : "error"
              }`}
              aria-hidden="true"
            >
              {node.status === "present" ? "\u2713" : node.status === "missing" ? "!" : "\u00D7"}
            </span>
          </div>
          {hasChildren && isExpanded ? (
            <ul className="json-required-node-children" data-depth={Math.min(depth + 1, 4)}>
              {node.children.map((child) => renderRequiredChecklistNode(child, depth + 1))}
            </ul>
          ) : null}
        </li>
      );
    },
    [onToggleRequiredChecklistNode, requiredChecklistExpansion],
  );

  const requiredDataPanelContent = useMemo((): JSX.Element => {
    if (requiredChecklistTree.length === 0) {
      return <p className="json-required-empty">No canyon loaded.</p>;
    }

    return (
      <div className="json-required-data-content">
        <ul className="json-required-tree" data-depth={0}>
          {requiredChecklistTree.map((node) => renderRequiredChecklistNode(node, 0))}
        </ul>
      </div>
    );
  }, [
    renderRequiredChecklistNode,
    requiredChecklistTree,
  ]);

  const renderNode = useCallback(
    (value: JsonValue, path: PathSegment[], label: string): JSX.Element | null => {
      if (value === null) {
        return null;
      }

      const pathKey = toPathKey(path);
      const isCollapsed = collapsedGroups[pathKey] ?? false;
      const validationError = validationErrors[pathKey];

      if (isLanguageObject(value)) {
        const activeLanguageCandidate = languageTabs[pathKey];
        const activeLanguage =
          activeLanguageCandidate && STATIC_LANGUAGE_SET.has(activeLanguageCandidate)
            ? (activeLanguageCandidate as (typeof STATIC_LANGUAGE_KEYS)[number])
            : defaultLanguage;
        const cardTitle =
          path.length === 1 && path[0] === "description" ? "Short Characteristic" : titleCase(label);
        const isShortCharacteristic = path.length === 1 && path[0] === "description";

        return (
          <section className="json-card json-language-card">
            <div className="json-language-layout">
              <div className="json-language-title">
                <h3>{cardTitle}</h3>
              </div>

              <div className="json-language-controls">
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

                <div className="json-language-paste">
                  <button
                    type="button"
                    onClick={() => openLanguagePasteModal(path)}
                  >
                    Paste JSON
                  </button>
                </div>
              </div>

              <div
                className={`json-language-content${isShortCharacteristic ? " json-language-content-short-characteristic" : ""}`}
              >
                <textarea
                  value={typeof value[activeLanguage] === "string" ? value[activeLanguage] : ""}
                  placeholder={LANGUAGE_TEXTAREA_PLACEHOLDER[activeLanguage]}
                  rows={4}
                  onChange={(event) => setPathValue([...path, activeLanguage], event.target.value)}
                />
              </div>
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
          const specialNotesCollapsed = collapsedGroups[pathKey] ?? true;
          const toggleSpecialNotesCollapsed = (): void => {
            setCollapsedGroups((current) => ({
              ...current,
              [pathKey]: !specialNotesCollapsed,
            }));
          };

          return (
            <div
              className={`json-input-field json-special-notes-field${specialNotesCollapsed ? " is-collapsed" : ""}`}
              onClick={() => {
                if (specialNotesCollapsed) {
                  toggleSpecialNotesCollapsed();
                }
              }}
            >
              <div className="json-special-notes-header">
                <button
                  type="button"
                  className="json-special-notes-toggle"
                  aria-expanded={!specialNotesCollapsed}
                  aria-label={specialNotesCollapsed ? "Expand special notes" : "Collapse special notes"}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSpecialNotesCollapsed();
                  }}
                >
                  {specialNotesCollapsed ? "\u25BC" : "\u25B2"}
                </button>
                <label>{titleCase(label)}</label>
              </div>

              {!specialNotesCollapsed ? (
                <>
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
                                {definition.placeholders.length > 0 ? (
                                  <span
                                    className={`json-special-note-inline-params${
                                      selected ? " is-active" : " is-inactive"
                                    }`}
                                    aria-hidden={!selected}
                                  >
                                    {definition.placeholders.map((placeholder) => (
                                      <label key={placeholder} className="json-special-note-inline-param">
                                        <span>{placeholder}</span>
                                        <input
                                          type="text"
                                          disabled={!selected}
                                          tabIndex={selected ? 0 : -1}
                                          value={currentParams[placeholder] ?? ""}
                                          placeholder={placeholder}
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
                              aria-label="Delete unknown special note entry"
                            >
                              <TrashIcon />
                            </button>
                            <p className="json-special-note-resolved">
                              Unknown special note entry. Add it to `assets/special_notes_possibilities.json` or remove
                              it.
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
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
                    placeholder={`Enter ${itemLabel.toLowerCase()} ${index + 1}`}
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
                    <TrashIcon />
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
                    <article id={`json-section-${index}`} key={itemPathKey} className="json-array-item json-section-card">
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
                            aria-label={`Delete ${itemTitle}`}
                          >
                            <TrashIcon />
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
                            aria-label={`Delete ${itemTitle}`}
                          >
                            <TrashIcon />
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
          const mapTools = (
            <RouteMapApp
              key={mapSessionKey}
              viewMode={mapViewMode}
              onRequestExpandMap={onToggleMapView}
              defaultLanguage={defaultLanguage}
              overviewCoordinate={overviewCoordinate}
              onSetOverviewCoordinate={onOverviewCoordinateSet}
              pointsOfInterest={pointsOfInterest}
              onPointsOfInterestChange={onPointsOfInterestChange}
              parkingLots={parkingLots}
              onParkingLotsChange={onParkingLotsChange}
              poiSuggestions={poiSuggestions}
              parkingLotSuggestions={parkingLotSuggestions}
              trackBindings={trackBindings}
              trackSnapshot={trackSnapshot}
              onTrackSnapshotChange={onTrackSnapshotChange}
            />
          );

          return (
            <div className="json-root-layout">
              <div className={`json-workspace ${mapViewMode}`}>
                <div className="json-content-scroll">
                  <div className="json-content-column">
                    <section id="json-global-content" className="json-content-group json-content-global">
                      <div className="json-overview-row">{rootName}</div>
                      <div className="json-overview-row">{rootDescription}</div>
                      <div className="json-overview-row">{rootLocation}</div>
                    </section>
                    <section id="json-sections-content" className="json-content-group json-content-sections">
                      <div className="json-sections-strip">{rootSections}</div>
                    </section>
                  </div>
                </div>

                {mapViewMode === "expanded" ? (
                  <button
                    type="button"
                    className="json-overview-map-backdrop"
                    onClick={onToggleMapView}
                    aria-label="Collapse map overlay"
                  />
                ) : null}
                <aside id="json-map-tools" className={`json-overview-map-pane ${mapViewMode}`}>
                  {mapViewMode === "compact" ? (
                    <div className="json-overview-side-panel">
                      <div className="json-overview-map-inner">{mapTools}</div>
                      <section className="json-required-data-panel" aria-label="Required Data">
                        <h3>
                          Required Data
                          <span className="json-required-heading-progress">
                            {requiredChecklistLeafPresent}/{requiredChecklistLeafTotal} complete
                          </span>
                        </h3>
                        <div className="json-required-data-scroll">{requiredDataPanelContent}</div>
                      </section>
                    </div>
                  ) : (
                    <div className="json-overview-map-inner">{mapTools}</div>
                  )}
                </aside>
              </div>
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
              <label>Difficulty</label>
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
                    placeholder="0"
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
                    placeholder="0"
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
                    placeholder="I"
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
                        min={0}
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
                entryKey !== "catchment_area_in_km2" &&
                entryKey !== "topo",
            )
          : entries;

        const sectionAuthorsEntry = isSectionPath(path)
          ? normalEntries.find(([entryKey]) => entryKey === "authors") ?? null
          : null;
        const sectionDifficultyEntry = isSectionPath(path)
          ? normalEntries.find(([entryKey]) => entryKey === "difficulties") ?? null
          : null;
        const sectionBodyEntries = isSectionPath(path)
          ? normalEntries.filter(([entryKey]) => entryKey !== "authors" && entryKey !== "difficulties")
          : normalEntries;

        const maxRappelValue = isSectionPath(path) ? value.max_rappel_in_meter ?? null : null;
        const recommendedRopesValue = isSectionPath(path) ? value.recommended_ropes ?? null : null;
        const catchmentAreaValue = isSectionPath(path) ? value.catchment_area_in_km2 ?? null : null;
        const topoValue = isSectionPath(path) && typeof value.topo === "string" ? value.topo : null;
        const maxRappelPath = isSectionPath(path) ? [...path, "max_rappel_in_meter"] : null;
        const maxRappelPathKey = maxRappelPath ? toPathKey(maxRappelPath) : "";
        const maxRappelDisplay =
          maxRappelPath && typeof maxRappelValue === "number"
            ? (inputDrafts[maxRappelPathKey] ?? String(maxRappelValue))
            : maxRappelPath
              ? (inputDrafts[maxRappelPathKey] ?? "")
              : "";
        const recommendedRopesPath = isSectionPath(path) ? [...path, "recommended_ropes"] : null;
        const recommendedRopesDisplay = typeof recommendedRopesValue === "string" ? recommendedRopesValue : "";
        const catchmentAreaPath = isSectionPath(path) ? [...path, "catchment_area_in_km2"] : null;
        const catchmentAreaPathKey = catchmentAreaPath ? toPathKey(catchmentAreaPath) : "";
        const catchmentAreaDisplay =
          catchmentAreaPath && typeof catchmentAreaValue === "number"
            ? (inputDrafts[catchmentAreaPathKey] ?? String(catchmentAreaValue))
            : catchmentAreaPath
              ? (inputDrafts[catchmentAreaPathKey] ?? "")
              : "";
        const objectBody = (
          <div className="json-object-body">
            {isSectionPath(path) && (sectionAuthorsEntry || sectionDifficultyEntry) ? (
              <div className="json-two-col-row json-section-meta-row">
                {sectionAuthorsEntry ? (
                  <div className="json-field-row" key={`${pathKey}.${sectionAuthorsEntry[0]}`}>
                    {renderNode(sectionAuthorsEntry[1], [...path, sectionAuthorsEntry[0]], sectionAuthorsEntry[0])}
                  </div>
                ) : null}
                {sectionDifficultyEntry ? (
                  <div className="json-field-row" key={`${pathKey}.${sectionDifficultyEntry[0]}`}>
                    {renderNode(
                      sectionDifficultyEntry[1],
                      [...path, sectionDifficultyEntry[0]],
                      sectionDifficultyEntry[0],
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            {sectionBodyEntries.map(([key, child]) => (
              <div className="json-field-row" key={`${pathKey}.${key}`}>
                {renderNode(child, [...path, key], key)}
              </div>
            ))}
            {isSectionPath(path) && (maxRappelPath || recommendedRopesPath || catchmentAreaPath) ? (
              <div className="json-input-field json-max-rope-group">
                <div
                  className="json-horizontal-fields json-max-rope-row"
                  style={{ gridTemplateColumns: `repeat(${SECTION_DURATION_KEYS.length}, minmax(0, 1fr))` }}
                >
                  {maxRappelPath ? (
                    <label className="json-max-rope-item">
                      <span className="json-max-rope-group-label">{titleCase("max_rappel_in_meter")}</span>
                      <input
                        type="number"
                        min={0}
                        value={maxRappelDisplay}
                        onChange={(event) => onNumberDraftChange(maxRappelPath, event.target.value)}
                        onBlur={() => clearDraft(maxRappelPathKey)}
                      />
                      {validationErrors[maxRappelPathKey] ? (
                        <p className="json-inline-error">{validationErrors[maxRappelPathKey]}</p>
                      ) : null}
                    </label>
                  ) : null}
                  {recommendedRopesPath ? (
                    <label className="json-max-rope-item">
                      <span className="json-max-rope-group-label">{titleCase("recommended_ropes")}</span>
                      <input
                        type="text"
                        value={recommendedRopesDisplay}
                        placeholder={DEFAULT_RECOMMENDED_ROPES}
                        onChange={(event) => setPathValue(recommendedRopesPath, event.target.value)}
                      />
                    </label>
                  ) : null}
                  {catchmentAreaPath ? (
                    <label className="json-max-rope-item">
                      <span className="json-max-rope-group-label">Catchment Area (km{"\u00B2"})</span>
                      <input
                        type="number"
                        min={0}
                        value={catchmentAreaDisplay}
                        placeholder={`0km${"\u00B2"}`}
                        onChange={(event) => onNullableNumberDraftChange(catchmentAreaPath, event.target.value)}
                        onBlur={() => clearDraft(catchmentAreaPathKey)}
                      />
                      {validationErrors[catchmentAreaPathKey] ? (
                        <p className="json-inline-error">{validationErrors[catchmentAreaPathKey]}</p>
                      ) : null}
                    </label>
                  ) : null}
                </div>
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
              min={0}
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
              placeholder={`Enter ${titleCase(label).replace(/_/g, " ").toLowerCase()}`}
              onChange={(event) => setPathValue(path, event.target.value)}
            />
          ) : (
            <input
              id={`field-${pathKey}`}
              type="text"
              value={value}
              placeholder={`Enter ${titleCase(label).replace(/_/g, " ").toLowerCase()}`}
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
      poiSuggestions,
      parkingLotSuggestions,
      trackBindings,
      onNumberDraftChange,
      onNullableNumberDraftChange,
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
      requiredDataPanelContent,
      selectedCountryRegions,
      setPathValue,
      specialNoteById,
      specialNoteDefinitions,
      specialNoteIdByIcon,
      validationErrors,
      inputDrafts,
      mapSessionKey,
      mapViewMode,
      trackSnapshot,
    ],
  );

  const currentDataJsonLabel = currentFilePath ?? "No data.json loaded";

  return (
    <div className="json-editor-shell">
      <header className="json-toolbar">
        <div className="json-toolbar-leading">
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
            <select
              className="json-toolbar-language-select"
              aria-label="Default language"
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
          </div>
          <section className="json-toolbar-copy-strip" aria-label="Copy commands">
            <div className="json-toolbar-copy-scroll" onWheel={onCommandStripWheel}>
              {commandsToCopy.map((commandToCopy, index) => (
                <button
                  key={`${commandToCopy.buttonName}-${index}`}
                  type="button"
                  className={`json-copy-command-button${copiedCommandIndex === index ? " copied" : ""}`}
                  onClick={() => void onCopyCommand(commandToCopy.command, index)}
                  title={commandToCopy.command}
                >
                  <CopyIcon />
                  <span>{commandToCopy.buttonName}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
        <p className="json-current-file" title={currentDataJsonLabel}>
          {currentDataJsonLabel}
        </p>
      </header>

      {canyonData ? <section className="json-editor-body">{renderNode(canyonData, [], "Canyon")}</section> : null}

      {saveFeedbackPopup ? (
        <div className="json-modal-backdrop" role="presentation">
          <div
            className={`json-modal json-save-feedback-modal ${saveFeedbackPopup.tone}`}
            role="dialog"
            aria-modal="true"
            aria-label="Save feedback"
          >
            <div className="json-modal-header">
              <h3>Canyon saved</h3>
            </div>
            <p className="json-save-feedback-message">{saveFeedbackPopup.message}</p>
            {saveFeedbackPopup.missingItems.length > 0 ? (
              <ul className="json-save-feedback-list">
                {saveFeedbackPopup.missingItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {saveFeedbackPopup.hiddenCount > 0 ? (
                  <li className="json-save-feedback-more">+{saveFeedbackPopup.hiddenCount} more</li>
                ) : null}
              </ul>
            ) : null}
            <div className="json-modal-actions">
              <button type="button" className="json-modal-keep" onClick={dismissSaveFeedbackPopup}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
              autoFocus
              value={languagePasteDraft}
              rows={12}
              placeholder={LOCALIZED_JSON_PLACEHOLDER}
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
                placeholder="Canyon name"
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
                <TrashIcon />
                <span className="sr-only">Delete section</span>
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
