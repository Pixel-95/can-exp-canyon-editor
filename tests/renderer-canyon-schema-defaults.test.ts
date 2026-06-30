import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyLocalizedText,
  normalizeCanyonForEditor,
  isFiniteCoordinatePair,
} from "../renderer/src/json-editor/canyonSchemaDefaults";

function asObject(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

test("missing root keys are normalized to explicit invalid defaults", () => {
  const normalized = normalizeCanyonForEditor({});

  assert.equal(normalized.id, null);
  assert.equal(normalized.coordinates, null);
  assert.equal(normalized.name, "");
  assert.equal(normalized.cover_image, null);
  assert.deepEqual(normalized.description, createEmptyLocalizedText());
  assert.deepEqual(normalized.location, {
    country_code: "",
    region_code: "",
  });
  assert.deepEqual(normalized.parking_lots, []);
  assert.deepEqual(normalized.points_of_interest, []);
  assert.deepEqual(normalized.tracks_access, []);
  assert.deepEqual(normalized.sections, []);
});

test("missing section keys are normalized to explicit defaults", () => {
  const normalized = normalizeCanyonForEditor({
    sections: [{}],
  });
  const sections = asArray(normalized.sections);
  assert.equal(sections.length, 1);

  const section = asObject(sections[0]);
  assert.equal(section.id, 0);
  assert.equal(section.name, "");
  assert.deepEqual(section.authors, []);
  assert.deepEqual(section.special_notes, []);
  assert.equal(section.max_rappel_in_meter, 0);
  assert.equal(section.recommended_ropes, "2x 0m");
  assert.equal(section.catchment_area_in_km2, null);
  assert.equal(section.track_canyon, "");
  assert.equal(section.topo, "");
  assert.equal(section.subjective_rating, 0);
  assert.equal(section.quality_anchoring, 0);
  assert.equal(section.subjective_rating_count, 0);
  assert.equal(section.quality_anchoring_count, 0);
  assert.equal(section.official_partner, null);

  const descriptions = asObject(section.descriptions);
  assert.deepEqual(descriptions.approach, createEmptyLocalizedText());
  assert.deepEqual(descriptions.canyon, createEmptyLocalizedText());
  assert.deepEqual(descriptions.exit, createEmptyLocalizedText());

  const difficulties = asObject(section.difficulties);
  assert.deepEqual(difficulties, {
    vertical: 0,
    aquatic: 0,
    general: 0,
  });

  const durations = asObject(section.durations_in_minutes);
  assert.deepEqual(durations, {
    approach_no_shuttle: 0,
    approach_with_shuttle: 0,
    canyon: 0,
    exit_no_shuttle: 0,
    exit_with_shuttle: 0,
  });

  const tourDimensions = asObject(section.tour_dimensions_in_meter);
  assert.deepEqual(tourDimensions, {
    elevation_start: 0,
    elevation_exit: 0,
    horizontal_length: 0,
  });

  const images = asObject(section.images);
  assert.equal(images.cover, null);
  assert.deepEqual(images.additional, []);
});

test("section ids remain stable when display order differs from ids", () => {
  const normalized = normalizeCanyonForEditor({
    sections: [
      { id: 2, name: "New upper" },
      { id: 0, name: "Existing first" },
      { id: 1, name: "Existing second" },
    ],
  });

  const sections = asArray(normalized.sections);
  assert.deepEqual(sections.map((section) => asObject(section).id), [2, 0, 1]);
  assert.deepEqual(sections.map((section) => asObject(section).name), [
    "New upper",
    "Existing first",
    "Existing second",
  ]);
});

test("missing and duplicate section ids are assigned deterministic unused ids", () => {
  const normalized = normalizeCanyonForEditor({
    sections: [
      { id: 0, name: "Existing first" },
      { id: 1, name: "Existing second" },
      { name: "Missing id" },
      { id: 1, name: "Duplicate id" },
      { id: -1, name: "Invalid id" },
    ],
  });

  const sections = asArray(normalized.sections);
  assert.deepEqual(sections.map((section) => asObject(section).id), [0, 1, 2, 3, 4]);
});

test("localized objects are filled with six language keys", () => {
  const normalized = normalizeCanyonForEditor({
    description: { en: "Root text" },
    sections: [
      {
        descriptions: {
          approach: { de: "Anstieg" },
        },
      },
    ],
  });

  const rootDescription = asObject(normalized.description);
  assert.equal(rootDescription.en, "Root text");
  assert.equal(rootDescription.de, "");
  assert.equal(rootDescription.es, "");
  assert.equal(rootDescription.fr, "");
  assert.equal(rootDescription.it, "");
  assert.equal(rootDescription.pt, "");

  const sections = asArray(normalized.sections);
  const section = asObject(sections[0]);
  const descriptions = asObject(section.descriptions);
  const approach = asObject(descriptions.approach);
  assert.equal(approach.de, "Anstieg");
  assert.equal(approach.en, "");
  assert.equal(approach.es, "");
  assert.equal(approach.fr, "");
  assert.equal(approach.it, "");
  assert.equal(approach.pt, "");
});

test("unknown keys are preserved while schema defaults are injected", () => {
  const normalized = normalizeCanyonForEditor({
    custom_root: "keep-root",
    location: {
      custom_location: "keep-location",
    },
    sections: [
      {
        custom_section: "keep-section",
        descriptions: {
          approach: {
            nl: "Onbekend",
          },
        },
      },
    ],
  });

  assert.equal(normalized.custom_root, "keep-root");
  const location = asObject(normalized.location);
  assert.equal(location.custom_location, "keep-location");

  const sections = asArray(normalized.sections);
  const section = asObject(sections[0]);
  assert.equal(section.custom_section, "keep-section");

  const descriptions = asObject(section.descriptions);
  const approach = asObject(descriptions.approach);
  assert.equal(approach.nl, "Onbekend");
});

test("missing or invalid sections normalize to an empty array and invalid entries are dropped", () => {
  const missingSections = normalizeCanyonForEditor({});
  assert.deepEqual(missingSections.sections, []);

  const invalidSections = normalizeCanyonForEditor({
    sections: [null, "section", { name: "Valid section" }],
  });
  const sections = asArray(invalidSections.sections);
  assert.equal(sections.length, 1);
  const onlySection = asObject(sections[0]);
  assert.equal(onlySection.id, 0);
  assert.equal(onlySection.name, "Valid section");
});

test("poi and parking entries are kept with coordinates null when missing", () => {
  const normalized = normalizeCanyonForEditor({
    points_of_interest: [
      {
        name: { en: "Lookout" },
        description: { en: "Nice view" },
      },
      {
        coordinates: [9.1, 47.2],
        name: { de: "Punkt" },
        description: {},
      },
      "drop-me",
    ],
    parking_lots: [
      {
        name: { en: "Main lot" },
      },
      {
        coordinates: [9.2, 47.3],
        name: {},
      },
      42,
    ],
  });

  const poi = asArray(normalized.points_of_interest);
  assert.equal(poi.length, 2);
  const firstPoi = asObject(poi[0]);
  assert.equal(firstPoi.coordinates, null);
  assert.deepEqual(firstPoi.name, {
    ...createEmptyLocalizedText(),
    en: "Lookout",
  });

  const parking = asArray(normalized.parking_lots);
  assert.equal(parking.length, 2);
  const firstParking = asObject(parking[0]);
  assert.equal(firstParking.coordinates, null);
  assert.deepEqual(firstParking.name, {
    ...createEmptyLocalizedText(),
    en: "Main lot",
  });
});

test("coordinate helper accepts finite pairs only", () => {
  assert.equal(isFiniteCoordinatePair([9.2, 47.3]), true);
  assert.equal(isFiniteCoordinatePair([9.2]), false);
  assert.equal(isFiniteCoordinatePair(["9.2", 47.3]), false);
  assert.equal(isFiniteCoordinatePair(null), false);
});
