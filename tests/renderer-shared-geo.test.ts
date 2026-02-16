import test from "node:test";
import assert from "node:assert/strict";

import {
  appendCoordinate,
  appendCoordinates,
  calculateStraightSegmentDurationSeconds,
  haversineDistanceMeters,
  parseCoordinateInput,
  toCoordinatePair,
  toCoordinatesArray,
} from "../renderer/src/shared/geo";

test("parseCoordinateInput parses valid input with rounding", () => {
  const parsed = parseCoordinateInput("9.123456789, 47.987654321");
  assert.equal(parsed.error, "");
  assert.deepEqual(parsed.coordinate, [9.123457, 47.987654]);
});

test("parseCoordinateInput rejects invalid format", () => {
  const parsed = parseCoordinateInput("foo");
  assert.equal(parsed.coordinate, null);
  assert.equal(parsed.error, "Use format: 9.1951612, 48.2951951");
});

test("toCoordinatePair and toCoordinatesArray normalize finite values", () => {
  assert.deepEqual(toCoordinatePair([1.23456789, 2.34567891]), [1.234568, 2.345679]);
  assert.equal(toCoordinatePair(["x", 2]), null);

  const coordinates = toCoordinatesArray([
    [1, 2],
    ["bad", 3],
    [4.4444444, 5.5555555],
  ]);
  assert.deepEqual(coordinates, [
    [1, 2],
    [4.444444, 5.555555],
  ]);
});

test("appendCoordinate and appendCoordinates skip duplicate consecutive coordinates", () => {
  const target: Array<[number, number]> = [];
  appendCoordinate(target, [1, 2]);
  appendCoordinate(target, [1, 2]);
  appendCoordinates(target, [
    [1, 2],
    [3, 4],
  ]);

  assert.deepEqual(target, [
    [1, 2],
    [3, 4],
  ]);
});

test("distance and duration helpers return positive values", () => {
  const distance = haversineDistanceMeters([9.0, 47.0], [9.001, 47.001]);
  assert.ok(distance > 0);

  const duration = calculateStraightSegmentDurationSeconds(distance, 50);
  assert.ok(duration > 0);
});