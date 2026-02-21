import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  getCanyonFolderPath,
  getRuntimeRootDir,
  normalizeRoutePoints,
  normalizeTrackLink,
  parseAccessTrackIndex,
  sanitizeFileName,
  sanitizeFolderName,
  sanitizeTrackBaseName,
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
