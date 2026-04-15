import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";

import {
  createNewWebWorkspace,
  generateWorkspaceZipBytes,
  loadTrackFilesFromWebWorkspace,
  loadWebWorkspaceFromZipData,
  saveWebWorkspace,
} from "../renderer/src/runtime/webWorkspace";

function createLocalized(value: string): Record<string, string> {
  return {
    de: value,
    en: value,
    es: value,
    fr: value,
    it: value,
    pt: value,
  };
}

function createSampleCanyonData(): Record<string, unknown> {
  return {
    id: null,
    coordinates: [9.78948, 47.384366],
    name: "Kobelache",
    description: createLocalized("desc"),
    location: {
      country_code: "AUT",
      region_code: "VOR",
    },
    parking_lots: [
      {
        coordinates: [9.77, 47.38],
        name: createLocalized("parking"),
      },
    ],
    points_of_interest: [],
    tracks_access: ["./tracks/access_01.json"],
    cover_image: null,
    sections: [
      {
        id: 0,
        name: "Merlin's World",
        authors: ["Mario"],
        descriptions: {
          approach: createLocalized("approach"),
          canyon: createLocalized("canyon"),
          exit: createLocalized("exit"),
        },
        special_notes: [],
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
        tour_dimensions_in_meter: {
          elevation_start: 800,
          elevation_exit: 670,
          horizontal_length: 0,
        },
        max_rappel_in_meter: 18,
        recommended_ropes: "1x 40m",
        catchment_area_in_km2: 4.2,
        track_canyon: "./tracks/section_01.json",
        topo: "./topos/section.webp",
        subjective_rating: 0,
        quality_anchoring: 0,
        subjective_rating_count: 0,
        quality_anchoring_count: 0,
        official_partner: null,
        images: {
          cover: null,
          additional: [],
        },
      },
    ],
  };
}

async function buildCanyonZip(
  folderName: string,
  data: Record<string, unknown>,
  extraFiles: Record<string, string> = {},
): Promise<Uint8Array> {
  const zip = new JSZip();
  const root = zip.folder(folderName);
  assert.ok(root);
  root.file("data.json", JSON.stringify(data, null, 2));
  root.file("tracks/section_01.json", JSON.stringify({ type: "FeatureCollection", features: [] }, null, 2));
  root.file("tracks/access_01.json", JSON.stringify({ type: "FeatureCollection", features: [] }, null, 2));
  for (const [filePath, content] of Object.entries(extraFiles)) {
    root.file(filePath, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

test("valid canyon ZIP loads into a workspace and exposes linked track files", async () => {
  const zipBytes = await buildCanyonZip("Kobelache", createSampleCanyonData(), {
    "docs/readme.txt": "hello",
  });

  const loaded = await loadWebWorkspaceFromZipData(zipBytes);
  assert.equal(loaded.filePath, "Kobelache/data.json");
  assert.equal(loaded.workspace.folderName, "Kobelache");
  assert.ok(loaded.workspace.files.has("docs/readme.txt"));

  const trackFiles = loadTrackFilesFromWebWorkspace(loaded.workspace, {
    canyonFilePath: loaded.filePath,
    tracks: [
      {
        id: "section:0",
        kind: "section",
        filePath: "./tracks/section_01.json",
      },
    ],
  });

  assert.equal(trackFiles.entries.length, 1);
  assert.equal(trackFiles.entries[0].missing, false);
  assert.equal(trackFiles.entries[0].absolutePath, "Kobelache/tracks/section_01.json");
});

test("ZIP import rejects missing data.json", async () => {
  const zip = new JSZip();
  const root = zip.folder("Broken");
  assert.ok(root);
  root.file("tracks/access_01.json", "{}");

  await assert.rejects(
    async () => loadWebWorkspaceFromZipData(await zip.generateAsync({ type: "uint8array" })),
    /missing data\.json/i,
  );
});

test("ZIP import rejects missing referenced track files", async () => {
  const data = createSampleCanyonData();
  data.tracks_access = ["./tracks/missing.json"];

  await assert.rejects(
    async () => loadWebWorkspaceFromZipData(await buildCanyonZip("Broken", data)),
    /Referenced track file is missing/i,
  );
});

test("ZIP import rejects path traversal entries", async () => {
  const zip = new JSZip();
  zip.file("Broken/../escape.txt", "nope");

  await assert.rejects(
    async () => loadWebWorkspaceFromZipData(await zip.generateAsync({ type: "uint8array" })),
    /invalid path segment|inside the archive root folder/i,
  );
});

test("web save preserves extra files, keeps root folder, and writes topo null", async () => {
  const loaded = await loadWebWorkspaceFromZipData(
    await buildCanyonZip("Original Canyon", createSampleCanyonData(), {
      "docs/raw.txt": "keep me",
    }),
  );
  const canyonData = loaded.data as Record<string, unknown>;
  canyonData.name = "Original Canyon";

  const saved = saveWebWorkspace({
    workspace: loaded.workspace,
    canyonData,
    canyonName: "Original Canyon",
    trackSnapshot: null,
    forceNullTopos: true,
  });
  const exportedZip = await generateWorkspaceZipBytes(saved.workspace);
  const parsedZip = await JSZip.loadAsync(exportedZip);

  const exportedData = JSON.parse(await parsedZip.file("Original_Canyon/data.json")!.async("text")) as Record<
    string,
    unknown
  >;
  const sections = exportedData.sections as Array<Record<string, unknown>>;

  assert.equal(saved.downloadedFileName, "Original_Canyon.zip");
  assert.equal(sections[0].topo, null);
  assert.ok(parsedZip.file("Original_Canyon/docs/raw.txt"));
  assert.ok(parsedZip.file("Original_Canyon/tracks/section_01.json"));
  assert.ok(parsedZip.files["Original_Canyon/pictures/_cover/Original/"]);
  assert.ok(parsedZip.files["Original_Canyon/pictures/Merlins_World/Original/cover/"]);
});

test("exported web ZIP can be imported again without format changes", async () => {
  const loaded = await loadWebWorkspaceFromZipData(
    await buildCanyonZip("Original Canyon", createSampleCanyonData(), {
      "docs/raw.txt": "keep me",
    }),
  );
  const canyonData = loaded.data as Record<string, unknown>;
  canyonData.name = "Original Canyon";

  const saved = saveWebWorkspace({
    workspace: loaded.workspace,
    canyonData,
    canyonName: "Original Canyon",
    trackSnapshot: null,
    forceNullTopos: true,
  });
  const exportedZip = await generateWorkspaceZipBytes(saved.workspace);
  const reloaded = await loadWebWorkspaceFromZipData(exportedZip);
  const reloadedData = reloaded.data as Record<string, unknown>;
  const sections = reloadedData.sections as Array<Record<string, unknown>>;

  assert.equal(reloaded.filePath, "Original_Canyon/data.json");
  assert.equal(reloaded.workspace.folderName, "Original_Canyon");
  assert.ok(reloaded.workspace.files.has("docs/raw.txt"));
  assert.equal(sections[0].topo, null);
});

test("new web workspaces create compatible directory scaffolding", () => {
  const created = createNewWebWorkspace({
    canyonName: "My Canyon",
    initialSectionNames: ["Part1"],
    canyonData: createSampleCanyonData(),
  });

  assert.equal(created.filePath, "My_Canyon/data.json");
  assert.ok(created.workspace.directories.has("tracks"));
  assert.ok(created.workspace.directories.has("pictures/_cover/Original"));
  assert.ok(created.workspace.directories.has("pictures/Part1/Original/cover"));
});
