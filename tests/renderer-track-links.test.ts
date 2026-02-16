import test from "node:test";
import assert from "node:assert/strict";

import { getTrackDisplayNameFromFilePath, normalizeTrackLink } from "../renderer/src/shared/trackLinks";

test("normalizeTrackLink keeps relative track links stable", () => {
  assert.equal(normalizeTrackLink("tracks/access_01.json"), "./tracks/access_01.json");
  assert.equal(normalizeTrackLink("./tracks/access_01.json"), "./tracks/access_01.json");
  assert.equal(normalizeTrackLink("\\tracks\\access_01.json"), "./tracks/access_01.json");
});

test("getTrackDisplayNameFromFilePath extracts base filename", () => {
  assert.equal(
    getTrackDisplayNameFromFilePath("./tracks/Kangaroo Jump - Zustieg.json", "fallback"),
    "Kangaroo Jump - Zustieg",
  );
  assert.equal(getTrackDisplayNameFromFilePath("", "fallback"), "fallback");
});