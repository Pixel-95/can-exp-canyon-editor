import JSZip from "jszip";
import {
  buildRouteFeatureCollection,
  cloneValue,
  createNewJsonTemplate,
  extractSectionPictureDescriptors,
  isObjectRecord,
  normalizeSectionToposForSave,
  normalizeTrackLink,
  planSectionPictureFolderNames,
  resolveSaveCanyonName,
  resolveTrackPersistenceMode,
  sanitizeFolderName,
  sanitizeSectionPictureFolderName,
  sanitizeTrackBaseName,
  stripUtf8Bom,
  toTrackLink,
  trackHasPersistableContent,
  type PictureSectionDescriptor,
} from "../../../electron/canyonCore";
import type {
  LoadTrackFilesRequest,
  LoadTrackFilesResult,
  MultiTrackItemPayload,
  TrackSnapshotPayload,
} from "../../../electron/ipcTypes";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const CANYON_JSON_FILENAME = "data.json";

export type WebWorkspace = {
  folderName: string;
  dataJsonPath: string;
  directories: Set<string>;
  files: Map<string, Uint8Array>;
};

type LoadZipResult = {
  workspace: WebWorkspace;
  data: unknown;
  filePath: string;
};

type SaveWorkspaceOptions = {
  workspace: WebWorkspace;
  canyonData: unknown;
  canyonName?: string;
  trackSnapshot?: TrackSnapshotPayload | null;
  forceNullTopos?: boolean;
};

type SaveWorkspaceResult = {
  workspace: WebWorkspace;
  data: unknown;
  filePath: string;
  downloadedFileName: string;
  warnings: string[];
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}

function encodeText(content: string): Uint8Array {
  return textEncoder.encode(content);
}

function decodeText(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function cloneWorkspace(workspace: WebWorkspace): WebWorkspace {
  return {
    folderName: workspace.folderName,
    dataJsonPath: workspace.dataJsonPath,
    directories: new Set(workspace.directories),
    files: new Map(workspace.files),
  };
}

function normalizeRelativePath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+|\/+$/g, "");
}

function splitRelativePath(rawPath: string): string[] {
  const normalized = normalizeRelativePath(rawPath);
  return normalized ? normalized.split("/").filter(Boolean) : [];
}

function joinRelativePath(...parts: string[]): string {
  return parts.flatMap((part) => splitRelativePath(part)).join("/");
}

function dirnameRelativePath(rawPath: string): string {
  const segments = splitRelativePath(rawPath);
  segments.pop();
  return segments.join("/");
}

function isAbsoluteLikePath(value: string): boolean {
  return /^(?:[A-Za-z]:\/|\/\/|\/)/.test(value);
}

function ensureDirectoryPath(directories: Set<string>, rawDirectory: string): void {
  const segments = splitRelativePath(rawDirectory);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    directories.add(current);
  }
}

function ensureParentDirectories(directories: Set<string>, rawFilePath: string): void {
  const directory = dirnameRelativePath(rawFilePath);
  if (directory) {
    ensureDirectoryPath(directories, directory);
  }
}

function hasPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function replacePathPrefix(path: string, fromPrefix: string, toPrefix: string): string {
  if (path === fromPrefix) {
    return toPrefix;
  }

  return `${toPrefix}${path.slice(fromPrefix.length)}`;
}

function removeDirectoryTree(workspace: WebWorkspace, directoryPath: string): void {
  for (const filePath of Array.from(workspace.files.keys())) {
    if (hasPathPrefix(filePath, directoryPath)) {
      workspace.files.delete(filePath);
    }
  }

  for (const knownDirectory of Array.from(workspace.directories)) {
    if (hasPathPrefix(knownDirectory, directoryPath)) {
      workspace.directories.delete(knownDirectory);
    }
  }
}

function renameDirectoryTree(workspace: WebWorkspace, fromDirectory: string, toDirectory: string): void {
  const nextFiles = new Map<string, Uint8Array>();
  for (const [filePath, payload] of workspace.files.entries()) {
    nextFiles.set(
      hasPathPrefix(filePath, fromDirectory)
        ? replacePathPrefix(filePath, fromDirectory, toDirectory)
        : filePath,
      payload,
    );
  }

  const nextDirectories = new Set<string>();
  for (const knownDirectory of workspace.directories) {
    nextDirectories.add(
      hasPathPrefix(knownDirectory, fromDirectory)
        ? replacePathPrefix(knownDirectory, fromDirectory, toDirectory)
        : knownDirectory,
    );
  }

  workspace.files = nextFiles;
  workspace.directories = nextDirectories;
}

function getImmediateDirectoryNamesUnder(workspace: WebWorkspace, parentDirectory: string): Set<string> {
  const parent = normalizeRelativePath(parentDirectory);
  const prefix = parent ? `${parent}/` : "";
  const directChildren = new Set<string>();
  const candidatePaths = new Set<string>(workspace.directories);

  for (const filePath of workspace.files.keys()) {
    const directory = dirnameRelativePath(filePath);
    if (directory) {
      candidatePaths.add(directory);
    }
  }

  for (const candidate of candidatePaths) {
    if (!candidate) {
      continue;
    }

    if (parent && !hasPathPrefix(candidate, parent)) {
      continue;
    }

    const relative = parent ? candidate.slice(prefix.length) : candidate;
    const [childName] = relative.split("/");
    if (childName) {
      directChildren.add(childName);
    }
  }

  return directChildren;
}

function readWorkspaceJsonObject(workspace: WebWorkspace, filePath: string): Record<string, unknown> | null {
  const bytes = workspace.files.get(normalizeRelativePath(filePath));
  if (!bytes) {
    return null;
  }

  try {
    const parsed = JSON.parse(stripUtf8Bom(decodeText(bytes))) as unknown;
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeTextFile(workspace: WebWorkspace, filePath: string, content: string): void {
  const normalizedPath = normalizeRelativePath(filePath);
  ensureParentDirectories(workspace.directories, normalizedPath);
  workspace.files.set(normalizedPath, encodeText(content));
}

function normalizeWorkspaceTrackPath(trackLink: string): string | null {
  const normalizedLink = normalizeTrackLink(trackLink);
  if (!normalizedLink) {
    return null;
  }

  if (isAbsoluteLikePath(normalizedLink) && !normalizedLink.startsWith("./") && !normalizedLink.startsWith("/")) {
    return null;
  }

  if (normalizedLink.startsWith("./")) {
    return normalizedLink.slice(2);
  }

  if (normalizedLink.startsWith("/")) {
    return normalizedLink.slice(1);
  }

  return normalizedLink;
}

function resolveLinkAgainstRelativeFile(baseFilePath: string, trackLink: string): string | null {
  const normalizedTrackPath = normalizeWorkspaceTrackPath(trackLink);
  if (!normalizedTrackPath) {
    return null;
  }

  const baseDirectory = dirnameRelativePath(baseFilePath);
  return normalizeRelativePath(baseDirectory ? `${baseDirectory}/${normalizedTrackPath}` : normalizedTrackPath);
}

function buildLegacySectionFolderCandidates(
  section: PictureSectionDescriptor,
  plannedFolderName: string,
): string[] {
  const trimmedName = section.name.trim();
  const candidates = [
    plannedFolderName,
    sanitizeSectionPictureFolderName(trimmedName),
    sanitizeFolderName(trimmedName),
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

function resolveUniqueRuntimeFolderName(baseName: string, occupiedFolderNames: Set<string>): string {
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

function syncWorkspacePictureFolders(options: {
  workspace: WebWorkspace;
  currentSections: PictureSectionDescriptor[];
  previousSections?: PictureSectionDescriptor[] | null;
}): void {
  const { workspace, currentSections } = options;
  ensureDirectoryPath(workspace.directories, "pictures");

  const previousSections = Array.isArray(options.previousSections) ? options.previousSections : [];
  const existingFolderNames = getImmediateDirectoryNamesUnder(workspace, "pictures");
  const previousPlannedFolderNames = planSectionPictureFolderNames(previousSections);
  const sourceFolderBySectionIndex = resolvePreviousSectionSourceFolders({
    previousSections,
    previousPlannedFolderNames,
    existingFolderNames,
  });
  const currentSectionIndexes = new Set(currentSections.map((section) => section.index));
  const mappedSourceFoldersInUse = new Set<string>();
  for (const [sectionIndex, folderName] of sourceFolderBySectionIndex.entries()) {
    if (currentSectionIndexes.has(sectionIndex)) {
      mappedSourceFoldersInUse.add(folderName);
    }
  }

  for (const folderName of existingFolderNames) {
    if (folderName === "_cover" || mappedSourceFoldersInUse.has(folderName)) {
      continue;
    }

    removeDirectoryTree(workspace, joinRelativePath("pictures", folderName));
  }

  const existingFolderNamesAfterPrune = getImmediateDirectoryNamesUnder(workspace, "pictures");
  const currentSectionFolderNames = planSectionPictureFolderNames(currentSections);
  const renameOperations: Array<{ sectionIndex: number; fromFolderName: string; targetFolderName: string }> = [];
  const currentSectionOrder: number[] = [];
  for (let index = 0; index < currentSections.length; index += 1) {
    const currentSection = currentSections[index];
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

  const occupiedFolderNames = new Set(existingFolderNamesAfterPrune);
  if (renameOperations.length > 0) {
    const sectionPositionByIndex = new Map<number, number>();
    for (let position = 0; position < currentSectionOrder.length; position += 1) {
      sectionPositionByIndex.set(currentSectionOrder[position], position);
    }

    const tempPrefix = `.__canyon_editor_tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
    let tempCounter = 0;
    const stagedRenames: Array<{ sectionIndex: number; tempFolderName: string; targetFolderName: string }> = [];

    for (const operation of renameOperations) {
      const sourceFolderPath = joinRelativePath("pictures", operation.fromFolderName);
      let tempFolderName = "";
      while (!tempFolderName) {
        const candidate = `${tempPrefix}${tempCounter}`;
        tempCounter += 1;
        if (!occupiedFolderNames.has(candidate)) {
          tempFolderName = candidate;
        }
      }

      renameDirectoryTree(workspace, sourceFolderPath, joinRelativePath("pictures", tempFolderName));
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
      renameDirectoryTree(
        workspace,
        joinRelativePath("pictures", stagedRename.tempFolderName),
        joinRelativePath("pictures", targetFolderName),
      );
      occupiedFolderNames.delete(stagedRename.tempFolderName);
      occupiedFolderNames.add(targetFolderName);

      const sectionPosition = sectionPositionByIndex.get(stagedRename.sectionIndex);
      if (typeof sectionPosition === "number") {
        currentSectionFolderNames[sectionPosition] = targetFolderName;
      }
    }
  }

  ensureDirectoryPath(workspace.directories, "pictures/_cover/Original");
  for (const sectionFolderName of currentSectionFolderNames) {
    ensureDirectoryPath(workspace.directories, joinRelativePath("pictures", sectionFolderName, "Original", "cover"));
    ensureDirectoryPath(workspace.directories, joinRelativePath("pictures", sectionFolderName, "Original", "additional"));
  }
}

function toComparableWorkspacePath(filePath: string): string {
  return normalizeRelativePath(filePath).toLowerCase();
}

function resolveUniqueTrackFilePath(options: {
  baseName: string;
  previousWorkspacePath: string | null;
  usedRelativePaths: Set<string>;
  knownOwnedRelativePaths: Set<string>;
  existingRelativePaths: Set<string>;
}): string {
  const normalizedPrevious = options.previousWorkspacePath
    ? toComparableWorkspacePath(options.previousWorkspacePath)
    : null;

  let suffix = 0;
  while (true) {
    const candidateBaseName =
      suffix === 0 ? options.baseName : `${options.baseName}_${String(suffix).padStart(2, "0")}`;
    const candidatePath = joinRelativePath("tracks", `${candidateBaseName}.json`);
    const comparable = toComparableWorkspacePath(candidatePath);

    if (options.usedRelativePaths.has(comparable)) {
      suffix += 1;
      continue;
    }

    const existsInWorkspace = options.existingRelativePaths.has(comparable);
    const sameAsPrevious = normalizedPrevious !== null && normalizedPrevious === comparable;
    const belongsToKnownTrack = options.knownOwnedRelativePaths.has(comparable);
    if (existsInWorkspace && !sameAsPrevious && !belongsToKnownTrack) {
      suffix += 1;
      continue;
    }

    options.usedRelativePaths.add(comparable);
    return candidatePath;
  }
}

function collectReferencedTrackLinks(data: Record<string, unknown>): string[] {
  const links: string[] = [];
  const sections = Array.isArray(data.sections) ? data.sections : [];
  for (const section of sections) {
    if (!isObjectRecord(section)) {
      continue;
    }

    if (typeof section.track_canyon === "string" && section.track_canyon.trim()) {
      links.push(section.track_canyon);
    }
  }

  const accessTracks = Array.isArray(data.tracks_access) ? data.tracks_access : [];
  for (const accessTrack of accessTracks) {
    if (typeof accessTrack === "string" && accessTrack.trim()) {
      links.push(accessTrack);
    }
  }

  return links;
}

function parseArchiveEntryPath(entryName: string, isDirectory: boolean): { rootName: string; relativePath: string } {
  if (!entryName || !entryName.trim()) {
    throw new Error("ZIP entry path is empty.");
  }

  if (entryName.includes("\\")) {
    throw new Error(`ZIP entry uses backslashes and is not supported: ${entryName}`);
  }

  if (entryName.startsWith("/") || /^[A-Za-z]:\//.test(entryName)) {
    throw new Error(`ZIP entry must stay inside the archive root folder: ${entryName}`);
  }

  const segments = entryName.split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new Error("ZIP entry path is empty.");
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`ZIP entry contains an invalid path segment: ${entryName}`);
  }

  if (!isDirectory && segments.length < 2) {
    throw new Error(`ZIP must contain a single top-level canyon folder: ${entryName}`);
  }

  return {
    rootName: segments[0],
    relativePath: segments.slice(1).join("/"),
  };
}

export async function loadWebWorkspaceFromZipData(rawZipData: Uint8Array): Promise<LoadZipResult> {
  const zip = await JSZip.loadAsync(rawZipData);
  const rootNames = new Set<string>();
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();

  for (const entry of Object.values(zip.files)) {
    const parsedPath = parseArchiveEntryPath(entry.name, entry.dir);
    rootNames.add(parsedPath.rootName);
    if (rootNames.size > 1) {
      throw new Error("ZIP must contain exactly one top-level canyon folder.");
    }

    if (!parsedPath.relativePath) {
      continue;
    }

    if (entry.dir) {
      ensureDirectoryPath(directories, parsedPath.relativePath);
      continue;
    }

    const bytes = await entry.async("uint8array");
    const normalizedPath = normalizeRelativePath(parsedPath.relativePath);
    ensureParentDirectories(directories, normalizedPath);
    files.set(normalizedPath, bytes);
  }

  const [folderName] = Array.from(rootNames);
  if (!folderName) {
    throw new Error("ZIP does not contain a canyon folder.");
  }

  const rawDataJson = files.get(CANYON_JSON_FILENAME);
  if (!rawDataJson) {
    throw new Error("ZIP is missing data.json in the canyon root folder.");
  }

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(stripUtf8Bom(decodeText(rawDataJson))) as unknown;
  } catch (error) {
    throw new Error(`data.json is not valid JSON: ${toErrorMessage(error)}`);
  }

  if (!isObjectRecord(parsedData)) {
    throw new Error("data.json must contain a JSON object.");
  }

  for (const linkedTrack of collectReferencedTrackLinks(parsedData)) {
    const trackWorkspacePath = normalizeWorkspaceTrackPath(linkedTrack);
    if (!trackWorkspacePath) {
      throw new Error(`Track link must be relative to the canyon folder: ${linkedTrack}`);
    }

    const payload = files.get(trackWorkspacePath);
    if (!payload) {
      throw new Error(`Referenced track file is missing from the ZIP: ${linkedTrack}`);
    }

    try {
      JSON.parse(stripUtf8Bom(decodeText(payload)));
    } catch (error) {
      throw new Error(`Referenced track file is invalid JSON (${linkedTrack}): ${toErrorMessage(error)}`);
    }
  }

  const workspace: WebWorkspace = {
    folderName,
    dataJsonPath: `${folderName}/${CANYON_JSON_FILENAME}`,
    directories,
    files,
  };

  return {
    workspace,
    data: parsedData,
    filePath: workspace.dataJsonPath,
  };
}

export function createNewWebWorkspace(request: {
  canyonName: string;
  initialSectionNames: string[];
  canyonData: unknown;
}): LoadZipResult {
  const folderName = sanitizeFolderName(request.canyonName);
  const workspace: WebWorkspace = {
    folderName,
    dataJsonPath: `${folderName}/${CANYON_JSON_FILENAME}`,
    directories: new Set<string>(),
    files: new Map<string, Uint8Array>(),
  };

  ensureDirectoryPath(workspace.directories, "tracks");
  ensureDirectoryPath(workspace.directories, "pictures/_cover/Original");

  const sectionDescriptors: PictureSectionDescriptor[] = request.initialSectionNames.map((name, index) => ({
    index,
    sectionId: index,
    name,
  }));
  for (const sectionFolderName of planSectionPictureFolderNames(sectionDescriptors)) {
    ensureDirectoryPath(workspace.directories, joinRelativePath("pictures", sectionFolderName, "Original", "cover"));
    ensureDirectoryPath(workspace.directories, joinRelativePath("pictures", sectionFolderName, "Original", "additional"));
  }

  const canyonData = isObjectRecord(request.canyonData) ? request.canyonData : createNewJsonTemplate(request.canyonName);
  writeTextFile(workspace, CANYON_JSON_FILENAME, JSON.stringify(canyonData, null, 2));

  return {
    workspace,
    data: canyonData,
    filePath: workspace.dataJsonPath,
  };
}

export function saveWebWorkspace(options: SaveWorkspaceOptions): SaveWorkspaceResult {
  if (!isObjectRecord(options.canyonData)) {
    throw new Error("No canyon JSON payload was provided.");
  }

  const workspace = cloneWorkspace(options.workspace);
  const warnings: string[] = [...(options.trackSnapshot?.warnings ?? [])];
  const nextData = cloneValue(options.canyonData);
  normalizeSectionToposForSave(nextData, { forceNullTopos: options.forceNullTopos === true });

  const canyonNameForSave = resolveSaveCanyonName(nextData, options.canyonName);
  if (canyonNameForSave) {
    workspace.folderName = sanitizeFolderName(canyonNameForSave);
  }
  workspace.dataJsonPath = `${workspace.folderName}/${CANYON_JSON_FILENAME}`;

  const previousData = readWorkspaceJsonObject(workspace, CANYON_JSON_FILENAME);
  const previousSections = previousData ? extractSectionPictureDescriptors(previousData) : [];
  const currentSections = extractSectionPictureDescriptors(nextData);
  syncWorkspacePictureFolders({
    workspace,
    currentSections,
    previousSections,
  });

  const sectionsValue = Array.isArray(nextData.sections) ? nextData.sections : [];
  const tracksAccessValue = Array.isArray(nextData.tracks_access) ? nextData.tracks_access : [];
  const snapshotTracks = options.trackSnapshot?.tracks ?? [];
  if (snapshotTracks.length === 0) {
    const hasLinkedTracks =
      sectionsValue.some(
        (entry) => isObjectRecord(entry) && typeof entry.track_canyon === "string" && entry.track_canyon.trim(),
      ) || tracksAccessValue.some((entry) => typeof entry === "string" && entry.trim());
    if (hasLinkedTracks) {
      warnings.push("Track snapshot was not available. Existing track files and links were preserved.");
    }

    writeTextFile(workspace, CANYON_JSON_FILENAME, JSON.stringify(nextData, null, 2));
    return {
      workspace,
      data: nextData,
      filePath: workspace.dataJsonPath,
      downloadedFileName: `${workspace.folderName}.zip`,
      warnings,
    };
  }

  ensureDirectoryPath(workspace.directories, "tracks");

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

  const knownOwnedRelativePaths = new Set<string>();
  for (const track of snapshotTracks) {
    const relativeTrackPath = normalizeWorkspaceTrackPath(track.filePath);
    if (!relativeTrackPath) {
      continue;
    }

    knownOwnedRelativePaths.add(toComparableWorkspacePath(relativeTrackPath));
  }

  const existingRelativePaths = new Set<string>();
  for (const existingFilePath of workspace.files.keys()) {
    existingRelativePaths.add(toComparableWorkspacePath(existingFilePath));
  }
  const usedRelativePaths = new Set<string>();
  const pendingTrackWrites = new Map<string, string>();

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
        const preservedRelativePath = normalizeWorkspaceTrackPath(preservedLink);
        if (preservedRelativePath) {
          usedRelativePaths.add(toComparableWorkspacePath(preservedRelativePath));
        }
      }
      continue;
    }

    const previousLinkFromTrack = normalizeTrackLink(sectionTrack.filePath);
    const previousLinkFromData =
      typeof sectionEntry.track_canyon === "string" ? normalizeTrackLink(sectionEntry.track_canyon) : "";
    const previousLink = previousLinkFromTrack || previousLinkFromData;
    const persistenceMode = resolveTrackPersistenceMode({
      hasPersistableContent: trackHasPersistableContent(sectionTrack),
      previousLink,
      missingFile: sectionTrack.missingFile,
    });
    if (persistenceMode !== "write") {
      if (persistenceMode === "preserve-link") {
        sectionEntry.track_canyon = previousLink;
        const preservedRelativePath = normalizeWorkspaceTrackPath(previousLink);
        if (preservedRelativePath) {
          usedRelativePaths.add(toComparableWorkspacePath(preservedRelativePath));
        }
      } else {
        sectionEntry.track_canyon = "";
      }
      continue;
    }

    const sectionName = typeof sectionEntry.name === "string" ? sectionEntry.name : `Section ${sectionIndex + 1}`;
    const sectionId = Number.isFinite(Number(sectionEntry.id)) ? Number(sectionEntry.id) : sectionIndex;

    let baseName = sectionBaseNames[sectionIndex] ?? `section_${sectionId}`;
    if ((sectionBaseNameCounts.get(baseName) ?? 0) > 1) {
      baseName = `${baseName}_section_${sectionId}`;
    }

    const previousWorkspacePath = previousLink ? normalizeWorkspaceTrackPath(previousLink) : null;
    const resolvedWorkspacePath = resolveUniqueTrackFilePath({
      baseName,
      previousWorkspacePath,
      usedRelativePaths,
      knownOwnedRelativePaths,
      existingRelativePaths,
    });
    const link = toTrackLink(resolvedWorkspacePath.replace(/^tracks\//, ""));
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

    pendingTrackWrites.set(resolvedWorkspacePath, JSON.stringify(trackPayload.payload, null, 2));
  }

  const nextTracksAccess: string[] = [];
  for (let accessIndex = 0; accessIndex < accessTracksInOrder.length; accessIndex += 1) {
    const accessTrack = accessTracksInOrder[accessIndex];
    const displayName = accessTrack.displayName?.trim() || `Access ${accessIndex + 1}`;
    const baseName = sanitizeTrackBaseName(displayName) || `access_track_${accessIndex + 1}`;
    const previousLink = normalizeTrackLink(accessTrack.filePath);
    const persistenceMode = resolveTrackPersistenceMode({
      hasPersistableContent: trackHasPersistableContent(accessTrack),
      previousLink,
      missingFile: accessTrack.missingFile,
    });
    if (persistenceMode !== "write") {
      if (persistenceMode === "preserve-link") {
        nextTracksAccess.push(previousLink);
        const preservedRelativePath = normalizeWorkspaceTrackPath(previousLink);
        if (preservedRelativePath) {
          usedRelativePaths.add(toComparableWorkspacePath(preservedRelativePath));
        }
      }
      continue;
    }

    const previousWorkspacePath = previousLink ? normalizeWorkspaceTrackPath(previousLink) : null;
    const resolvedWorkspacePath = resolveUniqueTrackFilePath({
      baseName,
      previousWorkspacePath,
      usedRelativePaths,
      knownOwnedRelativePaths,
      existingRelativePaths,
    });
    const link = toTrackLink(resolvedWorkspacePath.replace(/^tracks\//, ""));
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

    pendingTrackWrites.set(resolvedWorkspacePath, JSON.stringify(trackPayload.payload, null, 2));
  }
  nextData.tracks_access = nextTracksAccess;

  for (const [trackPath, payload] of pendingTrackWrites.entries()) {
    writeTextFile(workspace, trackPath, payload);
  }

  writeTextFile(workspace, CANYON_JSON_FILENAME, JSON.stringify(nextData, null, 2));
  return {
    workspace,
    data: nextData,
    filePath: workspace.dataJsonPath,
    downloadedFileName: `${workspace.folderName}.zip`,
    warnings,
  };
}

export async function generateWorkspaceZipBytes(workspace: WebWorkspace): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder(workspace.folderName);
  if (!root) {
    throw new Error("Could not create ZIP root folder.");
  }

  for (const directoryPath of Array.from(workspace.directories).sort((left, right) => left.localeCompare(right))) {
    root.folder(directoryPath);
  }

  for (const [filePath, payload] of Array.from(workspace.files.entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    root.file(filePath, payload);
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export function loadTrackFilesFromWebWorkspace(
  workspace: WebWorkspace | null,
  request: LoadTrackFilesRequest,
): LoadTrackFilesResult {
  if (!workspace) {
    return {
      entries: request.tracks.map((track) => ({
        id: track.id,
        kind: track.kind,
        filePath: track.filePath,
        missing: true,
        error: "No canyon ZIP is loaded.",
      })),
    };
  }

  const entries: LoadTrackFilesResult["entries"] = [];
  const workspaceRelativeCanyonPath =
    request.canyonFilePath && request.canyonFilePath.startsWith(`${workspace.folderName}/`)
      ? request.canyonFilePath.slice(workspace.folderName.length + 1)
      : CANYON_JSON_FILENAME;

  for (const requestedTrack of request.tracks) {
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

    const workspaceTrackPath = resolveLinkAgainstRelativeFile(workspaceRelativeCanyonPath, normalizedLink);
    if (!workspaceTrackPath) {
      entries.push({
        id: requestedTrack.id,
        kind: requestedTrack.kind,
        filePath: normalizedLink,
        missing: true,
        error: "Track links must stay inside the canyon ZIP.",
      });
      continue;
    }

    const payload = workspace.files.get(workspaceTrackPath);
    if (!payload) {
      entries.push({
        id: requestedTrack.id,
        kind: requestedTrack.kind,
        filePath: normalizedLink,
        absolutePath: `${workspace.folderName}/${workspaceTrackPath}`,
        missing: true,
        error: `Track file not found: ${normalizedLink}`,
      });
      continue;
    }

    try {
      const parsed = JSON.parse(stripUtf8Bom(decodeText(payload))) as unknown;
      entries.push({
        id: requestedTrack.id,
        kind: requestedTrack.kind,
        filePath: normalizedLink,
        absolutePath: `${workspace.folderName}/${workspaceTrackPath}`,
        missing: false,
        data: parsed,
      });
    } catch (error) {
      entries.push({
        id: requestedTrack.id,
        kind: requestedTrack.kind,
        filePath: normalizedLink,
        absolutePath: `${workspace.folderName}/${workspaceTrackPath}`,
        missing: true,
        error: toErrorMessage(error),
      });
    }
  }

  return { entries };
}
