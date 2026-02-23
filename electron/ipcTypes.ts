export type SaveGeoJSONResult = {
  canceled: boolean;
  filePath?: string;
};

export type LoadJsonResult = {
  canceled: boolean;
  filePath?: string;
  data?: unknown;
  error?: string;
};

export type SaveJsonRequest = {
  currentFilePath?: string | null;
  jsonString: string;
  canyonName?: string;
};

export type SaveJsonResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
};

export type RoutePointPayload = {
  id: string;
  type: "start" | "waypoint" | "end";
  coordinates: [number, number];
  segmentMode?: "route" | "straight";
};

export type RouteSegmentSummaryPayload = {
  index: number;
  from: [number, number];
  to: [number, number];
  mode: "route" | "straight";
  distance_m: number;
  duration_s: number;
  elevation_gain_m: number;
  failed: boolean;
  error?: string;
};

export type RoutePropertiesPayload = {
  distance_m: number;
  duration_s: number;
  profile: "walking";
  start: [number, number];
  end: [number, number];
  waypoints: Array<[number, number]>;
  segments: RouteSegmentSummaryPayload[];
  elevation_gain_m?: number;
  elevation_start_m?: number;
  elevation_end_m?: number;
  generated_at: string;
};

export type RouteFeaturePayload = {
  type: "Feature";
  geometry: {
    type: "LineString";
    coordinates: number[][];
  };
  properties: RoutePropertiesPayload;
};

export type MultiTrackItemPayload = {
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

export type TrackSnapshotPayload = {
  tracks: MultiTrackItemPayload[];
  activeTrackId: string | null;
  warnings: string[];
};

export type SaveCanyonWithTracksRequest = {
  currentFilePath?: string | null;
  canyonName?: string;
  canyonData: unknown;
  trackSnapshot?: TrackSnapshotPayload | null;
};

export type SaveCanyonWithTracksResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
  warnings?: string[];
  data?: unknown;
};

export type LoadTrackFilesRequest = {
  canyonFilePath?: string | null;
  tracks: Array<{
    id: string;
    kind: "section" | "access";
    filePath: string;
  }>;
};

export type LoadTrackFilesResult = {
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

export type PickFileFilter = {
  name: string;
  extensions: string[];
};

export type PickFileRequest = {
  baseDir?: string | null;
  defaultPath?: string | null;
  title?: string;
  filters?: PickFileFilter[];
};

export type PickFileResult = {
  canceled: boolean;
  absolutePath?: string;
  relativePath?: string;
};

export type CreateCanyonFolderRequest = {
  canyonName: string;
  initialSectionNames?: string[];
};

export type CreateCanyonFolderResult = {
  canceled: boolean;
  folderPath?: string;
  dataJsonPath?: string;
  error?: string;
};
