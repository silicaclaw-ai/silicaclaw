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
        setText('.nav-section__label', t('common.control'));
        setText('[data-tab="overview"] .tab-title', t('pageMeta.overview.title'));
        setText('[data-tab="overview"] .tab-copy', t('labels.overviewTabCopy'));
        setText('[data-tab="agent"] .tab-title', t('pageMeta.agent.title'));
        setText('[data-tab="agent"] .tab-copy', t('labels.agentTabCopy'));
        setText('[data-tab="chat"] .tab-title', t('pageMeta.chat.title'));
        setText('[data-tab="chat"] .tab-copy', t('labels.chatTabCopy'));
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
      setLocale(currentLocale);
      applyStaticTranslations();

      let activeTab = 'overview';
      let logsCache = [];
      let socialMessagesCache = [];
      let logLevelFilter = 'all';
      let socialTemplate = '';
      let socialModeDirty = false;
      let socialModePending = '';
      let visibleRemotePublicCount = 0;
      let socialMessageFilter = 'all';
      let socialMessageGovernance = null;
      let overviewMode = 'lan';
      let onlyShowOnline = false;
      let agentsPage = 1;
      const AGENTS_PAGE_SIZE = 10;
      const pageMeta = TRANSLATIONS[currentLocale].pageMeta || TRANSLATIONS[DEFAULT_LOCALE].pageMeta;

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
        ['overview', 'agent', 'chat', 'skills', 'profile', 'network', 'social'].forEach((k) => {
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

      const renderSocialMessages = socialController.renderSocialMessages;
      const refreshMessages = socialController.refreshMessages;

      const refreshNetwork = networkController.refreshNetwork;
      const refreshPeers = networkController.refreshPeers;
      const refreshDiscovery = networkController.refreshDiscovery;
      const getQuickConnectDefaults = networkController.getQuickConnectDefaults;

      const refreshSocial = socialController.refreshSocial;
      const exportSocialTemplate = socialController.exportSocialTemplate;
      const renderLogs = socialController.renderLogs;
      const refreshLogs = socialController.refreshLogs;
      const refreshSkills = socialController.refreshSkills;

      async function refreshAll() {
        const tasks = [refreshOverview(), refreshNetwork(), refreshSocial(), refreshSkills(), refreshPublicProfilePreview(), refreshMessages()];
        if (activeTab === 'network') {
          tasks.push(refreshPeers(), refreshDiscovery(), refreshLogs());
        }
        const shouldRefreshProfile = !(activeTab === 'profile' && profileController.isDirty());
        if (shouldRefreshProfile) {
          tasks.push(refreshProfile());
        }
        const results = await Promise.allSettled(tasks);
        const firstError = results.find((result) => result.status === 'rejected');
        if (firstError && firstError.status === 'rejected') {
          setFeedback('networkFeedback', firstError.reason instanceof Error ? firstError.reason.message : t('common.unknownError'), 'error');
        }
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

      applyTheme(localStorage.getItem('silicaclaw_theme_mode') || 'dark');
      hydrateCachedShell();
      refreshAll();
      exportSocialTemplate().catch(() => {});
      setInterval(refreshAll, 4000);
