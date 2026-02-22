#!/usr/bin/env node

import { cp, copyFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const releaseDir = path.join(repoRoot, "release");
const distributionRoot = path.join(releaseDir, "distributions");

async function readPackageMeta() {
  const packageJsonPath = path.join(repoRoot, "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw);
  const productName = typeof parsed.build?.productName === "string" && parsed.build.productName.trim()
    ? parsed.build.productName.trim()
    : "Canyon Editor";
  return { productName };
}

async function listEntries(directoryPath) {
  try {
    return await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function selectLatestPath(paths) {
  const withStats = await Promise.all(
    paths.map(async (candidatePath) => ({
      candidatePath,
      stats: await stat(candidatePath),
    })),
  );
  withStats.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
  return withStats[0]?.candidatePath ?? null;
}

async function resolveWindowsPortableExecutable() {
  const entries = await listEntries(releaseDir);
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .filter((name) => !name.toLowerCase().includes("setup"))
    .map((name) => path.join(releaseDir, name));

  return selectLatestPath(candidates);
}

async function resolveMacAppBundle() {
  const releaseEntries = await listEntries(releaseDir);
  const macOutputDirectories = releaseEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => /^mac($|-)/i.test(name))
    .map((name) => path.join(releaseDir, name));

  const candidates = [];
  for (const macDir of macOutputDirectories) {
    const entries = await listEntries(macDir);
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase().endsWith(".app")) {
        candidates.push(path.join(macDir, entry.name));
      }
    }
  }

  return selectLatestPath(candidates);
}

async function copyEditableData(targetDirectory) {
  const assetsSource = path.join(repoRoot, "assets");
  const assetsTarget = path.join(targetDirectory, "assets");
  await cp(assetsSource, assetsTarget, { recursive: true });
  await mkdir(path.join(targetDirectory, "data"), { recursive: true });

  const dotEnvSource = path.join(repoRoot, ".env");
  try {
    await stat(dotEnvSource);
    await copyFile(dotEnvSource, path.join(assetsTarget, ".env"));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function prepareTargetDirectory(targetDirectory) {
  await rm(targetDirectory, { recursive: true, force: true });
  await mkdir(targetDirectory, { recursive: true });
}

async function assembleWindowsDistribution(productName) {
  const sourceExePath = await resolveWindowsPortableExecutable();
  if (!sourceExePath) {
    return false;
  }

  const windowsTarget = path.join(distributionRoot, "windows");
  await prepareTargetDirectory(windowsTarget);

  const targetExePath = path.join(windowsTarget, `${productName}.exe`);
  await copyFile(sourceExePath, targetExePath);
  await copyEditableData(windowsTarget);
  console.log(`Windows distribution assembled at ${windowsTarget}`);
  return true;
}

async function assembleMacDistribution() {
  const sourceAppPath = await resolveMacAppBundle();
  if (!sourceAppPath) {
    return false;
  }

  const macTarget = path.join(distributionRoot, "macos");
  await prepareTargetDirectory(macTarget);

  await cp(sourceAppPath, path.join(macTarget, path.basename(sourceAppPath)), {
    recursive: true,
    // Preserve macOS app bundle symlinks exactly. Electron frameworks rely on this.
    verbatimSymlinks: true,
  });
  await copyEditableData(macTarget);
  console.log(`macOS distribution assembled at ${macTarget}`);
  return true;
}

async function main() {
  const { productName } = await readPackageMeta();

  await mkdir(distributionRoot, { recursive: true });

  const windowsCreated = await assembleWindowsDistribution(productName);
  const macCreated = await assembleMacDistribution();

  if (!windowsCreated && !macCreated) {
    throw new Error(
      "No build artifacts found. Run `npm run package:win` and/or `npm run package:mac` before `npm run package:dist`.",
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown distribution assembly failure.";
  console.error(message);
  process.exit(1);
});
