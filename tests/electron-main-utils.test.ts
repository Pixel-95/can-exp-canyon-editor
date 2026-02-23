import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  getCanyonFolderPath,
  getRuntimeRootDir,
  normalizeRoutePoints,
  normalizeSectionTopoForSave,
  normalizeTrackLink,
  parseAccessTrackIndex,
  resolveTrackPersistenceMode,
  sanitizeFileName,
  sanitizeFolderName,
  sanitizeTrackBaseName,
  trackHasPersistableContent,
  toAbsolutePath,
  toTrackLink,
} from "../electron/mainUtils";

test("sanitize helpers keep current filename semantics", () => {
  assert.equal(sanitizeFileName(" My Canyon "), "My-Canyon");
  assert.equal(sanitizeFolderName(" My Canyon "), "My_Canyon");
  assert.equal(sanitizeTrackBaseName("Section: 1"), "Section_1");
});

test("track link helpers keep current path behavior", () => {
  assert.equal(normalizeTrackLink("tracks/access_01.json"), "./tracks/access_01.json");
  assert.equal(toTrackLink("access_01.json"), "./tracks/access_01.json");
  assert.equal(parseAccessTrackIndex("./tracks/access_07.json"), 7);
  assert.equal(parseAccessTrackIndex("./tracks/not_access.json"), null);
});

test("normalizeSectionTopoForSave returns null for unset topo values", () => {
  assert.equal(normalizeSectionTopoForSave(""), null);
  assert.equal(normalizeSectionTopoForSave("   "), null);
  assert.equal(normalizeSectionTopoForSave(null), null);
  assert.equal(normalizeSectionTopoForSave(undefined), null);
  assert.equal(normalizeSectionTopoForSave("./topos/example.webp"), "./topos/example.webp");
});

test("normalizeRoutePoints keeps boundary/waypoint contract", () => {
  const points = normalizeRoutePoints([
    { id: "a", type: "waypoint", coordinates: [1, 1] },
    { id: "b", type: "waypoint", coordinates: [2, 2], segmentMode: "route" },
    { id: "c", type: "waypoint", coordinates: [3, 3] },
  ]);

  assert.equal(points[0].type, "start");
  assert.equal(points[1].type, "waypoint");
  assert.equal(points[2].type, "end");
  assert.equal(points[1].segmentMode, "route");
});

test("getRuntimeRootDir resolves dev and packaged paths", () => {
  assert.equal(
    getRuntimeRootDir({
      isPackaged: false,
      platform: "win32",
      cwd: "C:/repo/canyon-editor",
      execPath: "C:/ignored/ignored.exe",
    }),
    path.normalize("C:/repo/canyon-editor"),
  );

  assert.equal(
    getRuntimeRootDir({
      isPackaged: true,
      platform: "win32",
      cwd: "C:/repo/canyon-editor",
      execPath: "C:/Apps/Canyon Editor/Canyon Editor.exe",
    }),
    "C:/Apps/Canyon Editor",
  );

  assert.equal(
    getRuntimeRootDir({
      isPackaged: true,
      platform: "win32",
      cwd: "C:/repo/canyon-editor",
      execPath: "C:/Users/user/AppData/Local/Temp/random/Canyon Editor.exe",
      portableExecutableDir: "D:/Portable/Canyon Editor",
    }),
    path.normalize("D:/Portable/Canyon Editor"),
  );

  assert.equal(
    getRuntimeRootDir({
      isPackaged: true,
      platform: "darwin",
      cwd: "/Users/dev/repo/canyon-editor",
      execPath: "/Volumes/Canyon/Canyon Editor.app/Contents/MacOS/Canyon Editor",
    }),
    "/Volumes/Canyon",
  );
});

test("toAbsolutePath uses runtime root for relative paths", () => {
  assert.equal(
    toAbsolutePath("data/Kobelache/data.json", "/portable-root"),
    path.normalize(path.resolve("/portable-root", "data/Kobelache/data.json")),
  );

  assert.equal(
    toAbsolutePath("/already/absolute/data.json", "/portable-root"),
    path.normalize("/already/absolute/data.json"),
  );
});

test("new canyon folder path resolves into runtime root data directory", () => {
  assert.equal(
    getCanyonFolderPath("/portable-root", "My Canyon"),
    path.normalize(path.join("/portable-root", "data", "My_Canyon")),
  );
});

test("trackHasPersistableContent detects route point and geometry coordinates", () => {
  assert.equal(
    trackHasPersistableContent({
      routePoints: [],
      routeFeature: null,
    } as any),
    false,
  );

  assert.equal(
    trackHasPersistableContent({
      routePoints: [{ id: "a", type: "start", coordinates: [8.1, 47.2] }],
      routeFeature: null,
    } as any),
    true,
  );

  assert.equal(
    trackHasPersistableContent({
      routePoints: [{ id: "a", type: "start", coordinates: [Number.NaN, 47.2] }],
      routeFeature: null,
    } as any),
    false,
  );

  assert.equal(
    trackHasPersistableContent({
      routePoints: [],
      routeFeature: {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [[8.2, 47.3]],
        },
        properties: {
          distance_m: 0,
          duration_s: 0,
          profile: "walking",
          start: [8.2, 47.3],
          end: [8.2, 47.3],
          waypoints: [],
          segments: [],
          generated_at: "2026-01-01T00:00:00.000Z",
        },
      },
    } as any),
    true,
  );
});

test("resolveTrackPersistenceMode follows hybrid preserve/remove policy", () => {
  assert.equal(
    resolveTrackPersistenceMode({
      hasPersistableContent: false,
      previousLink: "",
      missingFile: true,
    }),
    "remove-link",
  );

  assert.equal(
    resolveTrackPersistenceMode({
      hasPersistableContent: false,
      previousLink: "./tracks/section_01.json",
      missingFile: true,
    }),
    "preserve-link",
  );

  assert.equal(
    resolveTrackPersistenceMode({
      hasPersistableContent: false,
      previousLink: "./tracks/section_01.json",
      missingFile: false,
    }),
    "remove-link",
  );

  assert.equal(
    resolveTrackPersistenceMode({
      hasPersistableContent: true,
      previousLink: "./tracks/section_01.json",
      missingFile: false,
    }),
    "write",
  );
});
