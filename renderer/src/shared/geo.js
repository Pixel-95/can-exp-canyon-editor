export function parseCoordinateInput(rawValue) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return {
            coordinate: null,
            error: "Coordinate is required.",
        };
    }
    const parts = trimmed.split(",").map((part) => part.trim());
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return {
            coordinate: null,
            error: "Use format: 9.1951612, 48.2951951",
        };
    }
    const lng = Number.parseFloat(parts[0]);
    const lat = Number.parseFloat(parts[1]);
    if (Number.isNaN(lng) || Number.isNaN(lat)) {
        return {
            coordinate: null,
            error: "Longitude and latitude must be valid numbers.",
        };
    }
    if (lng < -180 || lng > 180) {
        return {
            coordinate: null,
            error: "Longitude must be between -180 and 180.",
        };
    }
    if (lat < -90 || lat > 90) {
        return {
            coordinate: null,
            error: "Latitude must be between -90 and 90.",
        };
    }
    return {
        coordinate: [Number(lng.toFixed(6)), Number(lat.toFixed(6))],
        error: "",
    };
}
export function isSameCoordinate(a, b) {
    return a[0] === b[0] && a[1] === b[1];
}
export function appendCoordinate(target, candidate) {
    const last = target[target.length - 1];
    if (!last || !isSameCoordinate(last, candidate)) {
        target.push(candidate);
    }
}
export function appendCoordinates(target, candidates) {
    for (const candidate of candidates) {
        appendCoordinate(target, candidate);
    }
}
export function haversineDistanceMeters(a, b) {
    const toRadians = (value) => (value * Math.PI) / 180;
    const earthRadiusM = 6371000;
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLat = lat2 - lat1;
    const dLng = toRadians(b[0] - a[0]);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return earthRadiusM * c;
}
export function calculateStraightSegmentDurationSeconds(distanceM, deltaElevationM) {
    const distanceKm = distanceM / 1000;
    const durationHours = distanceKm / 5 + Math.max(deltaElevationM, 0) / 600 + Math.max(-deltaElevationM, 0) / 1000;
    return Math.max(0, durationHours * 3600);
}
export function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return "Unexpected error.";
}
export function isObjectRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function toCoordinatePair(value) {
    if (!Array.isArray(value) || value.length < 2) {
        return null;
    }
    const lng = Number(value[0]);
    const lat = Number(value[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return [Number(lng.toFixed(6)), Number(lat.toFixed(6))];
}
export function toCoordinatesArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => toCoordinatePair(entry))
        .filter((entry) => entry !== null);
}
