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
type ContextMenuSubmenu = "set" | "insert";

type RoutePoint = {
  id: string;
  type: RoutePointType;
  coordinates: Coordinate;
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

type RouteProperties = {
  distance_m: number;
  duration_s: number;
  profile: "walking";
  start: Coordinate;
  end: Coordinate;
  waypoints: Coordinate[];
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

const ROUTE_SOURCE_ID = "walking-route-source";
const ROUTE_LAYER_ID = "walking-route-layer";
const TERRAIN_TILE_ZOOM = 14;
const TERRAIN_TILE_SIZE = 512;

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

function formatCoordinate(value: Coordinate | null): string {
  if (!value) {
    return "Not set";
  }

  return `${value[0].toFixed(6)}, ${value[1].toFixed(6)}`;
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
    return [{ ...onlyPoint, type: onlyPoint.type === "end" ? "end" : "start" }];
  }

  return points.map((point, index) => {
    if (index === 0) {
      return { ...point, type: "start" };
    }

    if (index === points.length - 1) {
      return { ...point, type: "end" };
    }

    return { ...point, type: "waypoint" };
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

  return `Waypoint ${index}`;
}

function createRoutePointMarkerElement(point: RoutePoint, routePointIndex: number): HTMLDivElement {
  const element = document.createElement("div");
  element.className = "route-point-marker";
  element.dataset.type = point.type;

  const label = document.createElement("span");
  label.className = "route-point-marker-label";

  if (point.type === "start") {
    label.textContent = "S";
  } else if (point.type === "end") {
    label.textContent = "E";
  } else {
    label.textContent = String(routePointIndex);
  }

  element.append(label);
  return element;
}

type RoutePointListItemProps = {
  point: RoutePoint;
  index: number;
  label: string;
  coordinateLabel: string;
  onDelete: (id: string) => void;
};

function RoutePointListItem({
  point,
  index,
  label,
  coordinateLabel,
  onDelete,
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
        <p className="route-point-title">{label}</p>
        <p className="route-point-coordinate">{coordinateLabel}</p>
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
  const pointMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const routeAbortControllerRef = useRef<AbortController | null>(null);

  const [mapboxToken, setMapboxToken] = useState<string>("");
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>([]);
  const [routeFeature, setRouteFeature] = useState<RouteFeature | null>(null);
  const [contextMenu, setContextMenu] = useState<MapContextMenuState>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<ContextMenuSubmenu | null>(null);
  const [routeElevations, setRouteElevations] = useState<RouteElevations | null>(null);
  const [routeElevationError, setRouteElevationError] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState("Ready");

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

  const drawRoute = useCallback((geometry: LineString | null): void => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    if (!map.isStyleLoaded()) {
      map.once("load", () => drawRoute(geometry));
      return;
    }

    if (map.getLayer(ROUTE_LAYER_ID)) {
      map.removeLayer(ROUTE_LAYER_ID);
    }

    if (map.getSource(ROUTE_SOURCE_ID)) {
      map.removeSource(ROUTE_SOURCE_ID);
    }

    if (!geometry) {
      return;
    }

    const routeGeoJson: Feature<LineString> = {
      type: "Feature",
      geometry,
      properties: {},
    };

    map.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: routeGeoJson as GeoJSON.Feature,
    });

    map.addLayer({
      id: ROUTE_LAYER_ID,
      type: "line",
      source: ROUTE_SOURCE_ID,
      paint: {
        "line-color": "#f97316",
        "line-width": 5,
      },
    });
  }, []);

  const generateRoute = useCallback(
    async (points: RoutePoint[]): Promise<void> => {
      if (!mapboxToken) {
        return;
      }

      if (points.length < 2 || points[0]?.type !== "start" || points[points.length - 1]?.type !== "end") {
        setRouteFeature(null);
        return;
      }

      routeAbortControllerRef.current?.abort();

      const controller = new AbortController();
      routeAbortControllerRef.current = controller;
      setStatusText("Updating walking route...");

      try {
        const coordinatesParam = points
          .map((point) => `${point.coordinates[0]},${point.coordinates[1]}`)
          .join(";");
        const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinatesParam}?geometries=geojson&overview=full&access_token=${encodeURIComponent(mapboxToken)}`;

        const response = await fetch(url, { signal: controller.signal });
        const payload = (await response.json()) as DirectionsResponse;

        if (!response.ok) {
          throw new Error(payload.message || `Directions API request failed (${response.status}).`);
        }

        const route = payload.routes?.[0];
        if (!route || !route.geometry?.coordinates?.length) {
          throw new Error("No route found for the selected points.");
        }

        const start = points[0].coordinates;
        const end = points[points.length - 1].coordinates;
        const waypoints = points.slice(1, -1).map((point) => point.coordinates);

        const feature: RouteFeature = {
          type: "Feature",
          geometry: route.geometry,
          properties: {
            distance_m: route.distance,
            duration_s: route.duration,
            profile: "walking",
            start,
            end,
            waypoints,
            generated_at: new Date().toISOString(),
          },
        };

        if (controller.signal.aborted) {
          return;
        }

        setRouteFeature(feature);
        setStatusText("Route ready.");
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
      style: "mapbox://styles/mapbox/streets-v12",
      center: [8.980786, 46.300597],
      zoom: 12,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const openMenuForEvent = (event: mapboxgl.MapMouseEvent & mapboxgl.EventData): void => {
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

    const onCanvasContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    map.on("click", onMapClick);
    map.on("contextmenu", onMapContextMenu);
    map.getCanvasContainer().addEventListener("contextmenu", onCanvasContextMenu);

    mapRef.current = map;

    return () => {
      map.off("click", onMapClick);
      map.off("contextmenu", onMapContextMenu);
      map.getCanvasContainer().removeEventListener("contextmenu", onCanvasContextMenu);

      for (const marker of pointMarkersRef.current.values()) {
        marker.remove();
      }
      pointMarkersRef.current.clear();

      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken]);

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
    const map = mapRef.current;
    if (!map) {
      return;
    }

    try {
      for (const marker of pointMarkersRef.current.values()) {
        marker.remove();
      }
      pointMarkersRef.current.clear();

      routePoints.forEach((point, index) => {
        const element = createRoutePointMarkerElement(point, index);
        const marker = new mapboxgl.Marker({ element, anchor: "bottom", draggable: true })
          .setLngLat(point.coordinates)
          .addTo(map);

        marker.on("dragend", () => {
          const lngLat = marker.getLngLat();
          const coordinate: Coordinate = [
            Number(lngLat.lng.toFixed(6)),
            Number(lngLat.lat.toFixed(6)),
          ];

          setRouteFeature(null);
          setRoutePoints((current) =>
            normalizeRoutePoints(
              current.map((currentPoint) =>
                currentPoint.id === point.id
                  ? { ...currentPoint, coordinates: coordinate }
                  : currentPoint,
              ),
            ),
          );
          setStatusText("Point moved.");
        });

        pointMarkersRef.current.set(point.id, marker);
      });
    } catch (error) {
      setStatusText(`Map marker error: ${formatError(error)}`);
      console.error("Failed to update map markers:", error);
    }
  }, [routePoints]);

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
    if (!mapboxToken) {
      return;
    }

    if (routePoints.length < 2) {
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
      setRouteFeature(null);
      return;
    }

    void generateRoute(routePoints);
  }, [generateRoute, mapboxToken, routePoints]);

  useEffect(() => {
    return () => {
      routeAbortControllerRef.current?.abort();
      routeAbortControllerRef.current = null;
    };
  }, []);

  const applyRoutePointUpdate = useCallback(
    (updater: (current: RoutePoint[]) => RoutePoint[], nextStatusText: string): void => {
      setRouteFeature(null);
      setRoutePoints((current) => normalizeRoutePoints(updater(current)));
      setStatusText(nextStatusText);
    },
    [],
  );

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

      setContextMenu(null);
      setActiveSubmenu(null);
    },
    [applyRoutePointUpdate, contextMenu],
  );

  const onSetPointFromContextMenu = useCallback(
    (pointIndex: number): void => {
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

      applyRoutePointUpdate(
        (current) => {
          if (current.length === 0) {
            return [
              {
                id: createRoutePointId(),
                type: "start",
                coordinates: coordinate,
              },
            ];
          }

          const next = [...current];
          const safeIndex = Math.min(Math.max(pointIndex, 0), next.length - 1);
          next[safeIndex] = { ...next[safeIndex], coordinates: coordinate };
          return next;
        },
        "Point replaced.",
      );

      setContextMenu(null);
      setActiveSubmenu(null);
    },
    [applyRoutePointUpdate, contextMenu],
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

      applyRoutePointUpdate(
        (current) => {
          const next = [...current];
          const safeInsertionIndex = Math.min(Math.max(insertionIndex, 0), next.length);

          next.splice(safeInsertionIndex, 0, {
            id: createRoutePointId(),
            type: "waypoint",
            coordinates: coordinate,
          });

          return next;
        },
        "Point inserted.",
      );

      setContextMenu(null);
      setActiveSubmenu(null);
    },
    [applyRoutePointUpdate, contextMenu],
  );

  const onDeletePoint = useCallback(
    (id: string): void => {
      applyRoutePointUpdate((current) => current.filter((point) => point.id !== id), "Point deleted.");
    },
    [applyRoutePointUpdate],
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

    setRoutePoints([]);
    setRouteFeature(null);
    setContextMenu(null);
    setActiveSubmenu(null);
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
    Array<
      | { key: string; label: string; mode: "boundary"; target: "start" | "end" }
      | { key: string; label: string; mode: "replace"; pointIndex: number }
    >
  >(() => {
    if (!hasStartAndEnd) {
      return [
        { key: "set-start", label: "Start", mode: "boundary", target: "start" },
        { key: "set-end", label: "End", mode: "boundary", target: "end" },
      ];
    }

    return routePoints.map((point, index) => ({
      key: point.id,
      label: getRoutePointLabel(routePoints, index),
      mode: "replace",
      pointIndex: index,
    }));
  }, [hasStartAndEnd, routePoints]);

  const insertMenuOptions = useMemo(() => {
    const options: Array<{ key: string; label: string; insertionIndex: number }> = [
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
          <h2>Route Summary</h2>
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
                      coordinateLabel={formatCoordinate(point.coordinates)}
                      onDelete={onDeletePoint}
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

        {contextMenu ? (
          <div className="map-context-menu-layer">
            <div
              ref={contextMenuRef}
              className="map-context-menu"
              style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              role="menu"
              aria-label="Map click menu"
            >
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
                  {hasStartAndEnd ? "Replace ..." : "Set as ..."}
                </button>

                {activeSubmenu === "set" ? (
                  <div className="map-context-submenu" role="menu" aria-label="Set as point">
                    {setMenuOptions.map((option) => (
                      option.mode === "boundary" ? (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => onSetBoundaryPointFromContextMenu(option.target)}
                        >
                          {option.label}
                        </button>
                      ) : (
                        <button key={option.key} type="button" onClick={() => onSetPointFromContextMenu(option.pointIndex)}>
                          {option.label}
                        </button>
                      )
                    ))}
                  </div>
                ) : null}
              </div>

              {hasStartAndEnd ? (
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
                    <div className="map-context-submenu" role="menu" aria-label="Insert point">
                      {insertMenuOptions.map((option) => (
                        <button key={option.key} type="button" onClick={() => onInsertPointAtIndex(option.insertionIndex)}>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
