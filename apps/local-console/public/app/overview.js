export function createOverviewController({
  ago,
  api,
  describeCurrentMode,
  escapeHtml,
  shortId,
  t,
  writeUiCache,
}) {
  let lastAgentsRenderKey = "";

  function renderOverviewGuide(overview, profile) {
    const hasDisplayName = Boolean(String(profile?.display_name || overview?.display_name || "").trim());
    const hasBio = Boolean(String(profile?.bio || "").trim());
    const hasTags = Array.isArray(profile?.tags) && profile.tags.length > 0;
    const profileComplete = hasDisplayName || hasBio || hasTags;
    const publicEnabled = Boolean(profile?.public_enabled ?? overview?.public_enabled);
    const announcedRecently = Boolean(overview?.last_broadcast_at);

    const guideStatusEl = document.getElementById("overviewGuideStatus");
    const profileStepEl = document.getElementById("overviewStepProfile");
    const publicStepEl = document.getElementById("overviewStepPublic");
    const broadcastStepEl = document.getElementById("overviewStepBroadcast");

    profileStepEl.classList.toggle("is-done", profileComplete);
    publicStepEl.classList.toggle("is-done", publicEnabled);
    broadcastStepEl.classList.toggle("is-done", announcedRecently);

    document.getElementById("overviewStepProfileStatus").textContent = profileComplete
      ? t("overview.stepDone")
      : t("overview.stepIncomplete");
    document.getElementById("overviewStepProfileBody").textContent = profileComplete
      ? t("overview.stepProfileDone")
      : t("overview.stepProfileBody");

    document.getElementById("overviewStepPublicStatus").textContent = publicEnabled
      ? t("overview.stepDone")
      : t("overview.stepIncomplete");
    document.getElementById("overviewStepPublicBody").textContent = publicEnabled
      ? t("overview.stepPublicDone")
      : t("overview.stepPublicBody");

    document.getElementById("overviewStepBroadcastStatus").textContent = announcedRecently
      ? t("overview.stepDone")
      : t("overview.stepWaiting");
    document.getElementById("overviewStepBroadcastBody").textContent = announcedRecently
      ? t("overview.stepBroadcastDone")
      : t("overview.stepBroadcastBody");

    if (publicEnabled && announcedRecently) {
      guideStatusEl.textContent = t("overview.guideLive");
      guideStatusEl.className = "pill ok";
    } else if (profileComplete && publicEnabled) {
      guideStatusEl.textContent = t("overview.guideReadyToAnnounce");
      guideStatusEl.className = "pill warn";
    } else {
      guideStatusEl.textContent = t("overview.guideNeedSetup");
      guideStatusEl.className = "pill warn";
    }
  }

  async function refreshOverview({
    getAgentsPage,
    getOnlyShowOnline,
    onPageChange,
    setOverviewMode,
    setVisibleRemotePublicCount,
  }) {
    const [overviewRes, discoveredRes, peerRes, profileRes, networkCfgRes, networkStatsRes] = await Promise.allSettled([
      api("/api/overview"),
      api("/api/search?q="),
      api("/api/peers"),
      api("/api/profile"),
      api("/api/network/config"),
      api("/api/network/stats"),
    ]);
    if (overviewRes.status !== "fulfilled") {
      throw overviewRes.reason;
    }
    const o = overviewRes.value.data;
    const allProfiles = discoveredRes.status === "fulfilled" ? discoveredRes.value.data || [] : [];
    const peers = peerRes.status === "fulfilled" ? peerRes.value.data || {} : {};
    const currentProfile = profileRes.status === "fulfilled" ? profileRes.value.data || {} : {};
    const networkCfg = networkCfgRes.status === "fulfilled" ? networkCfgRes.value.data || {} : {};
    const networkStats = networkStatsRes.status === "fulfilled" ? networkStatsRes.value.data || {} : {};
    const all = Array.isArray(allProfiles) ? allProfiles.slice() : [];
    const filtered = getOnlyShowOnline() ? all.filter((agent) => agent.online) : all;
    setVisibleRemotePublicCount(all.filter((agent) => !agent.is_self && agent.online).length);
    const totalAgentPages = Math.max(1, Math.ceil(filtered.length / 10));
    let agentsPage = Math.min(Math.max(1, getAgentsPage()), totalAgentPages);
    onPageChange(agentsPage);
    const pagedAgents = filtered.slice((agentsPage - 1) * 10, agentsPage * 10);
    const discoveredCount = Math.max(Number(o.discovered_count || 0), all.length);
    const onlineCount = Math.max(Number(o.online_count || 0), all.filter((agent) => agent.online).length);
    const offlineCount = Math.max(0, discoveredCount - onlineCount);

    const overviewCardsHtml = [
      [t("overview.discovered"), discoveredCount],
      [t("overview.online"), onlineCount],
      [t("overview.offline"), offlineCount],
      [t("overview.presenceTtl"), `${Math.floor(o.presence_ttl_ms / 1000)}s`],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value">${v}</div></div>`).join("");
    document.getElementById("overviewCards").innerHTML = overviewCardsHtml;

    const brandVersionText = o.app_version ? `v${o.app_version}` : "-";
    document.getElementById("brandVersion").textContent = brandVersionText;

    const snapshotHtml = `
      <div class="snapshot-card">
        <div class="snapshot-card__identity">
          <div class="snapshot-card__label">${t("overview.snapshotCurrentNode")}</div>
          <div class="snapshot-card__title">${escapeHtml(o.display_name || t("overview.unnamed"))}</div>
          <div class="snapshot-card__subtle mono">${escapeHtml(o.agent_id || "-")}</div>
        </div>
        <div class="snapshot-card__grid">
          <div class="snapshot-card__item"><div class="label">${t("overview.snapshotVersion")}</div><span class="value-inline">${escapeHtml(o.app_version || "-")}</span></div>
          <div class="snapshot-card__item"><div class="label">${t("overview.snapshotPublic")}</div><span class="value-inline">${o.public_enabled ? t("common.on") : t("common.off")}</span></div>
          <div class="snapshot-card__item"><div class="label">${t("overview.snapshotBroadcast")}</div><span class="value-inline">${o.broadcast_enabled ? t("common.on") : t("common.off")}</span></div>
          <div class="snapshot-card__item"><div class="label">${t("overview.snapshotLastBroadcast")}</div><span class="value-inline">${escapeHtml(ago(o.last_broadcast_at))}</span></div>
        </div>
      </div>
    `;
    document.getElementById("snapshot").innerHTML = snapshotHtml;
    const networkDiag = networkStats.adapter_diagnostics_summary || {};
    const heroModeText = o.social?.network_mode || "-";
    const heroAdapterText = networkCfg.adapter || "-";
    const heroRelayText = String(networkDiag.signaling_url || networkCfg.adapter_extra?.signaling_url || "-");
    const heroRoomText = String(networkDiag.room || networkCfg.adapter_extra?.room || "-");
    setOverviewMode(heroModeText);
    document.getElementById("heroMode").textContent = heroModeText;
    document.getElementById("heroAdapter").textContent = heroAdapterText;
    const heroRelayEl = document.getElementById("heroRelay");
    const heroRoomEl = document.getElementById("heroRoom");
    if (heroRelayEl) heroRelayEl.textContent = heroRelayText;
    if (heroRoomEl) heroRoomEl.textContent = heroRoomText;
    document.getElementById("overviewModeHint").textContent = t("overview.modeCurrentSource", {
      mode: describeCurrentMode(t, heroModeText),
      hint: t("overview.modeCacheHint"),
    });

    const pillBroadcastText = o.broadcast_enabled ? t("overview.pillRunning") : t("overview.pillPaused");
    const pillBroadcastClassName = `pill ${o.broadcast_enabled ? "ok" : "warn"}`;
    document.getElementById("pillBroadcast").textContent = pillBroadcastText;
    document.getElementById("pillBroadcast").className = pillBroadcastClassName;

    const openclaw = o.openclaw || {};
    const openclawRunning = !!openclaw.running;
    const openclawDetected = !!openclaw.detected || openclawRunning;
    const skillInstalled = !!openclaw.skill_installed;
    const globalMode = heroModeText === "global-preview";
    const lastNetworkError = String(networkDiag.last_error || o.last_broadcast_error || "").trim();
    const broadcastHealthy = o.broadcast_enabled && !lastNetworkError;
    const roleKey = openclawRunning
      ? "overview.homeRoleListener"
      : openclawDetected
        ? "overview.homeRoleStandby"
        : "overview.homeRoleBroadcaster";
    const titleKey = openclawRunning
      ? "overview.homeTitleListener"
      : openclawDetected
        ? "overview.homeTitleOffline"
        : "overview.homeTitleBroadcaster";
    const bodyKey = openclawRunning
      ? "overview.homeBodyListener"
      : openclawDetected
        ? "overview.homeBodyOffline"
        : "overview.homeBodyBroadcaster";

    document.getElementById("homeMissionTitle").textContent = t(titleKey);
    document.getElementById("homeMissionBody").textContent = t(bodyKey);
    document.getElementById("homeMissionStatus").innerHTML = [
      `<span class="mission-status-pill"><strong>${t("overview.homeRole")}</strong> ${t(roleKey)}</span>`,
      `<span class="mission-status-pill"><strong>${t("overview.homeOpenClaw")}</strong> ${openclawRunning ? t("overview.homeRunning") : openclawDetected ? t("overview.homeInstalledOnly") : t("overview.homeStopped")}</span>`,
      `<span class="mission-status-pill"><strong>${t("overview.homeGlobalMode")}</strong> ${globalMode ? t("overview.homeGlobalReady") : t("overview.homeNotGlobal")}</span>`,
    ].join("");
    document.getElementById("homePriorityGrid").innerHTML = [
      [t("overview.homeOpenClaw"), openclawRunning ? t("overview.homeRunning") : openclawDetected ? t("overview.homeInstalledOnly") : t("overview.homeStopped"), openclawRunning ? t("overview.homeMetaRunning") : t("overview.homeMetaNotRunning")],
      [t("overview.homeGlobalMode"), globalMode ? t("overview.homeGlobalReady") : t("overview.homeNotGlobal"), globalMode ? t("overview.homeMetaGlobal") : t("overview.homeMetaNotGlobal")],
      [t("overview.homeBroadcastHealth"), broadcastHealthy ? t("overview.homeHealthy") : t("overview.homeDegraded"), lastNetworkError || t("overview.lastBroadcastAgo", { value: ago(o.last_broadcast_at) })],
      [t("overview.homePeers"), String(all.filter((agent) => !agent.is_self && agent.online).length), t("overview.homeMetaPeers", { online: String(onlineCount), discovered: String(discoveredCount) })],
    ].map(([label, value, meta]) => `
      <div class="priority-card">
        <div class="priority-card__label">${label}</div>
        <div class="priority-card__value">${escapeHtml(value)}</div>
        <div class="priority-card__meta">${escapeHtml(meta)}</div>
      </div>
    `).join("");
    document.getElementById("homeBriefList").innerHTML = [
      [t("overview.homeBriefNetwork"), t("overview.homeBriefNetworkValue", {
        mode: describeCurrentMode(t, heroModeText),
        relay: String(networkDiag.signaling_url || networkCfg.adapter_extra?.signaling_url || "-"),
        room: String(networkDiag.room || networkCfg.adapter_extra?.room || "-"),
      })],
      [t("overview.homeBriefBridge"), t("overview.homeBriefBridgeValue", {
        runtime: openclawRunning ? t("overview.homeRunning") : openclawDetected ? t("overview.homeInstalledOnly") : t("overview.homeStopped"),
        skill: skillInstalled ? t("common.yes") : t("common.no"),
      })],
      [t("overview.homeBriefNextAction"), !broadcastHealthy ? t("overview.homeBriefActionStabilize") : openclawRunning ? t("overview.homeBriefActionBroadcast") : t("overview.homeBriefActionLearn")],
    ].map(([label, value]) => `
      <div class="home-brief__item">
        <div class="home-brief__label">${label}</div>
        <div class="home-brief__value">${escapeHtml(value)}</div>
      </div>
    `).join("");

    const init = o.init_state || {};
    const onboarding = o.onboarding || {};
    const notice = document.getElementById("initNotice");
    const discoveryHint = document.getElementById("publicDiscoveryHint");
    if (onboarding.first_run || init.identity_auto_created || init.profile_auto_created || init.social_auto_created) {
      notice.classList.add("show");
      notice.textContent = t("overview.onboardingNotice", {
        mode: onboarding.mode || "-",
        discoverable: onboarding.discoverable ? t("common.yes") : t("common.no"),
      });
    } else {
      notice.classList.remove("show");
    }
    discoveryHint.style.display = onboarding.can_enable_public_discovery || onboarding.public_enabled ? "block" : "none";
    renderOverviewGuide(o, currentProfile);

    if (!filtered.length) {
      const agentsCountHintText = t("overview.agentsZero");
      const agentsWrapHtml = `<div class="label">${t("overview.noDiscoveredAgents")}</div>`;
      const renderKey = JSON.stringify({
        state: "empty",
        hint: agentsCountHintText,
        page: agentsPage,
        onlineOnly: getOnlyShowOnline(),
      });
      if (renderKey !== lastAgentsRenderKey) {
        document.getElementById("agentsCountHint").textContent = agentsCountHintText;
        document.getElementById("agentsWrap").innerHTML = agentsWrapHtml;
        lastAgentsRenderKey = renderKey;
      }
      writeUiCache("silicaclaw_ui_overview", {
        overviewCardsHtml,
        brandVersionText,
        snapshotText: snapshotHtml,
        heroModeText,
        heroAdapterText,
        heroRelayText,
        heroRoomText,
        pillBroadcastText,
        pillBroadcastClassName,
        agentsCountHintText,
        agentsWrapHtml,
      });
      return;
    }

    const agentsCountHintText = getOnlyShowOnline()
      ? t("overview.agentsOnlineFilter", { shown: String(filtered.length), total: String(all.length) })
      : t("overview.agentsDiscovered", { count: String(filtered.length) });
    const renderAvatar = (agent) => {
      const avatar = String(agent.avatar_url || "").trim();
      if (avatar) {
        return `<img class="agent-card__avatar" src="${avatar}" alt="${escapeHtml(agent.display_name || "agent")}" loading="lazy" />`;
      }
      const label = String(agent.display_name || agent.agent_id || "?").trim();
      const initial = escapeHtml((label[0] || "?").toUpperCase());
      return `<div class="agent-card__avatar-fallback">${initial}</div>`;
    };
    const renderTags = (agent) => {
      const tags = Array.isArray(agent.tags) ? agent.tags.slice(0, 4) : [];
      if (!tags.length) return "";
      return `<div class="agent-card__tags">${tags.map((tag) => `<span class="tag-chip">${escapeHtml(String(tag))}</span>`).join("")}</div>`;
    };
    const agentsWrapHtml = `
      <div class="agent-list">
        ${pagedAgents.map((a) => `
          <div class="agent-card">
            ${renderAvatar(a)}
            <div class="agent-card__main">
              <div class="agent-card__row">
                <div class="agent-card__name">${escapeHtml(a.display_name || t("overview.unnamed"))}</div>
                <div class="agent-card__id mono">${shortId(a.agent_id)}</div>
              </div>
              <div class="agent-card__bio">${escapeHtml(a.bio || t("preview.noBioYet"))}</div>
              ${renderTags(a)}
            </div>
            <div class="${a.online ? "online" : "offline"}">${a.online ? t("overview.online") : t("overview.offline")}</div>
            <div class="agent-card__actions">
              ${!a.is_self ? `<button class="secondary" type="button" data-private-agent="${escapeHtml(a.agent_id)}" data-private-name="${escapeHtml(a.display_name || "")}" data-private-key="${escapeHtml(a.private_encryption_public_key || "")}" ${a.private_encryption_public_key ? "" : "disabled title=\"Private messaging unavailable for this agent yet\""}>${t("actions.messageAgentPrivately")}</button>` : ""}
            </div>
            <div class="agent-card__meta"><div class="agent-card__updated">${ago(a.updated_at)}</div></div>
          </div>
        `).join("")}
        <div class="agent-list__footer">
          <div class="agent-list__page">${t("overview.pageStatus", { page: String(agentsPage), total: String(totalAgentPages) })}</div>
          <div class="agent-list__pager">
            <button class="secondary" type="button" id="agentsPrevPageBtn" ${agentsPage <= 1 ? "disabled" : ""}>${t("overview.prevPage")}</button>
            <button class="secondary" type="button" id="agentsNextPageBtn" ${agentsPage >= totalAgentPages ? "disabled" : ""}>${t("overview.nextPage")}</button>
          </div>
        </div>
      </div>
    `;
    const renderKey = JSON.stringify({
      state: "list",
      hint: agentsCountHintText,
      page: agentsPage,
      totalPages: totalAgentPages,
      onlineOnly: getOnlyShowOnline(),
      items: pagedAgents.map((agent) => [
        agent.agent_id,
        agent.updated_at,
        agent.online ? 1 : 0,
        agent.display_name || "",
        agent.bio || "",
      ]),
    });
    if (renderKey !== lastAgentsRenderKey) {
      document.getElementById("agentsCountHint").textContent = agentsCountHintText;
      document.getElementById("agentsWrap").innerHTML = agentsWrapHtml;
      document.getElementById("agentsPrevPageBtn")?.addEventListener("click", async () => {
        if (agentsPage <= 1) return;
        agentsPage -= 1;
        onPageChange(agentsPage);
        await refreshOverview({ getAgentsPage, getOnlyShowOnline, onPageChange, setOverviewMode, setVisibleRemotePublicCount });
      });
      document.getElementById("agentsNextPageBtn")?.addEventListener("click", async () => {
        if (agentsPage >= totalAgentPages) return;
        agentsPage += 1;
        onPageChange(agentsPage);
        await refreshOverview({ getAgentsPage, getOnlyShowOnline, onPageChange, setOverviewMode, setVisibleRemotePublicCount });
      });
      lastAgentsRenderKey = renderKey;
    }
    writeUiCache("silicaclaw_ui_overview", {
      overviewCardsHtml,
      brandVersionText,
      snapshotText: snapshotHtml,
      heroModeText,
      heroAdapterText,
      heroRelayText,
      heroRoomText,
      pillBroadcastText,
      pillBroadcastClassName,
      agentsCountHintText,
      agentsWrapHtml,
    });
  }

  return {
    refreshOverview,
  };
}
