import path from "node:path";
import type { RoutePointPayload } from "./ipcTypes";

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

export function toAbsolutePath(requestedPath: string): string {
  if (path.isAbsolute(requestedPath)) {
    return path.normalize(requestedPath);
  }

  return path.resolve(process.cwd(), requestedPath);
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

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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