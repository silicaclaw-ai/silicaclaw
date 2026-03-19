export function createProfileController({
  api,
  field,
  normalizeTagsInput,
  parseTags,
  setFeedback,
  setProfileNextStepVisible,
  t,
  toast,
  toPrettyJson,
}) {
  const state = {
    baseline: "",
    dirty: false,
    saving: false,
  };

  function profileSnapshot(form) {
    const displayNameEl = field(form, "display_name");
    const bioEl = field(form, "bio");
    const avatarEl = field(form, "avatar_url");
    const tagsEl = field(form, "tags");
    const publicEl = field(form, "public_enabled");
    return JSON.stringify({
      display_name: String(displayNameEl?.value || "").trim(),
      bio: String(bioEl?.value || "").trim(),
      avatar_url: String(avatarEl?.value || "").trim(),
      tags: parseTags(tagsEl?.value || ""),
      public_enabled: !!publicEl?.checked,
    });
  }

  function updateDirtyState(form, fromUserInput = false) {
    const now = profileSnapshot(form);
    state.dirty = now !== state.baseline;
    if (fromUserInput && !state.saving) {
      setFeedback(
        "profileFeedback",
        state.dirty ? t("feedback.unsavedChanges") : t("feedback.allChangesSaved"),
        state.dirty ? "warn" : "info",
      );
    }
  }

  function setProfileBaseline(form) {
    state.baseline = profileSnapshot(form);
    state.dirty = false;
  }

  function setInputError(inputEl, errorElId, message) {
    const errEl = document.getElementById(errorElId);
    errEl.textContent = message || "";
    if (inputEl) {
      inputEl.classList.toggle("input-invalid", Boolean(message));
    }
  }

  function validateProfileForm(form) {
    const displayNameEl = field(form, "display_name");
    const avatarEl = field(form, "avatar_url");
    const tagsEl = field(form, "tags");
    const displayName = String(displayNameEl?.value || "").trim();
    const avatarUrl = String(avatarEl?.value || "").trim();
    const tags = parseTags(tagsEl?.value || "");

    let ok = true;
    let err = "";
    if (displayName.length > 0 && displayName.length < 2) {
      err = t("validation.displayNameShort");
      ok = false;
    } else if (displayName.length > 48) {
      err = t("validation.displayNameLong");
      ok = false;
    }
    setInputError(displayNameEl, "errDisplayName", err);

    err = "";
    if (avatarUrl && !/^https?:\/\//i.test(avatarUrl)) {
      err = t("validation.avatarProtocol");
      ok = false;
    }
    setInputError(avatarEl, "errAvatarUrl", err);

    err = "";
    if (tags.length > 8) {
      err = t("validation.tooManyTags");
      ok = false;
    } else if (tags.some((tag) => tag.length > 20)) {
      err = t("validation.tagTooLong");
      ok = false;
    }
    setInputError(tagsEl, "errTags", err);
    return { ok, tags };
  }

  function renderProfilePreview(form) {
    const displayName = String(field(form, "display_name")?.value || "").trim();
    const bio = String(field(form, "bio")?.value || "").trim();
    const tags = parseTags(field(form, "tags")?.value || "");
    const enabled = !!field(form, "public_enabled")?.checked;

    document.getElementById("previewName").textContent = displayName || t("preview.unnamedAgent");
    document.getElementById("previewBio").textContent = bio || t("preview.noBioYet");
    document.getElementById("previewPublish").textContent = enabled ? t("preview.publishPublicState") : t("preview.publishPrivateState");
    document.getElementById("previewPublishHint").textContent = enabled ? t("hints.previewPublic") : t("hints.previewPrivate");
    document.getElementById("publishLaunchStatus").textContent = enabled ? t("hints.publishPublic") : t("hints.publishPrivate");
    document.getElementById("publishLaunchCard").classList.toggle("is-public", enabled);
    document.getElementById("bioCount").textContent = String(bio.length);

    const tagBox = document.getElementById("previewTags");
    if (!tags.length) {
      tagBox.innerHTML = `<span class="tag-chip muted">${t("preview.noTags")}</span>`;
      return;
    }
    tagBox.innerHTML = tags.map((tag) => `<span class="tag-chip">${tag}</span>`).join("");
  }

  function setSaveBusy(busy) {
    state.saving = busy;
    const btn = document.getElementById("saveProfileBtn");
    btn.disabled = busy;
    btn.classList.toggle("save-busy", busy);
    btn.textContent = busy ? t("common.saving") : t("actions.saveProfile");
  }

  async function refreshPublicProfilePreview() {
    const summary = (await api("/api/public-profile/preview")).data;
    document.getElementById("publicProfilePreviewWrap").textContent = toPrettyJson(summary || null);
    const visibleFields = summary?.public_visibility?.visible_fields || [];
    const hiddenFields = summary?.public_visibility?.hidden_fields || [];
    const visible = visibleFields.join(", ") || "-";
    const hidden = hiddenFields.join(", ") || "-";
    document.getElementById("publicVisibilityHint").textContent = t("preview.visibleFields", { visible, hidden });
    const rows = [
      ...visibleFields.map((item) => t("preview.visible", { field: item })),
      ...hiddenFields.map((item) => t("preview.hidden", { field: item })),
    ];
    document.getElementById("publicVisibilityList").textContent = rows.length ? rows.join("\n") : "-";
  }

  async function refreshProfile() {
    const profile = (await api("/api/profile")).data;
    if (!profile) return;
    const form = document.getElementById("profileForm");
    field(form, "display_name").value = profile.display_name || "";
    field(form, "bio").value = profile.bio || "";
    field(form, "tags").value = (profile.tags || []).join(", ");
    field(form, "avatar_url").value = profile.avatar_url || "";
    field(form, "public_enabled").checked = !!profile.public_enabled;
    form.dataset.lastSavedPublicEnabled = String(!!profile.public_enabled);
    renderProfilePreview(form);
    setProfileBaseline(form);
    setProfileNextStepVisible(false);
    await refreshPublicProfilePreview();
  }

  function bindProfileForm({ refreshAll }) {
    document.getElementById("profileForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const result = validateProfileForm(form);
      if (!result.ok) {
        setFeedback("profileFeedback", t("feedback.fixValidation"), "warn");
        return;
      }

      const tags = result.tags;
      const wasPublicEnabled = String(form.dataset.lastSavedPublicEnabled || "false") === "true";
      const willBePublicEnabled = !!field(form, "public_enabled").checked;
      setFeedback("profileFeedback", t("feedback.savingProfile"));
      setSaveBusy(true);
      try {
        const response = await api("/api/profile", {
          method: "PUT",
          body: JSON.stringify({
            display_name: field(form, "display_name").value,
            bio: field(form, "bio").value,
            tags,
            avatar_url: field(form, "avatar_url").value,
            public_enabled: !!field(form, "public_enabled").checked,
          }),
        });
        setFeedback("profileFeedback", response.meta?.message || t("common.saved"));
        toast(t("feedback.profileSaved"));
        field(form, "tags").value = normalizeTagsInput(field(form, "tags").value);
        form.dataset.lastSavedPublicEnabled = String(willBePublicEnabled);
        await refreshAll();
        setProfileNextStepVisible(!wasPublicEnabled && willBePublicEnabled);
      } catch (error) {
        setFeedback("profileFeedback", error instanceof Error ? error.message : t("feedback.failed"), "error");
      } finally {
        setSaveBusy(false);
      }
    });

    document.getElementById("refreshProfileBtn").addEventListener("click", async () => {
      await refreshProfile();
      toast(t("feedback.profileReloaded"));
    });

    const profileFormEl = document.getElementById("profileForm");
    ["input", "change"].forEach((evt) => {
      profileFormEl.addEventListener(evt, () => {
        renderProfilePreview(profileFormEl);
        validateProfileForm(profileFormEl);
        updateDirtyState(profileFormEl, true);
      });
    });

    const tagsInputEl = field(profileFormEl, "tags");
    tagsInputEl.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      tagsInputEl.value = normalizeTagsInput(tagsInputEl.value);
      renderProfilePreview(profileFormEl);
      validateProfileForm(profileFormEl);
      updateDirtyState(profileFormEl, true);
    });
    tagsInputEl.addEventListener("blur", () => {
      tagsInputEl.value = normalizeTagsInput(tagsInputEl.value);
      renderProfilePreview(profileFormEl);
      validateProfileForm(profileFormEl);
      updateDirtyState(profileFormEl, true);
    });
  }

  return {
    bindProfileForm,
    isDirty: () => state.dirty,
    isSaving: () => state.saving,
    refreshProfile,
    refreshPublicProfilePreview,
  };
}
