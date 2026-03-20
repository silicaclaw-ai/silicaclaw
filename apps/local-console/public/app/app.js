import { appTemplate } from "./template.js";
import { createI18n } from "./i18n.js";
import { createNetworkController } from "./network.js";
import { createOverviewController } from "./overview.js";
import { createProfileController } from "./profile.js";
import { createShellController } from "./shell.js";
import { createSocialController } from "./social.js";
import { bindAppEvents } from "./events.js";
import { TRANSLATIONS } from "./translations.js";
import {
  ago,
  describeCurrentMode,
  escapeHtml,
  field,
  formatMessageBody,
  messageSendReasonText,
  normalizeTagsInput,
  parseCsv,
  parseTags,
  resolveThemeMode,
  shortId,
  toPrettyJson,
} from "./utils.js";

const root = document.getElementById("app-root");
if (!root) {
  throw new Error("Missing root element: app-root");
}
root.innerHTML = appTemplate;
const APP_UPDATE_SESSION_KEY = 'silicaclaw_pending_updated_version';
const PAGING_STATE_STORAGE_KEY = 'silicaclaw_ui_paging_state';

      const i18n = createI18n(TRANSLATIONS);
      const DEFAULT_LOCALE = i18n.DEFAULT_LOCALE;
      const t = i18n.t;
      let currentLocale = i18n.getCurrentLocale();
      function setLocale(locale) {
        currentLocale = i18n.setLocale(locale);
      }
      function applyStaticTranslations() {
        const setText = (selector, text, index = 0) => {
          const nodes = document.querySelectorAll(selector);
          if (nodes[index]) nodes[index].textContent = text;
        };
        document.title = t('meta.title');
        document.getElementById('metaDescription').setAttribute('content', t('meta.description'));
        document.getElementById('ogTitle').setAttribute('content', t('meta.socialTitle'));
        document.getElementById('ogDescription').setAttribute('content', t('meta.socialDescription'));
        document.getElementById('twitterTitle').setAttribute('content', t('meta.socialTitle'));
        document.getElementById('twitterDescription').setAttribute('content', t('meta.socialDescription'));
        setText('.brand p', t('common.localConsole'));
        document.querySelectorAll('.advanced-panel summary').forEach((summary) => {
          summary.setAttribute('data-i18n-closed-label', t('labels.show'));
          summary.setAttribute('data-i18n-open-label', t('labels.hide'));
        });
        setText('.nav-section__label', t('common.workspace'), 0);
        setText('.nav-section__label', t('common.messages'), 1);
        setText('.nav-section__label', t('common.networkGroup'), 2);
        setText('[data-tab="overview"] .tab-title', t('pageMeta.overview.title'));
        setText('[data-tab="overview"] .tab-copy', t('labels.overviewTabCopy'));
        setText('[data-tab="agent"] .tab-title', t('pageMeta.agent.title'));
        setText('[data-tab="agent"] .tab-copy', t('labels.agentTabCopy'));
        setText('[data-tab="chat"] .tab-title', t('pageMeta.chat.title'));
        setText('[data-tab="chat"] .tab-copy', t('labels.chatTabCopy'));
        setText('[data-tab="private"] .tab-title', t('pageMeta.private.title'));
        setText('[data-tab="private"] .tab-copy', t('labels.privateTabCopy'));
        setText('[data-tab="skills"] .tab-title', t('pageMeta.skills.title'));
        setText('[data-tab="skills"] .tab-copy', t('labels.skillsTabCopy'));
        setText('[data-tab="profile"] .tab-title', t('pageMeta.profile.title'));
        setText('[data-tab="profile"] .tab-copy', t('labels.profileTabCopy'));
        setText('[data-tab="network"] .tab-title', t('pageMeta.network.title'));
        setText('[data-tab="network"] .tab-copy', t('labels.networkTabCopy'));
        setText('[data-tab="social"] .tab-title', t('pageMeta.social.title'));
        setText('[data-tab="social"] .tab-copy', t('labels.socialTabCopy'));
        document.getElementById('sidebarToggleBtn').title = t('labels.collapseSidebar');
        document.getElementById('sidebarToggleBtn').setAttribute('aria-label', t('labels.collapseSidebar'));
        document.querySelector('.sidebar-version').title = t('common.version');
        setText('.sidebar-version__label', t('common.version'));
        document.getElementById('brandUpdateHint').textContent = t('labels.versionChecking');
        document.getElementById('brandRelayHint').textContent = t('labels.relayQueuesHealthy');
        document.getElementById('brandCheckUpdateBtn').textContent = t('actions.checkUpdate');
        document.getElementById('brandUpdateBtn').textContent = t('actions.updateNow');
        document.getElementById('integrationStatusBar').textContent = t('social.barStatus', {
          connected: '-',
          mode: '-',
          public: '-',
        });
        setText('.dashboard-header__breadcrumb-current', t('pageMeta.overview.title'));
        document.getElementById('pageBreadcrumb').textContent = t('pageMeta.overview.title');
        document.getElementById('pageHeroTitle').textContent = t('pageMeta.overview.title');
        document.getElementById('pageHeroBody').textContent = t('pageMeta.overview.body');
        document.getElementById('focusModeBtn').title = t('labels.toggleFocusMode');
        document.getElementById('focusModeBtn').setAttribute('aria-label', t('labels.toggleFocusMode'));
        document.getElementById('themeModeGroup').setAttribute('aria-label', t('labels.colorMode'));
        document.querySelector('[data-theme-choice="dark"]').title = t('labels.dark');
        document.querySelector('[data-theme-choice="dark"]').setAttribute('aria-label', `${t('labels.colorMode')}: ${t('labels.dark')}`);
        document.querySelector('[data-theme-choice="light"]').title = t('labels.light');
        document.querySelector('[data-theme-choice="light"]').setAttribute('aria-label', `${t('labels.colorMode')}: ${t('labels.light')}`);
        document.querySelector('[data-theme-choice="system"]').title = t('labels.system');
        document.querySelector('[data-theme-choice="system"]').setAttribute('aria-label', `${t('labels.colorMode')}: ${t('labels.system')}`);
        document.getElementById('agentBannerEyebrow').textContent = t('pageMeta.agent.title');
        document.getElementById('agentBannerTitle').textContent = t('hints.agentBannerTitle');
        document.getElementById('agentBannerBody').textContent = t('hints.agentBannerBody');
        document.getElementById('agentBannerDiscoveryLabel').textContent = t('hints.agentBannerDiscovery');
        document.getElementById('agentBannerSourceLabel').textContent = t('hints.agentBannerSource');
        document.getElementById('agentListTitle').textContent = t('labels.discoveredAgents');
        document.getElementById('agentsCountHint').textContent = t('overview.agentsZero');
        document.getElementById('agentListHint').textContent = t('hints.agentListHint');
        document.getElementById('onlyOnlineToggleLabel').textContent = t('labels.onlyShowOnline');
        document.getElementById('agentSnapshotTitle').textContent = t('labels.nodeSnapshot');
        document.getElementById('chatBannerEyebrow').textContent = t('pageMeta.chat.title');
        document.getElementById('chatBannerTitle').textContent = t('hints.chatBannerTitle');
        document.getElementById('chatBannerBody').textContent = t('hints.chatBannerBody');
        document.getElementById('chatBannerFeedLabel').textContent = t('hints.chatBannerFeed');
        document.getElementById('chatComposerTitle').textContent = t('actions.sendPublicMessage');
        document.getElementById('privateBannerEyebrow').textContent = t('pageMeta.private.title');
        document.getElementById('privateBannerTitle').textContent = t('pageMeta.private.body');
        document.getElementById('privateBannerBody').textContent = t('pageMeta.private.body');
        document.getElementById('privateBannerStateLabel').textContent = t('labels.state');
        document.getElementById('privateConversationsTitle').textContent = t('pageMeta.private.title');
        document.getElementById('privateComposerTitle').textContent = t('actions.sendPrivateMessage');
        document.getElementById('privateTargetLabel').textContent = t('labels.target');
        document.getElementById('privateTargetIdLabel').textContent = t('social.agentId');
        document.getElementById('privateMessageSendBtn').textContent = t('actions.sendPrivateMessage');
        document.getElementById('privateRefreshBtn').textContent = t('actions.refreshPrivate');
        document.getElementById('socialMessagePrevPageBtn').textContent = t('overview.prevPage');
        document.getElementById('socialMessageNextPageBtn').textContent = t('overview.nextPage');
        document.getElementById('privateConversationPrevPageBtn').textContent = t('overview.prevPage');
        document.getElementById('privateConversationNextPageBtn').textContent = t('overview.nextPage');
        document.getElementById('privateMessagePrevPageBtn').textContent = t('overview.prevPage');
        document.getElementById('privateMessageNextPageBtn').textContent = t('overview.nextPage');
        document.getElementById('chatFeedHint').textContent = t('hints.chatFeedHint');
        document.getElementById('overviewGuideTitle').textContent = t('overview.guideTitle');
        document.getElementById('overviewGuideBody').textContent = t('overview.guideBody');
        document.getElementById('overviewGuideStatus').textContent = t('overview.guideNeedSetup');
        document.getElementById('overviewStepProfileEyebrow').textContent = t('overview.stepLabel', { step: '1' });
        document.getElementById('overviewStepProfileTitle').textContent = t('overview.stepProfileTitle');
        document.getElementById('overviewStepProfileBody').textContent = t('overview.stepProfileBody');
        document.getElementById('overviewStepProfileStatus').textContent = t('overview.stepIncomplete');
        document.getElementById('overviewStepProfileBtn').textContent = t('actions.editProfile');
        document.getElementById('overviewStepPublicEyebrow').textContent = t('overview.stepLabel', { step: '2' });
        document.getElementById('overviewStepPublicTitle').textContent = t('overview.stepPublicTitle');
        document.getElementById('overviewStepPublicBody').textContent = t('overview.stepPublicBody');
        document.getElementById('overviewStepPublicStatus').textContent = t('overview.stepIncomplete');
        document.getElementById('overviewStepPublicBtn').textContent = t('actions.editProfile');
        document.getElementById('overviewStepBroadcastEyebrow').textContent = t('overview.stepLabel', { step: '3' });
        document.getElementById('overviewStepBroadcastTitle').textContent = t('overview.stepBroadcastTitle');
        document.getElementById('overviewStepBroadcastBody').textContent = t('overview.stepBroadcastBody');
        document.getElementById('overviewStepBroadcastStatus').textContent = t('overview.stepWaiting');
        document.getElementById('overviewStepBroadcastBtn').textContent = t('actions.broadcastNow');
        document.getElementById('homeMissionEyebrow').textContent = t('hints.homeMissionEyebrow');
        document.getElementById('homeMissionTitle').textContent = t('hints.homeMissionTitle');
        document.getElementById('homeMissionBody').textContent = t('hints.homeMissionBody');
        document.getElementById('homeBriefTitle').textContent = t('hints.homeBriefTitle');
        document.getElementById('homeOpenAgentBtn').textContent = t('actions.openAgent');
        document.getElementById('homeOpenSocialBtn').textContent = t('pageMeta.social.title');
        document.getElementById('homeBroadcastNowBtn').textContent = t('actions.broadcastNow');
        document.getElementById('homeOpenNetworkBtn').textContent = t('actions.openNetwork');
        document.getElementById('overviewSnapshotHint').textContent = t('hints.overviewSnapshotHint');
        document.getElementById('socialMessageTitle').textContent = t('overview.messageTitle');
        document.getElementById('socialMessageHint').textContent = t('overview.messageHint');
        setText('#view-profile .section-header__eyebrow', t('labels.profileEyebrow'));
        document.getElementById('profileBannerTitle').textContent = t('hints.profileBannerTitle');
        document.getElementById('profileBannerBody').textContent = t('hints.profileBannerBody');
        document.getElementById('profileBannerPublishingLabel').textContent = t('hints.profileBannerPublishing');
        document.getElementById('profileBannerPublishingValue').textContent = t('hints.profileBannerPublishingValue');
        setText('#view-profile .title-sm', t('labels.publicProfileEditor'), 0);
        setText('#view-profile label', t('labels.displayName'), 0);
        setText('#view-profile .row > div:nth-child(2) label', t('labels.avatarUrl'));
        setText('#view-profile div > label + textarea', t('labels.bio'));
        setText('#view-profile div > label + input[name="tags"]', t('labels.tagsCommaSeparated'));
        document.querySelector('#view-profile input[name="display_name"]').setAttribute('placeholder', t('placeholders.agentName'));
        document.querySelector('#view-profile input[name="avatar_url"]').setAttribute('placeholder', 'https://...');
        document.querySelector('#view-profile textarea[name="bio"]').setAttribute('placeholder', t('placeholders.bioSummary'));
        document.querySelector('#view-profile input[name="tags"]').setAttribute('placeholder', t('placeholders.tags'));
        document.querySelector('#view-profile input[name="display_name"]').nextElementSibling.textContent = t('hints.discoverabilityRecommendation');
        document.querySelector('#view-profile input[name="avatar_url"]').nextElementSibling.textContent = t('hints.avatarOptional');
        document.querySelector('#view-profile input[name="tags"]').nextElementSibling.textContent = t('hints.tagsLimit');
        document.getElementById('publishLaunchTitle').textContent = t('labels.goPublic');
        document.getElementById('publishLaunchBody').textContent = t('hints.goPublicBody');
        document.getElementById('publishToggleLabel').textContent = t('labels.publicEnabled');
        document.getElementById('publishLaunchHint').textContent = t('hints.publicEnabledHint');
        document.getElementById('profileNextStepTitle').textContent = t('hints.nextStepTitle');
        document.getElementById('profileNextStepBody').textContent = t('hints.nextStepBody');
        document.getElementById('profileNextStepBtn').textContent = t('actions.goToOverview');
        document.getElementById('profileNextStepDismissBtn').textContent = t('actions.dismiss');
        setText('#view-profile .title-sm', t('labels.livePreview'), 1);
        setText('#view-profile .profile-meta h4', t('labels.publicCard'), 0);
        setText('#view-profile .profile-meta h4', t('labels.publishStatus'), 1);
        setText('#view-profile .profile-meta h4', t('labels.publicProfilePreview'), 2);
        setText('#view-profile .profile-meta .field-hint', t('hints.signedPublicProfileHint'), 1);
        setText('#view-network .section-header__eyebrow', t('labels.networkEyebrow'));
        document.getElementById('networkBannerTitle').textContent = t('hints.networkBannerTitle');
        document.getElementById('networkBannerBody').textContent = t('hints.networkBannerBody');
        document.getElementById('networkBannerPurposeLabel').textContent = t('hints.networkBannerPurpose');
        document.getElementById('networkBannerPurposeValue').textContent = t('hints.networkBannerPurposeValue');
        document.getElementById('networkConnectionTitle').textContent = t('labels.connectionSummary');
        document.getElementById('networkQuickActionsTitle').textContent = t('labels.quickActions');
        setText('#view-network .network-actions-card .field-hint', t('hints.useTheseFirst'));
        document.getElementById('networkBroadcastHint').textContent = t('hints.broadcastControlHint');
        document.getElementById('networkAdvancedActionsSummary').textContent = t('labels.advancedActions');
        document.getElementById('networkDiagnosticsSummary').textContent = t('labels.diagnostics');
        document.getElementById('networkRuntimeComponentsTitle').textContent = t('labels.runtimeComponents');
        document.getElementById('networkPeerInventoryTitle').textContent = t('labels.peerInventory');
        document.getElementById('networkPeerDiscoveryStatsTitle').textContent = t('labels.peerDiscoveryStats');
        document.getElementById('networkRecentDiscoveryEventsTitle').textContent = t('labels.recentDiscoveryEvents');
        document.getElementById('networkDiscoverySnapshotTitle').textContent = t('labels.discoverySnapshot');
        document.getElementById('networkLogsTitle').textContent = t('labels.logs');
        setText('#view-network label[for="logLevelFilter"]', t('labels.category'));
        document.querySelector('#logLevelFilter option[value="all"]').textContent = t('labels.all');
        document.querySelector('#logLevelFilter option[value="info"]').textContent = t('labels.info');
        document.querySelector('#logLevelFilter option[value="warn"]').textContent = t('labels.warn');
        document.querySelector('#logLevelFilter option[value="error"]').textContent = t('labels.error');
        document.getElementById('networkConfigSnapshotTitle').textContent = t('labels.configSnapshot');
        document.getElementById('networkStatsSnapshotTitle').textContent = t('labels.statsSnapshot');
        setText('#view-social .section-header__eyebrow', t('labels.socialEyebrow'));
        document.getElementById('socialBannerTitle').textContent = t('hints.socialBannerTitle');
        document.getElementById('socialBannerBody').textContent = t('hints.socialBannerBody');
        document.getElementById('socialBannerOpenClawLabel').textContent = t('hints.socialBannerOpenClaw');
        document.getElementById('socialBannerOpenClawValue').textContent = t('hints.socialBannerOpenClawValue');
        document.getElementById('skillsBannerEyebrow').textContent = t('labels.skillsEyebrow');
        document.getElementById('skillsBannerTitle').textContent = t('hints.skillsBannerTitle');
        document.getElementById('skillsBannerBody').textContent = t('hints.skillsBannerBody');
        document.getElementById('skillsBannerRuntimeLabel').textContent = t('hints.skillsBannerRuntime');
        document.getElementById('skillsBannerRuntimeValue').textContent = t('hints.skillsRuntimeChecking');
        document.getElementById('skillsActionEyebrow').textContent = t('labels.skillsRecommendedAction');
        document.getElementById('skillsActionTitle').textContent = t('hints.skillsActionInstallTitle');
        document.getElementById('skillsActionBody').textContent = t('hints.skillsActionInstallBody');
        document.getElementById('skillsActionState').textContent = t('labels.skillsStateReady');
        document.getElementById('skillsJumpEyebrow').textContent = t('labels.skillsBrowseAreas');
        document.getElementById('skillsJumpTitle').textContent = t('hints.skillsJumpTitle');
        document.getElementById('skillsJumpFeatured').textContent = t('labels.skillsFeatured');
        document.getElementById('skillsJumpBundled').textContent = t('labels.skillsBundled');
        document.getElementById('skillsJumpInstalled').textContent = t('labels.skillsInstalled');
        document.getElementById('skillsJumpDialogue').textContent = t('labels.skillsDialogue');
        document.getElementById('skillsSearchLabel').textContent = t('labels.skillsSearch');
        document.getElementById('skillsSearchInput').placeholder = t('placeholders.skillsSearch');
        document.getElementById('skillsFilterAll').textContent = t('labels.skillsFilterAll');
        document.getElementById('skillsFilterAttention').textContent = t('labels.skillsFilterAttention');
        document.getElementById('skillsFilterUpdates').textContent = t('labels.skillsFilterUpdates');
        document.getElementById('skillsFilterInstalled').textContent = t('labels.skillsFilterInstalled');
        document.getElementById('skillsFilterMeta').textContent = t('hints.skillsFilterMeta', {
          count: '0',
          filter: t('labels.skillsFilterAll'),
        });
        document.getElementById('skillsFeaturedTitle').textContent = t('labels.skillsFeatured');
        document.getElementById('skillsFeaturedHint').textContent = t('hints.skillsFeaturedHint');
        document.getElementById('skillsBundledTitle').textContent = t('labels.skillsBundled');
        document.getElementById('skillsBundledHint').textContent = t('hints.skillsBundledHint');
        document.getElementById('skillsDialogueTitle').textContent = t('labels.skillsDialogue');
        document.getElementById('skillsDialogueHint').textContent = t('hints.skillsDialogueHint');
        document.getElementById('skillsInstalledTitle').textContent = t('labels.skillsInstalled');
        document.getElementById('skillsInstalledHint').textContent = t('hints.skillsInstalledHint');
        document.getElementById('skillsInstallBtn').textContent = t('actions.installSilicaClawSkills');
        document.getElementById('socialIntegrationTitle').textContent = t('labels.integrationStatus');
        document.querySelector('#socialStatusLine').textContent = t('hints.checkingIntegration');
        document.getElementById('socialRuntimeSummaryTitle').textContent = t('labels.whatIsActive');
        document.getElementById('socialBridgeTitle').textContent = t('labels.identityBinding');
        document.getElementById('socialCapabilityTitle').textContent = t('labels.ownerCommunicationCapabilities');
        document.getElementById('socialCapabilityHint').textContent = t('hints.ownerCommunicationCapabilitiesHint');
        document.getElementById('socialOwnerDeliveryTitle').textContent = t('labels.ownerDelivery');
        document.getElementById('socialSkillLearningTitle').textContent = t('labels.openclawSkillLearning');
        document.getElementById('socialMessagePathTitle').textContent = t('labels.messagePath');
        document.getElementById('socialMessagePathHint').textContent = t('hints.socialMessagePathHint');
        document.getElementById('socialOwnerDeliveryStatus').textContent = t('hints.checkingOwnerDelivery');
        document.getElementById('socialGovernanceTitle').textContent = t('labels.messageGovernance');
        document.getElementById('socialModerationTitle').textContent = t('labels.recentModeration');
        document.getElementById('socialAdvancedSummary').textContent = t('labels.advancedNetworkDetails');
        document.getElementById('socialSourceRuntimeSummary').textContent = t('labels.sourceRuntimeTemplate');
        document.getElementById('socialSourceParsedTitle').textContent = t('labels.sourceParsedFrontmatter');
        document.getElementById('socialRuntimeSummaryInnerTitle').textContent = t('labels.runtimeSummary');
        document.getElementById('socialTemplatePreviewTitle').textContent = t('labels.exportTemplatePreview');
        document.getElementById('socialActionsTitle').textContent = t('labels.actionsTitle');
        setText('label[for="socialModeSelect"]', t('labels.networkModeRuntime'));
        renderSocialModeHint('-', '-', false, false);
        setSocialModePendingState(false);
        document.getElementById('socialProfileVisibilityHint').textContent = t('hints.profileVisibilityManaged');
        document.getElementById('socialGovernanceHint').textContent = t('hints.messageGovernanceHint');
        document.getElementById('openclawSkillHint').textContent = t('hints.openclawSkillHint');
        document.getElementById('openclawSkillInstallBtn').textContent = t('actions.learnOpenClawSkill');
        setText('.hero-meta-item .label', t('labels.mode'), 0);
        setText('.hero-meta-item .label', t('labels.adapter'), 1);
        setText('.hero-meta-item .label', t('labels.relay'), 2);
        setText('.hero-meta-item .label', t('labels.room'), 3);
        document.getElementById('publicDiscoveryHint').innerHTML = t('hints.publicDiscoverySwitch');
        document.getElementById('clearDiscoveryCacheBtn').textContent = t('actions.clearDiscoveryCache');
        document.getElementById('overviewModeHint').textContent = t('overview.modeCurrentSource', {
          mode: '-',
          hint: t('overview.modeCacheHint'),
        });
        document.getElementById('socialMessageTitle').textContent = t('overview.messageTitle');
        document.getElementById('socialMessageMeta').textContent = t('overview.messageMetaInitial');
        document.getElementById('socialMessageHint').textContent = t('overview.messageHint');
        document.getElementById('socialMessageInput').placeholder = t('actions.sendPublicMessage');
        document.getElementById('socialMessageSendBtn').textContent = t('actions.sendPublicMessage');
        document.getElementById('socialMessageRefreshBtn').textContent = t('actions.refreshInbox');
        document.getElementById('saveGovernanceBtn').textContent = t('actions.saveGovernance');
        document.getElementById('socialMessageTopicLabel').textContent = t('overview.messageTopicLabel');
        document.getElementById('socialMessageFilterLabel').textContent = t('overview.messageFilterLabel');
        document.querySelector('#socialMessageTopicSelect option[value="global"]').textContent = t('labels.globalTopic');
        document.querySelector('#socialMessageFilterSelect option[value="all"]').textContent = t('overview.messageFilterAll');
        document.querySelector('#socialMessageFilterSelect option[value="self"]').textContent = t('overview.messageFilterSelf');
        document.querySelector('#socialMessageFilterSelect option[value="remote"]').textContent = t('overview.messageFilterRemote');
        document.querySelector('label[for="governanceSendLimitInput"]').textContent = t('labels.sendLimit');
        document.querySelector('label[for="governanceSendWindowInput"]').textContent = t('labels.sendWindowSeconds');
        document.querySelector('label[for="governanceReceiveLimitInput"]').textContent = t('labels.receiveLimit');
        document.querySelector('label[for="governanceReceiveWindowInput"]').textContent = t('labels.receiveWindowSeconds');
        document.querySelector('label[for="governanceDuplicateWindowInput"]').textContent = t('labels.duplicateWindowSeconds');
        document.querySelector('label[for="governanceBlockedAgentsInput"]').textContent = t('labels.blockedAgentIds');
        document.querySelector('label[for="governanceBlockedTermsInput"]').textContent = t('labels.blockedTerms');
        document.getElementById('startBroadcastBtn').textContent = t('actions.startBroadcast');
        document.getElementById('stopBroadcastBtn').textContent = t('actions.stopBroadcast');
        document.getElementById('broadcastNowBtn').textContent = t('actions.broadcastNow');
        document.getElementById('quickGlobalPreviewBtn').textContent = t('actions.enablePreview');
        document.getElementById('refreshLogsBtn').textContent = t('actions.refreshLogs');
        document.getElementById('socialExportBtn').textContent = t('actions.exportTemplate');
        document.getElementById('socialCopyBtn').textContent = t('actions.copyTemplate');
        document.getElementById('socialDownloadBtn').textContent = t('actions.downloadTemplate');
        document.getElementById('socialModeApplyBtn').textContent = t('actions.applyRuntimeMode');
        document.querySelector('#socialModeSelect option[value="local"]').textContent = t('labels.modeLocalOption');
        document.querySelector('#socialModeSelect option[value="lan"]').textContent = t('labels.modeLanOption');
        document.querySelector('#socialModeSelect option[value="global-preview"]').textContent = t('labels.modeGlobalPreviewOption');
        document.getElementById('copyPublicProfilePreviewBtn').textContent = t('actions.copyPublicProfilePreview');
        document.getElementById('saveProfileBtn').textContent = t('actions.saveProfile');
        document.getElementById('refreshProfileBtn').textContent = t('common.reload');
        document.getElementById('profileFeedback').textContent = t('common.ready');
        document.getElementById('networkFeedback').textContent = t('common.ready');
        document.getElementById('socialFeedback').textContent = t('common.ready');
        document.getElementById('socialGovernanceFeedback').textContent = t('common.ready');
        document.getElementById('openclawSkillFeedback').textContent = t('common.ready');
        document.getElementById('socialMessageFeedback').textContent = t('common.ready');
      }
      const shell = createShellController({ resolveThemeMode, t });
      const {
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
      } = shell;
      let appUpdatePollTimer = null;
      let appUpdateCheckInFlight = false;
      let relayQueueCheckInFlight = false;
      let lastRelayQueueCheckAt = 0;

      function setAppUpdateUi({
        hint,
        buttonVisible = false,
        buttonDisabled = false,
        buttonText = t('actions.updateNow'),
        checkVisible = false,
        checkDisabled = false,
      }) {
        const hintEl = document.getElementById('brandUpdateHint');
        const buttonEl = document.getElementById('brandUpdateBtn');
        const checkEl = document.getElementById('brandCheckUpdateBtn');
        if (hintEl) {
          hintEl.textContent = hint;
          hintEl.classList.toggle('hidden', !hint);
        }
        if (checkEl) {
          checkEl.textContent = t('actions.checkUpdate');
          checkEl.classList.toggle('hidden', !checkVisible);
          checkEl.disabled = checkDisabled;
        }
        if (buttonEl) {
          buttonEl.textContent = buttonText;
          buttonEl.classList.toggle('hidden', !buttonVisible);
          buttonEl.disabled = buttonDisabled;
        }
      }

      function platformUpdateHint(platform) {
        if (platform === 'darwin') return t('labels.versionPlatformMac');
        if (platform === 'linux') return t('labels.versionPlatformLinux');
        return t('labels.versionPlatformOther');
      }

      function setRelayQueueUi({ hint = '', tone = 'ok', visible = false }) {
        const hintEl = document.getElementById('brandRelayHint');
        if (!hintEl) return;
        hintEl.textContent = hint;
        hintEl.classList.toggle('hidden', !visible || !hint);
        hintEl.classList.remove('warn', 'danger');
        if (tone === 'warn' || tone === 'danger') {
          hintEl.classList.add(tone);
        }
      }

      async function refreshRelayQueueStatus({ force = false } = {}) {
        const now = Date.now();
        if (relayQueueCheckInFlight) return null;
        if (!force && now - lastRelayQueueCheckAt < 15_000) return null;
        relayQueueCheckInFlight = true;
        try {
          const result = await api('/api/peers');
          const peers = result.data || {};
          const peerItems = Array.isArray(peers.items) ? peers.items : [];
          const relayQueueMax = peerItems.reduce((max, peer) => Math.max(max, Number(peer?.meta?.relay_queue_size || 0)), 0);
          const signalQueueMax = peerItems.reduce((max, peer) => Math.max(max, Number(peer?.meta?.signal_queue_size || 0)), 0);
          const queueMax = Math.max(relayQueueMax, signalQueueMax);
          if (queueMax >= 100) {
            setRelayQueueUi({ hint: t('labels.relayQueuesHigh'), tone: 'danger', visible: true });
          } else if (queueMax >= 20) {
            setRelayQueueUi({ hint: t('labels.relayQueuesWatch'), tone: 'warn', visible: true });
          } else {
            setRelayQueueUi({ hint: t('labels.relayQueuesHealthy'), tone: 'ok', visible: true });
          }
          lastRelayQueueCheckAt = now;
          return { relayQueueMax, signalQueueMax };
        } catch (_error) {
          return null;
        } finally {
          relayQueueCheckInFlight = false;
        }
      }

      async function refreshAppUpdateStatus({ silent = false } = {}) {
        if (appUpdateCheckInFlight) return null;
        appUpdateCheckInFlight = true;
        try {
          const result = await api('/api/app/update-status');
          const status = result.data || {};
          const currentVersion = String(status.current_version || '').trim();
          const latestVersion = String(status.latest_version || '').trim();
          const platformHint = platformUpdateHint(String(status.platform || ''));
          if (currentVersion) {
            document.getElementById('brandVersion').textContent = currentVersion.startsWith('v') ? currentVersion : `v${currentVersion}`;
          }
          if (status.update_available && status.latest_version) {
            setAppUpdateUi({
              hint: `${t('labels.versionUpdateReady', { version: `v${status.latest_version}` })} · ${platformHint}`,
              buttonVisible: true,
              buttonDisabled: false,
              buttonText: t('actions.updateNowVersion', { version: latestVersion.startsWith('v') ? latestVersion : `v${latestVersion}` }),
              checkVisible: true,
              checkDisabled: false,
            });
          } else if (status.check_error) {
            setAppUpdateUi({
              hint: t('labels.versionCheckFailed'),
              buttonVisible: false,
              buttonDisabled: false,
              buttonText: t('actions.updateNow'),
              checkVisible: true,
              checkDisabled: false,
            });
            if (!silent) {
              setFeedback('networkFeedback', t('feedback.appUpdateCheckFailed'), 'warn');
            }
          } else {
            setAppUpdateUi({
              hint: `${t('labels.versionCurrent')} · ${platformHint}`,
              buttonVisible: false,
              buttonDisabled: false,
              buttonText: t('actions.updateNow'),
              checkVisible: true,
              checkDisabled: false,
            });
          }
          return status;
        } catch (_error) {
          setAppUpdateUi({
            hint: t('labels.versionCheckFailed'),
            buttonVisible: false,
            buttonDisabled: false,
            buttonText: t('actions.updateNow'),
            checkVisible: true,
            checkDisabled: false,
          });
          if (!silent) {
            setFeedback('networkFeedback', t('feedback.appUpdateCheckFailed'), 'warn');
          }
          return null;
        } finally {
          appUpdateCheckInFlight = false;
        }
      }

      function startAppUpdatePolling(targetVersion) {
        if (appUpdatePollTimer) {
          window.clearInterval(appUpdatePollTimer);
        }
        let attempts = 0;
        appUpdatePollTimer = window.setInterval(async () => {
          attempts += 1;
          const status = await refreshAppUpdateStatus({ silent: true });
          if (status && !status.update_available && String(status.current_version || '') === String(targetVersion || '')) {
            window.clearInterval(appUpdatePollTimer);
            appUpdatePollTimer = null;
            if (targetVersion) {
              window.sessionStorage.setItem(APP_UPDATE_SESSION_KEY, String(targetVersion));
            }
            window.location.reload();
            return;
          }
          if (attempts >= 24) {
            window.clearInterval(appUpdatePollTimer);
            appUpdatePollTimer = null;
            setAppUpdateUi({
              hint: t('labels.versionCurrent'),
              buttonVisible: false,
              buttonDisabled: false,
              buttonText: t('actions.updateNow'),
              checkVisible: true,
              checkDisabled: false,
            });
          }
        }, 5000);
      }

      async function triggerAppUpdate() {
        const buttonEl = document.getElementById('brandUpdateBtn');
        setAppUpdateUi({
          hint: t('labels.versionUpdating'),
          buttonVisible: true,
          buttonDisabled: true,
          buttonText: t('labels.versionUpdating'),
          checkVisible: true,
          checkDisabled: true,
        });
        try {
          const result = await api('/api/app/update', { method: 'POST' });
          const data = result.data || {};
          if (!data.started) {
            setAppUpdateUi({
              hint: t('labels.versionCurrent'),
              buttonVisible: false,
              buttonDisabled: false,
              buttonText: t('actions.updateNow'),
              checkVisible: true,
              checkDisabled: false,
            });
            toast(t('feedback.appUpdateLatest'));
            return;
          }
          toast(t('feedback.appUpdateStarted'));
          startAppUpdatePolling(String(data.target_version || ''));
        } catch (error) {
          setAppUpdateUi({
            hint: t('labels.versionCheckFailed'),
            buttonVisible: true,
            buttonDisabled: false,
            buttonText: t('actions.updateNow'),
            checkVisible: true,
            checkDisabled: false,
          });
          setFeedback('networkFeedback', error instanceof Error ? error.message : t('feedback.appUpdateFailed'), 'error');
        }
      }
      setLocale(currentLocale);
      applyStaticTranslations();

      let activeTab = 'overview';
      let logsCache = [];
      let socialMessagesCache = [];
      let socialMessagePage = 1;
      let logLevelFilter = 'all';
      let socialTemplate = '';
      let socialModeDirty = false;
      let socialModePending = '';
      let visibleRemotePublicCount = 0;
      let socialMessageFilter = 'all';
      let socialMessageGovernance = null;
      let privateState = null;
      let privateConversations = [];
      let privateMessages = [];
      let privateConversationPage = 1;
      const PRIVATE_CONVERSATION_PAGE_SIZE = 12;
      let privateMessagesTotal = 0;
      let privateMessagePage = 1;
      const PRIVATE_MESSAGE_PAGE_SIZE = 20;
      let privateTarget = null;
      let selectedPrivateConversationId = '';
      let overviewMode = 'lan';
      let onlyShowOnline = false;
      let agentsPage = 1;
      const AGENTS_PAGE_SIZE = 10;
      const pageMeta = TRANSLATIONS[currentLocale].pageMeta || TRANSLATIONS[DEFAULT_LOCALE].pageMeta;

      function loadPagingState() {
        try {
          const raw = localStorage.getItem(PAGING_STATE_STORAGE_KEY);
          if (!raw) return null;
          return JSON.parse(raw);
        } catch {
          return null;
        }
      }

      function savePagingState() {
        try {
          localStorage.setItem(PAGING_STATE_STORAGE_KEY, JSON.stringify({
            socialMessagePage,
            privateConversationPage,
            privateMessagePage,
            selectedPrivateConversationId,
          }));
        } catch {
          // ignore localStorage failures
        }
      }

      async function api(path, options = {}) {
        const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json || !json.ok) {
          throw new Error(json?.error?.message || t('common.requestFailed', { status: String(res.status) }));
        }
        return json;
      }

      const profileController = createProfileController({
        api,
        field,
        normalizeTagsInput,
        parseTags,
        setFeedback,
        setProfileNextStepVisible,
        t,
        toast,
        toPrettyJson,
      });
      const refreshProfile = profileController.refreshProfile;
      const refreshPublicProfilePreview = profileController.refreshPublicProfilePreview;
      const overviewController = createOverviewController({
        ago,
        api,
        describeCurrentMode,
        escapeHtml,
        shortId,
        t,
        writeUiCache,
      });
      const networkController = createNetworkController({
        ago,
        api,
        describeCurrentMode,
        peerStatusText,
        shortId,
        t,
        toPrettyJson,
        writeUiCache,
      });
      const socialController = createSocialController({
        api,
        escapeHtml,
        formatMessageBody,
        getActiveTab: () => activeTab,
        getLogLevelFilter: () => logLevelFilter,
        getLogsCache: () => logsCache,
        getSocialMessageFilter: () => socialMessageFilter,
        getSocialMessageGovernance: () => socialMessageGovernance,
        getSocialMessagesCache: () => socialMessagesCache,
        getSocialModeDirty: () => socialModeDirty,
        getSocialModePending: () => socialModePending,
        getSocialTemplate: () => socialTemplate,
        getVisibleRemotePublicCount: () => visibleRemotePublicCount,
        renderSocialModeHint,
        setLogLevelFilter: (value) => { logLevelFilter = value; },
        setLogsCache: (value) => { logsCache = value; },
        setSocialMessageGovernance: (value) => { socialMessageGovernance = value; },
        setSocialMessagesCache: (value) => { socialMessagesCache = value; },
        setSocialModePendingState,
        setSocialTemplate: (value) => { socialTemplate = value; },
        shortId,
        t,
        toPrettyJson,
        writeUiCache,
      });

      function switchTab(tab) {
        if (activeTab === 'profile' && tab !== 'profile' && profileController.isDirty() && !profileController.isSaving()) {
          const ok = window.confirm(t('validation.leaveConfirm'));
          if (!ok) {
            return;
          }
        }
        activeTab = tab;
        document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
        ['overview', 'agent', 'chat', 'private', 'skills', 'profile', 'network', 'social'].forEach((k) => {
          document.getElementById(`view-${k}`).classList.toggle('active', k === tab);
        });
        const meta = pageMeta[tab] || pageMeta.overview;
        document.getElementById('pageBreadcrumb').textContent = meta.title;
        document.getElementById('pageHeroTitle').textContent = meta.title;
        document.getElementById('pageHeroBody').textContent = meta.body;
        document.getElementById('integrationStatusBar')?.classList.toggle('hidden', tab !== 'overview');
        document.querySelector('.page-hero')?.classList.toggle('hidden', tab !== 'overview');
        document.getElementById('publicDiscoveryHint')?.classList.toggle('hidden', tab !== 'overview');
        if (tab === 'profile' && !profileController.isDirty() && !profileController.isSaving()) {
          refreshProfile().catch(() => {});
        } else if (tab === 'overview') {
          refreshOverview().catch(() => {});
          refreshMessages().catch(() => {});
        } else if (tab === 'agent') {
          refreshOverview().catch(() => {});
        } else if (tab === 'chat') {
          refreshMessages().catch(() => {});
        } else if (tab === 'private') {
          refreshPrivate().catch(() => {});
        } else if (tab === 'skills') {
          refreshSkills().catch(() => {});
        } else if (tab === 'network') {
          refreshNetwork().catch(() => {});
          refreshPeers().catch(() => {});
          refreshDiscovery().catch(() => {});
          refreshLogs().catch(() => {});
        } else if (tab === 'social') {
          refreshSocial().catch(() => {});
          refreshMessages().catch(() => {});
        }
      }

      async function refreshOverview() {
        await overviewController.refreshOverview({
          getAgentsPage: () => agentsPage,
          getOnlyShowOnline: () => onlyShowOnline,
          onPageChange: (page) => { agentsPage = page; },
          setOverviewMode: (mode) => { overviewMode = mode; },
          setVisibleRemotePublicCount: (count) => { visibleRemotePublicCount = count; },
        });
      }

      function renderPrivate() {
        const privateDeliveryLabel = (status) => {
          if (status === 'direct-sent') return 'Direct';
          if (status === 'fallback-sent') return 'Fallback';
          if (status === 'received') return 'Received';
          if (status === 'read') return 'Read';
          return 'Sent';
        };
        document.getElementById('privateStateMeta').textContent = privateState?.enabled
          ? `${privateConversations.length} conversation(s)`
          : 'Private messaging unavailable';
        document.getElementById('privateTargetName').value = privateTarget?.display_name || '';
        document.getElementById('privateTargetAgentId').value = privateTarget?.agent_id || '';
        const conversationTotalPages = Math.max(1, Math.ceil((privateConversations.length || 0) / PRIVATE_CONVERSATION_PAGE_SIZE));
        const conversationCurrentPage = Math.min(privateConversationPage, conversationTotalPages);
        const conversationOffset = Math.max(0, (conversationCurrentPage - 1) * PRIVATE_CONVERSATION_PAGE_SIZE);
        const visibleConversations = privateConversations.slice(conversationOffset, conversationOffset + PRIVATE_CONVERSATION_PAGE_SIZE);
        document.getElementById('privateConversationList').innerHTML = visibleConversations.length
          ? visibleConversations.map((item) => `
              <button class="agent-card" type="button" data-private-conversation="${escapeHtml(item.conversation_id)}">
                <div class="agent-card__avatar-fallback">${escapeHtml(((item.peer_display_name || item.peer_agent_id || '?')[0] || '?').toUpperCase())}</div>
                <div class="agent-card__main">
                  <div class="agent-card__row">
                    <div class="agent-card__name">${escapeHtml(item.peer_display_name || item.peer_agent_id || 'Unknown')}</div>
                    <div class="agent-card__id mono">${escapeHtml(shortId(item.peer_agent_id || ''))}</div>
                  </div>
                </div>
              </button>
            `).join('')
          : `<div class="empty-state">No private conversations yet.</div>`;
        document.getElementById('privateConversationPageMeta').textContent = t('overview.pageStatus', {
          page: String(conversationCurrentPage),
          total: String(conversationTotalPages),
        });
        document.getElementById('privateConversationPrevPageBtn').disabled = conversationCurrentPage <= 1;
        document.getElementById('privateConversationNextPageBtn').disabled = conversationCurrentPage >= conversationTotalPages;
        document.getElementById('privateMessageList').innerHTML = privateMessages.length
          ? privateMessages.map((item) => `
              <div class="log-item">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
                  <div>
                    <strong>${item.is_self ? 'Me' : escapeHtml(privateTarget?.display_name || item.from_agent_id || 'Unknown')}</strong>
                    <span class="tag-chip" style="margin-left:8px;">${escapeHtml(privateDeliveryLabel(item.delivery_status))}</span>
                  </div>
                  <div class="mono" style="color:#90a2c3;">${new Date(item.created_at).toLocaleString()}</div>
                </div>
                <div style="margin-top:8px; line-height:1.6;">${formatMessageBody(item.body || '')}</div>
              </div>
            `).join('')
          : `<div class="empty-state">No private messages yet.</div>`;
        const totalPages = Math.max(1, Math.ceil((privateMessagesTotal || 0) / PRIVATE_MESSAGE_PAGE_SIZE));
        const currentPage = Math.min(privateMessagePage, totalPages);
        document.getElementById('privateMessagePageMeta').textContent = t('overview.pageStatus', {
          page: String(currentPage),
          total: String(totalPages),
        });
        document.getElementById('privateMessagePrevPageBtn').disabled = currentPage <= 1;
        document.getElementById('privateMessageNextPageBtn').disabled = currentPage >= totalPages;
      }

      async function refreshPrivate() {
        const [stateRes, conversationsRes] = await Promise.all([
          api('/api/private/state'),
          api('/api/private/conversations'),
        ]);
        privateState = stateRes.data || null;
        privateConversations = Array.isArray(conversationsRes.data) ? conversationsRes.data : [];
        const conversationTotalPages = Math.max(1, Math.ceil((privateConversations.length || 0) / PRIVATE_CONVERSATION_PAGE_SIZE));
        privateConversationPage = Math.min(privateConversationPage, conversationTotalPages);
        if ((!privateTarget || privateTarget.agent_id === privateState?.agent_id) && privateConversations[0]) {
          const first = privateConversations[0];
          privateTarget = {
            agent_id: first.peer_agent_id,
            display_name: first.peer_display_name,
            private_encryption_public_key: first.peer_public_key,
          };
          selectedPrivateConversationId = first.conversation_id;
        }
        const selectedConversation = privateConversations.find((item) => item.conversation_id === selectedPrivateConversationId);
        if (selectedConversation) {
          privateTarget = {
            agent_id: selectedConversation.peer_agent_id,
            display_name: selectedConversation.peer_display_name,
            private_encryption_public_key: selectedConversation.peer_public_key,
          };
        }
        if (selectedPrivateConversationId) {
          const offset = Math.max(0, (privateMessagePage - 1) * PRIVATE_MESSAGE_PAGE_SIZE);
          const messageRes = await api(`/api/private/messages?conversation_id=${encodeURIComponent(selectedPrivateConversationId)}&limit=${PRIVATE_MESSAGE_PAGE_SIZE}&offset=${offset}`);
          privateMessages = Array.isArray(messageRes.data?.items) ? messageRes.data.items : [];
          privateMessagesTotal = Number(messageRes.data?.total || 0);
        } else {
          privateMessages = [];
          privateMessagesTotal = 0;
        }
        renderPrivate();
      }

      const renderSocialMessages = socialController.renderSocialMessages;
      const refreshMessages = socialController.refreshMessages;
      const nextSocialMessagesPage = socialController.nextSocialMessagesPage;
      const prevSocialMessagesPage = socialController.prevSocialMessagesPage;
      const setSocialMessagesPage = socialController.setSocialMessagesPage;

      const refreshNetwork = networkController.refreshNetwork;
      const refreshPeers = networkController.refreshPeers;
      const refreshDiscovery = networkController.refreshDiscovery;
      const getQuickConnectDefaults = networkController.getQuickConnectDefaults;

      const refreshSocial = socialController.refreshSocial;
      const exportSocialTemplate = socialController.exportSocialTemplate;
      const renderLogs = socialController.renderLogs;
      const refreshLogs = socialController.refreshLogs;
      const refreshSkills = socialController.refreshSkills;
      let autoRefreshInFlight = false;

      async function refreshActiveView() {
        const tasks = [refreshPublicProfilePreview(), refreshRelayQueueStatus()];
        if (activeTab === 'overview') {
          tasks.push(refreshOverview(), refreshMessages());
        } else if (activeTab === 'agent') {
          tasks.push(refreshOverview());
        } else if (activeTab === 'chat') {
          tasks.push(refreshMessages());
        } else if (activeTab === 'private') {
          tasks.push(refreshPrivate());
        } else if (activeTab === 'skills') {
          tasks.push(refreshSkills());
        } else if (activeTab === 'network') {
          tasks.push(refreshNetwork(), refreshPeers(), refreshDiscovery(), refreshLogs());
        } else if (activeTab === 'social') {
          tasks.push(refreshSocial(), refreshMessages());
        } else if (activeTab === 'profile' && !profileController.isDirty() && !profileController.isSaving()) {
          tasks.push(refreshProfile());
        }
        const results = await Promise.allSettled(tasks);
        const firstError = results.find((result) => result.status === 'rejected');
        if (firstError && firstError.status === 'rejected') {
          setFeedback('networkFeedback', firstError.reason instanceof Error ? firstError.reason.message : t('common.unknownError'), 'error');
        }
      }

      async function refreshAuto() {
        if (document.hidden || autoRefreshInFlight) {
          return;
        }
        autoRefreshInFlight = true;
        try {
          await refreshActiveView();
        } finally {
          autoRefreshInFlight = false;
        }
      }

      async function refreshAll() {
        await refreshActiveView();
      }

      bindAppEvents({
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
        setOnlyShowOnline: (value) => { onlyShowOnline = value; },
        setProfileNextStepVisible,
        setSocialMessageFilter: (value) => { socialMessageFilter = value; },
        setSocialModeDirty: (value) => { socialModeDirty = value; },
        setSocialModePending: (value) => { socialModePending = value; },
        setSocialModePendingState,
        shouldWarnBeforeUnload: () => (profileController.isDirty() && !profileController.isSaving()) || socialModeDirty,
        socialController,
        switchTab,
        t,
        toast,
        getSocialTemplate: () => socialTemplate,
        getQuickConnectDefaults,
        setAgentsPage: (value) => { agentsPage = value; },
        getSocialMessagesCache: () => socialMessagesCache,
        toPrettyJson,
      });

      document.getElementById('agentsWrap').addEventListener('click', (event) => {
        const button = event.target?.closest?.('[data-private-agent]');
        if (!button) return;
        privateTarget = {
          agent_id: String(button.getAttribute('data-private-agent') || ''),
          display_name: String(button.getAttribute('data-private-name') || ''),
          private_encryption_public_key: String(button.getAttribute('data-private-key') || ''),
        };
        privateConversationPage = 1;
        privateMessagePage = 1;
        savePagingState();
        selectedPrivateConversationId = [privateState?.agent_id || '', privateTarget.agent_id].sort().join(':');
        switchTab('private');
      });

      document.getElementById('privateConversationList').addEventListener('click', async (event) => {
        const button = event.target?.closest?.('[data-private-conversation]');
        if (!button) return;
        selectedPrivateConversationId = String(button.getAttribute('data-private-conversation') || '');
        const selectedConversation = privateConversations.find((item) => item.conversation_id === selectedPrivateConversationId);
        if (selectedConversation) {
          privateTarget = {
            agent_id: selectedConversation.peer_agent_id,
            display_name: selectedConversation.peer_display_name,
            private_encryption_public_key: selectedConversation.peer_public_key,
          };
        }
        privateMessagePage = 1;
        savePagingState();
        await refreshPrivate();
      });

      document.getElementById('privateRefreshBtn').addEventListener('click', async () => {
        await refreshPrivate();
      });

      document.getElementById('privateConversationPrevPageBtn').addEventListener('click', async () => {
        if (privateConversationPage <= 1) return;
        privateConversationPage -= 1;
        savePagingState();
        renderPrivate();
      });

      document.getElementById('privateConversationNextPageBtn').addEventListener('click', async () => {
        const totalPages = Math.max(1, Math.ceil((privateConversations.length || 0) / PRIVATE_CONVERSATION_PAGE_SIZE));
        if (privateConversationPage >= totalPages) return;
        privateConversationPage += 1;
        savePagingState();
        renderPrivate();
      });

      document.getElementById('privateMessagePrevPageBtn').addEventListener('click', async () => {
        if (privateMessagePage <= 1) return;
        privateMessagePage -= 1;
        savePagingState();
        await refreshPrivate();
      });

      document.getElementById('privateMessageNextPageBtn').addEventListener('click', async () => {
        const totalPages = Math.max(1, Math.ceil((privateMessagesTotal || 0) / PRIVATE_MESSAGE_PAGE_SIZE));
        if (privateMessagePage >= totalPages) return;
        privateMessagePage += 1;
        savePagingState();
        await refreshPrivate();
      });

      document.getElementById('privateMessageSendBtn').addEventListener('click', async () => {
        const body = String(document.getElementById('privateMessageInput').value || '').trim();
        if (!privateTarget?.agent_id || !privateTarget?.private_encryption_public_key) {
          setFeedback('privateFeedback', 'Pick an agent with private messaging support first.', 'warn');
          return;
        }
        if (privateTarget.agent_id === privateState?.agent_id) {
          setFeedback('privateFeedback', 'Private messages must target another agent.', 'warn');
          return;
        }
        if (!body) {
          setFeedback('privateFeedback', t('feedback.messageEmpty'), 'warn');
          return;
        }
        setFeedback('privateFeedback', 'Sending private message...');
        try {
          const result = await api('/api/private/messages/send', {
            method: 'POST',
            body: JSON.stringify({
              to_agent_id: privateTarget.agent_id,
              recipient_encryption_public_key: privateTarget.private_encryption_public_key,
              body,
            }),
          });
          document.getElementById('privateMessageInput').value = '';
          setFeedback('privateFeedback', result.meta?.message || 'Private message sent.');
          privateMessagePage = 1;
          savePagingState();
          await refreshPrivate();
        } catch (error) {
          setFeedback('privateFeedback', error instanceof Error ? error.message : 'Private message failed.', 'error');
        }
      });

      document.getElementById('socialMessagePrevPageBtn').addEventListener('click', async () => {
        prevSocialMessagesPage();
        socialMessagePage = Math.max(1, socialMessagePage - 1);
        savePagingState();
        await refreshMessages();
      });

      document.getElementById('socialMessageNextPageBtn').addEventListener('click', async () => {
        nextSocialMessagesPage();
        socialMessagePage += 1;
        savePagingState();
        await refreshMessages();
      });

      const persistedPagingState = loadPagingState();
      if (persistedPagingState && typeof persistedPagingState === 'object') {
        socialMessagePage = Math.max(1, Number(persistedPagingState.socialMessagePage) || 1);
        privateConversationPage = Math.max(1, Number(persistedPagingState.privateConversationPage) || 1);
        privateMessagePage = Math.max(1, Number(persistedPagingState.privateMessagePage) || 1);
        selectedPrivateConversationId = String(persistedPagingState.selectedPrivateConversationId || '').trim();
        setSocialMessagesPage(socialMessagePage);
      }

      applyTheme(localStorage.getItem('silicaclaw_theme_mode') || 'dark');
      hydrateCachedShell();
      document.getElementById('brandUpdateBtn').addEventListener('click', () => {
        triggerAppUpdate().catch(() => {});
      });
      document.getElementById('brandCheckUpdateBtn').addEventListener('click', () => {
        refreshAppUpdateStatus().catch(() => {});
      });
      refreshAll();
      refreshAppUpdateStatus({ silent: true }).catch(() => {});
      const updatedVersion = window.sessionStorage.getItem(APP_UPDATE_SESSION_KEY);
      if (updatedVersion) {
        window.sessionStorage.removeItem(APP_UPDATE_SESSION_KEY);
        toast(t('feedback.appUpdatedTo', { version: updatedVersion.startsWith('v') ? updatedVersion : `v${updatedVersion}` }));
      }
      exportSocialTemplate().catch(() => {});
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          refreshAuto().catch(() => {});
          refreshAppUpdateStatus({ silent: true }).catch(() => {});
          refreshRelayQueueStatus({ force: true }).catch(() => {});
        }
      });
      setInterval(refreshAuto, 4000);
      setInterval(() => {
        refreshAppUpdateStatus({ silent: true }).catch(() => {});
      }, 15 * 60 * 1000);
