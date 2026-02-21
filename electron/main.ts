import "dotenv/config";

import { Menu, app, BrowserWindow, dialog, ipcMain, screen } from "electron";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cloneValue,
  isObjectRecord,
  normalizeAbsolutePathForCompare,
  normalizeRoutePoints,
  normalizeTrackLink,
  resolveTrackAbsolutePath,
  sanitizeFolderName,
  sanitizeTrackBaseName,
  toAbsolutePath,
  toCoordinatePair,
  toErrorMessage,
  toRelativePath,
  toTrackLink,
} from "./mainUtils";
import type {
  CreateCanyonFolderResult,
  LoadJsonResult,
  LoadTrackFilesRequest,
  LoadTrackFilesResult,
  MultiTrackItemPayload,
  PickFileRequest,
  PickFileResult,
  RoutePointPayload,
  RouteSegmentSummaryPayload,
  SaveCanyonWithTracksRequest,
  SaveCanyonWithTracksResult,
  SaveGeoJSONResult,
  SaveJsonRequest,
  SaveJsonResult,
} from "./ipcTypes";

let mainWindow: BrowserWindow | null = null;
const CANYON_JSON_FILENAME = "data.json";

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
  _canyonName: string | undefined,
): Promise<{ canceled: boolean; filePath?: string }> {
  if (!mainWindow) {
    throw new Error("Application window is not ready.");
  }

  const normalizeToDataJsonPath = (candidatePath: string): string => {
    const normalized = path.normalize(candidatePath);
    if (path.basename(normalized).toLowerCase() === CANYON_JSON_FILENAME) {
      return normalized;
    }

    return path.join(path.dirname(normalized), CANYON_JSON_FILENAME);
  };

  let targetPath = currentFilePath?.trim() ? normalizeToDataJsonPath(currentFilePath.trim()) : "";

  if (!targetPath) {
    const fallbackDir = currentFilePath ? path.dirname(currentFilePath) : process.cwd();
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: "Save Canyon JSON",
      defaultPath: path.join(fallbackDir, CANYON_JSON_FILENAME),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    targetPath = normalizeToDataJsonPath(saveResult.filePath);
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

function resolveSaveCanyonName(
  canyonData: Record<string, unknown>,
  fallbackName: string | undefined,
): string {
  if (typeof canyonData.name === "string" && canyonData.name.trim()) {
    return canyonData.name.trim();
  }

  if (typeof fallbackName === "string" && fallbackName.trim()) {
    return fallbackName.trim();
  }

  return "";
}

async function maybeRenameCanyonFolderOnSave(options: {
  currentFilePath: string | null | undefined;
  targetJsonPath: string;
  canyonName: string;
}): Promise<string> {
  const { currentFilePath, targetJsonPath, canyonName } = options;
  const normalizedCurrent = currentFilePath?.trim() ? path.normalize(currentFilePath.trim()) : "";
  const normalizedTarget = path.normalize(targetJsonPath);

  if (!normalizedCurrent) {
    return normalizedTarget;
  }

  if (path.basename(normalizedCurrent).toLowerCase() !== CANYON_JSON_FILENAME) {
    return normalizedTarget;
  }

  if (path.basename(normalizedTarget).toLowerCase() !== CANYON_JSON_FILENAME) {
    return normalizedTarget;
  }

  const currentDirectory = path.dirname(normalizedCurrent);
  const targetDirectory = path.dirname(normalizedTarget);
  if (normalizeAbsolutePathForCompare(currentDirectory) !== normalizeAbsolutePathForCompare(targetDirectory)) {
    return normalizedTarget;
  }

  const rawName = canyonName.trim();
  if (!rawName) {
    return normalizedTarget;
  }

  const desiredFolderName = sanitizeFolderName(rawName);
  const currentFolderPath = targetDirectory;
  const currentFolderName = path.basename(currentFolderPath);
  if (desiredFolderName === currentFolderName) {
    return normalizedTarget;
  }

  const parentDirectory = path.dirname(currentFolderPath);
  const nextFolderPath = path.join(parentDirectory, desiredFolderName);
  if (normalizeAbsolutePathForCompare(nextFolderPath) === normalizeAbsolutePathForCompare(currentFolderPath)) {
    return normalizedTarget;
  }

  if (existsSync(nextFolderPath)) {
    throw new Error(`Target folder already exists and cannot be used: ${nextFolderPath}`);
  }

  await rename(currentFolderPath, nextFolderPath);
  return path.join(nextFolderPath, CANYON_JSON_FILENAME);
}

function createNewJsonTemplate(canyonName: string): Record<string, unknown> {
  const name = canyonName.trim() || "New Canyon";

  return {
    id: null,
    coordinates: null,
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

  const defaultDataDirectory = path.join(process.cwd(), "data");
  const defaultOpenDirectory = existsSync(defaultDataDirectory) ? defaultDataDirectory : process.cwd();
  const openResult = await dialog.showOpenDialog(mainWindow, {
    title: "Load Canyon JSON",
    defaultPath: defaultOpenDirectory,
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (openResult.canceled || openResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const selectedPath = openResult.filePaths[0];
  if (path.basename(selectedPath).toLowerCase() !== CANYON_JSON_FILENAME) {
    return {
      canceled: false,
      error: `Please select a canyon file named ${CANYON_JSON_FILENAME}.`,
    };
  }

  return loadJsonFromFile(selectedPath);
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
      await Promise.all([
        mkdir(path.join(folderPath, "topos"), { recursive: true }),
        mkdir(path.join(folderPath, "tracks"), { recursive: true }),
      ]);
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
    let targetJsonPath = target.filePath;

    try {
      const canyonNameForSave = resolveSaveCanyonName(request.canyonData, request.canyonName);
      targetJsonPath = await maybeRenameCanyonFolderOnSave({
        currentFilePath: request.currentFilePath ?? null,
        targetJsonPath,
        canyonName: canyonNameForSave,
      });

      const targetJsonDirectory = path.dirname(targetJsonPath);
      const tracksDirectory = path.join(targetJsonDirectory, "tracks");

      const nextData = cloneValue(request.canyonData);
      const sectionsValue = Array.isArray(nextData.sections) ? nextData.sections : [];
      const tracksAccessValue = Array.isArray(nextData.tracks_access) ? nextData.tracks_access : [];

      const snapshotTracks = request.trackSnapshot?.tracks ?? [];
      if (snapshotTracks.length === 0) {
        const hasLinkedTracks =
          sectionsValue.some(
            (entry) => isObjectRecord(entry) && typeof entry.track_canyon === "string" && entry.track_canyon.trim(),
          ) || tracksAccessValue.some((entry) => typeof entry === "string" && entry.trim());
        if (hasLinkedTracks) {
          warnings.push("Track snapshot was not available. Existing track files and links were preserved.");
        }

        await writeFile(targetJsonPath, JSON.stringify(nextData, null, 2), "utf8");
        return {
          canceled: false,
          filePath: targetJsonPath,
          warnings,
          data: nextData,
        };
      }

      await mkdir(tracksDirectory, { recursive: true });

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
        if (!sectionTrack) {
          const preservedLink =
            typeof sectionEntry.track_canyon === "string"
              ? normalizeTrackLink(sectionEntry.track_canyon)
              : "";
          if (preservedLink) {
            sectionEntry.track_canyon = preservedLink;
            const preservedAbsolutePath = resolveTrackAbsolutePath(targetJsonPath, preservedLink);
            usedAbsolutePaths.add(normalizeAbsolutePathForCompare(preservedAbsolutePath));
          }
          continue;
        }

        const sectionName = typeof sectionEntry.name === "string" ? sectionEntry.name : `Section ${sectionIndex + 1}`;
        const sectionId = Number.isFinite(Number(sectionEntry.id)) ? Number(sectionEntry.id) : sectionIndex;

        let baseName = sectionBaseNames[sectionIndex] ?? `section_${sectionId}`;
        if ((sectionBaseNameCounts.get(baseName) ?? 0) > 1) {
          baseName = `${baseName}_section_${sectionId}`;
        }

        const previousLinkFromTrack = normalizeTrackLink(sectionTrack.filePath);
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

        const logicalTrack: MultiTrackItemPayload = {
          ...sectionTrack,
          filePath: link,
          sectionIndex,
          sectionId,
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

      const nextTracksAccess: string[] = [];
      for (let accessIndex = 0; accessIndex < accessTracksInOrder.length; accessIndex += 1) {
        const accessTrack = accessTracksInOrder[accessIndex];
        const displayName = accessTrack.displayName?.trim() || `Access ${accessIndex + 1}`;
        const baseName = sanitizeTrackBaseName(displayName) || `access_track_${accessIndex + 1}`;
        const previousLink = normalizeTrackLink(accessTrack.filePath);
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
        filePath: targetJsonPath,
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
