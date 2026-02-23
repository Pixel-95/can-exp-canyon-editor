import { existsSync } from "node:fs";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";
import type { MultiTrackItemPayload, RoutePointPayload } from "./ipcTypes";

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

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

type RuntimeRootOptions = {
  isPackaged: boolean;
  platform: NodeJS.Platform;
  cwd: string;
  execPath: string;
  portableExecutableDir?: string | null;
};

export function getRuntimeRootDir(options: RuntimeRootOptions): string {
  const { isPackaged, platform, cwd, execPath, portableExecutableDir } = options;
  if (!isPackaged) {
    return path.normalize(cwd);
  }

  if (portableExecutableDir && portableExecutableDir.trim()) {
    return path.normalize(portableExecutableDir.trim());
  }

  if (platform === "darwin") {
    const executableDir = path.dirname(execPath);
    const contentsDir = path.dirname(executableDir);
    const appBundleDir = path.dirname(contentsDir);
    if (path.basename(appBundleDir).toLowerCase().endsWith(".app")) {
      return path.dirname(appBundleDir);
    }
  }

  return path.dirname(execPath);
}

export function getCanyonDataDirectory(runtimeRootDir: string): string {
  return path.join(runtimeRootDir, "data");
}

export function getCanyonFolderPath(runtimeRootDir: string, canyonName: string): string {
  return path.join(getCanyonDataDirectory(runtimeRootDir), sanitizeFolderName(canyonName));
}

export function toAbsolutePath(requestedPath: string, baseDir = process.cwd()): string {
  if (path.isAbsolute(requestedPath)) {
    return path.normalize(requestedPath);
  }

  return path.resolve(baseDir, requestedPath);
}

export function toRelativePath(baseDir: string, absolutePath: string): string {
  const relativePath = path.relative(baseDir, absolutePath);
  if (!relativePath) {
    return `.${path.sep}${path.basename(absolutePath)}`.split(path.sep).join("/");
  }

  const prefixed = relativePath.startsWith(".") ? relativePath : `.${path.sep}${relativePath}`;
  return prefixed.split(path.sep).join("/");
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned || "canyon";
}

export function sanitizeFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return cleaned || "canyon";
}

export function sanitizeTrackBaseName(name: string): string {
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

export type PictureSectionDescriptor = {
  index: number;
  sectionId: number;
  name: string;
};

function resolveUniqueFolderName(baseName: string, usedNames: Set<string>): string {
  const normalizedBaseName = baseName.trim() || "section";
  if (!usedNames.has(normalizedBaseName)) {
    return normalizedBaseName;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${normalizedBaseName}_${String(suffix).padStart(2, "0")}`;
    if (!usedNames.has(candidate)) {
      return candidate;
    }

    suffix += 1;
  }
}

export function sanitizeSectionPictureFolderName(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  return normalized
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function planSectionPictureFolderNames(
  sections: PictureSectionDescriptor[],
  reservedNames: Iterable<string> = [],
): string[] {
  const blockedNames = new Set<string>(["_cover"]);
  for (const reservedName of reservedNames) {
    if (!reservedName || !reservedName.trim()) {
      continue;
    }

    blockedNames.add(reservedName.trim());
  }

  const primaryNames = sections.map((section) => {
    const sanitized = sanitizeSectionPictureFolderName(section.name);
    return sanitized || `section_${section.sectionId}`;
  });

  const primaryNameCounts = new Map<string, number>();
  for (const primaryName of primaryNames) {
    primaryNameCounts.set(primaryName, (primaryNameCounts.get(primaryName) ?? 0) + 1);
  }

  const usedNames = new Set<string>(blockedNames);
  return sections.map((section, index) => {
    const primaryName = primaryNames[index] ?? `section_${section.sectionId}`;
    const hasCollision = (primaryNameCounts.get(primaryName) ?? 0) > 1;
    const collisionSafeBaseName = hasCollision
      ? `${primaryName}_section_${section.sectionId}`
      : primaryName;
    const resolved = resolveUniqueFolderName(collisionSafeBaseName, usedNames);
    usedNames.add(resolved);
    return resolved;
  });
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function extractSectionPictureDescriptors(canyonData: Record<string, unknown>): PictureSectionDescriptor[] {
  const sections = Array.isArray(canyonData.sections) ? canyonData.sections : [];
  const descriptors: PictureSectionDescriptor[] = [];

  for (let index = 0; index < sections.length; index += 1) {
    const rawSection = sections[index];
    if (!isObjectRecord(rawSection)) {
      descriptors.push({
        index,
        sectionId: index,
        name: "",
      });
      continue;
    }

    const sectionId = Number.isFinite(Number(rawSection.id)) ? Number(rawSection.id) : index;
    const name = typeof rawSection.name === "string" ? rawSection.name : "";
    descriptors.push({
      index,
      sectionId,
      name,
    });
  }

  return descriptors;
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeAbsolutePathForCompare(absolutePath: string): string {
  const normalized = path.normalize(absolutePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function parseAccessTrackIndex(relativePath: string): number | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const match = /^\.\/tracks\/access_(\d+)\.json$/i.exec(normalized);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toTrackLink(fileName: string): string {
  return `./tracks/${fileName}`;
}

export function normalizeTrackLink(link: string): string {
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

export function resolveTrackAbsolutePath(canyonJsonPath: string, trackLink: string): string {
  if (path.isAbsolute(trackLink)) {
    return path.normalize(trackLink);
  }

  return path.resolve(path.dirname(canyonJsonPath), trackLink);
}

export function normalizeSectionTopoForSave(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim() ? value : null;
}

export function toCoordinatePair(value: unknown): [number, number] | null {
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

export function normalizeRoutePoints(points: RoutePointPayload[]): RoutePointPayload[] {
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

async function readDirectoryNames(directoryPath: string): Promise<Set<string>> {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return new Set(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return new Set();
    }

    throw error;
  }
}

function buildLegacySectionFolderCandidates(
  section: PictureSectionDescriptor,
  plannedFolderName: string,
): string[] {
  const trimmedName = section.name.trim();
  const candidates = [
    plannedFolderName,
    sanitizeSectionPictureFolderName(trimmedName),
    trimmedName ? sanitizeFolderName(trimmedName) : "",
    trimmedName,
  ];

  const seenNames = new Set<string>();
  const deduplicated: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || !candidate.trim()) {
      continue;
    }

    const normalizedCandidate = candidate.trim();
    if (normalizedCandidate === "_cover" || seenNames.has(normalizedCandidate)) {
      continue;
    }

    seenNames.add(normalizedCandidate);
    deduplicated.push(normalizedCandidate);
  }

  return deduplicated;
}

function resolvePreviousSectionSourceFolders(options: {
  previousSections: PictureSectionDescriptor[];
  previousPlannedFolderNames: string[];
  existingFolderNames: Set<string>;
}): Map<number, string> {
  const sourceBySectionIndex = new Map<number, string>();
  const usedSourceNames = new Set<string>();
  const { previousSections, previousPlannedFolderNames, existingFolderNames } = options;

  for (let index = 0; index < previousSections.length; index += 1) {
    const section = previousSections[index];
    const plannedFolderName = previousPlannedFolderNames[index] ?? `section_${section.sectionId}`;
    const candidates = buildLegacySectionFolderCandidates(section, plannedFolderName);

    for (const candidate of candidates) {
      if (!existingFolderNames.has(candidate) || usedSourceNames.has(candidate)) {
        continue;
      }

      sourceBySectionIndex.set(section.index, candidate);
      usedSourceNames.add(candidate);
      break;
    }
  }

  return sourceBySectionIndex;
}

async function ensurePictureFolderSubstructure(
  picturesDirectory: string,
  sectionFolderNames: string[],
): Promise<void> {
  await mkdir(path.join(picturesDirectory, "_cover", "Original"), { recursive: true });

  for (const sectionFolderName of sectionFolderNames) {
    await Promise.all([
      mkdir(path.join(picturesDirectory, sectionFolderName, "Original", "cover"), { recursive: true }),
      mkdir(path.join(picturesDirectory, sectionFolderName, "Original", "additional"), { recursive: true }),
    ]);
  }
}

function resolveUniqueRuntimeFolderName(
  baseName: string,
  occupiedFolderNames: Set<string>,
): string {
  if (!occupiedFolderNames.has(baseName)) {
    return baseName;
  }

  let suffix = 2;
  while (true) {
    const candidate = `${baseName}_${String(suffix).padStart(2, "0")}`;
    if (!occupiedFolderNames.has(candidate)) {
      return candidate;
    }

    suffix += 1;
  }
}

type PictureFolderRenameOperation = {
  sectionIndex: number;
  fromFolderName: string;
  targetFolderName: string;
};

async function applyPictureFolderRenames(options: {
  picturesDirectory: string;
  renameOperations: PictureFolderRenameOperation[];
  sectionFolderNames: string[];
  currentSectionOrder: number[];
  occupiedFolderNames: Set<string>;
}): Promise<void> {
  const { picturesDirectory, renameOperations, sectionFolderNames, currentSectionOrder, occupiedFolderNames } = options;
  if (renameOperations.length === 0) {
    return;
  }

  const sectionPositionByIndex = new Map<number, number>();
  for (let position = 0; position < currentSectionOrder.length; position += 1) {
    sectionPositionByIndex.set(currentSectionOrder[position], position);
  }

  const tempPrefix = `.__canyon_editor_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
  let tempCounter = 0;
  const stagedRenames: Array<{ sectionIndex: number; tempFolderName: string; targetFolderName: string }> = [];

  for (const operation of renameOperations) {
    const sourcePath = path.join(picturesDirectory, operation.fromFolderName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    let tempFolderName = "";
    while (!tempFolderName) {
      const candidate = `${tempPrefix}${tempCounter}`;
      tempCounter += 1;
      if (!occupiedFolderNames.has(candidate)) {
        tempFolderName = candidate;
      }
    }

    await rename(sourcePath, path.join(picturesDirectory, tempFolderName));
    occupiedFolderNames.delete(operation.fromFolderName);
    occupiedFolderNames.add(tempFolderName);
    stagedRenames.push({
      sectionIndex: operation.sectionIndex,
      tempFolderName,
      targetFolderName: operation.targetFolderName,
    });
  }

  for (const stagedRename of stagedRenames) {
    const targetFolderName = resolveUniqueRuntimeFolderName(stagedRename.targetFolderName, occupiedFolderNames);
    await rename(
      path.join(picturesDirectory, stagedRename.tempFolderName),
      path.join(picturesDirectory, targetFolderName),
    );
    occupiedFolderNames.delete(stagedRename.tempFolderName);
    occupiedFolderNames.add(targetFolderName);

    const sectionPosition = sectionPositionByIndex.get(stagedRename.sectionIndex);
    if (typeof sectionPosition === "number") {
      sectionFolderNames[sectionPosition] = targetFolderName;
    }
  }
}

export async function syncSectionPictureFolders(options: {
  canyonDirectory: string;
  currentSections: PictureSectionDescriptor[];
  previousSections?: PictureSectionDescriptor[] | null;
}): Promise<{ sectionFolderNames: string[] }> {
  const picturesDirectory = path.join(options.canyonDirectory, "pictures");
  await mkdir(picturesDirectory, { recursive: true });

  const existingFolderNames = await readDirectoryNames(picturesDirectory);
  const previousSections = Array.isArray(options.previousSections) ? options.previousSections : [];
  const previousPlannedFolderNames = planSectionPictureFolderNames(previousSections);
  const sourceFolderBySectionIndex = resolvePreviousSectionSourceFolders({
    previousSections,
    previousPlannedFolderNames,
    existingFolderNames,
  });
  const mappedSourceFolders = new Set(sourceFolderBySectionIndex.values());

  const reservedFolderNames = new Set<string>();
  for (const folderName of existingFolderNames) {
    if (folderName === "_cover" || mappedSourceFolders.has(folderName)) {
      continue;
    }

    reservedFolderNames.add(folderName);
  }

  const currentSectionFolderNames = planSectionPictureFolderNames(options.currentSections, reservedFolderNames);
  const renameOperations: PictureFolderRenameOperation[] = [];
  const currentSectionOrder: number[] = [];
  for (let index = 0; index < options.currentSections.length; index += 1) {
    const currentSection = options.currentSections[index];
    const targetFolderName = currentSectionFolderNames[index] ?? `section_${currentSection.sectionId}`;
    currentSectionOrder.push(currentSection.index);

    const sourceFolderName = sourceFolderBySectionIndex.get(currentSection.index);
    if (!sourceFolderName || sourceFolderName === targetFolderName) {
      continue;
    }

    renameOperations.push({
      sectionIndex: currentSection.index,
      fromFolderName: sourceFolderName,
      targetFolderName,
    });
  }

  const occupiedFolderNames = new Set(existingFolderNames);
  await applyPictureFolderRenames({
    picturesDirectory,
    renameOperations,
    sectionFolderNames: currentSectionFolderNames,
    currentSectionOrder,
    occupiedFolderNames,
  });

  await ensurePictureFolderSubstructure(picturesDirectory, currentSectionFolderNames);
  return { sectionFolderNames: currentSectionFolderNames };
}

export function trackHasPersistableContent(
  track: Pick<MultiTrackItemPayload, "routePoints" | "routeFeature">,
): boolean {
  const hasRoutePointCoordinates = Array.isArray(track.routePoints)
    ? track.routePoints.some((point) => toCoordinatePair(point.coordinates) !== null)
    : false;
  if (hasRoutePointCoordinates) {
    return true;
  }

  const geometryCoordinates = track.routeFeature?.geometry?.coordinates;
  if (!Array.isArray(geometryCoordinates)) {
    return false;
  }

  return geometryCoordinates.some((coordinate) => toCoordinatePair(coordinate) !== null);
}

export type TrackPersistenceMode = "write" | "preserve-link" | "remove-link";

export function resolveTrackPersistenceMode(options: {
  hasPersistableContent: boolean;
  previousLink: string;
  missingFile: boolean;
}): TrackPersistenceMode {
  if (options.hasPersistableContent) {
    return "write";
  }

  if (options.previousLink && options.missingFile) {
    return "preserve-link";
  }

  return "remove-link";
}
