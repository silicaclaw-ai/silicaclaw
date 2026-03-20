export function bindAppEvents({
  api,
  applyTheme,
  exportSocialTemplate,
  flashButton,
  messageSendReasonText,
  parseCsv,
  profileController,
  pulseOverviewBroadcastStep,
  clearUiCache,
  refreshAll,
  refreshLogs,
  refreshMessages,
  refreshNetwork,
  refreshOverview,
  refreshSkills,
  refreshSocial,
  renderLogs,
  renderSocialMessages,
  renderSocialModeHint,
  setFeedback,
  setOnlyShowOnline,
  setProfileNextStepVisible,
  setSocialMessageFilter,
  setSocialModeDirty,
  setSocialModePending,
  setSocialModePendingState,
  shouldWarnBeforeUnload,
  socialController,
  switchTab,
  t,
  toast,
  getSocialTemplate,
  getQuickConnectDefaults,
  setAgentsPage,
  getSocialMessagesCache,
  toPrettyJson,
}) {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("sidebarToggleBtn").addEventListener("click", () => {
    const shell = document.getElementById("appShell");
    const next = !shell.classList.contains("nav-collapsed");
    shell.classList.toggle("nav-collapsed", next);
    const btn = document.getElementById("sidebarToggleBtn");
    const icon = btn.querySelector(".nav-collapse-toggle__icon");
    btn.classList.toggle("active", next);
    btn.title = next ? t("labels.expandSidebar") : t("labels.collapseSidebar");
    btn.setAttribute("aria-label", btn.title);
    if (icon) {
      icon.innerHTML = next
        ? `
          <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
            <path d="M9 3v18"></path>
            <path d="M14 10l3 2-3 2"></path>
          </svg>
        `
        : `
          <svg viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
            <path d="M9 3v18"></path>
            <path d="M16 10l-3 2 3 2"></path>
          </svg>
        `;
    }
  });

  document.getElementById("focusModeBtn").addEventListener("click", () => {
    const shell = document.getElementById("appShell");
    const next = !shell.classList.contains("focus-mode");
    shell.classList.toggle("focus-mode", next);
    const btn = document.getElementById("focusModeBtn");
    btn.classList.toggle("active", next);
    btn.title = next ? t("labels.exitFocusMode") : t("labels.toggleFocusMode");
    btn.setAttribute("aria-label", btn.title);
  });

  document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.themeChoice || "dark");
    });
  });

  document.getElementById("overviewStepProfileBtn").addEventListener("click", () => switchTab("profile"));
  document.getElementById("overviewStepPublicBtn").addEventListener("click", () => switchTab("profile"));
  document.getElementById("overviewStepBroadcastBtn").addEventListener("click", () => {
    document.getElementById("broadcastNowBtn").click();
  });
  document.getElementById("homeOpenAgentBtn").addEventListener("click", () => switchTab("agent"));
  document.getElementById("homeOpenSocialBtn").addEventListener("click", () => switchTab("social"));
  document.getElementById("homeOpenNetworkBtn").addEventListener("click", () => switchTab("network"));
  document.getElementById("homeBroadcastNowBtn").addEventListener("click", () => {
    document.getElementById("broadcastNowBtn").click();
  });
  document.getElementById("profileNextStepBtn").addEventListener("click", () => {
    setProfileNextStepVisible(false);
    switchTab("overview");
  });
  document.getElementById("profileNextStepDismissBtn").addEventListener("click", () => {
    setProfileNextStepVisible(false);
  });

  document.getElementById("socialMessageRefreshBtn").addEventListener("click", async () => {
    try {
      await refreshMessages();
      setFeedback("socialMessageFeedback", t("feedback.messageInboxRefreshed"));
      toast(t("feedback.messageInboxRefreshed"));
    } catch (e) {
      setFeedback("socialMessageFeedback", e instanceof Error ? e.message : t("feedback.messageRefreshFailed"), "error");
    }
  });

  document.getElementById("socialMessageFilterSelect").addEventListener("change", (event) => {
    setSocialMessageFilter(String(event.target?.value || "all"));
    renderSocialMessages();
  });

  document.getElementById("socialMessageSendBtn").addEventListener("click", async () => {
    const input = document.getElementById("socialMessageInput");
    const topic = String(document.getElementById("socialMessageTopicSelect").value || "global");
    const body = String(input.value || "").trim();
    if (!body) {
      setFeedback("socialMessageFeedback", t("feedback.messageEmpty"), "warn");
      return;
    }

    const sendBtn = document.getElementById("socialMessageSendBtn");
    sendBtn.disabled = true;
    setFeedback("socialMessageFeedback", t("feedback.messageSending"));
    try {
      const result = await api("/api/messages/broadcast", {
        method: "POST",
        body: JSON.stringify({ body, topic }),
      });
      if (!result.data?.sent) {
        setFeedback("socialMessageFeedback", messageSendReasonText(t, String(result.data?.reason || "failed")), "warn");
        return;
      }
      const messageId = String(result.data?.message?.message_id || "");
      input.value = "";
      await refreshMessages();
      const visiblePeers = await api("/api/search?q=");
      const remoteVisibleCount = Array.isArray(visiblePeers.data)
        ? visiblePeers.data.filter((item) => !item.is_self && item.online).length
        : 0;
      const published = getSocialMessagesCache().find((item) => item.message_id === messageId);
      const confirmed = Boolean(published);
      const remoteObservedCount = Number(published?.remote_observation_count || 0);
      const remoteHint = t("feedback.messageRemoteVisibility", { count: String(remoteVisibleCount) });
      setFeedback(
        "socialMessageFeedback",
        `${confirmed ? t("feedback.messageInboxConfirmed") : t("feedback.messageInboxPending")} ${
          remoteObservedCount > 0
            ? t("feedback.messageRemoteObserved", { count: String(remoteObservedCount) })
            : remoteHint
        }`,
        confirmed ? "info" : "warn",
      );
      toast(confirmed ? t("feedback.messageInboxConfirmed") : t("feedback.messagePublishedLocal"));
      await refreshNetwork();
    } catch (e) {
      setFeedback("socialMessageFeedback", e instanceof Error ? e.message : t("feedback.messageBroadcastFailed"), "error");
    } finally {
      sendBtn.disabled = false;
    }
  });

  profileController.bindProfileForm({ refreshAll });

  window.addEventListener("beforeunload", (event) => {
    if (!shouldWarnBeforeUnload()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  async function runAction(path, text, level = "info") {
    setFeedback("networkFeedback", text);
    try {
      const response = await api(path, { method: "POST" });
      setFeedback("networkFeedback", response.meta?.message || t("common.done"), level);
      toast(response.meta?.message || t("common.done"));
      await refreshAll();
      if (path === "/api/broadcast/now") {
        pulseOverviewBroadcastStep();
      }
    } catch (e) {
      setFeedback("networkFeedback", e instanceof Error ? e.message : t("feedback.failed"), "error");
    }
  }

  document.getElementById("startBroadcastBtn").addEventListener("click", () => runAction("/api/broadcast/start", t("actions.startBroadcast")));
  document.getElementById("stopBroadcastBtn").addEventListener("click", () => runAction("/api/broadcast/stop", t("actions.stopBroadcast"), "warn"));
  document.getElementById("broadcastNowBtn").addEventListener("click", () => runAction("/api/broadcast/now", t("actions.broadcastNow")));

  document.getElementById("quickGlobalPreviewBtn").addEventListener("click", async () => {
    const quickConnectDefaults = typeof getQuickConnectDefaults === "function"
      ? getQuickConnectDefaults()
      : { signalingUrl: "http://localhost:4510", room: "" };
    const currentSignaling = window.prompt(t("feedback.promptSignalingUrl"), quickConnectDefaults.signalingUrl || "http://localhost:4510");
    if (!currentSignaling) return;
    const room = window.prompt(t("feedback.promptRoom"), quickConnectDefaults.room || "") || quickConnectDefaults.room || "";
    setFeedback("networkFeedback", t("feedback.crossPreviewEnabling"));
    try {
      const result = await api("/api/network/quick-connect-global-preview", {
        method: "POST",
        body: JSON.stringify({
          signaling_url: currentSignaling.trim(),
          room: room.trim(),
        }),
      });
      setFeedback("networkFeedback", result.meta?.message || t("feedback.crossPreviewEnabled"));
      toast(t("feedback.crossPreviewEnabled"));
      await refreshAll();
    } catch (e) {
      setFeedback("networkFeedback", e instanceof Error ? e.message : t("feedback.enableCrossPreviewFailed"), "error");
    }
  });

  document.getElementById("onlyOnlineToggle").addEventListener("change", async (event) => {
    setOnlyShowOnline(Boolean(event.target?.checked));
    setAgentsPage(1);
    await refreshOverview();
  });

  document.getElementById("clearDiscoveryCacheBtn").addEventListener("click", async () => {
    try {
      await api("/api/cache/clear", { method: "POST" });
      clearUiCache(["silicaclaw_ui_overview", "silicaclaw_ui_network", "silicaclaw_ui_social"]);
      setFeedback("networkFeedback", t("feedback.discoveryCacheCleared"));
      toast(t("feedback.discoveryCacheCleared"));
      setAgentsPage(1);
      await refreshAll();
    } catch (e) {
      setFeedback("networkFeedback", e instanceof Error ? e.message : t("feedback.failed"), "error");
    }
  });

  document.getElementById("refreshLogsBtn").addEventListener("click", async () => {
    await refreshLogs();
    toast(t("feedback.logsRefreshed"));
  });

  document.getElementById("socialExportBtn").addEventListener("click", async () => {
    setFeedback("socialFeedback", t("feedback.exportingTemplate"));
    try {
      await exportSocialTemplate();
      setFeedback("socialFeedback", t("feedback.templateExported"));
      toast(t("feedback.templateExported"));
    } catch (e) {
      setFeedback("socialFeedback", e instanceof Error ? e.message : t("feedback.exportFailed"), "error");
    }
  });

  document.getElementById("openclawSkillInstallBtn").addEventListener("click", async () => {
    const btn = document.getElementById("openclawSkillInstallBtn");
    btn.disabled = true;
    setFeedback("openclawSkillFeedback", t("feedback.openclawSkillInstalling"));
    try {
      await api("/api/openclaw/bridge/skill-install", { method: "POST" });
      setFeedback("openclawSkillFeedback", t("feedback.openclawSkillInstalled"));
      toast(t("feedback.openclawSkillInstalled"));
      await refreshSocial();
    } catch (e) {
      setFeedback("openclawSkillFeedback", e instanceof Error ? e.message : t("feedback.openclawSkillInstallFailed"), "error");
    } finally {
      await refreshSocial().catch(() => {});
    }
  });

  document.getElementById("skillsInstallBtn").addEventListener("click", async () => {
    const btn = document.getElementById("skillsInstallBtn");
    btn.disabled = true;
    setFeedback("skillsFeedback", t("feedback.openclawSkillInstalling"));
    try {
      await api("/api/openclaw/bridge/skill-install", { method: "POST" });
      setFeedback("skillsFeedback", t("feedback.openclawSkillInstalled"));
      toast(t("feedback.openclawSkillInstalled"));
      await refreshSkills();
      await refreshSocial();
    } catch (e) {
      setFeedback("skillsFeedback", e instanceof Error ? e.message : t("feedback.openclawSkillInstallFailed"), "error");
    } finally {
      await refreshSkills().catch(() => {});
    }
  });

  document.getElementById("skillsBundledGrid").addEventListener("click", async (event) => {
    const btn = event.target instanceof Element ? event.target.closest("[data-skill-install]") : null;
    if (!btn) return;
    const skillName = String(btn.getAttribute("data-skill-install") || "").trim();
    if (!skillName) return;
    btn.setAttribute("disabled", "true");
    setFeedback("skillsFeedback", `${t("common.saving")} ${skillName}`);
    try {
      await api("/api/openclaw/bridge/skill-install", {
        method: "POST",
        body: JSON.stringify({ skill_name: skillName }),
      });
      setFeedback("skillsFeedback", t("feedback.openclawSkillInstalled"));
      toast(`${t("feedback.openclawSkillInstalled")} · ${skillName}`);
      await refreshSkills();
      await refreshSocial();
    } catch (e) {
      setFeedback("skillsFeedback", e instanceof Error ? e.message : t("feedback.openclawSkillInstallFailed"), "error");
    } finally {
      btn.removeAttribute("disabled");
      await refreshSkills().catch(() => {});
    }
  });

  document.querySelectorAll("[data-skills-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = String(btn.getAttribute("data-skills-jump") || "").trim();
      if (!targetId) return;
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  document.getElementById("skillsSearchInput").addEventListener("input", async (event) => {
    socialController.setSkillsQuery(String(event.target?.value || ""));
    await refreshSkills();
  });

  document.querySelectorAll("[data-skills-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      socialController.setSkillsFilter(String(btn.getAttribute("data-skills-filter") || "all"));
      await refreshSkills();
    });
  });

  document.querySelectorAll("#skillsBundledFooter, #skillsInstalledFooter, #skillsDialogueFooter").forEach((footer) => {
    footer.addEventListener("click", async (event) => {
      const btn = event.target instanceof Element ? event.target.closest("[data-skills-toggle]") : null;
      if (!btn) return;
      socialController.toggleSkillsExpanded(String(btn.getAttribute("data-skills-toggle") || ""));
      await refreshSkills();
    });
  });

  document.getElementById("saveGovernanceBtn").addEventListener("click", async () => {
    setFeedback("socialGovernanceFeedback", t("common.saving"));
    try {
      await api("/api/social/message-governance", {
        method: "PUT",
        body: JSON.stringify({
          send_limit_max: Number(document.getElementById("governanceSendLimitInput").value || 5),
          send_window_ms: Number(document.getElementById("governanceSendWindowInput").value || 60) * 1000,
          receive_limit_max: Number(document.getElementById("governanceReceiveLimitInput").value || 8),
          receive_window_ms: Number(document.getElementById("governanceReceiveWindowInput").value || 60) * 1000,
          duplicate_window_ms: Number(document.getElementById("governanceDuplicateWindowInput").value || 180) * 1000,
          blocked_agent_ids: parseCsv(document.getElementById("governanceBlockedAgentsInput").value || ""),
          blocked_terms: parseCsv(document.getElementById("governanceBlockedTermsInput").value || ""),
        }),
      });
      setFeedback("socialGovernanceFeedback", t("hints.governanceSaved"));
      toast(t("hints.governanceSaved"));
      await refreshSocial();
      await refreshMessages();
    } catch (e) {
      setFeedback("socialGovernanceFeedback", e instanceof Error ? e.message : t("feedback.failed"), "error");
    }
  });

  document.getElementById("socialModeSelect").addEventListener("change", (event) => {
    const mode = String(event.target?.value || "").trim();
    if (!mode) return;
    setSocialModeDirty(true);
    setSocialModePending(mode);
    renderSocialModeHint(mode, mode, false, true);
    setSocialModePendingState(true);
  });

  document.getElementById("socialModeApplyBtn").addEventListener("click", async () => {
    const mode = document.getElementById("socialModeSelect").value;
    setFeedback("socialFeedback", t("feedback.runtimeModeApplying", { mode }));
    try {
      const res = await api("/api/social/runtime-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      setSocialModeDirty(false);
      setSocialModePending("");
      document.getElementById("socialModeSelect").value = mode;
      setSocialModePendingState(false);
      setFeedback("socialFeedback", `${res.meta?.message || t("feedback.runtimeUpdated")} ${t("hints.socialModeHint", {
        selected: mode,
        effective: mode,
        restart: res.data?.network_requires_restart ? t("hints.restartRequiredHint") : t("hints.restartNotRequiredHint"),
      })}`);
      toast(t("feedback.runtimeMode", { mode }));
      await refreshAll();
    } catch (e) {
      setFeedback("socialFeedback", e instanceof Error ? e.message : t("feedback.failed"), "error");
    }
  });

  document.getElementById("socialCopyBtn").addEventListener("click", async () => {
    setFeedback("socialFeedback", t("feedback.copyingTemplate"));
    const btn = document.getElementById("socialCopyBtn");
    try {
      if (!getSocialTemplate()) {
        await exportSocialTemplate();
      }
      await navigator.clipboard.writeText(getSocialTemplate());
      setFeedback("socialFeedback", t("feedback.templateCopied"));
      toast(t("common.copied"));
      flashButton(btn, t("common.copied"));
    } catch (e) {
      setFeedback("socialFeedback", e instanceof Error ? e.message : t("feedback.copyFailed"), "error");
    }
  });

  document.getElementById("socialDownloadBtn").addEventListener("click", async () => {
    setFeedback("socialFeedback", t("feedback.preparingDownload"));
    try {
      const payload = await exportSocialTemplate();
      const filename = String(payload.filename || "social.md");
      const blob = new Blob([getSocialTemplate()], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setFeedback("socialFeedback", t("feedback.downloaded", { filename }));
      toast(t("feedback.downloaded", { filename }));
    } catch (e) {
      setFeedback("socialFeedback", e instanceof Error ? e.message : t("feedback.downloadFailed"), "error");
    }
  });

  document.getElementById("copyPublicProfilePreviewBtn").addEventListener("click", async () => {
    const btn = document.getElementById("copyPublicProfilePreviewBtn");
    try {
      const summary = (await api("/api/public-profile/preview")).data || null;
      await navigator.clipboard.writeText(toPrettyJson(summary));
      toast(t("actions.copyPublicProfilePreview"));
      flashButton(btn, t("common.copied"));
    } catch (e) {
      setFeedback("profileFeedback", e instanceof Error ? e.message : t("feedback.copyPreviewFailed"), "error");
    }
  });

  document.getElementById("logLevelFilter").addEventListener("change", (event) => {
    socialController.setLogLevelFilter(String(event.target?.value || "all"));
    renderLogs();
  });

  (() => {
    const logo = document.getElementById("brandLogo");
    const fallback = document.getElementById("brandFallback");
    if (!logo || !fallback) return;
    logo.addEventListener("error", () => {
      logo.style.display = "none";
      fallback.classList.remove("hidden");
    });
    logo.addEventListener("load", () => {
      logo.style.display = "block";
      fallback.classList.add("hidden");
    });
  })();

  if (window.matchMedia) {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const handleThemeMedia = () => {
      if ((localStorage.getItem("silicaclaw_theme_mode") || "dark") === "system") {
        applyTheme("system");
      }
    };
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleThemeMedia);
    } else if (typeof media.addListener === "function") {
      media.addListener(handleThemeMedia);
    }
  }
}
