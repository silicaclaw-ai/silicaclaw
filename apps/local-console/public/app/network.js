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
  const fallbackQuickConnectDefaults = {
    signalingUrl: "http://localhost:4510",
    room: "",
  };
  let quickConnectDefaults = { ...fallbackQuickConnectDefaults };
  let lastNetworkRenderKey = "";
  let lastPeersRenderKey = "";
  let lastDiscoveryRenderKey = "";

  function queueState(value) {
    const n = Number(value || 0);
    if (n >= 100) return { tone: "danger", label: t("labels.queueHigh") };
    if (n >= 20) return { tone: "warn", label: t("labels.queueWatch") };
    return { tone: "ok", label: t("labels.queueHealthy") };
  }

  function queueBadge(value) {
    const state = queueState(value);
    return `<span class="pill ${state.tone}">${Number(value || 0)} · ${state.label}</span>`;
  }

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
    const runtimeDiag = s.runtime_diagnostics || {};
    const runtimeMemory = runtimeDiag.memory_mib || {};
    const runtimeDirectory = runtimeDiag.directory || {};
    const runtimeSocial = runtimeDiag.social || {};
    const ac = s.adapter_config || c.adapter_config || {};
    quickConnectDefaults = {
      signalingUrl: String(
        dx.signaling_url ||
        c.signaling_url ||
        c.adapter_extra?.signaling_url ||
        quickConnectDefaults.signalingUrl ||
        fallbackQuickConnectDefaults.signalingUrl
      ),
      room: String(
        dx.room ||
        c.room ||
        c.adapter_extra?.room ||
        quickConnectDefaults.room ||
        fallbackQuickConnectDefaults.room
      ),
    };
    const relayCapable = c.adapter === "relay-preview" || c.adapter === "webrtc-preview";
    const relayHealth = relayCapable
      ? (dx.last_error ? t("network.degraded") : t("network.connected"))
      : "-";
    document.getElementById("heroAdapter").textContent = c.adapter || "-";
    const heroRelayEl = document.getElementById("heroRelay");
    const heroRoomEl = document.getElementById("heroRoom");
    if (heroRelayEl) heroRelayEl.textContent = dx.signaling_url || "-";
    if (heroRoomEl) heroRoomEl.textContent = dx.room || "-";

    document.getElementById("pillAdapter").textContent = `${t("labels.adapter")}: ${c.adapter || "-"}`;
    writeUiCache("silicaclaw_ui_network", {
      heroAdapterText: c.adapter || "-",
      heroRelayText: dx.signaling_url || "-",
      heroRoomText: dx.room || "-",
      pillAdapterText: `${t("labels.adapter")}: ${c.adapter || "-"}`,
    });
    const networkCardsHtml = [
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
      ["RSS", runtimeMemory.rss ?? "-"],
      ["Heap", runtimeMemory.heap_used ?? "-"],
      ["Profiles", runtimeDirectory.profile_count ?? "-"],
      ["Index keys", runtimeDirectory.index_key_count ?? "-"],
      ["Messages", runtimeSocial.message_count ?? "-"],
      ["Observations", runtimeSocial.observation_count ?? "-"],
      [t("network.activeWebrtcPeers"), dx.active_webrtc_peers ?? "-"],
      [t("network.reconnectAttempts"), dx.reconnect_attempts_total ?? "-"],
      [t("network.lastInbound"), ago(msg.last_message_at)],
      [t("network.lastOutbound"), ago(msg.last_broadcast_at)],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");
    const networkSummaryHtml = [
      [t("labels.mode"), describeCurrentMode(t, c.mode || "lan")],
      [t("network.relayHealth"), relayHealth],
      [t("network.currentRelay"), dx.signaling_url || "-"],
      [t("network.currentRoom"), dx.room || "-"],
      [t("network.lastJoin"), ago(dx.last_join_at)],
      [t("network.lastPoll"), ago(dx.last_poll_at)],
      [t("network.lastPublish"), ago(dx.last_publish_at)],
      [t("network.lastError"), dx.last_error || t("network.none")],
    ].map(([k, v]) => `<div class="summary-item"><div class="label">${k}</div><div class="mono">${v}</div></div>`).join("");

    const comp = c.components || {};
    const lim = c.limits || {};
    const networkComponentsText = [
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

    const networkConfigSnapshotText = toPrettyJson({
      config: c,
      adapter_config: ac,
      runtime_paths: runtimePaths,
    });
    const networkStatsSnapshotText = toPrettyJson({ stats: s });
    const renderKey = JSON.stringify({
      adapter: c.adapter || "",
      mode: c.mode || "",
      namespace: c.namespace || "",
      port: c.port ?? null,
      signaling_url: dx.signaling_url || "",
      room: dx.room || "",
      relay_health: relayHealth,
      last_poll_at: dx.last_poll_at || 0,
      last_publish_at: dx.last_publish_at || 0,
      last_error: dx.last_error || "",
      msg_received_total: msg.received_total ?? 0,
      msg_broadcast_total: msg.broadcast_total ?? 0,
      peers_total: p.total ?? 0,
      peers_online: p.online ?? 0,
      reconnect_attempts_total: dx.reconnect_attempts_total ?? 0,
      active_webrtc_peers: dx.active_webrtc_peers ?? 0,
    });
    if (renderKey === lastNetworkRenderKey) {
      return;
    }
    document.getElementById("networkCards").innerHTML = networkCardsHtml;
    document.getElementById("networkSummaryList").innerHTML = networkSummaryHtml;
    document.getElementById("networkComponents").textContent = networkComponentsText;
    document.getElementById("networkConfigSnapshot").textContent = networkConfigSnapshotText;
    document.getElementById("networkStatsSnapshot").textContent = networkStatsSnapshotText;
    lastNetworkRenderKey = renderKey;
  }

  async function refreshPeers() {
    const [peerRes, statsRes] = await Promise.all([api("/api/peers"), api("/api/network/stats")]);
    const peers = peerRes.data || {};
    const ds = statsRes.data?.adapter_discovery_stats || {};
    const summary = peers.diagnostics_summary || {};
    const peerItems = Array.isArray(peers.items) ? peers.items : [];
    const relayQueueTotal = peerItems.reduce((sum, peer) => sum + Number(peer?.meta?.relay_queue_size || 0), 0);
    const relayQueueMax = peerItems.reduce((max, peer) => Math.max(max, Number(peer?.meta?.relay_queue_size || 0)), 0);
    const signalQueueTotal = peerItems.reduce((sum, peer) => sum + Number(peer?.meta?.signal_queue_size || 0), 0);
    const signalQueueMax = peerItems.reduce((max, peer) => Math.max(max, Number(peer?.meta?.signal_queue_size || 0)), 0);
    const peerCardsHtml = [
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
      ["Relay queue", queueBadge(relayQueueTotal)],
      ["Max relay queue", queueBadge(relayQueueMax)],
      ["Signal queue", queueBadge(signalQueueTotal)],
      ["Max signal queue", queueBadge(signalQueueMax)],
      [t("network.observeCalls"), ds.observe_calls || 0],
      [t("network.heartbeats"), ds.heartbeat_sent || 0],
      [t("network.peersAdded"), ds.peers_added || 0],
      [t("network.peersRemoved"), ds.peers_removed || 0],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");
    const peerStatsText = toPrettyJson({
      discovery_stats: ds,
      diagnostics_summary: summary,
      adapter_stats: statsRes.data?.adapter_stats || {},
    });

    const peerTableHtml = !peers.items || !peers.items.length
      ? `<div class="empty-state">${t("network.noPeersDiscovered")}</div>`
      : `
      <table class="table">
        <thead><tr><th>${t("network.peer")}</th><th>${t("network.status")}</th><th>${t("network.lastSeen")}</th><th>${t("network.staleSince")}</th><th>${t("network.messages")}</th><th>${t("network.firstSeen")}</th><th>Relay Q</th><th>Signal Q</th><th>${t("network.meta")}</th></tr></thead>
        <tbody>
          ${peerItems.map((peer) => `
            <tr>
              <td class="mono">${shortId(peer.peer_id)}</td>
              <td class="${peer.status === "online" ? "online" : peer.status === "offline" ? "offline" : "stale"}">${peerStatusText(peer.status)}</td>
              <td>${ago(peer.last_seen_at)}</td>
              <td>${peer.stale_since_at ? ago(peer.stale_since_at) : "-"}</td>
              <td>${peer.messages_seen || 0}</td>
              <td>${new Date(peer.first_seen_at).toLocaleTimeString()}</td>
              <td>${queueBadge(Number(peer?.meta?.relay_queue_size || 0))}</td>
              <td>${queueBadge(Number(peer?.meta?.signal_queue_size || 0))}</td>
              <td class="mono">${peer.meta ? JSON.stringify(peer.meta) : "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    const renderKey = JSON.stringify({
      total: peers.total || 0,
      online: peers.online || 0,
      stale: peers.stale || 0,
      namespace: peers.namespace || "",
      summary: {
        signaling_url: summary.signaling_url || "",
        room: summary.room || "",
        last_join_at: summary.last_join_at || 0,
        last_poll_at: summary.last_poll_at || 0,
        last_publish_at: summary.last_publish_at || 0,
        last_error: summary.last_error || "",
      },
      ds: {
        observe_calls: ds.observe_calls || 0,
        heartbeat_sent: ds.heartbeat_sent || 0,
        peers_added: ds.peers_added || 0,
        peers_removed: ds.peers_removed || 0,
      },
      queues: {
        relay_total: relayQueueTotal,
        relay_max: relayQueueMax,
        signal_total: signalQueueTotal,
        signal_max: signalQueueMax,
      },
      items: peerItems
        ? peerItems.map((peer) => [
            peer.peer_id,
            peer.status || "",
            peer.last_seen_at || 0,
            peer.stale_since_at || 0,
            peer.messages_seen || 0,
            peer.first_seen_at || 0,
            Number(peer?.meta?.relay_queue_size || 0),
            Number(peer?.meta?.signal_queue_size || 0),
            peer.meta ? JSON.stringify(peer.meta) : "",
          ])
        : [],
    });
    if (renderKey === lastPeersRenderKey) {
      return;
    }
    document.getElementById("peerCards").innerHTML = peerCardsHtml;
    document.getElementById("peerTableWrap").innerHTML = peerTableHtml;
    document.getElementById("peerStatsWrap").textContent = peerStatsText;
    lastPeersRenderKey = renderKey;
  }

  async function refreshDiscovery() {
    const eventsRes = await api("/api/discovery/events");
    const payload = eventsRes.data || {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    const discoveryCardsHtml = [
      [t("labels.adapter"), payload.adapter || "-"],
      [t("labels.namespace"), payload.namespace || "-"],
      [t("network.eventsTotal"), payload.total ?? 0],
      [t("network.lastEvent"), ago(payload.last_event_at)],
      [t("network.signalingEndpoints"), (payload.signaling_endpoints || []).length || 0],
      [t("network.seedPeers"), payload.seed_peers_count ?? 0],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");
    const discoveryEventListHtml = !items.length
      ? `<div class="empty-state">${t("network.noDiscoveryEvents")}</div>`
      : items
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
    const discoverySnapshotText = toPrettyJson(payload);
    const renderKey = JSON.stringify({
      adapter: payload.adapter || "",
      namespace: payload.namespace || "",
      total: payload.total ?? 0,
      last_event_at: payload.last_event_at || 0,
      signaling_endpoints: payload.signaling_endpoints || [],
      seed_peers_count: payload.seed_peers_count ?? 0,
      items: items.map((event) => [event.type || "", event.peer_id || "", event.endpoint || "", event.detail || "", event.at || 0]),
    });
    if (renderKey === lastDiscoveryRenderKey) {
      return;
    }
    document.getElementById("discoveryCards").innerHTML = discoveryCardsHtml;
    document.getElementById("discoveryEventList").innerHTML = discoveryEventListHtml;
    document.getElementById("discoverySnapshot").textContent = discoverySnapshotText;
    lastDiscoveryRenderKey = renderKey;
  }

  return {
    getQuickConnectDefaults: () => ({ ...quickConnectDefaults }),
    refreshDiscovery,
    refreshNetwork,
    refreshPeers,
  };
}
