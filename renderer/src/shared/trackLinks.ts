export function normalizeTrackLink(link: string): string {
  const normalized = link.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }

  if (/^[A-Za-z]:\//.test(normalized)) {
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

export function getTrackDisplayNameFromFilePath(filePath: string, fallback: string): string {
  const normalized = normalizeTrackLink(filePath);
  if (!normalized) {
    return fallback;
  }

  const withoutQuery = normalized.split(/[?#]/)[0] ?? normalized;
  const segments = withoutQuery.split("/");
  const lastSegment = segments[segments.length - 1]?.trim() ?? "";
  if (!lastSegment) {
    return fallback;
  }

  const withoutExtension = lastSegment.replace(/\.json$/i, "").trim();
  return withoutExtension || fallback;
}