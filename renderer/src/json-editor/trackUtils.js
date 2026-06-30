import { haversineDistanceMeters } from "../shared/geo";
import { normalizeTrackLink } from "../shared/trackLinks";
function isJsonObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function toFiniteNumber(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    return value;
}
function normalizeLineCoordinates(rawCoordinates) {
    if (!Array.isArray(rawCoordinates)) {
        return [];
    }
    const coordinates = [];
    for (const rawCoordinate of rawCoordinates) {
        if (!Array.isArray(rawCoordinate) || rawCoordinate.length < 2) {
            continue;
        }
        const lng = toFiniteNumber(rawCoordinate[0]);
        const lat = toFiniteNumber(rawCoordinate[1]);
        if (lng === null || lat === null) {
            continue;
        }
        coordinates.push([lng, lat]);
    }
    return coordinates;
}
function calculatePolylineDistanceMeters(coordinates) {
    if (coordinates.length < 2) {
        return 0;
    }
    let total = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
        const previous = coordinates[index - 1];
        const current = coordinates[index];
        if (!previous || !current) {
            continue;
        }
        total += haversineDistanceMeters(previous, current);
    }
    return total;
}
function deriveSectionTourDimensions(section, sectionTrack) {
    const currentDimensions = isJsonObject(section.tour_dimensions_in_meter)
        ? section.tour_dimensions_in_meter
        : {};
    const currentElevationStart = toFiniteNumber(currentDimensions.elevation_start) ?? 0;
    const currentElevationExit = toFiniteNumber(currentDimensions.elevation_exit) ?? 0;
    const currentHorizontalLength = toFiniteNumber(currentDimensions.horizontal_length) ?? 0;
    if (!sectionTrack) {
        return {
            elevation_start: Math.round(currentElevationStart),
            elevation_exit: Math.round(currentElevationExit),
            horizontal_length: Math.round(Math.max(0, currentHorizontalLength)),
        };
    }
    const routeFeature = sectionTrack.routeFeature;
    const routeProperties = routeFeature?.properties ?? null;
    const distanceFromProperties = routeProperties ? toFiniteNumber(routeProperties.distance_m) : null;
    const elevationStartFromProperties = routeProperties
        ? toFiniteNumber(routeProperties.elevation_start_m)
        : null;
    const elevationExitFromProperties = routeProperties
        ? toFiniteNumber(routeProperties.elevation_end_m)
        : null;
    let distanceFromGeometry = null;
    if (routeFeature) {
        const coordinates = normalizeLineCoordinates(routeFeature.geometry.coordinates);
        if (coordinates.length >= 2) {
            distanceFromGeometry = calculatePolylineDistanceMeters(coordinates);
        }
    }
    if (distanceFromGeometry === null) {
        const pointCoordinates = sectionTrack.routePoints
            .map((point) => point.coordinates)
            .filter((coordinate) => Array.isArray(coordinate) &&
            coordinate.length === 2 &&
            typeof coordinate[0] === "number" &&
            Number.isFinite(coordinate[0]) &&
            typeof coordinate[1] === "number" &&
            Number.isFinite(coordinate[1]));
        if (pointCoordinates.length >= 2) {
            distanceFromGeometry = calculatePolylineDistanceMeters(pointCoordinates);
        }
    }
    return {
        elevation_start: Math.round(elevationStartFromProperties ?? currentElevationStart),
        elevation_exit: Math.round(elevationExitFromProperties ?? currentElevationExit),
        horizontal_length: Math.round(Math.max(0, distanceFromProperties ?? distanceFromGeometry ?? currentHorizontalLength)),
    };
}
export function buildTrackBindings(canyonData, canyonFilePath) {
    if (!canyonData) {
        return {
            canyonFilePath,
            sections: [],
            access: [],
        };
    }
    const sectionsRaw = Array.isArray(canyonData.sections) ? canyonData.sections : [];
    const sections = sectionsRaw
        .map((entry, index) => {
        if (!isJsonObject(entry)) {
            return null;
        }
        const rawSectionId = Number(entry.id);
        const sectionId = Number.isInteger(rawSectionId) && rawSectionId >= 0 ? rawSectionId : index;
        const sectionName = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : `Section ${index + 1}`;
        const filePath = typeof entry.track_canyon === "string" && entry.track_canyon.trim()
            ? normalizeTrackLink(entry.track_canyon)
            : null;
        return {
            sectionIndex: index,
            sectionId,
            sectionName,
            filePath,
        };
    })
        .filter((entry) => entry !== null);
    const accessRaw = Array.isArray(canyonData.tracks_access) ? canyonData.tracks_access : [];
    const access = accessRaw
        .map((entry, index) => {
        if (typeof entry !== "string" || !entry.trim()) {
            return null;
        }
        return {
            accessIndex: index,
            filePath: normalizeTrackLink(entry),
        };
    })
        .filter((entry) => entry !== null);
    return {
        canyonFilePath,
        sections,
        access,
    };
}
export function withSectionTourDimensionsFromTracks(canyonData, trackSnapshot) {
    const sections = Array.isArray(canyonData.sections) ? canyonData.sections : [];
    if (sections.length === 0) {
        return canyonData;
    }
    const sectionTracksByIndex = new Map();
    if (trackSnapshot) {
        for (const track of trackSnapshot.tracks) {
            if (track.kind !== "section" || !Number.isInteger(track.sectionIndex)) {
                continue;
            }
            sectionTracksByIndex.set(Number(track.sectionIndex), track);
        }
    }
    return {
        ...canyonData,
        sections: sections.map((entry, sectionIndex) => {
            if (!isJsonObject(entry)) {
                return entry;
            }
            const sectionTrack = sectionTracksByIndex.get(sectionIndex) ?? null;
            return {
                ...entry,
                tour_dimensions_in_meter: deriveSectionTourDimensions(entry, sectionTrack),
            };
        }),
    };
}
