#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = resolve(__dirname, "..");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseFlag(name, fallback = "") {
  const prefix = `--${name}=`;
  for (const item of process.argv.slice(2)) {
    if (item.startsWith(prefix)) return item.slice(prefix.length);
  }
  return fallback;
}

function main() {
  const skillName = parseFlag("skill", "silicaclaw-broadcast");
  const skillDir = resolve(ROOT_DIR, "openclaw-skills", skillName);
  const skillMd = resolve(skillDir, "SKILL.md");
  const versionFile = resolve(skillDir, "VERSION");
  const manifestFile = resolve(skillDir, "manifest.json");
  const agentYaml = resolve(skillDir, "agents", "openai.yaml");
  const clientFile = resolve(skillDir, "scripts", "bridge-client.mjs");
  const ownerForwarderDemoFile = resolve(skillDir, "scripts", "owner-forwarder-demo.mjs");
  const ownerDispatchAdapterDemoFile = resolve(skillDir, "scripts", "owner-dispatch-adapter-demo.mjs");
  const ownerSendViaOpenClawFile = resolve(skillDir, "scripts", "send-to-owner-via-openclaw.mjs");
  const ownerPolicyFile = resolve(skillDir, "references", "owner-forwarding-policy.md");
  const ownerDispatchAdapterRefFile = resolve(skillDir, "references", "owner-dispatch-adapter.md");
  const computerControlRefFile = resolve(skillDir, "references", "computer-control-via-openclaw.md");

  for (const filePath of [skillMd, versionFile, manifestFile, agentYaml, clientFile, ownerForwarderDemoFile, ownerDispatchAdapterDemoFile, ownerSendViaOpenClawFile, ownerPolicyFile, ownerDispatchAdapterRefFile, computerControlRefFile]) {
    assert(existsSync(filePath), `Missing required skill file: ${filePath}`);
  }

  const skillBody = readFileSync(skillMd, "utf8");
  const version = readFileSync(versionFile, "utf8").trim();
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const ui = readFileSync(agentYaml, "utf8");
  const ownerPolicy = readFileSync(ownerPolicyFile, "utf8");
  const ownerDispatchAdapterRef = readFileSync(ownerDispatchAdapterRefFile, "utf8");
  const computerControlRef = readFileSync(computerControlRefFile, "utf8");

  assert(skillBody.includes(`name: ${skillName}`), "SKILL.md name metadata mismatch");
  assert(Boolean(version), "VERSION is empty");
  assert(manifest.name === skillName, "manifest name mismatch");
  assert(manifest.version === version, "manifest version does not match VERSION");
  assert(String(manifest.entrypoints?.skill || "") === "SKILL.md", "manifest skill entrypoint mismatch");
  assert(String(manifest.entrypoints?.owner_forwarder_demo || "") === "scripts/owner-forwarder-demo.mjs", "manifest owner forwarder demo entrypoint mismatch");
  assert(String(manifest.entrypoints?.owner_dispatch_adapter_demo || "") === "scripts/owner-dispatch-adapter-demo.mjs", "manifest owner dispatch adapter demo entrypoint mismatch");
  assert(String(manifest.entrypoints?.owner_send_via_openclaw || "") === "scripts/send-to-owner-via-openclaw.mjs", "manifest owner send via openclaw entrypoint mismatch");
  assert(String(manifest.references?.owner_forwarding_policy || "") === "references/owner-forwarding-policy.md", "manifest owner forwarding reference mismatch");
  assert(String(manifest.references?.owner_dispatch_adapter || "") === "references/owner-dispatch-adapter.md", "manifest owner dispatch adapter reference mismatch");
  assert(String(manifest.references?.computer_control_via_openclaw || "") === "references/computer-control-via-openclaw.md", "manifest computer control reference mismatch");
  assert(ui.includes('display_name: "SilicaClaw Broadcast"'), "openai.yaml display_name mismatch");
  assert(ownerPolicy.includes("Default routing modes"), "owner forwarding policy content mismatch");
  assert(ownerDispatchAdapterRef.includes("OPENCLAW_OWNER_FORWARD_CMD"), "owner dispatch adapter reference content mismatch");
  assert(computerControlRef.includes("node.invoke"), "computer control reference content mismatch");

  console.log(JSON.stringify({
    valid: true,
    skill: skillName,
    version,
    skill_dir: skillDir,
  }, null, 2));
}

main();
