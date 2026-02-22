import test from "node:test";
import assert from "node:assert/strict";

import { parseCommandsToCopyFromAsset } from "../renderer/src/shared/commandsToCopy";

test("parseCommandsToCopyFromAsset parses valid button definitions", () => {
  const parsed = parseCommandsToCopyFromAsset([
    {
      button_name: "Copy route command",
      command: "echo route",
    },
    {
      button_name: "  Copy track command  ",
      command: "echo track",
    },
  ]);

  assert.deepEqual(parsed, [
    {
      buttonName: "Copy route command",
      command: "echo route",
    },
    {
      buttonName: "Copy track command",
      command: "echo track",
    },
  ]);
});

test("parseCommandsToCopyFromAsset skips invalid entries", () => {
  const parsed = parseCommandsToCopyFromAsset([
    null,
    {
      button_name: "",
      command: "echo invalid",
    },
    {
      button_name: "Missing command",
    },
    {
      command: "echo missing name",
    },
    {
      button_name: "Wrong command type",
      command: 12,
    },
    {
      button_name: "Valid entry",
      command: "echo valid",
    },
  ]);

  assert.deepEqual(parsed, [
    {
      buttonName: "Valid entry",
      command: "echo valid",
    },
  ]);
});

test("parseCommandsToCopyFromAsset returns empty list for non-array payloads", () => {
  assert.deepEqual(parseCommandsToCopyFromAsset(null), []);
  assert.deepEqual(parseCommandsToCopyFromAsset({}), []);
  assert.deepEqual(parseCommandsToCopyFromAsset("[]"), []);
});

test("parseCommandsToCopyFromAsset keeps input order and exact command text", () => {
  const parsed = parseCommandsToCopyFromAsset([
    {
      button_name: "First",
      command: "  keep-leading-space",
    },
    {
      button_name: "Second",
      command: "line1\nline2",
    },
    {
      button_name: "Third",
      command: "command with trailing space ",
    },
  ]);

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.buttonName, "First");
  assert.equal(parsed[0]?.command, "  keep-leading-space");
  assert.equal(parsed[1]?.buttonName, "Second");
  assert.equal(parsed[1]?.command, "line1\nline2");
  assert.equal(parsed[2]?.buttonName, "Third");
  assert.equal(parsed[2]?.command, "command with trailing space ");
});
