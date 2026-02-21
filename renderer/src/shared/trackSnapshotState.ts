import { normalizeTrackLink } from "./trackLinks";

const NEW_ACCESS_TRACK_ID_PATTERN = /^access:new:(\d+)$/;

type TrackKindLike = "section" | "access";

type TrackLike = {
  id: string;
  kind: TrackKindLike;
  filePath: string;
};

type TrackSnapshotLike<TTrack extends TrackLike> = {
  tracks: TTrack[];
  activeTrackId: string | null;
} | null;

export type HydratedTrackState<TTrack extends TrackLike> = {
  tracksById: Record<string, TTrack>;
  trackOrder: string[];
  activeTrackId: string | null;
  newAccessTrackCounter: number;
};

function getHighestNewAccessTrackCounter(trackIds: Iterable<string>): number {
  let highest = 0;
  for (const trackId of trackIds) {
    const match = NEW_ACCESS_TRACK_ID_PATTERN.exec(trackId);
    if (!match) {
      continue;
    }

    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed)) {
      highest = Math.max(highest, parsed);
    }
  }

  return highest;
}

export function getNextNewAccessTrackId(trackIds: Iterable<string>): {
  trackId: string;
  counter: number;
} {
  const counter = getHighestNewAccessTrackCounter(trackIds) + 1;
  return {
    trackId: `access:new:${counter}`,
    counter,
  };
}

export function isUnsavedNewAccessTrack(
  trackId: string,
  trackKind: string,
  filePath: string,
): boolean {
  if (trackKind !== "access") {
    return false;
  }

  return trackId.startsWith("access:new:") && normalizeTrackLink(filePath) === "";
}

export function shouldReuseHydratedTrackForBinding(
  track: TrackLike | null | undefined,
  bindingPath: string,
): boolean {
  if (!track) {
    return false;
  }

  return normalizeTrackLink(track.filePath) === normalizeTrackLink(bindingPath);
}

export function hydrateTrackStateFromSnapshot<TTrack extends TrackLike>(
  trackSnapshot: TrackSnapshotLike<TTrack>,
): HydratedTrackState<TTrack> {
  const tracksById: Record<string, TTrack> = {};
  const trackOrder: string[] = [];

  for (const track of trackSnapshot?.tracks ?? []) {
    if (!track || typeof track.id !== "string" || !track.id.trim()) {
      continue;
    }

    if (tracksById[track.id]) {
      continue;
    }

    tracksById[track.id] = {
      ...track,
      filePath: normalizeTrackLink(track.filePath),
    };
    trackOrder.push(track.id);
  }

  const activeTrackIdCandidate = trackSnapshot?.activeTrackId;
  const activeTrackId =
    typeof activeTrackIdCandidate === "string" && tracksById[activeTrackIdCandidate]
      ? activeTrackIdCandidate
      : null;

  return {
    tracksById,
    trackOrder,
    activeTrackId,
    newAccessTrackCounter: getHighestNewAccessTrackCounter(trackOrder),
  };
}
