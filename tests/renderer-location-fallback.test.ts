import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLocationFallbackKey,
  buildLocationFallbackQuery,
  getLocationFallbackDecision,
} from "../renderer/src/shared/locationFallback";

test("buildLocationFallbackQuery joins country and region names", () => {
  assert.equal(buildLocationFallbackQuery("Austria", "Tyrol"), "Austria Tyrol");
});

test("buildLocationFallbackQuery uses country when region is empty", () => {
  assert.equal(buildLocationFallbackQuery("Austria", ""), "Austria");
});

test("buildLocationFallbackQuery returns empty string when both values are empty", () => {
  assert.equal(buildLocationFallbackQuery("", "   "), "");
});

test("location fallback is skipped when real viewport coordinates already exist", () => {
  const decision = getLocationFallbackDecision({
    canyonFilePath: "./data/canyon/data.json",
    query: "Austria Tyrol",
    hasViewportCoordinates: true,
    lastAppliedKey: "",
  });

  assert.equal(decision.shouldRun, false);
  assert.equal(decision.nextAppliedKey, "");
});

test("location fallback skips duplicate query keys", () => {
  const lastAppliedKey = buildLocationFallbackKey("./data/canyon/data.json", "Austria Tyrol");
  const decision = getLocationFallbackDecision({
    canyonFilePath: "./data/canyon/data.json",
    query: "Austria Tyrol",
    hasViewportCoordinates: false,
    lastAppliedKey,
  });

  assert.equal(decision.shouldRun, false);
  assert.equal(decision.nextAppliedKey, lastAppliedKey);
});

test("location fallback decision resets and becomes eligible again after query or coordinate changes", () => {
  const initial = getLocationFallbackDecision({
    canyonFilePath: "./data/canyon/data.json",
    query: "Austria Tyrol",
    hasViewportCoordinates: false,
    lastAppliedKey: "",
  });

  assert.equal(initial.shouldRun, true);

  const clearedQuery = getLocationFallbackDecision({
    canyonFilePath: "./data/canyon/data.json",
    query: "",
    hasViewportCoordinates: false,
    lastAppliedKey: initial.nextAppliedKey,
  });
  assert.equal(clearedQuery.shouldRun, false);
  assert.equal(clearedQuery.nextAppliedKey, "");

  const whileMapped = getLocationFallbackDecision({
    canyonFilePath: "./data/canyon/data.json",
    query: "Austria Tyrol",
    hasViewportCoordinates: true,
    lastAppliedKey: initial.nextAppliedKey,
  });
  assert.equal(whileMapped.shouldRun, false);
  assert.equal(whileMapped.nextAppliedKey, "");

  const afterCoordinatesRemoved = getLocationFallbackDecision({
    canyonFilePath: "./data/canyon/data.json",
    query: "Austria Tyrol",
    hasViewportCoordinates: false,
    lastAppliedKey: whileMapped.nextAppliedKey,
  });
  assert.equal(afterCoordinatesRemoved.shouldRun, true);
  assert.equal(afterCoordinatesRemoved.normalizedQuery, "Austria Tyrol");
});
