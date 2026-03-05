import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type PictureSectionDescriptor, syncSectionPictureFolders } from "../electron/mainUtils";

async function withTempCanyon(
  callback: (canyonDirectory: string) => Promise<void>,
): Promise<void> {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "canyon-editor-pictures-"));
  try {
    const canyonDirectory = path.join(rootDirectory, "My_Canyon");
    await mkdir(canyonDirectory, { recursive: true });
    await callback(canyonDirectory);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
}

async function assertDirectoryExists(directoryPath: string): Promise<void> {
  const stats = await stat(directoryPath);
  assert.equal(stats.isDirectory(), true, `Expected directory: ${directoryPath}`);
}

test("syncSectionPictureFolders creates required structure for all sections", async () => {
  await withTempCanyon(async (canyonDirectory) => {
    const currentSections: PictureSectionDescriptor[] = [
      { index: 0, sectionId: 0, name: "Merlin's World" },
      { index: 1, sectionId: 1, name: "Känguru Jump" },
    ];

    const result = await syncSectionPictureFolders({
      canyonDirectory,
      currentSections,
      previousSections: null,
    });

    assert.deepEqual(result.sectionFolderNames, ["Merlins_World", "Kanguru_Jump"]);
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "_cover", "Original"));
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "Merlins_World", "Original", "cover"));
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "Merlins_World", "Original", "additional"));
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "Kanguru_Jump", "Original", "cover"));
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "Kanguru_Jump", "Original", "additional"));
  });
});

test("syncSectionPictureFolders renames mapped section folders on save and prunes extras", async () => {
  await withTempCanyon(async (canyonDirectory) => {
    const picturesDirectory = path.join(canyonDirectory, "pictures");
    await mkdir(path.join(picturesDirectory, "Alpha", "Original", "cover"), { recursive: true });
    await mkdir(path.join(picturesDirectory, "Alpha", "Original", "additional"), { recursive: true });
    await mkdir(path.join(picturesDirectory, "Beta", "Original", "cover"), { recursive: true });
    await mkdir(path.join(picturesDirectory, "Beta", "Original", "additional"), { recursive: true });
    await mkdir(path.join(picturesDirectory, "legacy_extra"), { recursive: true });

    await writeFile(path.join(picturesDirectory, "Alpha", "marker.txt"), "alpha", "utf8");
    await writeFile(path.join(picturesDirectory, "Beta", "marker.txt"), "beta", "utf8");

    const previousSections: PictureSectionDescriptor[] = [
      { index: 0, sectionId: 0, name: "Alpha" },
      { index: 1, sectionId: 1, name: "Beta" },
    ];
    const currentSections: PictureSectionDescriptor[] = [
      { index: 0, sectionId: 0, name: "Beta" },
      { index: 1, sectionId: 1, name: "Alpha" },
    ];

    const result = await syncSectionPictureFolders({
      canyonDirectory,
      currentSections,
      previousSections,
    });

    assert.deepEqual(result.sectionFolderNames, ["Beta", "Alpha"]);
    const betaMarker = await readFile(path.join(picturesDirectory, "Beta", "marker.txt"), "utf8");
    const alphaMarker = await readFile(path.join(picturesDirectory, "Alpha", "marker.txt"), "utf8");
    assert.equal(betaMarker, "alpha");
    assert.equal(alphaMarker, "beta");
    assert.equal(existsSync(path.join(picturesDirectory, "legacy_extra")), false);
    await assertDirectoryExists(path.join(picturesDirectory, "_cover", "Original"));
  });
});

test("syncSectionPictureFolders creates pictures folder when missing", async () => {
  await withTempCanyon(async (canyonDirectory) => {
    const currentSections: PictureSectionDescriptor[] = [
      { index: 0, sectionId: 0, name: "Part1" },
    ];

    await syncSectionPictureFolders({
      canyonDirectory,
      currentSections,
      previousSections: null,
    });

    await assertDirectoryExists(path.join(canyonDirectory, "pictures"));
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "_cover", "Original"));
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "Part1", "Original", "cover"));
    await assertDirectoryExists(path.join(canyonDirectory, "pictures", "Part1", "Original", "additional"));
  });
});

test("syncSectionPictureFolders prunes unrelated existing folders and keeps canonical names", async () => {
  await withTempCanyon(async (canyonDirectory) => {
    const picturesDirectory = path.join(canyonDirectory, "pictures");
    await mkdir(path.join(picturesDirectory, "Part1"), { recursive: true });

    const result = await syncSectionPictureFolders({
      canyonDirectory,
      currentSections: [{ index: 0, sectionId: 0, name: "Part1" }],
      previousSections: null,
    });

    assert.deepEqual(result.sectionFolderNames, ["Part1"]);
    await assertDirectoryExists(path.join(picturesDirectory, "Part1", "Original", "cover"));
    await assertDirectoryExists(path.join(picturesDirectory, "Part1", "Original", "additional"));
  });
});

test("syncSectionPictureFolders removes old folders for deleted sections", async () => {
  await withTempCanyon(async (canyonDirectory) => {
    const picturesDirectory = path.join(canyonDirectory, "pictures");
    await mkdir(path.join(picturesDirectory, "Alpha", "Original", "cover"), { recursive: true });
    await mkdir(path.join(picturesDirectory, "Alpha", "Original", "additional"), { recursive: true });
    await mkdir(path.join(picturesDirectory, "Beta", "Original", "cover"), { recursive: true });
    await mkdir(path.join(picturesDirectory, "Beta", "Original", "additional"), { recursive: true });

    await writeFile(path.join(picturesDirectory, "Alpha", "marker.txt"), "alpha", "utf8");
    await writeFile(path.join(picturesDirectory, "Beta", "marker.txt"), "beta", "utf8");

    const result = await syncSectionPictureFolders({
      canyonDirectory,
      previousSections: [
        { index: 0, sectionId: 0, name: "Alpha" },
        { index: 1, sectionId: 1, name: "Beta" },
      ],
      currentSections: [{ index: 0, sectionId: 0, name: "Gamma" }],
    });

    assert.deepEqual(result.sectionFolderNames, ["Gamma"]);
    assert.equal(existsSync(path.join(picturesDirectory, "Beta")), false);
    assert.equal(await readFile(path.join(picturesDirectory, "Gamma", "marker.txt"), "utf8"), "alpha");
    await assertDirectoryExists(path.join(picturesDirectory, "_cover", "Original"));
  });
});
