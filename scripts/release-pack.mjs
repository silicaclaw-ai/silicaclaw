#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readText(filePath) {
  return readFileSync(filePath, "utf8").trim();
}

function normalizeVersion(value) {
  const text = String(value || "").trim();
  return text.startsWith("v") ? text.slice(1) : text;
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function run(cmd, cmdArgs, extraEnv = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_cache: resolve(ROOT_DIR, ".npm-cache"),
      ...extraEnv,
    },
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function verifyVersionSync() {
  const pkg = readJson(resolve(ROOT_DIR, "package.json"));
  const lock = readJson(resolve(ROOT_DIR, "package-lock.json"));
  const rootVersionFile = readText(resolve(ROOT_DIR, "VERSION"));
  const skillVersionFile = readText(resolve(ROOT_DIR, "openclaw-skills", "silicaclaw-broadcast", "VERSION"));
  const skillManifest = readJson(resolve(ROOT_DIR, "openclaw-skills", "silicaclaw-broadcast", "manifest.json"));

  const expected = normalizeVersion(pkg.version);
  const checks = [
    ["package.json", normalizeVersion(pkg.version)],
    ["package-lock.json", normalizeVersion(lock.version)],
    ['package-lock.json packages[""]', normalizeVersion(lock.packages?.[""]?.version)],
    ["VERSION", normalizeVersion(rootVersionFile)],
    ["skill VERSION", normalizeVersion(skillVersionFile)],
    ["skill manifest", normalizeVersion(skillManifest.version)],
  ];

  for (const [label, actual] of checks) {
    assert(Boolean(actual), `Missing version in ${label}`);
    assert(actual === expected, `Version mismatch: ${label}=${actual}, expected ${expected}`);
  }

  console.log(`Version sync OK: ${expected}`);
}

function main() {
  assert(existsSync(resolve(ROOT_DIR, "package.json")), "package.json not found");
  verifyVersionSync();

  console.log("Building workspaces...");
  run("npm", ["run", "build"]);

  console.log("Validating bundled OpenClaw skill...");
  run("node", [resolve(ROOT_DIR, "scripts", "validate-openclaw-skill.mjs")]);

  console.log(dryRun ? "Running npm pack dry-run..." : "Packing npm tarball...");
  run("npm", ["pack", ...(dryRun ? ["--dry-run"] : [])]);
}

main();
