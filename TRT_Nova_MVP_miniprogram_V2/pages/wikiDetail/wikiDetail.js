const app = getApp();
const knowledgeService = require('../../services/modules/KnowledgeService');
const todoService = require('../../services/modules/TodoService');
const themeBehavior = require('../../services/modules/ThemeBehavior');

const CATEGORY_LABELS = {
  'plant-care': '养护知识',
  'device-protocol': '字段解释',
  'system-rule': '系统规则',
  'usage-guide': '使用指南'
};

const DOC_MARKS = {
  'device-protocol': '设备字段',
  'system-rule': '系统规则'
};

const DOC_TIPS = {
  'plant-care': '绑定设备后，土壤湿度低于 55% 时首页会自动出现浇水待办，不用自己记日子。',
  'device-protocol': '字段解释类文章：可在设备详情页对照实时数据，逐项查看每个字段的当前值与含义。',
  'system-rule': '系统规则类文章：标记了 TRT Nova 自动化行为的触发条件与阈值，绑定设备后即时生效。',
  'usage-guide': '使用指南类文章：跟着步骤在对应页面操作一遍，就能完整上手。'
};

function getWindowHeight() {
  if (typeof wx.getWindowInfo === 'function') {
    return wx.getWindowInfo().windowHeight || 667;
  }
  return wx.getSystemInfoSync().windowHeight || 667;
}

function shapeArticle(raw) {
  const content = String(raw.content || '');
  const paragraphs = content.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const lead = paragraphs[0] || '';
  const category = raw.category;
  return {
    ...raw,
    paragraphs,
    firstChar: lead.charAt(0) || '',
    leadRest: lead.slice(1),
    docMark: DOC_MARKS[category] || '',
    docTip: DOC_TIPS[category] || DOC_TIPS['plant-care'],
    readMinutes: Math.max(1, Math.round(content.length / 128))
  };
}

function formatArticleContext(article = {}) {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    content: article.content,
    category: article.category,
    tags: article.tags || [],
    plantTypes: article.plantTypes || [],
    problemTypes: article.problemTypes || [],
    sourceRef: article.sourceRef || ''
  };
}

Page({
  behaviors: [themeBehavior],

  onShow() {
    this.syncTheme();
  },

  data: {
    loading: true,
    article: null,
    readProgress: 0
  },

  onLoad(options = {}) {
    this.viewHeight = getWindowHeight();
    this.setData({
      statusBarHeight: this.getHeaderTop(),
      theme: app.globalData.theme || 'light'
    });
    if (!this.checkLoginStatus()) return;
    this.loadArticle(options.articleId || '');
  },

  onReadScroll(e) {
    if (!this.viewHeight) return;
    const { scrollTop, scrollHeight } = e.detail || {};
    const max = scrollHeight - this.viewHeight;
    if (!max || max <= 0) return;
    const p = Math.min(100, Math.round((scrollTop / max) * 100));
    if (p !== this.data.readProgress) {
      this.setData({ readProgress: p });
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

  async loadArticle(articleId) {
    this.setData({ loading: true });
    try {
      const res = await knowledgeService.getArticle(articleId);
      if (!res?.article) {
        wx.showToast({ title: '文章不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
        return;
      }

      this.setData({
        article: shapeArticle({
          ...res.article,
          displayCategory: CATEGORY_LABELS[res.article.category] || res.article.category || '知识文章',
          displaySourceType: res.article.sourceType === 'seed' ? '种子内容' : (res.article.sourceType || '来源')
        }),
        loading: false,
        readProgress: 0
      });
    } catch (err) {
      console.error('[wikiDetail] loadArticle failed:', err);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  openAssistant() {
    const article = this.data.article;
    if (!article) return;

    wx.setStorageSync('nvp_pending_assistant_context', formatArticleContext(article));
    // assistant 是 tabBar 页，navigateTo 无法跳转，必须用 switchTab
    wx.switchTab({ url: '/pages/assistant/assistant' });
  },

  async addReminder() {
    const article = this.data.article;
    if (!article) return;

    try {
      wx.showLoading({ title: '添加中...' });
      await todoService.addTodo(`阅读并跟进：${article.title}`, 'global');
      wx.showToast({ title: '已加入提醒', icon: 'success' });
    } catch (err) {
      console.error('[wikiDetail] addReminder failed:', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  }
});
