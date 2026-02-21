import test from "node:test";
import assert from "node:assert/strict";

import {
  getNextNewAccessTrackId,
  hydrateTrackStateFromSnapshot,
  isUnsavedNewAccessTrack,
  shouldReuseHydratedTrackForBinding,
} from "../renderer/src/shared/trackSnapshotState";

test("snapshot hydration keeps track order, active track, and normalized file paths", () => {
  const state = hydrateTrackStateFromSnapshot({
    tracks: [
      {
        id: "section:0",
        kind: "section",
        filePath: "tracks/section_0.json",
      },
      {
        id: "access:new:3",
        kind: "access",
        filePath: "",
      },
    ],
    activeTrackId: "section:0",
  });

  assert.deepEqual(state.trackOrder, ["section:0", "access:new:3"]);
  assert.equal(state.activeTrackId, "section:0");
  assert.equal(state.tracksById["section:0"]?.filePath, "./tracks/section_0.json");
  assert.equal(state.tracksById["access:new:3"]?.filePath, "");
  assert.equal(state.newAccessTrackCounter, 3);
});

test("binding reuse checks normalized paths", () => {
  assert.equal(
    shouldReuseHydratedTrackForBinding(
      {
        id: "section:0",
        kind: "section",
        filePath: "./tracks/section_0.json",
      },
      "tracks/section_0.json",
    ),
    true,
  );

  assert.equal(
    shouldReuseHydratedTrackForBinding(
      {
        id: "section:0",
        kind: "section",
        filePath: "./tracks/section_0.json",
      },
      "./tracks/section_1.json",
    ),
    false,
  );
});

test("unsaved access track detection only keeps temporary empty-path tracks", () => {
  assert.equal(isUnsavedNewAccessTrack("access:new:1", "access", ""), true);
  assert.equal(isUnsavedNewAccessTrack("access:new:1", "access", "./tracks/access_01.json"), false);
  assert.equal(isUnsavedNewAccessTrack("access:0", "access", ""), false);
  assert.equal(isUnsavedNewAccessTrack("section:0", "section", ""), false);
});

test("new access track id generation avoids collisions", () => {
  const next = getNextNewAccessTrackId(["section:0", "access:new:2", "access:new:7"]);
  assert.deepEqual(next, {
    trackId: "access:new:8",
    counter: 8,
  });

  const first = getNextNewAccessTrackId([]);
  assert.deepEqual(first, {
    trackId: "access:new:1",
    counter: 1,
  });
});
