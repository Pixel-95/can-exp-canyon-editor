import "dotenv/config";

import { Menu, app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

type SaveJsonRequest = {
  currentFilePath?: string | null;
  jsonString: string;
  canyonName?: string;
};

type SaveJsonResult = {
  canceled: boolean;
  filePath?: string;
  error?: string;
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
  elevation_gain_m: number;
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
  elevation_gain_m?: number;
  elevation_start_m?: number;
  elevation_end_m?: number;
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

type PickFileFilter = {
  name: string;
  extensions: string[];
};

type PickFileRequest = {
  baseDir?: string | null;
  defaultPath?: string | null;
  title?: string;
  filters?: PickFileFilter[];
};

type PickFileResult = {
  canceled: boolean;
  absolutePath?: string;
  relativePath?: string;
};

type CreateCanyonFolderResult = {
  canceled: boolean;
  folderPath?: string;
  dataJsonPath?: string;
  error?: string;
};

const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

let mainWindow: BrowserWindow | null = null;

function resolveWindowIconPath(): string | undefined {
  const candidates = [
    path.join(app.getAppPath(), "build", "icon.png"),
    path.join(process.resourcesPath, "build", "icon.png"),
    path.join(process.resourcesPath, "icon.png"),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

function createWindow(): void {
  const iconPath = resolveWindowIconPath();
  const { workAreaSize } = screen.getPrimaryDisplay();
  const startupWidth = Math.max(1248, Math.floor(workAreaSize.width * 0.9));
  const startupHeight = Math.max(832, Math.floor(workAreaSize.height * 0.9));

  mainWindow = new BrowserWindow({
    title: "Canyon Editor",
    width: startupWidth,
    height: startupHeight,
    minWidth: 1248,
    minHeight: 832,
    show: false,
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone:", details);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("Renderer process became unresponsive.");
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, url) => {
    console.error("Renderer failed to load:", { errorCode, errorDescription, url });
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) {
      return;
    }

    mainWindow.maximize();
    mainWindow.show();
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    const indexPath = path.join(__dirname, "..", "renderer", "index.html");
    void mainWindow.loadFile(indexPath);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

function toAbsolutePath(requestedPath: string): string {
  if (path.isAbsolute(requestedPath)) {
    return path.normalize(requestedPath);
  }

  return path.resolve(process.cwd(), requestedPath);
}

function toRelativePath(baseDir: string, absolutePath: string): string {
  const relativePath = path.relative(baseDir, absolutePath);
  if (!relativePath) {
    return `.${path.sep}${path.basename(absolutePath)}`.split(path.sep).join("/");
  }

  const prefixed = relativePath.startsWith(".") ? relativePath : `.${path.sep}${relativePath}`;
  return prefixed.split(path.sep).join("/");
}

function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "canyon";
}

function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || "canyon";
}

function sanitizeTrackBaseName(name: string): string {
  const normalized = name.normalize("NFC");
  let cleaned = normalized
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/[. ]+$/g, "");

  if (!cleaned) {
    return "";
  }

  if (WINDOWS_RESERVED_NAMES.has(cleaned.toUpperCase())) {
    cleaned = `${cleaned}_file`;
  }

  return cleaned;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeAbsolutePathForCompare(absolutePath: string): string {
  const normalized = path.normalize(absolutePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function parseAccessTrackIndex(relativePath: string): number | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const match = /^\.\/tracks\/access_(\d+)\.json$/i.exec(normalized);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toTrackLink(fileName: string): string {
  return `./tracks/${fileName}`;
}

function normalizeTrackLink(link: string): string {
  const normalized = link.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }

  if (path.isAbsolute(normalized)) {
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

function resolveTrackAbsolutePath(canyonJsonPath: string, trackLink: string): string {
  if (path.isAbsolute(trackLink)) {
    return path.normalize(trackLink);
  }

  return path.resolve(path.dirname(canyonJsonPath), trackLink);
}

function toCoordinatePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return [Number(lng), Number(lat)];
}

function normalizeRoutePoints(points: RoutePointPayload[]): RoutePointPayload[] {
  if (points.length === 0) {
    return [];
  }

  if (points.length === 1) {
    const onlyPoint = points[0];
    return [
      {
        id: onlyPoint.id,
        type: onlyPoint.type === "end" ? "end" : "start",
        coordinates: onlyPoint.coordinates,
      },
    ];
  }

  return points.map((point, index) => {
    const type: RoutePointPayload["type"] =
      index === 0 ? "start" : index === points.length - 1 ? "end" : "waypoint";
    return {
      id: point.id,
      type,
      coordinates: point.coordinates,
      ...(index > 0 ? { segmentMode: point.segmentMode ?? "straight" } : {}),
    };
  });
}

function buildFallbackRoutePoints(track: MultiTrackItemPayload): RoutePointPayload[] {
  const fromTrackPoints = track.routePoints
    .map((point) => ({
      id: point.id,
      type: point.type,
      coordinates: point.coordinates,
      segmentMode: point.segmentMode,
    }))
    .filter((point) => toCoordinatePair(point.coordinates));

  if (fromTrackPoints.length > 0) {
    return normalizeRoutePoints(fromTrackPoints);
  }

  const geometryCoordinates = track.routeFeature?.geometry?.coordinates ?? [];
  const fromGeometry: RoutePointPayload[] = [];
  for (let index = 0; index < geometryCoordinates.length; index += 1) {
    const parsed = toCoordinatePair(geometryCoordinates[index]);
    if (!parsed) {
      continue;
    }

    fromGeometry.push({
      id: `fallback_${track.id}_${index}`,
      type: "waypoint",
      coordinates: parsed,
      segmentMode: "straight",
    });
  }

  return normalizeRoutePoints(fromGeometry);
}

function buildRouteFeatureCollection(
  track: MultiTrackItemPayload,
  displayName: string,
): { payload: Record<string, unknown>; incomplete: boolean } {
  const routePoints = buildFallbackRoutePoints(track);
  const routeFeature = track.routeFeature;

  const geometryCoordinatesRaw = routeFeature?.geometry?.coordinates ?? [];
  let geometryCoordinates = geometryCoordinatesRaw
    .map((coordinate) => toCoordinatePair(coordinate))
    .filter((coordinate): coordinate is [number, number] => coordinate !== null)
    .map((coordinate) => [coordinate[0], coordinate[1]]);

  if (geometryCoordinates.length === 0) {
    geometryCoordinates = routePoints.map((point) => [point.coordinates[0], point.coordinates[1]]);
  }

  const fallbackStart = routePoints[0]?.coordinates ?? toCoordinatePair(geometryCoordinates[0]) ?? [0, 0];
  const fallbackEnd =
    routePoints[routePoints.length - 1]?.coordinates ??
    toCoordinatePair(geometryCoordinates[geometryCoordinates.length - 1]) ??
    fallbackStart;
  const fallbackWaypoints =
    routePoints.length > 2 ? routePoints.slice(1, -1).map((point) => point.coordinates) : [];
  const fallbackSegments: RouteSegmentSummaryPayload[] = [];
  for (let index = 1; index < routePoints.length; index += 1) {
    const previous = routePoints[index - 1];
    const current = routePoints[index];
    if (!previous || !current) {
      continue;
    }

    fallbackSegments.push({
      index,
      from: previous.coordinates,
      to: current.coordinates,
      mode: current.segmentMode ?? "straight",
      distance_m: 0,
      duration_s: 0,
      elevation_gain_m: 0,
      failed: false,
    });
  }

  const rawFeatureProperties = isObjectRecord(track.rawFeatureProperties)
    ? cloneValue(track.rawFeatureProperties)
    : {};
  const candidateProperties = isObjectRecord(routeFeature?.properties)
    ? cloneValue(routeFeature.properties)
    : {};
  const start = toCoordinatePair((candidateProperties as Record<string, unknown>).start) ?? fallbackStart;
  const end = toCoordinatePair((candidateProperties as Record<string, unknown>).end) ?? fallbackEnd;

  const rawWaypoints = (candidateProperties as Record<string, unknown>).waypoints;
  const waypoints = Array.isArray(rawWaypoints)
    ? rawWaypoints
      .map((waypoint) => toCoordinatePair(waypoint))
      .filter((waypoint): waypoint is [number, number] => waypoint !== null)
    : fallbackWaypoints;

  const rawSegments = (candidateProperties as Record<string, unknown>).segments;
  const segments = Array.isArray(rawSegments)
    ? rawSegments
      .map((segment) => {
        if (!isObjectRecord(segment)) {
          return null;
        }

        const from = toCoordinatePair(segment.from);
        const to = toCoordinatePair(segment.to);
        if (!from || !to) {
          return null;
        }

        const mode = segment.mode === "route" ? "route" : "straight";
        return {
          index: Number.isFinite(Number(segment.index)) ? Number(segment.index) : 0,
          from,
          to,
          mode,
          distance_m: Number.isFinite(Number(segment.distance_m)) ? Number(segment.distance_m) : 0,
          duration_s: Number.isFinite(Number(segment.duration_s)) ? Number(segment.duration_s) : 0,
          elevation_gain_m: Number.isFinite(Number(segment.elevation_gain_m))
            ? Number(segment.elevation_gain_m)
            : 0,
          failed: Boolean(segment.failed),
          ...(typeof segment.error === "string" ? { error: segment.error } : {}),
        };
      })
      .filter((segment): segment is RouteSegmentSummaryPayload => segment !== null)
    : fallbackSegments;

  const properties = {
    ...rawFeatureProperties,
    ...candidateProperties,
    distance_m: Number.isFinite(Number((candidateProperties as Record<string, unknown>).distance_m))
      ? Number((candidateProperties as Record<string, unknown>).distance_m)
      : 0,
    duration_s: Number.isFinite(Number((candidateProperties as Record<string, unknown>).duration_s))
      ? Number((candidateProperties as Record<string, unknown>).duration_s)
      : 0,
    profile: "walking" as const,
    start,
    end,
    waypoints,
    segments,
    elevation_gain_m: Number.isFinite(Number((candidateProperties as Record<string, unknown>).elevation_gain_m))
      ? Number((candidateProperties as Record<string, unknown>).elevation_gain_m)
      : segments.reduce((sum, segment) => {
        const gain = Number(segment.elevation_gain_m);
        return Number.isFinite(gain) && gain > 0 ? sum + gain : sum;
      }, 0),
    generated_at:
      typeof (candidateProperties as Record<string, unknown>).generated_at === "string"
        ? String((candidateProperties as Record<string, unknown>).generated_at)
        : new Date().toISOString(),
    kind: track.kind,
    editor_display_name: displayName,
    name: displayName,
  };

  const payload: Record<string, unknown> = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties,
        geometry: {
          type: "LineString",
          coordinates: geometryCoordinates,
        },
      },
    ],
  };

  return {
    payload,
    incomplete: geometryCoordinates.length < 2,
  };
}

async function resolveJsonTargetPath(
  currentFilePath: string | null | undefined,
  canyonName: string | undefined,
): Promise<{ canceled: boolean; filePath?: string }> {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  let targetPath = currentFilePath?.trim() || "";

  if (targetPath && existsSync(targetPath)) {
    const decision = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Overwrite", "Save As...", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Save Canyon JSON",
      message: `Save changes to ${path.basename(targetPath)}?`,
      detail: "Choose Overwrite to keep the same file path, or Save As to choose a new path.",
    });

    if (decision.response === 2) {
      return { canceled: true };
    }

    if (decision.response === 1) {
      targetPath = "";
    }
  }

  if (!targetPath) {
    const fallbackDir = currentFilePath ? path.dirname(currentFilePath) : process.cwd();
    const filename = `${sanitizeFileName(canyonName ?? "canyon")}.json`;
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: "Save Canyon JSON",
      defaultPath: path.join(fallbackDir, filename),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    targetPath = saveResult.filePath;
  }

  return {
    canceled: false,
    filePath: path.normalize(targetPath),
  };
}

function resolveUniqueSectionFileName(options: {
  tracksDir: string;
  baseName: string;
  previousAbsolutePath: string | null;
  usedAbsolutePaths: Set<string>;
  knownOwnedAbsolutePaths: Set<string>;
}): { fileName: string; absolutePath: string } {
  const { tracksDir, baseName, previousAbsolutePath, usedAbsolutePaths, knownOwnedAbsolutePaths } = options;
  const normalizedPrevious = previousAbsolutePath
    ? normalizeAbsolutePathForCompare(previousAbsolutePath)
    : null;

  let suffix = 0;
  while (true) {
    const candidateBaseName =
      suffix === 0 ? baseName : `${baseName}_${String(suffix).padStart(2, "0")}`;
    const fileName = `${candidateBaseName}.json`;
    const absolutePath = path.join(tracksDir, fileName);
    const comparable = normalizeAbsolutePathForCompare(absolutePath);

    if (usedAbsolutePaths.has(comparable)) {
      suffix += 1;
      continue;
    }

    const existsOnDisk = existsSync(absolutePath);
    const sameAsPrevious = normalizedPrevious !== null && normalizedPrevious === comparable;
    const belongsToKnownTrack = knownOwnedAbsolutePaths.has(comparable);
    if (existsOnDisk && !sameAsPrevious && !belongsToKnownTrack) {
      suffix += 1;
      continue;
    }

    usedAbsolutePaths.add(comparable);
    return { fileName, absolutePath };
  }
}

function resolveAccessFileName(options: {
  tracksDir: string;
  preferredIndex: number | null;
  nextIndexRef: { value: number };
  previousAbsolutePath: string | null;
  usedAbsolutePaths: Set<string>;
  knownOwnedAbsolutePaths: Set<string>;
}): { fileName: string; absolutePath: string } {
  const {
    tracksDir,
    preferredIndex,
    nextIndexRef,
    previousAbsolutePath,
    usedAbsolutePaths,
    knownOwnedAbsolutePaths,
  } = options;
  const normalizedPrevious = previousAbsolutePath
    ? normalizeAbsolutePathForCompare(previousAbsolutePath)
    : null;

  const tryIndices: number[] = [];
  if (preferredIndex !== null && preferredIndex > 0) {
    tryIndices.push(preferredIndex);
  }
  let runningIndex = Math.max(nextIndexRef.value, 1);
  while (tryIndices.length < 500) {
    tryIndices.push(runningIndex);
    runningIndex += 1;
  }

  for (const candidateIndex of tryIndices) {
    const fileName = `access_${String(candidateIndex).padStart(2, "0")}.json`;
    const absolutePath = path.join(tracksDir, fileName);
    const comparable = normalizeAbsolutePathForCompare(absolutePath);

    if (usedAbsolutePaths.has(comparable)) {
      continue;
    }

    const existsOnDisk = existsSync(absolutePath);
    const sameAsPrevious = normalizedPrevious !== null && normalizedPrevious === comparable;
    const belongsToKnownTrack = knownOwnedAbsolutePaths.has(comparable);
    if (existsOnDisk && !sameAsPrevious && !belongsToKnownTrack) {
      continue;
    }

    usedAbsolutePaths.add(comparable);
    nextIndexRef.value = Math.max(nextIndexRef.value, candidateIndex + 1);
    return { fileName, absolutePath };
  }

  throw new Error("Could not allocate a unique access track filename.");
}

function createNewJsonTemplate(canyonName: string): Record<string, unknown> {
  const name = canyonName.trim() || "New Canyon";

  return {
    id: null,
    coordinates: [0, 0],
    name,
    description: {
      en: "",
    },
    location: {
      country_code: "",
      region_code: "",
    },
    parking_lots: [],
    points_of_interest: [],
    tracks_access: [],
    cover_image: null,
    sections: [],
  };
}

async function loadJsonFromFile(filePath: string): Promise<LoadJsonResult> {
  try {
    const jsonString = await readFile(filePath, "utf8");
    const parsed = JSON.parse(jsonString) as unknown;
    return {
      canceled: false,
      filePath,
      data: parsed,
    };
  } catch (error) {
    return {
      canceled: false,
      filePath,
      error: toErrorMessage(error),
    };
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in main process:", reason);
});

ipcMain.handle("config:get-mapbox-token", () => {
  return process.env.MAPBOX_TOKEN ?? null;
});

ipcMain.handle(
  "route:save-geojson",
  async (
    _event,
    filenameSuggestion: string,
    geojsonString: string,
  ): Promise<SaveGeoJSONResult> => {
    if (!mainWindow) {
      throw new Error("Application window is not ready.");
    }

    if (!geojsonString) {
      throw new Error("No GeoJSON payload was provided.");
    }

    const normalizedFilename = filenameSuggestion.endsWith(".geojson")
      ? filenameSuggestion
      : `${filenameSuggestion}.geojson`;

    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: "Save Route GeoJSON",
      defaultPath: normalizedFilename,
      filters: [{ name: "GeoJSON", extensions: ["geojson"] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    await writeFile(saveResult.filePath, geojsonString, "utf8");

    return {
      canceled: false,
      filePath: saveResult.filePath,
    };
  },
);

ipcMain.handle("json:load-dialog", async (): Promise<LoadJsonResult> => {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  const openResult = await dialog.showOpenDialog(mainWindow, {
    title: "Load Canyon JSON",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { canceled: true };
  }

  return loadJsonFromFile(openResult.filePaths[0]);
});

ipcMain.handle("json:load-path", async (_event, requestedPath: string): Promise<LoadJsonResult> => {
  if (!requestedPath || !requestedPath.trim()) {
    return {
      canceled: false,
      error: "No JSON path was provided.",
    };
  }

  const absolutePath = toAbsolutePath(requestedPath.trim());
  return loadJsonFromFile(absolutePath);
});

ipcMain.handle("json:new-template", (_event, canyonName: string): Record<string, unknown> => {
  return createNewJsonTemplate(canyonName ?? "");
});

ipcMain.handle(
  "json:create-canyon-folder",
  async (_event, canyonName: string): Promise<CreateCanyonFolderResult> => {
    const rawName = typeof canyonName === "string" ? canyonName.trim() : "";
    if (!rawName) {
      return {
        canceled: false,
        error: "Canyon name is required.",
      };
    }

    const folderName = sanitizeFolderName(rawName);
    const folderPath = path.join(process.cwd(), "data", folderName);
    if (existsSync(folderPath)) {
      return {
        canceled: false,
        error: `Target folder already exists: ${folderPath}`,
      };
    }

    try {
      await mkdir(folderPath, { recursive: true });
      return {
        canceled: false,
        folderPath,
        dataJsonPath: path.join(folderPath, "data.json"),
      };
    } catch (error) {
      return {
        canceled: false,
        error: toErrorMessage(error),
      };
    }
  },
);

ipcMain.handle("json:save", async (_event, request: SaveJsonRequest): Promise<SaveJsonResult> => {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  if (!request || !request.jsonString) {
    throw new Error("No JSON payload was provided.");
  }

  const target = await resolveJsonTargetPath(request.currentFilePath ?? null, request.canyonName);
  if (target.canceled || !target.filePath) {
    return { canceled: true };
  }

  try {
    await writeFile(target.filePath, request.jsonString, "utf8");
    return {
      canceled: false,
      filePath: target.filePath,
    };
  } catch (error) {
    return {
      canceled: false,
      filePath: target.filePath,
      error: toErrorMessage(error),
    };
  }
});

ipcMain.handle(
  "tracks:load-batch",
  async (_event, request: LoadTrackFilesRequest): Promise<LoadTrackFilesResult> => {
    const canyonFilePath = request?.canyonFilePath?.trim() || "";
    const hasCanyonPath = Boolean(canyonFilePath);
    const entries: LoadTrackFilesResult["entries"] = [];

    for (const requestedTrack of request?.tracks ?? []) {
      const normalizedLink = normalizeTrackLink(requestedTrack.filePath ?? "");
      if (!normalizedLink) {
        entries.push({
          id: requestedTrack.id,
          kind: requestedTrack.kind,
          filePath: requestedTrack.filePath,
          missing: true,
          error: "No track path is linked.",
        });
        continue;
      }

      if (!hasCanyonPath && !path.isAbsolute(normalizedLink)) {
        entries.push({
          id: requestedTrack.id,
          kind: requestedTrack.kind,
          filePath: normalizedLink,
          missing: true,
          error: "Canyon file path is required to resolve relative track links.",
        });
        continue;
      }

      const absolutePath = hasCanyonPath
        ? resolveTrackAbsolutePath(canyonFilePath, normalizedLink)
        : path.normalize(normalizedLink);
      if (!existsSync(absolutePath)) {
        entries.push({
          id: requestedTrack.id,
          kind: requestedTrack.kind,
          filePath: normalizedLink,
          absolutePath,
          missing: true,
          error: `Track file not found: ${normalizedLink}`,
        });
        continue;
      }

      try {
        const raw = await readFile(absolutePath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        entries.push({
          id: requestedTrack.id,
          kind: requestedTrack.kind,
          filePath: normalizedLink,
          absolutePath,
          missing: false,
          data: parsed,
        });
      } catch (error) {
        entries.push({
          id: requestedTrack.id,
          kind: requestedTrack.kind,
          filePath: normalizedLink,
          absolutePath,
          missing: true,
          error: toErrorMessage(error),
        });
      }
    }

    return { entries };
  },
);

ipcMain.handle(
  "json:save-with-tracks",
  async (_event, request: SaveCanyonWithTracksRequest): Promise<SaveCanyonWithTracksResult> => {
    if (!mainWindow) {
      throw new Error("Application window is not ready.");
    }

    if (!request || !isObjectRecord(request.canyonData)) {
      throw new Error("No canyon JSON payload was provided.");
    }

    const target = await resolveJsonTargetPath(request.currentFilePath ?? null, request.canyonName);
    if (target.canceled || !target.filePath) {
      return { canceled: true };
    }

    const warnings: string[] = [...(request.trackSnapshot?.warnings ?? [])];

    try {
      const targetJsonPath = target.filePath;
      const targetJsonDirectory = path.dirname(targetJsonPath);
      const tracksDirectory = path.join(targetJsonDirectory, "tracks");
      await mkdir(tracksDirectory, { recursive: true });

      const nextData = cloneValue(request.canyonData);
      const sectionsValue = Array.isArray(nextData.sections) ? nextData.sections : [];
      const tracksAccessValue = Array.isArray(nextData.tracks_access) ? nextData.tracks_access : [];

      const snapshotTracks = request.trackSnapshot?.tracks ?? [];
      const sectionTracksByIndex = new Map<number, MultiTrackItemPayload>();
      const accessTracksInOrder: MultiTrackItemPayload[] = [];

      for (const track of snapshotTracks) {
        if (track.kind === "section" && Number.isInteger(track.sectionIndex)) {
          sectionTracksByIndex.set(Number(track.sectionIndex), track);
          continue;
        }

        if (track.kind === "access") {
          accessTracksInOrder.push(track);
        }
      }

      if (accessTracksInOrder.length === 0) {
        for (let index = 0; index < tracksAccessValue.length; index += 1) {
          const entry = tracksAccessValue[index];
          if (typeof entry !== "string") {
            continue;
          }

          accessTracksInOrder.push({
            id: `access_fallback_${index}`,
            kind: "access",
            displayName: `Access ${index + 1}`,
            filePath: entry,
            color: "black",
            routePoints: [],
            routeFeature: null,
            missingFile: false,
            legacyFormat: false,
            needsRebuild: false,
          });
        }
      }

      const knownOwnedAbsolutePaths = new Set<string>();
      for (const track of snapshotTracks) {
        const normalizedLink = normalizeTrackLink(track.filePath);
        if (!normalizedLink) {
          continue;
        }

        const absolutePath = resolveTrackAbsolutePath(targetJsonPath, normalizedLink);
        knownOwnedAbsolutePaths.add(normalizeAbsolutePathForCompare(absolutePath));
      }

      const usedAbsolutePaths = new Set<string>();
      const pendingTrackWrites: Array<{ absolutePath: string; payload: string }> = [];

      const sectionBaseNames = sectionsValue.map((section, index) => {
        if (!isObjectRecord(section)) {
          return `section_${index}`;
        }

        const sectionName = typeof section.name === "string" ? section.name : "";
        const sectionId = Number.isFinite(Number(section.id)) ? Number(section.id) : index;
        const sanitized = sanitizeTrackBaseName(sectionName);
        return sanitized || `section_${sectionId}`;
      });
      const sectionBaseNameCounts = new Map<string, number>();
      for (const baseName of sectionBaseNames) {
        sectionBaseNameCounts.set(baseName, (sectionBaseNameCounts.get(baseName) ?? 0) + 1);
      }

      for (let sectionIndex = 0; sectionIndex < sectionsValue.length; sectionIndex += 1) {
        const sectionEntry = sectionsValue[sectionIndex];
        if (!isObjectRecord(sectionEntry)) {
          continue;
        }

        const sectionTrack = sectionTracksByIndex.get(sectionIndex) ?? null;
        const sectionName = typeof sectionEntry.name === "string" ? sectionEntry.name : `Section ${sectionIndex + 1}`;
        const sectionId = Number.isFinite(Number(sectionEntry.id)) ? Number(sectionEntry.id) : sectionIndex;

        let baseName = sectionBaseNames[sectionIndex] ?? `section_${sectionId}`;
        if ((sectionBaseNameCounts.get(baseName) ?? 0) > 1) {
          baseName = `${baseName}_section_${sectionId}`;
        }

        const previousLinkFromTrack = sectionTrack ? normalizeTrackLink(sectionTrack.filePath) : "";
        const previousLinkFromData =
          typeof sectionEntry.track_canyon === "string" ? normalizeTrackLink(sectionEntry.track_canyon) : "";
        const previousLink = previousLinkFromTrack || previousLinkFromData;
        const previousAbsolutePath = previousLink
          ? resolveTrackAbsolutePath(targetJsonPath, previousLink)
          : null;

        const resolved = resolveUniqueSectionFileName({
          tracksDir: tracksDirectory,
          baseName,
          previousAbsolutePath,
          usedAbsolutePaths,
          knownOwnedAbsolutePaths,
        });
        const link = toTrackLink(resolved.fileName);
        sectionEntry.track_canyon = link;

        const logicalTrack: MultiTrackItemPayload = sectionTrack ?? {
          id: `section_fallback_${sectionIndex}`,
          kind: "section",
          sectionIndex,
          sectionId,
          displayName: sectionName,
          filePath: link,
          color: "orange",
          routePoints: [],
          routeFeature: null,
          missingFile: false,
          legacyFormat: false,
          needsRebuild: false,
        };
        const trackPayload = buildRouteFeatureCollection(logicalTrack, sectionName);
        if (trackPayload.incomplete) {
          warnings.push(`Section track "${sectionName}" has fewer than 2 coordinates.`);
        }

        pendingTrackWrites.push({
          absolutePath: resolved.absolutePath,
          payload: JSON.stringify(trackPayload.payload, null, 2),
        });
      }

      const usedAccessIndices = new Set<number>();
      for (const entry of tracksAccessValue) {
        if (typeof entry !== "string") {
          continue;
        }

        const parsed = parseAccessTrackIndex(entry);
        if (parsed !== null) {
          usedAccessIndices.add(parsed);
        }
      }

      const nextAccessIndexRef = {
        value: Math.max(...Array.from(usedAccessIndices), 0) + 1,
      };

      const nextTracksAccess: string[] = [];
      for (let accessIndex = 0; accessIndex < accessTracksInOrder.length; accessIndex += 1) {
        const accessTrack = accessTracksInOrder[accessIndex];
        const displayName = accessTrack.displayName?.trim() || `Access ${accessIndex + 1}`;
        const previousLink = normalizeTrackLink(accessTrack.filePath);
        const previousAbsolutePath = previousLink
          ? resolveTrackAbsolutePath(targetJsonPath, previousLink)
          : null;
        const preferredIndex = parseAccessTrackIndex(previousLink);
        if (preferredIndex !== null) {
          usedAccessIndices.add(preferredIndex);
        }

        const resolved = resolveAccessFileName({
          tracksDir: tracksDirectory,
          preferredIndex,
          nextIndexRef: nextAccessIndexRef,
          previousAbsolutePath,
          usedAbsolutePaths,
          knownOwnedAbsolutePaths,
        });
        const link = toTrackLink(resolved.fileName);
        nextTracksAccess.push(link);

        const trackPayload = buildRouteFeatureCollection(
          {
            ...accessTrack,
            filePath: link,
          },
          displayName,
        );
        if (trackPayload.incomplete) {
          warnings.push(`Access track "${displayName}" has fewer than 2 coordinates.`);
        }

        pendingTrackWrites.push({
          absolutePath: resolved.absolutePath,
          payload: JSON.stringify(trackPayload.payload, null, 2),
        });
      }
      nextData.tracks_access = nextTracksAccess;

      for (const pendingWrite of pendingTrackWrites) {
        await writeFile(pendingWrite.absolutePath, pendingWrite.payload, "utf8");
      }

      await writeFile(targetJsonPath, JSON.stringify(nextData, null, 2), "utf8");
      return {
        canceled: false,
        filePath: targetJsonPath,
        warnings,
        data: nextData,
      };
    } catch (error) {
      return {
        canceled: false,
        filePath: target.filePath,
        error: toErrorMessage(error),
      };
    }
  },
);

ipcMain.handle("json:pick-file", async (_event, request: PickFileRequest): Promise<PickFileResult> => {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  const openResult = await dialog.showOpenDialog(mainWindow, {
    title: request?.title ?? "Select file",
    defaultPath:
      request?.defaultPath && request.defaultPath.trim()
        ? toAbsolutePath(request.defaultPath.trim())
        : undefined,
    properties: ["openFile"],
    filters: request?.filters?.length
      ? request.filters
      : [{ name: "All Files", extensions: ["*"] }],
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const absolutePath = openResult.filePaths[0];
  const baseDir = request?.baseDir && request.baseDir.trim()
    ? toAbsolutePath(request.baseDir)
    : process.cwd();
  const relativePath = toRelativePath(baseDir, absolutePath);

  return {
    canceled: false,
    absolutePath,
    relativePath,
  };
});

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
