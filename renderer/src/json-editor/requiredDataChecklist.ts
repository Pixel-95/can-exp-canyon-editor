type JsonRecord = Record<string, unknown>;

type LanguageCode = "de" | "en" | "es" | "fr" | "it" | "pt";

type ChecklistTrackPoint = {
  type?: string;
};

type ChecklistTrack = {
  id?: string;
  kind?: string;
  sectionIndex?: number;
  displayName?: string;
  routePoints?: ChecklistTrackPoint[];
};

type ChecklistTrackSnapshot = {
  tracks: ChecklistTrack[];
};

export type ChecklistStatus = "present" | "missing";

export type ChecklistNode = {
  id: string;
  label: string;
  status: ChecklistStatus;
  children: ChecklistNode[];
};

export type ChecklistBuildInput = {
  canyonData: JsonRecord | null;
  trackSnapshot: ChecklistTrackSnapshot | null;
  languages?: readonly LanguageCode[];
};

const DEFAULT_LANGUAGES: readonly LanguageCode[] = ["de", "en", "es", "fr", "it", "pt"];

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  it: "Italian",
  pt: "Portuguese",
};

const TOPO_IMAGE_EXTENSION_PATTERN = /\.(webp|png|jpe?g)$/i;

function asObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidCoordinatePair(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) {
    return false;
  }

  return (
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function createLeaf(id: string, label: string, present: boolean): ChecklistNode {
  return {
    id,
    label,
    status: present ? "present" : "missing",
    children: [],
  };
}

function createBranch(id: string, label: string, children: ChecklistNode[]): ChecklistNode {
  return {
    id,
    label,
    status: "missing",
    children,
  };
}

function deriveStatus(node: ChecklistNode): ChecklistNode {
  if (node.children.length === 0) {
    return node;
  }

  const children = node.children.map((child) => deriveStatus(child));
  const status: ChecklistStatus = children.every((child) => child.status === "present") ? "present" : "missing";
  return {
    ...node,
    status,
    children,
  };
}

function buildLanguageBranch(
  id: string,
  label: string,
  value: unknown,
  languages: readonly LanguageCode[],
): ChecklistNode {
  const children = languages.map((language) => {
    const present = getLocalizedValue(value, language) !== "";
    return createLeaf(`${id}/${language}`, LANGUAGE_LABELS[language], present);
  });

  return createBranch(id, label, children);
}

function isNonZeroNumber(value: unknown): boolean {
  const parsed = asNumber(value);
  return parsed !== null && parsed !== 0;
}

function hasAnyAuthor(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
}

function hasRecommendedRopes(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  return normalized !== "" && normalized !== "2x0m";
}

function buildSectionNode(
  sectionValue: unknown,
  sectionIndex: number,
  sectionTrack: ChecklistTrack | null,
  languages: readonly LanguageCode[],
): ChecklistNode {
  const section = asObject(sectionValue) ?? {};
  const descriptions = asObject(section.descriptions) ?? {};
  const difficulties = asObject(section.difficulties) ?? {};
  const durations = asObject(section.durations_in_minutes) ?? {};
  const sectionName =
    typeof section.name === "string" && section.name.trim() ? section.name.trim() : `Section ${sectionIndex + 1}`;

  const children: ChecklistNode[] = [
    createLeaf(`section/${sectionIndex}/authors`, "Author (at least one)", hasAnyAuthor(section.authors)),
    createBranch(`section/${sectionIndex}/descriptions`, "Descriptions", [
      buildLanguageBranch(
        `section/${sectionIndex}/descriptions/approach`,
        "Approach",
        descriptions.approach,
        languages,
      ),
      buildLanguageBranch(`section/${sectionIndex}/descriptions/canyon`, "Canyon", descriptions.canyon, languages),
      buildLanguageBranch(`section/${sectionIndex}/descriptions/exit`, "Exit", descriptions.exit, languages),
    ]),
    createBranch(`section/${sectionIndex}/difficulties`, "Difficulties", [
      createLeaf(`section/${sectionIndex}/difficulties/vertical`, "Vertical", isNonZeroNumber(difficulties.vertical)),
      createLeaf(`section/${sectionIndex}/difficulties/aquatic`, "Aquatic", isNonZeroNumber(difficulties.aquatic)),
      createLeaf(`section/${sectionIndex}/difficulties/general`, "General", isNonZeroNumber(difficulties.general)),
    ]),
    createBranch(`section/${sectionIndex}/durations`, "Durations", [
      createLeaf(
        `section/${sectionIndex}/durations/approach-no-shuttle`,
        "Approach no shuttle",
        isNonZeroNumber(durations.approach_no_shuttle),
      ),
      createLeaf(
        `section/${sectionIndex}/durations/approach-with-shuttle`,
        "Approach with shuttle",
        isNonZeroNumber(durations.approach_with_shuttle),
      ),
      createLeaf(
        `section/${sectionIndex}/durations/canyon`,
        "Canyon",
        isNonZeroNumber(durations.canyon),
      ),
      createLeaf(
        `section/${sectionIndex}/durations/exit-no-shuttle`,
        "Exit no shuttle",
        isNonZeroNumber(durations.exit_no_shuttle),
      ),
      createLeaf(
        `section/${sectionIndex}/durations/exit-with-shuttle`,
        "Exit with shuttle",
        isNonZeroNumber(durations.exit_with_shuttle),
      ),
    ]),
    createLeaf(
      `section/${sectionIndex}/max-rappel`,
      "Max rappel",
      isNonZeroNumber(section.max_rappel_in_meter),
    ),
    createLeaf(
      `section/${sectionIndex}/recommended-ropes`,
      "Recommended ropes",
      hasRecommendedRopes(section.recommended_ropes),
    ),
    createLeaf(
      `section/${sectionIndex}/track`,
      "Track",
      Boolean(sectionTrack) && isTrackBoundaryComplete(sectionTrack?.routePoints ?? null),
    ),
    createLeaf(`section/${sectionIndex}/topo`, "Topo", isValidTopoPath(section.topo)),
  ];

  return createBranch(`section/${sectionIndex}`, sectionName, children);
}

function getTrackDisplayName(track: ChecklistTrack, index: number): string {
  if (typeof track.displayName === "string" && track.displayName.trim()) {
    return track.displayName.trim();
  }

  if (typeof track.id === "string" && track.id.trim()) {
    return track.id.trim();
  }

  return `Access track ${index + 1}`;
}

export function getLocalizedValue(value: unknown, language: string): string {
  const languageObject = asObject(value);
  if (!languageObject) {
    return "";
  }

  const candidate = languageObject[language];
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function isTrackBoundaryComplete(routePoints: unknown): boolean {
  if (!Array.isArray(routePoints)) {
    return false;
  }

  let hasStart = false;
  let hasEnd = false;
  for (const point of routePoints) {
    const candidate = asObject(point);
    if (!candidate) {
      continue;
    }

    const type = candidate.type;
    if (type === "start") {
      hasStart = true;
    } else if (type === "end") {
      hasEnd = true;
    }

    if (hasStart && hasEnd) {
      return true;
    }
  }

  return false;
}

export function isValidTopoPath(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    return false;
  }

  const pathWithoutQuery = normalized.split(/[?#]/)[0] ?? normalized;
  if (!(pathWithoutQuery.startsWith("./topos/") || pathWithoutQuery.startsWith("/topos/"))) {
    return false;
  }

  return TOPO_IMAGE_EXTENSION_PATTERN.test(pathWithoutQuery);
}

export function buildRequiredDataChecklist(input: ChecklistBuildInput): ChecklistNode[] {
  const { canyonData, trackSnapshot } = input;
  if (!canyonData) {
    return [];
  }

  const languages = input.languages && input.languages.length > 0 ? input.languages : DEFAULT_LANGUAGES;
  const snapshotTracks = Array.isArray(trackSnapshot?.tracks) ? trackSnapshot.tracks : [];
  const sectionTracksByIndex = new Map<number, ChecklistTrack>();
  const accessTracks: ChecklistTrack[] = [];

  for (const track of snapshotTracks) {
    if (track.kind === "section" && Number.isInteger(track.sectionIndex)) {
      sectionTracksByIndex.set(Number(track.sectionIndex), track);
      continue;
    }

    if (track.kind === "access") {
      accessTracks.push(track);
    }
  }

  const parkingLotsRaw = Array.isArray(canyonData.parking_lots) ? canyonData.parking_lots : [];
  const parkingChildren: ChecklistNode[] =
    parkingLotsRaw.length === 0
      ? [createLeaf("canyon/parking/0", "Parking lot 1", false)]
      : parkingLotsRaw.map((entry, index) => {
        const parkingLot = asObject(entry) ?? {};
        return buildLanguageBranch(
          `canyon/parking/${index}`,
          `Parking lot ${index + 1}`,
          parkingLot.name,
          languages,
        );
      });

  const accessChildren: ChecklistNode[] =
    accessTracks.length === 0
      ? [createLeaf("canyon/access/0", "Access track 1", false)]
      : accessTracks.map((track, index) => {
        const label = getTrackDisplayName(track, index);
        const id = typeof track.id === "string" && track.id.trim()
          ? `canyon/access/${track.id.trim()}`
          : `canyon/access/${index}`;
        return createLeaf(id, label, isTrackBoundaryComplete(track.routePoints ?? null));
      });

  const canyonName =
    typeof canyonData.name === "string" && canyonData.name.trim() ? canyonData.name.trim() : "Canyon";
  const location = asObject(canyonData.location) ?? {};
  const sections = Array.isArray(canyonData.sections) ? canyonData.sections : [];

  const roots: ChecklistNode[] = [
    createBranch("canyon", canyonName, [
      createLeaf("canyon/overview", "Set overview point", hasValidCoordinatePair(canyonData.coordinates)),
      buildLanguageBranch("canyon/description", "Description", canyonData.description, languages),
      createBranch("canyon/location", "Location", [
        createLeaf("canyon/location/country", "Country", isNonEmptyString(location.country_code)),
        createLeaf("canyon/location/region", "Region", isNonEmptyString(location.region_code)),
      ]),
      createBranch("canyon/parking", "Parking lot (at least one)", parkingChildren),
      createBranch("canyon/access", "Access track (at least one)", accessChildren),
    ]),
    ...sections.map((sectionValue, sectionIndex) =>
      buildSectionNode(sectionValue, sectionIndex, sectionTracksByIndex.get(sectionIndex) ?? null, languages),
    ),
  ];

  return roots.map((node) => deriveStatus(node));
}
