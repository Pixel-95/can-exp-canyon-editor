import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRoutePoints,
  normalizeTrackLink,
  parseAccessTrackIndex,
  sanitizeFileName,
  sanitizeFolderName,
  sanitizeTrackBaseName,
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