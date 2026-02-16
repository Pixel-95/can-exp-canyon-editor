import { contextBridge, ipcRenderer } from "electron";

type SaveGeoJSONResult = {
  canceled: boolean;
  filePath?: string;
};

type LoadJsonResult = {
  canceled: boolean;
  filePath?: string;
  data?: unknown;
  error?: string;
};

type SaveJsonResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
};

type SaveJsonRequest = {
  currentFilePath?: string | null;
  jsonString: string;
  canyonName?: string;
};

type PickFileRequest = {
  baseDir?: string | null;
  defaultPath?: string | null;
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
};

type PickFileResult = {
  canceled: boolean;
  absolutePath?: string;
  relativePath?: string;
};

type RoutePointPayload = {
  id: string;
  type: "start" | "waypoint" | "end";
  coordinates: [number, number];
  segmentMode?: "route" | "straight";
};

type RouteSegmentSummaryPayload = {
  index: number;
  from: [number, number];
  to: [number, number];
  mode: "route" | "straight";
  distance_m: number;
  duration_s: number;
  failed: boolean;
  error?: string;
};

type RoutePropertiesPayload = {
  distance_m: number;
  duration_s: number;
  profile: "walking";
  start: [number, number];
  end: [number, number];
  waypoints: Array<[number, number]>;
  segments: RouteSegmentSummaryPayload[];
  generated_at: string;
};

type RouteFeaturePayload = {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: number[][];
  };
  properties: RoutePropertiesPayload;
};

type MultiTrackItemPayload = {
  id: string;
  kind: "section" | "access";
  sectionIndex?: number;
  sectionId?: number;
  displayName: string;
  filePath: string;
  color: "orange" | "black";
  routePoints: RoutePointPayload[];
  routeFeature: RouteFeaturePayload | null;
  missingFile: boolean;
  legacyFormat: boolean;
  needsRebuild: boolean;
  rawFeatureProperties?: Record<string, unknown>;
};

type TrackSnapshotPayload = {
  tracks: MultiTrackItemPayload[];
  activeTrackId: string | null;
  warnings: string[];
};

type LoadTrackFilesRequest = {
  canyonFilePath?: string | null;
  tracks: Array<{
    id: string;
    kind: "section" | "access";
    filePath: string;
  }>;
};

type LoadTrackFilesResult = {
  entries: Array<{
    id: string;
    kind: "section" | "access";
    filePath: string;
    absolutePath?: string;
    missing: boolean;
    error?: string;
    data?: unknown;
  }>;
};

type SaveCanyonWithTracksRequest = {
  currentFilePath?: string | null;
  canyonName?: string;
  canyonData: unknown;
  trackSnapshot?: TrackSnapshotPayload | null;
};

type SaveCanyonWithTracksResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
  warnings?: string[];
  data?: unknown;
};

type CreateCanyonFolderResult = {
  canceled: boolean;
  folderPath?: string;
  dataJsonPath?: string;
  error?: string;
};

contextBridge.exposeInMainWorld("api", {
  getMapboxToken: (): Promise<string | null> =>
    ipcRenderer.invoke("config:get-mapbox-token"),
  saveGeoJSON: (
    filenameSuggestion: string,
    geojsonString: string,
  ): Promise<SaveGeoJSONResult> =>
    ipcRenderer.invoke("route:save-geojson", filenameSuggestion, geojsonString),
  loadJsonFromDialog: (): Promise<LoadJsonResult> =>
    ipcRenderer.invoke("json:load-dialog"),
  loadJsonFromPath: (requestedPath: string): Promise<LoadJsonResult> =>
    ipcRenderer.invoke("json:load-path", requestedPath),
  createNewJsonTemplate: (canyonName: string): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke("json:new-template", canyonName),
  createCanyonFolder: (canyonName: string): Promise<CreateCanyonFolderResult> =>
    ipcRenderer.invoke("json:create-canyon-folder", canyonName),
  saveJson: (request: SaveJsonRequest): Promise<SaveJsonResult> =>
    ipcRenderer.invoke("json:save", request),
  saveCanyonWithTracks: (request: SaveCanyonWithTracksRequest): Promise<SaveCanyonWithTracksResult> =>
    ipcRenderer.invoke("json:save-with-tracks", request),
  pickFile: (request: PickFileRequest): Promise<PickFileResult> =>
    ipcRenderer.invoke("json:pick-file", request),
  loadTrackFiles: (request: LoadTrackFilesRequest): Promise<LoadTrackFilesResult> =>
    ipcRenderer.invoke("tracks:load-batch", request),
});
