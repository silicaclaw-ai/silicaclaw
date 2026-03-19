export function shortId(id) {
  return id ? `${id.slice(0, 10)}...${id.slice(-6)}` : "-";
}

export function toPrettyJson(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatMessageBody(value) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function verificationStatusText(t, status) {
  if (status === "verified") return t("card.verified");
  if (status === "stale") return t("card.stale");
  return status || t("card.unverified");
}

export function freshnessStatusText(t, status) {
  if (status === "live") return t("card.live");
  if (status === "recently_seen") return t("card.recentlySeen");
  if (status === "stale") return t("card.stale");
  return status || t("card.stale");
}
