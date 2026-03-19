#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

function parseFlag(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const item of process.argv.slice(2)) {
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return fallback;
}

function main() {
  const skillName = parseFlag("skill", "silicaclaw-broadcast");
  const skillsRoot = resolve(ROOT_DIR, "openclaw-skills");
  const skillDir = resolve(skillsRoot, skillName);
  if (!existsSync(skillDir)) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  const outDir = resolve(ROOT_DIR, "dist", "openclaw-skills");
  mkdirSync(outDir, { recursive: true });
  const archivePath = resolve(outDir, `${skillName}.tgz`);

  const result = spawnSync("tar", ["-czf", archivePath, "-C", skillsRoot, skillName], {
    cwd: ROOT_DIR,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    throw new Error(String(result.stderr || result.stdout || "tar failed").trim());
  }

  const digest = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  const checksumPath = `${archivePath}.sha256`;
  writeFileSync(checksumPath, `${digest}  ${resolve(outDir, `${skillName}.tgz`).split("/").pop()}\n`, "utf8");

  console.log(JSON.stringify({
    skill: skillName,
    source_dir: skillDir,
    archive_path: archivePath,
    sha256: digest,
    checksum_path: checksumPath,
  }, null, 2));
}

main();
