export function createShellController({ t, resolveThemeMode }) {
  const REALTIME_UI_CACHE_KEYS = [
    "silicaclaw_ui_overview",
    "silicaclaw_ui_network",
    "silicaclaw_ui_social",
  ];

  function peerStatusText(status) {
    if (status === "online") return t("overview.online");
    if (status === "offline") return t("overview.offline");
    if (status === "stale") return t("network.stale");
    return status || "-";
  }

  function writeUiCache(key, value) {
    void key;
    void value;
  }

  function clearUiCache(keys) {
    const values = Array.isArray(keys) ? keys : keys ? [keys] : REALTIME_UI_CACHE_KEYS;
    try {
      for (const key of values) {
        if (!key) continue;
        localStorage.removeItem(key);
      }
    } catch {
      // ignore cache removal failures
    }
  }

  function hydrateCachedShell() {
    clearUiCache(REALTIME_UI_CACHE_KEYS);
  }

  function toast(msg) {
    const toastEl = document.getElementById("toast");
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 2000);
  }

  function flashButton(btn, doneText = "Done") {
    if (!btn) return;
    const oldText = btn.textContent || "";
    btn.disabled = true;
    btn.textContent = doneText;
    setTimeout(() => {
      btn.textContent = oldText;
      btn.disabled = false;
    }, 900);
  }

  function setFeedback(id, text, level = "info") {
    const el = document.getElementById(id);
    el.textContent = text;
    el.style.color = level === "error" ? "#ff6b81" : level === "warn" ? "#ffb454" : "#9aa7c3";
  }

  function setProfileNextStepVisible(show) {
    const banner = document.getElementById("profileNextStepBanner");
    banner.classList.toggle("show", Boolean(show));
  }

  function renderSocialModeHint(selected, effective, restartRequired, pending = false) {
    const restartText = restartRequired ? t("hints.restartRequiredHint") : t("hints.restartNotRequiredHint");
    const pendingText = pending ? ` ${t("hints.pendingRuntimeModeHint")}` : "";
    document.getElementById("socialModeHint").textContent = `${t("hints.socialModeHint", {
      selected,
      effective,
      restart: restartText,
    })}${pendingText}`;
  }

  function setSocialModePendingState(pending) {
    const applyBtn = document.getElementById("socialModeApplyBtn");
    applyBtn.classList.toggle("button-pending", Boolean(pending));
  }

  function pulseOverviewBroadcastStep() {
    const step = document.getElementById("overviewStepBroadcast");
    const body = document.getElementById("overviewStepBroadcastBody");
    const status = document.getElementById("overviewStepBroadcastStatus");
    if (!step || !body || !status) return;
    const previousBody = body.textContent;
    const previousStatus = status.textContent;
    step.classList.add("is-done", "is-highlighted");
    status.textContent = t("overview.stepDone");
    body.textContent = t("overview.stepBroadcastSuccess");
    setTimeout(() => {
      step.classList.remove("is-highlighted");
      if (body.textContent === t("overview.stepBroadcastSuccess")) {
        body.textContent = previousBody;
      }
      if (status.textContent === t("overview.stepDone")) {
        status.textContent = previousStatus;
      }
    }, 2200);
  }

  function applyTheme(mode) {
    const raw = mode === "system" ? "system" : mode === "light" ? "light" : "dark";
    const next = resolveThemeMode(raw);
    document.documentElement.setAttribute("data-theme-mode", next);
    localStorage.setItem("silicaclaw_theme_mode", raw);
    document.querySelectorAll("[data-theme-choice]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeChoice === raw);
      btn.classList.toggle("topbar-theme-mode__btn--active", btn.dataset.themeChoice === raw);
      btn.setAttribute("aria-checked", btn.dataset.themeChoice === raw ? "true" : "false");
      btn.setAttribute("aria-pressed", btn.dataset.themeChoice === raw ? "true" : "false");
    });
  }

  return {
    applyTheme,
    clearUiCache,
    flashButton,
    hydrateCachedShell,
    peerStatusText,
    pulseOverviewBroadcastStep,
    renderSocialModeHint,
    setFeedback,
    setProfileNextStepVisible,
    setSocialModePendingState,
    toast,
    writeUiCache,
  };
}
