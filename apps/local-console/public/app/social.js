export function createSocialController({
  api,
  escapeHtml,
  formatMessageBody,
  getActiveTab,
  getLogLevelFilter,
  getLogsCache,
  getSocialMessageFilter,
  getSocialMessageGovernance,
  getSocialMessagesCache,
  getSocialModeDirty,
  getSocialModePending,
  getSocialTemplate,
  getVisibleRemotePublicCount,
  renderSocialModeHint,
  setLogLevelFilter,
  setLogsCache,
  setSocialMessageGovernance,
  setSocialMessagesCache,
  setSocialModePendingState,
  setSocialTemplate,
  shortId,
  t,
  toPrettyJson,
  writeUiCache,
}) {
  function renderSocialMessages() {
    const listEl = document.getElementById("socialMessageList");
    const metaEl = document.getElementById("socialMessageMeta");
    const hintEl = document.getElementById("socialMessageHint");
    const governance = getSocialMessageGovernance();
    const socialMessagesCache = getSocialMessagesCache();
    const socialMessageFilter = getSocialMessageFilter();
    const governanceHint = governance
      ? `${t("overview.messageHint")} ${t("overview.governanceSummary", {
          max: String(governance.send_limit?.max || "-"),
          seconds: String(Math.floor((governance.send_limit?.window_ms || 60000) / 1000)),
        })}`
      : t("overview.messageHint");
    hintEl.textContent = governanceHint;
    if (!socialMessagesCache.length) {
      metaEl.textContent = t("overview.noMessagesMeta");
      listEl.innerHTML = `<div class="empty-state">${t("overview.noMessagesEmpty")}</div>`;
      return;
    }

    const filteredMessages = socialMessagesCache.filter((item) => {
      if (socialMessageFilter === "self") return Boolean(item.is_self);
      if (socialMessageFilter === "remote") return !item.is_self;
      return true;
    });

    const baseMeta = socialMessageFilter === "all"
      ? t("overview.cachedMessages", { count: String(socialMessagesCache.length) })
      : t("overview.filteredMessages", { count: String(filteredMessages.length) });
    const governanceMeta = governance
      ? ` · ${t("overview.governanceSummary", {
          max: String(governance.send_limit?.max || "-"),
          seconds: String(Math.floor((governance.send_limit?.window_ms || 60000) / 1000)),
        })}`
      : "";
    metaEl.textContent = `${baseMeta}${governanceMeta}`;

    if (!filteredMessages.length) {
      listEl.innerHTML = `<div class="empty-state">${t("overview.noMessagesEmpty")}</div>`;
      return;
    }

    listEl.innerHTML = filteredMessages
      .map((item) => {
        const visibleRemoteCount = getVisibleRemotePublicCount();
        const selfStatusChips = item.is_self
          ? `
              <span class="tag-chip" style="margin-left:8px;">${t("overview.selfMessagePublished")}</span>
              <span class="tag-chip" style="margin-left:8px;">${t("overview.selfMessageConfirmed")}</span>
              <span class="tag-chip" style="margin-left:8px;">${
                item.remote_observation_count > 0
                  ? t("overview.selfMessageRemoteObserved", { count: String(item.remote_observation_count) })
                  : t("overview.selfMessageAwaitingObservation")
              }</span>
              <span class="tag-chip" style="margin-left:8px;">${t("overview.selfMessageRemoteVisible", { count: String(visibleRemoteCount) })}</span>
            `
          : "";
        const selfDeliveryHint = item.is_self
          ? `
              <div style="margin-top:8px; color:#90a2c3;">
                ${
                  item.remote_observation_count > 0
                    ? t("overview.selfMessageDeliveryObserved", {
                        count: String(item.remote_observation_count),
                        visible: String(visibleRemoteCount),
                      })
                    : t("overview.selfMessageDeliveryPending", { count: String(visibleRemoteCount) })
                }
              </div>
            `
          : "";
        const observationChip = item.remote_observation_count > 0
          ? `<span class="tag-chip" style="margin-left:8px;">${t("overview.messageObservedBy", { count: String(item.remote_observation_count) })}</span>`
          : "";
        return `
          <div class="log-item">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
              <div>
                <strong>${escapeHtml(item.display_name || t("overview.unnamed"))}</strong>
                <span class="mono" style="color:#90a2c3; margin-left:8px;">${escapeHtml(shortId(item.agent_id || ""))}</span>
                <span class="tag-chip" style="margin-left:8px;">${escapeHtml(item.topic || t("labels.globalTopic"))}</span>
                ${item.is_self ? `<span class="tag-chip" style="margin-left:8px;">${t("overview.messageFilterSelf")}</span>` : ""}
                <span class="tag-chip" style="margin-left:8px;">${item.online ? t("overview.online") : t("overview.offline")}</span>
                ${observationChip}
                ${selfStatusChips}
              </div>
              <div class="mono" style="color:#90a2c3;">${new Date(item.created_at).toLocaleString()}</div>
            </div>
            <div style="margin-top:8px; line-height:1.6;">${formatMessageBody(item.body || "")}</div>
            ${selfDeliveryHint}
          </div>
        `;
      })
      .join("");
  }

  async function refreshMessages() {
    const result = await api("/api/messages?limit=50");
    setSocialMessagesCache(Array.isArray(result.data?.items) ? result.data.items : []);
    setSocialMessageGovernance(result.data?.governance || null);
    renderSocialMessages();
  }

  async function refreshSocial() {
    const [socialRes, summaryRes, statusRes, networkCfgRes, networkStatsRes, governanceRes] = await Promise.all([
      api("/api/social/config"),
      api("/api/social/integration-summary"),
      api("/api/integration/status"),
      api("/api/network/config"),
      api("/api/network/stats"),
      api("/api/social/message-governance"),
    ]);
    const bridgeRes = await api("/api/openclaw/bridge");
    const social = socialRes.data || {};
    const summary = summaryRes.data || {};
    const status = statusRes.data || {};
    const networkCfg = networkCfgRes.data || {};
    const bridge = bridgeRes.data || {};
    const governance = governanceRes.data || {};
    const networkStats = networkStatsRes.data || {};
    const runtime = social.runtime || {};
    const config = social.social_config || {};
    const network = config.network || {};
    const runtimeNetwork = runtime.resolved_network || {};
    const effectiveAdapterExtra = networkCfg.adapter_extra || {};
    const effectiveMode = networkCfg.mode || status.network_mode || summary.current_network_mode || runtimeNetwork.mode || network.mode || "-";
    const selectedMode = network.mode || runtimeNetwork.mode || status.network_mode || effectiveMode || "-";
    const effectiveAdapter = networkCfg.adapter || runtimeNetwork.adapter || summary.current_adapter || "-";
    const effectiveNamespace = networkCfg.namespace || runtimeNetwork.namespace || summary.current_namespace || "-";
    const effectiveRoom = effectiveAdapterExtra.room || runtimeNetwork.room || network.room || "-";
    const effectiveRelay = effectiveAdapterExtra.signaling_url || runtimeNetwork.signaling_url || network.signaling_url || "-";
    const networkDiag = networkStats.adapter_diagnostics_summary || {};
    const discoverable = status.discoverable === true;
    const mode = effectiveMode;
    const summaryLine = status.status_line || summary.summary_line || `${summary.connected ? t("social.connectedToSilicaClaw") : t("social.notConnectedToSilicaClaw")} · ${discoverable ? t("social.discoverableInCurrentMode") : t("social.notDiscoverableInCurrentMode")} · ${t("social.usingMode", { mode })}`;
    const publicDiscoveryText = status.public_enabled ? t("social.publicDiscoveryEnabled") : t("social.publicDiscoveryDisabled");

    const namespaceText = `${status.connected_to_silicaclaw ? t("social.connectedToSilicaClaw") : t("social.notConnected")} · ${publicDiscoveryText} · ${t("social.mode")} ${mode}`;
    document.getElementById("socialStatusLine").textContent = summaryLine;
    document.getElementById("socialStatusSubline").textContent = namespaceText;
    const bar = document.getElementById("integrationStatusBar");
    bar.className = `integration-strip ${status.connected_to_silicaclaw && status.public_enabled ? "ok" : "warn"}${getActiveTab() === "overview" ? "" : " hidden"}`;
    bar.textContent = t("social.barStatus", {
      connected: status.connected_to_silicaclaw ? t("common.yes") : t("common.no"),
      mode,
      public: status.public_enabled ? t("common.on") : t("common.off"),
    });
    document.getElementById("brandStatusDot").className = `sidebar-version__status ${status.connected_to_silicaclaw ? "ok" : "warn"}`;
    writeUiCache("silicaclaw_ui_social", {
      integrationStatusText: bar.textContent,
      integrationStatusClassName: bar.className,
      socialStatusLineText: summaryLine,
      socialStatusSublineText: namespaceText,
    });
    const reasons = [];
    if (!status.configured && status.configured_reason) reasons.push(t("social.configuredReason", { reason: status.configured_reason }));
    if (!status.running && status.running_reason) reasons.push(t("social.runningReason", { reason: status.running_reason }));
    if (!status.discoverable && status.discoverable_reason) reasons.push(t("social.discoverableReasonFull", { reason: status.discoverable_reason }));
    document.getElementById("socialStateHint").textContent = reasons.length ? reasons.join(" · ") : t("hints.allIntegrationChecksPassed");
    const modeSelect = document.getElementById("socialModeSelect");
    const displayedSelectedMode = getSocialModeDirty() && getSocialModePending() ? getSocialModePending() : selectedMode;
    if (modeSelect && displayedSelectedMode !== "-") modeSelect.value = displayedSelectedMode;
    renderSocialModeHint(displayedSelectedMode, mode, !!social.network_requires_restart, getSocialModeDirty());
    setSocialModePendingState(getSocialModeDirty());

    document.getElementById("socialPrimaryCards").innerHTML = [
      [t("social.configured"), status.configured ? t("common.yes") : t("common.no")],
      [t("social.running"), status.running ? t("common.yes") : t("common.no")],
      [t("social.discoverable"), discoverable ? t("common.yes") : t("common.no")],
      [t("social.publicDiscovery"), status.public_enabled ? t("common.on") : t("common.off")],
      [t("social.networkMode"), mode],
      [t("labels.adapter"), effectiveAdapter],
      [t("social.discoverableReason"), status.discoverable_reason || "-"],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");

    document.getElementById("socialIntegrationCards").innerHTML = [
      [t("social.connected"), bridge.connected_to_silicaclaw ? t("common.yes") : t("common.no")],
      [t("social.messageBroadcast"), bridge.message_broadcast_enabled ? t("common.on") : t("common.off")],
      [t("social.displayName"), status.display_name || t("overview.unnamed")],
      [t("social.agentId"), shortId(status.agent_id || "")],
      [t("social.socialFound"), summary.social_md_found ? t("common.yes") : t("common.no")],
      [t("social.socialSource"), summary.social_md_source_path || "-"],
      [t("social.reuseOpenClawIdentity"), summary.reused_openclaw_identity ? t("common.yes") : t("common.no")],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");

    document.getElementById("socialMessagePathCards").innerHTML = [
      [t("social.messageBroadcast"), bridge.message_broadcast_enabled ? t("common.on") : t("common.off")],
      [t("social.publicDiscovery"), status.public_enabled ? t("common.on") : t("common.off")],
      [t("social.namespace"), effectiveNamespace],
      [t("labels.room"), effectiveRoom],
      [t("labels.relay"), effectiveRelay],
      [t("network.lastPoll"), networkDiag.last_poll_at ? new Date(networkDiag.last_poll_at).toLocaleTimeString() : "-"],
      [t("network.lastPublish"), networkDiag.last_publish_at ? new Date(networkDiag.last_publish_at).toLocaleTimeString() : "-"],
      [t("network.lastError"), networkDiag.last_error || t("network.none")],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${escapeHtml(String(v))}</div></div>`).join("");

    const skillLearning = bridge.skill_learning || {};
    const ownerDelivery = bridge.owner_delivery || {};
    const installAction = skillLearning.install_action || {};
    const openclawRunning = !!bridge.openclaw_runtime?.running;
    const openclawDetected = !!bridge.openclaw_installation?.detected || openclawRunning || !!bridge.openclaw_runtime?.gateway_reachable;
    const skillInstalled = !!skillLearning.installed;
    const installedSkillPath = skillLearning.installed_skill_path || "-";
    let ownerDeliveryHeadline = t("feedback.openclawRoleBroadcasterOnly");
    let ownerDeliveryBody = ownerDelivery.reason || "-";
    let ownerDeliveryTone = "warn";
    if (ownerDelivery.ready) {
      ownerDeliveryHeadline = t("feedback.openclawRoleOwnerReady");
      ownerDeliveryBody = t("hints.ownerDeliveryReadyBody");
      ownerDeliveryTone = "info";
    } else if (ownerDelivery.bridge_messages_readable) {
      if (ownerDelivery.forward_command_configured) {
        ownerDeliveryHeadline = t("feedback.openclawRoleNeedsOwnerRoute");
        ownerDeliveryBody = t("hints.ownerDeliveryNeedsRouteBody");
      } else {
        ownerDeliveryHeadline = t("feedback.openclawRoleLearningOnly");
        ownerDeliveryBody = t("hints.ownerDeliveryLearningBody");
      }
    } else if (!openclawRunning) {
      ownerDeliveryHeadline = t("feedback.openclawRoleNotRunning");
      ownerDeliveryBody = ownerDelivery.reason || "-";
    }
    document.getElementById("socialOwnerDeliveryStatus").className = `feedback ${ownerDeliveryTone}`;
    document.getElementById("socialOwnerDeliveryStatus").textContent = ownerDeliveryHeadline;
    document.getElementById("socialOwnerDeliverySubline").textContent = [
      `${t("social.broadcastReadable")}: ${ownerDelivery.bridge_messages_readable ? t("common.yes") : t("common.no")}`,
      `${t("social.ownerForwardCommand")}: ${ownerDelivery.forward_command_configured ? t("common.yes") : t("common.no")}`,
      `${t("social.ownerForwardReady")}: ${ownerDelivery.ready ? t("common.yes") : t("common.no")}`,
    ].join(" · ");
    document.getElementById("socialOwnerDeliveryReason").textContent = ownerDeliveryBody;
    document.getElementById("socialCapabilityCards").innerHTML = [
      [t("socialCapability.publicBroadcast"), bridge.message_broadcast_enabled ? t("common.yes") : t("common.no")],
      [t("socialCapability.monitorBroadcasts"), ownerDelivery.bridge_messages_readable ? t("common.yes") : t("common.no")],
      [t("socialCapability.autoPushToOwner"), ownerDelivery.ready ? t("common.yes") : t("common.no")],
      [t("socialCapability.ownerPrivateBoundary"), t("socialCapability.ownerPrivateBoundaryValue")],
    ].map(([k, v]) => `<div class="card"><div class="label">${escapeHtml(String(k))}</div><div class="value" style="font-size:17px;">${escapeHtml(String(v))}</div></div>`).join("");
    document.getElementById("openclawSkillCards").innerHTML = [
      [t("social.openclawInstalled"), openclawDetected ? t("common.yes") : t("common.no")],
      [t("social.running"), openclawRunning ? t("common.yes") : t("common.no")],
      [t("social.skillInstalled"), skillInstalled ? t("common.yes") : t("common.no")],
      [t("social.broadcastReadable"), ownerDelivery.bridge_messages_readable ? t("common.yes") : t("common.no")],
      [t("social.ownerForwardReady"), ownerDelivery.ready ? t("common.yes") : t("common.no")],
      [t("social.ownerForwardCommand"), ownerDelivery.forward_command_configured ? t("common.yes") : t("common.no")],
      [t("social.openclawDetectionMode"), bridge.openclaw_runtime?.detection_mode || "-"],
      [t("social.openclawGateway"), bridge.openclaw_runtime?.gateway_url || "-"],
      [t("social.installMode"), skillLearning.install_mode || "-"],
      [t("social.installedPath"), skillInstalled ? installedSkillPath : "-"],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${escapeHtml(v)}</div></div>`).join("");
    document.getElementById("openclawSkillPath").textContent = ownerDelivery.forward_command
      ? `${ownerDelivery.forward_command}${ownerDelivery.owner_channel ? ` · ${ownerDelivery.owner_channel}` : ""}${ownerDelivery.owner_target ? ` · ${ownerDelivery.owner_target}` : ""}`
      : skillInstalled
        ? installedSkillPath
        : `${installAction.recommended_command || "-"}${bridge.openclaw_runtime?.gateway_url ? ` · detect ${bridge.openclaw_runtime.gateway_url}` : ""}`;
    document.getElementById("openclawSkillHint").textContent = !openclawDetected
      ? t("feedback.openclawRoleBroadcasterOnly")
      : !openclawRunning
        ? t("feedback.openclawRoleNotRunning")
        : !skillInstalled
          ? t("feedback.openclawRoleReadyToLearn")
          : ownerDelivery.ready
            ? t("feedback.openclawRoleOwnerReady")
            : ownerDelivery.bridge_messages_readable && !ownerDelivery.forward_command_configured
              ? t("feedback.openclawRoleLearningOnly")
              : ownerDelivery.bridge_messages_readable
                ? t("feedback.openclawRoleNeedsOwnerRoute")
                : t("feedback.openclawRoleLearned");
    const skillInstallBtn = document.getElementById("openclawSkillInstallBtn");
    skillInstallBtn.textContent = !openclawDetected
      ? t("actions.openclawNotInstalled")
      : !openclawRunning
        ? t("actions.openclawNotRunning")
        : skillInstalled
          ? t("actions.openclawSkillLearned")
          : t("actions.learnOpenClawSkill");
    skillInstallBtn.disabled = !openclawDetected || !openclawRunning || skillInstalled;

    const policy = governance.policy || {};
    const blockedAgentIds = Array.isArray(policy.blocked_agent_ids) ? policy.blocked_agent_ids : [];
    const blockedTerms = Array.isArray(policy.blocked_terms) ? policy.blocked_terms : [];
    document.getElementById("governanceSendLimitInput").value = String(policy.send_limit?.max ?? 5);
    document.getElementById("governanceSendWindowInput").value = String(Math.floor((policy.send_limit?.window_ms ?? 60000) / 1000));
    document.getElementById("governanceReceiveLimitInput").value = String(policy.receive_limit?.max ?? 8);
    document.getElementById("governanceReceiveWindowInput").value = String(Math.floor((policy.receive_limit?.window_ms ?? 60000) / 1000));
    document.getElementById("governanceDuplicateWindowInput").value = String(Math.floor((policy.duplicate_window_ms ?? 180000) / 1000));
    document.getElementById("governanceBlockedAgentsInput").value = blockedAgentIds.join(", ");
    document.getElementById("governanceBlockedTermsInput").value = blockedTerms.join(", ");
    document.getElementById("socialGovernanceCards").innerHTML = [
      [t("labels.sendLimit"), `${policy.send_limit?.max ?? "-"} / ${Math.floor((policy.send_limit?.window_ms ?? 60000) / 1000)}s`],
      [t("labels.receiveLimit"), `${policy.receive_limit?.max ?? "-"} / ${Math.floor((policy.receive_limit?.window_ms ?? 60000) / 1000)}s`],
      [t("labels.duplicateWindowSeconds"), `${Math.floor((policy.duplicate_window_ms ?? 0) / 1000)}s`],
      [t("labels.blockedAgentIds"), blockedAgentIds.length],
      [t("labels.blockedTerms"), blockedTerms.length],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");

    const moderationEvents = Array.isArray(governance.recent_events) ? governance.recent_events : [];
    document.getElementById("socialModerationList").innerHTML = moderationEvents.length === 0
      ? `<div class="empty-state">${t("network.noModerationEvents")}</div>`
      : moderationEvents.map((event) => `
          <div class="log-item">
            <div class="log-${event.level || "warn"}">[${String(event.level || "warn").toUpperCase()}] ${escapeHtml(event.message || "-")}</div>
            <div class="mono" style="color:#90a2c3;">${new Date(event.timestamp).toLocaleString()}</div>
          </div>
        `).join("");

    document.getElementById("socialAdvancedCards").innerHTML = [
      [t("labels.adapter"), effectiveAdapter],
      [t("social.namespace"), effectiveNamespace],
      [t("labels.room"), effectiveRoom],
      [t("social.bridgeStatus"), bridge.connected_to_silicaclaw ? t("common.yes") : t("common.no")],
      [t("social.messageBroadcast"), bridge.message_broadcast_enabled ? t("common.on") : t("common.off")],
      [t("social.restartRequired"), social.network_requires_restart ? t("common.yes") : t("common.no")],
    ].map(([k, v]) => `<div class="card"><div class="label">${k}</div><div class="value" style="font-size:17px;">${v}</div></div>`).join("");
    document.getElementById("socialAdvancedWrap").textContent = toPrettyJson({
      effective_runtime: {
        mode: effectiveMode,
        adapter: effectiveAdapter,
        namespace: effectiveNamespace,
        relay: effectiveRelay,
        room: effectiveRoom,
        restart_required: social.network_requires_restart,
      },
      openclaw_bridge: {
        enabled: bridge.enabled,
        connected_to_silicaclaw: bridge.connected_to_silicaclaw,
        public_enabled: bridge.public_enabled,
        message_broadcast_enabled: bridge.message_broadcast_enabled,
        openclaw_runtime: bridge.openclaw_runtime || {},
        skill_learning: bridge.skill_learning || {},
        endpoints: bridge.endpoints || {},
      },
      source: {
        social_md_found: summary.social_md_found,
        social_md_source_path: summary.social_md_source_path,
      },
    });

    document.getElementById("socialSourceWrap").textContent = toPrettyJson({
      found: social.found,
      source_path: social.source_path,
      parse_error: social.parse_error,
    });
    document.getElementById("socialRawWrap").textContent = toPrettyJson({
      raw_frontmatter: social.raw_frontmatter || null,
    });
    document.getElementById("socialRuntimeWrap").textContent = toPrettyJson(runtime);
  }

  async function exportSocialTemplate() {
    const payload = (await api("/api/social/export-template")).data || {};
    setSocialTemplate(String(payload.content || ""));
    document.getElementById("socialTemplateWrap").textContent = getSocialTemplate() || "-";
    return payload;
  }

  function renderLogs() {
    const logsCache = getLogsCache();
    const logLevelFilter = getLogLevelFilter();
    const el = document.getElementById("logList");
    if (!logsCache.length) {
      el.innerHTML = `<div class="empty-state">${t("network.noLogsYet")}</div>`;
      return;
    }
    const filtered = logLevelFilter === "all" ? logsCache : logsCache.filter((item) => String(item.level || "").toLowerCase() === logLevelFilter);
    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state">${t("network.noLogsForLevel", { level: logLevelFilter })}</div>`;
      return;
    }
    el.innerHTML = filtered.map((item) => `
      <div class="log-item">
        <div class="log-${item.level}">[${String(item.level).toUpperCase()}] ${item.message}</div>
        <div class="mono" style="color:#90a2c3;">${new Date(item.timestamp).toLocaleString()}</div>
      </div>
    `).join("");
  }

  async function refreshLogs() {
    setLogsCache((await api("/api/logs")).data || []);
    renderLogs();
  }

  function renderSkillCard(skill, options = {}) {
    const capabilities = Array.isArray(skill.capabilities) ? skill.capabilities.slice(0, 6) : [];
    const updateAvailable = options.updateAvailable === true;
    const statusText = options.statusText || (skill.installed_in_openclaw ? t("common.yes") : t("hints.skillsNotInstalled"));
    const versionText = String(skill.version || "-");
    const bodyText = escapeHtml(String(skill.description || "-"));
    const skillName = String(skill.name || "").trim();
    const installable = options.installable === true && Boolean(skillName) && (!skill.installed_in_openclaw || updateAvailable);
    const installedVersionText = escapeHtml(String(options.installedVersion || skill.installed_version || "-"));
    const bundledVersionText = escapeHtml(String(options.bundledVersion || skill.bundled_version || skill.version || "-"));
    const installTone = updateAvailable
      ? "tag-chip warn"
      : skill.installed_in_openclaw || skill.install_mode === "workspace" || skill.install_mode === "legacy"
        ? "tag-chip emphasis"
        : "tag-chip muted";
    const sourceText = escapeHtml(String(skill.source_path || skill.bundled_source_path || skill.installed_path || "-"));
    const locationText = escapeHtml(String(skill.installed_path || skill.manifest_path || "-"));
    return `
      <div class="skill-card">
        <div class="skill-card__top">
          <div>
            <div class="skill-card__eyebrow">${escapeHtml(options.eyebrow || skill.install_mode || "skill")}</div>
            <div class="skill-card__title">${escapeHtml(skill.display_name || skill.name || "Skill")}</div>
          </div>
          <div class="skill-card__version mono">${escapeHtml(versionText)}</div>
        </div>
        <div class="skill-card__body">${bodyText}</div>
        <div class="skill-card__tags">
          <span class="${installTone}">${escapeHtml(statusText)}</span>
          ${updateAvailable ? `<span class="tag-chip warn">${t("labels.skillsUpdateAvailable")}</span>` : ""}
          ${capabilities.map((item) => `<span class="tag-chip">${escapeHtml(String(item))}</span>`).join("")}
        </div>
        <div class="skill-card__meta">
          <div class="skill-card__meta-item">
            <div class="skill-card__meta-label">${t("labels.skillsInstalledVersion")}</div>
            <div class="skill-card__meta-value mono">${installedVersionText}</div>
          </div>
          <div class="skill-card__meta-item">
            <div class="skill-card__meta-label">${t("labels.skillsBundledVersion")}</div>
            <div class="skill-card__meta-value mono">${bundledVersionText}</div>
          </div>
          <div class="skill-card__meta-item">
            <div class="skill-card__meta-label">${t("labels.skillsSource")}</div>
            <div class="skill-card__meta-value mono">${sourceText}</div>
          </div>
          <div class="skill-card__meta-item">
            <div class="skill-card__meta-label">${t("labels.skillsLocation")}</div>
            <div class="skill-card__meta-value mono">${locationText}</div>
          </div>
        </div>
        ${installable ? `
          <div class="actions">
            <button class="secondary skill-install-btn" type="button" data-skill-install="${escapeHtml(skillName)}">${updateAvailable ? t("actions.updateThisSkill") : t("actions.installThisSkill")}</button>
          </div>
        ` : ""}
      </div>
    `;
  }

  function setSkillActionCopy({ title, body, state }) {
    document.getElementById("skillsActionTitle").textContent = title;
    document.getElementById("skillsActionBody").textContent = body;
    document.getElementById("skillsActionState").textContent = state;
  }

  function renderDialogueCard(skill) {
    const sections = Array.isArray(skill.owner_dialogue_sections_zh) ? skill.owner_dialogue_sections_zh : [];
    const examples = Array.isArray(skill.owner_dialogue_examples_zh) ? skill.owner_dialogue_examples_zh : [];
    return `
      <div class="skill-card">
        <div class="skill-card__top">
          <div>
            <div class="skill-card__eyebrow">${escapeHtml(skill.display_name || skill.name || "Skill")}</div>
            <div class="skill-card__title">${escapeHtml(t("labels.skillsDialogueExamples"))}</div>
          </div>
          <div class="skill-card__version mono">${escapeHtml(skill.version || "-")}</div>
        </div>
        <div class="skill-card__body">${escapeHtml(skill.description || "-")}</div>
        <div class="skills-dialogue-list">
          ${sections.length
            ? sections.map((section) => `
                <div class="skills-dialogue-group">
                  <div class="skills-dialogue-group__title">${escapeHtml(String(section.title || "-"))}</div>
                  <div class="skills-dialogue-group__items">
                    ${Array.isArray(section.items)
                      ? section.items.map((item) => `<div class="skills-dialogue-item">"${escapeHtml(String(item))}"</div>`).join("")
                      : ""}
                  </div>
                </div>
              `).join("")
            : examples.length
              ? examples.map((item) => `<div class="skills-dialogue-item">"${escapeHtml(String(item))}"</div>`).join("")
            : `<div class="skills-empty">${t("hints.skillsNoDialogueExamples")}</div>`}
        </div>
      </div>
    `;
  }

  async function refreshSkills() {
    const payload = (await api("/api/skills")).data || {};
    const bundled = Array.isArray(payload.bundled_skills) ? payload.bundled_skills : [];
    const installed = Array.isArray(payload.installed_skills) ? payload.installed_skills : [];
    const openclaw = payload.openclaw || {};
    const summary = payload.summary || {};
    const installAction = payload.install_action || {};
    const broadcastSkill = bundled.find((item) => item.name === "silicaclaw-broadcast") || bundled[0] || null;
    const ownerPushSkill = bundled.find((item) => item.name === "silicaclaw-owner-push") || null;
    const featuredSkills = [broadcastSkill, ownerPushSkill].filter(Boolean);
    const openclawDetected = !!openclaw.detected;
    const openclawRunning = !!openclaw.running;
    const allFeaturedInstalled = featuredSkills.length > 0 && featuredSkills.every((item) => item.installed_in_openclaw);
    const installedFeaturedCount = featuredSkills.filter((item) => item.installed_in_openclaw).length;
    const bundledUpdateCount = bundled.filter((item) => item.update_available).length;
    const bundledSorted = [...bundled].sort((left, right) => {
      const featuredLeft = featuredSkills.some((item) => item?.name === left.name) ? 1 : 0;
      const featuredRight = featuredSkills.some((item) => item?.name === right.name) ? 1 : 0;
      if (featuredLeft !== featuredRight) return featuredRight - featuredLeft;
      const updateLeft = left.update_available ? 1 : 0;
      const updateRight = right.update_available ? 1 : 0;
      if (updateLeft !== updateRight) return updateRight - updateLeft;
      const installLeft = left.installed_in_openclaw ? 1 : 0;
      const installRight = right.installed_in_openclaw ? 1 : 0;
      if (installLeft !== installRight) return installLeft - installRight;
      return String(left.display_name || left.name || "").localeCompare(String(right.display_name || right.name || ""));
    });
    const installedSorted = [...installed].sort((left, right) =>
      String(left.display_name || left.name || "").localeCompare(String(right.display_name || right.name || ""))
    );

    document.getElementById("skillsBannerRuntimeValue").textContent = t("hints.skillsRuntimeSummary", {
      runtime: openclawRunning ? t("common.yes") : t("common.no"),
      bundled: String(summary.bundled_count || 0),
      installed: String(summary.installed_count || 0),
    });

    if (!openclawDetected) {
      setSkillActionCopy({
        title: t("hints.skillsActionMissingTitle"),
        body: t("hints.skillsActionMissingBody"),
        state: t("labels.skillsStateAttention"),
      });
    } else if (!openclawRunning) {
      setSkillActionCopy({
        title: t("hints.skillsActionStoppedTitle"),
        body: t("hints.skillsActionStoppedBody"),
        state: t("labels.skillsStateAttention"),
      });
    } else if (bundledUpdateCount > 0) {
      setSkillActionCopy({
        title: t("hints.skillsActionUpdateTitle", { count: String(bundledUpdateCount) }),
        body: t("hints.skillsActionUpdateBody", { count: String(bundledUpdateCount) }),
        state: t("labels.skillsStateAttention"),
      });
    } else if (allFeaturedInstalled) {
      setSkillActionCopy({
        title: t("hints.skillsActionCompleteTitle"),
        body: t("hints.skillsActionCompleteBody"),
        state: t("labels.skillsStateComplete"),
      });
    } else if (installedFeaturedCount > 0) {
      setSkillActionCopy({
        title: t("hints.skillsActionPartialTitle"),
        body: t("hints.skillsActionPartialBody"),
        state: t("labels.skillsStateInProgress"),
      });
    } else {
      setSkillActionCopy({
        title: t("hints.skillsActionInstallTitle"),
        body: t("hints.skillsActionInstallBody"),
        state: t("labels.skillsStateReady"),
      });
    }

    document.getElementById("skillsSummaryCards").innerHTML = [
      [t("labels.skillsBundled"), String(summary.bundled_count || 0)],
      [t("labels.skillsInstalled"), String(summary.installed_count || 0)],
      [t("labels.skillsUpdates"), String(summary.update_available_count || 0)],
      [t("labels.skillsBroadcastLearning"), broadcastSkill?.installed_in_openclaw ? t("common.yes") : t("common.no")],
      [t("labels.skillsAutoPush"), ownerPushSkill?.installed_in_openclaw ? t("common.yes") : t("common.no")],
    ].map(([k, v]) => `<div class="skills-summary-card"><div class="label">${k}</div><div class="value">${escapeHtml(v)}</div></div>`).join("");

    document.getElementById("skillsFeaturedCount").textContent = `${featuredSkills.length}`;
    document.getElementById("skillsBundledCount").textContent = `${bundled.length}`;
    document.getElementById("skillsInstalledCount").textContent = `${installed.length}`;
    document.getElementById("skillsDialogueCount").textContent = `${featuredSkills.length}`;

    document.getElementById("skillsFeaturedSpotlights").innerHTML = featuredSkills.length
      ? featuredSkills.map((skill) => `
        <div class="skills-spotlight">
          <div class="skill-card__eyebrow">${escapeHtml(skill.name === "silicaclaw-owner-push" ? t("labels.skillsAutoPush") : t("labels.skillsBroadcastLearning"))}</div>
          <div class="skills-spotlight__title">${escapeHtml(skill.display_name || skill.name)}</div>
          <div class="skills-spotlight__body">${escapeHtml(skill.description || "-")}</div>
          <div class="skill-card__tags">
            <span class="${skill.update_available ? "tag-chip warn" : skill.installed_in_openclaw ? "tag-chip emphasis" : "tag-chip muted"}">${skill.update_available ? t("labels.skillsUpdateAvailable") : skill.installed_in_openclaw ? `${t("labels.skillsStatus")}: ${t("common.yes")}` : t("hints.skillsNotInstalled")}</span>
            ${(skill.capabilities || []).slice(0, 8).map((item) => `<span class="tag-chip">${escapeHtml(String(item))}</span>`).join("")}
          </div>
        </div>
      `).join("")
      : `<div class="skills-empty">${t("hints.skillsNoBundled")}</div>`;

    document.getElementById("skillsBundledGrid").innerHTML = bundledSorted.length
      ? bundledSorted.map((skill) => renderSkillCard(skill, {
          eyebrow: skill.install_mode === "workspace" || skill.install_mode === "legacy" ? skill.install_mode : "bundled",
          statusText: skill.update_available
            ? t("labels.skillsUpdateAvailable")
            : skill.installed_in_openclaw
              ? `${t("labels.skillsStatus")}: ${t("common.yes")}`
              : t("hints.skillsNotInstalled"),
          installable: true,
          updateAvailable: skill.update_available,
          installedVersion: skill.installed_version,
          bundledVersion: skill.version,
        })).join("")
      : `<div class="skills-empty">${t("hints.skillsNoBundled")}</div>`;

    document.getElementById("skillsInstalledGrid").innerHTML = installedSorted.length
      ? installedSorted.map((skill) => renderSkillCard(skill, {
          eyebrow: skill.install_mode || "installed",
          statusText: skill.update_available
            ? t("labels.skillsUpdateAvailable")
            : `${t("labels.skillsStatus")}: ${escapeHtml(String(skill.install_mode || "-"))}`,
          updateAvailable: skill.update_available,
          installedVersion: skill.version,
          bundledVersion: skill.bundled_version,
        })).join("")
      : `<div class="skills-empty">${t("hints.skillsNoInstalled")}</div>`;

    document.getElementById("skillsDialogueGrid").innerHTML = featuredSkills.length
      ? featuredSkills.map((skill) => renderDialogueCard(skill)).join("")
      : `<div class="skills-empty">${t("hints.skillsNoDialogueExamples")}</div>`;

    const installBtn = document.getElementById("skillsInstallBtn");
    installBtn.textContent = !openclawDetected
      ? t("actions.openclawNotInstalled")
      : !openclawRunning
        ? t("actions.openclawNotRunning")
        : bundledUpdateCount > 0
          ? t("actions.updateSilicaClawSkills")
        : allFeaturedInstalled
          ? t("actions.silicaClawSkillsInstalled")
          : t("actions.installSilicaClawSkills");
    installBtn.disabled = !openclawDetected || !openclawRunning || (allFeaturedInstalled && bundledUpdateCount === 0);
    document.getElementById("skillsFeedback").textContent = allFeaturedInstalled && bundledUpdateCount === 0
      ? t("feedback.openclawSkillInstalled")
      : installAction.recommended_command || t("common.ready");
  }

  return {
    exportSocialTemplate,
    refreshLogs,
    refreshMessages,
    refreshSkills,
    refreshSocial,
    renderLogs,
    renderSocialMessages,
    setLogLevelFilter,
  };
}
