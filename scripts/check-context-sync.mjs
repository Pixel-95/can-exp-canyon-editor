#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    if (options.allowFailure) {
      return "";
    }

    const stderr = (result.stderr || "").trim();
    throw new Error(stderr || `git ${args.join(" ")} failed.`);
  }

  return (result.stdout || "").trim();
}

function parseArgs(argv) {
  let staged = false;
  let baseRef = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--staged") {
      staged = true;
      continue;
    }
    if (arg === "--base") {
      baseRef = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      return { help: true, staged: false, baseRef: null };
    }
  }

  return { help: false, staged, baseRef };
}

function normalizePaths(rawValue) {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(/\r?\n/g)
    .map((entry) => entry.trim().replace(/\\/g, "/"))
    .filter((entry) => entry.length > 0);
}

function buildChangedFileList({ staged, baseRef }) {
  const changed = new Set();

  if (staged) {
    for (const filePath of normalizePaths(runGit(["diff", "--name-only", "--cached"]))) {
      changed.add(filePath);
    }
    return Array.from(changed);
  }

  if (baseRef) {
    const mergeBase = runGit(["merge-base", "HEAD", baseRef], { allowFailure: true });
    const diffRange = mergeBase ? `${mergeBase}..HEAD` : `${baseRef}..HEAD`;
    for (const filePath of normalizePaths(runGit(["diff", "--name-only", diffRange]))) {
      changed.add(filePath);
    }
    return Array.from(changed);
  }

  for (const filePath of normalizePaths(runGit(["diff", "--name-only", "HEAD"]))) {
    changed.add(filePath);
  }
  for (const filePath of normalizePaths(runGit(["ls-files", "--others", "--exclude-standard"]))) {
    changed.add(filePath);
  }

  return Array.from(changed);
}

function isCoreContextChange(filePath) {
  if (
    filePath.startsWith("renderer/src/") ||
    filePath.startsWith("electron/") ||
    filePath.startsWith("assets/") ||
    filePath.startsWith("data/")
  ) {
    return true;
  }

  return (
    filePath === "package.json" ||
    filePath === "tsconfig.json" ||
    filePath === "tsconfig.base.json" ||
    filePath === "README.md"
  );
}

function main() {
  const { help, staged, baseRef } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log("Usage: node scripts/check-context-sync.mjs [--staged] [--base <git-ref>]");
    process.exit(0);
  }

  if (process.env.SKIP_CONTEXT_SYNC === "1") {
    console.log("Context sync check skipped because SKIP_CONTEXT_SYNC=1.");
    process.exit(0);
  }

  const changedFiles = buildChangedFileList({ staged, baseRef }).sort((left, right) =>
    left.localeCompare(right),
  );

  if (changedFiles.length === 0) {
    console.log("Context sync check: no changed files detected.");
    process.exit(0);
  }

  const changedSet = new Set(changedFiles);
  const failures = [];

  const hasCoreChange = changedFiles.some((filePath) => isCoreContextChange(filePath));
  const hasContextOrConventionUpdate =
    changedSet.has("PROJECT_CONTEXT.md") || changedSet.has("PROJECT_CONVENTIONS.md");
  if (hasCoreChange && !hasContextOrConventionUpdate) {
    failures.push(
      "Core project changes detected without updates to PROJECT_CONTEXT.md or PROJECT_CONVENTIONS.md.",
    );
  }

  const hasSkillChange = changedFiles.some((filePath) => filePath.startsWith(".codex/skills/"));
  if (hasSkillChange && !changedSet.has("AGENTS.md")) {
    failures.push("Skill changes detected without AGENTS.md update.");
  }

  if (failures.length > 0) {
    console.error("Context sync check failed.");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error("");
    console.error("Changed files:");
    for (const filePath of changedFiles) {
      console.error(`- ${filePath}`);
    }
    console.error("");
    console.error("If this is intentional, rerun with SKIP_CONTEXT_SYNC=1 for a one-off bypass.");
    process.exit(1);
  }

  console.log("Context sync check passed.");
}

main();
