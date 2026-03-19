export function ago(ts) {
  if (!ts) return "-";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function shortId(id) {
  if (!id) return "-";
  return `${id.slice(0, 10)}...${id.slice(-6)}`;
}

export function messageSendReasonText(t, reason) {
  if (reason === "rate_limited") return t("feedback.messageRateLimited");
  if (reason === "duplicate_recent_message") return t("feedback.messageDuplicateBlocked");
  if (reason === "blocked_term") return t("feedback.messageBlockedTerm");
  return t("feedback.messageBroadcastFailed");
}

export function describeCurrentMode(t, mode) {
  if (mode === "local") return t("overview.modeLocal");
  if (mode === "global-preview") return t("overview.modeGlobalPreview");
  return t("overview.modeLan");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toPrettyJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function formatMessageBody(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function resolveThemeMode(mode) {
  if (mode === "system") {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode === "light" ? "light" : "dark";
}

export function parseTags(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((tag, idx, arr) => arr.indexOf(tag) === idx);
}

export function parseCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((item, idx, arr) => arr.indexOf(item) === idx);
}

export function field(form, name) {
  return form.querySelector(`[name="${name}"]`);
}

export function normalizeTagsInput(raw) {
  return parseTags(raw).join(", ");
}
