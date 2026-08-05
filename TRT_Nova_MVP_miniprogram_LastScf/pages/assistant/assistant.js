const app = getApp();
const agentService = require('../../services/modules/AgentService');
const deviceService = require('../../services/modules/DeviceService');

function getStatusBarHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().statusBarHeight || 20;
  }
  return wx.getSystemInfoSync().statusBarHeight || 20;
}

function buildSessionId(logicalKey = '') {
  const safeKey = String(logicalKey || 'global').replace(/[^\w-]/g, '_');
  return `assistant_${safeKey}`;
}

Page({
  data: {
    statusBarHeight: 20,
    headerTopGap: 16,
    inputValue: '',
    canSend: false,
    sending: false,
    devices: [],
    selectedLogicalKey: '',
    selectedDeviceName: '未选择设备',
    knowledgeContext: null,
    scrollAnchor: '',
    welcomePrompts: [
      '我的植物现在状态怎么样？',
      '我现在要不要浇水？',
      '最近湿度变化如何？',
      '帮我看看这台设备有没有异常'
    ],
    messages: [
      {
        id: 'welcome-1',
        role: 'assistant',
        text: '你好，我是 TRT Nova 植物养护助手，可以帮你查看植物状态、分析浇水与光照建议，并解答养护问题。',
        summary: '我会优先结合你当前设备的数据和知识库内容来回答。',
        suggestions: ['我的植物现在状态怎么样？', '我现在要不要浇水？', '最近湿度变化如何？'],
        timeLabel: ''
      }
    ]
  },

  onLoad() {
    this.setData({
      statusBarHeight: getStatusBarHeight(),
      headerTopGap: 18
    });
    this.hydrateKnowledgeContext();
    this.checkLoginStatus();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    this.hydrateKnowledgeContext();
    if (!this.checkLoginStatus()) return;
    this.loadDevices();
  },

  hydrateKnowledgeContext() {
    const context = wx.getStorageSync('nvp_pending_assistant_context');
    if (context && typeof context === 'object' && context.title) {
      this.setData({ knowledgeContext: context });
      wx.removeStorageSync('nvp_pending_assistant_context');
      return;
    }

    if (!context) {
      this.setData({ knowledgeContext: null });
    }
  },

  checkLoginStatus() {
    app.checkLoginStatus();
    if (!app.globalData.hasLogin) {
      setTimeout(() => {
        wx.redirectTo({ url: '/pages/auth/auth' });
      }, 100);
      return false;
    }
    return true;
  },

  async loadDevices() {
    try {
      const result = await deviceService.getDeviceData();
      const devices = Array.isArray(result?.deviceData)
        ? result.deviceData.map((item) => ({
            logicalKey: item.logicalKey || '',
            name: item.alias || item.deviceName || '未命名设备'
          }))
        : [];

      const currentKey = this.data.selectedLogicalKey || (devices[0] && devices[0].logicalKey) || '';
      const currentDevice = devices.find((item) => item.logicalKey === currentKey) || devices[0] || null;

      this.setData({
        devices,
        selectedLogicalKey: currentDevice ? currentDevice.logicalKey : '',
        selectedDeviceName: currentDevice ? currentDevice.name : '未选择设备'
      });
    } catch (err) {
      console.warn('[assistant] loadDevices failed:', err);
      this.setData({
        devices: [],
        selectedLogicalKey: '',
        selectedDeviceName: '未选择设备'
      });
    }
  },

  onDeviceChange(e) {
    const index = Number(e.detail.value || 0);
    const device = this.data.devices[index];
    this.setData({
      selectedLogicalKey: device ? device.logicalKey : '',
      selectedDeviceName: device ? device.name : '未选择设备'
    });
  },

  onInput(e) {
    const inputValue = e.detail.value || '';
    this.setData({
      inputValue,
      canSend: Boolean(String(inputValue).trim())
    });
  },

  onQuickQuestionTap(e) {
    const text = e.currentTarget.dataset.text || '';
    if (!text) return;
    this.setData({ inputValue: text, canSend: Boolean(String(text).trim()) });
    this.sendMessage();
  },

  async sendMessage() {
    const text = String(this.data.inputValue || '').trim();
    if (!text || this.data.sending) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      summary: '',
      suggestions: [],
      timeLabel: this.formatTimeLabel(Date.now())
    };

    const loadingMessage = {
      id: `assistant-loading-${Date.now()}`,
      role: 'assistant',
      text: '正在思考你的问题...',
      summary: '',
      suggestions: [],
      timeLabel: '',
      loading: true
    };

    this.setData({
      sending: true,
      inputValue: '',
      canSend: false,
      messages: this.data.messages.concat([userMessage, loadingMessage])
    });
    this.scrollToBottomSoon();

    try {
      const logicalKey = this.data.selectedLogicalKey || '';
      const response = await agentService.chat({
        sessionId: buildSessionId(logicalKey),
        logicalKey,
        message: text,
        context: {
          page: 'assistant',
          deviceName: this.data.selectedDeviceName,
          knowledgeContext: this.data.knowledgeContext || null
        },
        options: {
          includeHistory: true,
          historyRange: '24h',
          allowActions: false,
          allowControlSuggestions: true
        }
      });

      this.replaceLoadingMessage(loadingMessage.id, this.buildAssistantMessage(response));
    } catch (err) {
      this.replaceLoadingMessage(loadingMessage.id, this.buildFallbackMessage(err));
    } finally {
      this.setData({ sending: false });
      this.scrollToBottomSoon();
    }
  },

  buildAssistantMessage(response) {
    const summary = response?.summary || '';
    const diagnosis = response?.diagnosis || response?.message || response?.msg || '';
    const facts = Array.isArray(response?.facts) ? response.facts : [];
    const disclaimer = response?.disclaimer || '';
    const suggestions = Array.isArray(response?.suggestions)
      ? response.suggestions
      : Array.isArray(response?.followUpQuestions)
        ? response.followUpQuestions
        : [];

    return {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      text: [summary, diagnosis].filter(Boolean).join('\n\n') || '我已经收到你的问题，不过当前后端还没有返回完整答案。',
      summary: [facts.length ? `依据：${facts.slice(0, 3).join('；')}` : '', disclaimer].filter(Boolean).join('\n'),
      suggestions: suggestions.slice(0, 3),
      timeLabel: this.formatTimeLabel(Date.now()),
      loading: false
    };
  },

  buildFallbackMessage(err) {
    const message = String((err && (err.message || err.errMsg)) || '').trim();
    const isRouteMissing = message.includes('接口不存在') || message.includes('请求地址不存在') || message.includes('404');

    return {
      id: `assistant-fallback-${Date.now()}`,
      role: 'assistant',
      text: isRouteMissing
        ? '助手聊天界面已经连上了，但后端 `/agent/chat` 还没可用，所以现在只能显示前端兜底提示。等 Agent 接口上线后，这里就会返回真正的对话结果。'
        : `这次对话暂时没有成功返回结果。${message || '请稍后再试。'}`,
      summary: isRouteMissing ? '当前状态：前端已接入，后端接口待完善。' : '',
      suggestions: isRouteMissing
        ? ['我的植物现在状态怎么样？', '我现在要不要浇水？', '最近湿度变化如何？']
        : ['稍后重试', '检查登录状态', '确认 Agent 接口是否可用'],
      timeLabel: this.formatTimeLabel(Date.now()),
      loading: false
    };
  },

  replaceLoadingMessage(loadingId, nextMessage) {
    this.setData({
      messages: this.data.messages.map((item) => (item.id === loadingId ? nextMessage : item))
    });
  },

  scrollToBottomSoon() {
    setTimeout(() => {
      this.setData({ scrollAnchor: `msg-${this.data.messages.length - 1}` });
    }, 60);
  },

  formatTimeLabel(ts) {
    const date = new Date(ts);
    const pad = (part) => String(part).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
});
