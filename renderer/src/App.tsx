import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { Feature, FeatureCollection, LineString, Position } from "geojson";

type ClickMode = "start" | "end" | null;
type Coordinate = [number, number];

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

const ROUTE_SOURCE_ID = "walking-route-source";
const ROUTE_LAYER_ID = "walking-route-layer";

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

export function App(): JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const startMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const endMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const modeRef = useRef<ClickMode>(null);

  const [mapboxToken, setMapboxToken] = useState<string>("");
  const [mode, setMode] = useState<ClickMode>(null);
  const [startPoint, setStartPoint] = useState<Coordinate | null>(null);
  const [endPoint, setEndPoint] = useState<Coordinate | null>(null);
  const [routeFeature, setRouteFeature] = useState<RouteFeature | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusText, setStatusText] = useState("Ready");

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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

    if (!geometry) {
      if (map.getLayer(ROUTE_LAYER_ID)) {
        map.removeLayer(ROUTE_LAYER_ID);
      }

      if (map.getSource(ROUTE_SOURCE_ID)) {
        map.removeSource(ROUTE_SOURCE_ID);
      }

      return;
    }

    const routeGeoJson: Feature<LineString> = {
      type: "Feature",
      geometry,
      properties: {},
    };

    const existingSource = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(routeGeoJson as GeoJSON.Feature);
      return;
    }

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

  const fitCoordinates = useCallback((coordinates: Position[]): void => {
    const map = mapRef.current;
    if (!map || coordinates.length === 0) {
      return;
    }

    const [firstLng, firstLat] = coordinates[0] as Coordinate;
    const bounds = new mapboxgl.LngLatBounds([firstLng, firstLat], [firstLng, firstLat]);

    for (const coordinate of coordinates) {
      bounds.extend([coordinate[0], coordinate[1]]);
    }

    map.fitBounds(bounds, {
      padding: 64,
      duration: 700,
    });
  }, []);

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-122.4194, 37.7749],
      zoom: 12,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("click", (event) => {
      const activeMode = modeRef.current;
      if (!activeMode) {
        return;
      }

      const coordinate: Coordinate = [
        Number(event.lngLat.lng.toFixed(6)),
        Number(event.lngLat.lat.toFixed(6)),
      ];

      if (activeMode === "start") {
        setStartPoint(coordinate);
        setStatusText("Start point set.");
      } else {
        setEndPoint(coordinate);
        setStatusText("End point set.");
      }

      setMode(null);
      setRouteFeature(null);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    try {
      if (startPoint) {
        if (!startMarkerRef.current) {
          startMarkerRef.current = new mapboxgl.Marker({ color: "#2563eb" })
            .setLngLat(startPoint)
            .addTo(map);
        } else {
          startMarkerRef.current.setLngLat(startPoint);
        }
      } else if (startMarkerRef.current) {
        startMarkerRef.current.remove();
        startMarkerRef.current = null;
      }

      if (endPoint) {
        if (!endMarkerRef.current) {
          endMarkerRef.current = new mapboxgl.Marker({ color: "#dc2626" })
            .setLngLat(endPoint)
            .addTo(map);
        } else {
          endMarkerRef.current.setLngLat(endPoint);
        }
      } else if (endMarkerRef.current) {
        endMarkerRef.current.remove();
        endMarkerRef.current = null;
      }
    } catch (error) {
      setStatusText(`Map marker error: ${formatError(error)}`);
      console.error("Failed to update map markers:", error);
    }
  }, [startPoint, endPoint]);

  useEffect(() => {
    drawRoute(routeFeature?.geometry ?? null);

    if (routeFeature) {
      fitCoordinates(routeFeature.geometry.coordinates);
    }
  }, [drawRoute, fitCoordinates, routeFeature]);

  const canGenerate = Boolean(startPoint && endPoint && mapboxToken && !isGenerating);
  const canSave = Boolean(routeFeature && !isSaving);

  const startLabel = useMemo(() => formatCoordinate(startPoint), [startPoint]);
  const endLabel = useMemo(() => formatCoordinate(endPoint), [endPoint]);

  const onSelectMode = (nextMode: Exclude<ClickMode, null>): void => {
    if (!mapboxToken) {
      setStatusText("Missing Mapbox token. Set VITE_MAPBOX_TOKEN or MAPBOX_TOKEN.");
      return;
    }

    if (mode === nextMode) {
      setMode(null);
      setStatusText("Selection mode cleared.");
      return;
    }

    setMode(nextMode);
    setStatusText(`Click on the map to set ${nextMode === "start" ? "Start" : "End"}.`);
  };

  const onGenerateRoute = async (): Promise<void> => {
    if (!startPoint || !endPoint) {
      setStatusText("Set both start and end points before generating a route.");
      return;
    }

    if (!mapboxToken) {
      setStatusText("Missing Mapbox token. Set VITE_MAPBOX_TOKEN or MAPBOX_TOKEN.");
      return;
    }

    setIsGenerating(true);
    setStatusText("Generating walking route...");

    try {
      const coordinatesParam = `${startPoint[0]},${startPoint[1]};${endPoint[0]},${endPoint[1]}`;
      const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinatesParam}?geometries=geojson&overview=full&access_token=${encodeURIComponent(mapboxToken)}`;

      const response = await fetch(url);
      const payload = (await response.json()) as DirectionsResponse;

      if (!response.ok) {
        throw new Error(payload.message || `Directions API request failed (${response.status}).`);
      }

      const route = payload.routes?.[0];
      if (!route || !route.geometry?.coordinates?.length) {
        throw new Error("No route found for the selected points.");
      }

      const feature: RouteFeature = {
        type: "Feature",
        geometry: route.geometry,
        properties: {
          distance_m: route.distance,
          duration_s: route.duration,
          profile: "walking",
          start: startPoint,
          end: endPoint,
          generated_at: new Date().toISOString(),
        },
      };

      setRouteFeature(feature);
      setStatusText("Route ready.");
    } catch (error) {
      setRouteFeature(null);
      setStatusText(`Failed to generate route: ${formatError(error)}`);
    } finally {
      setIsGenerating(false);
    }
  };

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
    setMode(null);
    setStartPoint(null);
    setEndPoint(null);
    setRouteFeature(null);
    setStatusText("Cleared.");
  };

  return (
    <div className="app-shell">
      <aside className="control-panel">
        <h1>Canyon Route Editor</h1>

        <div className="button-grid">
          <button
            type="button"
            className={mode === "start" ? "active" : ""}
            onClick={() => onSelectMode("start")}
          >
            Set Start
          </button>
          <button
            type="button"
            className={mode === "end" ? "active" : ""}
            onClick={() => onSelectMode("end")}
          >
            Set End
          </button>
          <button type="button" onClick={() => void onGenerateRoute()} disabled={!canGenerate}>
            {isGenerating ? "Generating..." : "Generate Route"}
          </button>
          <button type="button" onClick={() => void onSaveGeoJSON()} disabled={!canSave}>
            {isSaving ? "Saving..." : "Save GeoJSON"}
          </button>
          <button type="button" onClick={onClear}>
            Clear
          </button>
        </div>

        <div className="coord-list">
          <p>
            <strong>Start:</strong> {startLabel}
          </p>
          <p>
            <strong>End:</strong> {endLabel}
          </p>
        </div>

        <p className="status-text">{statusText}</p>
      </aside>

      <main className="map-area">
        <div ref={mapContainerRef} className="map-container" />
      </main>
    </div>
  );
}
