import type {
  MultiTrackItemPayload,
  RoutePointPayload,
  RouteSegmentSummaryPayload,
} from "./ipcTypes";

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

export type PictureSectionDescriptor = {
  index: number;
  sectionId: number;
  name: string;
};

function isAbsoluteLikePath(value: string): boolean {
  return /^(?:[A-Za-z]:\/|\/\/|\/)/.test(value);
}

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

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

    const rawSectionId = Number(rawSection.id);
    const sectionId = Number.isInteger(rawSectionId) && rawSectionId >= 0 ? rawSectionId : index;
    const name = typeof rawSection.name === "string" ? rawSection.name : "";
    descriptors.push({
      index,
      sectionId,
      name,
    });
  }

  return descriptors;
}

export function normalizeTrackLink(link: string): string {
  const normalized = link.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }

  if (isAbsoluteLikePath(normalized)) {
    if (normalized.startsWith("/")) {
      return `.${normalized}`;
    }

    return normalized;
  }

  if (normalized.startsWith("./")) {
    return normalized;
  }

  return `./${normalized}`;
}

export function toTrackLink(fileName: string): string {
  return `./tracks/${fileName}`;
}

export function normalizeSectionTopoForSave(value: unknown, forceNull = false): string | null {
  if (forceNull) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("./topos/")) {
    return normalized;
  }

  if (normalized.startsWith("/topos/")) {
    return `.${normalized}`;
  }

  return normalized;
}

export function normalizeSectionToposForSave(
  canyonData: Record<string, unknown>,
  options: { forceNullTopos?: boolean } = {},
): void {
  const sections = Array.isArray(canyonData.sections) ? canyonData.sections : [];
  for (const section of sections) {
    if (!isObjectRecord(section)) {
      continue;
    }

    section.topo = normalizeSectionTopoForSave(section.topo, options.forceNullTopos === true);
  }
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

export function buildRouteFeatureCollection(
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

  return {
    payload: {
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
    },
    incomplete: geometryCoordinates.length < 2,
  };
}

export function resolveSaveCanyonName(
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

export function createNewJsonTemplate(canyonName: string): Record<string, unknown> {
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

export function stripUtf8Bom(content: string): string {
  return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
}
