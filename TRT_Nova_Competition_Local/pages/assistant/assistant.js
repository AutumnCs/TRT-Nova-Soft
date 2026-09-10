const app = getApp();
const agentService = require('../../services/modules/AgentService');
const plantService = require('../../services/modules/PlantService');
const mediaStorageService = require('../../services/modules/MediaStorageService');
const authService = require('../../services/modules/AuthService');
const { getTokenOpenid } = require('../../services/modules/auth-session-state');
const {
  VISION_NOTICE_BUTTONS,
  detectImageMimeFromBase64,
  getBase64ByteSize,
  getVisionErrorMessage,
  isVisionCancellation,
  canSendDraft,
  createAssistantAsyncScope,
  isAssistantAsyncScopeCurrent,
  isAssistantInteractionLocked,
  canApplySessionSnapshot,
  canPreserveAssistantView,
  runSingleFlight,
  canRewriteMessage,
  buildMessageActionMenu
} = require('./assistant-state');

const VISION_NOTICE_KEY = 'nvp_vision_notice_ack_v2';
const DOCUMENT_NOTICE_KEY = 'nvp_document_notice_ack_v1';
const ACTIVE_CONVERSATION_KEY = 'nvp_active_ai_conversation_v1';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 1 * 1024 * 1024;

const FUNCTION_OPTIONS = Object.freeze([
  { key: 'plant_status', label: '查看植株状态', description: '读取当前植宠档案与近期养护记录', action: 'prompt' },
  { key: 'watering', label: '判断是否浇水', description: '先看记录和可用状态，再给建议', action: 'prompt' },
  { key: 'memory', label: '读取相关记忆', description: '查看 NOVA 记得的当前植宠信息', action: 'prompt' },
  { key: 'create_task', label: '创建养护任务', description: '打开任务表单，由你确认后保存', action: 'task' },
  { key: 'manage_memory', label: '管理 NOVA 记忆', description: '查看、修正或遗忘结构化记忆', action: 'memory' }
]);

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') return wx.getWindowInfo().statusBarHeight || 20;
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function contextNotice(response = {}) {
  return [response.contextMemory?.message || '', response.contextStatus?.summaryIncomplete
    ? '前文摘要暂未整理完整；原话仍在，可以查看更早的对话。' : ''].filter(Boolean).join('\n');
}

function getHeaderTop() {
  if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
    const rect = wx.getMenuButtonBoundingClientRect();
    if (rect && rect.bottom) return rect.bottom + 4;
  }
  return getStatusBarHeight() + 44;
}

function buildSessionId(plantPetId = 0) {
  return `assistant_plant_${Number(plantPetId) || 'global'}`;
}

function createClientTurnKey() {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function getActiveConversationMap() {
  const stored = wx.getStorageSync(ACTIVE_CONVERSATION_KEY);
  return stored && typeof stored === 'object' ? stored : {};
}

function getConversationScopeKey(
  plantPetId = 0,
  openid = getTokenOpenid(authService.getTokenMeta())
) {
  return `${String(openid || 'anonymous')}:${String(Number(plantPetId) || 'global')}`;
}

function rememberActiveConversation(plantPetId, sessionId) {
  if (!sessionId) return;
  const next = { ...getActiveConversationMap(), [getConversationScopeKey(plantPetId)]: sessionId };
  wx.setStorageSync(ACTIVE_CONVERSATION_KEY, next);
}

function formatTimeLabel(input) {
  const date = input ? new Date(String(input).replace(' ', 'T')) : new Date();
  const value = Number.isNaN(date.getTime()) ? new Date() : date;
  const pad = (part) => String(part).padStart(2, '0');
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function formatFileSize(input) {
  const bytes = Number(input) || 0;
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function decorateDocumentAttachment(input = null) {
  if (!input || typeof input !== 'object') return null;
  return { ...input, sizeLabel: formatFileSize(input.byteSize) };
}

function callFs(method, options = {}) {
  return new Promise((resolve, reject) => wx.getFileSystemManager()[method]({ ...options, success: resolve, fail: reject }));
}

function callWx(method, options = {}) {
  return new Promise((resolve, reject) => wx[method]({ ...options, success: resolve, fail: reject }));
}

function normalizeSources(input = []) {
  const seen = new Set();
  return (Array.isArray(input) ? input : []).map((item) => {
    const type = item.type || '';
    const privateAttachment = type === 'conversation_document';
    return {
    type,
    title: item.sourceTitle || item.title || ({
      llm_chat: 'NOVA 对话模型',
      structured_memory: '结构化记忆',
      model_unavailable: '模型状态'
    }[type] || '养护依据'),
    publisher: item.sourcePublisher || '',
    updatedAt: item.contentUpdatedAt || item.reviewedAt || '',
    url: item.sourceUrl || '',
    ref: privateAttachment ? '' : item.sourceId || item.source || ''
    };
  }).filter((item) => {
    if (!item.title) return false;
    const key = item.url || item.ref || `${item.title}|${item.publisher}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function decorateVisionResult(input = {}) {
  const visibleSigns = Array.isArray(input.visibleSigns) ? input.visibleSigns : [];
  const reshootQuestions = Array.isArray(input.reshootQuestions) ? input.reshootQuestions : [];
  return {
    ...input,
    candidates: (input.candidates || []).map((item) => ({
      ...item,
      confidenceLabel: `${Math.round((Number(item.confidence) || 0) * 100)}%`
    })),
    visibleSigns,
    visibleSignsText: visibleSigns.join('；') || '没有足够清晰的可见迹象',
    reshootQuestions,
    reshootText: reshootQuestions.join('；')
  };
}

function welcomeMessage() {
  return {
    id: 'welcome-nova',
    role: 'assistant',
    text: '你好，我是 NOVA。把一盆植宠交给我后，我会结合它的档案、养护记录和已审核知识陪你判断下一步；证据不够时，我会直接说不确定。',
    summary: '我只提出建议，不会未经确认替你写任务或修改档案。',
    suggestions: ['你记得这盆植物什么？', '这盆植物平时怎么浇水？'],
    sources: [],
    taskSuggestions: [],
    memorySuggestions: [],
    timeLabel: ''
  };
}

Page({
  data: {
    statusBarHeight: 20,
    headerTop: 64,
    inputValue: '',
    canSend: false,
    composerBusy: false,
    sending: false,
    loadingSession: true,
    loadError: '',
    plantPets: [],
    plantPetIndex: 0,
    selectedPlantPet: null,
    knowledgeContext: null,
    scrollAnchor: '',
    hasOlderMessages: false,
    olderBeforeId: 0,
    loadingOlder: false,
    messages: [welcomeMessage()],
    quota: null,
    memoryCount: 0,
    attachmentMenuOpen: false,
    attachmentMenuView: 'root',
    functionOptions: FUNCTION_OPTIONS,
    selectedFunction: null,
    pendingImage: null,
    pendingDocument: null,
    visionBusy: false,
    documentBusy: false,
    savingDiagnosis: false,
    rewriteBusy: false,
    conversations: [],
    conversationIndex: 0,
    activeSessionId: '',
    rewriteSourceMessageId: 0,
    rewriteSourceTime: '',
    messageActionMenuOpen: false,
    messageActionMessageId: 0,
    messageActionMenuActions: [],
    proposalBusyKey: '',
    messageActionMenuLeft: 12,
    messageActionMenuTop: 12
  },

  onLoad() {
    this._assistantUnmounted = false;
    this._assistantAsyncEpoch = 1;
    this._sessionMutationVersion = 0;
    this._sessionLoadedOpenid = '';
    this.setData({ statusBarHeight: getStatusBarHeight(), headerTop: getHeaderTop() });
    this.hydrateKnowledgeContext();
  },

  onShow() {
    this._assistantHidden = false;
    if (typeof this.getTabBar === 'function' && this.getTabBar()) this.getTabBar().setData({ selected: 1 });
    this.hydrateKnowledgeContext();
    if (!this.checkLoginStatus()) return;
    // 微信原生附件选择器也会触发 onHide/onShow；此时不是切换会话。
    if (this._attachmentSelection) return;
    if (this.data.sending) return;
    const addPlantRequest = wx.getStorageSync('nvp_assistant_open_add_plant');
    if (addPlantRequest) wx.removeStorageSync('nvp_assistant_open_add_plant');
    const loadPromise = this.loadPlantsAndSession();
    if (addPlantRequest && loadPromise && typeof loadPromise.finally === 'function') {
      loadPromise.finally(() => {
        if (this._assistantUnmounted) return;
        this.setData({
          attachmentMenuOpen: true,
          attachmentMenuView: 'attachment'
        });
      });
    }
  },

  onHide() {
    this.invalidateAssistantAsyncScope();
    this._assistantHidden = true;
    // 远端请求可能已经产生服务端结果；隐藏后不再让旧回包修改当前页面。
    // 回到页面时由 loadPlantsAndSession 从服务端事实重新投影。
    this._visionSendPending = false;
    this._documentSendPending = false;
    this.setData({
      sending: false,
      visionBusy: false,
      documentBusy: false,
      loadingSession: false,
      savingDiagnosis: false,
      rewriteBusy: false,
      proposalBusyKey: ''
    });
    this.closeMessageActionMenu();
  },

  onUnload() {
    this._assistantUnmounted = true;
    this.invalidateAssistantAsyncScope();
    this._attachmentSelection = null;
    this._pendingVisionPayload = null;
    this._visionSendPending = false;
    this._documentSendPending = false;
  },

  invalidateAssistantAsyncScope() {
    this._assistantAsyncEpoch = (Number(this._assistantAsyncEpoch) || 0) + 1;
    return this._assistantAsyncEpoch;
  },

  setConversationMessages(messages, patch = {}) {
    this._sessionMutationVersion = (Number(this._sessionMutationVersion) || 0) + 1;
    this.setData({ ...patch, messages });
    return this._sessionMutationVersion;
  },

  captureAssistantAsyncScope(plantPetId, sessionId) {
    const currentPlantPetId = plantPetId === undefined
      ? Number(this.data.selectedPlantPet?.id) || 0
      : Number(plantPetId) || 0;
    const currentSessionId = sessionId === undefined
      ? this.data.activeSessionId || ''
      : sessionId;
    return createAssistantAsyncScope(
      currentPlantPetId,
      currentSessionId,
      this._assistantAsyncEpoch
    );
  },

  isCurrentAssistantAsyncScope(scope) {
    if (this._assistantUnmounted) return false;
    return isAssistantAsyncScopeCurrent(scope, this.captureAssistantAsyncScope());
  },

  hydrateKnowledgeContext() {
    const context = wx.getStorageSync('nvp_pending_assistant_context');
    if (context && typeof context === 'object' && context.title) {
      this.setData({ knowledgeContext: context });
      wx.removeStorageSync('nvp_pending_assistant_context');
    }
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => app.gotoLoginPage(), 80);
      return false;
    }
    return true;
  },

  loadPlantsAndSession() {
    if (this._loadingPlantsPromise) {
      // onHide 会使旧请求的 scope 过期；再次 onShow 时必须在旧请求结束后补拉，
      // 否则单飞锁会吞掉本次可见页面加载并让界面永久停在 loading。
      this._assistantReloadRequested = true;
      return this._loadingPlantsPromise;
    }
    this._loadingPlants = true;
    const operation = (async () => {
      try {
        return await this._loadPlantsAndSessionOnce();
      } finally {
        this._loadingPlants = false;
        this._loadingPlantsPromise = null;
        const shouldReload = this._assistantReloadRequested &&
          !this._assistantHidden && !this._assistantUnmounted;
        this._assistantReloadRequested = false;
        if (shouldReload) return this.loadPlantsAndSession();
      }
    })();
    this._loadingPlantsPromise = operation;
    return operation;
  },

  async _loadPlantsAndSessionOnce() {
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const preserveVisibleSession = canPreserveAssistantView(
      this.data,
      this._sessionLoadedOpenid,
      expectedOpenid
    );
    if (this._sessionLoadedOpenid && this._sessionLoadedOpenid !== expectedOpenid) {
      this._sessionLoadedOpenid = '';
      this.setConversationMessages([welcomeMessage()], {
        inputValue: '', canSend: false,
        pendingImage: null,
        pendingDocument: null,
        selectedFunction: null,
        rewriteSourceMessageId: 0,
        rewriteSourceTime: '',
        activeSessionId: ''
      });
    }
    let requestScope = this.captureAssistantAsyncScope();
    if (!this._assistantUnmounted) {
      this.setData(preserveVisibleSession
        ? { loadError: '' }
        : { loadingSession: true, loadError: '' });
    }
    try {
      const result = await plantService.listMyPlantPets();
      if (
        !this.isCurrentAssistantAsyncScope(requestScope) ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid
      ) return;
      const plantPets = Array.isArray(result?.pets) ? result.pets : [];
      const currentId = Number(this.data.selectedPlantPet?.id) || 0;
      const index = Math.max(0, plantPets.findIndex((item) => item.id === currentId));
      const selectedPlantPet = plantPets[index] || null;
      if ((Number(selectedPlantPet?.id) || 0) !== currentId) this.invalidateAssistantAsyncScope();
      this.setData({ plantPets, plantPetIndex: index, selectedPlantPet });
      requestScope = this.captureAssistantAsyncScope();
      await this.loadConversationsAndSession('', {
        preserveView: preserveVisibleSession && (Number(selectedPlantPet?.id) || 0) === currentId
      });
    } catch (err) {
      console.error('[assistant] context load failed:', err);
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        this.setData({ loadingSession: false, loadError: err.message || 'NOVA 上下文加载失败' });
      }
    }
  },

  async loadConversationsAndSession(preferredSessionId = '', options = {}) {
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    const requestScope = this.captureAssistantAsyncScope(plantPetId, this.data.activeSessionId || '');
    if (!this.isCurrentAssistantAsyncScope(requestScope)) return false;
    const preserveView = Boolean(options.preserveView && this.data.activeSessionId);
    this.setData(preserveView
      ? { loadError: '' }
      : { loadingSession: true, loadError: '' });
    const result = await agentService.listConversations({ plantPetId });
    if (!this.isCurrentAssistantAsyncScope(requestScope)) return false;
    let conversations = Array.isArray(result.conversations) ? result.conversations : [];
    if (!conversations.length) {
      const created = await agentService.createConversation({ plantPetId, title: '新对话' });
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return false;
      if (created.conversation) conversations = [created.conversation];
    }
    const remembered = getActiveConversationMap()[getConversationScopeKey(plantPetId)] || '';
    const requestedSessionId = preferredSessionId || remembered || this.data.activeSessionId;
    const conversationIndex = Math.max(0, conversations.findIndex((item) => item.sessionId === requestedSessionId));
    const activeSessionId = conversations[conversationIndex]?.sessionId || buildSessionId(plantPetId);
    if (activeSessionId !== (this.data.activeSessionId || '')) this.invalidateAssistantAsyncScope();
    this.setData({ conversations, conversationIndex, activeSessionId });
    rememberActiveConversation(plantPetId, activeSessionId);
    await this.loadSession(activeSessionId, {
      preserveView: preserveView && activeSessionId === (requestScope.sessionId || '')
    });
    return true;
  },

  async refreshConversations(preferredSessionId = '') {
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    const requestScope = this.captureAssistantAsyncScope(plantPetId, this.data.activeSessionId || '');
    const result = await agentService.listConversations({ plantPetId });
    if (!this.isCurrentAssistantAsyncScope(requestScope)) return false;
    const conversations = Array.isArray(result.conversations) ? result.conversations : [];
    const conversationIndex = Math.max(0, conversations.findIndex((item) => item.sessionId === preferredSessionId));
    const activeSessionId = conversations[conversationIndex]?.sessionId || preferredSessionId || this.data.activeSessionId;
    if (activeSessionId !== (this.data.activeSessionId || '')) this.invalidateAssistantAsyncScope();
    this.setData({ conversations, conversationIndex, activeSessionId });
    rememberActiveConversation(plantPetId, activeSessionId);
    return true;
  },

  async loadOlderMessages() {
    if (this.data.loadingOlder || !this.data.hasOlderMessages || this.data.sending) return;
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    const sessionId = this.data.activeSessionId;
    const scope = this.captureAssistantAsyncScope(plantPetId, sessionId);
    const version = Number(this._sessionMutationVersion) || 0;
    this.setData({ loadingOlder: true });
    try {
      const result = await agentService.getSession({ sessionId, plantPetId, beforeMessageId: this.data.olderBeforeId });
      const older = await this.hydrateStoredAttachments((result.messages || []).map(item => this.mapStoredMessage(item)));
      if (!this.isCurrentAssistantAsyncScope(scope) || version !== (Number(this._sessionMutationVersion) || 0)) return;
      const ids = new Set(this.data.messages.map(item => item.backendId).filter(Boolean));
      const current = this.data.messages.filter(item => item.backendId || item.role === 'user' || item.loading);
      this.setConversationMessages([welcomeMessage(), ...older.filter(item => !ids.has(item.backendId)), ...current], {
        hasOlderMessages: result.hasMore === true, olderBeforeId: Number(result.nextBeforeMessageId) || 0
      });
    } catch (error) {
      if (this.isCurrentAssistantAsyncScope(scope)) wx.showToast({ title: error.message || '较早对话加载失败', icon: 'none' });
    } finally {
      if (this.isCurrentAssistantAsyncScope(scope)) this.setData({ loadingOlder: false });
    }
  },

  async loadSession(sessionId = '', options = {}) {
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    const activeSessionId = sessionId || this.data.activeSessionId || buildSessionId(plantPetId);
    const expectedOpenid = getTokenOpenid(authService.getTokenMeta());
    const preserveView = Boolean(
      options.preserveView &&
      activeSessionId === (this.data.activeSessionId || '') &&
      Array.isArray(this.data.messages) &&
      this.data.messages.length
    );
    if (activeSessionId !== (this.data.activeSessionId || '')) {
      this.invalidateAssistantAsyncScope();
      this.setData({ activeSessionId });
    }
    const requestScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
    const sessionMutationVersion = Number(this._sessionMutationVersion) || 0;
    if (!this.isCurrentAssistantAsyncScope(requestScope)) return false;
    if (preserveView) {
      this.setData({ loadError: '', activeSessionId });
    } else {
      this._pendingVisionPayload = null;
      this.setData({
        loadingSession: true,
        loadError: '',
        attachmentMenuOpen: false,
        attachmentMenuView: 'root',
        pendingImage: null,
        pendingDocument: null,
        selectedFunction: null,
        rewriteSourceMessageId: 0,
        rewriteSourceTime: '',
        messageActionMenuOpen: false,
        messageActionMessageId: 0,
        messageActionMenuActions: [],
        activeSessionId,
        canSend: Boolean(String(this.data.inputValue || '').trim())
      });
    }
    try {
      const result = await agentService.getSession({ sessionId: activeSessionId, plantPetId });
      const storedMessages = this.decorateMessageActions(await this.hydrateStoredAttachments(
        (result.messages || []).map((item) => this.mapStoredMessage(item))
      ));
      if (
        !this.isCurrentAssistantAsyncScope(requestScope) ||
        getTokenOpenid(authService.getTokenMeta()) !== expectedOpenid ||
        !canApplySessionSnapshot(preserveView, sessionMutationVersion, this._sessionMutationVersion)
      ) return false;
      const resolvedSessionId = result.sessionId || activeSessionId;
      if (resolvedSessionId !== activeSessionId) {
        this.setData({ loadingSession: false, loadError: '会话响应与当前选择不一致，请重试' });
        return false;
      }
      this._sessionLoadedOpenid = expectedOpenid;
      this.setConversationMessages(
        storedMessages.length ? [welcomeMessage()].concat(storedMessages) : [welcomeMessage()],
        {
        quota: result.quota || null,
        memoryCount: Array.isArray(result.memories) ? result.memories.length : 0,
        activeSessionId: resolvedSessionId,
        hasOlderMessages: result.hasMore === true,
        olderBeforeId: Number(result.nextBeforeMessageId) || 0,
        loadingOlder: false,
        loadingSession: false
        }
      );
      rememberActiveConversation(plantPetId, resolvedSessionId);
      if (!preserveView) this.scrollToBottomSoon();
      return true;
    } catch (err) {
      console.error('[assistant] session load failed:', err);
      if (
        this.isCurrentAssistantAsyncScope(requestScope) &&
        getTokenOpenid(authService.getTokenMeta()) === expectedOpenid
      ) {
        if (preserveView) {
          const reason = String(err.message || '会话刷新失败').replace(/[，。；;,.\s]+$/, '');
          this.setData({ loadingSession: false, loadError: `${reason}，正在显示上次内容` });
        } else {
          this.setConversationMessages([welcomeMessage()], {
            loadingSession: false,
            loadError: err.message || '会话加载失败'
          });
        }
      }
      return false;
    }
  },

  mapStoredMessage(item = {}) {
    if (item.role === 'assistant') {
      const response = item.response || {};
      const isVision = response.kind === 'vision_analysis';
      const isDocument = response.kind === 'document_analysis';
      return {
        id: `stored-assistant-${item.id}`,
        backendId: Number(item.id) || 0,
        role: 'assistant',
        text: isVision ? '' : item.content || '',
        summary: [contextNotice(response), isVision ? '' : response.disclaimer || ''].filter(Boolean).join('\n'),
        suggestions: Array.isArray(response.followUpQuestions) ? response.followUpQuestions.slice(0, 3) : [],
        sources: normalizeSources(response.sources),
        taskSuggestions: Array.isArray(response.taskSuggestions) ? response.taskSuggestions : [],
        memorySuggestions: Array.isArray(response.memorySuggestions) ? response.memorySuggestions : [],
        visionResult: isVision ? decorateVisionResult(response.analysis || {}) : null,
        visionModel: isVision ? response.model || '' : '',
        visionPreview: '',
        visionMessageId: isVision ? Number(item.id) || 0 : 0,
        visionMediaFileId: isVision ? response.attachment?.mediaFileId || '' : '',
        visionOriginalUnavailable: isVision && !response.attachment?.originalPersisted,
        diagnosisSaved: Boolean(isVision && response.attachment?.diagnosisId),
        documentAnalysis: isDocument,
        documentAttachment: isDocument ? decorateDocumentAttachment(response.attachment) : null,
        timeLabel: formatTimeLabel(item.createdAt)
      };
    }
    const response = item.response || {};
    const isVision = response.kind === 'vision_input';
    const isDocument = response.kind === 'document_input';
    return {
      id: `stored-user-${item.id}`,
      backendId: Number(item.id) || 0,
      role: 'user',
      text: (isVision || isDocument) ? response.message || '' : item.content || '',
      visionInput: isVision,
      visionMediaFileId: isVision ? response.attachment?.mediaFileId || '' : '',
      documentInput: isDocument,
      documentAttachment: isDocument ? decorateDocumentAttachment(response.attachment) : null,
      imageOriginalUnavailable: isVision && !response.attachment?.originalPersisted,
      summary: '',
      suggestions: [],
      sources: [],
      taskSuggestions: [],
      memorySuggestions: [],
      timeLabel: formatTimeLabel(item.createdAt)
    };
  },

  decorateMessageActions(messages = []) {
    const decorated = messages.map((item) => ({ ...item, canWithdraw: false, canRewrite: false }));
    const lastUserIndex = decorated.map((item) => item.role).lastIndexOf('user');
    decorated.forEach((item, index) => {
      if (item.role !== 'user' || !item.backendId) return;
      item.canWithdraw = index === lastUserIndex;
      item.canRewrite = canRewriteMessage(item);
    });
    return decorated;
  },

  async hydrateStoredAttachments(messages = []) {
    const fileIds = messages.map((item) => item.visionMediaFileId).filter(Boolean);
    if (!fileIds.length) return messages;
    const displayMap = await mediaStorageService.resolveFileIds(fileIds);
    const hydrated = messages.map((item) => ({ ...item }));
    hydrated.forEach((item, index) => {
      const imageUrl = item.visionMediaFileId ? displayMap[item.visionMediaFileId] || '' : '';
      if (!imageUrl) return;
      item.visionPreview = imageUrl;
      item.visionOriginalUnavailable = false;
      const userMessage = hydrated[index - 1];
      if (userMessage?.role === 'user' && userMessage.visionInput) {
        userMessage.imagePreview = imageUrl;
        userMessage.imageOriginalUnavailable = false;
      }
    });
    return hydrated;
  },

  async onPlantPetChange(e) {
    if (isAssistantInteractionLocked(this.data)) return;
    const index = Number(e.detail.value) || 0;
    this.invalidateAssistantAsyncScope();
    this.setData({
      plantPetIndex: index,
      selectedPlantPet: this.data.plantPets[index] || null,
      activeSessionId: '',
      loadingSession: true,
      loadError: ''
    });
    await this.loadConversationsAndSession();
  },

  async onConversationChange(e) {
    if (isAssistantInteractionLocked(this.data)) return;
    const conversationIndex = Number(e.detail.value) || 0;
    const conversation = this.data.conversations[conversationIndex];
    if (!conversation?.sessionId || conversation.sessionId === this.data.activeSessionId) return;
    this.invalidateAssistantAsyncScope();
    this.setData({ conversationIndex, activeSessionId: conversation.sessionId, loadingSession: true, loadError: '' });
    rememberActiveConversation(Number(this.data.selectedPlantPet?.id) || 0, conversation.sessionId);
    await this.loadSession(conversation.sessionId);
  },

  async createNewConversation() {
    if (isAssistantInteractionLocked(this.data)) return;
    this.invalidateAssistantAsyncScope();
    const requestScope = this.captureAssistantAsyncScope();
    this.setData({ loadingSession: true, loadError: '' });
    try {
      const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
      const result = await agentService.createConversation({ plantPetId, title: '新对话' });
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      const sessionId = result.conversation?.sessionId || '';
      if (!sessionId) throw new Error('新会话标识缺失');
      if (!await this.refreshConversations(sessionId)) return;
      await this.loadSession(sessionId);
    } catch (err) {
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        this.setData({ loadingSession: false, loadError: err.message || '新会话创建失败' });
        wx.showToast({ title: err.message || '新会话创建失败', icon: 'none' });
      }
    }
  },

  onInput(e) {
    const inputValue = e.detail.value || '';
    this.setData({ inputValue, canSend: canSendDraft(inputValue, this.data.pendingImage, this.data.pendingDocument, this.data.selectedFunction) });
  },

  onComposerChange(e) {
    const inputValue = e.detail.value || '';
    const selectedFunction = FUNCTION_OPTIONS.find(item => item.action === 'prompt' && item.key === e.detail.functionKey) || null;
    this.setData({ inputValue, selectedFunction, canSend: canSendDraft(inputValue, this.data.pendingImage, this.data.pendingDocument, selectedFunction) });
  },

  onComposerBusy(e) { this.setData({ composerBusy: Boolean(e.detail.value) }); },
  onComposerError(e) {
    this.setData({ selectedFunction: null, canSend: canSendDraft(this.data.inputValue, this.data.pendingImage, this.data.pendingDocument) });
    wx.showToast({ title: e.detail.message, icon: 'none' });
  },

  async onInputConfirm(e = {}) {
    const inputValue = e?.detail?.value === undefined ? this.data.inputValue : e.detail.value;
    this.setData({ inputValue, canSend: canSendDraft(inputValue, this.data.pendingImage, this.data.pendingDocument, this.data.selectedFunction) });
    // Compatibility for old callers only. Enter no longer sends a request.
  },

  onQuickQuestionTap(e) {
    const text = e.currentTarget.dataset.text || '';
    if (!text) return;
    this.setData({ inputValue: text, canSend: true });
    this.sendMessage();
  },

  async sendMessage() {
    if (isAssistantInteractionLocked(this.data) || this._composerSubmitting) return;
    const draftScope = this.captureAssistantAsyncScope();
    const draftOwner = getTokenOpenid(authService.getTokenMeta());
    this._composerSubmitting = true;
    try {
      const composer = this.selectComponent?.('#conversation-composer');
      if (composer) {
        if (typeof wx.nextTick === 'function') await new Promise(resolve => wx.nextTick(resolve));
        await composer.flush();
      }
    } catch (error) {
      wx.showToast({ title: error.message || '输入框暂未就绪', icon: 'none' });
      return;
    } finally { this._composerSubmitting = false; }
    if (!this.isCurrentAssistantAsyncScope(draftScope) || draftOwner !== getTokenOpenid(authService.getTokenMeta())) return;
    const text = String(this.data.inputValue || '').trim();
    if (isAssistantInteractionLocked(this.data)) return;
    this.closeMessageActionMenu();
    if (this.data.pendingImage) return this.sendVisionMessage(text);
    if (this.data.pendingDocument) return this.sendDocumentMessage(text);
    const message = text || this.data.selectedFunction?.label || '';
    if (!message) return;
    return this.sendTextMessage(message);
  },

  async sendTextMessage(text) {
    if (isAssistantInteractionLocked(this.data)) return;
    this.invalidateAssistantAsyncScope();
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    const selectedFunction = this.data.selectedFunction;
    let activeSessionId = this.data.activeSessionId || buildSessionId(plantPetId);
    let loadingMessage = null;
    let userMessage = null;
    let requestScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
    this.setData({ sending: true, attachmentMenuOpen: false, attachmentMenuView: 'root' });
    try {
      activeSessionId = await this.prepareRewriteConversation(plantPetId, requestScope);
      if (!activeSessionId) return;
      requestScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      const messageKey = Date.now();
      userMessage = {
        id: `user-${messageKey}`,
        backendId: 0,
        role: 'user',
        text,
        summary: '', suggestions: [], sources: [], taskSuggestions: [],
        timeLabel: formatTimeLabel()
      };
      loadingMessage = {
        id: `assistant-loading-${messageKey}`,
        role: 'assistant', text: 'NOVA 正在整理档案、记忆和知识依据…',
        summary: '', suggestions: [], sources: [], taskSuggestions: [], loading: true, timeLabel: ''
      };
      this.setConversationMessages(this.data.messages.concat([userMessage, loadingMessage]), {
        inputValue: '',
        canSend: false,
        selectedFunction: null,
        rewriteSourceMessageId: 0,
        rewriteSourceTime: ''
      });
      this.scrollToBottomSoon();
      const response = await agentService.chat({
        sessionId: activeSessionId,
        clientTurnKey: createClientTurnKey(),
        plantPetId,
        message: text,
        context: {
          page: 'assistant',
          knowledgeContext: this.data.knowledgeContext || null,
          selectedFunction: selectedFunction ? {
            key: selectedFunction.key,
            mode: 'read_only_or_confirmed_form'
          } : null
        },
        options: { allowActions: false }
      });
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      const nextMessages = this.data.messages.map((item) => {
        if (item.id === userMessage.id) return { ...item, backendId: Number(response.userMessageId) || 0 };
        if (item.id === loadingMessage.id) return this.buildAssistantMessage(response);
        return item;
      });
      this.setConversationMessages(this.decorateMessageActions(nextMessages), {
        quota: response.quota || this.data.quota
      });
      await this.refreshConversations(activeSessionId).catch(() => {});
    } catch (err) {
      if (!this._assistantUnmounted && (!requestScope || this.isCurrentAssistantAsyncScope(requestScope))) {
        if (loadingMessage) this.replaceLoadingMessage(loadingMessage.id, this.buildFallbackMessage(err));
        else wx.showToast({ title: err.message || '重新编写失败', icon: 'none' });
      }
    } finally {
      if (!this._assistantUnmounted && (!requestScope || this.isCurrentAssistantAsyncScope(requestScope))) {
        this.setData({ sending: false });
        this.scrollToBottomSoon();
      }
    }
  },

  async prepareRewriteConversation(plantPetId = 0, expectedScope = null) {
    const sourceScope = expectedScope || this.captureAssistantAsyncScope(
      plantPetId,
      this.data.activeSessionId || buildSessionId(plantPetId)
    );
    if (!this.isCurrentAssistantAsyncScope(sourceScope)) return '';
    const sourceMessageId = Number(this.data.rewriteSourceMessageId) || 0;
    if (!sourceMessageId) return this.data.activeSessionId || buildSessionId(plantPetId);
    const forked = await agentService.forkConversation({ sourceMessageId });
    if (!this.isCurrentAssistantAsyncScope(sourceScope)) return '';
    const activeSessionId = forked.conversation?.sessionId || '';
    if (!activeSessionId) throw new Error('重新编辑分支创建失败');
    if (!await this.refreshConversations(activeSessionId)) return '';
    const forkScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
    if (!this.isCurrentAssistantAsyncScope(forkScope)) return '';
    if (!await this.loadSession(activeSessionId)) return '';
    if (!this.isCurrentAssistantAsyncScope(forkScope)) return '';
    return activeSessionId;
  },

  buildAssistantMessage(response = {}) {
    return {
      id: Number(response.assistantMessageId) ? `stored-assistant-${response.assistantMessageId}` : `assistant-${Date.now()}`,
      backendId: Number(response.assistantMessageId) || 0,
      role: 'assistant',
      text: [response.summary, response.diagnosis].filter(Boolean).join('\n\n') || '这次没有得到足够信息。',
      summary: [
        contextNotice(response),
        Array.isArray(response.facts) && response.facts.length ? `依据：${response.facts.slice(0, 3).join('；')}` : '',
        response.disclaimer || ''
      ].filter(Boolean).join('\n'),
      suggestions: (response.followUpQuestions || response.suggestions || []).slice(0, 3),
      sources: normalizeSources(response.sources),
      taskSuggestions: Array.isArray(response.taskSuggestions) ? response.taskSuggestions : [],
      memorySuggestions: Array.isArray(response.memorySuggestions) ? response.memorySuggestions : [],
      documentAnalysis: response.kind === 'document_analysis',
      documentAttachment: response.kind === 'document_analysis' ? decorateDocumentAttachment(response.attachment) : null,
      timeLabel: formatTimeLabel()
    };
  },

  buildFallbackMessage(err) {
    const message = String(err?.message || err?.errMsg || '请稍后再试');
    return {
      id: `assistant-fallback-${Date.now()}`,
      role: 'assistant',
      text: `这次没有得到模型结果：${message}`,
      summary: '手动建档、任务、日记和症状记录仍可正常使用。',
      suggestions: ['查看植物知识库', '手动建立任务', '稍后重试'],
      sources: [{ title: '模型状态', publisher: '', updatedAt: '', url: '', ref: 'model_unavailable' }],
      taskSuggestions: [],
      timeLabel: formatTimeLabel()
    };
  },

  replaceLoadingMessage(loadingId, nextMessage) {
    this.setConversationMessages(
      this.data.messages.map((item) => item.id === loadingId ? nextMessage : item)
    );
  },

  async ensureVisionNotice() {
    if (wx.getStorageSync(VISION_NOTICE_KEY)) return true;
    return runSingleFlight(this, '_visionNoticePromise', async () => {
      let result = null;
      try {
        result = await callWx('showModal', {
          title: '图片将交由第三方 AI 处理',
          content: '图片会发送给第三方 AI 模型做本轮分析，并作为本轮对话附件保存，方便你再次打开时查看。只有你主动点击“另存观察记录”后，结构化观察才会进入植宠档案。',
          ...VISION_NOTICE_BUTTONS
        });
      } catch (err) {
        console.error('[assistant] vision notice failed:', err);
        wx.showToast({ title: '暂时无法确认图片发送，请重试', icon: 'none' });
        return false;
      }
      if (result.confirm) wx.setStorageSync(VISION_NOTICE_KEY, { acceptedAt: Date.now(), version: 2 });
      return Boolean(result.confirm);
    });
  },

  async ensureDocumentNotice() {
    if (wx.getStorageSync(DOCUMENT_NOTICE_KEY)) return true;
    return runSingleFlight(this, '_documentNoticePromise', async () => {
      let result = null;
      try {
        result = await callWx('showModal', {
          title: '文档将交由第三方 AI 处理',
          content: '所选文档会发送给第三方 AI 做本轮植物相关分析，并作为当前账号的本轮对话附件保存。文档文字不会自动写入长期记忆或直接创建任务。',
          confirmText: '同意发送',
          cancelText: '暂不发送'
        });
      } catch (err) {
        wx.showToast({ title: '暂时无法确认文档发送', icon: 'none' });
        return false;
      }
      if (result.confirm) wx.setStorageSync(DOCUMENT_NOTICE_KEY, { acceptedAt: Date.now(), version: 1 });
      return Boolean(result.confirm);
    });
  },

  toggleAttachmentMenu() {
    if (isAssistantInteractionLocked(this.data)) return;
    this.closeMessageActionMenu();
    this.setData({
      attachmentMenuOpen: !this.data.attachmentMenuOpen,
      attachmentMenuView: 'root'
    });
  },

  showAttachmentChoices() {
    if (isAssistantInteractionLocked(this.data)) return;
    this.setData({ attachmentMenuView: 'attachment' });
  },

  showFunctionChoices() {
    if (isAssistantInteractionLocked(this.data)) return;
    this.setData({ attachmentMenuView: 'function' });
  },

  backAttachmentMenu() {
    this.setData({ attachmentMenuView: 'root' });
  },

  selectFunction(e = {}) {
    if (isAssistantInteractionLocked(this.data)) return;
    const option = FUNCTION_OPTIONS.find((item) => item.key === e.currentTarget?.dataset?.key);
    if (!option) return;
    this.setData({ attachmentMenuOpen: false, attachmentMenuView: 'root' });
    if (option.action === 'memory') {
      this.openAiMemory();
      return;
    }
    if (option.action === 'task') {
      const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
      if (!plantPetId) {
        wx.showToast({ title: '请先选择或建立植宠', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: `/pages/taskForm/taskForm?plantPetId=${plantPetId}` });
      return;
    }
    this.setData({
      selectedFunction: option,
      canSend: true
    });
  },

  removeSelectedFunction() {
    this.setData({
      selectedFunction: null,
      canSend: canSendDraft(this.data.inputValue, this.data.pendingImage, this.data.pendingDocument)
    });
  },

  showSelectedFunctionInfo() {
    const option = this.data.selectedFunction;
    if (!option) return;
    wx.showModal({ title: option.label, content: option.description, showCancel: false, confirmText: '知道了' });
  },

  beginAttachmentSelection() {
    const selection = {
      scope: this.captureAssistantAsyncScope(),
      openid: getTokenOpenid(authService.getTokenMeta())
    };
    this._attachmentSelection = selection;
    return selection;
  },

  isCurrentAttachmentSelection(selection) {
    if (this._assistantUnmounted || this._attachmentSelection !== selection) return false;
    const current = this.captureAssistantAsyncScope();
    // 只允许原生选择器跨 hide/show。网络回包仍保留严格 epoch 校验。
    return Boolean(selection.openid)
      && selection.openid === getTokenOpenid(authService.getTokenMeta())
      && selection.scope.plantPetId === current.plantPetId
      && selection.scope.sessionId === current.sessionId;
  },

  async choosePlantImage(e = {}) {
    if (isAssistantInteractionLocked(this.data) || this._attachmentSelection) return;
    const selection = this.beginAttachmentSelection();
    const requestedSource = e?.currentTarget?.dataset?.source || '';
    this.setData({ attachmentMenuOpen: false, attachmentMenuView: 'root' });
    try {
      const selected = await callWx('chooseMedia', {
        count: 1,
        mediaType: ['image'],
        sourceType: requestedSource ? [requestedSource] : ['album', 'camera'],
        sizeType: ['compressed']
      });
      const selectedFile = selected.tempFiles?.[0] || {};
      let filePath = selectedFile.tempFilePath || '';
      if (!filePath) return;
      let fileSize = Number(selectedFile.size) || 0;
      if (!fileSize) {
        const info = await callFs('getFileInfo', { filePath });
        fileSize = Number(info.size) || 0;
      }
      if (fileSize > MAX_IMAGE_BYTES && typeof wx.compressImage === 'function') {
        const compressed = await callWx('compressImage', { src: filePath, quality: 75 });
        filePath = compressed.tempFilePath || filePath;
        const info = await callFs('getFileInfo', { filePath });
        fileSize = Number(info.size) || 0;
      }
      if (fileSize > MAX_IMAGE_BYTES) throw new Error('压缩后仍超过 2 MB，请裁剪或换一张图片');
      const file = await callFs('readFile', { filePath, encoding: 'base64' });
      const byteSize = getBase64ByteSize(file.data);
      if (byteSize > MAX_IMAGE_BYTES) throw new Error('图片超过 2 MB，请压缩或裁剪后重试');
      const mimeType = detectImageMimeFromBase64(file.data);
      if (!mimeType) throw new Error('暂不支持这张图片的格式，请选择 JPG、PNG 或 WebP 图片');
      if (!this.isCurrentAttachmentSelection(selection)) return;
      this._pendingVisionPayload = {
        tempFilePath: filePath,
        imageBase64: file.data,
        mimeType,
        byteSize
      };
      this.setData({
        pendingDocument: null,
        pendingImage: {
          tempFilePath: filePath,
          byteSize,
          sizeLabel: `${Math.max(1, Math.ceil(byteSize / 1024))} KB`
        },
        canSend: true
      });
      wx.showToast({ title: '图片已添加，可补充问题', icon: 'none' });
    } catch (err) {
      if (isVisionCancellation(err)) return;
      console.error('[assistant] image attachment failed:', err);
      if (!this.isCurrentAttachmentSelection(selection)) return;
      wx.showModal({
        title: '图片没有添加成功',
        content: getVisionErrorMessage(err),
        showCancel: false,
        confirmText: '我知道了'
      });
    } finally {
      if (this._attachmentSelection === selection) this._attachmentSelection = null;
    }
  },

  removePendingImage() {
    this._pendingVisionPayload = null;
    this.setData({
      pendingImage: null,
      canSend: canSendDraft(this.data.inputValue, null, this.data.pendingDocument, this.data.selectedFunction)
    });
  },

  async choosePlantDocument() {
    if (isAssistantInteractionLocked(this.data) || this._attachmentSelection) return;
    const selection = this.beginAttachmentSelection();
    this.setData({ attachmentMenuOpen: false, attachmentMenuView: 'root' });
    try {
      const selected = await callWx('chooseMessageFile', {
        count: 1,
        type: 'file',
        extension: ['txt', 'md', 'markdown', 'csv', 'json', 'pdf', 'docx']
      });
      const file = selected.tempFiles?.[0] || {};
      const tempFilePath = file.path || file.tempFilePath || '';
      const name = file.name || tempFilePath.split('/').pop() || '';
      let byteSize = Number(file.size) || 0;
      if (!byteSize && tempFilePath) {
        const info = await callFs('getFileInfo', { filePath: tempFilePath });
        byteSize = Number(info.size) || 0;
      }
      if (!tempFilePath || !name) throw new Error('没有取得所选文档');
      if (!byteSize || byteSize > MAX_DOCUMENT_BYTES) throw new Error('单个文档不能超过 1 MB');
      if (!this.isCurrentAttachmentSelection(selection)) return;
      this._pendingVisionPayload = null;
      this.setData({
        pendingImage: null,
        pendingDocument: {
          tempFilePath,
          name,
          byteSize,
          sizeLabel: `${Math.max(1, Math.ceil(byteSize / 1024))} KB`
        },
        canSend: true
      });
      wx.showToast({ title: '文档已添加，可补充问题', icon: 'none' });
    } catch (err) {
      if (isVisionCancellation(err)) return;
      if (!this.isCurrentAttachmentSelection(selection)) return;
      wx.showModal({
        title: '文档没有添加成功',
        content: String(err?.message || err?.errMsg || '请选择 TXT、Markdown、CSV、JSON、PDF 或 DOCX 文档'),
        showCancel: false,
        confirmText: '我知道了'
      });
    } finally {
      if (this._attachmentSelection === selection) this._attachmentSelection = null;
    }
  },

  removePendingDocument() {
    this.setData({
      pendingDocument: null,
      canSend: canSendDraft(this.data.inputValue, this.data.pendingImage, null, this.data.selectedFunction)
    });
  },

  async sendDocumentMessage(text = '') {
    if (this._documentSendPending || this.data.documentBusy || isAssistantInteractionLocked(this.data)) return;
    this._documentSendPending = true;
    let requestScope = this.captureAssistantAsyncScope();
    const pendingDocument = this.data.pendingDocument;
    if (!pendingDocument?.tempFilePath) {
      this.removePendingDocument();
      wx.showToast({ title: '文档草稿已失效，请重新选择', icon: 'none' });
      this._documentSendPending = false;
      return;
    }
    if (!(await this.ensureDocumentNotice())) {
      this._documentSendPending = false;
      return;
    }
    if (!this.isCurrentAssistantAsyncScope(requestScope)) {
      this._documentSendPending = false;
      return;
    }
    this.invalidateAssistantAsyncScope();
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    let activeSessionId = this.data.activeSessionId || buildSessionId(plantPetId);
    requestScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
    const clientTurnKey = createClientTurnKey();
    this.setData({ sending: true, documentBusy: true, attachmentMenuOpen: false, attachmentMenuView: 'root' });
    try {
      activeSessionId = await this.prepareRewriteConversation(plantPetId, requestScope);
      if (!activeSessionId) return;
      requestScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
    } catch (err) {
      if (!this._assistantUnmounted) {
        this.setData({ sending: false, documentBusy: false });
        wx.showToast({ title: err.message || '重新编辑失败', icon: 'none' });
      }
      this._documentSendPending = false;
      return;
    }
    const messageKey = Date.now();
    const userMessage = {
      id: `user-document-${messageKey}`,
      backendId: 0,
      role: 'user',
      text: text || '请帮我分析这份植物文档。',
      documentInput: true,
      documentAttachment: {
        type: 'document',
        originalPersisted: false,
        originalName: pendingDocument.name,
        byteSize: pendingDocument.byteSize
      },
      summary: '', suggestions: [], sources: [], taskSuggestions: [],
      timeLabel: formatTimeLabel()
    };
    const loadingMessage = {
      id: `assistant-document-loading-${messageKey}`,
      role: 'assistant',
      text: 'NOVA 正在读取这份文档中与植物有关的内容…',
      summary: '', suggestions: [], sources: [], taskSuggestions: [], loading: true, timeLabel: ''
    };
    this.setConversationMessages(this.data.messages.concat([userMessage, loadingMessage]), {
      sending: true,
      documentBusy: true,
      attachmentMenuOpen: false,
      attachmentMenuView: 'root',
      pendingDocument: null,
      inputValue: '',
      selectedFunction: null,
      rewriteSourceMessageId: 0,
      rewriteSourceTime: '',
      canSend: false
    });
    this.scrollToBottomSoon();
    let mediaFileId = '';
    let mediaClaimed = false;
    try {
      const uploaded = await mediaStorageService.uploadDocument({
        path: pendingDocument.tempFilePath,
        name: pendingDocument.name,
        size: pendingDocument.byteSize
      }, { plantPetId });
      mediaFileId = uploaded.fileId;
      if (!this.isCurrentAssistantAsyncScope(requestScope)) {
        await mediaStorageService.discard(mediaFileId).catch(() => {});
        mediaFileId = '';
        return;
      }
      const response = await agentService.analyzeDocument({
        sessionId: activeSessionId,
        clientTurnKey,
        mediaFileId,
        plantPetId,
        message: text
      });
      mediaClaimed = true;
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      const nextMessages = this.data.messages.map((item) => {
        if (item.id === userMessage.id) {
          return {
            ...item,
            backendId: Number(response.userMessageId) || 0,
            documentAttachment: decorateDocumentAttachment(response.attachment || { ...item.documentAttachment, mediaFileId, originalPersisted: true })
          };
        }
        if (item.id === loadingMessage.id) return this.buildAssistantMessage(response);
        return item;
      });
      this.setConversationMessages(this.decorateMessageActions(nextMessages), {
        quota: response.quota || this.data.quota
      });
      await this.refreshConversations(activeSessionId).catch(() => {});
    } catch (err) {
      if (mediaFileId && !mediaClaimed) await mediaStorageService.discard(mediaFileId).catch(() => {});
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        this.replaceLoadingMessage(loadingMessage.id, this.buildFallbackMessage(err));
      }
    } finally {
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        this.setData({ sending: false, documentBusy: false });
      }
      this._documentSendPending = false;
      if (this.isCurrentAssistantAsyncScope(requestScope)) this.scrollToBottomSoon();
    }
  },

  async sendVisionMessage(text = '') {
    if (this._visionSendPending || this.data.visionBusy || isAssistantInteractionLocked(this.data)) return;
    this._visionSendPending = true;
    let requestScope = this.captureAssistantAsyncScope();
    const payload = this._pendingVisionPayload;
    const pendingImage = this.data.pendingImage;
    if (!payload || !pendingImage?.tempFilePath) {
      this.removePendingImage();
      wx.showToast({ title: '图片草稿已失效，请重新选择', icon: 'none' });
      this._visionSendPending = false;
      return;
    }
    if (!(await this.ensureVisionNotice())) {
      this._visionSendPending = false;
      return;
    }
    if (!this.isCurrentAssistantAsyncScope(requestScope)) {
      this._visionSendPending = false;
      return;
    }

    this.invalidateAssistantAsyncScope();
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    let activeSessionId = this.data.activeSessionId || buildSessionId(plantPetId);
    requestScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
    const clientTurnKey = createClientTurnKey();
    this.setData({ sending: true, visionBusy: true, attachmentMenuOpen: false, attachmentMenuView: 'root' });
    try {
      activeSessionId = await this.prepareRewriteConversation(plantPetId, requestScope);
      if (!activeSessionId) return;
      requestScope = this.captureAssistantAsyncScope(plantPetId, activeSessionId);
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
    } catch (err) {
      if (!this._assistantUnmounted) {
        this.setData({ sending: false, visionBusy: false });
        wx.showToast({ title: err.message || '重新编辑失败', icon: 'none' });
      }
      this._visionSendPending = false;
      return;
    }
    const messageKey = Date.now();
    const userMessage = {
      id: `user-vision-${messageKey}`,
      backendId: 0,
      role: 'user',
      text,
      imagePreview: pendingImage.tempFilePath,
      summary: '', suggestions: [], sources: [], taskSuggestions: [],
      timeLabel: formatTimeLabel()
    };
    const loadingMessage = {
      id: `assistant-vision-loading-${messageKey}`,
      role: 'assistant',
      text: 'NOVA 正在观察这张图片…',
      summary: '', suggestions: [], sources: [], taskSuggestions: [],
      loading: true,
      timeLabel: ''
    };
    this._pendingVisionPayload = null;
    this.setConversationMessages(this.data.messages.concat([userMessage, loadingMessage]), {
      sending: true,
      visionBusy: true,
      attachmentMenuOpen: false,
      pendingImage: null,
      inputValue: '',
      selectedFunction: null,
      rewriteSourceMessageId: 0,
      rewriteSourceTime: '',
      canSend: false
    });
    this.scrollToBottomSoon();
    let conversationMediaFileId = '';
    let conversationMediaClaimed = false;
    try {
      conversationMediaFileId = await mediaStorageService.uploadImage(
        pendingImage.tempFilePath,
        'conversation_image',
        { plantPetId }
      );
      if (!this.isCurrentAssistantAsyncScope(requestScope)) {
        await mediaStorageService.discard(conversationMediaFileId).catch(() => {});
        conversationMediaFileId = '';
        return;
      }
      const result = await agentService.analyzeImage({
        sessionId: activeSessionId,
        clientTurnKey,
        imageBase64: payload.imageBase64,
        mimeType: payload.mimeType,
        mediaFileId: conversationMediaFileId,
        plantPetId,
        message: text
      });
      conversationMediaClaimed = true;
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      const assistantMessage = {
        id: `assistant-vision-${messageKey}`,
        backendId: Number(result.assistantMessageId) || 0,
        role: 'assistant',
        text: '',
        summary: contextNotice(result),
        suggestions: [],
        sources: [],
        taskSuggestions: result.taskSuggestions || [],
        visionResult: decorateVisionResult(result.analysis),
        visionModel: result.model || '',
        visionPreview: pendingImage.tempFilePath,
        visionMessageId: Number(result.assistantMessageId) || 0,
        visionMediaFileId: result.mediaFileId || conversationMediaFileId,
        visionOriginalUnavailable: false,
        diagnosisSaved: false,
        timeLabel: formatTimeLabel()
      };
      const nextMessages = this.data.messages.map((item) => {
        if (item.id === userMessage.id) return {
          ...item,
          backendId: Number(result.userMessageId) || 0,
          visionInput: true,
          visionMediaFileId: result.mediaFileId || conversationMediaFileId
        };
        if (item.id === loadingMessage.id) return assistantMessage;
        return item;
      });
      this.setConversationMessages(this.decorateMessageActions(nextMessages), {
        quota: result.quota || this.data.quota
      });
      await this.refreshConversations(activeSessionId).catch(() => {});
    } catch (err) {
      console.error('[assistant] vision failed:', err);
      if (conversationMediaFileId && !conversationMediaClaimed) {
        await mediaStorageService.discard(conversationMediaFileId).catch(() => {});
      }
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        this.replaceLoadingMessage(loadingMessage.id, {
          id: `assistant-vision-error-${messageKey}`,
          role: 'assistant',
          text: '',
          summary: '', suggestions: [], sources: [], taskSuggestions: [],
          visionError: getVisionErrorMessage(err),
          timeLabel: formatTimeLabel()
        });
      }
    } finally {
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        this.setData({ sending: false, visionBusy: false });
      }
      this._visionSendPending = false;
      if (this.isCurrentAssistantAsyncScope(requestScope)) this.scrollToBottomSoon();
    }
  },

  async saveVisionDiagnosis(e = {}) {
    const messageIndex = Number(e.currentTarget?.dataset?.messageIndex);
    const message = this.data.messages[messageIndex];
    const plantPetId = Number(this.data.selectedPlantPet?.id) || 0;
    if (!plantPetId || !message?.visionResult?.isPlant || !message.visionPreview || this.data.savingDiagnosis) return;
    const requestScope = this.captureAssistantAsyncScope();
    const sourceMessageId = Number(message.backendId || message.visionMessageId) || 0;
    const sourceClientMessageId = String(message.id || '');
    this.setData({ savingDiagnosis: true });
    let mediaFileId = '';
    let diagnosisCreated = false;
    try {
      mediaFileId = await mediaStorageService.uploadImage(message.visionPreview, 'diagnosis_image', { plantPetId });
      const saved = await agentService.saveDiagnosis({
        plantPetId,
        mediaFileId,
        analysis: message.visionResult,
        modelVersion: message.visionModel
      });
      diagnosisCreated = true;
      const diagnosisId = Number(saved.diagnosis?.id) || 0;
      if (message.visionMessageId && diagnosisId) {
        await agentService.markVisionSaved({
          assistantMessageId: message.visionMessageId,
          diagnosisId
        }).catch((err) => console.warn('[assistant] vision conversation link failed:', err.message));
      }
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      this.setConversationMessages(this.data.messages.map((item) => (
          (sourceMessageId > 0 && Number(item.backendId || item.visionMessageId) === sourceMessageId)
          || (sourceClientMessageId && String(item.id || '') === sourceClientMessageId)
        ) ? {
          ...item,
          diagnosisSaved: true,
          visionMediaFileId: item.visionMediaFileId || mediaFileId,
          visionOriginalUnavailable: false
        } : item), {
        memoryCount: this.data.memoryCount + 1
      });
      wx.showToast({ title: '已保存到植宠', icon: 'success' });
    } catch (err) {
      if (mediaFileId && !diagnosisCreated) await mediaStorageService.discard(mediaFileId).catch(() => {});
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      }
    } finally {
      if (this.isCurrentAssistantAsyncScope(requestScope)) this.setData({ savingDiagnosis: false });
    }
  },

  assistCreatePlantPet(e = {}) {
    const messageIndex = Number(e.currentTarget?.dataset?.messageIndex);
    const message = this.data.messages[messageIndex];
    const candidate = message?.visionResult?.candidates?.[0];
    if (!candidate) return;
    wx.setStorageSync('nvp_pending_vision_plant', {
      speciesName: candidate.name,
      nickname: `我的${candidate.name}`,
      coverTempPath: message.visionPreview,
      analysis: message.visionResult,
      modelVersion: message.visionModel,
      createdAt: Date.now()
    });
    wx.navigateTo({ url: '/pages/plantPetForm/plantPetForm?fromVision=1' });
  },

  async startRewrite(e = {}) {
    const backendId = Number(e.currentTarget?.dataset?.id) || 0;
    const message = this.data.messages.find((item) => item.backendId === backendId && item.role === 'user');
    if (!message?.canRewrite || isAssistantInteractionLocked(this.data)) return;
    const requestScope = this.captureAssistantAsyncScope();
    let pendingImage = null;
    let pendingDocument = null;
    let pendingVisionPayload = null;
    this.setData({ rewriteBusy: true, messageActionMenuOpen: false });
    try {
      if (message.visionInput) {
        let tempFilePath = message.imagePreview || await mediaStorageService.resolveFileId(message.visionMediaFileId);
        if (/^https?:\/\//i.test(tempFilePath)) {
          const downloaded = await callWx('downloadFile', { url: tempFilePath });
          tempFilePath = downloaded.tempFilePath || downloaded.filePath || '';
        }
        if (!tempFilePath) throw new Error('原图已经不可用');
        const file = await callFs('readFile', { filePath: tempFilePath, encoding: 'base64' });
        const mimeType = detectImageMimeFromBase64(file.data);
        const byteSize = getBase64ByteSize(file.data);
        if (!mimeType || !byteSize || byteSize > MAX_IMAGE_BYTES) throw new Error('原图已经不可用');
        pendingVisionPayload = { tempFilePath, imageBase64: file.data, mimeType, byteSize };
        pendingImage = {
          tempFilePath,
          byteSize,
          sizeLabel: `${Math.max(1, Math.ceil(byteSize / 1024))} KB`
        };
      } else if (message.documentInput) {
        const attachment = message.documentAttachment || {};
        const tempFilePath = await mediaStorageService.resolveFileId(attachment.mediaFileId);
        if (!tempFilePath) throw new Error('原文档已经不可用');
        pendingDocument = {
          tempFilePath,
          name: attachment.originalName || '植物文档',
          byteSize: Number(attachment.byteSize) || 0,
          sizeLabel: attachment.sizeLabel || formatFileSize(attachment.byteSize)
        };
      }
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      this._pendingVisionPayload = pendingVisionPayload;
      this.setData({
        rewriteSourceMessageId: backendId,
        rewriteSourceTime: message.timeLabel || '',
        inputValue: message.text || '',
        pendingImage,
        pendingDocument,
        selectedFunction: null,
        attachmentMenuOpen: false,
        messageActionMenuOpen: false,
        canSend: canSendDraft(message.text || '', pendingImage, pendingDocument)
      });
    } catch (err) {
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        wx.showToast({ title: err.message || '原附件加载失败', icon: 'none' });
      }
    } finally {
      if (this.isCurrentAssistantAsyncScope(requestScope)) this.setData({ rewriteBusy: false });
    }
  },

  cancelRewrite() {
    this._pendingVisionPayload = null;
    this.setData({
      rewriteSourceMessageId: 0,
      rewriteSourceTime: '',
      inputValue: '',
      pendingImage: null,
      pendingDocument: null,
      canSend: false
    });
  },

  copyMessage(e = {}) {
    const backendId = Number(e.currentTarget?.dataset?.id) || 0;
    const message = this.data.messages.find((item) => item.backendId === backendId && item.role === 'user');
    const text = String(message?.text || '');
    if (!text) return;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: '已复制', icon: 'none' })
    });
  },

  withdrawMessage(e = {}) {
    const backendId = Number(e.currentTarget?.dataset?.id) || 0;
    const message = this.data.messages.find((item) => item.backendId === backendId && item.role === 'user');
    if (!message?.canWithdraw || isAssistantInteractionLocked(this.data)) return;
    const sessionId = this.data.activeSessionId || '';
    const requestScope = this.captureAssistantAsyncScope(undefined, sessionId);
    wx.showModal({
      title: '撤回最后一轮对话？',
      content: '这会删除这条消息、NOVA 的回答和本轮附件；更早的对话不会改变。',
      confirmText: '确认撤回',
      confirmColor: '#be123c',
      success: async (result) => {
        if (!result.confirm || !this.isCurrentAssistantAsyncScope(requestScope)) return;
        this.invalidateAssistantAsyncScope();
        const mutationScope = this.captureAssistantAsyncScope(undefined, sessionId);
        try {
          this.setData({ sending: true });
          await agentService.withdrawLatestExchange({
            sessionId,
            userMessageId: backendId
          });
          if (!this.isCurrentAssistantAsyncScope(mutationScope)) return;
          if (!await this.refreshConversations(sessionId)) return;
          if (!this.isCurrentAssistantAsyncScope(mutationScope)) return;
          if (!await this.loadSession(sessionId)) return;
          if (!this.isCurrentAssistantAsyncScope(mutationScope)) return;
          wx.showToast({ title: '已撤回本轮', icon: 'none' });
        } catch (err) {
          if (this.isCurrentAssistantAsyncScope(mutationScope)) {
            wx.showToast({ title: err.message || '撤回失败', icon: 'none' });
          }
        } finally {
          if (this.isCurrentAssistantAsyncScope(mutationScope)) this.setData({ sending: false });
        }
      }
    });
  },

  openMessageActionMenu(e = {}) {
    const backendId = Number(e.currentTarget?.dataset?.id) || 0;
    const message = this.data.messages.find((item) => item.backendId === backendId && item.role === 'user');
    const touch = e.touches?.[0] || e.changedTouches?.[0] || {};
    const windowInfo = typeof wx.getWindowInfo === 'function'
      ? wx.getWindowInfo()
      : wx.getSystemInfoSync();
    const menu = buildMessageActionMenu(message, touch, windowInfo);
    if (!menu) return;
    this.setData({
      attachmentMenuOpen: false,
      messageActionMenuOpen: true,
      messageActionMessageId: menu.backendId,
      messageActionMenuActions: menu.actions,
      messageActionMenuLeft: menu.left,
      messageActionMenuTop: menu.top
    });
  },

  closeMessageActionMenu() {
    if (!this.data.messageActionMenuOpen) return;
    this.setData({
      messageActionMenuOpen: false,
      messageActionMessageId: 0,
      messageActionMenuActions: []
    });
  },

  keepMessageActionMenuOpen() {},

  runMessageAction(e = {}) {
    const action = String(e.currentTarget?.dataset?.action || '');
    const backendId = Number(this.data.messageActionMessageId) || 0;
    this.closeMessageActionMenu();
    const event = { currentTarget: { dataset: { id: backendId } } };
    if (action === 'copy') return this.copyMessage(event);
    if (action === 'rewrite') return this.startRewrite(event);
    if (action === 'withdraw') return this.withdrawMessage(event);
  },

  openAiMemory() {
    wx.navigateTo({ url: '/pages/aiMemory/aiMemory' });
  },

  goManualPlantPet() {
    wx.navigateTo({ url: '/pages/plantPetForm/plantPetForm' });
  },

  previewTaskSuggestion(e) {
    const messageIndex = Number(e.currentTarget.dataset.messageIndex);
    const suggestionIndex = Number(e.currentTarget.dataset.suggestionIndex);
    const suggestion = this.data.messages[messageIndex]?.taskSuggestions?.[suggestionIndex];
    if (!suggestion?.proposalKey || suggestion.status !== 'pending') return;
    wx.navigateTo({ url: `/pages/taskForm/taskForm?proposalKey=${encodeURIComponent(suggestion.proposalKey)}` });
  },

  async confirmMemorySuggestion(e = {}) {
    const messageIndex = Number(e.currentTarget?.dataset?.messageIndex);
    const suggestionIndex = Number(e.currentTarget?.dataset?.suggestionIndex);
    const sourceMessage = this.data.messages[messageIndex];
    const suggestion = sourceMessage?.memorySuggestions?.[suggestionIndex];
    if (!suggestion?.proposalKey || suggestion.status !== 'pending' || this.data.proposalBusyKey) return;
    const requestScope = this.captureAssistantAsyncScope();
    const sourceMessageId = Number(sourceMessage.backendId) || 0;
    this.setData({ proposalBusyKey: suggestion.proposalKey });
    try {
      await agentService.confirmMemoryProposal(suggestion.proposalKey);
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      this.setConversationMessages(this.data.messages.map((message) => Number(message.backendId) === sourceMessageId ? {
          ...message,
          memorySuggestions: message.memorySuggestions.map((item) => item.proposalKey === suggestion.proposalKey
            ? { ...item, status: 'confirmed' }
            : item)
        } : message), {
        memoryCount: this.data.memoryCount + 1
      });
      wx.showToast({ title: '称呼已记住', icon: 'success' });
    } catch (err) {
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        wx.showToast({ title: err.message || '保存称呼失败', icon: 'none' });
      }
    } finally {
      if (this.isCurrentAssistantAsyncScope(requestScope) && this.data.proposalBusyKey === suggestion.proposalKey) {
        this.setData({ proposalBusyKey: '' });
      }
    }
  },

  async dismissMemorySuggestion(e = {}) {
    const messageIndex = Number(e.currentTarget?.dataset?.messageIndex);
    const suggestionIndex = Number(e.currentTarget?.dataset?.suggestionIndex);
    const sourceMessage = this.data.messages[messageIndex];
    const suggestion = sourceMessage?.memorySuggestions?.[suggestionIndex];
    if (!suggestion?.proposalKey || suggestion.status !== 'pending' || this.data.proposalBusyKey) return;
    const requestScope = this.captureAssistantAsyncScope();
    const sourceMessageId = Number(sourceMessage.backendId) || 0;
    this.setData({ proposalBusyKey: suggestion.proposalKey });
    try {
      await agentService.dismissMemoryProposal(suggestion.proposalKey);
      if (!this.isCurrentAssistantAsyncScope(requestScope)) return;
      this.setConversationMessages(this.data.messages.map((message) => Number(message.backendId) === sourceMessageId ? {
          ...message,
          memorySuggestions: message.memorySuggestions.map((item) => item.proposalKey === suggestion.proposalKey
            ? { ...item, status: 'cancelled' }
            : item)
        } : message));
    } catch (err) {
      if (this.isCurrentAssistantAsyncScope(requestScope)) {
        wx.showToast({ title: err.message || '取消失败', icon: 'none' });
      }
    } finally {
      if (this.isCurrentAssistantAsyncScope(requestScope) && this.data.proposalBusyKey === suggestion.proposalKey) {
        this.setData({ proposalBusyKey: '' });
      }
    }
  },

  openSource(e) {
    const url = e.currentTarget.dataset.url || '';
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => wx.showToast({ title: '来源链接已复制', icon: 'none' }) });
  },

  scrollToBottomSoon() {
    // 加载占位被长回答替换时，目标 id 不变；先清空再锚定末端，强制按新高度重算。
    this.setData({ scrollAnchor: '' });
    setTimeout(() => this.setData({ scrollAnchor: 'message-end' }), 60);
  }
});
