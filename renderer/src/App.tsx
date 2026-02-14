import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
};

type MapContextMenuState = {
  x: number;
  y: number;
  coordinate: Coordinate;
} | null;

type SaveGeoJSONResult = {
  canceled: boolean;
  filePath?: string;
};

type RouteSegmentSummary = {
  index: number;
  from: Coordinate;
  to: Coordinate;
  mode: SegmentMode;
  distance_m: number;
  duration_s: number;
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

type RouteElevations = {
  startM: number;
  endM: number;
};

type InsertMenuOption = {
  key: string;
  label: string;
  insertionIndex: number;
};

type ManualCoordinateActionOption =
  | {
      key: string;
      label: string;
      mode: "boundary";
      target: "start" | "end";
    }
  | {
      key: string;
      label: string;
      mode: "insert";
      insertionIndex: number;
    };

const ROUTE_SOURCE_ID = "walking-route-source";
const ROUTE_LAYER_ID = "walking-route-layer";
const TERRAIN_TILE_ZOOM = 14;
const TERRAIN_TILE_SIZE = 512;
const MAX_ROUTED_SEGMENT_CACHE_ENTRIES = 400;
const MAP_STYLE_BY_MODE: Record<MapStyleMode, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  outdoors: "mapbox://styles/mapbox/outdoors-v12",
};

const EMPTY_ROUTE_GEOJSON: FeatureCollection<LineString> = {
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

function parseCoordinateInput(rawValue: string): { coordinate: Coordinate | null; error: string } {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return {
      coordinate: null,
      error: "Coordinate is required.",
    };
  }

  const parts = trimmed.split(",").map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return {
      coordinate: null,
      error: "Use format: lng, lat (e.g. 9.1951612, 48.2951951).",
    };
  }

  const lng = Number.parseFloat(parts[0]);
  const lat = Number.parseFloat(parts[1]);
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    return {
      coordinate: null,
      error: "Longitude and latitude must be valid numbers.",
    };
  }

  if (lng < -180 || lng > 180) {
    return {
      coordinate: null,
      error: "Longitude must be between -180 and 180.",
    };
  }

  if (lat < -90 || lat > 90) {
    return {
      coordinate: null,
      error: "Latitude must be between -90 and 90.",
    };
  }

  return {
    coordinate: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
    error: "",
  };
}

function isSameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function appendCoordinate(target: Coordinate[], candidate: Coordinate): void {
  const last = target[target.length - 1];
  if (!last || !isSameCoordinate(last, candidate)) {
    target.push(candidate);
  }
}

function appendCoordinates(target: Coordinate[], candidates: Coordinate[]): void {
  for (const candidate of candidates) {
    appendCoordinate(target, candidate);
  }
}

function haversineDistanceMeters(a: Coordinate, b: Coordinate): number {
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusM = 6371000;
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b[0] - a[0]);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return earthRadiusM * c;
}

function calculateStraightSegmentDurationSeconds(distanceM: number, deltaElevationM: number): number {
  const distanceKm = distanceM / 1000;
  const durationHours =
    distanceKm / 5 + Math.max(deltaElevationM, 0) / 600 + Math.max(-deltaElevationM, 0) / 1000;
  return Math.max(0, durationHours * 3600);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

function createFilenameSuggestion(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const sec = String(date.getSeconds()).padStart(2, "0");

  return `route_${yyyy}-${mm}-${dd}_${hh}-${min}-${sec}.geojson`;
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
        X
      </button>
    </li>
  );
}

export function App(): JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const segmentModePopupRef = useRef<mapboxgl.Popup | null>(null);
  const mapPointerCoordinateRef = useRef<Coordinate | null>(null);
  const routePointsRef = useRef<RoutePoint[]>([]);
  const routeFeatureRef = useRef<RouteFeature | null>(null);
  const pointMarkersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const routedSegmentCacheRef = useRef<Map<string, CachedRouteSegment>>(new Map());
  const routeAbortControllerRef = useRef<AbortController | null>(null);
  const suppressMapMenuUntilRef = useRef(0);

  const [mapboxToken, setMapboxToken] = useState<string>("");
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>("outdoors");
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeFeature, setRouteFeature] = useState<RouteFeature | null>(null);
  const [contextMenu, setContextMenu] = useState<MapContextMenuState>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<ContextMenuSubmenu | null>(null);
  const [coordinateInput, setCoordinateInput] = useState("");
  const [coordinateInputError, setCoordinateInputError] = useState("");
  const [manualCoordinateActionKey, setManualCoordinateActionKey] = useState("");
  const [routeElevations, setRouteElevations] = useState<RouteElevations | null>(null);
  const [routeElevationError, setRouteElevationError] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState("Ready");

  routePointsRef.current = routePoints;
  routeFeatureRef.current = routeFeature;

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

  const drawRoute = useCallback((geometry: LineString | null): void => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (!map.isStyleLoaded()) {
      map.once("idle", () => drawRoute(geometry));
      return;
    }

    if (!map.getSource(ROUTE_SOURCE_ID)) {
      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: EMPTY_ROUTE_GEOJSON as GeoJSON.FeatureCollection,
      });
    }

    if (!map.getLayer(ROUTE_LAYER_ID)) {
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        paint: {
          "line-color": "#f97316",
          "line-width": 5,
        },
      });
    }

    const source = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    if (!geometry) {
      source.setData(EMPTY_ROUTE_GEOJSON as GeoJSON.FeatureCollection);
      return;
    }

    const routeGeoJson: Feature<LineString> = {
      type: "Feature",
      geometry,
      properties: {},
    };
    source.setData(routeGeoJson as GeoJSON.Feature);
  }, []);

  const onToggleMapStyle = useCallback((): void => {
    setMapStyleMode((current) => (current === "satellite" ? "outdoors" : "satellite"));
  }, []);

  const generateRoute = useCallback(
    async (points: RoutePoint[]): Promise<void> => {
      if (points.length < 2 || points[0]?.type !== "start" || points[points.length - 1]?.type !== "end") {
        setRouteFeature(null);
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
            appendCoordinates(fullCoordinates, [previousPoint.coordinates, currentPoint.coordinates]);
            totalDistanceM += straightDistanceM;
            totalDurationS += straightDurationS;
            segments.push({
              index,
              from: previousPoint.coordinates,
              to: currentPoint.coordinates,
              mode: "straight",
              distance_m: straightDistanceM,
              duration_s: straightDurationS,
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
              appendCoordinates(fullCoordinates, cachedSegment.coordinates);
              totalDistanceM += cachedSegment.distance;
              totalDurationS += cachedSegment.duration;
              segments.push({
                index,
                from: previousPoint.coordinates,
                to: currentPoint.coordinates,
                mode: "route",
                distance_m: cachedSegment.distance,
                duration_s: cachedSegment.duration,
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
            if (routedSegmentCacheRef.current.size >= MAX_ROUTED_SEGMENT_CACHE_ENTRIES) {
              routedSegmentCacheRef.current.clear();
            }
            routedSegmentCacheRef.current.set(cacheKey, {
              distance: route.distance,
              duration: route.duration,
              coordinates: segmentCoordinates,
            });
            appendCoordinates(fullCoordinates, segmentCoordinates);

            totalDistanceM += route.distance;
            totalDurationS += route.duration;
            segments.push({
              index,
              from: previousPoint.coordinates,
              to: currentPoint.coordinates,
              mode: "route",
              distance_m: route.distance,
              duration_s: route.duration,
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
            appendCoordinates(fullCoordinates, [previousPoint.coordinates, currentPoint.coordinates]);
            totalDistanceM += fallbackDistanceM;
            totalDurationS += fallbackDurationS;
            segments.push({
              index,
              from: previousPoint.coordinates,
              to: currentPoint.coordinates,
              mode: "route",
              distance_m: fallbackDistanceM,
              duration_s: fallbackDurationS,
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
            generated_at: new Date().toISOString(),
          },
        };

        if (controller.signal.aborted) {
          return;
        }

        setRouteFeature(feature);
        if (segmentErrors.length > 0) {
          setStatusText(`Route ready with warnings: ${segmentErrors.join(" | ")}`);
        } else {
          setStatusText("Route ready.");
        }
      } catch (error) {
        if (controller.signal.aborted) {
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
      center: [8.980786, 46.300597],
      zoom: 12,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const openMenuForEvent = (event: mapboxgl.MapMouseEvent & mapboxgl.EventData): void => {
      if (Date.now() < suppressMapMenuUntilRef.current) {
        return;
      }

      const coordinate: Coordinate = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];

      setContextMenu({
        x: Math.round(event.point.x),
        y: Math.round(event.point.y),
        coordinate,
      });
      setActiveSubmenu(null);
    };

    const onMapClick = (event: mapboxgl.MapMouseEvent & mapboxgl.EventData): void => {
      openMenuForEvent(event);
    };

    const onMapContextMenu = (event: mapboxgl.MapMouseEvent & mapboxgl.EventData): void => {
      event.originalEvent.preventDefault();
      openMenuForEvent(event);
    };

    const onMapMouseMove = (event: mapboxgl.MapMouseEvent & mapboxgl.EventData): void => {
      mapPointerCoordinateRef.current = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];
    };

    const onCanvasContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    const onCanvasMouseLeave = (): void => {
      mapPointerCoordinateRef.current = null;
    };

    const onMapMoveStart = (): void => {
      setContextMenu(null);
      setActiveSubmenu(null);
      segmentModePopupRef.current?.remove();
      segmentModePopupRef.current = null;
    };

    map.on("click", onMapClick);
    map.on("contextmenu", onMapContextMenu);
    map.on("mousemove", onMapMouseMove);
    map.on("movestart", onMapMoveStart);
    map.getCanvasContainer().addEventListener("contextmenu", onCanvasContextMenu);
    map.getCanvasContainer().addEventListener("mouseleave", onCanvasMouseLeave);

    mapRef.current = map;

    return () => {
      map.off("click", onMapClick);
      map.off("contextmenu", onMapContextMenu);
      map.off("mousemove", onMapMouseMove);
      map.off("movestart", onMapMoveStart);
      map.getCanvasContainer().removeEventListener("contextmenu", onCanvasContextMenu);
      map.getCanvasContainer().removeEventListener("mouseleave", onCanvasMouseLeave);

      segmentModePopupRef.current?.remove();
      segmentModePopupRef.current = null;
      mapPointerCoordinateRef.current = null;

      for (const markerEntry of pointMarkersRef.current.values()) {
        markerEntry.marker.remove();
      }
      pointMarkersRef.current.clear();

      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const redrawRoute = (): void => {
      drawRoute(routeFeatureRef.current?.geometry ?? null);
    };

    map.once("style.load", redrawRoute);
    map.once("idle", redrawRoute);
    map.setStyle(MAP_STYLE_BY_MODE[mapStyleMode]);

    return () => {
      map.off("style.load", redrawRoute);
      map.off("idle", redrawRoute);
    };
  }, [drawRoute, mapStyleMode]);

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
    drawRoute(routeFeature?.geometry ?? null);
  }, [drawRoute, routeFeature]);

  useEffect(() => {
    if (!routeFeature || !mapboxToken) {
      setRouteElevations(null);
      setRouteElevationError("");
      return;
    }

    const abortController = new AbortController();

    setRouteElevations(null);
    setRouteElevationError("");

    async function resolveRouteElevations(): Promise<void> {
      try {
        const tileCache = new Map<string, Promise<ImageData>>();
        const loadTileImageData = async (tileX: number, tileY: number): Promise<ImageData> => {
          const key = `${TERRAIN_TILE_ZOOM}/${tileX}/${tileY}`;
          const cached = tileCache.get(key);
          if (cached) {
            return cached;
          }

          const promise = (async () => {
            const url = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${TERRAIN_TILE_ZOOM}/${tileX}/${tileY}@2x.pngraw?access_token=${encodeURIComponent(mapboxToken)}`;
            const response = await fetch(url, { signal: abortController.signal });
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

          tileCache.set(key, promise);
          return promise;
        };

        const getElevationAt = async (coordinate: Coordinate): Promise<number> => {
          const tilePoint = projectLngLatToTilePixel(
            coordinate[0],
            coordinate[1],
            TERRAIN_TILE_ZOOM,
          );
          const tileImage = await loadTileImageData(tilePoint.tileX, tilePoint.tileY);
          return decodeTerrainElevationMeters(tileImage, tilePoint.pixelX, tilePoint.pixelY);
        };

        const [startElevationM, endElevationM] = await Promise.all([
          getElevationAt(routeFeature.properties.start),
          getElevationAt(routeFeature.properties.end),
        ]);

        if (abortController.signal.aborted) {
          return;
        }

        setRouteElevations({
          startM: Math.round(startElevationM),
          endM: Math.round(endElevationM),
        });
        setRouteElevationError("");
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        console.error("Failed to resolve route elevations:", error);
        setRouteElevations(null);
        setRouteElevationError("Elevation unavailable for this route.");
      }
    }

    void resolveRouteElevations();

    return () => {
      abortController.abort();
    };
  }, [mapboxToken, routeFeature]);

  useEffect(() => {
    if (routePoints.length < 2) {
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
      setRouteFeature(null);
      return;
    }

    void generateRoute(routePoints);
  }, [generateRoute, routePoints]);

  useEffect(() => {
    return () => {
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
    };
  }, []);

  const applyRoutePointUpdate = useCallback(
    (updater: (current: RoutePoint[]) => RoutePoint[], nextStatusText: string): void => {
      setRoutePoints((current) => {
        const next = normalizeRoutePoints(updater(current));
        return areRoutePointsEqual(current, next) ? current : next;
      });
      setStatusText(nextStatusText);
    },
    [],
  );

  const onDeletePoint = useCallback(
    (id: string): void => {
      const points = routePointsRef.current;
      if (!points.some((point) => point.id === id)) {
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
          setContextMenu(null);
          setActiveSubmenu(null);
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
  }, [applyRoutePointUpdate, openSegmentModePopup, routePoints]);

  const setBoundaryPointAtCoordinate = useCallback((target: "start" | "end", coordinate: Coordinate): void => {
    applyRoutePointUpdate(
      (current) => {
        if (target === "start") {
          if (current.length === 0) {
            return [
              {
                id: createRoutePointId(),
                type: "start",
                coordinates: coordinate,
              },
            ];
          }

          if (current.length === 1 && current[0].type === "end") {
            return [
              {
                id: createRoutePointId(),
                type: "start",
                coordinates: coordinate,
              },
              current[0],
            ];
          }

          const next = [...current];
          next[0] = { ...next[0], coordinates: coordinate };
          return next;
        }

        if (current.length === 0) {
          return [
            {
              id: createRoutePointId(),
              type: "end",
              coordinates: coordinate,
            },
          ];
        }

        if (current.length === 1 && current[0].type === "start") {
          return [
            ...current,
            {
              id: createRoutePointId(),
              type: "end",
              coordinates: coordinate,
            },
          ];
        }

        if (current.length === 1 && current[0].type === "end") {
          return [{ ...current[0], coordinates: coordinate }];
        }

        const next = [...current];
        const lastIndex = next.length - 1;
        next[lastIndex] = { ...next[lastIndex], coordinates: coordinate };
        return next;
      },
      target === "start" ? "Start point set." : "End point set.",
    );
  }, [applyRoutePointUpdate]);

  const insertPointAt = useCallback((insertionIndex: number, coordinate: Coordinate): boolean => {
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
        setStatusText("Move the mouse over the map to insert a point.");
        return;
      }

      event.preventDefault();

      if (key === "s") {
        insertPointAt(0, coordinate);
        return;
      }

      insertPointAt(routePointsRef.current.length, coordinate);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [insertPointAt]);

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

  const onSaveGeoJSON = async (): Promise<void> => {
    if (!routeFeature) {
      setStatusText("Generate a route before saving GeoJSON.");
      return;
    }

    setIsSaving(true);

    try {
      const featureCollection: FeatureCollection<LineString, RouteProperties> = {
        type: "FeatureCollection",
        features: [routeFeature],
      };

      const suggestion = createFilenameSuggestion(new Date());
      const result: SaveGeoJSONResult = await window.api.saveGeoJSON(
        suggestion,
        JSON.stringify(featureCollection, null, 2),
      );

      if (result.canceled) {
        setStatusText("Save canceled.");
      } else {
        setStatusText(`Saved GeoJSON to ${result.filePath}`);
      }
    } catch (error) {
      setStatusText(`Failed to save GeoJSON: ${formatError(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const onClear = (): void => {
    routeAbortControllerRef.current?.abort();
    routeAbortControllerRef.current = null;
    segmentModePopupRef.current?.remove();
    segmentModePopupRef.current = null;

    setRoutePoints([]);
    setRouteFeature(null);
    setContextMenu(null);
    setActiveSubmenu(null);
    setCoordinateInput("");
    setCoordinateInputError("");
    setManualCoordinateActionKey("");
    setRouteElevations(null);
    setRouteElevationError("");
    setStatusText("Cleared.");
  };

  const canSave = Boolean(routeFeature && !isSaving);
  const routeSummary = useMemo(() => {
    if (!routeFeature) {
      return null;
    }

    return {
      distanceKm: (routeFeature.properties.distance_m / 1000).toFixed(2),
      durationMin: Math.round(routeFeature.properties.duration_s / 60),
    };
  }, [routeFeature]);

  const sortableIds = useMemo(() => routePoints.map((point) => point.id), [routePoints]);
  const hasStartAndEnd = useMemo(
    () =>
      routePoints.some((point) => point.type === "start") &&
      routePoints.some((point) => point.type === "end"),
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
      { key: "before-start", label: "before Start", insertionIndex: 0 },
      { key: "after-start", label: "after Start", insertionIndex: 1 },
    ];

    for (let index = 1; index < routePoints.length - 1; index += 1) {
      if (routePoints[index].type === "waypoint") {
        options.push({
          key: `after-${routePoints[index].id}`,
          label: `after Waypoint ${index}`,
          insertionIndex: index + 1,
        });
      }
    }

    if (routePoints.length > 1) {
      options.push({
        key: "after-end",
        label: "after End",
        insertionIndex: routePoints.length,
      });
    }

    return options;
  }, [routePoints]);

  const manualCoordinateOptions = useMemo<ManualCoordinateActionOption[]>(() => {
    if (!hasStartAndEnd) {
      return [
        {
          key: "manual-set-start",
          label: "Set as Start",
          mode: "boundary",
          target: "start",
        },
        {
          key: "manual-set-end",
          label: "Set as End",
          mode: "boundary",
          target: "end",
        },
      ];
    }

    return insertMenuOptions.map((option) => ({
      key: `manual-${option.key}`,
      label: option.label,
      mode: "insert" as const,
      insertionIndex: option.insertionIndex,
    }));
  }, [hasStartAndEnd, insertMenuOptions]);

  useEffect(() => {
    if (manualCoordinateOptions.length === 0) {
      setManualCoordinateActionKey("");
      return;
    }

    if (manualCoordinateOptions.some((option) => option.key === manualCoordinateActionKey)) {
      return;
    }

    setManualCoordinateActionKey(manualCoordinateOptions[0].key);
  }, [manualCoordinateActionKey, manualCoordinateOptions]);

  const onInsertCoordinateFromInput = useCallback((): void => {
    if (!mapRef.current) {
      setStatusText("Map is not ready yet.");
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

  return (
    <div className="app-shell">
      <aside className="control-panel">
        <div className="button-grid">
          <button type="button" onClick={() => void onSaveGeoJSON()} disabled={!canSave}>
            {isSaving ? "Saving..." : "Save GeoJSON"}
          </button>
          <button type="button" onClick={onClear}>
            Clear
          </button>
        </div>

        <section className="route-summary">
          {routeSummary ? (
            <>
              <p>
                <strong>Distance:</strong> {routeSummary.distanceKm} km
              </p>
              <p>
                <strong>Walk Time:</strong> {routeSummary.durationMin} min
              </p>
              <p>
                <strong>Start Elevation:</strong>{" "}
                {routeElevations ? `${routeElevations.startM} m` : routeElevationError ? "Unavailable" : "Loading..."}
              </p>
              <p>
                <strong>End Elevation:</strong>{" "}
                {routeElevations ? `${routeElevations.endM} m` : routeElevationError ? "Unavailable" : "Loading..."}
              </p>
              {routeElevationError ? <p className="route-summary-error">{routeElevationError}</p> : null}
            </>
          ) : (
            <p className="route-summary-empty">No route yet.</p>
          )}
        </section>

        <section className="coordinate-input-panel">
          <h2>Insert Coordinate</h2>
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
              placeholder="lng, lat (e.g. 9.1951612, 48.2951951)"
              aria-label="Coordinate input"
            />
            <select
              value={manualCoordinateActionKey}
              onChange={(event) => setManualCoordinateActionKey(event.target.value)}
              aria-label="Coordinate insertion position"
            >
              {manualCoordinateOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="submit" disabled={!canInsertCoordinate}>
              Insert Coordinate
            </button>
          </form>
          {coordinateInputError ? <p className="coordinate-input-error">{coordinateInputError}</p> : null}
        </section>

        <section className="route-points-panel">
          <h2>Route Points</h2>
          {routePoints.length === 0 ? (
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

        <p className="status-text">{statusText}</p>
      </aside>

      <main className="map-area" onContextMenu={(event) => event.preventDefault()}>
        <div ref={mapContainerRef} className="map-container" />
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

        {contextMenu ? (
          <div className="map-context-menu-layer">
            <div
              ref={contextMenuRef}
              className="map-context-menu"
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              role="menu"
              aria-label="Map click menu"
            >
              {!hasStartAndEnd ? (
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
                    Set as ...
                  </button>

                  {activeSubmenu === "set" ? (
                    <div className="map-context-submenu" role="menu" aria-label="Set as point">
                      {setMenuOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => onSetBoundaryPointFromContextMenu(option.target)}
                        >
                          {option.label}
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
                    Insert ...
                  </button>

                  {activeSubmenu === "insert" ? (
                    <div
                      className="map-context-submenu map-context-submenu-insert"
                      role="menu"
                      aria-label="Insert point"
                    >
                      {insertMenuOptions.map((option) => (
                        <button key={option.key} type="button" onClick={() => onInsertPointAtIndex(option.insertionIndex)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
