export function createNetworkController({
  ago,
  api,
  describeCurrentMode,
  peerStatusText,
  shortId,
  t,
  toPrettyJson,
  writeUiCache,
}) {
  async function refreshNetwork() {
    const [cfg, sts, rtp] = await Promise.all([api("/api/network/config"), api("/api/network/stats"), api("/api/runtime/paths")]);
    const c = cfg.data;
    const s = sts.data;
    const runtimePaths = rtp.data || {};
    const msg = s.message_counters || {};
    const p = s.peer_counters || {};
    const a = s.adapter_stats || {};
    const transportStats = s.adapter_transport_stats || {};
    const d = s.adapter_discovery_stats || {};
    const dx = s.adapter_diagnostics_summary || {};
    const ac = s.adapter_config || c.adapter_config || {};
    document.getElementById("heroAdapter").textContent = c.adapter || "-";
    document.getElementById("heroRelay").textContent = dx.signaling_url || "-";
    document.getElementById("heroRoom").textContent = dx.room || "-";

    document.getElementById("pillAdapter").textContent = `${t("labels.adapter")}: ${c.adapter || "-"}`;
    writeUiCache("silicaclaw_ui_network", {
      heroAdapterText: c.adapter || "-",
      heroRelayText: dx.signaling_url || "-",
      heroRoomText: dx.room || "-",
      pillAdapterText: `${t("labels.adapter")}: ${c.adapter || "-"}`,
    });
    document.getElementById("networkCards").innerHTML = [
      [t("labels.adapter"), c.adapter],
      [t("labels.namespace"), c.namespace || "-"],
      [t("labels.port"), c.port ?? "-"],
      [t("network.started"), ac.started === true ? t("common.yes") : ac.started === false ? t("common.no") : "-"],
      [t("network.transportState"), ac.transport?.state || "-"],
      [t("network.signalingUrl"), dx.signaling_url || "-"],
      [t("network.signalingEndpoints"), (dx.signaling_endpoints || []).length || 0],
      [t("network.webrtcRoom"), dx.room || "-"],
      [t("network.bootstrapSources"), (dx.bootstrap_sources || []).length || 0],
      [t("network.seedPeers"), dx.seed_peers_count ?? 0],
      [t("network.discoveryEvents"), dx.discovery_events_total ?? 0],
      [t("network.recv"), msg.received_total ?? 0],
      [t("network.sent"), msg.broadcast_total ?? 0],
      [t("network.peers"), p.total ?? 0],
      [t("network.onlinePeers"), p.online ?? 0],
      [t("network.activeWebrtcPeers"), dx.active_webrtc_peers ?? "-"],
      [t("network.reconnectAttempts"), dx.reconnect_attempts_total ?? "-"],
      [t("network.lastInbound"), ago(msg.last_message_at)],
      [t("network.lastOutbound"), ago(msg.last_broadcast_at)],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");
    document.getElementById("networkSummaryList").innerHTML = [
      [t("labels.mode"), describeCurrentMode(t, c.mode || "lan")],
      [t("network.relayHealth"), dx.last_error ? t("network.degraded") : t("network.connected")],
      [t("network.currentRelay"), dx.signaling_url || "-"],
      [t("network.currentRoom"), dx.room || "-"],
      [t("network.lastJoin"), ago(dx.last_join_at)],
      [t("network.lastPoll"), ago(dx.last_poll_at)],
      [t("network.lastPublish"), ago(dx.last_publish_at)],
      [t("network.lastError"), dx.last_error || t("network.none")],
    ].map(([k, v]) => `<div class="summary-item"><div class="label">${k}</div><div class="mono">${v}</div></div>`).join("");

    const comp = c.components || {};
    const lim = c.limits || {};
    document.getElementById("networkComponents").textContent = [
      `demo_mode: ${c.demo_mode || "-"}`,
      `transport: ${comp.transport || "-"}`,
      `discovery: ${comp.discovery || "-"}`,
      `envelope_codec: ${comp.envelope_codec || "-"}`,
      `topic_codec: ${comp.topic_codec || "-"}`,
      `max_message_bytes: ${lim.max_message_bytes ?? "-"}`,
      `dedupe_window_ms: ${lim.dedupe_window_ms ?? "-"}`,
      `dedupe_max_entries: ${lim.dedupe_max_entries ?? "-"}`,
      `max_future_drift_ms: ${lim.max_future_drift_ms ?? "-"}`,
      `max_past_drift_ms: ${lim.max_past_drift_ms ?? "-"}`,
      `dropped_duplicate: ${a.dropped_duplicate ?? "-"}`,
      `dropped_self: ${a.dropped_self ?? "-"}`,
      `dropped_malformed: ${a.dropped_malformed ?? "-"}`,
      `dropped_decode_failed: ${a.dropped_decode_failed ?? "-"}`,
      `dropped_timestamp_future_drift: ${a.dropped_timestamp_future_drift ?? "-"}`,
      `dropped_timestamp_past_drift: ${a.dropped_timestamp_past_drift ?? "-"}`,
      `dropped_namespace_mismatch: ${a.dropped_namespace_mismatch ?? "-"}`,
      `received_validated: ${a.received_validated ?? "-"}`,
      `send_errors: ${a.send_errors ?? "-"}`,
      `transport_send_errors: ${transportStats.send_errors ?? "-"}`,
      `discovery_heartbeat_send_errors: ${d.heartbeat_send_errors ?? "-"}`,
      `signaling_messages_sent_total: ${dx.signaling_messages_sent_total ?? "-"}`,
      `signaling_messages_received_total: ${dx.signaling_messages_received_total ?? "-"}`,
      `last_join_at: ${dx.last_join_at ? new Date(dx.last_join_at).toISOString() : "-"}`,
      `last_poll_at: ${dx.last_poll_at ? new Date(dx.last_poll_at).toISOString() : "-"}`,
      `last_publish_at: ${dx.last_publish_at ? new Date(dx.last_publish_at).toISOString() : "-"}`,
      `last_peer_refresh_at: ${dx.last_peer_refresh_at ? new Date(dx.last_peer_refresh_at).toISOString() : "-"}`,
      `last_error_at: ${dx.last_error_at ? new Date(dx.last_error_at).toISOString() : "-"}`,
      `last_error: ${dx.last_error || "-"}`,
      `signaling_endpoints: ${Array.isArray(dx.signaling_endpoints) ? dx.signaling_endpoints.join(", ") : "-"}`,
      `bootstrap_sources: ${Array.isArray(dx.bootstrap_sources) ? dx.bootstrap_sources.join(", ") : "-"}`,
      `seed_peers_count: ${dx.seed_peers_count ?? "-"}`,
      `discovery_events_total: ${dx.discovery_events_total ?? "-"}`,
      `last_discovery_event_at: ${dx.last_discovery_event_at ? new Date(dx.last_discovery_event_at).toISOString() : "-"}`,
    ].join("\n");

    document.getElementById("networkConfigSnapshot").textContent = toPrettyJson({
      config: c,
      adapter_config: ac,
      runtime_paths: runtimePaths,
    });
    document.getElementById("networkStatsSnapshot").textContent = toPrettyJson({ stats: s });
  }

  async function refreshPeers() {
    const [peerRes, statsRes] = await Promise.all([api("/api/peers"), api("/api/network/stats")]);
    const peers = peerRes.data || {};
    const ds = statsRes.data?.adapter_discovery_stats || {};
    const summary = peers.diagnostics_summary || {};

    document.getElementById("peerCards").innerHTML = [
      [t("network.total"), peers.total || 0],
      [t("overview.online"), peers.online || 0],
      [t("network.stale"), peers.stale || 0],
      [t("labels.namespace"), peers.namespace || "-"],
      [t("network.signalingUrl"), summary.signaling_url || "-"],
      [t("network.signalingEndpoints"), (summary.signaling_endpoints || []).length || 0],
      [t("labels.room"), summary.room || "-"],
      [t("network.lastJoin"), ago(summary.last_join_at)],
      [t("network.lastPoll"), ago(summary.last_poll_at)],
      [t("network.lastPublish"), ago(summary.last_publish_at)],
      [t("network.bootstrapSources"), (summary.bootstrap_sources || []).length || 0],
      [t("network.seedPeers"), summary.seed_peers_count ?? 0],
      [t("network.discoveryEvents"), summary.discovery_events_total ?? 0],
      [t("network.activeWebrtcPeers"), summary.active_webrtc_peers ?? "-"],
      [t("network.observeCalls"), ds.observe_calls || 0],
      [t("network.heartbeats"), ds.heartbeat_sent || 0],
      [t("network.peersAdded"), ds.peers_added || 0],
      [t("network.peersRemoved"), ds.peers_removed || 0],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");

    if (!peers.items || !peers.items.length) {
      document.getElementById("peerTableWrap").innerHTML = `<div class="empty-state">${t("network.noPeersDiscovered")}</div>`;
      document.getElementById("peerStatsWrap").textContent = toPrettyJson({
        discovery_stats: ds,
        diagnostics_summary: summary,
      });
      return;
    }

    document.getElementById("peerTableWrap").innerHTML = `
      <table class="table">
        <thead><tr><th>${t("network.peer")}</th><th>${t("network.status")}</th><th>${t("network.lastSeen")}</th><th>${t("network.staleSince")}</th><th>${t("network.messages")}</th><th>${t("network.firstSeen")}</th><th>${t("network.meta")}</th></tr></thead>
        <tbody>
          ${peers.items.map((peer) => `
            <tr>
              <td class="mono">${shortId(peer.peer_id)}</td>
              <td class="${peer.status === "online" ? "online" : peer.status === "offline" ? "offline" : "stale"}">${peerStatusText(peer.status)}</td>
              <td>${ago(peer.last_seen_at)}</td>
              <td>${peer.stale_since_at ? ago(peer.stale_since_at) : "-"}</td>
              <td>${peer.messages_seen || 0}</td>
              <td>${new Date(peer.first_seen_at).toLocaleTimeString()}</td>
              <td class="mono">${peer.meta ? JSON.stringify(peer.meta) : "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    document.getElementById("peerStatsWrap").textContent = toPrettyJson({
      discovery_stats: ds,
      diagnostics_summary: summary,
      adapter_stats: statsRes.data?.adapter_stats || {},
    });
  }

  async function refreshDiscovery() {
    const eventsRes = await api("/api/discovery/events");
    const payload = eventsRes.data || {};
    const items = Array.isArray(payload.items) ? payload.items : [];

    document.getElementById("discoveryCards").innerHTML = [
      [t("labels.adapter"), payload.adapter || "-"],
      [t("labels.namespace"), payload.namespace || "-"],
      [t("network.eventsTotal"), payload.total ?? 0],
      [t("network.lastEvent"), ago(payload.last_event_at)],
      [t("network.signalingEndpoints"), (payload.signaling_endpoints || []).length || 0],
      [t("network.seedPeers"), payload.seed_peers_count ?? 0],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");

    if (!items.length) {
      document.getElementById("discoveryEventList").innerHTML = `<div class="empty-state">${t("network.noDiscoveryEvents")}</div>`;
    } else {
      document.getElementById("discoveryEventList").innerHTML = items
        .slice()
        .reverse()
        .map((event) => `
          <div class="log-item">
            <div class="mono" style="color:#c5d8ff;">[${event.type}] ${event.peer_id || "-"} ${event.endpoint || ""}</div>
            <div class="label">${event.detail || "-"}</div>
            <div class="mono" style="color:#90a2c3;">${new Date(event.at).toLocaleString()}</div>
          </div>
        `)
        .join("");
    }

    document.getElementById("discoverySnapshot").textContent = toPrettyJson(payload);
  }

  return {
    refreshDiscovery,
    refreshNetwork,
    refreshPeers,
  };
}
