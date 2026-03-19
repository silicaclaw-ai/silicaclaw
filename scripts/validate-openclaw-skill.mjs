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
  const profile = {
    "silicaclaw-broadcast": {
      requiredFiles: [
        resolve(skillDir, "scripts", "bridge-client.mjs"),
        resolve(skillDir, "scripts", "owner-forwarder-demo.mjs"),
        resolve(skillDir, "scripts", "owner-dispatch-adapter-demo.mjs"),
        resolve(skillDir, "scripts", "send-to-owner-via-openclaw.mjs"),
        resolve(skillDir, "references", "owner-forwarding-policy.md"),
        resolve(skillDir, "references", "owner-dispatch-adapter.md"),
        resolve(skillDir, "references", "computer-control-via-openclaw.md"),
        resolve(skillDir, "references", "owner-dialogue-cheatsheet-zh.md"),
      ],
      uiDisplayName: 'display_name: "SilicaClaw Broadcast"',
      checks(manifest, files) {
        const ownerPolicy = readFileSync(files[4], "utf8");
        const ownerDispatchAdapterRef = readFileSync(files[5], "utf8");
        const computerControlRef = readFileSync(files[6], "utf8");
        const dialogueCheatsheetZh = readFileSync(files[7], "utf8");
        assert(String(manifest.entrypoints?.owner_forwarder_demo || "") === "scripts/owner-forwarder-demo.mjs", "manifest owner forwarder demo entrypoint mismatch");
        assert(String(manifest.entrypoints?.owner_dispatch_adapter_demo || "") === "scripts/owner-dispatch-adapter-demo.mjs", "manifest owner dispatch adapter demo entrypoint mismatch");
        assert(String(manifest.entrypoints?.owner_send_via_openclaw || "") === "scripts/send-to-owner-via-openclaw.mjs", "manifest owner send via openclaw entrypoint mismatch");
        assert(String(manifest.references?.owner_forwarding_policy || "") === "references/owner-forwarding-policy.md", "manifest owner forwarding reference mismatch");
        assert(String(manifest.references?.owner_dispatch_adapter || "") === "references/owner-dispatch-adapter.md", "manifest owner dispatch adapter reference mismatch");
        assert(String(manifest.references?.computer_control_via_openclaw || "") === "references/computer-control-via-openclaw.md", "manifest computer control reference mismatch");
        assert(String(manifest.references?.owner_dialogue_cheatsheet_zh || "") === "references/owner-dialogue-cheatsheet-zh.md", "manifest owner dialogue cheatsheet zh reference mismatch");
        assert(ownerPolicy.includes("Default routing modes"), "owner forwarding policy content mismatch");
        assert(ownerDispatchAdapterRef.includes("OPENCLAW_OWNER_FORWARD_CMD"), "owner dispatch adapter reference content mismatch");
        assert(computerControlRef.includes("node.invoke"), "computer control reference content mismatch");
        assert(dialogueCheatsheetZh.includes("主人对话速查表"), "owner dialogue cheatsheet zh content mismatch");
      },
    },
    "silicaclaw-owner-push": {
      requiredFiles: [
        resolve(skillDir, "scripts", "owner-push-forwarder.mjs"),
        resolve(skillDir, "scripts", "send-to-owner-via-openclaw.mjs"),
        resolve(skillDir, "references", "push-routing-policy.md"),
        resolve(skillDir, "references", "runtime-setup.md"),
        resolve(skillDir, "references", "owner-dialogue-cheatsheet-zh.md"),
      ],
      uiDisplayName: 'display_name: "SilicaClaw Owner Push"',
      checks(manifest, files) {
        const pushRouting = readFileSync(files[2], "utf8");
        const runtimeSetup = readFileSync(files[3], "utf8");
        const dialogueCheatsheetZh = readFileSync(files[4], "utf8");
        assert(String(manifest.entrypoints?.owner_push_forwarder || "") === "scripts/owner-push-forwarder.mjs", "manifest owner push forwarder entrypoint mismatch");
        assert(String(manifest.entrypoints?.owner_send_via_openclaw || "") === "scripts/send-to-owner-via-openclaw.mjs", "manifest owner send via openclaw entrypoint mismatch");
        assert(String(manifest.references?.push_routing_policy || "") === "references/push-routing-policy.md", "manifest push routing policy reference mismatch");
        assert(String(manifest.references?.runtime_setup || "") === "references/runtime-setup.md", "manifest runtime setup reference mismatch");
        assert(String(manifest.references?.owner_dialogue_cheatsheet_zh || "") === "references/owner-dialogue-cheatsheet-zh.md", "manifest owner dialogue cheatsheet zh reference mismatch");
        assert(pushRouting.includes("Default routes"), "push routing policy content mismatch");
        assert(runtimeSetup.includes("Minimum setup"), "runtime setup content mismatch");
        assert(dialogueCheatsheetZh.includes("主人对话速查表"), "owner dialogue cheatsheet zh content mismatch");
      },
    },
    "silicaclaw-bridge-setup": {
      requiredFiles: [
        resolve(skillDir, "references", "runtime-setup.md"),
        resolve(skillDir, "references", "troubleshooting.md"),
        resolve(skillDir, "references", "owner-dialogue-cheatsheet-zh.md"),
      ],
      uiDisplayName: 'display_name: "SilicaClaw Bridge Setup"',
      checks(manifest, files) {
        const runtimeSetup = readFileSync(files[0], "utf8");
        const troubleshooting = readFileSync(files[1], "utf8");
        const dialogueCheatsheetZh = readFileSync(files[2], "utf8");
        assert(String(manifest.references?.runtime_setup || "") === "references/runtime-setup.md", "manifest runtime setup reference mismatch");
        assert(String(manifest.references?.troubleshooting || "") === "references/troubleshooting.md", "manifest troubleshooting reference mismatch");
        assert(String(manifest.references?.owner_dialogue_cheatsheet_zh || "") === "references/owner-dialogue-cheatsheet-zh.md", "manifest owner dialogue cheatsheet zh reference mismatch");
        assert(runtimeSetup.includes("Minimum setup"), "runtime setup content mismatch");
        assert(troubleshooting.includes("Common setup blockers"), "troubleshooting content mismatch");
        assert(dialogueCheatsheetZh.includes("主人对话速查表"), "owner dialogue cheatsheet zh content mismatch");
      },
    },
  }[skillName];

  assert(profile, `Unsupported skill for validation: ${skillName}`);

  for (const filePath of [skillMd, versionFile, manifestFile, agentYaml, ...profile.requiredFiles]) {
    assert(existsSync(filePath), `Missing required skill file: ${filePath}`);
  }

  const skillBody = readFileSync(skillMd, "utf8");
  const version = readFileSync(versionFile, "utf8").trim();
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const ui = readFileSync(agentYaml, "utf8");

  assert(skillBody.includes(`name: ${skillName}`), "SKILL.md name metadata mismatch");
  assert(Boolean(version), "VERSION is empty");
  assert(manifest.name === skillName, "manifest name mismatch");
  assert(manifest.version === version, "manifest version does not match VERSION");
  assert(String(manifest.entrypoints?.skill || "") === "SKILL.md", "manifest skill entrypoint mismatch");
  assert(ui.includes(profile.uiDisplayName), "openai.yaml display_name mismatch");
  profile.checks(manifest, profile.requiredFiles);

  console.log(JSON.stringify({
    valid: true,
    skill: skillName,
    version,
    skill_dir: skillDir,
  }, null, 2));
}

main();
