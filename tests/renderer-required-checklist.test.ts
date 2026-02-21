import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRequiredDataChecklist,
  getLocalizedValue,
  isTrackBoundaryComplete,
  isValidTopoPath,
  type ChecklistNode,
  type ChecklistStatus,
} from "../renderer/src/json-editor/requiredDataChecklist";
import { normalizeCanyonForEditor } from "../renderer/src/json-editor/canyonSchemaDefaults";

function localized(value: string): Record<string, string> {
  return {
    de: value,
    en: value,
    es: value,
    fr: value,
    it: value,
    pt: value,
  };
}

function createValidCanyonData(): Record<string, unknown> {
  return {
    coordinates: [9.78948, 47.384366],
    name: "Kobelache",
    description: localized("desc"),
    location: {
      country_code: "AUT",
      region_code: "VOR",
    },
    parking_lots: [
      {
        coordinates: [9.77, 47.38],
        name: localized("parking"),
      },
    ],
    tracks_access: ["./tracks/access_01.json"],
    sections: [
      {
        name: "Merlin's World",
        authors: ["Mario"],
        descriptions: {
          approach: localized("approach"),
          canyon: localized("canyon"),
          exit: localized("exit"),
        },
        difficulties: {
          vertical: 3,
          aquatic: 2,
          general: 3,
        },
        durations_in_minutes: {
          approach_no_shuttle: 60,
          approach_with_shuttle: 20,
          canyon: 120,
          exit_no_shuttle: 15,
          exit_with_shuttle: 10,
        },
        max_rappel_in_meter: 18,
        recommended_ropes: "1x 40m",
        catchment_area_in_km2: 4.2,
        topo: "./topos/KangarooJump.webp",
      },
    ],
  };
}

function createValidTrackSnapshot(): {
  tracks: Array<{
    id: string;
    kind: string;
    sectionIndex?: number;
    displayName: string;
    routePoints: Array<{ type: string }>;
  }>;
} {
  return {
    tracks: [
      {
        id: "section:0",
        kind: "section",
        sectionIndex: 0,
        displayName: "Merlin's World",
        routePoints: [{ type: "start" }, { type: "end" }],
      },
      {
        id: "access:0",
        kind: "access",
        displayName: "Access 1",
        routePoints: [{ type: "start" }, { type: "end" }],
      },
    ],
  };
}

function findNode(nodes: ChecklistNode[], id: string): ChecklistNode | null {
  const stack = [...nodes];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) {
      continue;
    }

    if (current.id === id) {
      return current;
    }

    stack.unshift(...current.children);
  }

  return null;
}

function getNodeStatus(nodes: ChecklistNode[], id: string): ChecklistStatus {
  const node = findNode(nodes, id);
  assert.ok(node, `Expected checklist node "${id}" to exist.`);
  return node.status;
}

test("overview point is missing when coordinates are not set", () => {
  const canyonData = createValidCanyonData();
  canyonData.coordinates = null;

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });

  assert.equal(getNodeStatus(tree, "canyon/overview"), "missing");
});

test("localized fields treat whitespace as missing", () => {
  const canyonData = createValidCanyonData();
  (canyonData.description as Record<string, string>).de = "   ";

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });

  assert.equal(getNodeStatus(tree, "canyon/description/de"), "missing");
  assert.equal(getNodeStatus(tree, "canyon/description"), "missing");
});

test("country and region are missing when dropdown values are empty", () => {
  const canyonData = createValidCanyonData();
  canyonData.location = {
    country_code: "",
    region_code: "",
  };

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });

  assert.equal(getNodeStatus(tree, "canyon/location/country"), "missing");
  assert.equal(getNodeStatus(tree, "canyon/location/region"), "missing");
});

test("parking lots create a synthetic missing node when none are present", () => {
  const canyonData = createValidCanyonData();
  canyonData.parking_lots = [];

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });

  assert.equal(getNodeStatus(tree, "canyon/parking/0"), "missing");
  assert.equal(getNodeStatus(tree, "canyon/parking"), "missing");
});

test("parking lot parent is missing when one defined lot has an empty language", () => {
  const canyonData = createValidCanyonData();
  canyonData.parking_lots = [
    {
      name: localized("parking-1"),
    },
    {
      name: {
        ...localized("parking-2"),
        fr: "",
      },
    },
  ];

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });

  assert.equal(getNodeStatus(tree, "canyon/parking/1/fr"), "missing");
  assert.equal(getNodeStatus(tree, "canyon/parking"), "missing");
});

test("access tracks create a synthetic missing node when no track exists", () => {
  const canyonData = createValidCanyonData();
  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: { tracks: [] },
  });

  assert.equal(getNodeStatus(tree, "canyon/access/0"), "missing");
  assert.equal(getNodeStatus(tree, "canyon/access"), "missing");
});

test("access parent is missing when one defined access track lacks a boundary point", () => {
  const canyonData = createValidCanyonData();
  const snapshot = createValidTrackSnapshot();
  snapshot.tracks.push({
    id: "access:1",
    kind: "access",
    displayName: "Access 2",
    routePoints: [{ type: "start" }],
  });

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: snapshot,
  });

  assert.equal(getNodeStatus(tree, "canyon/access/access:1"), "missing");
  assert.equal(getNodeStatus(tree, "canyon/access"), "missing");
});

test("section fields enforce author, numeric, ropes, and section-track requirements", () => {
  const canyonData = createValidCanyonData();
  const section = (canyonData.sections as Array<Record<string, unknown>>)[0];
  section.authors = [" ", ""];
  section.difficulties = {
    vertical: 0,
    aquatic: 0,
    general: 0,
  };
  section.durations_in_minutes = {
    approach_no_shuttle: 0,
    approach_with_shuttle: 0,
    canyon: 0,
    exit_no_shuttle: 0,
    exit_with_shuttle: 0,
  };
  section.max_rappel_in_meter = 0;
  section.recommended_ropes = "  2X   0m ";
  section.catchment_area_in_km2 = null;

  const snapshot = createValidTrackSnapshot();
  snapshot.tracks[0] = {
    ...snapshot.tracks[0],
    routePoints: [{ type: "start" }],
  };

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: snapshot,
  });

  assert.equal(getNodeStatus(tree, "section/0/authors"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/difficulties/vertical"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/durations/canyon"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/max-rappel"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/recommended-ropes"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/catchment-area"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/track"), "missing");
});

test("catchment area is present when set to 0 and missing when null", () => {
  const canyonData = createValidCanyonData();
  const section = (canyonData.sections as Array<Record<string, unknown>>)[0];
  section.catchment_area_in_km2 = null;

  const treeWhenNull = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });
  assert.equal(getNodeStatus(treeWhenNull, "section/0/catchment-area"), "missing");

  section.catchment_area_in_km2 = 0;
  const treeWhenZero = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });
  assert.equal(getNodeStatus(treeWhenZero, "section/0/catchment-area"), "present");
});

test("topo validity requires /topos path and image extension", () => {
  assert.equal(isValidTopoPath("./topos/foo.webp"), true);
  assert.equal(isValidTopoPath("/topos/foo.PNG"), true);
  assert.equal(isValidTopoPath("./images/foo.webp"), false);
  assert.equal(isValidTopoPath("./topos/foo.txt"), false);
  assert.equal(isValidTopoPath(""), false);
});

test("localized helper returns trimmed values and empty string for invalid inputs", () => {
  assert.equal(getLocalizedValue({ de: "  Hallo " }, "de"), "Hallo");
  assert.equal(getLocalizedValue({ de: 123 }, "de"), "");
  assert.equal(getLocalizedValue(null, "de"), "");
});

test("track boundary helper requires at least one start and one end", () => {
  assert.equal(
    isTrackBoundaryComplete([
      { type: "start" },
      { type: "waypoint" },
      { type: "end" },
    ]),
    true,
  );
  assert.equal(isTrackBoundaryComplete([{ type: "start" }]), false);
  assert.equal(isTrackBoundaryComplete([{ type: "end" }]), false);
});

test("section topo node is missing when path is outside /topos", () => {
  const canyonData = createValidCanyonData();
  const section = (canyonData.sections as Array<Record<string, unknown>>)[0];
  section.topo = "./other/place.webp";

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: createValidTrackSnapshot(),
  });

  assert.equal(getNodeStatus(tree, "section/0/topo"), "missing");
});

test("normalized missing-key defaults are treated as missing in checklist", () => {
  const canyonData = normalizeCanyonForEditor({
    name: "Test canyon",
    sections: [{}],
  });

  const tree = buildRequiredDataChecklist({
    canyonData,
    trackSnapshot: { tracks: [] },
  });

  assert.equal(getNodeStatus(tree, "canyon/overview"), "missing");
  assert.equal(getNodeStatus(tree, "canyon/location/country"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/recommended-ropes"), "missing");
  assert.equal(getNodeStatus(tree, "section/0/catchment-area"), "missing");
});
