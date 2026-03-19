#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

function listSkillDirs(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((name) => ({ name, path: resolve(root, name) }))
    .filter((entry) => {
      try {
        return statSync(entry.path).isDirectory();
      } catch {
        return false;
      }
    });
}

function main() {
  const sourceRoot = resolve(ROOT_DIR, "openclaw-skills");
  const targetRoot = resolve(homedir(), ".openclaw", "workspace", "skills");
  const legacyTargetRoot = resolve(homedir(), ".openclaw", "skills");
  const requestedSkill = String(process.argv.find((arg) => arg.startsWith("--skill=")) || "")
    .replace(/^--skill=/, "")
    .trim();
  const allSkills = listSkillDirs(sourceRoot);
  const skills = requestedSkill
    ? allSkills.filter((skill) => skill.name === requestedSkill)
    : allSkills;

  if (!skills.length) {
    throw new Error(requestedSkill ? `Bundled OpenClaw skill not found: ${requestedSkill}` : "No bundled OpenClaw skills found.");
  }

  mkdirSync(targetRoot, { recursive: true });
  mkdirSync(legacyTargetRoot, { recursive: true });

  for (const skill of skills) {
    cpSync(skill.path, resolve(targetRoot, skill.name), { recursive: true, force: true });
    cpSync(skill.path, resolve(legacyTargetRoot, skill.name), { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    requested_skill: requestedSkill || null,
    installed: skills.map((skill) => ({
      name: skill.name,
      target_path: resolve(targetRoot, skill.name),
      legacy_target_path: resolve(legacyTargetRoot, skill.name),
    })),
    target_root: targetRoot,
    legacy_target_root: legacyTargetRoot,
  }, null, 2));
}

main();
