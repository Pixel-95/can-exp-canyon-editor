function normalizeLocationPart(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildLocationFallbackQuery(
  countryName: string | null | undefined,
  regionName: string | null | undefined,
): string {
  const country = normalizeLocationPart(countryName);
  const region = normalizeLocationPart(regionName);

  return [country, region].filter(Boolean).join(" ");
}

export function buildLocationFallbackKey(
  canyonFilePath: string | null | undefined,
  query: string | null | undefined,
): string {
  const normalizedQuery = normalizeLocationPart(query);
  if (!normalizedQuery) {
    return "";
  }

  const canyonKey = normalizeLocationPart(canyonFilePath) || "__default__";
  return `${canyonKey}|${normalizedQuery}`;
}

export function getLocationFallbackDecision(options: {
  canyonFilePath: string | null | undefined;
  query: string | null | undefined;
  hasViewportCoordinates: boolean;
  lastAppliedKey: string;
}): {
  shouldRun: boolean;
  normalizedQuery: string;
  nextAppliedKey: string;
} {
  const normalizedQuery = normalizeLocationPart(options.query);
  if (!normalizedQuery || options.hasViewportCoordinates) {
    return {
      shouldRun: false,
      normalizedQuery,
      nextAppliedKey: "",
    };
  }

  const nextAppliedKey = buildLocationFallbackKey(options.canyonFilePath, normalizedQuery);
  if (nextAppliedKey === options.lastAppliedKey) {
    return {
      shouldRun: false,
      normalizedQuery,
      nextAppliedKey,
    };
  }

  return {
    shouldRun: true,
    normalizedQuery,
    nextAppliedKey,
  };
}
