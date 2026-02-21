import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import mapboxgl from "mapbox-gl";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Feature, FeatureCollection, LineString } from "geojson";
import appIcon from "../../build/icon.png";
import {
  appendCoordinate,
  appendCoordinates,
  calculateStraightSegmentDurationSeconds,
  formatError,
  haversineDistanceMeters,
  isObjectRecord,
  isSameCoordinate,
  parseCoordinateInput,
  toCoordinatePair,
  toCoordinatesArray,
} from "./shared/geo";
import { getTrackDisplayNameFromFilePath, normalizeTrackLink } from "./shared/trackLinks";

type Coordinate = [number, number];
type RoutePointType = "start" | "waypoint" | "end";
type SegmentMode = "route" | "straight";
type MapStyleMode = "satellite" | "outdoors";
type ContextMenuSubmenu = "set" | "insert";

type RoutePoint = {
  id: string;
  type: RoutePointType;
  coordinates: Coordinate;
  segmentMode?: SegmentMode;
};

type MarkerEntry = {
  marker: mapboxgl.Marker;
  element: HTMLDivElement;
  label: HTMLSpanElement;
};

type CachedRouteSegment = {
  distance: number;
  duration: number;
  coordinates: Coordinate[];
  elevationGainM: number;
};

type MapContextMenuState = {
  x: number;
  y: number;
  coordinate: Coordinate;
} | null;

type RouteSegmentSummary = {
  index: number;
  from: Coordinate;
  to: Coordinate;
  mode: SegmentMode;
  distance_m: number;
  duration_s: number;
  elevation_gain_m: number;
  failed: boolean;
  error?: string;
};

type RouteProperties = {
  distance_m: number;
  duration_s: number;
  profile: "walking";
  start: Coordinate;
  end: Coordinate;
  waypoints: Coordinate[];
  segments: RouteSegmentSummary[];
  elevation_gain_m?: number;
  elevation_start_m?: number;
  elevation_end_m?: number;
  generated_at: string;
};

type RouteFeature = Feature<LineString, RouteProperties>;

type DirectionsRoute = {
  distance: number;
  duration: number;
  geometry: LineString;
};

type DirectionsResponse = {
  code?: string;
  message?: string;
  routes?: DirectionsRoute[];
};

type GeocodingFeature = {
  center?: [number, number];
  place_name?: string;
  bbox?: [number, number, number, number];
};

type GeocodingResponse = {
  message?: string;
  features?: GeocodingFeature[];
};

type InsertMenuOption = {
  key: string;
  label: string;
  insertionIndex: number;
  leftNeighbor: { type: RoutePointType; label: string } | null;
  rightNeighbor: { type: RoutePointType; label: string } | null;
};

type ManualCoordinateActionOption =
  | {
      key: string;
      label: string;
      mode: "boundary";
      target: "start" | "end";
      leftNeighbor: null;
      rightNeighbor: null;
    }
  | {
      key: string;
      label: string;
      mode: "insert";
      insertionIndex: number;
      leftNeighbor: { type: RoutePointType; label: string } | null;
      rightNeighbor: { type: RoutePointType; label: string } | null;
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
type PoiEditorState = {
  index: number;
  language: string;
};
type PoiPasteModalState = {
  poiIndex: number;
  field: "name" | "description";
  draft: string;
  error: string;
};
type ParkingEditorState = {
  index: number;
  language: string;
};
type ParkingPasteModalState = {
  parkingLotIndex: number;
  draft: string;
  error: string;
};
type AccessDeleteModalState = {
  trackId: string;
  displayName: string;
} | null;

type ClearTrackModalState = {
  trackId: string;
  displayName: string;
} | null;

export type SectionTrackBinding = {
  sectionIndex: number;
  sectionId: number;
  sectionName: string;
  filePath: string | null;
};

export type AccessTrackBinding = {
  accessIndex: number;
  filePath: string;
};

export type TrackBindings = {
  canyonFilePath: string | null;
  sections: SectionTrackBinding[];
  access: AccessTrackBinding[];
};

type TrackColor = "orange" | "black";
type TrackKind = "section" | "access";

export type MultiTrackItem = {
  id: string;
  kind: TrackKind;
  sectionIndex?: number;
  sectionId?: number;
  displayName: string;
  filePath: string;
  color: TrackColor;
  routePoints: RoutePoint[];
  routeFeature: RouteFeature | null;
  missingFile: boolean;
  legacyFormat: boolean;
  needsRebuild: boolean;
  rawFeatureProperties?: Record<string, unknown>;
};

export type TrackSnapshot = {
  tracks: MultiTrackItem[];
  activeTrackId: string | null;
  warnings: string[];
};

type RouteMapAppProps = {
  viewMode: "compact" | "expanded";
  onRequestExpandMap?: () => void;
  defaultLanguage?: (typeof STATIC_LANGUAGE_KEYS)[number];
  overviewCoordinate?: [number, number] | null;
  onSetOverviewCoordinate?: (coordinate: [number, number]) => void;
  pointsOfInterest?: PointOfInterest[];
  onPointsOfInterestChange?: (points: PointOfInterest[]) => void;
  parkingLots?: ParkingLot[];
  onParkingLotsChange?: (parkingLots: ParkingLot[]) => void;
  parkingLotSuggestions?: LocalizedText[];
  trackBindings?: TrackBindings | null;
  onTrackSnapshotChange?: (snapshot: TrackSnapshot) => void;
};

const STATIC_LANGUAGE_KEYS = ["de", "en", "es", "fr", "it", "pt"] as const;
const STATIC_LANGUAGE_SET = new Set<string>(STATIC_LANGUAGE_KEYS);
const LOCALIZED_JSON_PLACEHOLDER = `{
  "de": "",
  "en": "",
  "es": "",
  "fr": "",
  "it": "",
  "pt": ""
}`;

const TRACKS_SOURCE_ID = "tracks-source";
const TRACKS_ACTIVE_LAYER_ID = "tracks-active-layer";
const TRACKS_INACTIVE_LAYER_ID = "tracks-inactive-layer";
const TRACKS_HOVER_LAYER_ID = "tracks-hover-layer";
const NO_HOVER_TRACK_ID = "__none__";
const TRACK_HOVER_COLOR = "#CCDDFF";
const TERRAIN_TILE_ZOOM = 14;
const TERRAIN_TILE_SIZE = 512;
const MAX_ROUTED_SEGMENT_CACHE_ENTRIES = 400;
const MAP_STYLE_BY_MODE: Record<MapStyleMode, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  outdoors: "mapbox://styles/mapbox/outdoors-v12",
};

function getAccessTrackLineColor(mapStyleMode: MapStyleMode): string {
  return mapStyleMode === "satellite" ? "#FFFFFF" : "#000000";
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

const EMPTY_TRACKS_GEOJSON: FeatureCollection<LineString> = {
  type: "FeatureCollection",
  features: [],
};

function projectLngLatToTilePixel(lng: number, lat: number, zoom: number): {
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
} {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRadians = (clampedLat * Math.PI) / 180;
  const scale = 2 ** zoom;

  const x = ((lng + 180) / 360) * scale;
  const y =
    ((1 - Math.log(Math.tan(latRadians) + 1 / Math.cos(latRadians)) / Math.PI) / 2) * scale;

  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  const pixelX = Math.floor((x - tileX) * TERRAIN_TILE_SIZE);
  const pixelY = Math.floor((y - tileY) * TERRAIN_TILE_SIZE);

  return { tileX, tileY, pixelX, pixelY };
}

function decodeTerrainElevationMeters(
  imageData: ImageData,
  pixelX: number,
  pixelY: number,
): number {
  const x = Math.max(0, Math.min(imageData.width - 1, pixelX));
  const y = Math.max(0, Math.min(imageData.height - 1, pixelY));
  const index = (y * imageData.width + x) * 4;
  const r = imageData.data[index] ?? 0;
  const g = imageData.data[index + 1] ?? 0;
  const b = imageData.data[index + 2] ?? 0;

  return -10000 + (r * 256 * 256 + g * 256 + b) * 0.1;
}

function createEmptyLocalizedText(): LocalizedText {
  const value: LocalizedText = {};
  for (const language of STATIC_LANGUAGE_KEYS) {
    value[language] = "";
  }

  return value;
}

function normalizeLocalizedText(value: LocalizedText | undefined): LocalizedText {
  const normalized = createEmptyLocalizedText();
  if (!value) {
    return normalized;
  }

  for (const language of STATIC_LANGUAGE_KEYS) {
    const current = value[language];
    normalized[language] = typeof current === "string" ? current : "";
  }

  return normalized;
}

function parseLocalizedTextPastePayload(payload: unknown): { value: LocalizedText | null; error: string | null } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      value: null,
      error: "The pasted content must be a JSON object.",
    };
  }

  const obj = payload as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!STATIC_LANGUAGE_SET.has(key)) {
      return {
        value: null,
        error: `Unsupported language key "${key}". Allowed keys: ${STATIC_LANGUAGE_KEYS.join(", ")}.`,
      };
    }
  }

  const value: LocalizedText = {};
  for (const language of STATIC_LANGUAGE_KEYS) {
    const current = obj[language];
    if (typeof current !== "string") {
      return {
        value: null,
        error: `Language "${language}" must be a string.`,
      };
    }

    value[language] = current;
  }

  return { value, error: null };
}

function createRoutePointId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `point_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeRoutePoints(points: RoutePoint[]): RoutePoint[] {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    const onlyPoint = points[0];
    const type: RoutePointType = onlyPoint.type === "end" ? "end" : "start";
    return [{ id: onlyPoint.id, type, coordinates: onlyPoint.coordinates }];
  }

  return points.map((point, index) => {
    const basePoint: RoutePoint = {
      id: point.id,
      type: "waypoint",
      coordinates: point.coordinates,
    };

    if (index === 0) {
      basePoint.type = "start";
      return basePoint;
    }

    if (index === points.length - 1) {
      basePoint.type = "end";
      basePoint.segmentMode = point.segmentMode ?? "straight";
      return basePoint;
    }

    basePoint.type = "waypoint";
    basePoint.segmentMode = point.segmentMode ?? "straight";
    return basePoint;
  });
}

function hasTrackBoundaryPoints(points: RoutePoint[]): boolean {
  return points.some((point) => point.type === "start") && points.some((point) => point.type === "end");
}

function getRoutePointLabel(points: RoutePoint[], index: number): string {
  const point = points[index];
  if (!point) {
    return "Unknown";
  }

  if (point.type === "start") {
    return "Start";
  }

  if (point.type === "end") {
    return "End";
  }

  return `WP ${index}`;
}

function getRoutePointMarkerLabel(point: RoutePoint, routePointIndex: number): string {
  if (point.type === "start") {
    return "S";
  }

  if (point.type === "end") {
    return "E";
  }

  return String(routePointIndex);
}

function createInsertMenuOption(
  points: RoutePoint[],
  key: string,
  label: string,
  insertionIndex: number,
): InsertMenuOption {
  const leftIndex = insertionIndex - 1;
  const rightIndex = insertionIndex;
  const leftPoint = points[leftIndex] ?? null;
  const rightPoint = points[rightIndex] ?? null;

  return {
    key,
    label,
    insertionIndex,
    leftNeighbor: leftPoint
      ? { type: leftPoint.type, label: getRoutePointMarkerLabel(leftPoint, leftIndex) }
      : null,
    rightNeighbor: rightPoint
      ? { type: rightPoint.type, label: getRoutePointMarkerLabel(rightPoint, rightIndex) }
      : null,
  };
}

function syncRoutePointMarkerElement(
  element: HTMLDivElement,
  label: HTMLSpanElement,
  point: RoutePoint,
  routePointIndex: number,
): void {
  element.dataset.type = point.type;
  label.textContent = getRoutePointMarkerLabel(point, routePointIndex);
}

function createRoutePointMarkerElement(
  point: RoutePoint,
  routePointIndex: number,
): { element: HTMLDivElement; label: HTMLSpanElement } {
  const element = document.createElement("div");
  element.className = "route-point-marker";

  const label = document.createElement("span");
  label.className = "route-point-marker-label";
  syncRoutePointMarkerElement(element, label, point, routePointIndex);
  element.append(label);
  return { element, label };
}

function areRoutePointsEqual(a: RoutePoint[], b: RoutePoint[]): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.id !== right.id ||
      left.type !== right.type ||
      left.segmentMode !== right.segmentMode ||
      !isSameCoordinate(left.coordinates, right.coordinates)
    ) {
      return false;
    }
  }

  return true;
}

function createRouteSegmentCacheKey(from: Coordinate, to: Coordinate): string {
  return `${from[0]},${from[1]}|${to[0]},${to[1]}`;
}

function getInsertedPointSegmentMode(points: RoutePoint[], insertionIndex: number): SegmentMode {
  if (points.length < 2) {
    return "straight";
  }

  if (insertionIndex <= 0) {
    return points[1]?.segmentMode ?? "straight";
  }

  if (insertionIndex >= points.length) {
    return points[points.length - 1]?.segmentMode ?? "straight";
  }

  return points[insertionIndex]?.segmentMode ?? "straight";
}

function expandBoundsByRatio(bounds: mapboxgl.LngLatBounds, ratio: number): mapboxgl.LngLatBounds {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();

  let lngSpan = east - west;
  let latSpan = north - south;

  if (lngSpan === 0 && latSpan === 0) {
    const delta = 0.0015;
    return new mapboxgl.LngLatBounds(
      [Math.max(-180, west - delta), Math.max(-85, south - delta)],
      [Math.min(180, east + delta), Math.min(85, north + delta)],
    );
  }

  if (lngSpan === 0) {
    lngSpan = Math.max(latSpan * 0.5, 0.001);
  }
  if (latSpan === 0) {
    latSpan = Math.max(lngSpan * 0.5, 0.001);
  }

  const lngPadding = lngSpan * ratio;
  const latPadding = latSpan * ratio;

  const minLng = Math.max(-180, west - lngPadding);
  const maxLng = Math.min(180, east + lngPadding);
  const minLat = Math.max(-85, south - latPadding);
  const maxLat = Math.min(85, north + latPadding);

  return new mapboxgl.LngLatBounds([minLng, minLat], [maxLng, maxLat]);
}

function parseRouteSegmentsFromProperties(raw: unknown): RouteSegmentSummary[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (!isObjectRecord(entry)) {
        return null;
      }

      const from = toCoordinatePair(entry.from);
      const to = toCoordinatePair(entry.to);
      if (!from || !to) {
        return null;
      }

      return {
        index: Number.isFinite(Number(entry.index)) ? Number(entry.index) : 0,
        from,
        to,
        mode: entry.mode === "route" ? "route" : "straight",
        distance_m: Number.isFinite(Number(entry.distance_m)) ? Number(entry.distance_m) : 0,
        duration_s: Number.isFinite(Number(entry.duration_s)) ? Number(entry.duration_s) : 0,
        elevation_gain_m: Number.isFinite(Number(entry.elevation_gain_m))
          ? Number(entry.elevation_gain_m)
          : 0,
        failed: Boolean(entry.failed),
        ...(typeof entry.error === "string" ? { error: entry.error } : {}),
      };
    })
    .filter((entry): entry is RouteSegmentSummary => entry !== null);
}

function buildRouteFeatureFromRaw(
  coordinates: Coordinate[],
  rawProperties: Record<string, unknown>,
): RouteFeature | null {
  if (coordinates.length === 0) {
    return null;
  }

  const start = toCoordinatePair(rawProperties.start) ?? coordinates[0];
  const end = toCoordinatePair(rawProperties.end) ?? coordinates[coordinates.length - 1];
  const waypoints = toCoordinatesArray(rawProperties.waypoints);
  const segments = parseRouteSegmentsFromProperties(rawProperties.segments);
  const elevationGainFromSegments = segments.reduce((sum, segment) => {
    const gain = Number(segment.elevation_gain_m);
    return Number.isFinite(gain) && gain > 0 ? sum + gain : sum;
  }, 0);

  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates,
    },
    properties: {
      distance_m: Number.isFinite(Number(rawProperties.distance_m)) ? Number(rawProperties.distance_m) : 0,
      duration_s: Number.isFinite(Number(rawProperties.duration_s)) ? Number(rawProperties.duration_s) : 0,
      profile: "walking",
      start,
      end,
      waypoints,
      segments,
      ...(Number.isFinite(Number(rawProperties.elevation_gain_m))
        ? { elevation_gain_m: Number(rawProperties.elevation_gain_m) }
        : { elevation_gain_m: elevationGainFromSegments }),
      ...(Number.isFinite(Number(rawProperties.elevation_start_m))
        ? { elevation_start_m: Number(rawProperties.elevation_start_m) }
        : {}),
      ...(Number.isFinite(Number(rawProperties.elevation_end_m))
        ? { elevation_end_m: Number(rawProperties.elevation_end_m) }
        : {}),
      generated_at:
        typeof rawProperties.generated_at === "string"
          ? rawProperties.generated_at
          : new Date().toISOString(),
    },
  };
}

function parseTrackPayload(payload: unknown, fallbackDisplayName: string): {
  routePoints: RoutePoint[];
  routeFeature: RouteFeature | null;
  rawFeatureProperties: Record<string, unknown>;
  legacyFormat: boolean;
} {
  let lineFeature: Record<string, unknown> | null = null;

  if (isObjectRecord(payload) && payload.type === "FeatureCollection" && Array.isArray(payload.features)) {
    for (const feature of payload.features) {
      if (!isObjectRecord(feature)) {
        continue;
      }

      if (!isObjectRecord(feature.geometry) || feature.geometry.type !== "LineString") {
        continue;
      }

      lineFeature = feature;
      break;
    }
  } else if (
    isObjectRecord(payload) &&
    payload.type === "Feature" &&
    isObjectRecord(payload.geometry) &&
    payload.geometry.type === "LineString"
  ) {
    lineFeature = payload;
  }

  if (!lineFeature || !isObjectRecord(lineFeature.geometry)) {
    return {
      routePoints: [],
      routeFeature: null,
      rawFeatureProperties: {},
      legacyFormat: false,
    };
  }

  const coordinates = toCoordinatesArray(lineFeature.geometry.coordinates);
  const rawFeatureProperties = isObjectRecord(lineFeature.properties)
    ? { ...lineFeature.properties }
    : {};
  const routeFeature = buildRouteFeatureFromRaw(coordinates, rawFeatureProperties);

  const start = toCoordinatePair(rawFeatureProperties.start);
  const end = toCoordinatePair(rawFeatureProperties.end);
  const waypoints = toCoordinatesArray(rawFeatureProperties.waypoints);
  const segments = parseRouteSegmentsFromProperties(rawFeatureProperties.segments);

  if (start && end) {
    const nextPoints: RoutePoint[] = [
      {
        id: createRoutePointId(),
        type: "start",
        coordinates: start,
      },
      ...waypoints.map((coordinate) => ({
        id: createRoutePointId(),
        type: "waypoint" as const,
        coordinates: coordinate,
      })),
      {
        id: createRoutePointId(),
        type: "end",
        coordinates: end,
      },
    ];

    for (let index = 1; index < nextPoints.length; index += 1) {
      const point = nextPoints[index];
      const segment = segments.find((candidate) => candidate.index === index);
      if (!point) {
        continue;
      }

      point.segmentMode = segment?.mode ?? "straight";
    }

    return {
      routePoints: normalizeRoutePoints(nextPoints),
      routeFeature,
      rawFeatureProperties,
      legacyFormat: false,
    };
  }

  const fallbackPoints: RoutePoint[] = coordinates.map((coordinate, index) => ({
    id: createRoutePointId(),
    type: index === 0 ? "start" : index === coordinates.length - 1 ? "end" : "waypoint",
    coordinates: coordinate,
    ...(index > 0 ? { segmentMode: "straight" as const } : {}),
  }));

  return {
    routePoints: normalizeRoutePoints(fallbackPoints),
    routeFeature,
    rawFeatureProperties: {
      ...rawFeatureProperties,
      name:
        typeof rawFeatureProperties.name === "string"
          ? rawFeatureProperties.name
          : fallbackDisplayName,
    },
    legacyFormat: true,
  };
}

type RoutePointListItemProps = {
  point: RoutePoint;
  index: number;
  label: string;
  onDelete: (id: string) => void;
  onSegmentModeChange: (id: string, mode: SegmentMode) => void;
};

function RoutePointListItem({
  point,
  index,
  label,
  onDelete,
  onSegmentModeChange,
}: RoutePointListItemProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: point.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.72 : 1,
  };

  return (
    <li ref={setNodeRef} className={`route-point-item${isDragging ? " dragging" : ""}`} style={style}>
      <button
        type="button"
        className="route-point-drag-handle"
        aria-label={`Drag point ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        ::
      </button>
      <div className="route-point-meta">
        <div className="route-point-title-row">
          <p className="route-point-title">{label}</p>
          {index > 0 ? (
            <select
              className="route-point-segment-select"
              value={point.segmentMode ?? "straight"}
              onChange={(event) => onSegmentModeChange(point.id, event.target.value as SegmentMode)}
            >
              <option value="straight">Straight line</option>
              <option value="route">Along road</option>
            </select>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="route-point-delete"
        aria-label={`Delete point ${index + 1}`}
        onClick={() => onDelete(point.id)}
      >
        <TrashIcon />
      </button>
    </li>
  );
}

export function RouteMapApp({
  viewMode,
  onRequestExpandMap,
  defaultLanguage = "en",
  overviewCoordinate = null,
  onSetOverviewCoordinate,
  pointsOfInterest = [],
  onPointsOfInterestChange,
  parkingLots = [],
  onParkingLotsChange,
  parkingLotSuggestions = [],
  trackBindings = null,
  onTrackSnapshotChange,
}: RouteMapAppProps): JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const manualCoordinateMenuRef = useRef<HTMLDivElement | null>(null);
  const segmentModePopupRef = useRef<mapboxgl.Popup | null>(null);
  const overviewPointMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const poiMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const parkingLotMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const mapPointerCoordinateRef = useRef<Coordinate | null>(null);
  const routePointsRef = useRef<RoutePoint[]>([]);
  const routeFeatureRef = useRef<RouteFeature | null>(null);
  const pointMarkersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const routedSegmentCacheRef = useRef<Map<string, CachedRouteSegment>>(new Map());
  const routeAbortControllerRef = useRef<AbortController | null>(null);
  const suppressMapMenuUntilRef = useRef(0);
  const viewModeRef = useRef<RouteMapAppProps["viewMode"]>(viewMode);
  const activeTrackIdRef = useRef<string | null>(null);
  const hoveredTrackIdRef = useRef<string | null>(null);
  const tracksByIdRef = useRef<Record<string, MultiTrackItem>>({});
  const trackOrderRef = useRef<string[]>([]);
  const syncRouteStateFromTrackRef = useRef(false);
  const lastLoadedTrackBindingKeyRef = useRef<string>("");
  const newAccessTrackCounterRef = useRef(0);
  const autoViewportAppliedForKeyRef = useRef<string>("");
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const searchDebounceTimeoutRef = useRef<number | null>(null);

  const [mapboxToken, setMapboxToken] = useState<string>("");
  const [mapReadyVersion, setMapReadyVersion] = useState(0);
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>("outdoors");
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeFeature, setRouteFeature] = useState<RouteFeature | null>(null);
  const [tracksById, setTracksById] = useState<Record<string, MultiTrackItem>>({});
  const [trackOrder, setTrackOrder] = useState<string[]>([]);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<MapContextMenuState>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<ContextMenuSubmenu | null>(null);
  const [poiEditor, setPoiEditor] = useState<PoiEditorState | null>(null);
  const [poiPasteModal, setPoiPasteModal] = useState<PoiPasteModalState | null>(null);
  const [parkingEditor, setParkingEditor] = useState<ParkingEditorState | null>(null);
  const [parkingPasteModal, setParkingPasteModal] = useState<ParkingPasteModalState | null>(null);
  const [accessDeleteModal, setAccessDeleteModal] = useState<AccessDeleteModalState>(null);
  const [clearTrackModal, setClearTrackModal] = useState<ClearTrackModalState>(null);
  const [coordinateInput, setCoordinateInput] = useState("");
  const [coordinateInputError, setCoordinateInputError] = useState("");
  const [manualCoordinateActionKey, setManualCoordinateActionKey] = useState("");
  const [isManualCoordinateMenuOpen, setIsManualCoordinateMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchErrorMessage, setSearchErrorMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const setStatusText = useCallback((_message: string): void => {
    // Status toasts are intentionally disabled.
  }, []);
  const effectiveDefaultLanguage: (typeof STATIC_LANGUAGE_KEYS)[number] = STATIC_LANGUAGE_SET.has(defaultLanguage)
    ? defaultLanguage
    : "en";

  const activeTrack = activeTrackId ? tracksById[activeTrackId] ?? null : null;
  const showSecondaryPanels = viewMode !== "expanded" || Boolean(activeTrack);

  routePointsRef.current = routePoints;
  routeFeatureRef.current = routeFeature;
  activeTrackIdRef.current = activeTrackId;
  tracksByIdRef.current = tracksById;
  trackOrderRef.current = trackOrder;

  const closeAllMenus = useCallback((): void => {
    setContextMenu(null);
    setIsManualCoordinateMenuOpen(false);
    setActiveSubmenu(null);
    setPoiEditor(null);
    setPoiPasteModal(null);
    setParkingEditor(null);
    setParkingPasteModal(null);
    segmentModePopupRef.current?.remove();
    segmentModePopupRef.current = null;
  }, []);

  const deactivateTrackEditing = useCallback((): void => {
    setActiveTrackId(null);
    segmentModePopupRef.current?.remove();
    segmentModePopupRef.current = null;
  }, []);

  useEffect(() => {
    viewModeRef.current = viewMode;
    autoViewportAppliedForKeyRef.current = "";
    deactivateTrackEditing();
    closeAllMenus();
  }, [closeAllMenus, deactivateTrackEditing, viewMode]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    let cancelled = false;

    async function resolveToken(): Promise<void> {
      const viteToken = import.meta.env.VITE_MAPBOX_TOKEN?.trim();
      const envToken = (await window.api.getMapboxToken())?.trim();
      const token = viteToken || envToken || "";

      if (cancelled) {
        return;
      }

      if (!token) {
        setStatusText("Missing Mapbox token. Set VITE_MAPBOX_TOKEN or MAPBOX_TOKEN.");
        return;
      }

      setMapboxToken(token);
    }

    void resolveToken().catch(() => {
      if (!cancelled) {
        setStatusText("Could not read Mapbox token.");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    routedSegmentCacheRef.current.clear();
  }, [mapboxToken]);

  useEffect(() => {
    autoViewportAppliedForKeyRef.current = "";
  }, [trackBindings?.canyonFilePath]);

  useEffect(() => {
    const bindingKey = JSON.stringify({
      canyonFilePath: trackBindings?.canyonFilePath ?? null,
      sections: (trackBindings?.sections ?? []).map((section) => ({
        sectionIndex: section.sectionIndex,
        sectionId: section.sectionId,
        sectionName: section.sectionName,
        filePath: normalizeTrackLink(section.filePath ?? ""),
      })),
      access: (trackBindings?.access ?? []).map((access) => ({
        accessIndex: access.accessIndex,
        filePath: normalizeTrackLink(access.filePath),
      })),
    });

    if (bindingKey === lastLoadedTrackBindingKeyRef.current) {
      return;
    }
    lastLoadedTrackBindingKeyRef.current = bindingKey;

    let canceled = false;
    async function loadTracksFromBindings(): Promise<void> {
      const existingTracksById = tracksByIdRef.current;
      const nextTracksById: Record<string, MultiTrackItem> = {};
      const nextTrackOrder: string[] = [];
      const toLoad: Array<{ id: string; kind: TrackKind; filePath: string }> = [];

      const sectionBindings = trackBindings?.sections ?? [];
      for (const sectionBinding of sectionBindings) {
        const trackId = `section:${sectionBinding.sectionIndex}`;
        const normalizedPath = normalizeTrackLink(sectionBinding.filePath ?? "");
        const existing = existingTracksById[trackId];
        if (existing && existing.filePath === normalizedPath) {
          nextTracksById[trackId] = {
            ...existing,
            kind: "section",
            sectionIndex: sectionBinding.sectionIndex,
            sectionId: sectionBinding.sectionId,
            displayName: sectionBinding.sectionName || existing.displayName,
            color: "orange",
            filePath: normalizedPath,
          };
          nextTrackOrder.push(trackId);
          continue;
        }

        nextTracksById[trackId] = {
          id: trackId,
          kind: "section",
          sectionIndex: sectionBinding.sectionIndex,
          sectionId: sectionBinding.sectionId,
          displayName: sectionBinding.sectionName || `Section ${sectionBinding.sectionIndex + 1}`,
          color: "orange",
          filePath: normalizedPath,
          routePoints: [],
          routeFeature: null,
          missingFile: false,
          legacyFormat: false,
          needsRebuild: false,
        };
        nextTrackOrder.push(trackId);
        if (normalizedPath) {
          toLoad.push({ id: trackId, kind: "section", filePath: normalizedPath });
        } else {
          nextTracksById[trackId].missingFile = true;
        }
      }

      const accessBindings = trackBindings?.access ?? [];
      for (const accessBinding of accessBindings) {
        const trackId = `access:${accessBinding.accessIndex}`;
        const normalizedPath = normalizeTrackLink(accessBinding.filePath);
        const existing = existingTracksById[trackId];
        if (existing && existing.filePath === normalizedPath) {
          nextTracksById[trackId] = {
            ...existing,
            kind: "access",
            color: "black",
            displayName: getTrackDisplayNameFromFilePath(
              normalizedPath,
              existing.displayName || `Access ${accessBinding.accessIndex + 1}`,
            ),
            filePath: normalizedPath,
          };
          nextTrackOrder.push(trackId);
          continue;
        }

        nextTracksById[trackId] = {
          id: trackId,
          kind: "access",
          displayName: getTrackDisplayNameFromFilePath(
            normalizedPath,
            `Access ${accessBinding.accessIndex + 1}`,
          ),
          color: "black",
          filePath: normalizedPath,
          routePoints: [],
          routeFeature: null,
          missingFile: false,
          legacyFormat: false,
          needsRebuild: false,
        };
        nextTrackOrder.push(trackId);
        if (normalizedPath) {
          toLoad.push({ id: trackId, kind: "access", filePath: normalizedPath });
        } else {
          nextTracksById[trackId].missingFile = true;
        }
      }

      for (const existingTrackId of Object.keys(existingTracksById)) {
        const existing = existingTracksById[existingTrackId];
        if (!existing || existing.kind !== "access") {
          continue;
        }

        if (existing.filePath || !existingTrackId.startsWith("access:new:")) {
          continue;
        }

        if (nextTracksById[existingTrackId]) {
          continue;
        }

        nextTracksById[existingTrackId] = existing;
        nextTrackOrder.push(existingTrackId);
      }

      if (toLoad.length > 0) {
        const result = await window.api.loadTrackFiles({
          canyonFilePath: trackBindings?.canyonFilePath ?? null,
          tracks: toLoad,
        });

        if (canceled) {
          return;
        }

        for (const entry of result.entries) {
          const track = nextTracksById[entry.id];
          if (!track) {
            continue;
          }

          if (entry.missing || entry.error || !entry.data) {
            nextTracksById[entry.id] = {
              ...track,
              missingFile: true,
              routePoints: [],
              routeFeature: null,
              legacyFormat: false,
              needsRebuild: false,
            };
            continue;
          }

          const parsedTrack = parseTrackPayload(entry.data, track.displayName);
          const persistedDisplayName =
            track.kind === "access"
              ? getTrackDisplayNameFromFilePath(track.filePath, track.displayName)
              : track.displayName;

          nextTracksById[entry.id] = {
            ...track,
            displayName: persistedDisplayName,
            routePoints: parsedTrack.routePoints,
            routeFeature: parsedTrack.routeFeature,
            rawFeatureProperties: parsedTrack.rawFeatureProperties,
            missingFile: false,
            legacyFormat: parsedTrack.legacyFormat,
            needsRebuild: false,
          };
        }
      }

      if (canceled) {
        return;
      }

      setTracksById(nextTracksById);
      setTrackOrder(nextTrackOrder);
      setActiveTrackId(null);
    }

    void loadTracksFromBindings().catch((error) => {
      if (!canceled) {
        setStatusText(`Failed to load tracks: ${formatError(error)}`);
      }
    });

    return () => {
      canceled = true;
    };
  }, [trackBindings]);

  useEffect(() => {
    const selectedTrack = activeTrackId ? tracksById[activeTrackId] ?? null : null;
    const nextPoints = selectedTrack?.routePoints ?? [];
    const nextFeature = selectedTrack?.routeFeature ?? null;
    const pointsChanged = !areRoutePointsEqual(routePointsRef.current, nextPoints);

    if (pointsChanged) {
      syncRouteStateFromTrackRef.current = true;
      setRoutePoints(nextPoints);
    } else {
      syncRouteStateFromTrackRef.current = false;
    }

    if (routeFeatureRef.current !== nextFeature) {
      setRouteFeature(nextFeature);
    }
  }, [activeTrackId, tracksById]);

  useEffect(() => {
    if (!activeTrackIdRef.current) {
      return;
    }

    if (syncRouteStateFromTrackRef.current) {
      syncRouteStateFromTrackRef.current = false;
      return;
    }

    setTracksById((current) => {
      const selectedTrackId = activeTrackIdRef.current;
      if (!selectedTrackId) {
        return current;
      }

      const track = current[selectedTrackId];
      if (!track) {
        return current;
      }

      if (areRoutePointsEqual(track.routePoints, routePoints)) {
        return current;
      }

      return {
        ...current,
        [selectedTrackId]: {
          ...track,
          routePoints,
          needsRebuild: true,
          missingFile: false,
        },
      };
    });
  }, [routePoints]);

  useEffect(() => {
    if (!activeTrackIdRef.current) {
      return;
    }

    setTracksById((current) => {
      const selectedTrackId = activeTrackIdRef.current;
      if (!selectedTrackId) {
        return current;
      }

      const track = current[selectedTrackId];
      if (!track) {
        return current;
      }

      if (track.routeFeature === routeFeature && !track.needsRebuild) {
        return current;
      }

      return {
        ...current,
        [selectedTrackId]: {
          ...track,
          routeFeature,
          needsRebuild: false,
          missingFile: false,
        },
      };
    });
  }, [routeFeature]);

  useEffect(() => {
    if (!onTrackSnapshotChange) {
      return;
    }

    const snapshotTracks = trackOrder
      .map((trackId) => {
        const track = tracksById[trackId];
        if (!track) {
          return null;
        }

        if (trackId !== activeTrackId) {
          return track;
        }

        return {
          ...track,
          routePoints,
          routeFeature,
        };
      })
      .filter((track): track is MultiTrackItem => track !== null);

    onTrackSnapshotChange({
      tracks: snapshotTracks,
      activeTrackId,
      warnings: [],
    });
  }, [activeTrackId, onTrackSnapshotChange, routeFeature, routePoints, trackOrder, tracksById]);

  const buildTracksFeatureCollectionSnapshot = useCallback((): FeatureCollection<LineString> => {
    const currentTracksById = tracksByIdRef.current;
    const currentTrackOrder = trackOrderRef.current;
    const currentActiveTrackId = activeTrackIdRef.current;
    const currentActiveRouteFeature = routeFeatureRef.current;
    const features: Array<Feature<LineString, { trackId: string; kind: TrackKind; active: boolean }>> = [];

    for (const trackId of currentTrackOrder) {
      const track = currentTracksById[trackId];
      if (!track) {
        continue;
      }

      const feature = trackId === currentActiveTrackId ? currentActiveRouteFeature : track.routeFeature;
      if (!feature?.geometry?.coordinates?.length) {
        continue;
      }

      const coordinates = feature.geometry.coordinates
        .map((coordinate) => toCoordinatePair(coordinate))
        .filter((coordinate): coordinate is Coordinate => coordinate !== null);
      if (coordinates.length < 2) {
        continue;
      }

      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates,
        },
        properties: {
          trackId,
          kind: track.kind,
          active: trackId === currentActiveTrackId,
        },
      });
    }

    return {
      type: "FeatureCollection",
      features,
    };
  }, []);

  const collectViewportCoordinates = useCallback((): Coordinate[] => {
    const coordinates: Coordinate[] = [];
    if (overviewCoordinate) {
      coordinates.push(overviewCoordinate);
    }

    pointsOfInterest.forEach((poi) => {
      coordinates.push(poi.coordinates);
    });

    parkingLots.forEach((parkingLot) => {
      coordinates.push(parkingLot.coordinates);
    });

    trackOrder.forEach((trackId) => {
      const track = tracksById[trackId];
      if (!track) {
        return;
      }

      const activeFeature = trackId === activeTrackId ? routeFeature : null;
      const trackFeature = activeFeature ?? track.routeFeature;
      if (trackFeature?.geometry?.coordinates?.length) {
        const featureCoordinates = trackFeature.geometry.coordinates
          .map((coordinate) => toCoordinatePair(coordinate))
          .filter((coordinate): coordinate is Coordinate => coordinate !== null);
        coordinates.push(...featureCoordinates);
      }

      const editablePoints = trackId === activeTrackId ? routePoints : track.routePoints;
      editablePoints.forEach((point) => {
        coordinates.push(point.coordinates);
      });
    });

    return coordinates;
  }, [
    activeTrackId,
    overviewCoordinate,
    parkingLots,
    pointsOfInterest,
    routeFeature,
    routePoints,
    trackOrder,
    tracksById,
  ]);

  const zoomToCanyonBounds = useCallback(
    (durationMs = 850): boolean => {
      const map = mapRef.current;
      if (!map) {
        return false;
      }

      const coordinates = collectViewportCoordinates();
      if (coordinates.length === 0) {
        return false;
      }

      const applyViewport = (): void => {
        map.resize();

        if (coordinates.length === 1) {
          map.easeTo({
            center: coordinates[0],
            zoom: Math.max(map.getZoom(), 14),
            duration: durationMs,
            essential: true,
          });
          return;
        }

        const bounds = new mapboxgl.LngLatBounds();
        coordinates.forEach((coordinate) => {
          bounds.extend(coordinate);
        });
        const expandedBounds = expandBoundsByRatio(bounds, 0.15);
        map.fitBounds(expandedBounds, {
          padding: 24,
          maxZoom: 15,
          duration: durationMs,
          essential: true,
        });
      };

      if (!map.isStyleLoaded()) {
        map.once("idle", applyViewport);
        return true;
      }

      applyViewport();
      return true;
    },
    [collectViewportCoordinates],
  );

  const drawTracks = useCallback((collection: FeatureCollection<LineString>): void => {
    const map = mapRef.current;
    const accessTrackLineColor = getAccessTrackLineColor(mapStyleMode);

    if (!map) {
      return;
    }

    if (!map.isStyleLoaded()) {
      map.once("idle", () => drawTracks(collection));
      return;
    }

    if (!map.getSource(TRACKS_SOURCE_ID)) {
      map.addSource(TRACKS_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_TRACKS_GEOJSON as GeoJSON.FeatureCollection,
      });
    }

    if (!map.getLayer(TRACKS_INACTIVE_LAYER_ID)) {
      map.addLayer({
        id: TRACKS_INACTIVE_LAYER_ID,
        type: "line",
        source: TRACKS_SOURCE_ID,
        filter: ["==", ["get", "active"], false],
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "section",
            "#FF0000",
            "access",
            accessTrackLineColor,
            accessTrackLineColor,
          ],
          "line-width": 4,
          "line-opacity": 1,
        },
      });
    }
    map.setPaintProperty(TRACKS_INACTIVE_LAYER_ID, "line-color", [
      "match",
      ["get", "kind"],
      "section",
      "#FF0000",
      "access",
      accessTrackLineColor,
      accessTrackLineColor,
    ]);
    map.setPaintProperty(TRACKS_INACTIVE_LAYER_ID, "line-width", 4);
    map.setPaintProperty(TRACKS_INACTIVE_LAYER_ID, "line-opacity", 1);

    if (!map.getLayer(TRACKS_ACTIVE_LAYER_ID)) {
      map.addLayer({
        id: TRACKS_ACTIVE_LAYER_ID,
        type: "line",
        source: TRACKS_SOURCE_ID,
        filter: ["==", ["get", "active"], true],
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "section",
            "#FF0000",
            "access",
            accessTrackLineColor,
            accessTrackLineColor,
          ],
          "line-width": 6,
          "line-opacity": 1,
        },
      });
    }
    map.setPaintProperty(TRACKS_ACTIVE_LAYER_ID, "line-color", [
      "match",
      ["get", "kind"],
      "section",
      "#FF0000",
      "access",
      accessTrackLineColor,
      accessTrackLineColor,
    ]);
    map.setPaintProperty(TRACKS_ACTIVE_LAYER_ID, "line-width", 6);
    map.setPaintProperty(TRACKS_ACTIVE_LAYER_ID, "line-opacity", 1);

    if (!map.getLayer(TRACKS_HOVER_LAYER_ID)) {
      map.addLayer({
        id: TRACKS_HOVER_LAYER_ID,
        type: "line",
        source: TRACKS_SOURCE_ID,
        filter: ["==", ["get", "trackId"], NO_HOVER_TRACK_ID],
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": TRACK_HOVER_COLOR,
          "line-width": [
            "case",
            ["==", ["get", "active"], true],
            11,
            9,
          ],
          "line-opacity": 0.65,
          "line-blur": 1.35,
        },
      });
    }
    map.setPaintProperty(TRACKS_HOVER_LAYER_ID, "line-color", TRACK_HOVER_COLOR);
    map.setPaintProperty(TRACKS_HOVER_LAYER_ID, "line-width", [
      "case",
      ["==", ["get", "active"], true],
      11,
      9,
    ]);
    map.setPaintProperty(TRACKS_HOVER_LAYER_ID, "line-opacity", 0.65);
    map.setPaintProperty(TRACKS_HOVER_LAYER_ID, "line-blur", 1.35);
    const selectedTrackId = activeTrackIdRef.current;
    const hoveredTrackId = hoveredTrackIdRef.current;
    const hoverLayerTrackId =
      selectedTrackId && hoveredTrackId === selectedTrackId ? NO_HOVER_TRACK_ID : hoveredTrackId ?? NO_HOVER_TRACK_ID;
    map.setFilter(TRACKS_HOVER_LAYER_ID, ["==", ["get", "trackId"], hoverLayerTrackId]);

    const source = map.getSource(TRACKS_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    source.setData(collection as GeoJSON.FeatureCollection);
  }, [mapStyleMode]);

  const onToggleMapStyle = useCallback((): void => {
    setMapStyleMode((current) => (current === "satellite" ? "outdoors" : "satellite"));
  }, []);

  const onZoomToEntireCanyon = useCallback((): void => {
    zoomToCanyonBounds();
  }, [zoomToCanyonBounds]);

  const clearPendingSearch = useCallback((): void => {
    if (searchDebounceTimeoutRef.current !== null) {
      window.clearTimeout(searchDebounceTimeoutRef.current);
      searchDebounceTimeoutRef.current = null;
    }
    searchAbortControllerRef.current?.abort();
    searchAbortControllerRef.current = null;
    setIsSearching(false);
  }, []);

  const runLocationSearch = useCallback(
    async (rawQuery: string): Promise<void> => {
      const query = rawQuery.trim();
      if (!query) {
        setSearchErrorMessage("Enter a location first.");
        return;
      }

      if (!mapboxToken) {
        setSearchErrorMessage("Map search unavailable: missing Mapbox token.");
        return;
      }

      const map = mapRef.current;
      if (!map) {
        setSearchErrorMessage("Map is not ready yet.");
        return;
      }

      searchAbortControllerRef.current?.abort();
      const controller = new AbortController();
      searchAbortControllerRef.current = controller;
      setIsSearching(true);
      setSearchErrorMessage("");

      try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?limit=1&types=place,locality,neighborhood,address,poi&access_token=${encodeURIComponent(mapboxToken)}`;
        const response = await fetch(url, { signal: controller.signal });
        const payload = (await response.json()) as GeocodingResponse;
        if (!response.ok) {
          throw new Error(payload.message || `Geocoding request failed (${response.status}).`);
        }

        const bestMatch = Array.isArray(payload.features) ? payload.features[0] : null;
        if (
          !bestMatch ||
          !Array.isArray(bestMatch.center) ||
          bestMatch.center.length < 2 ||
          !Number.isFinite(bestMatch.center[0]) ||
          !Number.isFinite(bestMatch.center[1])
        ) {
          setSearchErrorMessage(`No location found for "${query}".`);
          return;
        }

        const coordinate: Coordinate = [bestMatch.center[0], bestMatch.center[1]];

        if (
          Array.isArray(bestMatch.bbox) &&
          bestMatch.bbox.length === 4 &&
          bestMatch.bbox.every((value) => Number.isFinite(value))
        ) {
          const [west, south, east, north] = bestMatch.bbox;
          if (west <= east && south <= north) {
            map.fitBounds(
              new mapboxgl.LngLatBounds([west, south], [east, north]),
              {
                padding: 80,
                duration: 950,
                maxZoom: 15,
              },
            );
          } else {
            map.flyTo({
              center: coordinate,
              zoom: Math.max(14, map.getZoom()),
              duration: 950,
              essential: true,
            });
          }
        } else {
          map.flyTo({
            center: coordinate,
            zoom: Math.max(14, map.getZoom()),
            duration: 950,
            essential: true,
          });
        }

        setSearchErrorMessage("");
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message = formatError(error);
        setSearchErrorMessage(message ? `Search failed: ${message}` : "Search failed.");
      } finally {
        if (searchAbortControllerRef.current === controller) {
          searchAbortControllerRef.current = null;
        }
        setIsSearching(false);
      }
    },
    [mapboxToken],
  );

  const queueLocationSearch = useCallback(
    (query: string): void => {
      if (searchDebounceTimeoutRef.current !== null) {
        window.clearTimeout(searchDebounceTimeoutRef.current);
      }

      searchDebounceTimeoutRef.current = window.setTimeout(() => {
        searchDebounceTimeoutRef.current = null;
        void runLocationSearch(query);
      }, 220);
    },
    [runLocationSearch],
  );

  const onSubmitLocationSearch = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const query = searchQuery.trim();
      if (!query) {
        setSearchErrorMessage("Enter a location first.");
        return;
      }

      queueLocationSearch(query);
    },
    [queueLocationSearch, searchQuery],
  );

  const onClearLocationSearch = useCallback((): void => {
    clearPendingSearch();
    setSearchQuery("");
    setSearchErrorMessage("");
  }, [clearPendingSearch]);

  const generateRoute = useCallback(
    async (trackId: string, points: RoutePoint[]): Promise<void> => {
      if (points.length < 2 || points[0]?.type !== "start" || points[points.length - 1]?.type !== "end") {
        if (activeTrackIdRef.current === trackId) {
          setRouteFeature(null);
        }
        return;
      }

      routeAbortControllerRef.current?.abort();

      const controller = new AbortController();
      routeAbortControllerRef.current = controller;
      setStatusText("Updating walking route...");

      try {
        const fullCoordinates: Coordinate[] = [];
        const segments: RouteSegmentSummary[] = [];
        const segmentErrors: string[] = [];
        const terrainTileCache = new Map<string, Promise<ImageData>>();
        const terrainElevationCache = new Map<string, Promise<number>>();
        let totalDistanceM = 0;
        let totalDurationS = 0;
        let totalElevationGainM = 0;

        const loadTerrainTileImageData = async (tileX: number, tileY: number): Promise<ImageData> => {
          const key = `${TERRAIN_TILE_ZOOM}/${tileX}/${tileY}`;
          const cached = terrainTileCache.get(key);
          if (cached) {
            return cached;
          }

          const promise = (async () => {
            if (!mapboxToken) {
              throw new Error("Missing Mapbox token for terrain lookup.");
            }

            const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${TERRAIN_TILE_ZOOM}/${tileX}/${tileY}@2x.pngraw?access_token=${encodeURIComponent(mapboxToken)}`;
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
              throw new Error(`Terrain request failed (${response.status}).`);
            }

            const blob = await response.blob();
            const bitmap = await createImageBitmap(blob);
            const canvas = document.createElement("canvas");
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;

            const context = canvas.getContext("2d");
            if (!context) {
              bitmap.close();
              throw new Error("Could not create 2D canvas context for terrain decoding.");
            }

            context.drawImage(bitmap, 0, 0);
            bitmap.close();
            return context.getImageData(0, 0, canvas.width, canvas.height);
          })();

          terrainTileCache.set(key, promise);
          return promise;
        };

        const getCoordinateElevationMeters = async (coordinate: Coordinate): Promise<number> => {
          const key = `${coordinate[0]},${coordinate[1]}`;
          const cached = terrainElevationCache.get(key);
          if (cached) {
            return cached;
          }

          const promise = (async () => {
            const tilePoint = projectLngLatToTilePixel(
              coordinate[0],
              coordinate[1],
              TERRAIN_TILE_ZOOM,
            );
            const tileImage = await loadTerrainTileImageData(tilePoint.tileX, tilePoint.tileY);
            return decodeTerrainElevationMeters(tileImage, tilePoint.pixelX, tilePoint.pixelY);
          })();

          terrainElevationCache.set(key, promise);
          return promise;
        };

        const getStraightSegmentDurationSeconds = async (
          from: Coordinate,
          to: Coordinate,
          distanceM: number,
        ): Promise<number> => {
          try {
            const [fromElevationM, toElevationM] = await Promise.all([
              getCoordinateElevationMeters(from),
              getCoordinateElevationMeters(to),
            ]);
            return calculateStraightSegmentDurationSeconds(distanceM, toElevationM - fromElevationM);
          } catch {
            return calculateStraightSegmentDurationSeconds(distanceM, 0);
          }
        };

        const getStraightSegmentElevationGainMeters = async (
          from: Coordinate,
          to: Coordinate,
        ): Promise<number> => {
          try {
            const [fromElevationM, toElevationM] = await Promise.all([
              getCoordinateElevationMeters(from),
              getCoordinateElevationMeters(to),
            ]);
            return Math.max(0, toElevationM - fromElevationM);
          } catch {
            return 0;
          }
        };

        const getPositiveElevationGainForCoordinatePath = async (
          coordinates: Coordinate[],
        ): Promise<number> => {
          if (coordinates.length < 2) {
            return 0;
          }

          try {
            let gainM = 0;
            let previousElevationM = await getCoordinateElevationMeters(coordinates[0]);
            for (let coordinateIndex = 1; coordinateIndex < coordinates.length; coordinateIndex += 1) {
              const currentElevationM = await getCoordinateElevationMeters(coordinates[coordinateIndex]);
              gainM += Math.max(0, currentElevationM - previousElevationM);
              previousElevationM = currentElevationM;
            }
            return gainM;
          } catch {
            return 0;
          }
        };

        appendCoordinate(fullCoordinates, points[0].coordinates);

        for (let index = 1; index < points.length; index += 1) {
          const previousPoint = points[index - 1];
          const currentPoint = points[index];
          const mode: SegmentMode = currentPoint.segmentMode ?? "straight";

          if (mode === "straight") {
            const straightDistanceM = haversineDistanceMeters(
              previousPoint.coordinates,
              currentPoint.coordinates,
            );
            const straightDurationS = await getStraightSegmentDurationSeconds(
              previousPoint.coordinates,
              currentPoint.coordinates,
              straightDistanceM,
            );
            const straightElevationGainM = await getStraightSegmentElevationGainMeters(
              previousPoint.coordinates,
              currentPoint.coordinates,
            );
            appendCoordinates(fullCoordinates, [previousPoint.coordinates, currentPoint.coordinates]);
            totalDistanceM += straightDistanceM;
            totalDurationS += straightDurationS;
            totalElevationGainM += straightElevationGainM;
            segments.push({
              index,
              from: previousPoint.coordinates,
              to: currentPoint.coordinates,
              mode: "straight",
              distance_m: straightDistanceM,
              duration_s: straightDurationS,
              elevation_gain_m: Math.round(straightElevationGainM),
              failed: false,
            });
            continue;
          }

          try {
            if (!mapboxToken) {
              throw new Error("Missing Mapbox token for routed segment.");
            }

            const cacheKey = createRouteSegmentCacheKey(
              previousPoint.coordinates,
              currentPoint.coordinates,
            );
            const cachedSegment = routedSegmentCacheRef.current.get(cacheKey);
            if (cachedSegment) {
              const cachedElevationGainM = Number.isFinite(cachedSegment.elevationGainM)
                ? cachedSegment.elevationGainM
                : await getPositiveElevationGainForCoordinatePath(cachedSegment.coordinates);
              appendCoordinates(fullCoordinates, cachedSegment.coordinates);
              totalDistanceM += cachedSegment.distance;
              totalDurationS += cachedSegment.duration;
              totalElevationGainM += cachedElevationGainM;
              segments.push({
                index,
                from: previousPoint.coordinates,
                to: currentPoint.coordinates,
                mode: "route",
                distance_m: cachedSegment.distance,
                duration_s: cachedSegment.duration,
                elevation_gain_m: Math.round(cachedElevationGainM),
                failed: false,
              });
              continue;
            }

            const coordinatesParam = `${previousPoint.coordinates[0]},${previousPoint.coordinates[1]};${currentPoint.coordinates[0]},${currentPoint.coordinates[1]}`;
            const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinatesParam}?geometries=geojson&overview=full&access_token=${encodeURIComponent(mapboxToken)}`;
            const response = await fetch(url, { signal: controller.signal });
            const payload = (await response.json()) as DirectionsResponse;

            if (!response.ok) {
              throw new Error(payload.message || `Directions API request failed (${response.status}).`);
            }

            const route = payload.routes?.[0];
            if (!route || !route.geometry?.coordinates?.length) {
              throw new Error("No route found for this segment.");
            }

            const segmentCoordinates = route.geometry.coordinates.map(
              (coordinate) => [coordinate[0], coordinate[1]] as Coordinate,
            );
            const routeElevationGainM = await getPositiveElevationGainForCoordinatePath(segmentCoordinates);
            if (routedSegmentCacheRef.current.size >= MAX_ROUTED_SEGMENT_CACHE_ENTRIES) {
              routedSegmentCacheRef.current.clear();
            }
            routedSegmentCacheRef.current.set(cacheKey, {
              distance: route.distance,
              duration: route.duration,
              coordinates: segmentCoordinates,
              elevationGainM: routeElevationGainM,
            });
            appendCoordinates(fullCoordinates, segmentCoordinates);

            totalDistanceM += route.distance;
            totalDurationS += route.duration;
            totalElevationGainM += routeElevationGainM;
            segments.push({
              index,
              from: previousPoint.coordinates,
              to: currentPoint.coordinates,
              mode: "route",
              distance_m: route.distance,
              duration_s: route.duration,
              elevation_gain_m: Math.round(routeElevationGainM),
              failed: false,
            });
          } catch (segmentError) {
            if (controller.signal.aborted) {
              return;
            }

            const fallbackDistanceM = haversineDistanceMeters(
              previousPoint.coordinates,
              currentPoint.coordinates,
            );
            const fallbackDurationS = await getStraightSegmentDurationSeconds(
              previousPoint.coordinates,
              currentPoint.coordinates,
              fallbackDistanceM,
            );
            const fallbackElevationGainM = await getStraightSegmentElevationGainMeters(
              previousPoint.coordinates,
              currentPoint.coordinates,
            );
            appendCoordinates(fullCoordinates, [previousPoint.coordinates, currentPoint.coordinates]);
            totalDistanceM += fallbackDistanceM;
            totalDurationS += fallbackDurationS;
            totalElevationGainM += fallbackElevationGainM;
            segments.push({
              index,
              from: previousPoint.coordinates,
              to: currentPoint.coordinates,
              mode: "route",
              distance_m: fallbackDistanceM,
              duration_s: fallbackDurationS,
              elevation_gain_m: Math.round(fallbackElevationGainM),
              failed: true,
              error: formatError(segmentError),
            });
            segmentErrors.push(
              `Segment ${index} fallback to straight line: ${formatError(segmentError)}`,
            );
          }
        }

        if (fullCoordinates.length < 2) {
          throw new Error("Route geometry could not be generated.");
        }

        const start = points[0].coordinates;
        const end = points[points.length - 1].coordinates;
        const waypoints = points.slice(1, -1).map((point) => point.coordinates);
        let elevationStartM: number | undefined;
        let elevationEndM: number | undefined;
        try {
          const [resolvedStartElevation, resolvedEndElevation] = await Promise.all([
            getCoordinateElevationMeters(start),
            getCoordinateElevationMeters(end),
          ]);
          if (Number.isFinite(resolvedStartElevation)) {
            elevationStartM = Math.round(resolvedStartElevation);
          }
          if (Number.isFinite(resolvedEndElevation)) {
            elevationEndM = Math.round(resolvedEndElevation);
          }
        } catch {
          // Ignore elevation lookup errors so route generation can still complete.
        }

        const feature: RouteFeature = {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: fullCoordinates,
          },
          properties: {
            distance_m: totalDistanceM,
            duration_s: totalDurationS,
            profile: "walking",
            start,
            end,
            waypoints,
            segments,
            elevation_gain_m: Math.round(totalElevationGainM),
            ...(typeof elevationStartM === "number" ? { elevation_start_m: elevationStartM } : {}),
            ...(typeof elevationEndM === "number" ? { elevation_end_m: elevationEndM } : {}),
            generated_at: new Date().toISOString(),
          },
        };

        if (controller.signal.aborted || activeTrackIdRef.current !== trackId) {
          return;
        }

        setRouteFeature(feature);
        if (segmentErrors.length > 0) {
          setStatusText(`Route ready with warnings: ${segmentErrors.join(" | ")}`);
        } else {
          setStatusText("Route ready.");
        }
      } catch (error) {
        if (controller.signal.aborted || activeTrackIdRef.current !== trackId) {
          return;
        }

        setRouteFeature(null);
        setStatusText(`Failed to generate route: ${formatError(error)}`);
      } finally {
        if (routeAbortControllerRef.current === controller) {
          routeAbortControllerRef.current = null;
        }
      }
    },
    [mapboxToken],
  );

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE_BY_MODE[mapStyleMode],
      center: overviewCoordinate ?? [8.980786, 46.300597],
      zoom: overviewCoordinate ? 13.5 : 12,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const openMenuForEvent = (event: mapboxgl.MapMouseEvent): void => {
      if (viewModeRef.current !== "expanded") {
        return;
      }

      if (Date.now() < suppressMapMenuUntilRef.current) {
        return;
      }

      const coordinate: Coordinate = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];

      closeAllMenus();
      setContextMenu({
        x: Math.round(event.point.x),
        y: Math.round(event.point.y),
        coordinate,
      });
    };

    const onMapClick = (event: mapboxgl.MapMouseEvent): void => {
      if (viewModeRef.current !== "expanded") {
        onRequestExpandMap?.();
        return;
      }

      if (viewModeRef.current === "expanded") {
        const lineLayerIds = [TRACKS_ACTIVE_LAYER_ID, TRACKS_INACTIVE_LAYER_ID].filter((layerId) =>
          Boolean(map.getLayer(layerId)),
        );
        if (lineLayerIds.length > 0) {
          const clickedFeatures = map.queryRenderedFeatures(event.point, {
            layers: lineLayerIds,
          });
          const clickedTrackId = clickedFeatures
            .map((feature) => (isObjectRecord(feature.properties) ? feature.properties.trackId : null))
            .find((trackId): trackId is string => typeof trackId === "string");
          if (clickedTrackId && tracksByIdRef.current[clickedTrackId]) {
            setActiveTrackId(clickedTrackId);
            closeAllMenus();
            return;
          }
        }
      }

      deactivateTrackEditing();
      closeAllMenus();
    };

    const onMapContextMenu = (event: mapboxgl.MapMouseEvent): void => {
      event.originalEvent.preventDefault();
      openMenuForEvent(event);
    };

    const onMapMouseMove = (event: mapboxgl.MapMouseEvent): void => {
      mapPointerCoordinateRef.current = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];

      const lineLayerIds = [TRACKS_ACTIVE_LAYER_ID, TRACKS_INACTIVE_LAYER_ID].filter((layerId) =>
        Boolean(map.getLayer(layerId)),
      );
      if (lineLayerIds.length === 0) {
        hoveredTrackIdRef.current = null;
        if (map.getLayer(TRACKS_HOVER_LAYER_ID)) {
          map.setFilter(TRACKS_HOVER_LAYER_ID, ["==", ["get", "trackId"], NO_HOVER_TRACK_ID]);
        }
        map.getCanvas().style.cursor = "";
        return;
      }

      const hoveredFeatures = map.queryRenderedFeatures(event.point, {
        layers: lineLayerIds,
      });
      const selectedTrackId = activeTrackIdRef.current;
      const hoveredId =
        hoveredFeatures
          .map((feature) => (isObjectRecord(feature.properties) ? feature.properties.trackId : null))
          .find(
            (trackId): trackId is string =>
              typeof trackId === "string" && (!selectedTrackId || trackId !== selectedTrackId),
          ) ?? null;

      hoveredTrackIdRef.current = hoveredId;
      if (map.getLayer(TRACKS_HOVER_LAYER_ID)) {
        map.setFilter(TRACKS_HOVER_LAYER_ID, [
          "==",
          ["get", "trackId"],
          hoveredId ?? NO_HOVER_TRACK_ID,
        ]);
      }
      map.getCanvas().style.cursor = hoveredId ? "pointer" : "";
    };

    const onCanvasContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    const onCanvasMouseLeave = (): void => {
      mapPointerCoordinateRef.current = null;
      hoveredTrackIdRef.current = null;
      if (map.getLayer(TRACKS_HOVER_LAYER_ID)) {
        map.setFilter(TRACKS_HOVER_LAYER_ID, ["==", ["get", "trackId"], NO_HOVER_TRACK_ID]);
      }
      map.getCanvas().style.cursor = "";
    };

    const onMapMoveStart = (): void => {
      closeAllMenus();
    };

    map.on("click", onMapClick);
    map.on("contextmenu", onMapContextMenu);
    map.on("mousemove", onMapMouseMove);
    map.on("movestart", onMapMoveStart);
    map.getCanvasContainer().addEventListener("contextmenu", onCanvasContextMenu);
    map.getCanvasContainer().addEventListener("mouseleave", onCanvasMouseLeave);

    mapRef.current = map;
    setMapReadyVersion((current) => current + 1);

    return () => {
      map.off("click", onMapClick);
      map.off("contextmenu", onMapContextMenu);
      map.off("mousemove", onMapMouseMove);
      map.off("movestart", onMapMoveStart);
      map.getCanvasContainer().removeEventListener("contextmenu", onCanvasContextMenu);
      map.getCanvasContainer().removeEventListener("mouseleave", onCanvasMouseLeave);
      map.getCanvas().style.cursor = "";
      hoveredTrackIdRef.current = null;

      segmentModePopupRef.current?.remove();
      segmentModePopupRef.current = null;
      overviewPointMarkerRef.current?.remove();
      overviewPointMarkerRef.current = null;
      for (const marker of poiMarkersRef.current) {
        marker.remove();
      }
      poiMarkersRef.current = [];
      for (const marker of parkingLotMarkersRef.current) {
        marker.remove();
      }
      parkingLotMarkersRef.current = [];
      mapPointerCoordinateRef.current = null;

      for (const markerEntry of pointMarkersRef.current.values()) {
        markerEntry.marker.remove();
      }
      pointMarkersRef.current.clear();

      map.remove();
      mapRef.current = null;
    };
  }, [closeAllMenus, deactivateTrackEditing, mapboxToken, onRequestExpandMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (viewMode === "expanded") {
      map.dragPan.enable();
      map.scrollZoom.enable();
      map.boxZoom.enable();
      map.dragRotate.enable();
      map.keyboard.enable();
      map.doubleClickZoom.enable();
      map.touchZoomRotate.enable();
      return;
    }

    map.dragPan.disable();
    map.scrollZoom.disable();
    map.boxZoom.disable();
    map.dragRotate.disable();
    map.keyboard.disable();
    map.doubleClickZoom.disable();
    map.touchZoomRotate.disable();
  }, [viewMode, mapReadyVersion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      map.resize();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (!overviewCoordinate) {
      overviewPointMarkerRef.current?.remove();
      overviewPointMarkerRef.current = null;
      return;
    }

    const marker = overviewPointMarkerRef.current;
    if (marker) {
      marker.setLngLat(overviewCoordinate);
      return;
    }

    const markerElement = document.createElement("div");
    markerElement.className = "overview-point-marker";
    markerElement.title = "Canyon overview point";
    markerElement.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (viewModeRef.current !== "expanded") {
        onRequestExpandMap?.();
      }
    });
    const markerLogo = document.createElement("img");
    markerLogo.className = "overview-point-marker-logo";
    markerLogo.src = appIcon;
    markerLogo.alt = "";
    markerLogo.draggable = false;
    markerElement.append(markerLogo);

    const overviewMarker = new mapboxgl.Marker({
      element: markerElement,
      anchor: "center",
      draggable: Boolean(onSetOverviewCoordinate) && viewMode === "expanded",
    })
      .setLngLat(overviewCoordinate)
      .addTo(map);

    if (onSetOverviewCoordinate) {
      overviewMarker.on("dragstart", () => {
        suppressMapMenuUntilRef.current = Date.now() + 350;
        deactivateTrackEditing();
        closeAllMenus();
      });

      overviewMarker.on("dragend", () => {
        suppressMapMenuUntilRef.current = Date.now() + 350;
        const lngLat = overviewMarker.getLngLat();
        onSetOverviewCoordinate([
          Number(lngLat.lng.toFixed(6)),
          Number(lngLat.lat.toFixed(6)),
        ]);
        setStatusText("Canyon overview point moved.");
      });
    }

    overviewPointMarkerRef.current = overviewMarker;
  }, [
    closeAllMenus,
    deactivateTrackEditing,
    mapReadyVersion,
    onRequestExpandMap,
    onSetOverviewCoordinate,
    overviewCoordinate,
    viewMode,
  ]);

  useEffect(() => {
    return () => {
      clearPendingSearch();
    };
  }, [clearPendingSearch]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    for (const marker of poiMarkersRef.current) {
      marker.remove();
    }
    poiMarkersRef.current = [];

    pointsOfInterest.forEach((poi, index) => {
      const markerElement = document.createElement("button");
      markerElement.type = "button";
      markerElement.className = "poi-marker";
      markerElement.textContent = "POI";
      markerElement.setAttribute("aria-label", `Open point of interest ${index + 1}`);

      const marker = new mapboxgl.Marker({
        element: markerElement,
        anchor: "bottom",
        draggable: Boolean(onPointsOfInterestChange) && viewMode === "expanded",
      })
        .setLngLat(poi.coordinates)
        .addTo(map);

      markerElement.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (viewModeRef.current !== "expanded") {
          onRequestExpandMap?.();
          return;
        }

        deactivateTrackEditing();
        closeAllMenus();
        setPoiEditor({
          index,
          language: effectiveDefaultLanguage,
        });
      });

      if (onPointsOfInterestChange) {
        marker.on("dragstart", () => {
          suppressMapMenuUntilRef.current = Date.now() + 350;
          deactivateTrackEditing();
          closeAllMenus();
        });

        marker.on("dragend", () => {
          suppressMapMenuUntilRef.current = Date.now() + 350;
          const lngLat = marker.getLngLat();
          const coordinate: [number, number] = [
            Number(lngLat.lng.toFixed(6)),
            Number(lngLat.lat.toFixed(6)),
          ];

          const next = pointsOfInterest.map((currentPoi, currentIndex) =>
            currentIndex === index
              ? {
                  ...currentPoi,
                  coordinates: coordinate,
                }
              : currentPoi,
          );
          onPointsOfInterestChange(next);
          setStatusText("Point of interest moved.");
        });
      }

      poiMarkersRef.current.push(marker);
    });
  }, [
    closeAllMenus,
    deactivateTrackEditing,
    effectiveDefaultLanguage,
    mapReadyVersion,
    onRequestExpandMap,
    onPointsOfInterestChange,
    pointsOfInterest,
    viewMode,
  ]);

  useEffect(() => {
    if (!poiEditor) {
      return;
    }

    if (poiEditor.index < 0 || poiEditor.index >= pointsOfInterest.length) {
      setPoiEditor(null);
      setPoiPasteModal(null);
    }
  }, [poiEditor, pointsOfInterest.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    for (const marker of parkingLotMarkersRef.current) {
      marker.remove();
    }
    parkingLotMarkersRef.current = [];

    parkingLots.forEach((parkingLot, index) => {
      const markerElement = document.createElement("button");
      markerElement.type = "button";
      markerElement.className = "parking-lot-marker";
      markerElement.textContent = "P";
      markerElement.setAttribute("aria-label", `Open parking lot ${index + 1}`);

      const marker = new mapboxgl.Marker({
        element: markerElement,
        anchor: "bottom",
        draggable: Boolean(onParkingLotsChange) && viewMode === "expanded",
      })
        .setLngLat(parkingLot.coordinates)
        .addTo(map);

      markerElement.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (viewModeRef.current !== "expanded") {
          onRequestExpandMap?.();
          return;
        }

        deactivateTrackEditing();
        closeAllMenus();
        setParkingEditor({
          index,
          language: effectiveDefaultLanguage,
        });
      });

      if (onParkingLotsChange) {
        marker.on("dragstart", () => {
          suppressMapMenuUntilRef.current = Date.now() + 350;
          deactivateTrackEditing();
          closeAllMenus();
        });

        marker.on("dragend", () => {
          suppressMapMenuUntilRef.current = Date.now() + 350;
          const lngLat = marker.getLngLat();
          const coordinate: [number, number] = [
            Number(lngLat.lng.toFixed(6)),
            Number(lngLat.lat.toFixed(6)),
          ];

          const next = parkingLots.map((currentParkingLot, currentIndex) =>
            currentIndex === index
              ? {
                  ...currentParkingLot,
                  coordinates: coordinate,
                }
              : currentParkingLot,
          );
          onParkingLotsChange(next);
          setStatusText("Parking lot moved.");
        });
      }

      parkingLotMarkersRef.current.push(marker);
    });
  }, [
    closeAllMenus,
    deactivateTrackEditing,
    effectiveDefaultLanguage,
    mapReadyVersion,
    onRequestExpandMap,
    onParkingLotsChange,
    parkingLots,
    viewMode,
  ]);

  useEffect(() => {
    if (!parkingEditor) {
      return;
    }

    if (parkingEditor.index < 0 || parkingEditor.index >= parkingLots.length) {
      setParkingEditor(null);
      setParkingPasteModal(null);
    }
  }, [parkingEditor, parkingLots.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const canyonKey = trackBindings?.canyonFilePath ?? "__default__";
    const viewportKey = `${canyonKey}|${viewMode}`;
    if (autoViewportAppliedForKeyRef.current === viewportKey) {
      return;
    }

    const expectedTrackCount = (trackBindings?.sections.length ?? 0) + (trackBindings?.access.length ?? 0);
    if (expectedTrackCount > 0 && trackOrder.length < expectedTrackCount) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (autoViewportAppliedForKeyRef.current === viewportKey) {
        return;
      }

      if (zoomToCanyonBounds()) {
        autoViewportAppliedForKeyRef.current = viewportKey;
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    mapReadyVersion,
    trackBindings?.access.length,
    trackBindings?.canyonFilePath,
    trackBindings?.sections.length,
    trackOrder,
    viewMode,
    zoomToCanyonBounds,
  ]);

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) {
      return;
    }

    const observer = new ResizeObserver(() => {
      mapRef.current?.resize();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const redrawTracks = (): void => {
      drawTracks(buildTracksFeatureCollectionSnapshot());
    };

    map.once("style.load", redrawTracks);
    map.once("idle", redrawTracks);
    map.setStyle(MAP_STYLE_BY_MODE[mapStyleMode]);

    return () => {
      map.off("style.load", redrawTracks);
      map.off("idle", redrawTracks);
    };
  }, [buildTracksFeatureCollectionSnapshot, drawTracks, mapStyleMode]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const onWindowPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) {
        return;
      }

      setContextMenu(null);
      setActiveSubmenu(null);
    };

    window.addEventListener("pointerdown", onWindowPointerDown);

    return () => {
      window.removeEventListener("pointerdown", onWindowPointerDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!isManualCoordinateMenuOpen) {
      return;
    }

    const onWindowPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (target && manualCoordinateMenuRef.current?.contains(target)) {
        return;
      }

      setIsManualCoordinateMenuOpen(false);
    };

    window.addEventListener("pointerdown", onWindowPointerDown);

    return () => {
      window.removeEventListener("pointerdown", onWindowPointerDown);
    };
  }, [isManualCoordinateMenuOpen]);

  useEffect(() => {
    drawTracks(buildTracksFeatureCollectionSnapshot());
  }, [
    activeTrackId,
    buildTracksFeatureCollectionSnapshot,
    drawTracks,
    mapReadyVersion,
    routeFeature,
    trackOrder,
    tracksById,
    viewMode,
  ]);

  useEffect(() => {
    const selectedTrack = activeTrackId ? tracksById[activeTrackId] ?? null : null;
    if (!selectedTrack || !selectedTrack.needsRebuild) {
      return;
    }

    if (routePoints.length < 2) {
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
      setRouteFeature(null);
      return;
    }

    void generateRoute(selectedTrack.id, routePoints);
  }, [activeTrackId, generateRoute, routePoints, tracksById]);

  useEffect(() => {
    routeAbortControllerRef.current?.abort();
    routeAbortControllerRef.current = null;
  }, [activeTrackId]);

  useEffect(() => {
    return () => {
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
    };
  }, []);

  const applyRoutePointUpdate = useCallback(
    (updater: (current: RoutePoint[]) => RoutePoint[], nextStatusText: string): void => {
      const selectedTrackId = activeTrackIdRef.current;
      if (!selectedTrackId) {
        setStatusText("Select a track first.");
        return;
      }

      const currentPoints = routePointsRef.current;
      const nextPoints = normalizeRoutePoints(updater(currentPoints));
      if (areRoutePointsEqual(currentPoints, nextPoints)) {
        return;
      }

      setRoutePoints(nextPoints);
      setTracksById((current) => {
        const track = current[selectedTrackId];
        if (!track) {
          return current;
        }

        return {
          ...current,
          [selectedTrackId]: {
            ...track,
            routePoints: nextPoints,
            needsRebuild: true,
            missingFile: false,
          },
        };
      });
      setStatusText(nextStatusText);
    },
    [],
  );

  const onDeletePoint = useCallback(
    (id: string): void => {
      const points = routePointsRef.current;
      const pointToDelete = points.find((point) => point.id === id);
      if (!pointToDelete) {
        setStatusText("Point no longer exists.");
        return;
      }

      applyRoutePointUpdate((current) => current.filter((point) => point.id !== id), "Point deleted.");
    },
    [applyRoutePointUpdate],
  );

  const onSegmentModeChange = useCallback((id: string, mode: SegmentMode): void => {
    applyRoutePointUpdate(
      (current) =>
        current.map((point, index) => {
          if (index === 0 || point.id !== id) {
            return point;
          }

          if ((point.segmentMode ?? "straight") === mode) {
            return point;
          }

          return {
            ...point,
            segmentMode: mode,
          };
        }),
      mode === "route" ? "Segment mode set to along road." : "Segment mode set to straight line.",
    );
  }, [applyRoutePointUpdate]);

  const openSegmentModePopup = useCallback((pointId: string): void => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const points = routePointsRef.current;
    const pointIndex = points.findIndex((point) => point.id === pointId);
    if (pointIndex < 0) {
      setStatusText("Point no longer exists.");
      return;
    }

    const point = points[pointIndex];
    if (!point) {
      return;
    }

    segmentModePopupRef.current?.remove();
    segmentModePopupRef.current = null;

    const container = document.createElement("div");
    container.className = "segment-mode-popup";

    if (pointIndex > 0) {
      const select = document.createElement("select");
      select.className = "segment-mode-popup-select";
      select.innerHTML = `
        <option value="straight">Straight line</option>
        <option value="route">Along road</option>
      `;
      select.value = point.segmentMode ?? "straight";
      container.append(select);
      select.addEventListener("change", () => {
        onSegmentModeChange(pointId, select.value as SegmentMode);
        popup.remove();
      });
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "segment-mode-popup-remove";
    removeButton.textContent = "Remove";
    removeButton.setAttribute("aria-label", "Remove point");
    container.append(removeButton);

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: true,
      offset: 18,
    })
      .setLngLat(point.coordinates)
      .setDOMContent(container)
      .addTo(map);

    removeButton.addEventListener("click", () => {
      onDeletePoint(pointId);
      popup.remove();
    });

    popup.on("close", () => {
      if (segmentModePopupRef.current === popup) {
        segmentModePopupRef.current = null;
      }
    });

    segmentModePopupRef.current = popup;
  }, [onDeletePoint, onSegmentModeChange]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    try {
      segmentModePopupRef.current?.remove();
      segmentModePopupRef.current = null;

      const routePointIds = new Set(routePoints.map((point) => point.id));
      for (const [markerId, markerEntry] of pointMarkersRef.current) {
        if (routePointIds.has(markerId)) {
          continue;
        }

        markerEntry.marker.remove();
        pointMarkersRef.current.delete(markerId);
      }

      routePoints.forEach((point, index) => {
        const existingMarkerEntry = pointMarkersRef.current.get(point.id);
        if (existingMarkerEntry) {
          existingMarkerEntry.marker.setLngLat(point.coordinates);
          syncRoutePointMarkerElement(existingMarkerEntry.element, existingMarkerEntry.label, point, index);
          return;
        }

        const { element, label } = createRoutePointMarkerElement(point, index);
        const marker = new mapboxgl.Marker({ element, anchor: "bottom", draggable: true })
          .setLngLat(point.coordinates)
          .addTo(map);

        element.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (Date.now() < suppressMapMenuUntilRef.current) {
            return;
          }
          openSegmentModePopup(point.id);
        });

        marker.on("dragstart", () => {
          suppressMapMenuUntilRef.current = Date.now() + 350;
          closeAllMenus();
        });

        marker.on("dragend", () => {
          suppressMapMenuUntilRef.current = Date.now() + 350;
          const lngLat = marker.getLngLat();
          const coordinate: Coordinate = [
            Number(lngLat.lng.toFixed(6)),
            Number(lngLat.lat.toFixed(6)),
          ];

          applyRoutePointUpdate(
            (current) =>
              current.map((currentPoint) =>
                currentPoint.id === point.id
                  ? { ...currentPoint, coordinates: coordinate }
                  : currentPoint,
              ),
            "Point moved.",
          );
        });

        pointMarkersRef.current.set(point.id, { marker, element, label });
      });
    } catch (error) {
      setStatusText(`Map marker error: ${formatError(error)}`);
      console.error("Failed to update map markers:", error);
    }
  }, [applyRoutePointUpdate, closeAllMenus, openSegmentModePopup, routePoints]);

  const setBoundaryPointAtCoordinate = useCallback((target: "start" | "end", coordinate: Coordinate): void => {
    const current = routePointsRef.current;
    let next: RoutePoint[];

    if (target === "start") {
      if (current.length === 0) {
        next = [
          {
            id: createRoutePointId(),
            type: "start",
            coordinates: coordinate,
          },
        ];
      } else if (current.length === 1 && current[0].type === "end") {
        next = [
          {
            id: createRoutePointId(),
            type: "start",
            coordinates: coordinate,
          },
          current[0],
        ];
      } else {
        next = [...current];
        next[0] = { ...next[0], coordinates: coordinate };
      }
    } else if (current.length === 0) {
      next = [
        {
          id: createRoutePointId(),
          type: "end",
          coordinates: coordinate,
        },
      ];
    } else if (current.length === 1 && current[0].type === "start") {
      next = [
        ...current,
        {
          id: createRoutePointId(),
          type: "end",
          coordinates: coordinate,
        },
      ];
    } else if (current.length === 1 && current[0].type === "end") {
      next = [{ ...current[0], coordinates: coordinate }];
    } else {
      next = [...current];
      const lastIndex = next.length - 1;
      next[lastIndex] = { ...next[lastIndex], coordinates: coordinate };
    }

    const normalizedNext = normalizeRoutePoints(next);

    applyRoutePointUpdate(
      () => normalizedNext,
      target === "start" ? "Start point set." : "End point set.",
    );
  }, [applyRoutePointUpdate]);

  const insertPointAt = useCallback((insertionIndex: number, coordinate: Coordinate): boolean => {
    if (!activeTrackIdRef.current) {
      setStatusText("Select a track first.");
      return false;
    }

    const safeInsertionIndex = Math.min(Math.max(insertionIndex, 0), routePoints.length);
    const previousPoint = routePoints[safeInsertionIndex - 1];
    const nextPoint = routePoints[safeInsertionIndex];
    const inheritedSegmentMode = getInsertedPointSegmentMode(routePoints, safeInsertionIndex);

    if (
      (previousPoint && isSameCoordinate(previousPoint.coordinates, coordinate)) ||
      (nextPoint && isSameCoordinate(nextPoint.coordinates, coordinate))
    ) {
      setStatusText("Cannot insert duplicate consecutive points.");
      return false;
    }

    const next = [...routePoints];
    next.splice(safeInsertionIndex, 0, {
      id: createRoutePointId(),
      type: "waypoint",
      coordinates: coordinate,
      segmentMode: inheritedSegmentMode,
    });

    if (safeInsertionIndex === 0 && next.length > 1) {
      const shiftedStart = next[1];
      if (shiftedStart) {
        next[1] = {
          ...shiftedStart,
          segmentMode: inheritedSegmentMode,
        };
      }
    }

    setRoutePoints(normalizeRoutePoints(next));
    setStatusText("Point inserted.");
    return true;
  }, [routePoints]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (
        target &&
        (target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT")
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key !== "s" && key !== "e") {
        return;
      }

      const coordinate = mapPointerCoordinateRef.current;
      if (!coordinate) {
        setStatusText("Move the mouse over the map to set a boundary point.");
        return;
      }

      event.preventDefault();

      const boundaryPoints = routePointsRef.current;
      const hasStartPoint = boundaryPoints.some((point) => point.type === "start");
      const hasEndPoint = boundaryPoints.some((point) => point.type === "end");
      if (hasStartPoint && hasEndPoint) {
        const insertionIndex = key === "s" ? 0 : boundaryPoints.length;
        insertPointAt(insertionIndex, coordinate);
        return;
      }

      if (key === "s") {
        setBoundaryPointAtCoordinate("start", coordinate);
        return;
      }

      setBoundaryPointAtCoordinate("end", coordinate);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [insertPointAt, setBoundaryPointAtCoordinate]);

  const onSetBoundaryPointFromContextMenu = useCallback(
    (target: "start" | "end"): void => {
      if (!contextMenu) {
        return;
      }

      if (!mapRef.current) {
        setContextMenu(null);
        setActiveSubmenu(null);
        setStatusText("Map is not ready yet.");
        return;
      }

      const coordinate = contextMenu.coordinate;
      setBoundaryPointAtCoordinate(target, coordinate);

      setContextMenu(null);
      setActiveSubmenu(null);
    },
    [contextMenu, setBoundaryPointAtCoordinate],
  );

  const onInsertPointAtIndex = useCallback(
    (insertionIndex: number): void => {
      if (!contextMenu) {
        return;
      }

      if (!mapRef.current) {
        setContextMenu(null);
        setActiveSubmenu(null);
        setStatusText("Map is not ready yet.");
        return;
      }

      const coordinate = contextMenu.coordinate;
      insertPointAt(insertionIndex, coordinate);

      setContextMenu(null);
      setActiveSubmenu(null);
    },
    [contextMenu, insertPointAt],
  );

  const onAddPointOfInterestFromContextMenu = useCallback((): void => {
    if (!contextMenu) {
      return;
    }

    if (!onPointsOfInterestChange) {
      setContextMenu(null);
      setActiveSubmenu(null);
      setStatusText("Points of interest cannot be edited right now.");
      return;
    }

    const nextPoi: PointOfInterest = {
      coordinates: contextMenu.coordinate,
      name: createEmptyLocalizedText(),
      description: createEmptyLocalizedText(),
    };
    const next = [...pointsOfInterest, nextPoi];
    onPointsOfInterestChange(next);
    deactivateTrackEditing();
    setContextMenu(null);
    setActiveSubmenu(null);
    setPoiPasteModal(null);
    setParkingEditor(null);
    setParkingPasteModal(null);
    setPoiEditor({
      index: next.length - 1,
      language: effectiveDefaultLanguage,
    });
    setStatusText("Point of interest added.");
  }, [contextMenu, deactivateTrackEditing, effectiveDefaultLanguage, onPointsOfInterestChange, pointsOfInterest]);

  const onPoiLanguageChange = useCallback((language: string): void => {
    if (!poiEditor || !STATIC_LANGUAGE_SET.has(language)) {
      return;
    }

    setPoiEditor((current) =>
      current
        ? {
            ...current,
            language,
          }
        : current,
    );
  }, [poiEditor]);

  const onPoiTextChange = useCallback(
    (poiIndex: number, field: "name" | "description", language: string, nextValue: string): void => {
      if (!onPointsOfInterestChange || !STATIC_LANGUAGE_SET.has(language)) {
        return;
      }

      if (poiIndex < 0 || poiIndex >= pointsOfInterest.length) {
        return;
      }

      const next = pointsOfInterest.map((poi, index) => {
        if (index !== poiIndex) {
          return poi;
        }

        const nextFieldValue = normalizeLocalizedText(poi[field]);
        nextFieldValue[language] = nextValue;

        return {
          ...poi,
          [field]: nextFieldValue,
        };
      });

      onPointsOfInterestChange(next);
    },
    [onPointsOfInterestChange, pointsOfInterest],
  );

  const onDeletePointOfInterest = useCallback((poiIndex: number): void => {
    if (!onPointsOfInterestChange) {
      return;
    }

    if (poiIndex < 0 || poiIndex >= pointsOfInterest.length) {
      return;
    }

    const next = pointsOfInterest.filter((_, index) => index !== poiIndex);
    onPointsOfInterestChange(next);
    setPoiEditor(null);
    setPoiPasteModal(null);
    setStatusText("Point of interest removed.");
  }, [onPointsOfInterestChange, pointsOfInterest]);

  const openPoiPasteModal = useCallback(
    (field: "name" | "description"): void => {
      if (!poiEditor) {
        return;
      }

      const poi = pointsOfInterest[poiEditor.index];
      if (!poi) {
        return;
      }

      setPoiPasteModal({
        poiIndex: poiEditor.index,
        field,
        draft: "",
        error: "",
      });
    },
    [poiEditor, pointsOfInterest],
  );

  const closePoiPasteModal = useCallback((): void => {
    setPoiPasteModal(null);
  }, []);

  const onApplyPoiPaste = useCallback((): void => {
    if (!poiPasteModal) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(poiPasteModal.draft);
    } catch {
      setPoiPasteModal((current) =>
        current
          ? {
              ...current,
              error: "Invalid JSON format.",
            }
          : current,
      );
      return;
    }

    const validation = parseLocalizedTextPastePayload(parsed);
    if (!validation.value || validation.error) {
      setPoiPasteModal((current) =>
        current
          ? {
              ...current,
              error: validation.error ?? "Invalid language JSON payload.",
            }
          : current,
      );
      return;
    }

    if (!onPointsOfInterestChange) {
      setPoiPasteModal(null);
      return;
    }

    if (poiPasteModal.poiIndex < 0 || poiPasteModal.poiIndex >= pointsOfInterest.length) {
      setPoiPasteModal(null);
      return;
    }

    const next = pointsOfInterest.map((poi, index) => {
      if (index !== poiPasteModal.poiIndex) {
        return poi;
      }

      return {
        ...poi,
        [poiPasteModal.field]: validation.value!,
      };
    });

    onPointsOfInterestChange(next);
    setPoiPasteModal(null);
  }, [onPointsOfInterestChange, pointsOfInterest, poiPasteModal]);

  const onAddParkingLotFromContextMenu = useCallback((): void => {
    if (!contextMenu) {
      return;
    }

    if (!onParkingLotsChange) {
      setContextMenu(null);
      setActiveSubmenu(null);
      setStatusText("Parking lots cannot be edited right now.");
      return;
    }

    const nextParkingLot: ParkingLot = {
      coordinates: contextMenu.coordinate,
      name: createEmptyLocalizedText(),
    };
    const next = [...parkingLots, nextParkingLot];
    onParkingLotsChange(next);
    deactivateTrackEditing();
    setContextMenu(null);
    setActiveSubmenu(null);
    setPoiEditor(null);
    setPoiPasteModal(null);
    setParkingPasteModal(null);
    setParkingEditor({
      index: next.length - 1,
      language: effectiveDefaultLanguage,
    });
    setStatusText("Parking lot added.");
  }, [contextMenu, deactivateTrackEditing, effectiveDefaultLanguage, onParkingLotsChange, parkingLots]);

  const onParkingLanguageChange = useCallback((language: string): void => {
    if (!parkingEditor || !STATIC_LANGUAGE_SET.has(language)) {
      return;
    }

    setParkingEditor((current) =>
      current
        ? {
            ...current,
            language,
          }
        : current,
    );
  }, [parkingEditor]);

  const onParkingNameChange = useCallback(
    (parkingLotIndex: number, language: string, nextValue: string): void => {
      if (!onParkingLotsChange || !STATIC_LANGUAGE_SET.has(language)) {
        return;
      }

      if (parkingLotIndex < 0 || parkingLotIndex >= parkingLots.length) {
        return;
      }

      const next = parkingLots.map((parkingLot, index) => {
        if (index !== parkingLotIndex) {
          return parkingLot;
        }

        const nextName = normalizeLocalizedText(parkingLot.name);
        nextName[language] = nextValue;

        return {
          ...parkingLot,
          name: nextName,
        };
      });

      onParkingLotsChange(next);
    },
    [onParkingLotsChange, parkingLots],
  );

  const onDeleteParkingLot = useCallback((parkingLotIndex: number): void => {
    if (!onParkingLotsChange) {
      return;
    }

    if (parkingLotIndex < 0 || parkingLotIndex >= parkingLots.length) {
      return;
    }

    const next = parkingLots.filter((_, index) => index !== parkingLotIndex);
    onParkingLotsChange(next);
    setParkingEditor(null);
    setParkingPasteModal(null);
    setStatusText("Parking lot removed.");
  }, [onParkingLotsChange, parkingLots]);

  const onApplyParkingNamePreset = useCallback(
    (parkingLotIndex: number, preset: LocalizedText): void => {
      if (!onParkingLotsChange) {
        return;
      }

      if (parkingLotIndex < 0 || parkingLotIndex >= parkingLots.length) {
        return;
      }

      const next = parkingLots.map((parkingLot, index) => {
        if (index !== parkingLotIndex) {
          return parkingLot;
        }

        return {
          ...parkingLot,
          name: normalizeLocalizedText(preset),
        };
      });

      onParkingLotsChange(next);
    },
    [onParkingLotsChange, parkingLots],
  );

  const openParkingPasteModal = useCallback((): void => {
    if (!parkingEditor) {
      return;
    }

    const parkingLot = parkingLots[parkingEditor.index];
    if (!parkingLot) {
      return;
    }

    setParkingPasteModal({
      parkingLotIndex: parkingEditor.index,
      draft: "",
      error: "",
    });
  }, [parkingEditor, parkingLots]);

  const closeParkingPasteModal = useCallback((): void => {
    setParkingPasteModal(null);
  }, []);

  const onApplyParkingPaste = useCallback((): void => {
    if (!parkingPasteModal) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(parkingPasteModal.draft);
    } catch {
      setParkingPasteModal((current) =>
        current
          ? {
              ...current,
              error: "Invalid JSON format.",
            }
          : current,
      );
      return;
    }

    const validation = parseLocalizedTextPastePayload(parsed);
    if (!validation.value || validation.error) {
      setParkingPasteModal((current) =>
        current
          ? {
              ...current,
              error: validation.error ?? "Invalid language JSON payload.",
            }
          : current,
      );
      return;
    }

    if (!onParkingLotsChange) {
      setParkingPasteModal(null);
      return;
    }

    if (parkingPasteModal.parkingLotIndex < 0 || parkingPasteModal.parkingLotIndex >= parkingLots.length) {
      setParkingPasteModal(null);
      return;
    }

    const next = parkingLots.map((parkingLot, index) => {
      if (index !== parkingPasteModal.parkingLotIndex) {
        return parkingLot;
      }

      return {
        ...parkingLot,
        name: validation.value!,
      };
    });

    onParkingLotsChange(next);
    setParkingPasteModal(null);
  }, [onParkingLotsChange, parkingLots, parkingPasteModal]);

  const onSetOverviewCoordinateFromContextMenu = useCallback((): void => {
    if (!contextMenu) {
      return;
    }

    if (!mapRef.current) {
      setContextMenu(null);
      setActiveSubmenu(null);
      setStatusText("Map is not ready yet.");
      return;
    }

    if (!onSetOverviewCoordinate) {
      setContextMenu(null);
      setActiveSubmenu(null);
      setStatusText("Overview point cannot be set right now.");
      return;
    }

    deactivateTrackEditing();
    onSetOverviewCoordinate(contextMenu.coordinate);
    setContextMenu(null);
    setActiveSubmenu(null);
    setStatusText("Canyon overview point set.");
  }, [contextMenu, deactivateTrackEditing, onSetOverviewCoordinate]);

  const onSelectTrack = useCallback((trackId: string): void => {
    const track = tracksByIdRef.current[trackId];
    if (!track) {
      return;
    }

    closeAllMenus();
    setActiveTrackId(trackId);
    setStatusText(`Active track: ${track.displayName}`);
  }, [closeAllMenus]);

  const onCreateAccessTrack = useCallback((): void => {
    const nextCounter = newAccessTrackCounterRef.current + 1;
    newAccessTrackCounterRef.current = nextCounter;
    const trackId = `access:new:${nextCounter}`;
    const accessCount = Object.values(tracksByIdRef.current).filter((track) => track.kind === "access").length;

    const nextTrack: MultiTrackItem = {
      id: trackId,
      kind: "access",
      displayName: `Access ${accessCount + 1}`,
      filePath: "",
      color: "black",
      routePoints: [],
      routeFeature: null,
      missingFile: false,
      legacyFormat: false,
      needsRebuild: false,
    };

    setTracksById((current) => ({
      ...current,
      [trackId]: nextTrack,
    }));
    setTrackOrder((current) => [...current, trackId]);
    setActiveTrackId(trackId);
    setStatusText("Access track added.");
  }, []);

  const onAccessTrackNameChange = useCallback((trackId: string, nextName: string): void => {
    setTracksById((current) => {
      const currentTrack = current[trackId];
      if (!currentTrack || currentTrack.kind !== "access" || currentTrack.displayName === nextName) {
        return current;
      }

      return {
        ...current,
        [trackId]: {
          ...currentTrack,
          displayName: nextName,
        },
      };
    });
  }, []);

  const onDeleteAccessTrack = useCallback((trackId: string): void => {
    const track = tracksByIdRef.current[trackId];
    if (!track || track.kind !== "access") {
      return;
    }

    closeAllMenus();
    setAccessDeleteModal({
      trackId,
      displayName: track.displayName || trackId,
    });
  }, [closeAllMenus]);

  const onCancelDeleteAccessTrack = useCallback((): void => {
    setAccessDeleteModal(null);
  }, []);

  const onConfirmDeleteAccessTrack = useCallback((): void => {
    if (!accessDeleteModal) {
      return;
    }

    const trackId = accessDeleteModal.trackId;
    setAccessDeleteModal(null);

    closeAllMenus();
    setTracksById((current) => {
      if (!(trackId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[trackId];
      return next;
    });
    setTrackOrder((current) => current.filter((entry) => entry !== trackId));
    setActiveTrackId((current) => {
      if (current !== trackId) {
        return current;
      }

      const remainingOrder = trackOrderRef.current.filter((entry) => entry !== trackId);
      const nextSectionTrack = remainingOrder.find((entry) => tracksByIdRef.current[entry]?.kind === "section");
      return nextSectionTrack ?? remainingOrder[0] ?? null;
    });
    setStatusText("Access track deleted.");
  }, [accessDeleteModal, closeAllMenus, setStatusText]);

  const onDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event;
      if (!over || active.id === over.id) {
        return;
      }

      applyRoutePointUpdate((current) => {
        const oldIndex = current.findIndex((point) => point.id === String(active.id));
        const newIndex = current.findIndex((point) => point.id === String(over.id));

        if (oldIndex < 0 || newIndex < 0) {
          return current;
        }

        return arrayMove(current, oldIndex, newIndex);
      }, "Points reordered.");
    },
    [applyRoutePointUpdate],
  );

  const onInvertRouteDirection = useCallback((): void => {
    applyRoutePointUpdate(
      (current) => {
        if (current.length < 2) {
          return current;
        }

        const reversedPoints = current
          .slice()
          .reverse()
          .map((point) => ({ ...point }));
        const reversedSegmentModes = current
          .slice(1)
          .map((point) => point.segmentMode ?? "straight")
          .reverse();

        for (let index = 1; index < reversedPoints.length; index += 1) {
          reversedPoints[index] = {
            ...reversedPoints[index],
            segmentMode: reversedSegmentModes[index - 1] ?? "straight",
          };
        }

        return reversedPoints;
      },
      "Route direction inverted.",
    );
  }, [applyRoutePointUpdate]);

  const onClear = useCallback((): void => {
    const selectedTrackId = activeTrackIdRef.current;
    if (!selectedTrackId) {
      setStatusText("Select a track first.");
      return;
    }

    const track = tracksByIdRef.current[selectedTrackId];
    if (!track) {
      setStatusText("Track not found.");
      return;
    }

    closeAllMenus();
    setClearTrackModal({
      trackId: selectedTrackId,
      displayName: track.displayName || selectedTrackId,
    });
  }, [closeAllMenus, setStatusText]);

  const onCancelClearTrack = useCallback((): void => {
    setClearTrackModal(null);
  }, []);

  const onConfirmClearTrack = useCallback((): void => {
    if (!clearTrackModal) {
      return;
    }

    const selectedTrackId = clearTrackModal.trackId;
    setClearTrackModal(null);

    routeAbortControllerRef.current?.abort();
    routeAbortControllerRef.current = null;
    segmentModePopupRef.current?.remove();
    segmentModePopupRef.current = null;

    setRoutePoints([]);
    setRouteFeature(null);
    setTracksById((current) => {
      const track = current[selectedTrackId];
      if (!track) {
        return current;
      }

      return {
        ...current,
        [selectedTrackId]: {
          ...track,
          routePoints: [],
          routeFeature: null,
          missingFile: false,
          needsRebuild: false,
        },
      };
    });
    setContextMenu(null);
    setActiveSubmenu(null);
    setCoordinateInput("");
    setCoordinateInputError("");
    setManualCoordinateActionKey("");
    setStatusText("Track cleared.");
  }, [clearTrackModal, setStatusText]);

  const routeSummary = useMemo(() => {
    if (!routeFeature) {
      return null;
    }

    const elevationGainFromProperties = Number(routeFeature.properties.elevation_gain_m);
    const elevationGainM = Number.isFinite(elevationGainFromProperties)
      ? Math.max(0, Math.round(elevationGainFromProperties))
      : Math.max(
        0,
        Math.round(
          routeFeature.properties.segments.reduce((sum, segment) => {
            const segmentGain = Number(segment.elevation_gain_m);
            return Number.isFinite(segmentGain) && segmentGain > 0 ? sum + segmentGain : sum;
          }, 0),
        ),
      );

    return {
      distanceKm: (routeFeature.properties.distance_m / 1000).toFixed(2),
      elevationGainM,
      durationMin: Math.round(routeFeature.properties.duration_s / 60),
    };
  }, [routeFeature]);

  const sortableIds = useMemo(() => routePoints.map((point) => point.id), [routePoints]);
  const hasStartAndEnd = useMemo(
    () => hasTrackBoundaryPoints(routePoints),
    [routePoints],
  );
  const setMenuOptions = useMemo<
    Array<{ key: string; label: string; target: "start" | "end" }>
  >(
    () => [
      { key: "set-start", label: "Start", target: "start" },
      { key: "set-end", label: "End", target: "end" },
    ],
    [],
  );

  const insertMenuOptions = useMemo<InsertMenuOption[]>(() => {
    const options: InsertMenuOption[] = [
      createInsertMenuOption(routePoints, "before-start", "before Start", 0),
      createInsertMenuOption(routePoints, "after-start", "after Start", 1),
    ];

    for (let index = 1; index < routePoints.length - 1; index += 1) {
      if (routePoints[index].type === "waypoint") {
        options.push(
          createInsertMenuOption(
            routePoints,
            `after-${routePoints[index].id}`,
            `after Waypoint ${index}`,
            index + 1,
          ),
        );
      }
    }

    if (routePoints.length > 1) {
      options.push(createInsertMenuOption(routePoints, "after-end", "after End", routePoints.length));
    }

    return options;
  }, [routePoints]);

  const manualCoordinateOptions = useMemo<ManualCoordinateActionOption[]>(() => {
    if (!activeTrackId) {
      return [];
    }

    if (!hasStartAndEnd) {
      return [
        {
          key: "manual-set-start",
          label: "Set as Start",
          mode: "boundary",
          target: "start",
          leftNeighbor: null,
          rightNeighbor: null,
        },
        {
          key: "manual-set-end",
          label: "Set as End",
          mode: "boundary",
          target: "end",
          leftNeighbor: null,
          rightNeighbor: null,
        },
      ];
    }

    return insertMenuOptions.map((option) => ({
      key: `manual-${option.key}`,
      label: option.label,
      mode: "insert" as const,
      insertionIndex: option.insertionIndex,
      leftNeighbor: option.leftNeighbor,
      rightNeighbor: option.rightNeighbor,
    }));
  }, [activeTrackId, hasStartAndEnd, insertMenuOptions]);

  useEffect(() => {
    if (manualCoordinateOptions.length === 0) {
      setManualCoordinateActionKey("");
      setIsManualCoordinateMenuOpen(false);
      return;
    }

    if (manualCoordinateOptions.some((option) => option.key === manualCoordinateActionKey)) {
      return;
    }

    setManualCoordinateActionKey(manualCoordinateOptions[0].key);
  }, [manualCoordinateActionKey, manualCoordinateOptions]);

  const selectedManualCoordinateOption = useMemo(
    () =>
      manualCoordinateOptions.find((option) => option.key === manualCoordinateActionKey) ??
      manualCoordinateOptions[0] ??
      null,
    [manualCoordinateActionKey, manualCoordinateOptions],
  );
  const coordinateActionVerb = hasStartAndEnd ? "Insert" : "Set";

  const onInsertCoordinateFromInput = useCallback((): void => {
    if (!mapRef.current) {
      setStatusText("Map is not ready yet.");
      return;
    }

    if (!activeTrackIdRef.current) {
      setCoordinateInputError("Select a track first.");
      return;
    }

    const parsed = parseCoordinateInput(coordinateInput);
    if (!parsed.coordinate) {
      setCoordinateInputError(parsed.error);
      return;
    }

    const selectedAction =
      manualCoordinateOptions.find((option) => option.key === manualCoordinateActionKey) ??
      manualCoordinateOptions[0];

    if (!selectedAction) {
      setCoordinateInputError("No insertion option available.");
      return;
    }

    setCoordinateInputError("");
    setIsManualCoordinateMenuOpen(false);

    if (selectedAction.mode === "boundary") {
      setBoundaryPointAtCoordinate(selectedAction.target, parsed.coordinate);
      setCoordinateInput("");
      return;
    }

    const inserted = insertPointAt(selectedAction.insertionIndex, parsed.coordinate);
    if (!inserted) {
      setCoordinateInputError("Cannot insert duplicate consecutive points.");
      return;
    }

    setCoordinateInput("");
  }, [
    coordinateInput,
    insertPointAt,
    manualCoordinateActionKey,
    manualCoordinateOptions,
    setBoundaryPointAtCoordinate,
  ]);

  const canInsertCoordinate = coordinateInput.trim().length > 0 && manualCoordinateOptions.length > 0;
  const sectionTracks = useMemo(
    () =>
      trackOrder
        .map((trackId) => tracksById[trackId])
        .filter((track): track is MultiTrackItem => Boolean(track) && track.kind === "section"),
    [trackOrder, tracksById],
  );
  const accessTracks = useMemo(
    () =>
      trackOrder
        .map((trackId) => tracksById[trackId])
        .filter((track): track is MultiTrackItem => Boolean(track) && track.kind === "access"),
    [trackOrder, tracksById],
  );
  const onTrackPanelBackgroundClick = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.closest(".track-list-item")) {
      return;
    }

    if (target.closest("button, input, select, textarea, label")) {
      return;
    }

    deactivateTrackEditing();
  }, [deactivateTrackEditing]);
  const activePoiLanguage =
    poiEditor && STATIC_LANGUAGE_SET.has(poiEditor.language)
      ? poiEditor.language
      : effectiveDefaultLanguage;
  const activePoi =
    poiEditor && poiEditor.index >= 0 && poiEditor.index < pointsOfInterest.length
      ? pointsOfInterest[poiEditor.index]
      : null;
  const poiEditorPosition = useMemo(() => {
    if (!poiEditor || !activePoi) {
      return null;
    }

    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) {
      return null;
    }

    const projected = map.project(activePoi.coordinates);
    const popupWidth = 320;
    const margin = 12;
    const availableWidth = container.clientWidth;
    const availableHeight = container.clientHeight;

    const left = Math.min(
      Math.max(projected.x + 12, margin),
      Math.max(margin, availableWidth - popupWidth - margin),
    );
    const top = Math.min(
      Math.max(projected.y - 12, margin),
      Math.max(margin, availableHeight - 220),
    );

    return { left, top };
  }, [activePoi, poiEditor]);
  const activeParkingLanguage =
    parkingEditor && STATIC_LANGUAGE_SET.has(parkingEditor.language)
      ? parkingEditor.language
      : effectiveDefaultLanguage;
  const activeParkingLot =
    parkingEditor && parkingEditor.index >= 0 && parkingEditor.index < parkingLots.length
      ? parkingLots[parkingEditor.index]
      : null;
  const parkingEditorPosition = useMemo(() => {
    if (!parkingEditor || !activeParkingLot) {
      return null;
    }

    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) {
      return null;
    }

    const projected = map.project(activeParkingLot.coordinates);
    const popupWidth = 320;
    const margin = 12;
    const availableWidth = container.clientWidth;
    const availableHeight = container.clientHeight;

    const left = Math.min(
      Math.max(projected.x + 12, margin),
      Math.max(margin, availableWidth - popupWidth - margin),
    );
    const top = Math.min(
      Math.max(projected.y - 12, margin),
      Math.max(margin, availableHeight - 180),
    );

    return { left, top };
  }, [activeParkingLot, parkingEditor]);
  const renderManualCoordinateAction = (option: ManualCoordinateActionOption): JSX.Element => {
    if (option.mode === "boundary") {
      const targetType = option.target === "start" ? "start" : "end";
      return (
        <span className="coordinate-action-icon-boundary" aria-hidden="true">
          <span className={`map-menu-icon route ${targetType}`}>{option.target === "start" ? "S" : "E"}</span>
        </span>
      );
    }

    return (
      <span className="coordinate-action-icon-insert" aria-hidden="true">
        <span className="map-context-icon-sequence">
          {option.leftNeighbor ? (
            <span className={`map-menu-icon route map-menu-icon-muted ${option.leftNeighbor.type}`}>
              {option.leftNeighbor.label}
            </span>
          ) : (
            <span className="map-menu-icon route map-menu-icon-placeholder" />
          )}
          <span
            className={`map-context-icon-separator${
              option.leftNeighbor ? "" : " map-context-icon-separator-placeholder"
            }`}
          />
          <span className="map-menu-icon route waypoint">+</span>
          <span
            className={`map-context-icon-separator${
              option.rightNeighbor ? "" : " map-context-icon-separator-placeholder"
            }`}
          />
          {option.rightNeighbor ? (
            <span className={`map-menu-icon route map-menu-icon-muted ${option.rightNeighbor.type}`}>
              {option.rightNeighbor.label}
            </span>
          ) : (
            <span className="map-menu-icon route map-menu-icon-placeholder" />
          )}
        </span>
      </span>
    );
  };

  return (
    <div className="app-shell">
      <aside className="control-panel">
        <section className="track-list-panel" onClick={onTrackPanelBackgroundClick}>
          <div className="track-list-group">
            <p className="track-list-group-title">Section tracks</p>
            {sectionTracks.length === 0 ? (
              <p className="track-list-empty">No section tracks.</p>
            ) : (
              <ul className="track-list">
                {sectionTracks.map((track) => {
                  const pointsForWarnings = activeTrackId === track.id ? routePoints : track.routePoints;
                  const showWarning = track.missingFile || !hasTrackBoundaryPoints(pointsForWarnings);

                  return (
                    <li key={track.id} className={`track-list-item${activeTrackId === track.id ? " active" : ""}`}>
                      <button type="button" className="track-list-main" onClick={() => onSelectTrack(track.id)}>
                        <span className="track-list-name-wrap">
                          <span className={`track-kind-dot ${track.kind}`} aria-hidden="true" />
                          <span className="track-list-name">{track.displayName}</span>
                        </span>
                        <span className="track-list-flags">
                          {showWarning ? <span className="track-flag warning">!</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="track-list-group">
            <div className="track-list-group-header">
              <p className="track-list-group-title">Access tracks</p>
              <button type="button" className="track-add-access" onClick={onCreateAccessTrack}>
                Add Access track
              </button>
            </div>
            {accessTracks.length === 0 ? (
              <p className="track-list-empty">No access tracks.</p>
            ) : (
              <ul className="track-list track-list-access">
                {accessTracks.map((track) => {
                  const pointsForWarnings = activeTrackId === track.id ? routePoints : track.routePoints;
                  const showWarning = track.missingFile || !hasTrackBoundaryPoints(pointsForWarnings);

                  return (
                    <li key={track.id} className={`track-list-item${activeTrackId === track.id ? " active" : ""}`}>
                      <div className="track-list-main track-list-main-access" onClick={() => onSelectTrack(track.id)}>
                        <span className="track-list-name-wrap">
                          <span className={`track-kind-dot ${track.kind}`} aria-hidden="true" />
                          <input
                            type="text"
                            className="track-list-access-input"
                            value={track.displayName}
                            onFocus={() => onSelectTrack(track.id)}
                            onClick={() => onSelectTrack(track.id)}
                            onChange={(event) => onAccessTrackNameChange(track.id, event.target.value)}
                            aria-label={`Access track ${track.id} name`}
                          />
                        </span>
                        <span className="track-list-flags">
                          {showWarning ? <span className="track-flag warning">!</span> : null}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="track-list-delete track-list-delete-inline"
                        onClick={() => onDeleteAccessTrack(track.id)}
                        aria-label={`Delete access track ${track.displayName || track.id}`}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {showSecondaryPanels ? (
          <>
            <section className="route-summary">
              <p>
                <strong>Distance:</strong>
                {routeSummary ? ` ${routeSummary.distanceKm} km` : ""}
              </p>
              <p>
                <strong>Elevation gain:</strong>
                {routeSummary ? ` ${routeSummary.elevationGainM} m` : ""}
              </p>
              <p>
                <strong>Time:</strong>
                {routeSummary ? ` ${routeSummary.durationMin} min` : ""}
              </p>
            </section>

            <section className="coordinate-input-panel">
              <form
                className="coordinate-input-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onInsertCoordinateFromInput();
                }}
              >
                <input
                  type="text"
                  value={coordinateInput}
                  onChange={(event) => {
                    setCoordinateInput(event.target.value);
                    if (coordinateInputError) {
                      setCoordinateInputError("");
                    }
                  }}
                  placeholder="9.1951612, 48.2951951"
                  aria-label="Coordinate input"
                />
                <div className="coordinate-input-actions">
                  <div className="coordinate-action-menu" ref={manualCoordinateMenuRef}>
                    <button
                      type="button"
                      className="coordinate-action-trigger"
                      disabled={manualCoordinateOptions.length === 0}
                      aria-label={`${coordinateActionVerb} position`}
                      onClick={() => {
                        if (manualCoordinateOptions.length === 0) {
                          return;
                        }
                        setIsManualCoordinateMenuOpen((current) => !current);
                      }}
                    >
                      <span className="coordinate-action-preview">
                        {selectedManualCoordinateOption ? (
                          renderManualCoordinateAction(selectedManualCoordinateOption)
                        ) : (
                          <span className="coordinate-action-placeholder">-</span>
                        )}
                      </span>
                      <span className="coordinate-action-trigger-caret" aria-hidden="true">
                        {"\u25BC"}
                      </span>
                    </button>
                    {isManualCoordinateMenuOpen ? (
                      <div className="coordinate-action-dropdown" role="listbox" aria-label={`${coordinateActionVerb} point`}>
                        {manualCoordinateOptions.map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            className={`coordinate-action-option${
                              selectedManualCoordinateOption?.key === option.key ? " active" : ""
                            }`}
                            aria-label={option.label}
                            onClick={() => {
                              setManualCoordinateActionKey(option.key);
                              setIsManualCoordinateMenuOpen(false);
                            }}
                          >
                            {renderManualCoordinateAction(option)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <button type="submit" className="coordinate-insert-submit" disabled={!canInsertCoordinate}>
                    {coordinateActionVerb}
                  </button>
                </div>
              </form>
              {coordinateInputError ? <p className="coordinate-input-error">{coordinateInputError}</p> : null}
            </section>

            <section className="route-points-panel">
              <div className="route-points-header">
                <div className="route-points-header-actions">
                  <button
                    type="button"
                    className="route-points-invert"
                    onClick={onInvertRouteDirection}
                    disabled={routePoints.length < 2}
                  >
                    <svg className="route-points-invert-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 7h11" />
                      <path d="m13 4 4 3-4 3" />
                      <path d="M18 17H7" />
                      <path d="m11 14-4 3 4 3" />
                    </svg>
                    <span>Invert direction</span>
                  </button>
                  <button
                    type="button"
                    className="route-points-clear"
                    onClick={onClear}
                    disabled={!activeTrack || routePoints.length === 0}
                  >
                    <svg className="route-points-clear-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 7h14" />
                      <path d="M10 7V5h4v2" />
                      <path d="M8 7l1 12h6l1-12" />
                    </svg>
                    Clear all points
                  </button>
                </div>
              </div>
              {!activeTrack ? (
                <p className="route-points-empty">Select a track to edit.</p>
              ) : routePoints.length === 0 ? (
                <p className="route-points-empty">No points yet.</p>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                    <ul className="route-point-list">
                      {routePoints.map((point, index) => (
                        <RoutePointListItem
                          key={point.id}
                          point={point}
                          index={index}
                          label={getRoutePointLabel(routePoints, index)}
                          onDelete={onDeletePoint}
                          onSegmentModeChange={onSegmentModeChange}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </section>
          </>
        ) : null}
      </aside>

      <main className={`map-area ${viewMode}`} onContextMenu={(event) => event.preventDefault()}>
        <div ref={mapContainerRef} className="map-container" />
        {viewMode === "expanded" ? (
          <div className="map-search-overlay">
          <form className="map-search-form" onSubmit={onSubmitLocationSearch}>
            <button
              type="submit"
              className="map-search-submit"
              aria-label="Search location"
              disabled={isSearching}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6" />
                <path d="m16 16 5 5" />
              </svg>
            </button>
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                if (searchErrorMessage) {
                  setSearchErrorMessage("");
                }
              }}
              placeholder="Search location ..."
              aria-label="Search location"
            />
            <button
              type="button"
              className="map-search-clear"
              onClick={onClearLocationSearch}
              aria-label="Clear search"
              disabled={!searchQuery && !searchErrorMessage}
            >
              &times;
            </button>
          </form>
          {searchErrorMessage ? <p className="map-search-feedback">{searchErrorMessage}</p> : null}
          </div>
        ) : null}
        {viewMode === "expanded" ? (
          <>
            <button
              type="button"
              className="map-style-toggle"
              onClick={onToggleMapStyle}
              aria-label={
                mapStyleMode === "satellite"
                  ? "Switch map style to outdoors"
                  : "Switch map style to standard satellite"
              }
              title={
                mapStyleMode === "satellite"
                  ? "Switch to Outdoors"
                  : "Switch to Standard Satellite"
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 3 7.5 12 12l9-4.5L12 3Z" />
                <path d="M3 11.5 12 16l9-4.5" />
                <path d="M3 15.5 12 20l9-4.5" />
              </svg>
            </button>
            <button
              type="button"
              className="map-fit-toggle"
              onClick={onZoomToEntireCanyon}
              aria-label="Zoom to entire canyon"
              title="Zoom to entire canyon"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 9V4h5" />
                <path d="M15 4h5v5" />
                <path d="M20 15v5h-5" />
                <path d="M9 20H4v-5" />
              </svg>
            </button>
          </>
        ) : null}

        {contextMenu ? (
          <div className="map-context-menu-layer">
            <div
              ref={contextMenuRef}
              className="map-context-menu"
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              role="menu"
              aria-label="Map click menu"
            >
              <button type="button" onClick={onAddParkingLotFromContextMenu}>
                <span className="map-context-menu-item map-context-menu-item-main">
                  <span className="map-menu-icon parking" aria-hidden="true">
                    P
                  </span>
                  <span className="map-context-menu-item-label">Add parking lot</span>
                </span>
              </button>
              <button type="button" onClick={onAddPointOfInterestFromContextMenu}>
                <span className="map-context-menu-item map-context-menu-item-main">
                  <span className="map-menu-icon poi" aria-hidden="true">
                    POI
                  </span>
                  <span className="map-context-menu-item-label">Add point of interest</span>
                </span>
              </button>
              <button type="button" onClick={onSetOverviewCoordinateFromContextMenu}>
                <span className="map-context-menu-item map-context-menu-item-main">
                  <span className="map-menu-icon overview" aria-hidden="true">
                    <img src={appIcon} alt="" />
                  </span>
                  <span className="map-context-menu-item-label">Set canyon overview point</span>
                </span>
              </button>

              {activeTrackId ? (!hasStartAndEnd ? (
                <div
                  className="map-context-submenu-wrap"
                  onMouseEnter={() => setActiveSubmenu("set")}
                  onMouseLeave={() => setActiveSubmenu((current) => (current === "set" ? null : current))}
                >
                  <button
                    type="button"
                    className="map-context-submenu-trigger"
                    onClick={() => setActiveSubmenu((current) => (current === "set" ? null : "set"))}
                  >
                    <span className="map-context-menu-item map-context-menu-item-main">
                      <span className="map-menu-icon route waypoint" aria-hidden="true">
                        +
                      </span>
                      <span className="map-context-menu-item-label">Set as ...</span>
                    </span>
                  </button>

                  {activeSubmenu === "set" ? (
                    <div className="map-context-submenu" role="menu" aria-label="Set as point">
                      {setMenuOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => onSetBoundaryPointFromContextMenu(option.target)}
                        >
                          <span className="map-context-menu-item">
                            <span
                              className={`map-menu-icon route ${option.target === "start" ? "start" : "end"}`}
                              aria-hidden="true"
                            >
                              {option.target === "start" ? "S" : "E"}
                            </span>
                            <span className="map-context-menu-item-label">{option.label}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div
                  className="map-context-submenu-wrap"
                  onMouseEnter={() => setActiveSubmenu("insert")}
                  onMouseLeave={() => setActiveSubmenu((current) => (current === "insert" ? null : current))}
                >
                  <button
                    type="button"
                    className="map-context-submenu-trigger"
                    onClick={() => setActiveSubmenu((current) => (current === "insert" ? null : "insert"))}
                  >
                    <span className="map-context-menu-item map-context-menu-item-main">
                      <span className="map-menu-icon route waypoint" aria-hidden="true">
                        +
                      </span>
                      <span className="map-context-menu-item-label">Insert ...</span>
                    </span>
                  </button>

                  {activeSubmenu === "insert" ? (
                    <div
                      className="map-context-submenu map-context-submenu-insert"
                      role="menu"
                      aria-label="Insert point"
                    >
                      {insertMenuOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          aria-label={option.label}
                          onClick={() => onInsertPointAtIndex(option.insertionIndex)}
                        >
                          <span className="map-context-menu-item map-context-menu-item-insert">
                            <span className="map-context-icon-sequence" aria-hidden="true">
                              {option.leftNeighbor ? (
                                <span className={`map-menu-icon route map-menu-icon-muted ${option.leftNeighbor.type}`}>
                                  {option.leftNeighbor.label}
                                </span>
                              ) : (
                                <span className="map-menu-icon route map-menu-icon-placeholder" />
                              )}
                              <span
                                className={`map-context-icon-separator${
                                  option.leftNeighbor ? "" : " map-context-icon-separator-placeholder"
                                }`}
                              />
                              <span className="map-menu-icon route waypoint">+</span>
                              <span
                                className={`map-context-icon-separator${
                                  option.rightNeighbor ? "" : " map-context-icon-separator-placeholder"
                                }`}
                              />
                              {option.rightNeighbor ? (
                                <span className={`map-menu-icon route map-menu-icon-muted ${option.rightNeighbor.type}`}>
                                  {option.rightNeighbor.label}
                                </span>
                              ) : (
                                <span className="map-menu-icon route map-menu-icon-placeholder" />
                              )}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )) : null}
            </div>
          </div>
        ) : null}

        {accessDeleteModal ? (
          <div className="json-modal-backdrop" role="presentation">
            <div className="json-modal json-modal-confirm" role="dialog" aria-modal="true" aria-label="Delete access track">
              <div className="json-modal-header">
                <h3>Delete access track?</h3>
                <button
                  type="button"
                  className="json-modal-close"
                  onClick={onCancelDeleteAccessTrack}
                  aria-label="Close delete dialog"
                >
                  X
                </button>
              </div>
              <p className="json-modal-help">
                This removes <strong>{accessDeleteModal.displayName}</strong> from this canyon.
              </p>
              <div className="json-modal-actions">
                <button type="button" className="json-modal-keep" onClick={onCancelDeleteAccessTrack}>
                  Cancel
                </button>
                <button type="button" className="json-modal-delete" onClick={onConfirmDeleteAccessTrack}>
                  <TrashIcon />
                  <span className="sr-only">Delete access track</span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {clearTrackModal ? (
          <div className="json-modal-backdrop" role="presentation">
            <div className="json-modal json-modal-confirm" role="dialog" aria-modal="true" aria-label="Clear all points">
              <div className="json-modal-header">
                <h3>Clear all points?</h3>
                <button
                  type="button"
                  className="json-modal-close"
                  onClick={onCancelClearTrack}
                  aria-label="Close clear dialog"
                >
                  X
                </button>
              </div>
              <p className="json-modal-help">
                This removes every point from <strong>{clearTrackModal.displayName}</strong>.
              </p>
              <div className="json-modal-actions">
                <button type="button" className="json-modal-keep" onClick={onCancelClearTrack}>
                  Cancel
                </button>
                <button type="button" className="json-modal-delete" onClick={onConfirmClearTrack}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {poiEditor && activePoi && poiEditorPosition ? (
          <div
            className="poi-editor-popup"
            style={{ left: `${poiEditorPosition.left}px`, top: `${poiEditorPosition.top}px` }}
          >
            <div className="poi-editor-header">
              <h4>POI</h4>
              <div className="poi-editor-header-actions">
                <button
                  type="button"
                  className="poi-editor-remove"
                  onClick={() => onDeletePointOfInterest(poiEditor.index)}
                  aria-label="Delete point of interest"
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  className="poi-editor-close"
                  onClick={() => {
                    setPoiEditor(null);
                    setPoiPasteModal(null);
                  }}
                  aria-label="Close POI editor"
                >
                  X
                </button>
              </div>
            </div>

            <div className="poi-editor-language-tabs">
              {STATIC_LANGUAGE_KEYS.map((language) => (
                <button
                  key={language}
                  type="button"
                  className={`poi-editor-language-tab${activePoiLanguage === language ? " active" : ""}`}
                  onClick={() => onPoiLanguageChange(language)}
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="poi-editor-field">
              <div className="poi-editor-field-head">
                <label>Name</label>
                <button type="button" onClick={() => openPoiPasteModal("name")}>
                  Paste JSON
                </button>
              </div>
              <input
                type="text"
                value={normalizeLocalizedText(activePoi.name)[activePoiLanguage] ?? ""}
                onChange={(event) =>
                  onPoiTextChange(poiEditor.index, "name", activePoiLanguage, event.target.value)
                }
              />
            </div>

            <div className="poi-editor-field">
              <div className="poi-editor-field-head">
                <label>Description</label>
                <button type="button" onClick={() => openPoiPasteModal("description")}>
                  Paste JSON
                </button>
              </div>
              <textarea
                className="poi-editor-description"
                rows={3}
                value={normalizeLocalizedText(activePoi.description)[activePoiLanguage] ?? ""}
                onChange={(event) =>
                  onPoiTextChange(poiEditor.index, "description", activePoiLanguage, event.target.value)
                }
              />
            </div>
          </div>
        ) : null}

        {parkingEditor && activeParkingLot && parkingEditorPosition ? (
          <div
            className="poi-editor-popup parking-editor-popup"
            style={{ left: `${parkingEditorPosition.left}px`, top: `${parkingEditorPosition.top}px` }}
          >
            <div className="poi-editor-header">
              <h4>Parking lot</h4>
              <div className="poi-editor-header-actions">
                <button
                  type="button"
                  className="poi-editor-remove"
                  onClick={() => onDeleteParkingLot(parkingEditor.index)}
                  aria-label="Delete parking lot"
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  className="poi-editor-close"
                  onClick={() => {
                    setParkingEditor(null);
                    setParkingPasteModal(null);
                  }}
                  aria-label="Close parking lot editor"
                >
                  X
                </button>
              </div>
            </div>

            <div className="poi-editor-language-tabs">
              {STATIC_LANGUAGE_KEYS.map((language) => (
                <button
                  key={language}
                  type="button"
                  className={`poi-editor-language-tab${activeParkingLanguage === language ? " active" : ""}`}
                  onClick={() => onParkingLanguageChange(language)}
                >
                  {language.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="poi-editor-field">
              <div className="poi-editor-field-head">
                <label>Name</label>
                <button type="button" onClick={openParkingPasteModal}>
                  Paste JSON
                </button>
              </div>
              <input
                type="text"
                value={normalizeLocalizedText(activeParkingLot.name)[activeParkingLanguage] ?? ""}
                onChange={(event) =>
                  onParkingNameChange(parkingEditor.index, activeParkingLanguage, event.target.value)
                }
              />
              <div className="parking-name-presets">
                {parkingLotSuggestions.map((preset, presetIndex) => (
                  <button
                    key={`${preset.en}-${presetIndex}`}
                    type="button"
                    className="parking-name-preset-button"
                    onClick={() => onApplyParkingNamePreset(parkingEditor.index, preset)}
                  >
                    {`Set to "${preset.en}"`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {poiPasteModal ? (
          <div className="json-modal-backdrop" role="presentation">
            <div className="json-modal" role="dialog" aria-modal="true" aria-label="Paste POI language JSON">
              <div className="json-modal-header">
                <h3>Paste POI {poiPasteModal.field} JSON</h3>
                <button type="button" className="json-modal-close" onClick={closePoiPasteModal} aria-label="Close">
                  X
                </button>
              </div>
              <p className="json-modal-help">
                Provide valid JSON with exactly these keys: {STATIC_LANGUAGE_KEYS.join(", ")}.
              </p>
              <textarea
                value={poiPasteModal.draft}
                rows={12}
                placeholder={LOCALIZED_JSON_PLACEHOLDER}
                onChange={(event) =>
                  setPoiPasteModal((current) =>
                    current
                      ? {
                          ...current,
                          draft: event.target.value,
                          error: "",
                        }
                      : current,
                  )
                }
              />
              {poiPasteModal.error ? <p className="json-inline-error">{poiPasteModal.error}</p> : null}
              <div className="json-modal-actions">
                <button type="button" className="json-modal-apply" onClick={onApplyPoiPaste}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {parkingPasteModal ? (
          <div className="json-modal-backdrop" role="presentation">
            <div className="json-modal" role="dialog" aria-modal="true" aria-label="Paste parking lot language JSON">
              <div className="json-modal-header">
                <h3>Paste parking lot name JSON</h3>
                <button
                  type="button"
                  className="json-modal-close"
                  onClick={closeParkingPasteModal}
                  aria-label="Close"
                >
                  X
                </button>
              </div>
              <p className="json-modal-help">
                Provide valid JSON with exactly these keys: {STATIC_LANGUAGE_KEYS.join(", ")}.
              </p>
              <textarea
                value={parkingPasteModal.draft}
                rows={12}
                placeholder={LOCALIZED_JSON_PLACEHOLDER}
                onChange={(event) =>
                  setParkingPasteModal((current) =>
                    current
                      ? {
                          ...current,
                          draft: event.target.value,
                          error: "",
                        }
                      : current,
                  )
                }
              />
              {parkingPasteModal.error ? <p className="json-inline-error">{parkingPasteModal.error}</p> : null}
              <div className="json-modal-actions">
                <button type="button" className="json-modal-apply" onClick={onApplyParkingPaste}>
                  Apply
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

